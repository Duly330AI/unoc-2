type MetricPoint = {
  id: string;
  trafficLoad: number;
  trafficMbps?: number;
  trafficProfile?: {
    voice_mbps: number;
    iptv_mbps: number;
    internet_mbps: number;
  };
  segmentId?: string | null;
  rxPower: number;
  status: "UP" | "DOWN" | "DEGRADED";
  metric_tick_seq: number;
};

type SubscriberDemand = {
  deviceId: string;
  segmentId: string | null;
  voiceMbps: number;
  iptvMbps: number;
  internetMbps: number;
};

type ActiveSessionSnapshot = {
  interface: {
    deviceId: string;
  };
  bngDeviceId: string | null;
  serviceType: string;
};

type SimulationServiceDeps = {
  prisma: any;
  trafficRandomSeed: string;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  flushRealtimeOutbox: (correlationId?: string) => void;
  deterministicFactor: (seed: string) => number;
  normalizeDeviceType: (input: string) => string | undefined;
  isSubscriberDeviceType: (type: string) => boolean;
  buildPassabilityState: (devices: any[], links: any[], runtimeStatusDeps: any) => {
    adjacency: Map<string, string[]>;
    typeById: Map<string, any>;
    statusById: Map<string, any>;
    provisionedById: Map<string, boolean>;
  };
  evaluateDeviceRuntimeStatus: (snapshot: any, device: any, runtimeStatusDeps: any) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  findServingOltForLeaf: (
    leafId: string,
    adjacency: Map<string, string[]>,
    typeById: Map<string, any>,
    passiveInlineTypes: Set<string>
  ) => string | null;
  hasSubscriberUpstreamViability: (
    deviceId: string,
    subscriberType: any,
    bngDeviceId: string | null,
    adjacency: Map<string, string[]>,
    typeById: Map<string, any>,
    statusById: Map<string, any>,
    provisionedById: Map<string, boolean>,
    runtimeStatusDeps: any
  ) => boolean;
  signalStatusFromRuntimeStatus: (status: "UP" | "DOWN" | "DEGRADED") => "OK" | "WARNING" | "NO_SIGNAL";
  runtimeStatusDeps: any;
  passiveInlineTypes: Set<string>;
  expireLeasedOutSessions: (now?: Date) => Promise<unknown>;
  sessionStates: Record<string, string>;
  gponDownstreamCapacityMbps: number;
  strictPriorityVoiceMbps: number;
  strictPriorityIptvMbps: number;
  bestEffortInternetMinMbps: number;
  bestEffortInternetBurstMbps: number;
  leafAccessCapacityMbps: number;
};

export const createSimulationService = ({
  prisma,
  trafficRandomSeed,
  emitEvent,
  flushRealtimeOutbox,
  deterministicFactor,
  normalizeDeviceType,
  isSubscriberDeviceType,
  buildPassabilityState,
  evaluateDeviceRuntimeStatus,
  findServingOltForLeaf,
  hasSubscriberUpstreamViability,
  signalStatusFromRuntimeStatus,
  runtimeStatusDeps,
  passiveInlineTypes,
  expireLeasedOutSessions,
  sessionStates,
  gponDownstreamCapacityMbps,
  strictPriorityVoiceMbps,
  strictPriorityIptvMbps,
  bestEffortInternetMinMbps,
  bestEffortInternetBurstMbps,
  leafAccessCapacityMbps,
}: SimulationServiceDeps) => {
  const latestMetrics = new Map<string, MetricPoint>();
  const segmentCongestionState = new Map<string, boolean>();
  let metricTickSeq = 0;

  const buildActiveServicesByDeviceId = (sessions: ActiveSessionSnapshot[]) => {
    const byDeviceId = new Map<string, Set<string>>();

    for (const session of sessions) {
      const deviceId = session.interface.deviceId;
      if (!byDeviceId.has(deviceId)) {
        byDeviceId.set(deviceId, new Set());
      }
      byDeviceId.get(deviceId)!.add(session.serviceType.toUpperCase());
    }

    return byDeviceId;
  };

  const buildSubscriberDemand = (
    deviceId: string,
    activeServices: Set<string> | undefined,
    tick: number
  ): SubscriberDemand => {
    const hasVoice = activeServices?.has("VOICE") ?? false;
    const hasIptv = activeServices?.has("IPTV") ?? false;
    const hasInternet = activeServices?.has("INTERNET") ?? false;

    const voiceMbps = hasVoice ? strictPriorityVoiceMbps : 0;
    const iptvMbps = hasIptv ? strictPriorityIptvMbps : 0;
    const internetMbps = hasInternet
      ? Number(
          (
            bestEffortInternetMinMbps +
            deterministicFactor(`${trafficRandomSeed}:${deviceId}:${tick}:internet`) * bestEffortInternetBurstMbps
          ).toFixed(2)
        )
      : 0;

    return {
      deviceId,
      segmentId: null,
      voiceMbps,
      iptvMbps,
      internetMbps,
    };
  };

  const clampDownstreamDemands = (
    demands: SubscriberDemand[],
    capacityMbps = gponDownstreamCapacityMbps
  ) => {
    const effectiveByDeviceId = new Map<
      string,
      {
        segmentId: string | null;
        voiceMbps: number;
        iptvMbps: number;
        internetMbps: number;
        totalMbps: number;
      }
    >();
    const demandsBySegment = new Map<string, SubscriberDemand[]>();

    for (const demand of demands) {
      if (!demand.segmentId) {
        const totalMbps = Number((demand.voiceMbps + demand.iptvMbps + demand.internetMbps).toFixed(2));
        effectiveByDeviceId.set(demand.deviceId, {
          segmentId: null,
          voiceMbps: demand.voiceMbps,
          iptvMbps: demand.iptvMbps,
          internetMbps: demand.internetMbps,
          totalMbps,
        });
        continue;
      }

      if (!demandsBySegment.has(demand.segmentId)) {
        demandsBySegment.set(demand.segmentId, []);
      }
      demandsBySegment.get(demand.segmentId)!.push(demand);
    }

    for (const [segmentId, segmentDemands] of demandsBySegment.entries()) {
      const strictTotal = segmentDemands.reduce((sum, demand) => sum + demand.voiceMbps + demand.iptvMbps, 0);
      const internetTotal = segmentDemands.reduce((sum, demand) => sum + demand.internetMbps, 0);
      const strictScale = strictTotal > capacityMbps ? capacityMbps / strictTotal : 1;
      const remainingBestEffort = Math.max(0, capacityMbps - strictTotal * strictScale);
      const internetScale = internetTotal > 0 ? Math.min(1, remainingBestEffort / internetTotal) : 1;

      for (const demand of segmentDemands) {
        const voiceMbps = Number((demand.voiceMbps * strictScale).toFixed(2));
        const iptvMbps = Number((demand.iptvMbps * strictScale).toFixed(2));
        const internetMbps = Number((demand.internetMbps * internetScale).toFixed(2));
        const totalMbps = Number((voiceMbps + iptvMbps + internetMbps).toFixed(2));

        effectiveByDeviceId.set(demand.deviceId, {
          segmentId,
          voiceMbps,
          iptvMbps,
          internetMbps,
          totalMbps,
        });
      }
    }

    return effectiveByDeviceId;
  };

  const resetSimulationState = () => {
    latestMetrics.clear();
    segmentCongestionState.clear();
    metricTickSeq = 0;
  };

  const runTrafficSimulationTick = async () => {
    await expireLeasedOutSessions();

    const [devices, links, activeSessions] = await Promise.all([
      prisma.device.findMany({ select: { id: true, type: true, status: true, provisioned: true } }),
      prisma.link.findMany({
        select: {
          status: true,
          sourcePort: { select: { deviceId: true } },
          targetPort: { select: { deviceId: true } },
        },
      }),
      prisma.subscriberSession.findMany({
        where: { state: sessionStates.ACTIVE },
        select: {
          serviceType: true,
          bngDeviceId: true,
          interface: {
            select: {
              deviceId: true,
            },
          },
        },
      }),
    ]);

    metricTickSeq += 1;

    const { adjacency, typeById, statusById, provisionedById } = buildPassabilityState(devices, links, runtimeStatusDeps);
    const viableActiveSessions = activeSessions.filter((session: ActiveSessionSnapshot) => {
      const subscriberType = typeById.get(session.interface.deviceId);
      if (!subscriberType || !isSubscriberDeviceType(subscriberType)) return false;

      return hasSubscriberUpstreamViability(
        session.interface.deviceId,
        subscriberType,
        session.bngDeviceId,
        adjacency,
        typeById,
        statusById,
        provisionedById,
        runtimeStatusDeps
      );
    });
    const activeServicesByDeviceId = buildActiveServicesByDeviceId(viableActiveSessions);
    const subscriberDemands: SubscriberDemand[] = [];
    const runtimeSnapshot = { adjacency, typeById, statusById, provisionedById };

    for (const device of devices) {
      const normalizedType = normalizeDeviceType(device.type);
      if (!normalizedType || !isSubscriberDeviceType(normalizedType)) continue;
      if (!device.provisioned) continue;

      const demand = buildSubscriberDemand(device.id, activeServicesByDeviceId.get(device.id), metricTickSeq);
      if (normalizedType === "ONT" || normalizedType === "BUSINESS_ONT") {
        demand.segmentId = findServingOltForLeaf(device.id, adjacency, typeById, passiveInlineTypes);
      }
      subscriberDemands.push(demand);
    }

    const effectiveSubscriberTraffic = clampDownstreamDemands(subscriberDemands);
    const oltTrafficMbpsById = new Map<string, number>();
    for (const effective of effectiveSubscriberTraffic.values()) {
      if (!effective.segmentId) continue;
      oltTrafficMbpsById.set(
        effective.segmentId,
        Number(((oltTrafficMbpsById.get(effective.segmentId) ?? 0) + effective.totalMbps).toFixed(2))
      );
    }

    const updates: MetricPoint[] = [];
    const statusUpdates: Array<{ id: string; status: MetricPoint["status"] }> = [];
    for (const device of devices) {
      const previous = latestMetrics.get(device.id);
      const normalizedType = normalizeDeviceType(device.type) ?? "SWITCH";
      const noise = deterministicFactor(`${trafficRandomSeed}:${device.id}:${metricTickSeq}`);
      const isProvisioned = device.provisioned;
      const runtimeStatus = evaluateDeviceRuntimeStatus(runtimeSnapshot, device, runtimeStatusDeps);
      const status: MetricPoint["status"] = runtimeStatus === "BLOCKING" ? "DOWN" : runtimeStatus;
      const rxBase = normalizedType === "ONT" || normalizedType === "BUSINESS_ONT" ? -18 : -10;
      const rxPower = Number((rxBase - noise * 12).toFixed(2));

      let trafficMbps = 0;
      let trafficLoad = 0;
      let trafficProfile: MetricPoint["trafficProfile"] | undefined;
      let segmentId: string | null | undefined;

      if (!isProvisioned && isSubscriberDeviceType(normalizedType)) {
        trafficMbps = 0;
        trafficLoad = 0;
        trafficProfile = {
          voice_mbps: 0,
          iptv_mbps: 0,
          internet_mbps: 0,
        };
        segmentId = normalizedType === "AON_CPE" ? null : findServingOltForLeaf(device.id, adjacency, typeById, passiveInlineTypes);
      } else if (isSubscriberDeviceType(normalizedType)) {
        const effective = effectiveSubscriberTraffic.get(device.id) ?? {
          segmentId: normalizedType === "AON_CPE" ? null : findServingOltForLeaf(device.id, adjacency, typeById, passiveInlineTypes),
          voiceMbps: 0,
          iptvMbps: 0,
          internetMbps: 0,
          totalMbps: 0,
        };
        trafficMbps = effective.totalMbps;
        trafficLoad = Math.min(100, Math.max(0, Number(((trafficMbps / leafAccessCapacityMbps) * 100).toFixed(0))));
        trafficProfile = {
          voice_mbps: effective.voiceMbps,
          iptv_mbps: effective.iptvMbps,
          internet_mbps: effective.internetMbps,
        };
        segmentId = effective.segmentId;
      } else if (normalizedType === "OLT") {
        trafficMbps = Number((oltTrafficMbpsById.get(device.id) ?? 0).toFixed(2));
        trafficLoad = Math.min(100, Math.max(0, Number(((trafficMbps / gponDownstreamCapacityMbps) * 100).toFixed(0))));
        segmentId = device.id;
      } else {
        const trafficBase = 35;
        trafficLoad = Math.min(100, Math.max(0, Math.round(trafficBase + (noise * 40 - 20))));
        trafficMbps = Number(((trafficLoad / 100) * leafAccessCapacityMbps).toFixed(2));
      }

      const update: MetricPoint = {
        id: device.id,
        trafficLoad,
        trafficMbps,
        ...(trafficProfile ? { trafficProfile } : {}),
        ...(segmentId !== undefined ? { segmentId } : {}),
        rxPower,
        status,
        metric_tick_seq: metricTickSeq,
      };
      latestMetrics.set(device.id, update);
      const isChanged =
        !previous ||
        previous.status !== update.status ||
        previous.trafficLoad !== update.trafficLoad ||
        (previous.trafficMbps ?? 0) !== (update.trafficMbps ?? 0) ||
        Math.abs(previous.rxPower - update.rxPower) >= 0.1;
      if (isChanged) {
        updates.push(update);
      }
      if (!previous || previous.status !== update.status) {
        statusUpdates.push({ id: update.id, status: update.status });
      }
    }

    if (updates.length > 0) {
      emitEvent("deviceMetricsUpdated", { tick: metricTickSeq, items: updates }, false, `sim-${metricTickSeq}`);
      emitEvent(
        "deviceSignalUpdated",
        {
          tick: metricTickSeq,
          items: updates.map((item) => ({
            id: item.id,
            received_dbm: item.rxPower,
            signal_status: signalStatusFromRuntimeStatus(item.status),
          })),
        },
        false,
        `sim-${metricTickSeq}`
      );
    }
    if (statusUpdates.length > 0) {
      emitEvent(
        "deviceStatusUpdated",
        {
          tick: metricTickSeq,
          items: statusUpdates,
        },
        false,
        `sim-${metricTickSeq}`
      );
    }

    const oltUpdates = updates.filter((item) => {
      const device = devices.find((candidate: any) => candidate.id === item.id);
      return device && normalizeDeviceType(device.type) === "OLT";
    });
    for (const item of oltUpdates) {
      const utilization = Number(((item.trafficMbps ?? 0) / gponDownstreamCapacityMbps).toFixed(4));
      const segmentId = item.id;
      const isCongested = segmentCongestionState.get(segmentId) ?? false;
      if (!isCongested && utilization >= 0.95) {
        segmentCongestionState.set(segmentId, true);
        emitEvent(
          "segmentCongestionDetected",
          { segmentId, oltId: segmentId, utilization, tick: metricTickSeq },
          false,
          `sim-${metricTickSeq}`
        );
      } else if (isCongested && utilization <= 0.85) {
        segmentCongestionState.set(segmentId, false);
        emitEvent(
          "segmentCongestionCleared",
          { segmentId, oltId: segmentId, utilization, tick: metricTickSeq },
          false,
          `sim-${metricTickSeq}`
        );
      }
    }

    flushRealtimeOutbox(`sim-${metricTickSeq}`);

    return {
      tick: metricTickSeq,
      devices,
      updates,
    };
  };

  return {
    clampDownstreamDemands,
    resetSimulationState,
    runTrafficSimulationTick,
    getMetricTickSeq: () => metricTickSeq,
    getLatestMetrics: () => Array.from(latestMetrics.values()),
  };
};

type MetricPoint = {
  id: string;
  trafficLoad: number;
  trafficMbps?: number;
  downstreamMbps?: number;
  upstreamMbps?: number;
  trafficProfile?: {
    voice_mbps: number;
    iptv_mbps: number;
    internet_mbps: number;
  };
  segmentId?: string | null;
  rxPower: number;
  status: "UP" | "DOWN" | "DEGRADED";
  tick_seq?: number;
  metric_tick_seq: number;
};

type SubscriberDemand = {
  deviceId: string;
  segmentId: string | null;
  oltId: string | null;
  voiceMbps: number;
  voiceUpstreamMbps: number;
  iptvMbps: number;
  iptvUpstreamMbps: number;
  internetMbps: number;
  internetUpstreamMbps: number;
};

type ActiveSessionSnapshot = {
  interface: {
    deviceId: string;
    device: {
      type: string;
    };
  };
  bngDeviceId: string | null;
  serviceType: string;
};

type ActiveDeviceServices = {
  services: Set<string>;
  internetMaxDownMbps: number | null;
  internetMaxUpMbps: number | null;
};

type EffectiveSubscriberTraffic = {
  segmentId: string | null;
  oltId: string | null;
  voiceMbps: number;
  iptvMbps: number;
  internetMbps: number;
  downstreamMbps: number;
  upstreamMbps: number;
  totalMbps: number;
};

type SimulationServiceDeps = {
  prisma: any;
  trafficRandomSeed: string;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  flushRealtimeOutbox: (correlationId?: string) => void;
  deterministicFactor: (seed: string) => number;
  normalizeDeviceType: (input: string) => string | undefined;
  isSubscriberDeviceType: (type: string) => boolean;
  deriveSessionTariff: (
    deviceType: string,
    serviceType: string
  ) => { max_down: number | null; max_up: number | null } | null;
  buildPassabilityState: (devices: any[], links: any[], runtimeStatusDeps: any) => {
    adjacency: Map<string, string[]>;
    typeById: Map<string, any>;
    statusById: Map<string, any>;
    provisionedById: Map<string, boolean>;
  };
  evaluateDeviceRuntimeStatus: (snapshot: any, device: any, runtimeStatusDeps: any) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  resolveSubscriberSegment: (
    leafId: string,
    adjacency: Map<string, string[]>,
    typeById: Map<string, any>,
    passiveInlineTypes: Set<string>
  ) => { oltId: string; firstPassiveId: string | null; segmentId: string; path: string[] } | null;
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
  deriveSessionTariff,
  buildPassabilityState,
  evaluateDeviceRuntimeStatus,
  resolveSubscriberSegment,
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
    const byDeviceId = new Map<string, ActiveDeviceServices>();

    for (const session of sessions) {
      const deviceId = session.interface.deviceId;
      if (!byDeviceId.has(deviceId)) {
        byDeviceId.set(deviceId, {
          services: new Set(),
          internetMaxDownMbps: null,
          internetMaxUpMbps: null,
        });
      }
      const entry = byDeviceId.get(deviceId)!;
      const serviceType = session.serviceType.toUpperCase();
      entry.services.add(serviceType);

      if (serviceType === "INTERNET") {
        const tariff = deriveSessionTariff(session.interface.device.type, serviceType);
        if (tariff?.max_down !== null && tariff?.max_down !== undefined) {
          entry.internetMaxDownMbps = Math.max(entry.internetMaxDownMbps ?? 0, tariff.max_down);
        }
        if (tariff?.max_up !== null && tariff?.max_up !== undefined) {
          entry.internetMaxUpMbps = Math.max(entry.internetMaxUpMbps ?? 0, tariff.max_up);
        }
      }
    }

    return byDeviceId;
  };

  const buildSubscriberDemand = (
    deviceId: string,
    activeServices: ActiveDeviceServices | undefined,
    tick: number
  ): SubscriberDemand => {
    const hasVoice = activeServices?.services.has("VOICE") ?? false;
    const hasIptv = activeServices?.services.has("IPTV") ?? false;
    const hasInternet = activeServices?.services.has("INTERNET") ?? false;

    const voiceMbps = hasVoice ? strictPriorityVoiceMbps : 0;
    const voiceUpstreamMbps = hasVoice ? Number((strictPriorityVoiceMbps * 0.5).toFixed(2)) : 0;
    const iptvMbps = hasIptv ? strictPriorityIptvMbps : 0;
    const iptvUpstreamMbps = 0;
    const internetMaxDownMbps = activeServices?.internetMaxDownMbps ?? leafAccessCapacityMbps;
    const internetMaxUpMbps = activeServices?.internetMaxUpMbps ?? Math.round(leafAccessCapacityMbps / 2);
    const internetMbps = hasInternet
      ? Number(
          (
            Math.max(bestEffortInternetMinMbps, internetMaxDownMbps * 0.2) +
            deterministicFactor(`${trafficRandomSeed}:${deviceId}:${tick}:internet:down`) *
              Math.max(bestEffortInternetBurstMbps, internetMaxDownMbps * 0.6)
          ).toFixed(2)
        )
      : 0;
    const internetUpstreamMbps = hasInternet
      ? Number(
          (
            Math.max(2, internetMaxUpMbps * 0.05) +
            deterministicFactor(`${trafficRandomSeed}:${deviceId}:${tick}:internet:up`) *
              Math.max(10, internetMaxUpMbps * 0.25)
          ).toFixed(2)
        )
      : 0;

    return {
      deviceId,
      segmentId: null,
      oltId: null,
      voiceMbps,
      voiceUpstreamMbps,
      iptvMbps,
      iptvUpstreamMbps,
      internetMbps,
      internetUpstreamMbps,
    };
  };

  const clampDownstreamDemands = (
    demands: SubscriberDemand[],
    capacityMbps = gponDownstreamCapacityMbps
  ) => {
    const effectiveByDeviceId = new Map<string, EffectiveSubscriberTraffic>();
    const demandsBySegment = new Map<string, SubscriberDemand[]>();

    for (const demand of demands) {
      if (!demand.segmentId) {
        const totalMbps = Number((demand.voiceMbps + demand.iptvMbps + demand.internetMbps).toFixed(2));
        effectiveByDeviceId.set(demand.deviceId, {
          segmentId: null,
          oltId: null,
          voiceMbps: demand.voiceMbps,
          iptvMbps: demand.iptvMbps,
          internetMbps: demand.internetMbps,
          downstreamMbps: totalMbps,
          upstreamMbps: Number(
            (demand.voiceUpstreamMbps + demand.iptvUpstreamMbps + demand.internetUpstreamMbps).toFixed(2)
          ),
          totalMbps: Number(
            (
              totalMbps +
              demand.voiceUpstreamMbps +
              demand.iptvUpstreamMbps +
              demand.internetUpstreamMbps
            ).toFixed(2)
          ),
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
        const downstreamMbps = Number((voiceMbps + iptvMbps + internetMbps).toFixed(2));
        const upstreamMbps = Number(
          (demand.voiceUpstreamMbps + demand.iptvUpstreamMbps + demand.internetUpstreamMbps).toFixed(2)
        );
        const totalMbps = Number((downstreamMbps + upstreamMbps).toFixed(2));

        effectiveByDeviceId.set(demand.deviceId, {
          segmentId,
          oltId: demand.oltId,
          voiceMbps,
          iptvMbps,
          internetMbps,
          downstreamMbps,
          upstreamMbps,
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
              device: {
                select: {
                  type: true,
                },
              },
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
        const segment = resolveSubscriberSegment(device.id, adjacency, typeById, passiveInlineTypes);
        demand.segmentId = segment?.segmentId ?? null;
        demand.oltId = segment?.oltId ?? null;
      }
      subscriberDemands.push(demand);
    }

    const effectiveSubscriberTraffic = clampDownstreamDemands(subscriberDemands);
    const oltDownstreamMbpsById = new Map<string, number>();
    const oltUpstreamMbpsById = new Map<string, number>();
    const segmentTrafficById = new Map<string, { oltId: string; downstreamMbps: number }>();
    for (const effective of effectiveSubscriberTraffic.values()) {
      if (!effective.oltId) continue;
      oltDownstreamMbpsById.set(
        effective.oltId,
        Number(((oltDownstreamMbpsById.get(effective.oltId) ?? 0) + (effective.downstreamMbps ?? 0)).toFixed(2))
      );
      oltUpstreamMbpsById.set(
        effective.oltId,
        Number(((oltUpstreamMbpsById.get(effective.oltId) ?? 0) + (effective.upstreamMbps ?? 0)).toFixed(2))
      );
      if (!effective.segmentId) continue;
      segmentTrafficById.set(effective.segmentId, {
        oltId: effective.oltId,
        downstreamMbps: Number(
          ((segmentTrafficById.get(effective.segmentId)?.downstreamMbps ?? 0) + (effective.downstreamMbps ?? 0)).toFixed(2)
        ),
      });
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
      let downstreamMbps = 0;
      let upstreamMbps = 0;
      let trafficLoad = 0;
      let trafficProfile: MetricPoint["trafficProfile"] | undefined;
      let segmentId: string | null | undefined;

      if (!isProvisioned && isSubscriberDeviceType(normalizedType)) {
        trafficMbps = 0;
        downstreamMbps = 0;
        upstreamMbps = 0;
        trafficLoad = 0;
        trafficProfile = {
          voice_mbps: 0,
          iptv_mbps: 0,
          internet_mbps: 0,
        };
        segmentId =
          normalizedType === "AON_CPE"
            ? null
            : (resolveSubscriberSegment(device.id, adjacency, typeById, passiveInlineTypes)?.segmentId ?? null);
      } else if (isSubscriberDeviceType(normalizedType)) {
        const effective = effectiveSubscriberTraffic.get(device.id) ?? {
          segmentId:
            normalizedType === "AON_CPE"
              ? null
              : (resolveSubscriberSegment(device.id, adjacency, typeById, passiveInlineTypes)?.segmentId ?? null),
          oltId: null,
          voiceMbps: 0,
          iptvMbps: 0,
          internetMbps: 0,
          downstreamMbps: 0,
          upstreamMbps: 0,
          totalMbps: 0,
        };
        trafficMbps = effective.totalMbps;
        downstreamMbps = effective.downstreamMbps ?? effective.totalMbps;
        upstreamMbps = effective.upstreamMbps ?? 0;
        trafficLoad = Math.min(
          100,
          Math.max(
            0,
            Number((Math.max(downstreamMbps, upstreamMbps) / leafAccessCapacityMbps * 100).toFixed(0))
          )
        );
        trafficProfile = {
          voice_mbps: effective.voiceMbps,
          iptv_mbps: effective.iptvMbps,
          internet_mbps: effective.internetMbps,
        };
        segmentId = effective.segmentId;
      } else if (normalizedType === "OLT") {
        downstreamMbps = Number((oltDownstreamMbpsById.get(device.id) ?? 0).toFixed(2));
        upstreamMbps = Number((oltUpstreamMbpsById.get(device.id) ?? 0).toFixed(2));
        trafficMbps = Number((downstreamMbps + upstreamMbps).toFixed(2));
        trafficLoad = Math.min(
          100,
          Math.max(
            0,
            Number((Math.max(downstreamMbps / gponDownstreamCapacityMbps, upstreamMbps / 1250) * 100).toFixed(0))
          )
        );
      } else {
        const trafficBase = 35;
        trafficLoad = Math.min(100, Math.max(0, Math.round(trafficBase + (noise * 40 - 20))));
        trafficMbps = Number(((trafficLoad / 100) * leafAccessCapacityMbps).toFixed(2));
        downstreamMbps = Number((trafficMbps * 0.7).toFixed(2));
        upstreamMbps = Number((trafficMbps * 0.3).toFixed(2));
      }

      const update: MetricPoint = {
        id: device.id,
        trafficLoad,
        trafficMbps,
        downstreamMbps,
        upstreamMbps,
        ...(trafficProfile ? { trafficProfile } : {}),
        ...(segmentId !== undefined ? { segmentId } : {}),
        rxPower,
        status,
        tick_seq: metricTickSeq,
        metric_tick_seq: metricTickSeq,
      };
      latestMetrics.set(device.id, update);
      const isChanged =
        !previous ||
        previous.status !== update.status ||
        previous.trafficLoad !== update.trafficLoad ||
        (previous.trafficMbps ?? 0) !== (update.trafficMbps ?? 0) ||
        (previous.downstreamMbps ?? 0) !== (update.downstreamMbps ?? 0) ||
        (previous.upstreamMbps ?? 0) !== (update.upstreamMbps ?? 0) ||
        Math.abs(previous.rxPower - update.rxPower) >= 0.1;
      if (isChanged) {
        updates.push(update);
      }
      if (!previous || previous.status !== update.status) {
        statusUpdates.push({ id: update.id, status: update.status });
      }
    }

    if (updates.length > 0) {
      emitEvent("deviceMetricsUpdated", { tick_seq: metricTickSeq, tick: metricTickSeq, items: updates }, false, `sim-${metricTickSeq}`);
      emitEvent(
        "deviceSignalUpdated",
        {
          tick_seq: metricTickSeq,
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
          tick_seq: metricTickSeq,
          tick: metricTickSeq,
          items: statusUpdates,
        },
        false,
        `sim-${metricTickSeq}`
      );
    }

    for (const [segmentId, state] of segmentTrafficById.entries()) {
      const { oltId } = state;
      const utilization = Number((state.downstreamMbps / gponDownstreamCapacityMbps).toFixed(4));
      const isCongested = segmentCongestionState.get(segmentId) ?? false;
      if (!isCongested && utilization >= 0.95) {
        segmentCongestionState.set(segmentId, true);
        emitEvent(
          "segmentCongestionDetected",
          { segmentId, oltId, utilization, tick_seq: metricTickSeq, tick: metricTickSeq },
          false,
          `sim-${metricTickSeq}`
        );
      } else if (isCongested && utilization <= 0.85) {
        segmentCongestionState.set(segmentId, false);
        emitEvent(
          "segmentCongestionCleared",
          { segmentId, oltId, utilization, tick_seq: metricTickSeq, tick: metricTickSeq },
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

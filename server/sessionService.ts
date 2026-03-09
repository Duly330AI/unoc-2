type SessionServiceDeps = {
  prisma: any;
  normalizeDeviceType: (input: string) => string | undefined;
  isSubscriberDeviceType: (type: string) => boolean;
  buildDeviceAdjacency: (deviceIds: string[], links: any[]) => Map<string, string[]>;
  buildPassabilityState: <
    TDevice extends { id: string; type: string; status: string; provisioned?: boolean | null },
    TLink extends { status: string; sourcePort: { deviceId: string }; targetPort: { deviceId: string } }
  >(
    devices: TDevice[],
    links: TLink[]
  ) => {
    adjacency: Map<string, string[]>;
    typeById: Map<string, string>;
    statusById: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">;
    provisionedById: Map<string, boolean>;
  };
  hasSubscriberUpstreamViability: (
    deviceId: string,
    subscriberType: string,
    bngDeviceId: string | null,
    adjacency: Map<string, string[]>,
    typeById: Map<string, string>,
    statusById: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">,
    provisionedById: Map<string, boolean>,
    deps: { passableInlineTypes: Set<string>; routerClassTypes: Set<string> }
  ) => boolean;
  findServingOltForLeaf: (
    leafId: string,
    adjacency: Map<string, string[]>,
    typeById: Map<string, any>,
    passiveInlineTypes: Set<string>
  ) => string | null;
  passiveInlineTypes: Set<string>;
  routerClassTypes: Set<string>;
  parseIpv4Cidr: (cidr: string) => { networkAddress: number; broadcastAddress: number };
  deterministicPrivateIp: (sessionId: string) => string;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  tariffs: Array<{
    id: string;
    name: string;
    type: string;
    downstream_mbps: number | null;
    upstream_mbps: number | null;
  }>;
  sessionStates: Record<string, string>;
  serviceStatuses: Record<string, string>;
  reasonCodes: Record<string, string>;
  cgnatPublicCidr: string;
  cgnatPortRangeStart: number;
  cgnatPortsPerSubscriber: number;
  cgnatRetentionDays: number;
  defaultLeaseSeconds: number;
};

export const createSessionService = ({
  prisma,
  normalizeDeviceType,
  isSubscriberDeviceType,
  buildDeviceAdjacency,
  buildPassabilityState,
  hasSubscriberUpstreamViability,
  findServingOltForLeaf,
  passiveInlineTypes,
  routerClassTypes,
  parseIpv4Cidr,
  deterministicPrivateIp,
  emitEvent,
  tariffs,
  sessionStates,
  serviceStatuses,
  reasonCodes,
  cgnatPublicCidr,
  cgnatPortRangeStart,
  cgnatPortsPerSubscriber,
  cgnatRetentionDays,
  defaultLeaseSeconds,
}: SessionServiceDeps) => {
  const deriveSessionTariff = (deviceType: string, serviceType: string) => {
    if (serviceType !== "INTERNET") return null;

    const normalizedDeviceType = normalizeDeviceType(deviceType);
    let tariffType = "private";
    if (normalizedDeviceType === "BUSINESS_ONT") tariffType = "business";
    if (normalizedDeviceType === "AON_CPE") tariffType = "aon";

    const tariff = tariffs.find((candidate) => candidate.type === tariffType) ?? tariffs[0];
    if (!tariff) return null;

    return {
      id: tariff.id,
      name: tariff.name,
      max_down: tariff.downstream_mbps,
      max_up: tariff.upstream_mbps,
    };
  };

  const allocateCgnatSlot = (mappingCount: number) => {
    const parsedCidr = parseIpv4Cidr(cgnatPublicCidr);
    const blocksPerPublicIp = Math.floor((65536 - cgnatPortRangeStart) / cgnatPortsPerSubscriber);
    const usablePublicIps = parsedCidr.broadcastAddress - parsedCidr.networkAddress - 1;
    const maxMappings = usablePublicIps * blocksPerPublicIp;
    if (mappingCount >= maxMappings) {
      throw Object.assign(new Error("CGNAT pool exhausted"), { code: "CGNAT_POOL_EXHAUSTED" });
    }

    const publicIpOffset = Math.floor(mappingCount / blocksPerPublicIp) + 1;
    const blockIndex = mappingCount % blocksPerPublicIp;
    const portRangeStart = cgnatPortRangeStart + blockIndex * cgnatPortsPerSubscriber;
    const portRangeEnd = portRangeStart + cgnatPortsPerSubscriber - 1;

    return {
      publicIp: `198.51.100.${publicIpOffset}`,
      portRangeStart,
      portRangeEnd,
    };
  };

  const createCgnatMappingForSession = async (tx: any, session: { id: string; ipv4Address: string | null }) => {
    const existing = await tx.cgnatMapping.findFirst({
      where: {
        sessionId: session.id,
        timestampEnd: null,
      },
      orderBy: { timestampStart: "desc" },
    });
    if (existing) return { mapping: existing, created: false as const };

    const mappingCount = await tx.cgnatMapping.count();
    const slot = allocateCgnatSlot(mappingCount);
    const timestampStart = new Date();
    const retentionExpires = new Date(timestampStart.getTime() + cgnatRetentionDays * 24 * 60 * 60 * 1000);
    const mapping = await tx.cgnatMapping.create({
      data: {
        sessionId: session.id,
        publicIp: slot.publicIp,
        privateIp: session.ipv4Address ?? deterministicPrivateIp(session.id),
        portRangeStart: slot.portRangeStart,
        portRangeEnd: slot.portRangeEnd,
        timestampStart,
        retentionExpires,
      },
    });

    return { mapping, created: true as const };
  };

  const closeOpenCgnatMappings = async (tx: any, sessionIds: string[], closedAt = new Date()) => {
    if (sessionIds.length === 0) return;
    await tx.cgnatMapping.updateMany({
      where: {
        sessionId: { in: sessionIds },
        timestampEnd: null,
      },
      data: {
        timestampEnd: closedAt,
      },
    });
  };

  const resolveServingOltForDevice = async (tx: any, deviceId: string) => {
    const [devices, links] = await Promise.all([
      tx.device.findMany({ select: { id: true, type: true } }),
      tx.link.findMany({
        include: {
          sourcePort: { select: { deviceId: true } },
          targetPort: { select: { deviceId: true } },
        },
      }),
    ]);

    const typeById = new Map<string, any>();
    for (const device of devices) {
      const normalized = normalizeDeviceType(device.type);
      if (!normalized) continue;
      typeById.set(device.id, normalized);
    }

    const adjacency = buildDeviceAdjacency(
      devices.map((device: any) => device.id),
      links
    );

    return findServingOltForLeaf(deviceId, adjacency, typeById, passiveInlineTypes);
  };

  const ensureSessionVlanPathValid = async (
    tx: any,
    session: { interfaceId: string; serviceType: string }
  ) => {
    const subscriberInterface = await tx.interface.findUnique({
      where: { id: session.interfaceId },
      include: { device: true },
    });
    if (!subscriberInterface) {
      throw Object.assign(new Error("Interface not found"), { code: "INTERFACE_NOT_FOUND" });
    }

    const subscriberType = normalizeDeviceType(subscriberInterface.device.type);
    if (subscriberType === "AON_CPE") {
      return;
    }

    if (subscriberType !== "ONT" && subscriberType !== "BUSINESS_ONT") {
      return;
    }

    const oltId = await resolveServingOltForDevice(tx, subscriberInterface.deviceId);
    if (!oltId) {
      throw Object.assign(new Error("No serving OLT found for subscriber"), { code: "VLAN_PATH_INVALID" });
    }

    const mapping = await tx.oltVlanTranslation.findFirst({
      where: {
        deviceId: oltId,
        serviceType: session.serviceType,
      },
      orderBy: [{ cTag: "asc" }, { id: "asc" }],
    });

    if (!mapping) {
      throw Object.assign(new Error("No VLAN translation mapping for subscriber service"), { code: "VLAN_PATH_INVALID" });
    }
  };

  const toRealtimeSessionPayload = (session: any) => ({
    session_id: session.id,
    interface_id: session.interfaceId,
    bng_device_id: session.bngDeviceId,
    service_type: session.serviceType,
    state: session.state,
    infra_status: session.infraStatus,
    service_status: session.serviceStatus,
    reason_code: session.reasonCode,
  });

  const cascadeBngFailure = async (deviceId: string, newStatus: string) => {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) return [];
    if (normalizeDeviceType(device.type) !== "EDGE_ROUTER") return [];
    if (newStatus !== "DOWN") return [];

    const affectedSessions = await prisma.$transaction(async (tx: any) => {
      const sessions = await tx.subscriberSession.findMany({
        where: {
          bngDeviceId: deviceId,
          state: {
            notIn: [sessionStates.EXPIRED, sessionStates.RELEASED],
          },
        },
      });

      if (sessions.length === 0) {
        return [];
      }

      await tx.subscriberSession.updateMany({
        where: {
          id: { in: sessions.map((session: any) => session.id) },
        },
        data: {
          state: sessionStates.EXPIRED,
          serviceStatus: serviceStatuses.DOWN,
          reasonCode: reasonCodes.BNG_UNREACHABLE,
        },
      });

      await closeOpenCgnatMappings(
        tx,
        sessions.map((session: any) => session.id)
      );

      return sessions.map((session: any) => ({
        ...session,
        state: sessionStates.EXPIRED,
        serviceStatus: serviceStatuses.DOWN,
        reasonCode: reasonCodes.BNG_UNREACHABLE,
      }));
    });

    for (const session of affectedSessions) {
      emitEvent("subscriberSessionUpdated", toRealtimeSessionPayload(session));
    }

    return affectedSessions;
  };

  const recoverBngSessions = async (deviceId: string, newStatus: string) => {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) return [];
    if (normalizeDeviceType(device.type) !== "EDGE_ROUTER") return [];
    if (newStatus !== "UP") return [];

    let createdMappings: Array<{
      id: string;
      publicIp: string;
      portRangeStart: number;
      portRangeEnd: number;
      sessionId: string;
    }> = [];

    const recoveredSessions = await prisma.$transaction(async (tx: any) => {
      const candidateSessions = await tx.subscriberSession.findMany({
        where: {
          bngDeviceId: deviceId,
          state: sessionStates.EXPIRED,
          reasonCode: reasonCodes.BNG_UNREACHABLE,
        },
        include: {
          interface: {
            include: {
              device: true,
            },
          },
        },
      });

      if (candidateSessions.length === 0) {
        return [];
      }

      const [devices, links] = await Promise.all([
        tx.device.findMany({ select: { id: true, type: true, status: true, provisioned: true } }),
        tx.link.findMany({
          include: {
            sourcePort: { select: { deviceId: true } },
            targetPort: { select: { deviceId: true } },
          },
        }),
      ]);

      const snapshot = buildPassabilityState(devices, links);
      const now = new Date();
      const leaseExpires = new Date(now.getTime() + defaultLeaseSeconds * 1000);
      const recovered: any[] = [];

      for (const session of candidateSessions) {
        const subscriberType = normalizeDeviceType(session.interface.device.type);
        if (!subscriberType || !isSubscriberDeviceType(subscriberType)) {
          continue;
        }

        const upstreamOk = hasSubscriberUpstreamViability(
          session.interface.deviceId,
          subscriberType,
          session.bngDeviceId,
          snapshot.adjacency,
          snapshot.typeById,
          snapshot.statusById,
          snapshot.provisionedById,
          {
            passableInlineTypes: passiveInlineTypes,
            routerClassTypes,
          }
        );
        if (!upstreamOk) {
          continue;
        }

        try {
          await ensureSessionVlanPathValid(tx, session);
        } catch (error) {
          const errorCode = (error as { code?: string } | null)?.code;
          if (errorCode === "VLAN_PATH_INVALID") {
            continue;
          }
          throw error;
        }

        const updatedSession = await tx.subscriberSession.update({
          where: { id: session.id },
          data: {
            state: sessionStates.ACTIVE,
            infraStatus: "UP",
            serviceStatus: serviceStatuses.UP,
            reasonCode: null,
            leaseStart: now,
            leaseExpires,
          },
        });

        const mappingResult = await createCgnatMappingForSession(tx, updatedSession);
        if (mappingResult.created) {
          createdMappings.push({
            id: mappingResult.mapping.id,
            publicIp: mappingResult.mapping.publicIp,
            portRangeStart: mappingResult.mapping.portRangeStart,
            portRangeEnd: mappingResult.mapping.portRangeEnd,
            sessionId: mappingResult.mapping.sessionId,
          });
        }

        recovered.push(updatedSession);
      }

      return recovered;
    });

    for (const session of recoveredSessions) {
      emitEvent("subscriberSessionUpdated", toRealtimeSessionPayload(session));
    }
    for (const mapping of createdMappings) {
      emitEvent("cgnatMappingCreated", {
        mapping_id: mapping.id,
        session_id: mapping.sessionId,
        public_ip: mapping.publicIp,
        port_range: `${mapping.portRangeStart}-${mapping.portRangeEnd}`,
      });
    }

    return recoveredSessions;
  };

  const expireLeasedOutSessions = async (now = new Date()) => {
    const expiredSessions = await prisma.$transaction(async (tx: any) => {
      const sessions = await tx.subscriberSession.findMany({
        where: {
          state: sessionStates.ACTIVE,
          leaseExpires: { lt: now },
        },
      });

      if (sessions.length === 0) {
        return [];
      }

      await tx.subscriberSession.updateMany({
        where: {
          id: { in: sessions.map((session: any) => session.id) },
        },
        data: {
          state: sessionStates.EXPIRED,
          serviceStatus: serviceStatuses.DOWN,
          reasonCode: reasonCodes.SESSION_EXPIRED,
        },
      });

      await closeOpenCgnatMappings(
        tx,
        sessions.map((session: any) => session.id),
        now
      );

      return sessions.map((session: any) => ({
        ...session,
        state: sessionStates.EXPIRED,
        serviceStatus: serviceStatuses.DOWN,
        reasonCode: reasonCodes.SESSION_EXPIRED,
      }));
    });

    for (const session of expiredSessions) {
      emitEvent("subscriberSessionUpdated", toRealtimeSessionPayload(session));
    }

    return expiredSessions;
  };

  return {
    deriveSessionTariff,
    createCgnatMappingForSession,
    closeOpenCgnatMappings,
    ensureSessionVlanPathValid,
    cascadeBngFailure,
    recoverBngSessions,
    expireLeasedOutSessions,
  };
};

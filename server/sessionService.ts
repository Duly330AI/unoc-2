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
  subscriberIpv4Supernet: string;
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
  subscriberIpv4Supernet,
}: SessionServiceDeps) => {
  const ipv4ToInt = (ip: string) =>
    ip
      .split(".")
      .map((octet) => Number(octet))
      .reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0;

  const intToIpv4 = (value: number) =>
    [24, 16, 8, 0]
      .map((shift) => ((value >>> shift) & 255).toString(10))
      .join(".");

  const isIpInCidr = (ip: string, cidr: string) => {
    const ipInt = ipv4ToInt(ip);
    const { networkAddress, broadcastAddress } = parseIpv4Cidr(cidr);
    return ipInt >= networkAddress && ipInt <= broadcastAddress;
  };

  const allocateNextIpInCidr = (cidr: string, allocatedIps: string[]) => {
    const { networkAddress, broadcastAddress, prefixLen } = parseIpv4Cidr(cidr) as ReturnType<typeof parseIpv4Cidr> & {
      prefixLen?: number;
    };
    const usableStart = prefixLen && prefixLen >= 31 ? networkAddress : networkAddress + 1;
    const usableEnd = prefixLen && prefixLen >= 31 ? broadcastAddress : broadcastAddress - 1;
    const allocated = new Set(allocatedIps.map((ip) => ipv4ToInt(ip)));
    for (let current = usableStart; current <= usableEnd; current += 1) {
      if (!allocated.has(current)) {
        return intToIpv4(current);
      }
    }
    return null;
  };

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

  const ensureSubscriberIpv4Pool = async (tx: any, bngDeviceId: string) => {
    const existingPool = await tx.ipPool.findFirst({
      where: {
        bngDeviceId,
        type: "SUBSCRIBER_IPV4",
      },
      orderBy: [{ id: "asc" }],
    });
    if (existingPool) {
      return existingPool;
    }

    const vrf = await tx.vrf.upsert({
      where: { name: "internet_vrf" },
      update: {},
      create: {
        name: "internet_vrf",
        description: "Subscriber internet routing table",
      },
    });

    const existingPools = await tx.ipPool.findMany({
      where: { type: "SUBSCRIBER_IPV4" },
      select: { cidr: true },
      orderBy: [{ poolKey: "asc" }],
    });

    const usedCidrs = new Set(existingPools.map((pool: { cidr: string }) => pool.cidr));
    const { networkAddress, broadcastAddress } = parseIpv4Cidr(subscriberIpv4Supernet);
    let selectedCidr: string | null = null;
    for (let current = networkAddress; current <= broadcastAddress; current += 256) {
      const candidate = `${intToIpv4(current)}/24`;
      if (!usedCidrs.has(candidate)) {
        selectedCidr = candidate;
        break;
      }
    }

    if (!selectedCidr) {
      throw Object.assign(new Error("Subscriber IPv4 pool exhausted"), { code: "SESSION_POOL_EXHAUSTED" });
    }

    return tx.ipPool.create({
      data: {
        name: `Subscriber IPv4 ${bngDeviceId}`,
        poolKey: `sub_ipv4:${bngDeviceId}`,
        type: "SUBSCRIBER_IPV4",
        cidr: selectedCidr,
        vrfId: vrf.id,
        bngDeviceId,
      },
    });
  };

  const allocateSubscriberIpv4ForSession = async (
    tx: any,
    session: { id: string; bngDeviceId: string | null; ipv4Address?: string | null }
  ) => {
    if (!session.bngDeviceId) {
      throw Object.assign(new Error("Session missing BNG device"), { code: "BNG_UNREACHABLE" });
    }

    const pool = await ensureSubscriberIpv4Pool(tx, session.bngDeviceId);
    if (session.ipv4Address && isIpInCidr(session.ipv4Address, pool.cidr)) {
      return {
        pool,
        ipv4Address: session.ipv4Address,
      };
    }

    const allocatedSessions = await tx.subscriberSession.findMany({
      where: {
        bngDeviceId: session.bngDeviceId,
        ipv4Address: { not: null },
      },
      select: { ipv4Address: true },
      orderBy: [{ ipv4Address: "asc" }],
    });

    const nextIp = allocateNextIpInCidr(
      pool.cidr,
      allocatedSessions
        .map((entry: { ipv4Address: string | null }) => entry.ipv4Address)
        .filter((ip: string | null): ip is string => Boolean(ip))
    );
    if (!nextIp) {
      throw Object.assign(new Error("Subscriber pool exhausted"), { code: "SESSION_POOL_EXHAUSTED" });
    }

    return {
      pool,
      ipv4Address: nextIp,
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
        ontId: subscriberInterface.deviceId,
        serviceType: session.serviceType,
        enabled: true,
      },
      orderBy: [{ cTag: "asc" }, { id: "asc" }],
    });

    if (!mapping) {
      throw Object.assign(new Error("No VLAN translation mapping for subscriber service"), { code: "VLAN_PATH_INVALID" });
    }
  };

  const validateVlanPath = async (
    tx: any,
    payload: { deviceId: string; serviceType: string; cTag: number; sTag?: number | null }
  ) => {
    const subscriberDevice = await tx.device.findUnique({
      where: { id: payload.deviceId },
    });

    if (!subscriberDevice) {
      return {
        valid: false,
        reason_code: "DEVICE_NOT_FOUND",
        serving_olt_id: null,
      };
    }

    const subscriberType = normalizeDeviceType(subscriberDevice.type);
    if (subscriberType === "AON_CPE") {
      return {
        valid: true,
        reason_code: null,
        serving_olt_id: null,
      };
    }

    if (subscriberType !== "ONT" && subscriberType !== "BUSINESS_ONT") {
      return {
        valid: false,
        reason_code: "VLAN_PATH_INVALID",
        serving_olt_id: null,
      };
    }

    const oltId = await resolveServingOltForDevice(tx, payload.deviceId);
    if (!oltId) {
      return {
        valid: false,
        reason_code: "NO_SERVING_OLT",
        serving_olt_id: null,
      };
    }

    const mapping = await tx.oltVlanTranslation.findFirst({
      where: {
        deviceId: oltId,
        ontId: payload.deviceId,
        cTag: payload.cTag,
        serviceType: payload.serviceType,
        enabled: true,
        ...(payload.sTag != null ? { sTag: payload.sTag } : {}),
      },
      orderBy: [{ id: "asc" }],
    });

    if (!mapping) {
      return {
        valid: false,
        reason_code: "VLAN_PATH_INVALID",
        serving_olt_id: oltId,
      };
    }

    return {
      valid: true,
      reason_code: null,
      serving_olt_id: oltId,
    };
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
    ipv4_address: session.ipv4Address ?? null,
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
          ipv4Address: null,
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
            ipv4Address: (await allocateSubscriberIpv4ForSession(tx, session)).ipv4Address,
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
          ipv4Address: null,
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
    allocateSubscriberIpv4ForSession,
    closeOpenCgnatMappings,
    ensureSessionVlanPathValid,
    validateVlanPath,
    cascadeBngFailure,
    recoverBngSessions,
    expireLeasedOutSessions,
  };
};

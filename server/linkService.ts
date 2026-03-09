type LinkCreatePayload = {
  a_interface_id: string;
  b_interface_id: string;
  length_km?: number;
  physical_medium_id?: string;
};

type BatchCreatePayload = {
  request_id?: string;
  dry_run?: boolean;
  links: Array<{
    a_interface_id: string;
    b_interface_id: string;
    length_km?: number;
    physical_medium_id?: string;
  }>;
};

type LinkServiceDeps = {
  prisma: any;
  isContainerType: (type: string) => boolean;
  isOltOntPair: (a: string, b: string) => boolean;
  normalizeDeviceType: (input: string) => string | undefined;
  routerClassTypes: Set<string>;
  fiberTypeDbPerKm: Record<string, number>;
  isIpInCidr: (ip: string, cidr: string) => boolean;
  parseIpv4Cidr: (cidr: string) => { networkAddress: number; broadcastAddress: number };
  ipv4ToInt: (ip: string) => number;
  intToIpv4: (value: number) => string;
  buildInterfaceName: (portType: string, portNumber: number) => string;
  canonicalPortRole: (portType: string) => string | null;
  buildSyntheticMac: (deviceId: string, portNumber: number) => string;
  createIpAddressWithPrimaryGuard: (
    tx: any,
    data: {
      interfaceId: string;
      ip: string;
      prefixLen: number;
      isPrimary: boolean;
      vrf: string;
    }
  ) => Promise<unknown>;
  bumpTopologyVersion: () => number;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
};

export const createLinkService = ({
  prisma,
  isContainerType,
  isOltOntPair,
  normalizeDeviceType,
  routerClassTypes,
  fiberTypeDbPerKm,
  isIpInCidr,
  parseIpv4Cidr,
  ipv4ToInt,
  intToIpv4,
  buildInterfaceName,
  canonicalPortRole,
  buildSyntheticMac,
  createIpAddressWithPrimaryGuard,
  bumpTopologyVersion,
  emitEvent,
}: LinkServiceDeps) => {
  const validateLinkCreation = async (
    sourcePortId: string,
    targetPortId: string,
    db: any = prisma
  ) => {
    if (sourcePortId === targetPortId) {
      return {
        ok: false as const,
        status: 400,
        code: "VALIDATION_ERROR",
        message: "a_interface_id and b_interface_id must be different",
      };
    }

    const [sourcePort, targetPort] = await Promise.all([
      db.port.findUnique({ where: { id: sourcePortId }, include: { device: true } }),
      db.port.findUnique({ where: { id: targetPortId }, include: { device: true } }),
    ]);

    if (!sourcePort || !targetPort) {
      return {
        ok: false as const,
        status: 404,
        code: "INTERFACE_NOT_FOUND",
        message: "Source or target port not found",
      };
    }

    if (sourcePort.deviceId === targetPort.deviceId) {
      return {
        ok: false as const,
        status: 400,
        code: "INTERFACE_SAME_DEVICE",
        message: "Interfaces on the same device cannot be linked",
      };
    }

    if (isContainerType(sourcePort.device.type) || isContainerType(targetPort.device.type)) {
      return {
        ok: false as const,
        status: 400,
        code: "INVALID_LINK_TYPE",
        message: "Container endpoints are not valid link endpoints",
      };
    }

    if (isOltOntPair(sourcePort.device.type, targetPort.device.type)) {
      return {
        ok: false as const,
        status: 400,
        code: "INVALID_LINK_TYPE",
        message: "Direct OLT<->ONT links are forbidden in MVP",
      };
    }

    const occupied = await db.link.findFirst({
      where: {
        OR: [
          { sourcePortId },
          { targetPortId: sourcePortId },
          { sourcePortId: targetPortId },
          { targetPortId },
        ],
      },
    });

    if (occupied) {
      return {
        ok: false as const,
        status: 409,
        code: "INTERFACE_ALREADY_LINKED",
        message: "Port already occupied",
      };
    }

    return { ok: true as const, sourcePort, targetPort };
  };

  const getOrCreateVrf = async (tx: any, name: string, description: string) => {
    const existing = await tx.vrf.findUnique({ where: { name } });
    if (existing) return existing;
    return tx.vrf.create({
      data: {
        name,
        description,
      },
    });
  };

  const getOrCreatePortBackedInterface = async (
    tx: any,
    port: { deviceId: string; portNumber: number; portType: string; status: string }
  ) => {
    const name = buildInterfaceName(port.portType, port.portNumber);
    const existing = await tx.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: port.deviceId,
          name,
        },
      },
      include: { addresses: true },
    });
    if (existing) return existing;

    return tx.interface.create({
      data: {
        deviceId: port.deviceId,
        name,
        role:
          canonicalPortRole(port.portType) === "MANAGEMENT"
            ? "MGMT"
            : (canonicalPortRole(port.portType) ?? port.portType.toUpperCase()),
        status: port.status,
        macAddress: buildSyntheticMac(port.deviceId, port.portNumber),
      },
      include: { addresses: true },
    });
  };

  const allocateNextP2pPairInCidr = (cidr: string, allocatedIps: string[]) => {
    const { networkAddress, broadcastAddress } = parseIpv4Cidr(cidr);
    const allocated = new Set(allocatedIps.map((ip) => ipv4ToInt(ip)));

    for (let candidate = networkAddress; candidate + 1 <= broadcastAddress; candidate += 2) {
      if (!allocated.has(candidate) && !allocated.has(candidate + 1)) {
        return {
          firstIp: intToIpv4(candidate),
          secondIp: intToIpv4(candidate + 1),
          prefixLen: 31,
        };
      }
    }

    return null;
  };

  const createLinkInternal = async (payload: LinkCreatePayload) => {
    const validation = await validateLinkCreation(payload.a_interface_id, payload.b_interface_id);
    if (!validation.ok) {
      return validation;
    }

    const mediumId = payload.physical_medium_id ?? "G.652.D";
    if (fiberTypeDbPerKm[mediumId] === undefined) {
      return { ok: false as const, status: 400, code: "FIBER_TYPE_INVALID", message: `Invalid physical medium: ${mediumId}` };
    }

    const fiberLength = payload.length_km ?? 10;
    const sourceType = normalizeDeviceType(validation.sourcePort.device.type);
    const targetType = normalizeDeviceType(validation.targetPort.device.type);
    const isRouterPair =
      sourceType !== undefined &&
      targetType !== undefined &&
      routerClassTypes.has(sourceType) &&
      routerClassTypes.has(targetType);

    try {
      const link = await prisma.$transaction(async (tx: any) => {
        const txValidation = await validateLinkCreation(payload.a_interface_id, payload.b_interface_id, tx);
        if (!txValidation.ok) {
          throw Object.assign(new Error(txValidation.message), {
            code: txValidation.code,
            status: txValidation.status,
          });
        }

        if (isRouterPair) {
          const infraVrf = await getOrCreateVrf(tx, "infra_vrf", "Infrastructure transit VRF");
          let pool = await tx.ipPool.findUnique({ where: { poolKey: "p2p" } });
          if (!pool) {
            pool = await tx.ipPool.create({
              data: {
                name: "p2p",
                poolKey: "p2p",
                type: "P2P",
                cidr: "10.250.255.0/24",
                vrfId: infraVrf.id,
              },
            });
          }

          const allocatedP2pAddresses = await tx.ipAddress.findMany({
            select: { ip: true },
          });
          const filteredAllocatedIps = allocatedP2pAddresses
            .map((address: any) => address.ip)
            .filter((ip: string) => isIpInCidr(ip, pool.cidr));

          const nextPair = allocateNextP2pPairInCidr(pool.cidr, filteredAllocatedIps);
          if (!nextPair) {
            throw Object.assign(new Error("P2P supernet exhausted"), { code: "P2P_SUPERNET_EXHAUSTED", status: 409 });
          }

          const sourceInterface = await getOrCreatePortBackedInterface(tx, txValidation.sourcePort);
          const targetInterface = await getOrCreatePortBackedInterface(tx, txValidation.targetPort);

          const ordered = [
            { deviceId: txValidation.sourcePort.deviceId, interfaceId: sourceInterface.id },
            { deviceId: txValidation.targetPort.deviceId, interfaceId: targetInterface.id },
          ].sort((a, b) => a.deviceId.localeCompare(b.deviceId));

          const assignmentByInterfaceId = new Map<string, string>([
            [ordered[0].interfaceId, nextPair.firstIp],
            [ordered[1].interfaceId, nextPair.secondIp],
          ]);

          await createIpAddressWithPrimaryGuard(tx, {
            interfaceId: sourceInterface.id,
            ip: assignmentByInterfaceId.get(sourceInterface.id)!,
            prefixLen: nextPair.prefixLen,
            isPrimary: true,
            vrf: "infra_vrf",
          });
          await createIpAddressWithPrimaryGuard(tx, {
            interfaceId: targetInterface.id,
            ip: assignmentByInterfaceId.get(targetInterface.id)!,
            prefixLen: nextPair.prefixLen,
            isPrimary: true,
            vrf: "infra_vrf",
          });
        }

        return tx.link.create({
          data: {
            sourcePortId: payload.a_interface_id,
            targetPortId: payload.b_interface_id,
            fiberLength,
            fiberType: mediumId,
            status: "UP",
          },
          include: { sourcePort: true, targetPort: true },
        });
      });

      return { ok: true as const, link };
    } catch (error) {
      const code = (error as any)?.code;
      const status = (error as any)?.status;
      if (typeof code === "string" && typeof status === "number") {
        return { ok: false as const, status, code, message: (error as Error).message };
      }
      throw error;
    }
  };

  const reclaimRouterLinkInterfaces = async (
    tx: any,
    port: { deviceId: string; portNumber: number; portType: string }
  ) => {
    const name = buildInterfaceName(port.portType, port.portNumber);
    const iface = await tx.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: port.deviceId,
          name,
        },
      },
      include: { addresses: true, sessions: true },
    });
    if (!iface) return;

    const expectedMac = buildSyntheticMac(port.deviceId, port.portNumber);
    const canDeleteInterface =
      iface.sessions.length === 0 &&
      iface.macAddress === expectedMac &&
      iface.addresses.every((address: any) => address.vrf === "infra_vrf" && address.prefixLen === 31);

    if (canDeleteInterface) {
      await tx.interface.delete({ where: { id: iface.id } });
      return;
    }

    await tx.ipAddress.deleteMany({
      where: {
        interfaceId: iface.id,
        vrf: "infra_vrf",
        prefixLen: 31,
      },
    });
  };

  const deleteLinkInternal = async (linkId: string) => {
    try {
      const link = await prisma.$transaction(async (tx: any) => {
        const existing = await tx.link.findUnique({
          where: { id: linkId },
          include: {
            sourcePort: { include: { device: true } },
            targetPort: { include: { device: true } },
          },
        });

        if (!existing) {
          throw Object.assign(new Error("Link not found"), {
            code: "LINK_NOT_FOUND",
            status: 404,
          });
        }

        const sourceType = normalizeDeviceType(existing.sourcePort.device.type);
        const targetType = normalizeDeviceType(existing.targetPort.device.type);
        const isRouterPair =
          sourceType !== undefined &&
          targetType !== undefined &&
          routerClassTypes.has(sourceType) &&
          routerClassTypes.has(targetType);

        await tx.link.delete({ where: { id: linkId } });

        if (isRouterPair) {
          await reclaimRouterLinkInterfaces(tx, existing.sourcePort);
          await reclaimRouterLinkInterfaces(tx, existing.targetPort);
        }

        return existing;
      });

      return { ok: true as const, link };
    } catch (error) {
      const code = (error as any)?.code;
      const status = (error as any)?.status;
      if (typeof code === "string" && typeof status === "number") {
        return { ok: false as const, status, code, message: (error as Error).message };
      }
      throw error;
    }
  };

  const runBatchCreate = async (payload: BatchCreatePayload) => {
    const startedAt = Date.now();
    const dryRun = payload.dry_run ?? false;
    const requestId = payload.request_id ?? null;
    const createdIds: string[] = [];
    const failedLinks: Array<{
      index: number;
      a_interface_id?: string;
      b_interface_id?: string;
      error_code: string;
      error_message: string;
    }> = [];

    for (let i = 0; i < payload.links.length; i += 1) {
      const candidate = payload.links[i];
      const a_interface_id = candidate.a_interface_id;
      const b_interface_id = candidate.b_interface_id;
      const physical_medium_id = candidate.physical_medium_id;

      if (dryRun) {
        const validation = await validateLinkCreation(a_interface_id, b_interface_id);
        if (!validation.ok) {
          failedLinks.push({
            index: i,
            a_interface_id,
            b_interface_id,
            error_code: validation.code,
            error_message: validation.message,
          });
        }
        continue;
      }

      const created = await createLinkInternal({
        a_interface_id,
        b_interface_id,
        length_km: candidate.length_km,
        physical_medium_id,
      });
      if (!created.ok) {
        failedLinks.push({
          index: i,
          a_interface_id,
          b_interface_id,
          error_code: created.code,
          error_message: created.message,
        });
        continue;
      }
      createdIds.push(created.link.id);
    }

    if (!dryRun && createdIds.length > 0) {
      bumpTopologyVersion();
      emitEvent("batchCompleted", { request_id: requestId, created_link_ids: createdIds, failed_links: failedLinks });
    }

    return {
      created_link_ids: createdIds,
      failed_links: failedLinks,
      total_requested: payload.links.length,
      total_created: createdIds.length,
      duration_ms: Date.now() - startedAt,
      request_id: requestId,
      backend: "native",
      dry_run: dryRun,
    };
  };

  return {
    validateLinkCreation,
    createLinkInternal,
    deleteLinkInternal,
    runBatchCreate,
  };
};

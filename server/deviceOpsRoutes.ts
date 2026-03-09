import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type DeviceOpsDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  parseOltVlanMapping: (body: unknown) => { cTag: number; sTag: number; serviceType: string };
  parseDeviceOverride: (body: unknown) => { admin_override_status: "UP" | "DOWN" | "DEGRADED" | "BLOCKING" | null };
  sendError: (
    res: express.Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) => express.Response;
  normalizeDeviceType: (input: string) => string | undefined;
  normalizeDeviceStatus: (input: string | null | undefined) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  provisionableTypes: Set<string>;
  passiveInlineTypes: Set<string>;
  deviceOverrides: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">;
  hasPathWithPolicy: (
    startId: string,
    adjacency: Map<string, string[]>,
    typeById: Map<string, any>,
    isTarget: (type: any) => boolean,
    isAllowedIntermediate: (type: any) => boolean
  ) => boolean;
  createIpAddressWithPrimaryGuard: (
    tx: any,
    payload: { interfaceId: string; ip: string; prefixLen: number; isPrimary: boolean; vrf: string }
  ) => Promise<unknown>;
  buildManagementInterfaceMac: (deviceId: string) => string;
  ipamRoleForDeviceType: (rawType: string) => string | null;
  getIpamPrefixForRole: (role: string) => { cidr: string } | null;
  isIpInCidr: (ip: string, cidr: string) => boolean;
  allocateNextIpInCidr: (cidr: string, allocatedIps: string[]) => { ip: string; prefixLen: number } | null;
  isManagementPortType: (portType: string) => boolean;
  bumpTopologyVersion: () => number;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  cascadeBngFailure: (deviceId: string, newStatus: string) => Promise<unknown>;
  recoverBngSessions: (deviceId: string, newStatus: string) => Promise<unknown>;
};

export const registerDeviceOpsRoutes = ({
  app,
  asyncRoute,
  prisma,
  parseOltVlanMapping,
  parseDeviceOverride,
  sendError,
  normalizeDeviceType,
  normalizeDeviceStatus,
  provisionableTypes,
  passiveInlineTypes,
  deviceOverrides,
  hasPathWithPolicy,
  createIpAddressWithPrimaryGuard,
  buildManagementInterfaceMac,
  ipamRoleForDeviceType,
  getIpamPrefixForRole,
  isIpInCidr,
  allocateNextIpInCidr,
  isManagementPortType,
  bumpTopologyVersion,
  emitEvent,
  cascadeBngFailure,
  recoverBngSessions,
}: DeviceOpsDeps) => {
  app.post(
    "/api/devices/:id/vlan-mappings",
    asyncRoute(async (req, res) => {
      const payload = parseOltVlanMapping(req.body);
      const id = req.params.id;
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      if (normalizeDeviceType(device.type) !== "OLT") {
        return sendError(res, 400, "VALIDATION_ERROR", "VLAN mappings can only be configured on OLT devices");
      }

      const existing = await prisma.oltVlanTranslation.findUnique({
        where: {
          deviceId_cTag: {
            deviceId: id,
            cTag: payload.cTag,
          },
        },
      });

      const mapping = await prisma.oltVlanTranslation.upsert({
        where: {
          deviceId_cTag: {
            deviceId: id,
            cTag: payload.cTag,
          },
        },
        update: {
          sTag: payload.sTag,
          serviceType: payload.serviceType.toUpperCase(),
        },
        create: {
          deviceId: id,
          cTag: payload.cTag,
          sTag: payload.sTag,
          serviceType: payload.serviceType.toUpperCase(),
        },
      });

      return res.status(existing ? 200 : 201).json(mapping);
    })
  );

  app.post(
    "/api/devices/:id/provision",
    asyncRoute(async (req, res) => {
      const id = req.params.id;
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      const normalized = normalizeDeviceType(device.type);
      if (!normalized) {
        return sendError(res, 400, "VALIDATION_ERROR", `Unsupported device type: ${device.type}`);
      }

      if (!provisionableTypes.has(normalized)) {
        return sendError(res, 400, "INVALID_PROVISION_PATH", `Device type ${normalized} is not provisionable in MVP`);
      }

      const [devices, links] = await Promise.all([
        prisma.device.findMany({ select: { id: true, type: true } }),
        prisma.link.findMany({
          include: {
            sourcePort: { select: { deviceId: true } },
            targetPort: { select: { deviceId: true } },
          },
        }),
      ]);

      const typeById = new Map<string, string>();
      for (const candidate of devices) {
        const candidateType = normalizeDeviceType(candidate.type);
        if (!candidateType) continue;
        typeById.set(candidate.id, candidateType);
      }

      const adjacency = new Map<string, string[]>();
      for (const candidate of devices) {
        adjacency.set(candidate.id, []);
      }
      for (const link of links) {
        const a = link.sourcePort.deviceId;
        const b = link.targetPort.deviceId;
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        adjacency.get(a)!.push(b);
        adjacency.get(b)!.push(a);
      }

      if (normalized === "ONT" || normalized === "BUSINESS_ONT") {
        const hasPathToOlt = hasPathWithPolicy(
          id,
          adjacency,
          typeById,
          (type) => type === "OLT",
          (type) => passiveInlineTypes.has(type)
        );

        if (!hasPathToOlt) {
          return sendError(
            res,
            400,
            "INVALID_PROVISION_PATH",
            "ONT provisioning requires strict reachable path to OLT via passive inline chain"
          );
        }
      }

      if (normalized === "AON_CPE") {
        const neighbors = adjacency.get(id) ?? [];
        const hasAonSwitchUpstream = neighbors.some((neighborId) => typeById.get(neighborId) === "AON_SWITCH");

        if (!hasAonSwitchUpstream) {
          return sendError(res, 400, "INVALID_PROVISION_PATH", "AON_CPE provisioning requires strict direct upstream link to AON_SWITCH");
        }
      }

      try {
        await prisma.$transaction(async (tx: any) => {
          const claim = await tx.device.updateMany({
            where: {
              id,
              provisioned: false,
            },
            data: {
              provisioned: true,
              status: "UP",
            } as any,
          });
          if (claim.count === 0) {
            throw Object.assign(new Error("Device already provisioned"), { code: "ALREADY_PROVISIONED" });
          }

          const current = await tx.device.findUnique({
            where: { id },
            include: {
              ports: true,
              interfaces: {
                include: { addresses: true },
              },
            },
          });
          if (!current) {
            throw Object.assign(new Error("Device not found"), { code: "DEVICE_NOT_FOUND" });
          }

          const mgmtPorts = current.ports.filter((port: any) => isManagementPortType(port.portType));
          if (mgmtPorts.length > 1) {
            throw Object.assign(new Error("Duplicate management interface"), { code: "DUPLICATE_MGMT_INTERFACE" });
          }

          if (mgmtPorts.length === 0) {
            await tx.port.create({
              data: { deviceId: id, portNumber: 99, portType: "MANAGEMENT", status: "UP" },
            });
          }

          let mgmtInterface =
            current.interfaces.find((candidate: any) => candidate.name === "mgmt0") ??
            (await tx.interface.findUnique({
              where: {
                deviceId_name: {
                  deviceId: id,
                  name: "mgmt0",
                },
              },
              include: { addresses: true },
            }));

          if (!mgmtInterface) {
            mgmtInterface = await tx.interface.create({
              data: {
                deviceId: id,
                name: "mgmt0",
                role: "MGMT",
                status: "UP",
                macAddress: buildManagementInterfaceMac(id),
              },
              include: { addresses: true },
            });
          }

          const poolKey = ipamRoleForDeviceType(current.type);
          if (!poolKey) {
            throw Object.assign(new Error("No IPAM pool mapped for device type"), { code: "POOL_EXHAUSTED" });
          }

          const poolConfig = getIpamPrefixForRole(poolKey);
          if (!poolConfig) {
            throw Object.assign(new Error(`Missing IPAM prefix config for pool ${poolKey}`), { code: "POOL_EXHAUSTED" });
          }

          let vrf = await tx.vrf.findUnique({ where: { name: "mgmt_vrf" } });
          if (!vrf) {
            vrf = await tx.vrf.create({
              data: {
                name: "mgmt_vrf",
                description: "Management VRF",
              },
            });
          }

          let pool = await tx.ipPool.findUnique({ where: { poolKey } });
          if (!pool) {
            pool = await tx.ipPool.create({
              data: {
                name: poolKey,
                poolKey,
                type: "MANAGEMENT",
                cidr: poolConfig.cidr,
                vrfId: vrf.id,
              },
            });
          }

          const existingPrimaryAddress = mgmtInterface.addresses.find(
            (address: any) => address.isPrimary && address.vrf === "mgmt_vrf"
          );

          if (!existingPrimaryAddress) {
            const addressesInPool = await tx.ipAddress.findMany({
              where: { vrf: "mgmt_vrf" },
              select: { ip: true },
            });

            const allocated = addressesInPool
              .map((address: any) => address.ip)
              .filter((ip: string) => isIpInCidr(ip, pool.cidr));

            const nextAddress = allocateNextIpInCidr(pool.cidr, allocated);
            if (!nextAddress) {
              throw Object.assign(new Error(`IP pool exhausted for ${poolKey}`), { code: "POOL_EXHAUSTED" });
            }

            await createIpAddressWithPrimaryGuard(tx, {
              interfaceId: mgmtInterface.id,
              ip: nextAddress.ip,
              prefixLen: nextAddress.prefixLen,
              isPrimary: true,
              vrf: "mgmt_vrf",
            });
          }
        });
      } catch (error) {
        const errorCode = (error as any)?.code;
        if (errorCode === "DEVICE_NOT_FOUND") {
          return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
        }
        if (errorCode === "ALREADY_PROVISIONED") {
          return sendError(res, 409, "ALREADY_PROVISIONED", "Device is already provisioned");
        }
        if (errorCode === "DUPLICATE_MGMT_INTERFACE") {
          return sendError(res, 400, "DUPLICATE_MGMT_INTERFACE", "Duplicate management interface");
        }
        if (errorCode === "POOL_EXHAUSTED") {
          return sendError(res, 409, "POOL_EXHAUSTED", "Management IP pool exhausted");
        }
        if (errorCode === "DUPLICATE_PRIMARY_IP") {
          return sendError(res, 409, "DUPLICATE_PRIMARY_IP", "Primary IP already exists for interface and VRF");
        }
        throw error;
      }

      bumpTopologyVersion();
      const refreshed = await prisma.device.findUniqueOrThrow({ where: { id }, include: { ports: true } });
      emitEvent("deviceProvisioned", { id: refreshed.id, ports: refreshed.ports.length });
      return res.json({ provisioned: true, id: refreshed.id, ports: refreshed.ports });
    })
  );

  app.patch(
    "/api/devices/:id/override",
    asyncRoute(async (req, res) => {
      const payload = parseDeviceOverride(req.body);
      const id = req.params.id;
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      if (payload.admin_override_status === null) {
        deviceOverrides.delete(id);
        emitEvent("deviceOverrideChanged", { id, override: null });
        return res.json({ id, admin_override_status: null, status: normalizeDeviceStatus(device.status) });
      }

      deviceOverrides.set(id, payload.admin_override_status);
      const mappedStatus = payload.admin_override_status;

      const updated = await prisma.device.update({
        where: { id },
        data: { status: mappedStatus },
        include: { ports: true },
      });

      await cascadeBngFailure(updated.id, mappedStatus);
      await recoverBngSessions(updated.id, mappedStatus);

      bumpTopologyVersion();
      emitEvent("deviceOverrideChanged", { id, override: payload.admin_override_status, status: mappedStatus });

      if (payload.admin_override_status === "UP") {
        const allDevices = await prisma.device.findMany({ select: { id: true, type: true } });
        const links = await prisma.link.findMany({
          include: {
            sourcePort: { select: { deviceId: true } },
            targetPort: { select: { deviceId: true } },
          },
        });

        const typeById = new Map<string, string>();
        for (const candidate of allDevices) {
          const candidateType = normalizeDeviceType(candidate.type);
          if (!candidateType) continue;
          typeById.set(candidate.id, candidateType);
        }

        const adjacency = new Map<string, string[]>();
        for (const candidate of allDevices) {
          adjacency.set(candidate.id, []);
        }
        for (const link of links) {
          const a = link.sourcePort.deviceId;
          const b = link.targetPort.deviceId;
          if (!adjacency.has(a)) adjacency.set(a, []);
          if (!adjacency.has(b)) adjacency.set(b, []);
          adjacency.get(a)!.push(b);
          adjacency.get(b)!.push(a);
        }

        const deviceType = normalizeDeviceType(updated.type);
        let hasRequiredPath = true;
        if (deviceType === "ONT" || deviceType === "BUSINESS_ONT") {
          hasRequiredPath = hasPathWithPolicy(
            id,
            adjacency,
            typeById,
            (type) => type === "OLT",
            (type) => passiveInlineTypes.has(type)
          );
        } else if (deviceType === "AON_CPE") {
          const neighbors = adjacency.get(id) ?? [];
          hasRequiredPath = neighbors.some((neighborId) => typeById.get(neighborId) === "AON_SWITCH");
        }

        if (!hasRequiredPath) {
          emitEvent("overrideConflict", {
            entity: "device",
            id,
            code: "OVERRIDE_CONFLICT",
            reason: "override_up_without_required_path",
          });
        }
      }
      return res.json({ id, admin_override_status: payload.admin_override_status, status: mappedStatus });
    })
  );
};

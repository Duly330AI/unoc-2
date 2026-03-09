import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type DeviceCreatePayload = {
  name: string;
  type: string;
  x: number;
  y: number;
  parentId?: string;
  bngClusterId?: string;
  bngAnchorId?: string;
};

type DevicePatchPayload = {
  name?: string;
  x?: number;
  y?: number;
  status?: "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  bngClusterId?: string | null;
  bngAnchorId?: string | null;
};

type DeviceMutationRouteDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  parseDeviceCreate: (body: unknown) => DeviceCreatePayload;
  parseDevicePatch: (body: unknown) => DevicePatchPayload;
  createPortsForDevice: (deviceId: string, type: any, options?: { includeManagement?: boolean }) => Promise<void>;
  deleteLinkInternal: (linkId: string) => Promise<
    | { ok: true; link: any }
    | { ok: false; status: number; code: string; message: string }
  >;
  cascadeBngFailure: (deviceId: string, newStatus: string) => Promise<unknown>;
  recoverBngSessions: (deviceId: string, newStatus: string) => Promise<unknown>;
  bumpTopologyVersion: () => number;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  normalizeDeviceStatus: (input: string | null | undefined) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  normalizeDeviceType: (input: string) => string | undefined;
  sendError: (
    res: express.Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) => express.Response;
};

export const registerDeviceMutationRoutes = ({
  app,
  asyncRoute,
  prisma,
  parseDeviceCreate,
  parseDevicePatch,
  createPortsForDevice,
  deleteLinkInternal,
  cascadeBngFailure,
  recoverBngSessions,
  bumpTopologyVersion,
  emitEvent,
  normalizeDeviceStatus,
  normalizeDeviceType,
  sendError,
}: DeviceMutationRouteDeps) => {
  const validateBngRoleFields = async (
    tx: any,
    payload: { type: string; bngClusterId?: string | null; bngAnchorId?: string | null }
  ) => {
    const wantsBngRole = Boolean(payload.bngClusterId || payload.bngAnchorId);
    const normalizedType = normalizeDeviceType(payload.type);

    if (!normalizedType) {
      return { ok: false as const, status: 400, code: "VALIDATION_ERROR", message: `Unsupported device type: ${payload.type}` };
    }

    if (wantsBngRole && normalizedType !== "EDGE_ROUTER") {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_DEVICE_ROLE",
        message: "BNG cluster or anchor fields are only valid on EDGE_ROUTER devices",
      };
    }

    if (!payload.bngAnchorId) {
      return { ok: true as const, normalizedType };
    }

    const anchor = await tx.device.findUnique({ where: { id: payload.bngAnchorId } });
    if (!anchor) {
      return { ok: false as const, status: 404, code: "DEVICE_NOT_FOUND", message: "BNG anchor device not found" };
    }

    const normalizedAnchorType = normalizeDeviceType(anchor.type);
    if (normalizedAnchorType !== "POP" && normalizedAnchorType !== "CORE_SITE") {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_BNG_ANCHOR",
        message: "BNG anchor must reference a POP or CORE_SITE device",
      };
    }

    return { ok: true as const, normalizedType };
  };

  app.post(
    "/api/devices",
    asyncRoute(async (req, res) => {
      const payload = parseDeviceCreate(req.body);

      let network = await prisma.network.findFirst();
      if (!network) {
        network = await prisma.network.create({ data: { name: "Default" } });
        const seed = await prisma.device.create({
          data: {
            networkId: network.id,
            name: "Backbone Gateway",
            type: "BACKBONE_GATEWAY",
            model: "ImplicitSeed",
            x: -240,
            y: -120,
            status: "UP",
            provisioned: true,
          } as any,
        });
        await createPortsForDevice(seed.id, "BACKBONE_GATEWAY", { includeManagement: true });
      }

      if (payload.type === "BACKBONE_GATEWAY") {
        const existingBackbone = await prisma.device.findFirst({
          where: { networkId: network.id, type: "BACKBONE_GATEWAY" },
        });
        if (existingBackbone) {
          return sendError(
            res,
            409,
            "ALREADY_EXISTS",
            "Backbone Gateway already exists in single-backbone mode",
            { existing_id: existingBackbone.id }
          );
        }
      }

      const bngValidation = await validateBngRoleFields(prisma, {
        type: payload.type,
        bngClusterId: payload.bngClusterId ?? null,
        bngAnchorId: payload.bngAnchorId ?? null,
      });
      if (!bngValidation.ok) {
        return sendError(res, bngValidation.status, bngValidation.code, bngValidation.message);
      }

      const created = await prisma.device.create({
        data: {
          networkId: network.id,
          name: payload.name,
          type: payload.type,
          model: "Generic",
          x: Math.round(payload.x),
          y: Math.round(payload.y),
          status: "DOWN",
          provisioned: false,
          ...(payload.bngClusterId ? { bngClusterId: payload.bngClusterId } : {}),
          ...(payload.bngAnchorId ? { bngAnchorId: payload.bngAnchorId } : {}),
        } as any,
      });

      await createPortsForDevice(created.id, payload.type, { includeManagement: false });

      const deviceWithPorts = await prisma.device.findUniqueOrThrow({ where: { id: created.id }, include: { ports: true } });

      bumpTopologyVersion();
      emitEvent("deviceCreated", { ...deviceWithPorts, status: normalizeDeviceStatus(deviceWithPorts.status) });
      res.status(201).json({ ...deviceWithPorts, status: normalizeDeviceStatus(deviceWithPorts.status) });
    })
  );

  app.patch(
    "/api/devices/:id",
    asyncRoute(async (req, res) => {
      const payload = parseDevicePatch(req.body);
      const id = req.params.id;

      const exists = await prisma.device.findUnique({ where: { id } });
      if (!exists) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      const bngValidation = await validateBngRoleFields(prisma, {
        type: exists.type,
        bngClusterId: payload.bngClusterId === undefined ? exists.bngClusterId : payload.bngClusterId,
        bngAnchorId: payload.bngAnchorId === undefined ? exists.bngAnchorId : payload.bngAnchorId,
      });
      if (!bngValidation.ok) {
        return sendError(res, bngValidation.status, bngValidation.code, bngValidation.message);
      }

      const updated = await prisma.device.update({
        where: { id },
        data: {
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.x !== undefined ? { x: Math.round(payload.x) } : {}),
          ...(payload.y !== undefined ? { y: Math.round(payload.y) } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
          ...(payload.bngClusterId !== undefined ? { bngClusterId: payload.bngClusterId } : {}),
          ...(payload.bngAnchorId !== undefined ? { bngAnchorId: payload.bngAnchorId } : {}),
        },
        include: { ports: true },
      });

      const normalizedStatus = normalizeDeviceStatus(updated.status);
      await cascadeBngFailure(updated.id, normalizedStatus);
      await recoverBngSessions(updated.id, normalizedStatus);

      bumpTopologyVersion();
      emitEvent("deviceUpdated", { ...updated, status: normalizeDeviceStatus(updated.status) });
      return res.json({ ...updated, status: normalizeDeviceStatus(updated.status) });
    })
  );

  app.delete(
    "/api/devices/:id",
    asyncRoute(async (req, res) => {
      const id = req.params.id;
      const exists = await prisma.device.findUnique({ where: { id } });

      if (!exists) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      const attachedLinks = await prisma.link.findMany({
        where: {
          OR: [{ sourcePort: { deviceId: id } }, { targetPort: { deviceId: id } }],
        },
        select: { id: true },
      });

      for (const link of attachedLinks) {
        const deleted = await deleteLinkInternal(link.id);
        if (!deleted.ok) {
          return sendError(res, deleted.status, deleted.code, deleted.message);
        }
      }

      await prisma.port.deleteMany({ where: { deviceId: id } });
      await prisma.device.delete({ where: { id } });

      bumpTopologyVersion();
      emitEvent("deviceDeleted", { id });
      return res.status(204).send();
    })
  );
};

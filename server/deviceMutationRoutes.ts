import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type DeviceCreatePayload = {
  name: string;
  type: string;
  x: number;
  y: number;
  parentId?: string | null;
  bngClusterId?: string;
  bngAnchorId?: string;
};

type DevicePatchPayload = {
  name?: string;
  x?: number;
  y?: number;
  status?: "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  parentId?: string | null;
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
  const canHaveContainerParent = (type: string) => type === "POP" || type === "OLT" || type === "AON_SWITCH";

  const isContainerType = (type: string) => type === "POP" || type === "CORE_SITE";

  const validateParentConstraint = async (
    tx: any,
    payload: { deviceId?: string; type: string; parentId?: string | null }
  ) => {
    const normalizedType = normalizeDeviceType(payload.type);
    if (!normalizedType) {
      return { ok: false as const, status: 400, code: "VALIDATION_ERROR", message: `Unsupported device type: ${payload.type}` };
    }

    const parentId = payload.parentId ?? null;
    if (!parentId) {
      if (normalizedType === "CORE_SITE") {
        return { ok: true as const, normalizedType, parent: null };
      }
      if (normalizedType === "POP" || normalizedType === "OLT" || normalizedType === "AON_SWITCH") {
        return { ok: true as const, normalizedType, parent: null };
      }
      if (isContainerType(normalizedType) || canHaveContainerParent(normalizedType)) {
        return { ok: true as const, normalizedType, parent: null };
      }
      return { ok: true as const, normalizedType, parent: null };
    }

    if (payload.deviceId && parentId === payload.deviceId) {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CONTAINER_PARENT",
        message: "Device cannot be its own container parent",
      };
    }

    const parent = await tx.device.findUnique({
      where: { id: parentId },
      select: { id: true, type: true, parentContainerId: true },
    });
    if (!parent) {
      return { ok: false as const, status: 404, code: "DEVICE_NOT_FOUND", message: "Parent container device not found" };
    }

    const normalizedParentType = normalizeDeviceType(parent.type);
    if (normalizedParentType !== "POP" && normalizedParentType !== "CORE_SITE") {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CONTAINER_PARENT",
        message: "Parent container must be POP or CORE_SITE",
      };
    }

    if (normalizedType === "CORE_SITE") {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CONTAINER_PARENT",
        message: "CORE_SITE cannot have a parent container",
      };
    }

    if (normalizedType === "POP" && normalizedParentType !== "CORE_SITE") {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CONTAINER_PARENT",
        message: "POP can only be assigned under CORE_SITE",
      };
    }

    if ((normalizedType === "OLT" || normalizedType === "AON_SWITCH") && normalizedParentType !== "POP" && normalizedParentType !== "CORE_SITE") {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CONTAINER_PARENT",
        message: "OLT and AON_SWITCH can only be assigned under POP or CORE_SITE",
      };
    }

    if (!canHaveContainerParent(normalizedType)) {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CONTAINER_PARENT",
        message: `${normalizedType} does not support parent_container_id in the MVP container model`,
      };
    }

    if (payload.deviceId) {
      let cursor: string | null = parent.parentContainerId ?? null;
      while (cursor) {
        if (cursor === payload.deviceId) {
          return {
            ok: false as const,
            status: 422,
            code: "CONTAINER_CYCLE",
            message: "Container assignment would create a parent cycle",
          };
        }
        const nextParent = await tx.device.findUnique({
          where: { id: cursor },
          select: { parentContainerId: true },
        });
        cursor = nextParent?.parentContainerId ?? null;
      }
    }

    return { ok: true as const, normalizedType, parent };
  };

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

      const parentValidation = await validateParentConstraint(prisma, {
        type: payload.type,
        parentId: payload.parentId ?? null,
      });
      if (!parentValidation.ok) {
        return sendError(res, parentValidation.status, parentValidation.code, parentValidation.message);
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
          ...(payload.parentId !== undefined ? { parentContainerId: payload.parentId } : {}),
          ...(payload.bngClusterId ? { bngClusterId: payload.bngClusterId } : {}),
          ...(payload.bngAnchorId ? { bngAnchorId: payload.bngAnchorId } : {}),
        } as any,
      });

      await createPortsForDevice(created.id, payload.type, { includeManagement: false });

      const deviceWithPorts = await prisma.device.findUniqueOrThrow({ where: { id: created.id }, include: { ports: true } });

      bumpTopologyVersion();
      emitEvent("deviceCreated", {
        ...deviceWithPorts,
        status: normalizeDeviceStatus(deviceWithPorts.status),
        parent_container_id: deviceWithPorts.parentContainerId ?? null,
      });
      res.status(201).json({
        ...deviceWithPorts,
        status: normalizeDeviceStatus(deviceWithPorts.status),
        parent_container_id: deviceWithPorts.parentContainerId ?? null,
      });
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

      const nextParentId = payload.parentId === undefined ? exists.parentContainerId : payload.parentId;
      const parentValidation = await validateParentConstraint(prisma, {
        deviceId: exists.id,
        type: exists.type,
        parentId: nextParentId,
      });
      if (!parentValidation.ok) {
        return sendError(res, parentValidation.status, parentValidation.code, parentValidation.message);
      }

      const previousParentId = exists.parentContainerId ?? null;

      const updated = await prisma.device.update({
        where: { id },
        data: {
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.x !== undefined ? { x: Math.round(payload.x) } : {}),
          ...(payload.y !== undefined ? { y: Math.round(payload.y) } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
          ...(payload.parentId !== undefined ? { parentContainerId: payload.parentId } : {}),
          ...(payload.bngClusterId !== undefined ? { bngClusterId: payload.bngClusterId } : {}),
          ...(payload.bngAnchorId !== undefined ? { bngAnchorId: payload.bngAnchorId } : {}),
        },
        include: { ports: true },
      });

      const normalizedStatus = normalizeDeviceStatus(updated.status);
      await cascadeBngFailure(updated.id, normalizedStatus);
      await recoverBngSessions(updated.id, normalizedStatus);

      bumpTopologyVersion();
      if (previousParentId !== (updated.parentContainerId ?? null)) {
        emitEvent("deviceContainerChanged", {
          id: updated.id,
          parent_container_id: updated.parentContainerId ?? null,
        });
      }
      emitEvent("deviceUpdated", {
        ...updated,
        status: normalizeDeviceStatus(updated.status),
        parent_container_id: updated.parentContainerId ?? null,
      });
      return res.json({
        ...updated,
        status: normalizeDeviceStatus(updated.status),
        parent_container_id: updated.parentContainerId ?? null,
      });
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

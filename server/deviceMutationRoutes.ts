import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type DeviceCreatePayload = {
  name: string;
  type: string;
  x: number;
  y: number;
  parentId?: string;
};

type DevicePatchPayload = {
  name?: string;
  x?: number;
  y?: number;
  status?: "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
};

type DeviceMutationRouteDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  parseDeviceCreate: (body: unknown) => DeviceCreatePayload;
  parseDevicePatch: (body: unknown) => DevicePatchPayload;
  createPortsForDevice: (deviceId: string, type: any, options?: { includeManagement?: boolean }) => Promise<void>;
  cascadeBngFailure: (deviceId: string, newStatus: string) => Promise<unknown>;
  bumpTopologyVersion: () => number;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  normalizeDeviceStatus: (input: string | null | undefined) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
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
  cascadeBngFailure,
  bumpTopologyVersion,
  emitEvent,
  normalizeDeviceStatus,
  sendError,
}: DeviceMutationRouteDeps) => {
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

      const updated = await prisma.device.update({
        where: { id },
        data: {
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.x !== undefined ? { x: Math.round(payload.x) } : {}),
          ...(payload.y !== undefined ? { y: Math.round(payload.y) } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
        },
        include: { ports: true },
      });

      await cascadeBngFailure(updated.id, normalizeDeviceStatus(updated.status));

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

      await prisma.link.deleteMany({
        where: {
          OR: [{ sourcePort: { deviceId: id } }, { targetPort: { deviceId: id } }],
        },
      });

      await prisma.port.deleteMany({ where: { deviceId: id } });
      await prisma.device.delete({ where: { id } });

      bumpTopologyVersion();
      emitEvent("deviceDeleted", { id });
      return res.status(204).send();
    })
  );
};

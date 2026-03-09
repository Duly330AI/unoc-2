import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type ReadRoutesDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  getTopologyVersion: () => number;
  buildRuntimeStatusByDeviceId: (devices: any[], links: any[]) => Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">;
  mapDeviceToNode: (device: any, runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">) => unknown;
  mapDeviceToApi: (device: any, runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">) => unknown;
  mapLinkToEdge: (link: any) => unknown;
  mapLinkToApi: (link: any) => unknown;
  sendError: (
    res: express.Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) => express.Response;
};

export const registerReadRoutes = ({
  app,
  asyncRoute,
  prisma,
  getTopologyVersion,
  buildRuntimeStatusByDeviceId,
  mapDeviceToNode,
  mapDeviceToApi,
  mapLinkToEdge,
  mapLinkToApi,
  sendError,
}: ReadRoutesDeps) => {
  app.get(
    "/api/topology",
    asyncRoute(async (_req, res) => {
      const devices = await prisma.device.findMany({ include: { ports: true } });
      const links = await prisma.link.findMany({ include: { sourcePort: true, targetPort: true } });
      const runtimeStatusById = buildRuntimeStatusByDeviceId(devices, links);

      res.json({
        topo_version: getTopologyVersion(),
        nodes: devices.map((device: any) => mapDeviceToNode(device, runtimeStatusById)),
        edges: links.map((link: any) => mapLinkToEdge(link)),
      });
    })
  );

  app.get(
    "/api/devices",
    asyncRoute(async (_req, res) => {
      const [devices, links] = await Promise.all([
        prisma.device.findMany({ include: { ports: true } }),
        prisma.link.findMany({
          include: {
            sourcePort: { select: { deviceId: true } },
            targetPort: { select: { deviceId: true } },
          },
        }),
      ]);
      const runtimeStatusById = buildRuntimeStatusByDeviceId(devices, links);
      res.json(devices.map((device: any) => mapDeviceToApi(device, runtimeStatusById)));
    })
  );

  app.get(
    "/api/devices/:id",
    asyncRoute(async (req, res) => {
      const [device, allDevices, links] = await Promise.all([
        prisma.device.findUnique({ where: { id: req.params.id }, include: { ports: true } }),
        prisma.device.findMany({ select: { id: true, type: true, status: true, provisioned: true } }),
        prisma.link.findMany({
          include: {
            sourcePort: { select: { deviceId: true } },
            targetPort: { select: { deviceId: true } },
          },
        }),
      ]);

      if (!device) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      const runtimeStatusById = buildRuntimeStatusByDeviceId(allDevices, links);

      return res.json(mapDeviceToApi(device, runtimeStatusById));
    })
  );

  app.get(
    "/api/links",
    asyncRoute(async (_req, res) => {
      const links = await prisma.link.findMany({ include: { sourcePort: true, targetPort: true } });
      res.json(links.map((link: any) => mapLinkToApi(link)));
    })
  );
};

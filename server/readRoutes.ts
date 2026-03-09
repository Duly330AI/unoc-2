import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type ReadRoutesDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  getTopologyVersion: () => number;
  getLatestMetrics: () => Array<{ id: string; downstreamMbps?: number; upstreamMbps?: number }>;
  buildRuntimeStatusByDeviceId: (devices: any[], links: any[]) => Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">;
  buildContainerAggregateById: (
    devices: any[],
    runtimeStatusById: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">,
    latestMetrics: Array<{ id: string; downstreamMbps?: number; upstreamMbps?: number }>
  ) => Map<
    string,
    { health: "UP" | "DOWN" | "DEGRADED"; downstreamMbps: number; upstreamMbps: number; occupancy: number }
  >;
  mapDeviceToNode: (
    device: any,
    runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">,
    containerAggregateById?: Map<
      string,
      { health: "UP" | "DOWN" | "DEGRADED"; downstreamMbps: number; upstreamMbps: number; occupancy: number }
    >
  ) => unknown;
  mapDeviceToApi: (
    device: any,
    runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">,
    containerAggregateById?: Map<
      string,
      { health: "UP" | "DOWN" | "DEGRADED"; downstreamMbps: number; upstreamMbps: number; occupancy: number }
    >
  ) => unknown;
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
  getLatestMetrics,
  buildRuntimeStatusByDeviceId,
  buildContainerAggregateById,
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
      const containerAggregateById = buildContainerAggregateById(devices, runtimeStatusById, getLatestMetrics());

      res.json({
        topo_version: getTopologyVersion(),
        nodes: devices.map((device: any) => mapDeviceToNode(device, runtimeStatusById, containerAggregateById)),
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
      const containerAggregateById = buildContainerAggregateById(devices, runtimeStatusById, getLatestMetrics());
      res.json(devices.map((device: any) => mapDeviceToApi(device, runtimeStatusById, containerAggregateById)));
    })
  );

  app.get(
    "/api/devices/:id",
    asyncRoute(async (req, res) => {
      const [device, allDevices, links] = await Promise.all([
        prisma.device.findUnique({ where: { id: req.params.id }, include: { ports: true } }),
        prisma.device.findMany({
          select: { id: true, type: true, status: true, provisioned: true, parentContainerId: true },
        }),
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
      const allDevicesWithTarget = [...allDevices];
      if (!allDevicesWithTarget.some((entry: any) => entry.id === device.id)) {
        allDevicesWithTarget.push({
          id: device.id,
          type: device.type,
          status: device.status,
          provisioned: device.provisioned,
          parentContainerId: device.parentContainerId ?? null,
        });
      }
      const containerAggregateById = buildContainerAggregateById(
        allDevicesWithTarget,
        runtimeStatusById,
        getLatestMetrics()
      );

      return res.json(mapDeviceToApi(device, runtimeStatusById, containerAggregateById));
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

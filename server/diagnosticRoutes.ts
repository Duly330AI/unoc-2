import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type DiagnosticRoutesDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  sendError: (
    res: express.Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) => express.Response;
  summarizePortsForDevice: (deviceId: string) => Promise<any | null>;
  normalizeDeviceType: (input: string) => string | undefined;
  canonicalPortRole: (portType: string) => "PON" | "ACCESS" | "UPLINK" | "MANAGEMENT" | null;
  buildInterfaceName: (role: string, portNumber: number) => string;
  buildSyntheticMac: (deviceId: string, portNumber: number) => string;
  fiberTypes: Array<{ name: string; attenuation_db_per_km: number; wavelength_nm: number | null }>;
  getTopologyVersion: () => number;
  getMetricTickSeq: () => number;
  getLatestMetrics: () => Array<unknown>;
  getTrafficEnabled: () => boolean;
  getTrafficIntervalMs: () => number;
  isTrafficRunning: () => boolean;
  computeDeviceDiagnostics: (deviceId: string) => Promise<any | null>;
  parseIpv4Cidr: (cidr: string) => { networkAddress: number; broadcastAddress: number; prefixLen: number };
};

export const registerDiagnosticRoutes = ({
  app,
  asyncRoute,
  prisma,
  sendError,
  summarizePortsForDevice,
  normalizeDeviceType,
  canonicalPortRole,
  buildInterfaceName,
  buildSyntheticMac,
  fiberTypes,
  getTopologyVersion,
  getMetricTickSeq,
  getLatestMetrics,
  getTrafficEnabled,
  getTrafficIntervalMs,
  isTrafficRunning,
  computeDeviceDiagnostics,
  parseIpv4Cidr,
}: DiagnosticRoutesDeps) => {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", topologyVersion: getTopologyVersion(), metricTickSeq: getMetricTickSeq() });
  });

  app.get(
    "/api/ports/summary/:deviceId",
    asyncRoute(async (req, res) => {
      const summary = await summarizePortsForDevice(req.params.deviceId);
      if (!summary) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }
      res.json(summary);
    })
  );

  app.get(
    "/api/ports/summary",
    asyncRoute(async (req, res) => {
      const idsParam = req.query.ids;
      const ids = (Array.isArray(idsParam) ? idsParam : [idsParam])
        .filter((value): value is string => typeof value === "string")
        .flatMap((value) => value.split(","))
        .map((id) => id.trim())
        .filter(Boolean);

      if (ids.length === 0) {
        return sendError(res, 400, "VALIDATION_ERROR", "ids query parameter is required");
      }

      const summaries = await Promise.all(ids.map((id) => summarizePortsForDevice(id)));
      const results = summaries.filter((item): item is NonNullable<typeof item> => item !== null);
      const byDeviceId = Object.fromEntries(results.map((item) => [item.device_id, item]));
      return res.json({ by_device_id: byDeviceId, items: results, requested: ids.length, returned: results.length });
    })
  );

  app.get(
    "/api/ports/ont-list/:deviceId",
    asyncRoute(async (req, res) => {
      const device = await prisma.device.findUnique({ where: { id: req.params.deviceId } });
      if (!device) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      const normalized = normalizeDeviceType(device.type);
      if (normalized !== "OLT") {
        return res.json({ device_id: device.id, items: [] });
      }

      const ports = await prisma.port.findMany({ where: { deviceId: device.id }, select: { id: true } });
      const portIds = ports.map((port: any) => port.id);
      const links = await prisma.link.findMany({
        where: {
          OR: [{ sourcePortId: { in: portIds } }, { targetPortId: { in: portIds } }],
        },
        include: {
          sourcePort: { include: { device: true } },
          targetPort: { include: { device: true } },
        },
      });

      const ontMap = new Map<string, { id: string; name: string; type: string }>();
      for (const link of links) {
        const sourceType = normalizeDeviceType(link.sourcePort.device.type);
        const targetType = normalizeDeviceType(link.targetPort.device.type);
        if (sourceType === "ONT" || sourceType === "BUSINESS_ONT" || sourceType === "AON_CPE") {
          ontMap.set(link.sourcePort.device.id, {
            id: link.sourcePort.device.id,
            name: link.sourcePort.device.name,
            type: sourceType,
          });
        }
        if (targetType === "ONT" || targetType === "BUSINESS_ONT" || targetType === "AON_CPE") {
          ontMap.set(link.targetPort.device.id, {
            id: link.targetPort.device.id,
            name: link.targetPort.device.name,
            type: targetType,
          });
        }
      }

      return res.json({ device_id: device.id, items: Array.from(ontMap.values()) });
    })
  );

  app.get(
    "/api/interfaces/:deviceId",
    asyncRoute(async (req, res) => {
      const device = await prisma.device.findUnique({ where: { id: req.params.deviceId } });
      if (!device) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      const ports = await prisma.port.findMany({
        where: { deviceId: device.id },
        orderBy: [{ portType: "asc" }, { portNumber: "asc" }],
      });

      const items = ports.map((port: any) => ({
        id: port.id,
        name: buildInterfaceName(port.portType, port.portNumber),
        mac: buildSyntheticMac(device.id, port.portNumber),
        role: canonicalPortRole(port.portType) ?? port.portType.toUpperCase(),
        status: port.status,
        capacity: null,
        addresses: [] as Array<{ ip: string; prefix_len: number; is_primary: boolean; vrf: string }>,
      }));

      return res.json(items);
    })
  );

  app.get("/api/optical/fiber-types", (_req, res) => {
    res.json({
      items: fiberTypes.map((item) => ({
        physical_medium_id: item.name,
        name: item.name,
        attenuation_db_per_km: item.attenuation_db_per_km,
        wavelength_nm: item.wavelength_nm,
      })),
    });
  });

  app.get("/api/metrics/snapshot", (_req, res) => {
    res.json({ tick: getMetricTickSeq(), devices: getLatestMetrics() });
  });

  app.get(
    "/api/bng/pools",
    asyncRoute(async (req, res) => {
      const bngId = typeof req.query.bng_id === "string" ? req.query.bng_id.trim() : "";
      if (!bngId) {
        return sendError(res, 400, "VALIDATION_ERROR", "bng_id query parameter is required");
      }

      const bngDevice = await prisma.device.findUnique({ where: { id: bngId } });
      if (!bngDevice) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "BNG device not found");
      }
      if (normalizeDeviceType(bngDevice.type) !== "EDGE_ROUTER" || !bngDevice.bngClusterId) {
        return sendError(res, 422, "BNG_UNREACHABLE", "BNG pools require an EDGE_ROUTER with explicit BNG role");
      }

      const pools = await prisma.ipPool.findMany({
        where: { bngDeviceId: bngId },
        include: { vrf: true },
        orderBy: [{ poolKey: "asc" }],
      });

      const items = await Promise.all(
        pools.map(async (pool: any) => {
          const capacity = Math.max(0, 2 ** (32 - parseIpv4Cidr(pool.cidr).prefixLen));
          let allocated = 0;

          if (pool.type === "SUBSCRIBER_IPV4") {
            const sessions = await prisma.subscriberSession.findMany({
              where: {
                bngDeviceId: bngId,
                ipv4Address: { not: null },
              },
              select: { ipv4Address: true },
            });
            const { networkAddress, broadcastAddress } = parseIpv4Cidr(pool.cidr);
            allocated = sessions.filter((session: { ipv4Address: string | null }) => {
              if (!session.ipv4Address) return false;
              const { networkAddress: start, broadcastAddress: end } = parseIpv4Cidr(`${session.ipv4Address}/32`);
              return start >= networkAddress && end <= broadcastAddress;
            }).length;
          }

          return {
            pool_key: pool.poolKey.startsWith("sub_ipv4:") ? "sub_ipv4" : pool.poolKey,
            vrf: pool.vrf?.name ?? null,
            allocated,
            capacity,
            utilization_percent: capacity > 0 ? Number(((allocated / capacity) * 100).toFixed(2)) : 0,
          };
        })
      );

      return res.json({
        bng_id: bngId,
        cluster_id: bngDevice.bngClusterId,
        pools: items,
      });
    })
  );

  app.get(
    "/api/devices/:id/diagnostics",
    asyncRoute(async (req, res) => {
      const diagnostics = await computeDeviceDiagnostics(req.params.id);
      if (!diagnostics) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }
      return res.json(diagnostics);
    })
  );

  app.get("/api/sim/status", (_req, res) => {
    res.json({
      enabled: getTrafficEnabled(),
      interval_ms: getTrafficIntervalMs(),
      last_tick_seq: getMetricTickSeq(),
      running: isTrafficRunning(),
    });
  });
};

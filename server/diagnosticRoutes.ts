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
  buildDeviceAdjacency: (
    deviceIds: string[],
    links: Array<{ sourcePort: { deviceId: string }; targetPort: { deviceId: string } }>
  ) => Map<string, string[]>;
  findServingOltForLeaf: (
    leafId: string,
    adjacency: Map<string, string[]>,
    typeById: Map<string, string>,
    passiveInlineTypes: Set<string>
  ) => string | null;
  passiveInlineTypes: Set<string>;
  parseIpv4Cidr: (cidr: string) => { networkAddress: number; broadcastAddress: number; prefixLen: number };
  parseIpv6Cidr: (cidr: string) => { networkAddress: bigint; prefixLen: number };
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
  buildDeviceAdjacency,
  findServingOltForLeaf,
  passiveInlineTypes,
  parseIpv4Cidr,
  parseIpv6Cidr,
}: DiagnosticRoutesDeps) => {
  const portsRateLimitWindowMs = 5_000;
  const portsRateLimitMax = 15;
  const portsRateLimitState = new Map<string, { count: number; resetAt: number }>();

  const shouldRateLimitPorts = (req: express.Request) => {
    const now = Date.now();
    const key = `${req.ip ?? "unknown"}:${req.path}`;
    const entry = portsRateLimitState.get(key);
    if (!entry || entry.resetAt <= now) {
      portsRateLimitState.set(key, { count: 1, resetAt: now + portsRateLimitWindowMs });
      return { limited: false, retryAfterSeconds: 0 };
    }

    if (entry.count >= portsRateLimitMax) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return { limited: true, retryAfterSeconds };
    }

    entry.count += 1;
    return { limited: false, retryAfterSeconds: 0 };
  };

  const normalizeIpv6PrefixBase = (prefix: string) => prefix.split("/")[0]?.trim().toLowerCase() ?? "";

  const isIpv6PrefixInCidr = (prefix: string, cidr: string) => {
    const [prefixAddress, prefixLenRaw] = prefix.split("/");
    const prefixLen = Number(prefixLenRaw);
    if (!prefixAddress || !Number.isFinite(prefixLen)) return false;
    const { networkAddress, prefixLen: poolPrefixLen } = parseIpv6Cidr(cidr);
    if (prefixLen < poolPrefixLen) return false;
    const prefixNetworkAddress = parseIpv6Cidr(`${prefixAddress}/${poolPrefixLen}`).networkAddress;
    return prefixNetworkAddress === networkAddress;
  };

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", topologyVersion: getTopologyVersion(), metricTickSeq: getMetricTickSeq() });
  });

  app.get(
    "/api/ports/summary/:deviceId",
    asyncRoute(async (req, res) => {
      const limit = shouldRateLimitPorts(req);
      if (limit.limited) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return sendError(res, 429, "RATE_LIMITED", "Ports summary rate limit exceeded", {
          retry_after_seconds: limit.retryAfterSeconds,
        });
      }
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
      const limit = shouldRateLimitPorts(req);
      if (limit.limited) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return sendError(res, 429, "RATE_LIMITED", "Ports summary rate limit exceeded", {
          retry_after_seconds: limit.retryAfterSeconds,
        });
      }
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
      const limit = shouldRateLimitPorts(req);
      if (limit.limited) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return sendError(res, 429, "RATE_LIMITED", "Ports ont-list rate limit exceeded", {
          retry_after_seconds: limit.retryAfterSeconds,
        });
      }
      const device = await prisma.device.findUnique({ where: { id: req.params.deviceId } });
      if (!device) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }

      const normalized = normalizeDeviceType(device.type);
      if (normalized !== "OLT") {
        return res.json({ device_id: device.id, items: [] });
      }

      const devices = await prisma.device.findMany({ select: { id: true, name: true, type: true } });
      const links = await prisma.link.findMany({
        include: {
          sourcePort: { select: { deviceId: true } },
          targetPort: { select: { deviceId: true } },
        },
      });

      const deviceIds = devices.map((entry: any) => entry.id);
      const adjacency = buildDeviceAdjacency(deviceIds, links);
      const typeById = new Map<string, string>();
      for (const entry of devices) {
        const normalizedType = normalizeDeviceType(entry.type);
        if (!normalizedType) continue;
        typeById.set(entry.id, normalizedType);
      }

      const ontItems: Array<{ id: string; name: string; type: string }> = [];
      for (const entry of devices) {
        const normalizedType = normalizeDeviceType(entry.type);
        if (!normalizedType) continue;
        if (normalizedType !== "ONT" && normalizedType !== "BUSINESS_ONT" && normalizedType !== "AON_CPE") continue;
        const servingOltId = findServingOltForLeaf(entry.id, adjacency, typeById, passiveInlineTypes);
        if (servingOltId !== device.id) continue;
        ontItems.push({ id: entry.id, name: entry.name, type: normalizedType });
      }

      ontItems.sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)));
      return res.json({ device_id: device.id, items: ontItems });
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
    res.json({ tick_seq: getMetricTickSeq(), tick: getMetricTickSeq(), devices: getLatestMetrics() });
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
          let capacity = 0;
          let allocated = 0;

          if (pool.type === "SUBSCRIBER_IPV4") {
            capacity = Math.max(0, 2 ** (32 - parseIpv4Cidr(pool.cidr).prefixLen));
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
          } else if (pool.type === "IPV6_PD") {
            const poolPrefixLen = parseIpv6Cidr(pool.cidr).prefixLen;
            const delegatedPrefixLen = pool.delegatedPrefixLen ?? 56;
            capacity = delegatedPrefixLen >= poolPrefixLen ? 2 ** (delegatedPrefixLen - poolPrefixLen) : 0;
            const sessions = await prisma.subscriberSession.findMany({
              where: {
                bngDeviceId: bngId,
                ipv6Pd: { not: null },
              },
              select: { ipv6Pd: true },
            });
            allocated = new Set(
              sessions
                .map((session: { ipv6Pd: string | null }) => session.ipv6Pd)
                .filter((prefix: string | null): prefix is string => Boolean(prefix))
                .filter((prefix: string) => isIpv6PrefixInCidr(prefix, pool.cidr))
                .map((prefix: string) => normalizeIpv6PrefixBase(prefix))
            ).size;
          }

          return {
            pool_key: pool.poolKey.startsWith("sub_ipv4:")
              ? "sub_ipv4"
              : pool.poolKey.startsWith("sub_ipv6_pd:")
                ? "sub_ipv6_pd"
                : pool.poolKey,
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

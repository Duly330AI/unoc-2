import { DEFAULT_PON_MAX_SUBSCRIBERS, resolvePonMaxSubscribers } from "./capacityService";
import { buildTopologyContext, resolveServingOltForLeaf } from "./topologyResolver";

type SummaryPayload = { device_id: string; total: number; by_role: Record<string, unknown> };

type PortsRateLimiter = {
  consume: (key: string) => { limited: boolean; retryAfterSeconds: number };
};

const createPortsRateLimiter = (opts: { windowMs: number; max: number }): PortsRateLimiter => {
  const state = new Map<string, { count: number; resetAt: number }>();

  return {
    consume: (key: string) => {
      const now = Date.now();
      const entry = state.get(key);
      if (!entry || entry.resetAt <= now) {
        state.set(key, { count: 1, resetAt: now + opts.windowMs });
        return { limited: false, retryAfterSeconds: 0 };
      }
      if (entry.count >= opts.max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        return { limited: true, retryAfterSeconds };
      }
      entry.count += 1;
      return { limited: false, retryAfterSeconds: 0 };
    },
  };
};

const createPortsSummaryCache = (opts: { ttlMs: number; getTopologyVersion: () => number }) => {
  type CacheEntry = { summary: SummaryPayload; expiresAt: number };

  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<SummaryPayload | null>>();
  let totalComputes = 0;

  const getCacheKey = (deviceId: string, topoVersion: number) => `${topoVersion}:${deviceId}`;

  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  };

  const peek = (deviceId: string) => {
    prune();
    const key = getCacheKey(deviceId, opts.getTopologyVersion());
    return cache.get(key)?.summary ?? null;
  };

  const getInFlight = (deviceId: string) => {
    const key = getCacheKey(deviceId, opts.getTopologyVersion());
    return inFlight.get(key) ?? null;
  };

  const setInFlight = (deviceId: string, promise: Promise<SummaryPayload | null>) => {
    const key = getCacheKey(deviceId, opts.getTopologyVersion());
    inFlight.set(key, promise);
  };

  const store = (deviceId: string, summary: SummaryPayload | null) => {
    const key = getCacheKey(deviceId, opts.getTopologyVersion());
    inFlight.delete(key);
    if (summary) {
      cache.set(key, { summary, expiresAt: Date.now() + opts.ttlMs });
    }
  };

  return {
    peek,
    getInFlight,
    setInFlight,
    store,
    bumpCompute: () => {
      totalComputes += 1;
    },
    getStats: () => ({ totalComputes }),
    resetStats: () => {
      totalComputes = 0;
    },
  };
};

export const createPortSummaryService = (deps: {
  prisma: any;
  normalizeDeviceType: (input: string) => string | undefined;
  canonicalPortRole: (portType: string) => "PON" | "ACCESS" | "UPLINK" | "MANAGEMENT" | null;
  isOntFamily: (type: string) => boolean;
  passiveInlineTypes: Set<string>;
  getTopologyVersion: () => number;
  hardwareCatalog: Array<{ device_type: string; model: string; attributes: Record<string, unknown> }>;
}): {
  getSummary: (deviceId: string, opts?: { rateLimitKey?: string }) => Promise<{
    summary: SummaryPayload | null;
    rateLimited: boolean;
    retryAfterSeconds: number;
  }>;
  getBulkSummaries: (deviceIds: string[], opts?: { rateLimitKey?: string }) => Promise<{
    items: SummaryPayload[];
    byDeviceId: Record<string, SummaryPayload>;
    requested: number;
    returned: number;
    rateLimited: boolean;
    retryAfterSeconds: number;
  }>;
  consumeRateLimit: (key: string) => { limited: boolean; retryAfterSeconds: number };
  getCacheStats: () => { totalComputes: number };
  resetCacheStats: () => void;
} => {
  const rateLimiter = createPortsRateLimiter({ windowMs: 5_000, max: 15 });
  const cache = createPortsSummaryCache({ ttlMs: 5_000, getTopologyVersion: deps.getTopologyVersion });

  const buildPortRoleSummary = (
    ports: Array<{ portType: string; outgoingLink: unknown | null; incomingLink: unknown | null }>
  ) => {
    const byRole: Record<string, { total: number; used: number; max_subscribers?: number }> = {
      PON: { total: 0, used: 0, max_subscribers: DEFAULT_PON_MAX_SUBSCRIBERS },
      ACCESS: { total: 0, used: 0 },
      UPLINK: { total: 0, used: 0 },
      MANAGEMENT: { total: 0, used: 0 },
    };
    let hasManagementPort = false;

    for (const port of ports) {
      const role = deps.canonicalPortRole(port.portType);
      if (!role) continue;
      byRole[role].total += 1;
      if (role === "MANAGEMENT") {
        hasManagementPort = true;
      } else {
        const isUsed = Boolean(port.outgoingLink || port.incomingLink);
        if (isUsed) byRole[role].used += 1;
      }
    }

    byRole.MANAGEMENT.used = hasManagementPort ? 1 : 0;
    return byRole;
  };

  const computeSummary = async (deviceId: string) => {
    const device = await deps.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) return null;

    const ports = await deps.prisma.port.findMany({ where: { deviceId }, include: { outgoingLink: true, incomingLink: true } });
    const byRole = buildPortRoleSummary(ports);
    const ponMax = resolvePonMaxSubscribers({
      deviceType: device.type,
      model: device.model ?? null,
      hardwareCatalog: deps.hardwareCatalog as any,
      normalizeDeviceType: deps.normalizeDeviceType,
    });
    if (ponMax !== null && byRole.PON) {
      byRole.PON.max_subscribers = ponMax;
    }

    if (deps.normalizeDeviceType(device.type) === "OLT" && byRole.PON.total > 0) {
      const devices = await deps.prisma.device.findMany({ select: { id: true, type: true, provisioned: true } });
      const links = await deps.prisma.link.findMany({
        include: { sourcePort: { select: { deviceId: true } }, targetPort: { select: { deviceId: true } } },
      });
      const context = buildTopologyContext(devices, links, deps.normalizeDeviceType);
      let ponUsed = 0;
      for (const entry of devices) {
        if (!entry.provisioned) continue;
        if (!deps.isOntFamily(entry.type)) continue;
        const servingOltId = resolveServingOltForLeaf(entry.id, context, deps.passiveInlineTypes);
        if (servingOltId === device.id) ponUsed += 1;
      }
      byRole.PON.used = ponUsed;
    }

    const total = Object.values(byRole).reduce((acc, role) => acc + (role as { total: number }).total, 0);
    return { device_id: deviceId, total, by_role: byRole };
  };

  const getSummary = async (deviceId: string, opts?: { rateLimitKey?: string }) => {
    const cached = cache.peek(deviceId);
    if (cached) {
      return { summary: cached, rateLimited: false, retryAfterSeconds: 0 };
    }

    const inFlight = cache.getInFlight(deviceId);
    if (inFlight) {
      return { summary: await inFlight, rateLimited: false, retryAfterSeconds: 0 };
    }

    if (opts?.rateLimitKey) {
      const limit = rateLimiter.consume(opts.rateLimitKey);
      if (limit.limited) {
        return { summary: null, rateLimited: true, retryAfterSeconds: limit.retryAfterSeconds };
      }
    }

    cache.bumpCompute();
    const promise = computeSummary(deviceId).then((summary) => {
      cache.store(deviceId, summary);
      return summary;
    });
    cache.setInFlight(deviceId, promise);
    return { summary: await promise, rateLimited: false, retryAfterSeconds: 0 };
  };

  const getBulkSummaries = async (deviceIds: string[], opts?: { rateLimitKey?: string }) => {
    let rateLimitKey = opts?.rateLimitKey;
    let rateLimited = false;
    let retryAfterSeconds = 0;

    const results: SummaryPayload[] = [];
    for (const deviceId of deviceIds) {
      const cached = cache.peek(deviceId);
      if (cached) {
        results.push(cached);
        continue;
      }

      const inFlight = cache.getInFlight(deviceId);
      if (inFlight) {
        const summary = await inFlight;
        if (summary) results.push(summary);
        continue;
      }

      if (rateLimitKey) {
        const limit = rateLimiter.consume(rateLimitKey);
        if (limit.limited) {
          rateLimited = true;
          retryAfterSeconds = limit.retryAfterSeconds;
          break;
        }
        rateLimitKey = undefined;
      }

      cache.bumpCompute();
      const promise = computeSummary(deviceId).then((summary) => {
        cache.store(deviceId, summary);
        return summary;
      });
      cache.setInFlight(deviceId, promise);
      const summary = await promise;
      if (summary) results.push(summary);
    }

    const byDeviceId = Object.fromEntries(results.map((item) => [item.device_id, item]));
    return {
      items: results,
      byDeviceId,
      requested: deviceIds.length,
      returned: results.length,
      rateLimited,
      retryAfterSeconds,
    };
  };

  return {
    getSummary,
    getBulkSummaries,
    consumeRateLimit: (key: string) => rateLimiter.consume(key),
    getCacheStats: cache.getStats,
    resetCacheStats: cache.resetStats,
  };
};

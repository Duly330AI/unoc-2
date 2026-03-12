type PortSummaryPayload = {
  device_id: string;
  total: number;
  by_role?: Record<string, { total?: number; used?: number; max_subscribers?: number }>;
};

type PortSummaryNormalized = {
  total: number;
  byRole: Record<string, { total: number; used: number; maxSubscribers?: number }>;
};

type DiagnosticsPayload = {
  device_id: string;
  upstream_l3_ok: boolean;
  chain?: string[];
  reason_codes?: string[];
};

type DiagnosticsNormalized = {
  upstreamL3Ok: boolean;
  chain: string[];
  reasonCodes: string[];
};

type BngDeviceDetails = {
  id: string;
  bngClusterId?: string | null;
  bngAnchorId?: string | null;
};

type BngPoolsPayload = {
  cluster_id: string | null;
  pools: Array<{
    pool_key: string;
    vrf: string | null;
    allocated: number;
    capacity: number;
    utilization_percent: number;
  }>;
};

type BngInfoNormalized = {
  clusterId: string | null;
  anchorId: string | null;
  pools: Array<{
    poolKey: string;
    vrf: string | null;
    allocated: number;
    capacity: number;
    utilizationPercent: number;
  }>;
};

export const normalizePortSummary = (
  summary: PortSummaryPayload | null | undefined,
  fallbackDeviceId: string
): PortSummaryNormalized => {
  const safe = summary ?? { device_id: fallbackDeviceId, total: 0, by_role: {} };
  const byRole = Object.fromEntries(
    Object.entries(safe.by_role ?? {}).map(([role, value]) => [
      role,
      {
        total: value.total ?? 0,
        used: value.used ?? 0,
        maxSubscribers: value.max_subscribers,
      },
    ])
  );

  return {
    total: safe.total ?? 0,
    byRole,
  };
};

export const normalizeDiagnostics = (diagnostics: DiagnosticsPayload): DiagnosticsNormalized => ({
  upstreamL3Ok: diagnostics.upstream_l3_ok,
  chain: diagnostics.chain ?? [],
  reasonCodes: diagnostics.reason_codes ?? [],
});

export const normalizeOntList = (
  ontList: { items?: Array<{ id: string; name: string; type: string }> } | null | undefined
) => ontList?.items ?? [];

export const normalizeBngInfo = (
  deviceDetails: BngDeviceDetails | null | undefined,
  bngPools: BngPoolsPayload | null | undefined
): BngInfoNormalized | undefined => {
  if (!deviceDetails?.bngClusterId) return undefined;

  return {
    clusterId: bngPools?.cluster_id ?? deviceDetails.bngClusterId ?? null,
    anchorId: deviceDetails.bngAnchorId ?? null,
    pools: (bngPools?.pools ?? []).map((pool) => ({
      poolKey: pool.pool_key,
      vrf: pool.vrf,
      allocated: pool.allocated,
      capacity: pool.capacity,
      utilizationPercent: pool.utilization_percent,
    })),
  };
};

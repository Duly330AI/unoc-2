import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  buildDeviceAdjacency,
  buildPassabilityState,
  computeDeviceDiagnosticsFromSnapshot,
  evaluateDeviceRuntimeStatus,
  findServingOltForLeaf,
  resolveSubscriberSegment,
  hasSubscriberUpstreamViability,
  isPassableRuntimeStatus,
} from "./server/runtimeStatus";
import { createRealtimeOutboxManager } from "./server/realtimeOutbox";
import {
  buildContainerAggregateById,
  buildRuntimeStatusByDeviceId,
  mapDeviceToApi,
  mapDeviceToNode,
  mapLinkEventPayload,
  mapLinkToApi,
  mapLinkToEdge,
} from "./server/readModels";
import { registerReadRoutes } from "./server/readRoutes";
import { registerDiagnosticRoutes } from "./server/diagnosticRoutes";
import { registerCatalogRoutes } from "./server/catalogRoutes";
import { registerDeviceMutationRoutes } from "./server/deviceMutationRoutes";
import { registerDeviceOpsRoutes } from "./server/deviceOpsRoutes";
import { registerLinkMutationRoutes } from "./server/linkMutationRoutes";
import { registerSessionRoutes } from "./server/sessionRoutes";
import { createLinkService } from "./server/linkService";
import { createSessionService } from "./server/sessionService";
import { createSimulationService } from "./server/simulationService";
import { createOpticalPathService } from "./server/opticalPathService";
import { createPortSummaryService } from "./server/portSummaryService";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./dev.db";
}

const prisma = new PrismaClient();

const databaseUrl = process.env.DATABASE_URL;
const isSqliteDatabase = databaseUrl.startsWith("file:");
const repoOnWslMount = process.platform === "linux" && __dirname.startsWith("/mnt/");

const warnAboutMountedSqlite = () => {
  if (!isSqliteDatabase || !repoOnWslMount || process.env.NODE_ENV === "test") {
    return;
  }

  console.warn(
    [
      "SQLite runtime warning:",
      `repo path '${__dirname}' is on a mounted filesystem.`,
      "Running SQLite from /mnt/* in WSL increases corruption risk after abrupt shutdowns or concurrent dev tooling.",
      "Prefer cloning the repo into the native Linux filesystem (for example ~/projects/unoc).",
    ].join(" ")
  );
};

const enableSqliteWalMode = async () => {
  if (!isSqliteDatabase) return;

  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL;");
  } catch (error) {
    console.warn("Failed to enable SQLite WAL mode:", error);
  }
};

warnAboutMountedSqlite();
await enableSqliteWalMode();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" }, path: "/api/socket.io" });
const requestContext = new AsyncLocalStorage<{ requestId: string }>();

const PORT = 3000;
const TRAFFIC_INTERVAL_MS = Number(process.env.TRAFFIC_TICK_INTERVAL_MS ?? 1000);
const TRAFFIC_RANDOM_SEED = process.env.TRAFFIC_RANDOM_SEED ?? "";

const CANONICAL_DEVICE_TYPES = [
  "BACKBONE_GATEWAY",
  "CORE_ROUTER",
  "EDGE_ROUTER",
  "OLT",
  "AON_SWITCH",
  "SPLITTER",
  "ONT",
  "BUSINESS_ONT",
  "AON_CPE",
  "SWITCH",
  "ODF",
  "NVT",
  "HOP",
  "POP",
  "CORE_SITE",
] as const;
type DeviceType = (typeof CANONICAL_DEVICE_TYPES)[number];

type DeviceStatus = "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
type LinkStatus = "UP" | "DOWN" | "DEGRADED" | "BLOCKING";

const TYPE_ALIASES: Record<string, DeviceType> = {
  BACKBONE_GATEWAY: "BACKBONE_GATEWAY",
  CORE_ROUTER: "CORE_ROUTER",
  EDGE_ROUTER: "EDGE_ROUTER",
  OLT: "OLT",
  AON_SWITCH: "AON_SWITCH",
  SPLITTER: "SPLITTER",
  ONT: "ONT",
  BUSINESS_ONT: "BUSINESS_ONT",
  AON_CPE: "AON_CPE",
  SWITCH: "SWITCH",
  ODF: "ODF",
  NVT: "NVT",
  HOP: "HOP",
  POP: "POP",
  CORE_SITE: "CORE_SITE",
};

const normalizeDeviceType = (input: string): DeviceType | undefined => {
  const key = input.trim().toUpperCase();
  return TYPE_ALIASES[key];
};

const normalizeDeviceStatus = (input: string | null | undefined): DeviceStatus => {
  const normalized = String(input ?? "").toUpperCase();
  if (normalized === "UP" || normalized === "DOWN" || normalized === "DEGRADED" || normalized === "BLOCKING") {
    return normalized;
  }
  return "DOWN";
};

const normalizeLinkStatus = (input: string | null | undefined): LinkStatus => {
  const normalized = String(input ?? "").toUpperCase();
  if (normalized === "UP" || normalized === "DOWN" || normalized === "DEGRADED" || normalized === "BLOCKING") {
    return normalized;
  }
  return "DOWN";
};

const FIBER_TYPE_DB_PER_KM: Record<string, number> = {
  SMF: 0.35,
  MMF: 3.0,
  SMF_G652D: 0.35,
  SMF_G657A1: 0.35,
  SMF_G657A2: 0.35,
  MMF_OM3: 3.5,
  MMF_OM4: 3.0,
  "G.652.D": 0.22,
  "G.657.A1/A2": 0.21,
  "G.652.D OSP": 0.22,
};

const PASSIVE_INSERTION_LOSS_DB: Record<string, number> = {
  ODF: 0.4,
  SPLITTER: 3.5,
  NVT: 0.2,
  HOP: 0.2,
};

const dataDir = path.resolve(__dirname, "data");

const readJsonFile = (filename: string, options?: { required?: boolean }) => {
  const filePath = path.join(dataDir, filename);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if (options?.required) {
      throw new Error(`Required catalog file failed to load: ${filePath}`, { cause: error as Error });
    }
    console.warn(`Failed to load ${filePath}:`, error);
    return null;
  }
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(",", ".").replace(/[^0-9.\-]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

type CatalogEntry = {
  catalog_id: string;
  device_type: string;
  vendor: string;
  model: string;
  version: string;
  attributes: Record<string, unknown>;
};

const buildCatalogEntry = (
  deviceType: string,
  source: Record<string, unknown>,
  fallbackVendor = "Generic"
): CatalogEntry => {
  const vendor = String(source.Hersteller ?? source.vendor ?? fallbackVendor);
  const model = String(source.Modell ?? source.model ?? source.name ?? deviceType);
  return {
    catalog_id: `${deviceType.toUpperCase()}_${slugify(vendor)}_${slugify(model)}`.slice(0, 120),
    device_type: deviceType,
    vendor,
    model,
    version: "1.0",
    attributes: { ...source },
  };
};

const normalizeCatalog = () => {
  const entries: CatalogEntry[] = [];

  const oltMapping = readJsonFile("olt_catalog.json", { required: true });
  if (oltMapping && Array.isArray(oltMapping.OLT)) {
    for (const row of oltMapping.OLT) {
      entries.push(buildCatalogEntry("OLT", row as Record<string, unknown>));
    }
  }

  const switches = readJsonFile("switch_catalog.json", { required: true });
  if (switches && Array.isArray(switches.Switches)) {
    for (const row of switches.Switches) {
      entries.push(buildCatalogEntry("SWITCH", row as Record<string, unknown>));
    }
  }

  const aonSwitches = readJsonFile("aon_switch_catalog.json", { required: true });
  if (aonSwitches && Array.isArray(aonSwitches.AON_Switches)) {
    for (const row of aonSwitches.AON_Switches) {
      entries.push(buildCatalogEntry("AON_SWITCH", row as Record<string, unknown>));
    }
  }

  const backbone = readJsonFile("backbone_hardware_catalog.json", { required: true });
  if (backbone) {
    const collections: Array<{ key: string; type: string }> = [
      { key: "Edge_Routers", type: "EDGE_ROUTER" },
      { key: "Core_Routers", type: "CORE_ROUTER" },
      { key: "DCI_Switches", type: "SWITCH" },
    ];

    for (const item of collections) {
      const rows = backbone[item.key];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          entries.push(buildCatalogEntry(item.type, row as Record<string, unknown>));
        }
      }
    }
  }

  const passive = readJsonFile("passive_infrastructure_catalog.json", { required: true });
  if (passive && typeof passive.Geräte === "object" && passive.Geräte !== null) {
    const geraete = passive.Geräte as Record<string, unknown>;
    const collections: Array<{ key: string; type: string }> = [
      { key: "Splitter", type: "SPLITTER" },
      { key: "ODF", type: "ODF" },
      { key: "POP", type: "POP" },
    ];

    for (const item of collections) {
      const rows = geraete[item.key];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          entries.push(buildCatalogEntry(item.type, row as Record<string, unknown>));
        }
      }
    }
  }

  if (entries.length === 0) {
    return [
      { catalog_id: "OLT_GENERIC_V1", device_type: "OLT", vendor: "Generic", model: "OLT", version: "1.0", attributes: {} },
      { catalog_id: "ONT_GENERIC_V1", device_type: "ONT", vendor: "Generic", model: "ONT", version: "1.0", attributes: {} },
      { catalog_id: "SPLITTER_GENERIC_V1", device_type: "SPLITTER", vendor: "Generic", model: "Splitter", version: "1.0", attributes: {} },
      { catalog_id: "SWITCH_GENERIC_V1", device_type: "SWITCH", vendor: "Generic", model: "Switch", version: "1.0", attributes: {} },
    ] as CatalogEntry[];
  }

  return entries.sort((a, b) => a.catalog_id.localeCompare(b.catalog_id));
};

const normalizeFiberTypes = () => {
  const source = readJsonFile("fiber_types_catalog.json", { required: true });
  const result: Array<{ name: string; attenuation_db_per_km: number; wavelength_nm: number | null }> = [];

  if (source && Array.isArray(source.fiber_catalog)) {
    for (const row of source.fiber_catalog) {
      const record = row as Record<string, unknown>;
      const typeName = String(record.type ?? record.name ?? "").trim();
      const attenuationRaw = record.attenuation_dB_per_km;
      let attenuation: number | null = null;
      let wavelength: number | null = null;

      if (attenuationRaw && typeof attenuationRaw === "object") {
        const map = attenuationRaw as Record<string, unknown>;
        if (map["1550"] !== undefined) {
          attenuation = parseNumber(map["1550"]);
          wavelength = 1550;
        }
        if (attenuation === null && map["1310"] !== undefined) {
          attenuation = parseNumber(map["1310"]);
          wavelength = 1310;
        }
        if (attenuation === null) {
          const first = Object.entries(map)[0];
          if (first) {
            attenuation = parseNumber(first[1]);
            wavelength = parseNumber(first[0]);
          }
        }
      }

      if (!typeName || attenuation === null) continue;
      result.push({ name: typeName, attenuation_db_per_km: attenuation, wavelength_nm: wavelength });
    }
  }

  if (result.length > 0) {
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  return Object.keys(FIBER_TYPE_DB_PER_KM)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, attenuation_db_per_km: FIBER_TYPE_DB_PER_KM[name], wavelength_nm: null }));
};

const normalizeTariffs = () => {
  const source = readJsonFile("tariff_catalog.json", { required: true });
  if (!source || !Array.isArray(source.tariffs)) return [];
  return source.tariffs
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? ""),
      type: String(item.type ?? "unknown"),
      downstream_mbps: parseNumber(item.downstream_mbps),
      upstream_mbps: parseNumber(item.upstream_mbps),
    }))
    .filter((item) => item.id && item.name && item.downstream_mbps !== null && item.upstream_mbps !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
};

const HARDWARE_CATALOG = normalizeCatalog();
const FIBER_TYPES = normalizeFiberTypes();
const TARIFFS = normalizeTariffs();

const IPAM_PREFIXES = [
  { role: "core_mgmt", cidr: "10.250.0.0/24", vrf: "management/core_infrastructure" },
  { role: "ont_mgmt", cidr: "10.250.1.0/24", vrf: "ont/ont_management" },
  { role: "aon_mgmt", cidr: "10.250.2.0/24", vrf: "management/aon" },
  { role: "cpe_mgmt", cidr: "10.250.3.0/24", vrf: "cpe/cpe_management" },
  { role: "olt_mgmt", cidr: "10.250.4.0/24", vrf: "management/olt" },
  { role: "noc_tools", cidr: "10.250.10.0/24", vrf: "tooling/noc" },
];

const ipamRoleForDeviceType = (rawType: string): string | null => {
  const type = normalizeDeviceType(rawType);
  if (type === "OLT") return "olt_mgmt";
  if (type === "ONT" || type === "BUSINESS_ONT") return "ont_mgmt";
  if (type === "AON_SWITCH") return "aon_mgmt";
  if (type === "AON_CPE") return "cpe_mgmt";
  if (type === "BACKBONE_GATEWAY" || type === "SWITCH" || type === "CORE_ROUTER" || type === "EDGE_ROUTER") return "core_mgmt";
  return null;
};

const getIpamPrefixForRole = (role: string) => IPAM_PREFIXES.find((prefix) => prefix.role === role) ?? null;

const ipv4ToInt = (ip: string) =>
  ip
    .split(".")
    .map((octet) => Number(octet))
    .reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0;

const intToIpv4 = (value: number) =>
  [24, 16, 8, 0]
    .map((shift) => ((value >>> shift) & 255).toString(10))
    .join(".");

const parseIpv4Cidr = (cidr: string) => {
  const [network, prefixLenRaw] = cidr.split("/");
  const prefixLen = Number(prefixLenRaw);
  if (!network || !Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const networkInt = ipv4ToInt(network);
  const hostBits = 32 - prefixLen;
  const mask = prefixLen === 0 ? 0 : ((0xffffffff << hostBits) >>> 0);
  const networkAddress = networkInt & mask;
  const broadcastAddress = hostBits === 0 ? networkAddress : (networkAddress | ((1 << hostBits) - 1)) >>> 0;
  return { networkAddress, broadcastAddress, prefixLen };
};

const parseIpv6Cidr = (cidr: string) => {
  const [address, prefixLenRaw] = cidr.split("/");
  const prefixLen = Number(prefixLenRaw);
  if (!address || !Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) {
    throw new Error(`Invalid IPv6 CIDR: ${cidr}`);
  }

  const normalized = address.trim().toLowerCase();
  const [head, tail = ""] = normalized.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const fullParts = normalized.includes("::")
    ? [...headParts, ...Array.from({ length: 8 - (headParts.length + tailParts.length) }, () => "0"), ...tailParts]
    : normalized.split(":");

  if (fullParts.length !== 8) {
    throw new Error(`Invalid IPv6 CIDR: ${cidr}`);
  }

  const value = fullParts
    .map((segment) => BigInt(`0x${segment || "0"}`))
    .reduce((acc, segment) => (acc << 16n) + segment, 0n);
  const mask = prefixLen === 0 ? 0n : ((1n << BigInt(prefixLen)) - 1n) << BigInt(128 - prefixLen);
  return {
    networkAddress: value & mask,
    prefixLen,
  };
};

const isIpInCidr = (ip: string, cidr: string) => {
  const ipInt = ipv4ToInt(ip);
  const { networkAddress, broadcastAddress } = parseIpv4Cidr(cidr);
  return ipInt >= networkAddress && ipInt <= broadcastAddress;
};

const allocateNextIpInCidr = (cidr: string, allocatedIps: string[]) => {
  const { networkAddress, broadcastAddress, prefixLen } = parseIpv4Cidr(cidr);
  const usableStart = prefixLen >= 31 ? networkAddress : networkAddress + 1;
  const usableEnd = prefixLen >= 31 ? broadcastAddress : broadcastAddress - 1;
  const allocated = new Set(allocatedIps.map((ip) => ipv4ToInt(ip)));

  for (let candidate = usableStart; candidate <= usableEnd; candidate += 1) {
    if (!allocated.has(candidate)) {
      return { ip: intToIpv4(candidate), prefixLen };
    }
  }

  return null;
};

type MetricPoint = {
  id: string;
  trafficLoad: number;
  trafficMbps?: number;
  downstreamMbps?: number;
  upstreamMbps?: number;
  trafficProfile?: {
    voice_mbps: number;
    iptv_mbps: number;
    internet_mbps: number;
  };
  segmentId?: string | null;
  rxPower: number;
  status: Exclude<DeviceStatus, "BLOCKING">;
  tick_seq?: number;
  metric_tick_seq: number;
};

let trafficTimer: NodeJS.Timeout | null = null;
let topologyVersion = 1;

const bumpTopologyVersion = () => {
  topologyVersion += 1;
  return topologyVersion;
};
const realtimeOutbox = createRealtimeOutboxManager({
  getRequestId: () => requestContext.getStore()?.requestId,
  getTopologyVersion: () => topologyVersion,
  emit: (payload) => io.emit("event", payload),
});
export const flushRealtimeOutbox = realtimeOutbox.flush;
const clearRealtimeOutbox = realtimeOutbox.clear;
export const emitEvent = realtimeOutbox.emitEvent;

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  const requestId = (req.header("x-request-id") || req.header("x-correlation-id") || randomUUID()).toString();
  requestContext.run({ requestId }, next);
});

const DeviceCreateSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().transform((value, ctx) => {
      const normalized = normalizeDeviceType(value);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid device type: ${value}` });
        return z.NEVER;
      }
      return normalized;
    }),
    x: z.number(),
    y: z.number(),
    parentId: z.string().min(1).nullable().optional(),
    parent_container_id: z.string().min(1).nullable().optional(),
    bngClusterId: z.string().trim().min(1).optional(),
    bngAnchorId: z.string().min(1).optional(),
  })
  .transform((payload) => ({
    ...payload,
    parentId: payload.parentId ?? payload.parent_container_id ?? undefined,
  }));

const DevicePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    status: z.enum(["UP", "DOWN", "DEGRADED", "BLOCKING"]).optional(),
    parentId: z.string().min(1).nullable().optional(),
    parent_container_id: z.string().min(1).nullable().optional(),
    bngClusterId: z.string().trim().min(1).nullable().optional(),
    bngAnchorId: z.string().min(1).nullable().optional(),
  })
  .transform((payload) => ({
    ...payload,
    parentId: payload.parentId ?? payload.parent_container_id ?? undefined,
  }))
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided",
  });

const LinkCreateSchema = z.object({
  a_interface_id: z.string().min(1),
  b_interface_id: z.string().min(1),
  length_km: z.number().positive().max(300).optional(),
  physical_medium_id: z.string().optional(),
});

const LinkUpdateSchema = z
  .object({
    length_km: z.number().positive().max(300).optional(),
    physical_medium_id: z.string().optional(),
    status: z.enum(["UP", "DOWN", "DEGRADED", "BLOCKING"]).optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided",
  });

const LinkOverrideSchema = z.object({
  admin_override_status: z.enum(["UP", "DOWN", "DEGRADED", "BLOCKING"]).nullable(),
});

const DeviceOverrideSchema = z.object({
  admin_override_status: z.enum(["UP", "DOWN", "DEGRADED", "BLOCKING"]).nullable(),
});

const OltVlanMappingSchema = z.object({
  ontId: z.string().min(1),
  cTag: z.number().int().min(1).max(4094),
  sTag: z.number().int().min(1).max(4094),
  serviceType: z.string().trim().min(1),
});

const SessionCreateSchema = z.object({
  interfaceId: z.string().min(1),
  bngDeviceId: z.string().min(1),
  serviceType: z.string().trim().min(1),
  protocol: z.string().trim().min(1),
  macAddress: z.string().trim().min(1),
});

const SessionPatchSchema = z.object({
  state: z.string().trim().min(1),
});

const SessionValidateVlanPathSchema = z.object({
  device_id: z.string().min(1),
  bng_device_id: z.string().min(1),
  c_tag: z.number().int().min(1).max(4094),
  s_tag: z.number().int().min(1).max(4094).optional(),
  service_type: z.string().trim().min(1),
});

const SessionListQuerySchema = z.object({
  device_id: z.string().trim().min(1).optional(),
  bng_device_id: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  service_type: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ForensicsTraceQuerySchema = z.object({
  ip: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  ts: z.string().datetime({ offset: true }),
});

const BatchCreateSchema = z.object({
  links: z.array(
    z.object({
      a_interface_id: z.string().min(1),
      b_interface_id: z.string().min(1),
      length_km: z.number().positive().max(300).optional(),
      physical_medium_id: z.string().optional(),
    })
  ),
  dry_run: z.boolean().optional(),
  skip_optical_recompute: z.boolean().optional(),
  request_id: z.string().optional(),
});

const BatchDeleteSchema = z.object({
  link_ids: z.array(z.string()),
  skip_optical_recompute: z.boolean().optional(),
  request_id: z.string().optional(),
});

const asyncRoute =
  <T extends express.RequestHandler>(handler: T): express.RequestHandler =>
  async (req, res, next) => {
    const requestId = requestContext.getStore()?.requestId;
    try {
      await handler(req, res, next);
      flushRealtimeOutbox(requestId);
    } catch (error) {
      clearRealtimeOutbox(requestId);
      next(error);
    }
  };

const buildError = (code: string, message: string, details?: Record<string, unknown>) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

const sendError = (
  res: express.Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) => {
  const requestId = requestContext.getStore()?.requestId;
  return res.status(status).json({ ...buildError(code, message, details), ...(requestId ? { request_id: requestId } : {}) });
};

const linkOverrides = new Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">();
const deviceOverrides = new Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">();

const canonicalPortRole = (portType: string): "PON" | "ACCESS" | "UPLINK" | "MANAGEMENT" | null => {
  const normalizedRole = portType.toUpperCase();
  if (normalizedRole === "PON") return "PON";
  if (normalizedRole === "ACCESS" || normalizedRole === "LAN") return "ACCESS";
  if (normalizedRole === "UPLINK" || normalizedRole === "TRUNK") return "UPLINK";
  if (normalizedRole === "MANAGEMENT" || normalizedRole === "MGMT") return "MANAGEMENT";
  return null;
};

const buildSyntheticMac = (deviceId: string, portNumber: number) => {
  const normalizedId = deviceId.replace(/-/g, "");
  const hash = `${normalizedId.slice(0, 6)}${normalizedId.slice(-2)}${portNumber.toString(16).padStart(2, "0")}`.padEnd(10, "0").slice(0, 10);
  return `02:${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${hash.slice(6, 8)}:${hash.slice(8, 10)}`.toLowerCase();
};

const buildManagementInterfaceMac = (deviceId: string) => buildSyntheticMac(deviceId, 99);
const SESSION_STATES = {
  INIT: "INIT",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  RELEASED: "RELEASED",
} as const;

const SERVICE_STATUSES = {
  UP: "UP",
  DOWN: "DOWN",
  DEGRADED: "DEGRADED",
} as const;

const REASON_CODES = {
  SESSION_NOT_ACTIVE: "SESSION_NOT_ACTIVE",
  BNG_UNREACHABLE: "BNG_UNREACHABLE",
  VLAN_PATH_INVALID: "VLAN_PATH_INVALID",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_POOL_EXHAUSTED: "SESSION_POOL_EXHAUSTED",
} as const;

const SUBSCRIBER_IPV4_SUPERNET = "100.64.0.0/10";
const SUBSCRIBER_IPV6_PD_SUPERNET = "2001:db8:1000::/36";
const SUBSCRIBER_IPV6_PD_DELEGATED_PREFIX_LEN = 56;
const CGNAT_PUBLIC_CIDR = "198.51.100.0/24";
const CGNAT_PORT_RANGE_START = 1024;
const CGNAT_PORTS_PER_SUBSCRIBER = 2048;
const CGNAT_RETENTION_DAYS = 184;

const buildInterfaceName = (role: string, portNumber: number) => {
  const upperRole = role.toUpperCase();
  if (upperRole === "MANAGEMENT" || upperRole === "MGMT") return "mgmt0";
  if (upperRole === "PON") return `pon${portNumber}`;
  if (upperRole === "UPLINK" || upperRole === "TRUNK") return `uplink${portNumber}`;
  if (upperRole === "ACCESS" || upperRole === "LAN") return `access${portNumber}`;
  if (upperRole === "IN") return `in${portNumber}`;
  if (upperRole === "OUT") return `out${portNumber}`;
  return `if${portNumber}`;
};

const isManagementPortType = (portType: string) => {
  const normalized = portType.toUpperCase();
  return normalized === "MANAGEMENT" || normalized === "MGMT";
};

const isContainerType = (type: string) => {
  const normalized = normalizeDeviceType(type);
  return normalized === "POP" || normalized === "CORE_SITE";
};

const isOntFamily = (type: string) => {
  const normalized = normalizeDeviceType(type);
  return normalized === "ONT" || normalized === "BUSINESS_ONT";
};

const isSubscriberDeviceType = (type: string) => {
  const normalized = normalizeDeviceType(type);
  return normalized === "ONT" || normalized === "BUSINESS_ONT" || normalized === "AON_CPE";
};

const buildDeterministicSubscriberPrivateIp = (sessionId: string) => {
  const factor = deterministicFactor(`${TRAFFIC_RANDOM_SEED}:${sessionId}:private-ip`);
  const hostIndex = Math.floor(factor * 65534);
  const thirdOctet = Math.floor(hostIndex / 254);
  const fourthOctet = (hostIndex % 254) + 1;
  return `100.64.${thirdOctet}.${fourthOctet}`;
};

const signalStatusFromRuntimeStatus = (status: MetricPoint["status"]): "OK" | "WARNING" | "NO_SIGNAL" => {
  if (status === "UP") return "OK";
  if (status === "DEGRADED") return "WARNING";
  return "NO_SIGNAL";
};

const isOltOntPair = (aType: string, bType: string) => {
  const a = normalizeDeviceType(aType);
  const b = normalizeDeviceType(bType);
  return (a === "OLT" && (b === "ONT" || b === "BUSINESS_ONT")) || ((a === "ONT" || a === "BUSINESS_ONT") && b === "OLT");
};

const PROVISIONABLE_TYPES = new Set<DeviceType>([
  "BACKBONE_GATEWAY",
  "CORE_ROUTER",
  "EDGE_ROUTER",
  "OLT",
  "AON_SWITCH",
  "ONT",
  "BUSINESS_ONT",
  "AON_CPE",
  "SWITCH",
]);

const PASSIVE_INLINE_TYPES = new Set<DeviceType>(["ODF", "SPLITTER", "NVT", "HOP"]);
const ROUTER_CLASS_TYPES = new Set<DeviceType>(["BACKBONE_GATEWAY", "CORE_ROUTER", "EDGE_ROUTER"]);
const ALWAYS_ONLINE_TYPES = new Set<DeviceType>(["BACKBONE_GATEWAY", "POP", "CORE_SITE"]);
const runtimeStatusDeps = {
  defaultType: "SWITCH",
  passableInlineTypes: PASSIVE_INLINE_TYPES,
  routerClassTypes: ROUTER_CLASS_TYPES,
  alwaysOnlineTypes: ALWAYS_ONLINE_TYPES,
  isSubscriberDeviceType,
  normalizeDeviceType,
  normalizeDeviceStatus,
  normalizeLinkStatus,
  hasDeviceOverride: (deviceId: string) => deviceOverrides.has(deviceId),
} as const;
const readModelDeps = {
  buildPassabilityState: <
    TDevice extends { id: string; type: string; status: string; provisioned?: boolean | null },
    TLink extends { status: string; sourcePort: { deviceId: string }; targetPort: { deviceId: string } }
  >(
    devices: TDevice[],
    links: TLink[]
  ) => buildPassabilityState(devices, links, runtimeStatusDeps),
  evaluateDeviceRuntimeStatus: (
    snapshot: {
      adjacency: Map<string, string[]>;
      typeById: Map<string, DeviceType>;
      statusById: Map<string, DeviceStatus>;
      provisionedById: Map<string, boolean>;
    },
    device: { id: string; type: string; status: string; provisioned?: boolean | null }
  ) => evaluateDeviceRuntimeStatus(snapshot, device, runtimeStatusDeps),
  normalizeDeviceType,
  normalizeDeviceStatus,
  normalizeLinkStatus,
} as const;

const hasPathWithPolicy = (
  startId: string,
  adjacency: Map<string, string[]>,
  typeById: Map<string, DeviceType>,
  isTarget: (type: DeviceType) => boolean,
  isAllowedIntermediate: (type: DeviceType) => boolean
) => {
  const queue: string[] = [startId];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      const nextType = typeById.get(next);
      if (!nextType) continue;
      if (isTarget(nextType)) return true;
      if (!isAllowedIntermediate(nextType)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return false;
};

export const ensureNoPrimaryIpExists = async (
  tx: Prisma.TransactionClient,
  interfaceId: string,
  vrf: string,
  excludeId?: string
) => {
  const existingPrimary = await tx.ipAddress.findFirst({
    where: {
      interfaceId,
      vrf,
      isPrimary: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existingPrimary) {
    throw Object.assign(new Error("Primary IP already exists for interface and VRF"), {
      code: "DUPLICATE_PRIMARY_IP",
      status: 409,
    });
  }
};

const createIpAddressWithPrimaryGuard = async (
  tx: Prisma.TransactionClient,
  data: {
    interfaceId: string;
    ip: string;
    prefixLen: number;
    isPrimary: boolean;
    vrf: string;
  }
) => {
  if (data.isPrimary) {
    await ensureNoPrimaryIpExists(tx, data.interfaceId, data.vrf);
  }

  return tx.ipAddress.create({ data });
};

const {
  deriveSessionTariff,
  createCgnatMappingForSession,
  allocateSubscriberIpv4ForSession,
  allocateSubscriberIpv6PdForSession,
  closeOpenCgnatMappings,
  ensureSessionVlanPathValid,
  validateVlanPath,
  cascadeBngFailure,
  recoverBngSessions,
  expireLeasedOutSessions,
} = createSessionService({
  prisma,
  normalizeDeviceType,
  isSubscriberDeviceType,
  buildDeviceAdjacency,
  buildPassabilityState: <
    TDevice extends { id: string; type: string; status: string; provisioned?: boolean | null },
    TLink extends { status: string; sourcePort: { deviceId: string }; targetPort: { deviceId: string } }
  >(
    devices: TDevice[],
    links: TLink[]
  ) => buildPassabilityState(devices, links, runtimeStatusDeps),
  hasSubscriberUpstreamViability: (
    deviceId,
    subscriberType,
    bngDeviceId,
    adjacency,
    typeById,
    statusById,
    provisionedById,
    deps
  ) =>
    hasSubscriberUpstreamViability(
      deviceId,
      subscriberType,
      bngDeviceId,
      adjacency,
      typeById,
      statusById,
      provisionedById,
      deps
    ),
  findServingOltForLeaf,
  passiveInlineTypes: PASSIVE_INLINE_TYPES,
  routerClassTypes: ROUTER_CLASS_TYPES,
  parseIpv4Cidr,
  parseIpv6Cidr,
  deterministicPrivateIp: buildDeterministicSubscriberPrivateIp,
  emitEvent,
  tariffs: TARIFFS,
  sessionStates: SESSION_STATES,
  serviceStatuses: SERVICE_STATUSES,
  reasonCodes: REASON_CODES,
  cgnatPublicCidr: CGNAT_PUBLIC_CIDR,
  cgnatPortRangeStart: CGNAT_PORT_RANGE_START,
  cgnatPortsPerSubscriber: CGNAT_PORTS_PER_SUBSCRIBER,
  cgnatRetentionDays: CGNAT_RETENTION_DAYS,
  defaultLeaseSeconds: 86400,
  subscriberIpv4Supernet: SUBSCRIBER_IPV4_SUPERNET,
  subscriberIpv6PdSupernet: SUBSCRIBER_IPV6_PD_SUPERNET,
  subscriberIpv6PdDelegatedPrefixLen: SUBSCRIBER_IPV6_PD_DELEGATED_PREFIX_LEN,
});

const { validateLinkCreation, createLinkInternal, deleteLinkInternal, runBatchCreate } = createLinkService({
  prisma,
  isContainerType,
  isOltOntPair,
  normalizeDeviceType,
  routerClassTypes: ROUTER_CLASS_TYPES,
  fiberTypeDbPerKm: FIBER_TYPE_DB_PER_KM,
  isIpInCidr,
  parseIpv4Cidr,
  ipv4ToInt,
  intToIpv4,
  buildInterfaceName,
  canonicalPortRole,
  buildSyntheticMac,
  createIpAddressWithPrimaryGuard,
  bumpTopologyVersion,
  emitEvent,
});

const portSummaryService = createPortSummaryService({
  prisma,
  normalizeDeviceType,
  canonicalPortRole,
  isOntFamily,
  passiveInlineTypes: PASSIVE_INLINE_TYPES,
  getTopologyVersion: () => topologyVersion,
  hardwareCatalog: HARDWARE_CATALOG,
});

const getPortsSummaryCacheStats = () => portSummaryService.getCacheStats();
const resetPortsSummaryCacheStats = () => portSummaryService.resetCacheStats();

const createPortsForDevice = async (
  deviceId: string,
  type: DeviceType,
  options?: { includeManagement?: boolean }
) => {
  const includeManagement = options?.includeManagement ?? false;
  const ports: Array<{ deviceId: string; portNumber: number; portType: string; status: string }> = [];

  if (type === "OLT") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    if (includeManagement) {
      ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
    }
    for (let i = 1; i <= 4; i += 1) {
      ports.push({ deviceId, portNumber: i, portType: "PON", status: "UP" });
    }
  } else if (type === "ONT" || type === "BUSINESS_ONT") {
    ports.push({ deviceId, portNumber: 0, portType: "PON", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "LAN", status: "UP" });
    if (includeManagement) {
      ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
    }
  } else if (type === "AON_CPE") {
    ports.push({ deviceId, portNumber: 0, portType: "ACCESS", status: "UP" });
    if (includeManagement) {
      ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
    }
  } else if (type === "SPLITTER") {
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    for (let i = 1; i <= 8; i += 1) {
      ports.push({ deviceId, portNumber: i, portType: "OUT", status: "UP" });
    }
  } else if (type === "SWITCH" || type === "AON_SWITCH" || type === "CORE_ROUTER" || type === "EDGE_ROUTER") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    if (includeManagement) {
      ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
    }
    for (let i = 1; i <= 8; i += 1) {
      ports.push({ deviceId, portNumber: i, portType: "ACCESS", status: "UP" });
    }
  } else if (type === "ODF" || type === "HOP") {
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "OUT", status: "UP" });
  } else if (type === "NVT") {
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "OUT", status: "UP" });
  } else if (type === "BACKBONE_GATEWAY") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    if (includeManagement) {
      ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
    }
  }

  if (ports.length > 0) {
    await prisma.port.createMany({ data: ports });
  }
};

registerReadRoutes({
  app,
  asyncRoute,
  prisma,
  getTopologyVersion: () => topologyVersion,
  getLatestMetrics: () => getLatestMetrics(),
  buildRuntimeStatusByDeviceId: (devices, links) => buildRuntimeStatusByDeviceId(devices, links, readModelDeps),
  buildContainerAggregateById: (devices, runtimeStatusById, latestMetrics) =>
    buildContainerAggregateById(devices, runtimeStatusById, latestMetrics, readModelDeps),
  mapDeviceToNode: (device, runtimeStatusById, containerAggregateById) =>
    mapDeviceToNode(device, readModelDeps, runtimeStatusById, containerAggregateById),
  mapDeviceToApi: (device, runtimeStatusById, containerAggregateById) =>
    mapDeviceToApi(device, readModelDeps, runtimeStatusById, containerAggregateById),
  mapLinkToEdge: (link) => mapLinkToEdge(link, normalizeLinkStatus),
  mapLinkToApi: (link) => mapLinkToApi(link, normalizeLinkStatus),
  sendError,
});
registerDiagnosticRoutes({
  app,
  asyncRoute,
  prisma,
  sendError,
  portSummaryService,
  normalizeDeviceType,
  canonicalPortRole,
  buildInterfaceName,
  buildSyntheticMac,
  fiberTypes: FIBER_TYPES,
  getTopologyVersion: () => topologyVersion,
  getMetricTickSeq: () => getMetricTickSeq(),
  getLatestMetrics: () => getLatestMetrics(),
  getTrafficEnabled: () => process.env.TRAFFIC_ENABLED !== "false",
  getTrafficIntervalMs: () => TRAFFIC_INTERVAL_MS,
  isTrafficRunning: () => Boolean(trafficTimer),
  computeDeviceDiagnostics: (deviceId) => computeDeviceDiagnostics(deviceId),
  buildDeviceAdjacency,
  findServingOltForLeaf,
  passiveInlineTypes: PASSIVE_INLINE_TYPES,
  parseIpv4Cidr,
  parseIpv6Cidr,
});
registerDeviceMutationRoutes({
  app,
  asyncRoute,
  prisma,
  parseDeviceCreate: (body) => DeviceCreateSchema.parse(body),
  parseDevicePatch: (body) => DevicePatchSchema.parse(body),
  createPortsForDevice,
  deleteLinkInternal,
  cascadeBngFailure,
  recoverBngSessions,
  bumpTopologyVersion,
  emitEvent,
  normalizeDeviceStatus,
  normalizeDeviceType,
  sendError,
});
registerDeviceOpsRoutes({
  app,
  asyncRoute,
  prisma,
  parseOltVlanMapping: (body) => OltVlanMappingSchema.parse(body),
  parseDeviceOverride: (body) => DeviceOverrideSchema.parse(body),
  sendError,
  normalizeDeviceType,
  normalizeDeviceStatus,
  provisionableTypes: PROVISIONABLE_TYPES,
  passiveInlineTypes: PASSIVE_INLINE_TYPES,
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
});

registerLinkMutationRoutes({
  app,
  asyncRoute,
  prisma,
  parseLinkCreate: (body) => LinkCreateSchema.parse(body),
  parseBatchCreate: (body) => BatchCreateSchema.parse(body),
  parseBatchDelete: (body) => BatchDeleteSchema.parse(body),
  parseLinkUpdate: (body) => LinkUpdateSchema.parse(body),
  parseLinkOverride: (body) => LinkOverrideSchema.parse(body),
  createLinkInternal,
  deleteLinkInternal,
  runBatchCreate,
  mapLinkEventPayload,
  mapLinkToApi,
  normalizeLinkStatus,
  normalizeDeviceStatus,
  sendError,
  bumpTopologyVersion,
  emitEvent,
  linkOverrides,
  fiberTypeDbPerKm: FIBER_TYPE_DB_PER_KM,
});

registerSessionRoutes({
  app,
  asyncRoute,
  prisma,
  parseSessionCreate: (body) => SessionCreateSchema.parse(body),
  parseSessionListQuery: (query) => SessionListQuerySchema.parse(query),
  parseSessionPatch: (body) => SessionPatchSchema.parse(body),
  parseSessionValidateVlanPath: (body) => SessionValidateVlanPathSchema.parse(body),
  parseForensicsTraceQuery: (query) => ForensicsTraceQuerySchema.parse(query),
  sendError,
  isSubscriberDeviceType,
  normalizeDeviceType,
  ensureSessionVlanPathValid,
  validateVlanPath,
  createCgnatMappingForSession,
  allocateSubscriberIpv4ForSession,
  allocateSubscriberIpv6PdForSession,
  closeOpenCgnatMappings,
  buildDeviceAdjacency,
  findServingOltForLeaf,
  deriveSessionTariff,
  emitEvent,
  passiveInlineTypes: PASSIVE_INLINE_TYPES,
  sessionStates: SESSION_STATES,
  serviceStatuses: SERVICE_STATUSES,
  reasonCodes: REASON_CODES,
});

registerCatalogRoutes({
  app,
  asyncRoute,
  prisma,
  sendError,
  hardwareCatalog: HARDWARE_CATALOG,
  tariffs: TARIFFS,
  ipamPrefixes: IPAM_PREFIXES,
  ipamRoleForDeviceType,
});

const { resolveOpticalPathForDevice } = createOpticalPathService({
  prisma,
  normalizeDeviceType,
  fiberTypeDbPerKm: FIBER_TYPE_DB_PER_KM,
  passiveInsertionLossDb: PASSIVE_INSERTION_LOSS_DB,
});

app.get(
  "/api/devices/:id/optical-path",
  asyncRoute(async (req, res) => {
    const result = await resolveOpticalPathForDevice(req.params.id);
    if (!result) {
      return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
    }
    return res.json(result);
  })
);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof z.ZodError) {
    return sendError(res, 400, "VALIDATION_ERROR", "Validation failed", { issues: err.issues });
  }

  console.error(err);
  return sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
});

const deterministicFactor = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

const GPON_DOWNSTREAM_CAPACITY_MBPS = 2500;
const GPON_UPSTREAM_CAPACITY_MBPS = 1250;
const STRICT_PRIORITY_VOICE_MBPS = 0.1;
const STRICT_PRIORITY_IPTV_MBPS = 10;
const BEST_EFFORT_INTERNET_MIN_MBPS = 80;
const BEST_EFFORT_INTERNET_BURST_MBPS = 120;
const LEAF_ACCESS_CAPACITY_MBPS = 1000;

const buildPassableAdjacencySnapshot = async () => {
  const [devices, links] = await Promise.all([
    prisma.device.findMany(),
    prisma.link.findMany({
      include: {
        sourcePort: { include: { device: true } },
        targetPort: { include: { device: true } },
      },
    }),
  ]);

  return {
    devices,
    ...buildPassabilityState(devices, links, runtimeStatusDeps),
  };
};

const computeDeviceDiagnostics = async (deviceId: string) => {
  const snapshot = await buildPassableAdjacencySnapshot();
  const device = snapshot.devices.find((candidate) => candidate.id === deviceId);
  if (!device) return null;

  return computeDeviceDiagnosticsFromSnapshot(snapshot, device, runtimeStatusDeps);
};

const {
  clampDownstreamDemands,
  resetSimulationState,
  runTrafficSimulationTick,
  getMetricTickSeq,
  getLatestMetrics,
} = createSimulationService({
  prisma,
  trafficRandomSeed: TRAFFIC_RANDOM_SEED,
  emitEvent,
  flushRealtimeOutbox,
  deterministicFactor,
  normalizeDeviceType,
  isSubscriberDeviceType,
  deriveSessionTariff,
  buildPassabilityState,
  evaluateDeviceRuntimeStatus,
  resolveSubscriberSegment,
  hasSubscriberUpstreamViability,
  signalStatusFromRuntimeStatus,
  runtimeStatusDeps,
  passiveInlineTypes: PASSIVE_INLINE_TYPES,
  expireLeasedOutSessions,
  sessionStates: SESSION_STATES,
  gponDownstreamCapacityMbps: GPON_DOWNSTREAM_CAPACITY_MBPS,
  gponUpstreamCapacityMbps: GPON_UPSTREAM_CAPACITY_MBPS,
  strictPriorityVoiceMbps: STRICT_PRIORITY_VOICE_MBPS,
  strictPriorityIptvMbps: STRICT_PRIORITY_IPTV_MBPS,
  bestEffortInternetMinMbps: BEST_EFFORT_INTERNET_MIN_MBPS,
  bestEffortInternetBurstMbps: BEST_EFFORT_INTERNET_BURST_MBPS,
  leafAccessCapacityMbps: LEAF_ACCESS_CAPACITY_MBPS,
});

export { clampDownstreamDemands, resetSimulationState, runTrafficSimulationTick, getPortsSummaryCacheStats, resetPortsSummaryCacheStats };

const startTrafficLoop = () => {
  if (trafficTimer) return;

  trafficTimer = setInterval(async () => {
    try {
      await runTrafficSimulationTick();
    } catch (error) {
      console.error("Simulation error:", error);
    }
  }, TRAFFIC_INTERVAL_MS);
};

export const stopTrafficLoop = () => {
  if (trafficTimer) {
    clearInterval(trafficTimer);
    trafficTimer = null;
  }
};

export const start = async () => {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: path.resolve(__dirname, "client"),
      configFile: path.resolve(__dirname, "client/vite.config.ts"),
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "client/dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(__dirname, "client/dist/index.html"));
    });
  }

  startTrafficLoop();

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

if (process.env.NODE_ENV !== "test") {
  start();
}

export { app, io, prisma, httpServer };

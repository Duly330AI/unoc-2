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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./prisma/dev.db";
}

const prisma = new PrismaClient();
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
  rxPower: number;
  status: Exclude<DeviceStatus, "BLOCKING">;
  metric_tick_seq: number;
};

const latestMetrics = new Map<string, MetricPoint>();
const segmentCongestionState = new Map<string, boolean>();
let trafficTimer: NodeJS.Timeout | null = null;
let topologyVersion = 1;
let metricTickSeq = 0;

const bumpTopologyVersion = () => {
  topologyVersion += 1;
  return topologyVersion;
};

const emitEvent = (kind: string, payload: unknown, includeTopoVersion = true, correlationId?: string) => {
  const requestId = correlationId ?? requestContext.getStore()?.requestId;
  const envelope: Record<string, unknown> = {
    type: "event",
    kind,
    payload,
    ts: new Date().toISOString(),
    ...(requestId ? { correlation_id: requestId } : {}),
  };

  if (includeTopoVersion) {
    envelope.topo_version = topologyVersion;
  }

  io.emit("event", envelope);
};

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  const requestId = (req.header("x-request-id") || req.header("x-correlation-id") || randomUUID()).toString();
  requestContext.run({ requestId }, next);
});

const DeviceCreateSchema = z.object({
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
  parentId: z.string().optional(),
});

const DevicePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    status: z.enum(["UP", "DOWN", "DEGRADED", "BLOCKING"]).optional(),
  })
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
  cTag: z.number().int().min(1).max(4094),
  sTag: z.number().int().min(1).max(4094),
  serviceType: z.string().trim().min(1),
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
    try {
      await handler(req, res, next);
    } catch (error) {
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

const validateLinkCreation = async (
  sourcePortId: string,
  targetPortId: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) => {
  if (sourcePortId === targetPortId) {
    return { ok: false as const, status: 400, code: "VALIDATION_ERROR", message: "a_interface_id and b_interface_id must be different" };
  }

  const [sourcePort, targetPort] = await Promise.all([
    db.port.findUnique({ where: { id: sourcePortId }, include: { device: true } }),
    db.port.findUnique({ where: { id: targetPortId }, include: { device: true } }),
  ]);

  if (!sourcePort || !targetPort) {
    return { ok: false as const, status: 404, code: "INTERFACE_NOT_FOUND", message: "Source or target port not found" };
  }

  if (sourcePort.deviceId === targetPort.deviceId) {
    return { ok: false as const, status: 400, code: "INTERFACE_SAME_DEVICE", message: "Interfaces on the same device cannot be linked" };
  }

  if (isContainerType(sourcePort.device.type) || isContainerType(targetPort.device.type)) {
    return { ok: false as const, status: 400, code: "INVALID_LINK_TYPE", message: "Container endpoints are not valid link endpoints" };
  }

  if (isOltOntPair(sourcePort.device.type, targetPort.device.type)) {
    return { ok: false as const, status: 400, code: "INVALID_LINK_TYPE", message: "Direct OLT<->ONT links are forbidden in MVP" };
  }

  const occupied = await db.link.findFirst({
    where: {
      OR: [
        { sourcePortId },
        { targetPortId: sourcePortId },
        { sourcePortId: targetPortId },
        { targetPortId },
      ],
    },
  });

  if (occupied) {
    return { ok: false as const, status: 409, code: "INTERFACE_ALREADY_LINKED", message: "Port already occupied" };
  }

  return { ok: true as const, sourcePort, targetPort };
};

const getOrCreateVrf = async (tx: Prisma.TransactionClient, name: string, description: string) => {
  const existing = await tx.vrf.findUnique({ where: { name } });
  if (existing) return existing;
  return tx.vrf.create({
    data: {
      name,
      description,
    },
  });
};

const getOrCreatePortBackedInterface = async (
  tx: Prisma.TransactionClient,
  port: { deviceId: string; portNumber: number; portType: string; status: string }
) => {
  const name = buildInterfaceName(port.portType, port.portNumber);
  const existing = await tx.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: port.deviceId,
        name,
      },
    },
    include: { addresses: true },
  });
  if (existing) return existing;

  return tx.interface.create({
    data: {
      deviceId: port.deviceId,
      name,
      role: canonicalPortRole(port.portType) === "MANAGEMENT" ? "MGMT" : (canonicalPortRole(port.portType) ?? port.portType.toUpperCase()),
      status: port.status,
      macAddress: buildSyntheticMac(port.deviceId, port.portNumber),
    },
    include: { addresses: true },
  });
};

const allocateNextP2pPairInCidr = (cidr: string, allocatedIps: string[]) => {
  const { networkAddress, broadcastAddress } = parseIpv4Cidr(cidr);
  const allocated = new Set(allocatedIps.map((ip) => ipv4ToInt(ip)));

  for (let candidate = networkAddress; candidate + 1 <= broadcastAddress; candidate += 2) {
    if (!allocated.has(candidate) && !allocated.has(candidate + 1)) {
      return {
        firstIp: intToIpv4(candidate),
        secondIp: intToIpv4(candidate + 1),
        prefixLen: 31,
      };
    }
  }

  return null;
};

const createLinkInternal = async (payload: {
  a_interface_id: string;
  b_interface_id: string;
  length_km?: number;
  physical_medium_id?: string;
}) => {
  const validation = await validateLinkCreation(payload.a_interface_id, payload.b_interface_id);
  if (!validation.ok) {
    return validation;
  }

  const mediumId = payload.physical_medium_id ?? "G.652.D";
  if (FIBER_TYPE_DB_PER_KM[mediumId] === undefined) {
    return { ok: false as const, status: 400, code: "FIBER_TYPE_INVALID", message: `Invalid physical medium: ${mediumId}` };
  }

  const fiberLength = payload.length_km ?? 10;
  const sourceType = normalizeDeviceType(validation.sourcePort.device.type);
  const targetType = normalizeDeviceType(validation.targetPort.device.type);
  const isRouterPair =
    sourceType !== undefined &&
    targetType !== undefined &&
    ROUTER_CLASS_TYPES.has(sourceType) &&
    ROUTER_CLASS_TYPES.has(targetType);

  try {
    const link = await prisma.$transaction(async (tx) => {
      const txValidation = await validateLinkCreation(payload.a_interface_id, payload.b_interface_id, tx);
      if (!txValidation.ok) {
        throw Object.assign(new Error(txValidation.message), {
          code: txValidation.code,
          status: txValidation.status,
        });
      }

      if (isRouterPair) {
        const infraVrf = await getOrCreateVrf(tx, "infra_vrf", "Infrastructure transit VRF");
        let pool = await tx.ipPool.findUnique({ where: { poolKey: "p2p" } });
        if (!pool) {
          pool = await tx.ipPool.create({
            data: {
              name: "p2p",
              poolKey: "p2p",
              type: "P2P",
              cidr: "10.250.255.0/24",
              vrfId: infraVrf.id,
            },
          });
        }

        const allocatedP2pAddresses = await tx.ipAddress.findMany({
          select: { ip: true },
        });
        const allocatedIps = allocatedP2pAddresses
          .map((address) => address.ip)
          .filter((ip) => isIpInCidr(ip, pool.cidr));

        const nextPair = allocateNextP2pPairInCidr(pool.cidr, allocatedIps);
        if (!nextPair) {
          throw Object.assign(new Error("P2P supernet exhausted"), { code: "P2P_SUPERNET_EXHAUSTED", status: 409 });
        }

        const sourceInterface = await getOrCreatePortBackedInterface(tx, txValidation.sourcePort);
        const targetInterface = await getOrCreatePortBackedInterface(tx, txValidation.targetPort);

        const ordered = [
          { deviceId: txValidation.sourcePort.deviceId, interfaceId: sourceInterface.id },
          { deviceId: txValidation.targetPort.deviceId, interfaceId: targetInterface.id },
        ].sort((a, b) => a.deviceId.localeCompare(b.deviceId));

        const assignmentByInterfaceId = new Map<string, string>([
          [ordered[0].interfaceId, nextPair.firstIp],
          [ordered[1].interfaceId, nextPair.secondIp],
        ]);

        await tx.ipAddress.createMany({
          data: [
            {
              interfaceId: sourceInterface.id,
              ip: assignmentByInterfaceId.get(sourceInterface.id)!,
              prefixLen: nextPair.prefixLen,
              isPrimary: true,
              vrf: "infra_vrf",
            },
            {
              interfaceId: targetInterface.id,
              ip: assignmentByInterfaceId.get(targetInterface.id)!,
              prefixLen: nextPair.prefixLen,
              isPrimary: true,
              vrf: "infra_vrf",
            },
          ],
        });
      }

      return tx.link.create({
        data: {
          sourcePortId: payload.a_interface_id,
          targetPortId: payload.b_interface_id,
          fiberLength,
          fiberType: mediumId,
          status: "UP",
        },
        include: { sourcePort: true, targetPort: true },
      });
    });

    return { ok: true as const, link };
  } catch (error) {
    const code = (error as any)?.code;
    const status = (error as any)?.status;
    if (typeof code === "string" && typeof status === "number") {
      return { ok: false as const, status, code, message: (error as Error).message };
    }
    throw error;
  }
};

const runBatchCreate = async (payload: z.infer<typeof BatchCreateSchema>) => {
  const startedAt = Date.now();
  const dryRun = payload.dry_run ?? false;
  const requestId = payload.request_id ?? null;
  const createdIds: string[] = [];
  const failedLinks: Array<{ index: number; a_interface_id?: string; b_interface_id?: string; error_code: string; error_message: string }> = [];

  for (let i = 0; i < payload.links.length; i += 1) {
    const candidate = payload.links[i];
    const a_interface_id = candidate.a_interface_id;
    const b_interface_id = candidate.b_interface_id;
    const physical_medium_id = candidate.physical_medium_id;

    if (dryRun) {
      const validation = await validateLinkCreation(a_interface_id, b_interface_id);
      if (!validation.ok) {
        failedLinks.push({
          index: i,
          a_interface_id,
          b_interface_id,
          error_code: validation.code,
          error_message: validation.message,
        });
      }
      continue;
    }

    const created = await createLinkInternal({ a_interface_id, b_interface_id, length_km: candidate.length_km, physical_medium_id });
    if (!created.ok) {
      failedLinks.push({
        index: i,
        a_interface_id,
        b_interface_id,
        error_code: created.code,
        error_message: created.message,
      });
      continue;
    }
    createdIds.push(created.link.id);
  }

  if (!dryRun && createdIds.length > 0) {
    bumpTopologyVersion();
    emitEvent("batchCompleted", { request_id: requestId, created_link_ids: createdIds, failed_links: failedLinks });
  }

  return {
    created_link_ids: createdIds,
    failed_links: failedLinks,
    total_requested: payload.links.length,
    total_created: createdIds.length,
    duration_ms: Date.now() - startedAt,
    request_id: requestId,
    backend: "native",
    dry_run: dryRun,
  };
};

const summarizePortsForDevice = async (deviceId: string) => {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return null;

  const ports = await prisma.port.findMany({ where: { deviceId }, include: { outgoingLink: true, incomingLink: true } });

  const byRole: Record<string, { total: number; used: number; max_subscribers?: number }> = {
    PON: { total: 0, used: 0, max_subscribers: 64 },
    ACCESS: { total: 0, used: 0 },
    UPLINK: { total: 0, used: 0 },
    MANAGEMENT: { total: 0, used: 0 },
  };

  for (const port of ports) {
    const role = canonicalPortRole(port.portType);
    if (!role) continue;
    byRole[role].total += 1;

    if (role === "MANAGEMENT") {
      byRole[role].used = 1;
    } else {
      const isUsed = Boolean(port.outgoingLink || port.incomingLink);
      if (isUsed) byRole[role].used += 1;
    }
  }

  if (normalizeDeviceType(device.type) === "OLT" && byRole.PON.total > 0) {
    const links = await prisma.link.findMany({
      include: {
        sourcePort: { include: { device: true } },
        targetPort: { include: { device: true } },
      },
    });
    const ontIds = new Set<string>();
    for (const link of links) {
      const a = link.sourcePort;
      const b = link.targetPort;
      const aType = normalizeDeviceType(a.device.type);
      const bType = normalizeDeviceType(b.device.type);
      if (a.deviceId === device.id && isOntFamily(b.device.type)) ontIds.add(b.deviceId);
      if (b.deviceId === device.id && isOntFamily(a.device.type)) ontIds.add(a.deviceId);
    }
    byRole.PON.used = ontIds.size;
  }

  const total = Object.values(byRole).reduce((acc, role) => acc + role.total, 0);
  return { device_id: deviceId, total, by_role: byRole };
};

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

const mapDeviceToNode = (device: any) => ({
  id: device.id,
  type: "device",
  position: { x: device.x, y: device.y },
  data: {
    id: device.id,
    name: device.name,
    label: device.name,
    type: normalizeDeviceType(device.type) ?? device.type,
    status: normalizeDeviceStatus(device.status),
    ports: device.ports,
  },
});

const mapLinkToEdge = (link: any) => ({
  id: link.id,
  source: link.sourcePort.deviceId,
  target: link.targetPort.deviceId,
  sourceHandle: link.sourcePortId,
  targetHandle: link.targetPortId,
  type: "smoothstep",
  data: {
    length_km: link.fiberLength,
    physical_medium_id: link.fiberType,
    status: normalizeLinkStatus(link.status),
  },
});

const mapLinkToApi = (link: any) => ({
  ...link,
  status: normalizeLinkStatus(link.status),
  a_interface_id: link.sourcePortId,
  b_interface_id: link.targetPortId,
  a_device_id: link.sourcePort?.deviceId,
  b_device_id: link.targetPort?.deviceId,
  length_km: link.fiberLength,
  physical_medium_id: link.fiberType,
});

const mapLinkEventPayload = (link: any) => ({
  id: link.id,
  a_interface_id: link.sourcePortId,
  b_interface_id: link.targetPortId,
  a_device_id: link.sourcePort?.deviceId,
  b_device_id: link.targetPort?.deviceId,
  length_km: link.fiberLength,
  physical_medium_id: link.fiberType,
  effective_status: normalizeLinkStatus(link.status),
  status: normalizeLinkStatus(link.status),
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", topologyVersion, metricTickSeq });
});

app.get(
  "/api/topology",
  asyncRoute(async (_req, res) => {
    const devices = await prisma.device.findMany({ include: { ports: true } });
    const links = await prisma.link.findMany({ include: { sourcePort: true, targetPort: true } });

    res.json({
      topo_version: topologyVersion,
      nodes: devices.map(mapDeviceToNode),
      edges: links.map(mapLinkToEdge),
    });
  })
);

app.get(
  "/api/devices",
  asyncRoute(async (_req, res) => {
    const devices = await prisma.device.findMany({ include: { ports: true } });
    res.json(
      devices.map((device) => ({
        ...device,
        type: normalizeDeviceType(device.type) ?? device.type,
        status: normalizeDeviceStatus(device.status),
      }))
    );
  })
);

app.get(
  "/api/devices/:id",
  asyncRoute(async (req, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id }, include: { ports: true } });

    if (!device) {
      return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
    }

    return res.json({
      ...device,
      type: normalizeDeviceType(device.type) ?? device.type,
      status: normalizeDeviceStatus(device.status),
    });
  })
);

app.post(
  "/api/devices",
  asyncRoute(async (req, res) => {
    const payload = DeviceCreateSchema.parse(req.body);

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
    const payload = DevicePatchSchema.parse(req.body);
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

    bumpTopologyVersion();
    emitEvent("deviceUpdated", { ...updated, status: normalizeDeviceStatus(updated.status) });
    return res.json({ ...updated, status: normalizeDeviceStatus(updated.status) });
  })
);

app.post(
  "/api/devices/:id/vlan-mappings",
  asyncRoute(async (req, res) => {
    const payload = OltVlanMappingSchema.parse(req.body);
    const id = req.params.id;
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) {
      return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
    }

    if (normalizeDeviceType(device.type) !== "OLT") {
      return sendError(res, 400, "VALIDATION_ERROR", "VLAN mappings can only be configured on OLT devices");
    }

    const existing = await prisma.oltVlanTranslation.findUnique({
      where: {
        deviceId_cTag: {
          deviceId: id,
          cTag: payload.cTag,
        },
      },
    });

    const mapping = await prisma.oltVlanTranslation.upsert({
      where: {
        deviceId_cTag: {
          deviceId: id,
          cTag: payload.cTag,
        },
      },
      update: {
        sTag: payload.sTag,
        serviceType: payload.serviceType.toUpperCase(),
      },
      create: {
        deviceId: id,
        cTag: payload.cTag,
        sTag: payload.sTag,
        serviceType: payload.serviceType.toUpperCase(),
      },
    });

    return res.status(existing ? 200 : 201).json(mapping);
  })
);

app.post(
  "/api/devices/:id/provision",
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) {
      return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
    }

    const normalized = normalizeDeviceType(device.type);
    if (!normalized) {
      return sendError(res, 400, "VALIDATION_ERROR", `Unsupported device type: ${device.type}`);
    }

    if (!PROVISIONABLE_TYPES.has(normalized)) {
      return sendError(
        res,
        400,
        "INVALID_PROVISION_PATH",
        `Device type ${normalized} is not provisionable in MVP`
      );
    }

    const [devices, links] = await Promise.all([
      prisma.device.findMany({ select: { id: true, type: true } }),
      prisma.link.findMany({
        include: {
          sourcePort: { select: { deviceId: true } },
          targetPort: { select: { deviceId: true } },
        },
      }),
    ]);

    const typeById = new Map<string, DeviceType>();
    for (const candidate of devices) {
      const candidateType = normalizeDeviceType(candidate.type);
      if (!candidateType) continue;
      typeById.set(candidate.id, candidateType);
    }

    const adjacency = new Map<string, string[]>();
    for (const candidate of devices) {
      adjacency.set(candidate.id, []);
    }
    for (const link of links) {
      const a = link.sourcePort.deviceId;
      const b = link.targetPort.deviceId;
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a)!.push(b);
      adjacency.get(b)!.push(a);
    }

    if (normalized === "ONT" || normalized === "BUSINESS_ONT") {
      const hasPathToOlt = hasPathWithPolicy(
        id,
        adjacency,
        typeById,
        (type) => type === "OLT",
        (type) => PASSIVE_INLINE_TYPES.has(type)
      );

      if (!hasPathToOlt) {
        return sendError(
          res,
          400,
          "INVALID_PROVISION_PATH",
          "ONT provisioning requires strict reachable path to OLT via passive inline chain"
        );
      }
    }

    if (normalized === "AON_CPE") {
      const neighbors = adjacency.get(id) ?? [];
      const hasAonSwitchUpstream = neighbors.some((neighborId) => typeById.get(neighborId) === "AON_SWITCH");

      if (!hasAonSwitchUpstream) {
        return sendError(
          res,
          400,
          "INVALID_PROVISION_PATH",
          "AON_CPE provisioning requires strict direct upstream link to AON_SWITCH"
        );
      }
    }

    if ((device as any).provisioned) {
      return sendError(res, 409, "ALREADY_PROVISIONED", "Device is already provisioned");
    }

    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.device.findUnique({
          where: { id },
          include: {
            ports: true,
            interfaces: {
              include: { addresses: true },
            },
          },
        });
        if (!current) {
          throw Object.assign(new Error("Device not found"), { code: "DEVICE_NOT_FOUND" });
        }
        if ((current as any).provisioned) {
          throw Object.assign(new Error("Device already provisioned"), { code: "ALREADY_PROVISIONED" });
        }

        const mgmtPorts = current.ports.filter((port) => isManagementPortType(port.portType));
        if (mgmtPorts.length > 1) {
          throw Object.assign(new Error("Duplicate management interface"), { code: "DUPLICATE_MGMT_INTERFACE" });
        }

        if (mgmtPorts.length === 0) {
          const mgmtPortNumber = 99;
          await tx.port.create({
            data: { deviceId: id, portNumber: mgmtPortNumber, portType: "MANAGEMENT", status: "UP" },
          });
        }

        let mgmtInterface =
          current.interfaces.find((candidate) => candidate.name === "mgmt0") ??
          (await tx.interface.findUnique({
            where: {
              deviceId_name: {
                deviceId: id,
                name: "mgmt0",
              },
            },
            include: { addresses: true },
          }));

        if (!mgmtInterface) {
          mgmtInterface = await tx.interface.create({
            data: {
              deviceId: id,
              name: "mgmt0",
              role: "MGMT",
              status: "UP",
              macAddress: buildManagementInterfaceMac(id),
            },
            include: { addresses: true },
          });
        }

        const poolKey = ipamRoleForDeviceType(current.type);
        if (!poolKey) {
          throw Object.assign(new Error("No IPAM pool mapped for device type"), {
            code: "POOL_EXHAUSTED",
          });
        }

        const poolConfig = getIpamPrefixForRole(poolKey);
        if (!poolConfig) {
          throw Object.assign(new Error(`Missing IPAM prefix config for pool ${poolKey}`), {
            code: "POOL_EXHAUSTED",
          });
        }

        let vrf = await tx.vrf.findUnique({ where: { name: "mgmt_vrf" } });
        if (!vrf) {
          vrf = await tx.vrf.create({
            data: {
              name: "mgmt_vrf",
              description: "Management VRF",
            },
          });
        }

        let pool = await tx.ipPool.findUnique({ where: { poolKey } });
        if (!pool) {
          pool = await tx.ipPool.create({
            data: {
              name: poolKey,
              poolKey,
              type: "MANAGEMENT",
              cidr: poolConfig.cidr,
              vrfId: vrf.id,
            },
          });
        }

        const existingPrimaryAddress = mgmtInterface.addresses.find(
          (address) => address.isPrimary && address.vrf === "mgmt_vrf"
        );

        if (!existingPrimaryAddress) {
          const addressesInPool = await tx.ipAddress.findMany({
            where: { vrf: "mgmt_vrf" },
            select: { ip: true },
          });

          const allocated = addressesInPool
            .map((address) => address.ip)
            .filter((ip) => isIpInCidr(ip, pool.cidr));

          const nextAddress = allocateNextIpInCidr(pool.cidr, allocated);
          if (!nextAddress) {
            throw Object.assign(new Error(`IP pool exhausted for ${poolKey}`), {
              code: "POOL_EXHAUSTED",
            });
          }

          await tx.ipAddress.create({
            data: {
              interfaceId: mgmtInterface.id,
              ip: nextAddress.ip,
              prefixLen: nextAddress.prefixLen,
              isPrimary: true,
              vrf: "mgmt_vrf",
            },
          });
        }

        await tx.device.update({
          where: { id },
          data: { provisioned: true, status: "UP" } as any,
        });
      });
    } catch (error) {
      const errorCode = (error as any)?.code;
      if (errorCode === "DEVICE_NOT_FOUND") {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
      }
      if (errorCode === "ALREADY_PROVISIONED") {
        return sendError(res, 409, "ALREADY_PROVISIONED", "Device is already provisioned");
      }
      if (errorCode === "DUPLICATE_MGMT_INTERFACE") {
        return sendError(res, 400, "DUPLICATE_MGMT_INTERFACE", "Duplicate management interface");
      }
      if (errorCode === "POOL_EXHAUSTED") {
        return sendError(res, 409, "POOL_EXHAUSTED", "Management IP pool exhausted");
      }
      throw error;
    }

    bumpTopologyVersion();
    const refreshed = await prisma.device.findUniqueOrThrow({ where: { id }, include: { ports: true } });
    emitEvent("deviceProvisioned", { id: refreshed.id, ports: refreshed.ports.length });
    return res.json({ provisioned: true, id: refreshed.id, ports: refreshed.ports });
  })
);

app.patch(
  "/api/devices/:id/override",
  asyncRoute(async (req, res) => {
    const payload = DeviceOverrideSchema.parse(req.body);
    const id = req.params.id;
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) {
      return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
    }

    if (payload.admin_override_status === null) {
      deviceOverrides.delete(id);
      emitEvent("deviceOverrideChanged", { id, override: null });
      return res.json({ id, admin_override_status: null, status: normalizeDeviceStatus(device.status) });
    }

    deviceOverrides.set(id, payload.admin_override_status);
    const mappedStatus: DeviceStatus = payload.admin_override_status;

    const updated = await prisma.device.update({
      where: { id },
      data: { status: mappedStatus },
      include: { ports: true },
    });

    bumpTopologyVersion();
    emitEvent("deviceOverrideChanged", { id, override: payload.admin_override_status, status: mappedStatus });

    if (payload.admin_override_status === "UP") {
      const allDevices = await prisma.device.findMany({ select: { id: true, type: true } });
      const links = await prisma.link.findMany({
        include: {
          sourcePort: { select: { deviceId: true } },
          targetPort: { select: { deviceId: true } },
        },
      });

      const typeById = new Map<string, DeviceType>();
      for (const candidate of allDevices) {
        const candidateType = normalizeDeviceType(candidate.type);
        if (!candidateType) continue;
        typeById.set(candidate.id, candidateType);
      }

      const adjacency = new Map<string, string[]>();
      for (const candidate of allDevices) {
        adjacency.set(candidate.id, []);
      }
      for (const link of links) {
        const a = link.sourcePort.deviceId;
        const b = link.targetPort.deviceId;
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        adjacency.get(a)!.push(b);
        adjacency.get(b)!.push(a);
      }

      const deviceType = normalizeDeviceType(updated.type);
      let hasRequiredPath = true;
      if (deviceType === "ONT" || deviceType === "BUSINESS_ONT") {
        hasRequiredPath = hasPathWithPolicy(
          id,
          adjacency,
          typeById,
          (type) => type === "OLT",
          (type) => PASSIVE_INLINE_TYPES.has(type)
        );
      } else if (deviceType === "AON_CPE") {
        const neighbors = adjacency.get(id) ?? [];
        hasRequiredPath = neighbors.some((neighborId) => typeById.get(neighborId) === "AON_SWITCH");
      }

      if (!hasRequiredPath) {
        emitEvent("overrideConflict", {
          entity: "device",
          id,
          code: "OVERRIDE_CONFLICT",
          reason: "override_up_without_required_path",
        });
      }
    }
    return res.json({ id, admin_override_status: payload.admin_override_status, status: mappedStatus });
  })
);

app.get("/api/provision/matrix", (_req, res) => {
  res.json({
    items: [
      { device_type: "BACKBONE_GATEWAY", provision_allowed: false, mode: "implicit_seed" },
      { device_type: "CORE_ROUTER", provision_allowed: true, upstream: "BACKBONE_GATEWAY" },
      { device_type: "EDGE_ROUTER", provision_allowed: true, upstream: "CORE_ROUTER" },
      { device_type: "OLT", provision_allowed: true, upstream: "CORE_ROUTER" },
      { device_type: "AON_SWITCH", provision_allowed: true, upstream: "CORE_ROUTER" },
      { device_type: "ONT", provision_allowed: true, upstream: "OLT via passive chain" },
      { device_type: "BUSINESS_ONT", provision_allowed: true, upstream: "OLT via passive chain" },
      { device_type: "AON_CPE", provision_allowed: true, upstream: "direct AON_SWITCH" },
      { device_type: "POP", provision_allowed: false, mode: "container_only" },
      { device_type: "CORE_SITE", provision_allowed: false, mode: "container_only" },
      { device_type: "ODF", provision_allowed: false, mode: "passive_inline" },
      { device_type: "SPLITTER", provision_allowed: false, mode: "passive_inline" },
      { device_type: "NVT", provision_allowed: false, mode: "passive_inline" },
      { device_type: "HOP", provision_allowed: false, mode: "passive_inline" },
    ],
  });
});

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

app.get(
  "/api/links",
  asyncRoute(async (_req, res) => {
    const links = await prisma.link.findMany({ include: { sourcePort: true, targetPort: true } });
    res.json(links.map(mapLinkToApi));
  })
);

app.post(
  "/api/links",
  asyncRoute(async (req, res) => {
    const payload = LinkCreateSchema.parse(req.body);
    const created = await createLinkInternal({
      a_interface_id: payload.a_interface_id,
      b_interface_id: payload.b_interface_id,
      length_km: payload.length_km,
      physical_medium_id: payload.physical_medium_id,
    });
    if (!created.ok) {
      return sendError(res, created.status, created.code, created.message);
    }
    const link = created.link;

    bumpTopologyVersion();
    emitEvent("linkAdded", mapLinkEventPayload(link));
    return res.status(201).json(mapLinkToApi(link));
  })
);

app.post(
  "/api/links/batch",
  asyncRoute(async (req, res) => {
    const payload = BatchCreateSchema.parse(req.body);
    return res.json(await runBatchCreate(payload));
  })
);

app.post(
  "/api/links/batch/delete",
  asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    const payload = BatchDeleteSchema.parse(req.body);
    const requestId = payload.request_id ?? null;
    const ids = payload.link_ids;

    const deletedLinkIds: string[] = [];
    const failedLinks: Array<{ link_id?: string; error_code: string; error_message: string }> = [];

    for (const linkId of ids) {
      const exists = await prisma.link.findUnique({ where: { id: linkId } });
      if (!exists) {
        failedLinks.push({ link_id: linkId, error_code: "LINK_NOT_FOUND", error_message: "Link not found" });
        continue;
      }
      await prisma.link.delete({ where: { id: linkId } });
      deletedLinkIds.push(linkId);
    }

    if (deletedLinkIds.length > 0) {
      bumpTopologyVersion();
      emitEvent("batchCompleted", { request_id: requestId, deleted_link_ids: deletedLinkIds, failed_links: failedLinks });
    }

    return res.json({
      deleted_link_ids: deletedLinkIds,
      failed_links: failedLinks,
      total_requested: ids.length,
      total_deleted: deletedLinkIds.length,
      duration_ms: Date.now() - startedAt,
      request_id: requestId,
      backend: "native",
    });
  })
);

app.patch(
  "/api/links/:id",
  asyncRoute(async (req, res) => {
    const payload = LinkUpdateSchema.parse(req.body);
    const id = req.params.id;
    const exists = await prisma.link.findUnique({ where: { id } });
    if (!exists) {
      return sendError(res, 404, "LINK_NOT_FOUND", "Link not found");
    }

    const mediumId = payload.physical_medium_id;
    if (mediumId !== undefined && FIBER_TYPE_DB_PER_KM[mediumId] === undefined) {
      return sendError(res, 400, "FIBER_TYPE_INVALID", `Invalid physical medium: ${mediumId}`);
    }

    const updated = await prisma.link.update({
      where: { id },
      data: {
        ...(payload.length_km !== undefined ? { fiberLength: payload.length_km } : {}),
        ...(mediumId !== undefined ? { fiberType: mediumId } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
      },
      include: { sourcePort: true, targetPort: true },
    });

    bumpTopologyVersion();
    emitEvent("linkUpdated", mapLinkEventPayload(updated));
    return res.json(mapLinkToApi(updated));
  })
);

app.patch(
  "/api/links/:id/override",
  asyncRoute(async (req, res) => {
    const payload = LinkOverrideSchema.parse(req.body);
    const id = req.params.id;
    const exists = await prisma.link.findUnique({ where: { id } });
    if (!exists) {
      return sendError(res, 404, "LINK_NOT_FOUND", "Link not found");
    }

    if (payload.admin_override_status === null) {
      linkOverrides.delete(id);
      const effectiveStatus = normalizeLinkStatus(exists.status);
      emitEvent("linkStatusUpdated", { id, admin_override_status: null, effective_status: effectiveStatus });
      return res.json({ id, admin_override_status: null, effective_status: effectiveStatus });
    }

    linkOverrides.set(id, payload.admin_override_status);
    const mappedStatus: LinkStatus = payload.admin_override_status;
    const updated = await prisma.link.update({ where: { id }, data: { status: mappedStatus }, include: { sourcePort: true, targetPort: true } });
    bumpTopologyVersion();
    const effectiveStatus = normalizeLinkStatus(updated.status);
    emitEvent("linkStatusUpdated", { id, admin_override_status: payload.admin_override_status, effective_status: effectiveStatus });

    if (payload.admin_override_status === "UP") {
      const endpointDevices = await prisma.device.findMany({
        where: {
          id: {
            in: [updated.sourcePort.deviceId, updated.targetPort.deviceId],
          },
        },
        select: { id: true, status: true },
      });
      const hasDownEndpoint = endpointDevices.some((candidate) => normalizeDeviceStatus(candidate.status) !== "UP");
      if (hasDownEndpoint) {
        emitEvent("overrideConflict", {
          entity: "link",
          id,
          code: "OVERRIDE_CONFLICT",
          reason: "override_up_with_down_endpoint",
        });
      }
    }
    return res.json({ id, admin_override_status: payload.admin_override_status, effective_status: effectiveStatus });
  })
);

app.delete(
  "/api/links/:id",
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const exists = await prisma.link.findUnique({ where: { id } });

    if (!exists) {
      return sendError(res, 404, "LINK_NOT_FOUND", "Link not found");
    }

    await prisma.link.delete({ where: { id } });
    bumpTopologyVersion();
    emitEvent("linkDeleted", { id });
    return res.status(204).send();
  })
);

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
    const portIds = ports.map((port) => port.id);
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

    const items = ports.map((port) => ({
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

app.get("/api/ipam/prefixes", (_req, res) => {
  res.json({ items: IPAM_PREFIXES });
});

app.get(
  "/api/ipam/pools",
  asyncRoute(async (_req, res) => {
    const devices = await prisma.device.findMany({ select: { type: true } });
    const allocatedByRole = new Map<string, number>();
    for (const device of devices) {
      const role = ipamRoleForDeviceType(device.type);
      if (!role) continue;
      allocatedByRole.set(role, (allocatedByRole.get(role) ?? 0) + 1);
    }

    const items = IPAM_PREFIXES.map((prefix) => {
      const capacity = 254; // /24 usable approximation for MVP summaries
      const allocated_count = allocatedByRole.get(prefix.role) ?? 0;
      return {
        role: prefix.role,
        cidr: prefix.cidr,
        vrf: prefix.vrf,
        allocated_count,
        capacity,
        utilization: Number((allocated_count / capacity).toFixed(4)),
      };
    });

    res.json({ items });
  })
);

app.get("/api/optical/fiber-types", (_req, res) => {
  res.json({
    items: FIBER_TYPES.map((item) => ({
      physical_medium_id: item.name,
      name: item.name,
      attenuation_db_per_km: item.attenuation_db_per_km,
      wavelength_nm: item.wavelength_nm,
    })),
  });
});

app.get(
  "/api/catalog/hardware",
  asyncRoute(async (req, res) => {
    const type = req.query.type ? String(req.query.type) : null;
    const items = HARDWARE_CATALOG.filter((entry) => {
      if (!type) return true;
      return entry.device_type.toUpperCase() === type.toUpperCase();
    });
    return res.json({ items });
  })
);

app.get(
  "/api/catalog/hardware/:catalogId",
  asyncRoute(async (req, res) => {
    const item = HARDWARE_CATALOG.find((entry) => entry.catalog_id === req.params.catalogId);
    if (!item) {
      return sendError(res, 404, "NOT_FOUND", "Catalog entry not found");
    }
    return res.json(item);
  })
);

app.get("/api/catalog/tariffs", (_req, res) => {
  res.json({ items: TARIFFS });
});

app.get(
  "/api/devices/:id/optical-path",
  asyncRoute(async (req, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) {
      return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
    }

    const allDevices = await prisma.device.findMany({ select: { id: true, type: true } });
    const typeByDeviceId = new Map(allDevices.map((d) => [d.id, d.type]));

    const links = await prisma.link.findMany({
      include: {
        sourcePort: { include: { device: true } },
        targetPort: { include: { device: true } },
      },
    });

    const neighbors = new Map<
      string,
      Array<{ to: string; linkId: string; weight: number; linkLossDb: number; lengthKm: number; passivePenaltyDb: number }>
    >();
    for (const link of links) {
      const a = link.sourcePort.deviceId;
      const b = link.targetPort.deviceId;
      const attenuation = FIBER_TYPE_DB_PER_KM[link.fiberType] ?? FIBER_TYPE_DB_PER_KM.SMF;
      const lengthKm = Math.max(0, link.fiberLength);
      const linkLossDb = lengthKm * attenuation;
      const normalizedA = normalizeDeviceType(link.sourcePort.device.type) ?? "";
      const normalizedB = normalizeDeviceType(link.targetPort.device.type) ?? "";
      const passiveA = PASSIVE_INSERTION_LOSS_DB[normalizedA] ?? 0;
      const passiveB = PASSIVE_INSERTION_LOSS_DB[normalizedB] ?? 0;
      if (!neighbors.has(a)) neighbors.set(a, []);
      if (!neighbors.has(b)) neighbors.set(b, []);
      neighbors.get(a)!.push({
        to: b,
        linkId: link.id,
        weight: linkLossDb + passiveB,
        linkLossDb,
        lengthKm,
        passivePenaltyDb: passiveB,
      });
      neighbors.get(b)!.push({
        to: a,
        linkId: link.id,
        weight: linkLossDb + passiveA,
        linkLossDb,
        lengthKm,
        passivePenaltyDb: passiveA,
      });
    }

    const start = device.id;
    const dist = new Map<string, number>([[start, 0]]);
    const distLengthKm = new Map<string, number>([[start, 0]]);
    const distHops = new Map<string, number>([[start, 0]]);
    const parent = new Map<string, { from: string; linkId: string; linkLossDb: number; lengthKm: number }>();
    const visited = new Set<string>();

    const allNodeIds = Array.from(typeByDeviceId.keys());
    while (allNodeIds.length > 0) {
      let current: string | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const nodeId of allNodeIds) {
        if (visited.has(nodeId)) continue;
        const d = dist.get(nodeId);
        if (d !== undefined && d < best) {
          best = d;
          current = nodeId;
        }
      }
      if (!current) break;

      visited.add(current);

      for (const edge of neighbors.get(current) ?? []) {
        if (visited.has(edge.to)) continue;
        const candidate = best + edge.weight;
        const candidateLengthKm = (distLengthKm.get(current) ?? 0) + edge.lengthKm;
        const candidateHops = (distHops.get(current) ?? 0) + 1;
        const existing = dist.get(edge.to);
        const existingLengthKm = distLengthKm.get(edge.to);
        const existingHops = distHops.get(edge.to);
        const shouldReplace =
          existing === undefined ||
          candidate < existing - 1e-9 ||
          (Math.abs(candidate - existing) < 1e-9 &&
            (existingLengthKm === undefined ||
              candidateLengthKm < existingLengthKm - 1e-9 ||
              (Math.abs(candidateLengthKm - existingLengthKm) < 1e-9 &&
                (existingHops === undefined || candidateHops < existingHops))));
        if (shouldReplace) {
          dist.set(edge.to, candidate);
          distLengthKm.set(edge.to, candidateLengthKm);
          distHops.set(edge.to, candidateHops);
          parent.set(edge.to, { from: current, linkId: edge.linkId, linkLossDb: edge.linkLossDb, lengthKm: edge.lengthKm });
        }
      }
    }

    const oltCandidates = allDevices
      .filter((candidate) => normalizeDeviceType(candidate.type) === "OLT" && dist.has(candidate.id))
      .map((candidate) => {
        const pathDevices: string[] = [];
        const pathLinks: string[] = [];
        let totalLinkLossDb = 0;
        let totalLengthKm = 0;
        let cursor = candidate.id;
        while (cursor !== device.id) {
          pathDevices.push(cursor);
          const p = parent.get(cursor);
          if (!p) break;
          pathLinks.push(p.linkId);
          totalLinkLossDb += p.linkLossDb;
          totalLengthKm += p.lengthKm;
          cursor = p.from;
        }
        pathDevices.push(device.id);
        pathDevices.reverse();
        pathLinks.reverse();
        const pathSignature = `${pathDevices.join("->")}|${pathLinks.join("->")}`;
        return {
          oltId: candidate.id,
          totalLossDb: dist.get(candidate.id) ?? Number.POSITIVE_INFINITY,
          totalLengthKm,
          hopCount: pathLinks.length,
          pathDevices,
          pathLinks,
          totalLinkLossDb,
          pathSignature,
        };
      })
      .filter((item) => Number.isFinite(item.totalLossDb));

    oltCandidates.sort((a, b) => {
      if (Math.abs(a.totalLossDb - b.totalLossDb) > 1e-9) return a.totalLossDb - b.totalLossDb;
      if (Math.abs(a.totalLengthKm - b.totalLengthKm) > 1e-9) return a.totalLengthKm - b.totalLengthKm;
      if (a.hopCount !== b.hopCount) return a.hopCount - b.hopCount;
      const oltCompare = a.oltId.localeCompare(b.oltId);
      if (oltCompare !== 0) return oltCompare;
      return a.pathSignature.localeCompare(b.pathSignature);
    });

    const selected = oltCandidates[0];

    if (!selected) {
      return res.json({ device_id: device.id, found: false, path: [] });
    }

    const totalLossDb = Number(selected.totalLossDb.toFixed(4));
    const totalLinkLossRounded = Number(selected.totalLinkLossDb.toFixed(4));
    const totalPassiveLossDb = Number(Math.max(0, totalLossDb - totalLinkLossRounded).toFixed(4));
    const hopCount = Math.max(0, selected.hopCount);
    const pathSignature = selected.pathSignature;

    return res.json({
      device_id: device.id,
      found: true,
      path: {
        device_ids: selected.pathDevices,
        link_ids: selected.pathLinks,
        olt_id: selected.oltId,
        total_loss_db: totalLossDb,
        total_link_loss_db: totalLinkLossRounded,
        total_passive_loss_db: totalPassiveLossDb,
        total_physical_length_km: Number(selected.totalLengthKm.toFixed(4)),
        hop_count: hopCount,
        path_signature: pathSignature,
      },
    });
  })
);

app.get("/api/metrics/snapshot", (_req, res) => {
  res.json({ tick: metricTickSeq, devices: Array.from(latestMetrics.values()) });
});

app.get("/api/sim/status", (_req, res) => {
  res.json({
    enabled: process.env.TRAFFIC_ENABLED !== "false",
    interval_ms: TRAFFIC_INTERVAL_MS,
    last_tick_seq: metricTickSeq,
    running: Boolean(trafficTimer),
  });
});

app.get("/api/batch/health", (_req, res) => {
  res.json({ status: "ok", backend: "native", available: true, version: "1.0.0" });
});

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

const startTrafficLoop = () => {
  if (trafficTimer) return;

  trafficTimer = setInterval(async () => {
    try {
      const devices = await prisma.device.findMany({ select: { id: true, type: true } });
      metricTickSeq += 1;

      const updates: MetricPoint[] = [];
      const statusUpdates: Array<{ id: string; status: MetricPoint["status"] }> = [];
      for (const device of devices) {
        const previous = latestMetrics.get(device.id);
        const normalizedType = normalizeDeviceType(device.type) ?? "SWITCH";
        const rxBase = normalizedType === "ONT" ? -18 : -10;
        const trafficBase = normalizedType === "OLT" ? 65 : 35;
        const noise = deterministicFactor(`${TRAFFIC_RANDOM_SEED}:${device.id}:${metricTickSeq}`);
        const trafficLoad = Math.min(100, Math.max(0, Math.round(trafficBase + (noise * 40 - 20))));
        const rxPower = Number((rxBase - noise * 12).toFixed(2));
        const sensitivityMinDbm = normalizedType === "ONT" || normalizedType === "BUSINESS_ONT" ? -27 : -20;
        const marginDb = Number((rxPower - sensitivityMinDbm).toFixed(2));
        const status: MetricPoint["status"] = marginDb >= 6 ? "UP" : marginDb >= 0 ? "DEGRADED" : "DOWN";

        const update: MetricPoint = { id: device.id, trafficLoad, rxPower, status, metric_tick_seq: metricTickSeq };
        latestMetrics.set(device.id, update);
        const isChanged =
          !previous ||
          previous.status !== update.status ||
          previous.trafficLoad !== update.trafficLoad ||
          Math.abs(previous.rxPower - update.rxPower) >= 0.1;
        if (isChanged) {
          updates.push(update);
        }
        if (!previous || previous.status !== update.status) {
          statusUpdates.push({ id: update.id, status: update.status });
        }
      }

      if (updates.length > 0) {
        emitEvent("deviceMetricsUpdated", { tick: metricTickSeq, items: updates }, false, `sim-${metricTickSeq}`);
        emitEvent(
          "deviceSignalUpdated",
          {
            tick: metricTickSeq,
            items: updates.map((item) => ({
              id: item.id,
              received_dbm: item.rxPower,
              signal_status: signalStatusFromRuntimeStatus(item.status),
            })),
          },
          false,
          `sim-${metricTickSeq}`
        );
      }
      if (statusUpdates.length > 0) {
        emitEvent(
          "deviceStatusUpdated",
          {
            tick: metricTickSeq,
            items: statusUpdates,
          },
          false,
          `sim-${metricTickSeq}`
        );
      }

      const oltUpdates = updates.filter((item) => {
        const device = devices.find((candidate) => candidate.id === item.id);
        return device && normalizeDeviceType(device.type) === "OLT";
      });
      for (const item of oltUpdates) {
        const utilization = Number((item.trafficLoad / 100).toFixed(4));
        const segmentId = item.id;
        const isCongested = segmentCongestionState.get(segmentId) ?? false;
        if (!isCongested && utilization >= 0.95) {
          segmentCongestionState.set(segmentId, true);
          emitEvent(
            "segmentCongestionDetected",
            { segmentId, oltId: segmentId, utilization, tick: metricTickSeq },
            false,
            `sim-${metricTickSeq}`
          );
        } else if (isCongested && utilization <= 0.85) {
          segmentCongestionState.set(segmentId, false);
          emitEvent(
            "segmentCongestionCleared",
            { segmentId, oltId: segmentId, utilization, tick: metricTickSeq },
            false,
            `sim-${metricTickSeq}`
          );
        }
      }
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

export { app, io, prisma };

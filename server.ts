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
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.resolve(__dirname, "prisma/dev.db")}`;
} else if (process.env.DATABASE_URL.startsWith("file:./")) {
  process.env.DATABASE_URL = `file:${path.resolve(
    __dirname,
    "prisma",
    process.env.DATABASE_URL.slice("file:./".length)
  )}`;
}

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });
const requestContext = new AsyncLocalStorage<{ requestId: string }>();

const PORT = 3000;
const TRAFFIC_INTERVAL_MS = Number(process.env.TRAFFIC_TICK_INTERVAL_MS ?? 1000);

const CANONICAL_DEVICE_TYPES = [
  "BackboneGateway",
  "CoreRouter",
  "EdgeRouter",
  "OLT",
  "AONSwitch",
  "Splitter",
  "ONT",
  "BusinessONT",
  "AONCPE",
  "Switch",
  "PatchPanel",
  "Amplifier",
  "POP",
  "CORE_SITE",
] as const;
type DeviceType = (typeof CANONICAL_DEVICE_TYPES)[number];

type DeviceStatus = "OK" | "WARNING" | "FAILURE" | "OFFLINE";

const TYPE_ALIASES: Record<string, DeviceType> = {
  BACKBONE_GATEWAY: "BackboneGateway",
  BACKBONEGATEWAY: "BackboneGateway",
  CORE_ROUTER: "CoreRouter",
  COREROUTER: "CoreRouter",
  EDGE_ROUTER: "EdgeRouter",
  EDGEROUTER: "EdgeRouter",
  OLT: "OLT",
  AON_SWITCH: "AONSwitch",
  AONSWITCH: "AONSwitch",
  SPLITTER: "Splitter",
  SPLITTER_: "Splitter",
  ONT: "ONT",
  BUSINESS_ONT: "BusinessONT",
  BUSINESSONT: "BusinessONT",
  AON_CPE: "AONCPE",
  AONCPE: "AONCPE",
  ONU: "ONT",
  SWITCH: "Switch",
  ROUTER: "Switch",
  ODF: "PatchPanel",
  PATCHPANEL: "PatchPanel",
  AMPLIFIER: "Amplifier",
  POP: "POP",
  CORE_SITE: "CORE_SITE",
  CORESITE: "CORE_SITE",
};

const normalizeDeviceType = (input: string): DeviceType | undefined => {
  const key = input.trim();
  return TYPE_ALIASES[key] ?? TYPE_ALIASES[key.toUpperCase()];
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

const dataDir = path.resolve(__dirname, "data");

const readJsonFile = (filename: string) => {
  const filePath = path.join(dataDir, filename);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
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

  const oltMapping = readJsonFile("olt_catalog.json");
  if (oltMapping && Array.isArray(oltMapping.OLT)) {
    for (const row of oltMapping.OLT) {
      entries.push(buildCatalogEntry("OLT", row as Record<string, unknown>));
    }
  }

  const switches = readJsonFile("switch_catalog.json");
  if (switches && Array.isArray(switches.Switches)) {
    for (const row of switches.Switches) {
      entries.push(buildCatalogEntry("Switch", row as Record<string, unknown>));
    }
  }

  const aonSwitches = readJsonFile("aon_switch_catalog.json");
  if (aonSwitches && Array.isArray(aonSwitches.AON_Switches)) {
    for (const row of aonSwitches.AON_Switches) {
      entries.push(buildCatalogEntry("AON_SWITCH", row as Record<string, unknown>));
    }
  }

  const backbone = readJsonFile("backbone_hardware_catalog.json");
  if (backbone) {
    const collections: Array<{ key: string; type: string }> = [
      { key: "Edge_Routers", type: "EDGE_ROUTER" },
      { key: "Core_Routers", type: "CORE_ROUTER" },
      { key: "DCI_Switches", type: "DCI_SWITCH" },
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

  const passive = readJsonFile("passive_infrastructure_catalog.json");
  if (passive && typeof passive.Geräte === "object" && passive.Geräte !== null) {
    const geraete = passive.Geräte as Record<string, unknown>;
    const collections: Array<{ key: string; type: string }> = [
      { key: "Splitter", type: "Splitter" },
      { key: "ODF", type: "PatchPanel" },
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
      { catalog_id: "SPLITTER_GENERIC_V1", device_type: "Splitter", vendor: "Generic", model: "Splitter", version: "1.0", attributes: {} },
      { catalog_id: "SWITCH_GENERIC_V1", device_type: "Switch", vendor: "Generic", model: "Switch", version: "1.0", attributes: {} },
    ] as CatalogEntry[];
  }

  return entries.sort((a, b) => a.catalog_id.localeCompare(b.catalog_id));
};

const normalizeFiberTypes = () => {
  const source = readJsonFile("fiber_types_catalog.json");
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
  const source = readJsonFile("tariff_catalog.json");
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
  if (type === "ONT" || type === "BusinessONT") return "ont_mgmt";
  if (type === "AONSwitch") return "aon_mgmt";
  if (type === "AONCPE") return "cpe_mgmt";
  if (type === "BackboneGateway" || type === "Switch" || type === "CoreRouter" || type === "EdgeRouter") return "core_mgmt";
  return null;
};

type MetricPoint = {
  id: string;
  trafficLoad: number;
  rxPower: number;
  status: Exclude<DeviceStatus, "OFFLINE">;
  metric_tick_seq: number;
};

const latestMetrics = new Map<string, MetricPoint>();
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
    status: z.enum(["OK", "WARNING", "FAILURE", "OFFLINE"]).optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field must be provided",
  });

const LinkCreateSchema = z.object({
  sourcePortId: z.string().min(1).optional(),
  targetPortId: z.string().min(1).optional(),
  a_interface_id: z.string().min(1).optional(),
  b_interface_id: z.string().min(1).optional(),
  fiberLength: z.number().positive().max(300).optional(),
  length_km: z.number().positive().max(300).optional(),
  fiberType: z.string().optional(),
  physical_medium_id: z.string().optional(),
});

const LinkUpdateSchema = z
  .object({
    fiberLength: z.number().positive().max(300).optional(),
    length_km: z.number().positive().max(300).optional(),
    fiberType: z.string().optional(),
    physical_medium_id: z.string().optional(),
    status: z.enum(["OK", "BROKEN"]).optional(),
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

const BatchCreateSchema = z.object({
  links: z.array(
    z.object({
      sourcePortId: z.string().optional(),
      targetPortId: z.string().optional(),
      a_interface_id: z.string().optional(),
      b_interface_id: z.string().optional(),
      fiberLength: z.number().positive().max(300).optional(),
      length_km: z.number().positive().max(300).optional(),
      fiberType: z.string().optional(),
      physical_medium_id: z.string().optional(),
      link_type: z.string().optional(),
    })
  ),
  dry_run: z.boolean().optional(),
  skip_optical_recompute: z.boolean().optional(),
  request_id: z.string().optional(),
});

const BatchDeleteSchema = z.object({
  link_ids: z.array(z.string()).optional(),
  ids: z.array(z.string()).optional(),
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
  const hash = `${deviceId.replace(/-/g, "")}${portNumber.toString(16).padStart(2, "0")}`.padEnd(10, "0").slice(0, 10);
  return `02:${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${hash.slice(6, 8)}:${hash.slice(8, 10)}`.toLowerCase();
};

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

const isContainerType = (type: string) => {
  const normalized = normalizeDeviceType(type);
  return normalized === "POP" || normalized === "CORE_SITE";
};

const isOntFamily = (type: string) => {
  const normalized = normalizeDeviceType(type);
  return normalized === "ONT" || normalized === "BusinessONT";
};

const isOltOntPair = (aType: string, bType: string) => {
  const a = normalizeDeviceType(aType);
  const b = normalizeDeviceType(bType);
  return (a === "OLT" && (b === "ONT" || b === "BusinessONT")) || ((a === "ONT" || a === "BusinessONT") && b === "OLT");
};

const validateLinkCreation = async (sourcePortId: string, targetPortId: string) => {
  if (sourcePortId === targetPortId) {
    return { ok: false as const, status: 400, code: "VALIDATION_ERROR", message: "sourcePortId and targetPortId must be different" };
  }

  const [sourcePort, targetPort] = await Promise.all([
    prisma.port.findUnique({ where: { id: sourcePortId }, include: { device: true } }),
    prisma.port.findUnique({ where: { id: targetPortId }, include: { device: true } }),
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

  const occupied = await prisma.link.findFirst({
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

const createLinkInternal = async (payload: {
  sourcePortId: string;
  targetPortId: string;
  fiberLength?: number;
  length_km?: number;
  fiberType?: string;
  physical_medium_id?: string;
}) => {
  const validation = await validateLinkCreation(payload.sourcePortId, payload.targetPortId);
  if (!validation.ok) {
    return validation;
  }

  const mediumId = payload.physical_medium_id ?? payload.fiberType ?? "SMF";
  if (FIBER_TYPE_DB_PER_KM[mediumId] === undefined) {
    return { ok: false as const, status: 400, code: "FIBER_TYPE_INVALID", message: `Invalid physical medium: ${mediumId}` };
  }

  const fiberLength = payload.length_km ?? payload.fiberLength ?? 10;
  const link = await prisma.link.create({
    data: {
      sourcePortId: payload.sourcePortId,
      targetPortId: payload.targetPortId,
      fiberLength,
      fiberType: mediumId,
      status: "OK",
    },
    include: { sourcePort: true, targetPort: true },
  });

  return { ok: true as const, link };
};

const runBatchCreate = async (payload: z.infer<typeof BatchCreateSchema>) => {
  const startedAt = Date.now();
  const dryRun = payload.dry_run ?? false;
  const requestId = payload.request_id ?? null;
  const createdIds: string[] = [];
  const failedLinks: Array<{ index: number; sourcePortId?: string; targetPortId?: string; error_code: string; error_message: string }> = [];

  for (let i = 0; i < payload.links.length; i += 1) {
    const candidate = payload.links[i];
    const sourcePortId = candidate.sourcePortId ?? candidate.a_interface_id;
    const targetPortId = candidate.targetPortId ?? candidate.b_interface_id;
    const fiberLength = candidate.fiberLength ?? candidate.length_km;
    const physical_medium_id =
      candidate.physical_medium_id ?? candidate.fiberType ?? (candidate.link_type?.toUpperCase() === "FIBER" ? "SMF" : undefined);

    if (!sourcePortId || !targetPortId) {
      failedLinks.push({
        index: i,
        sourcePortId,
        targetPortId,
        error_code: "VALIDATION_ERROR",
        error_message: "sourcePortId/targetPortId (or a_interface_id/b_interface_id) is required",
      });
      continue;
    }

    if (dryRun) {
      const validation = await validateLinkCreation(sourcePortId, targetPortId);
      if (!validation.ok) {
        failedLinks.push({
          index: i,
          sourcePortId,
          targetPortId,
          error_code: validation.code,
          error_message: validation.message,
        });
      }
      continue;
    }

    const created = await createLinkInternal({ sourcePortId, targetPortId, length_km: fiberLength, physical_medium_id });
    if (!created.ok) {
      failedLinks.push({
        index: i,
        sourcePortId,
        targetPortId,
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

const createPortsForDevice = async (deviceId: string, type: DeviceType) => {
  const ports: Array<{ deviceId: string; portNumber: number; portType: string; status: string }> = [];

  if (type === "OLT") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
    for (let i = 1; i <= 4; i += 1) {
      ports.push({ deviceId, portNumber: i, portType: "PON", status: "UP" });
    }
  } else if (type === "ONT" || type === "BusinessONT") {
    ports.push({ deviceId, portNumber: 0, portType: "PON", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "LAN", status: "UP" });
    ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
  } else if (type === "AONCPE") {
    ports.push({ deviceId, portNumber: 0, portType: "ACCESS", status: "UP" });
    ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
  } else if (type === "Splitter") {
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    for (let i = 1; i <= 8; i += 1) {
      ports.push({ deviceId, portNumber: i, portType: "OUT", status: "UP" });
    }
  } else if (type === "Switch" || type === "AONSwitch" || type === "CoreRouter" || type === "EdgeRouter") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
    for (let i = 1; i <= 8; i += 1) {
      ports.push({ deviceId, portNumber: i, portType: "ACCESS", status: "UP" });
    }
  } else if (type === "PatchPanel") {
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "OUT", status: "UP" });
  } else if (type === "Amplifier") {
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "OUT", status: "UP" });
  } else if (type === "BackboneGateway") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    ports.push({ deviceId, portNumber: 99, portType: "MANAGEMENT", status: "UP" });
  }

  if (ports.length > 0) {
    await prisma.port.createMany({ data: ports });
  }
};

const mapDeviceToNode = (device: any) => ({
  id: device.id,
  type: "default",
  position: { x: device.x, y: device.y },
  data: {
    id: device.id,
    name: device.name,
    label: device.name,
    type: normalizeDeviceType(device.type) ?? device.type,
    status: device.status,
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
    fiberLength: link.fiberLength, // compatibility alias
    fiberType: link.fiberType, // compatibility alias
    status: link.status,
  },
});

const mapLinkToApi = (link: any) => ({
  ...link,
  length_km: link.fiberLength,
  physical_medium_id: link.fiberType,
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
    res.json(devices);
  })
);

app.get(
  "/api/devices/:id",
  asyncRoute(async (req, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id }, include: { ports: true } });

    if (!device) {
      return sendError(res, 404, "DEVICE_NOT_FOUND", "Device not found");
    }

    return res.json(device);
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
          type: "BackboneGateway",
          model: "ImplicitSeed",
          x: -240,
          y: -120,
          status: "OK",
        },
      });
      await createPortsForDevice(seed.id, "BackboneGateway");
    }

    if (payload.type === "BackboneGateway") {
      const existingBackbone = await prisma.device.findFirst({
        where: { networkId: network.id, type: "BackboneGateway" },
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
        status: "OK",
      },
    });

    await createPortsForDevice(created.id, payload.type);

    const deviceWithPorts = await prisma.device.findUniqueOrThrow({ where: { id: created.id }, include: { ports: true } });

    bumpTopologyVersion();
    emitEvent("deviceCreated", deviceWithPorts);
    res.status(201).json(deviceWithPorts);
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
    emitEvent("deviceUpdated", updated);
    return res.json(updated);
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

    const existing = await prisma.port.count({ where: { deviceId: id } });
    if (existing === 0) {
      await createPortsForDevice(id, normalized);
      bumpTopologyVersion();
    }

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
      return res.json({ id, admin_override_status: null, status: device.status });
    }

    deviceOverrides.set(id, payload.admin_override_status);
    const mappedStatus: DeviceStatus =
      payload.admin_override_status === "UP"
        ? "OK"
        : payload.admin_override_status === "DEGRADED"
        ? "WARNING"
        : payload.admin_override_status === "BLOCKING"
        ? "OFFLINE"
        : "FAILURE";

    const updated = await prisma.device.update({
      where: { id },
      data: { status: mappedStatus },
      include: { ports: true },
    });

    bumpTopologyVersion();
    emitEvent("deviceOverrideChanged", { id, override: payload.admin_override_status, status: mappedStatus });
    return res.json({ id, admin_override_status: payload.admin_override_status, status: mappedStatus });
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
    const sourcePortId = payload.sourcePortId ?? payload.a_interface_id;
    const targetPortId = payload.targetPortId ?? payload.b_interface_id;
    if (!sourcePortId || !targetPortId) {
      return sendError(res, 400, "VALIDATION_ERROR", "sourcePortId/targetPortId (or a_interface_id/b_interface_id) is required");
    }

    const created = await createLinkInternal({
      sourcePortId,
      targetPortId,
      length_km: payload.length_km ?? payload.fiberLength,
      physical_medium_id: payload.physical_medium_id ?? payload.fiberType,
    });
    if (!created.ok) {
      return sendError(res, created.status, created.code, created.message);
    }
    const link = created.link;

    bumpTopologyVersion();
    emitEvent("linkAdded", link);
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
  "/api/links/batch/create",
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
    const ids = payload.link_ids ?? payload.ids ?? [];

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

    const mediumId = payload.physical_medium_id ?? payload.fiberType;
    if (mediumId !== undefined && FIBER_TYPE_DB_PER_KM[mediumId] === undefined) {
      return sendError(res, 400, "FIBER_TYPE_INVALID", `Invalid physical medium: ${mediumId}`);
    }

    const updated = await prisma.link.update({
      where: { id },
      data: {
        ...((payload.length_km ?? payload.fiberLength) !== undefined ? { fiberLength: payload.length_km ?? payload.fiberLength } : {}),
        ...(mediumId !== undefined ? { fiberType: mediumId } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
      },
      include: { sourcePort: true, targetPort: true },
    });

    bumpTopologyVersion();
    emitEvent("linkUpdated", updated);
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
      emitEvent("linkStatusUpdated", { id, admin_override_status: null, effective_status: exists.status });
      return res.json({ id, admin_override_status: null, effective_status: exists.status });
    }

    linkOverrides.set(id, payload.admin_override_status);
    const mappedStatus = payload.admin_override_status === "UP" ? "OK" : "BROKEN";
    const updated = await prisma.link.update({ where: { id }, data: { status: mappedStatus }, include: { sourcePort: true, targetPort: true } });
    bumpTopologyVersion();
    emitEvent("linkStatusUpdated", { id, admin_override_status: payload.admin_override_status, effective_status: updated.status });
    return res.json({ id, admin_override_status: payload.admin_override_status, effective_status: updated.status });
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
      if (sourceType === "ONT" || sourceType === "BusinessONT" || sourceType === "AONCPE") {
        ontMap.set(link.sourcePort.device.id, {
          id: link.sourcePort.device.id,
          name: link.sourcePort.device.name,
          type: sourceType === "BusinessONT" ? "BUSINESS_ONT" : sourceType === "AONCPE" ? "AON_CPE" : "ONT",
        });
      }
      if (targetType === "ONT" || targetType === "BusinessONT" || targetType === "AONCPE") {
        ontMap.set(link.targetPort.device.id, {
          id: link.targetPort.device.id,
          name: link.targetPort.device.name,
          type: targetType === "BusinessONT" ? "BUSINESS_ONT" : targetType === "AONCPE" ? "AON_CPE" : "ONT",
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

    const neighbors = new Map<string, Array<{ to: string; linkId: string; weight: number }>>();
    for (const link of links) {
      const a = link.sourcePort.deviceId;
      const b = link.targetPort.deviceId;
      const attenuation = FIBER_TYPE_DB_PER_KM[link.fiberType] ?? FIBER_TYPE_DB_PER_KM.SMF;
      const weight = Math.max(0, link.fiberLength) * attenuation;
      if (!neighbors.has(a)) neighbors.set(a, []);
      if (!neighbors.has(b)) neighbors.set(b, []);
      neighbors.get(a)!.push({ to: b, linkId: link.id, weight });
      neighbors.get(b)!.push({ to: a, linkId: link.id, weight });
    }

    const start = device.id;
    const dist = new Map<string, number>([[start, 0]]);
    const parent = new Map<string, { from: string; linkId: string }>();
    const visited = new Set<string>();

    let foundOlt: string | null = normalizeDeviceType(device.type) === "OLT" ? device.id : null;

    const allNodeIds = Array.from(typeByDeviceId.keys());
    while (allNodeIds.length > 0 && !foundOlt) {
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
      const currentType = typeByDeviceId.get(current);
      if (currentType && normalizeDeviceType(currentType) === "OLT") {
        foundOlt = current;
        break;
      }

      for (const edge of neighbors.get(current) ?? []) {
        if (visited.has(edge.to)) continue;
        const candidate = best + edge.weight;
        const existing = dist.get(edge.to);
        if (existing === undefined || candidate < existing) {
          dist.set(edge.to, candidate);
          parent.set(edge.to, { from: current, linkId: edge.linkId });
        }
      }
    }

    if (!foundOlt) {
      return res.json({ device_id: device.id, found: false, path: [] });
    }

    const pathDevices: string[] = [];
    const pathLinks: string[] = [];
    let cursor = foundOlt;
    while (cursor !== device.id) {
      pathDevices.push(cursor);
      const p = parent.get(cursor);
      if (!p) break;
      pathLinks.push(p.linkId);
      cursor = p.from;
    }
    pathDevices.push(device.id);
    pathDevices.reverse();
    pathLinks.reverse();

    return res.json({
      device_id: device.id,
      found: true,
      path: {
        device_ids: pathDevices,
        link_ids: pathLinks,
        olt_id: foundOlt,
        total_loss_db: Number((dist.get(foundOlt) ?? 0).toFixed(4)),
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

      const updates: MetricPoint[] = devices.map((device) => {
        const normalizedType = normalizeDeviceType(device.type) ?? "Switch";
        const rxBase = normalizedType === "ONT" ? -18 : -10;
        const trafficBase = normalizedType === "OLT" ? 65 : 35;
        const noise = deterministicFactor(`${device.id}:${metricTickSeq}`);
        const trafficLoad = Math.min(100, Math.max(0, Math.round(trafficBase + (noise * 40 - 20))));
        const rxPower = Number((rxBase - noise * 12).toFixed(2));
        const status: MetricPoint["status"] = rxPower >= -27 ? "OK" : rxPower > -30 ? "WARNING" : "FAILURE";

        const update: MetricPoint = { id: device.id, trafficLoad, rxPower, status, metric_tick_seq: metricTickSeq };
        latestMetrics.set(device.id, update);
        return update;
      });

      if (updates.length > 0) {
        emitEvent("deviceMetricsUpdated", { tick: metricTickSeq, items: updates }, false, `sim-${metricTickSeq}`);
        emitEvent(
          "deviceStatusUpdated",
          {
            tick: metricTickSeq,
            items: updates.map(({ id, status }) => ({ id, status })),
          },
          false,
          `sim-${metricTickSeq}`
        );
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

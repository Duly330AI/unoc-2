import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const perfDir = path.resolve(repoRoot, "perf");
const defaultPerfDbPath = path.resolve(repoRoot, "prisma", "perf.db");
const usingDefaultPerfDb = !process.env.DATABASE_URL;

if (!process.env.DATABASE_URL) {
  const sqlitePath = defaultPerfDbPath.replace(/\\/g, "/");
  process.env.DATABASE_URL = `file:${sqlitePath}`;
}

const prisma = new PrismaClient();

type DeviceType =
  | "BACKBONE_GATEWAY"
  | "CORE_ROUTER"
  | "EDGE_ROUTER"
  | "OLT"
  | "SPLITTER"
  | "ONT";

type SeedProfile = {
  olts: number;
  ontsPerOlt: number;
  edges: number;
  activeRatio: number;
};

const PROFILE_PRESETS: Record<string, SeedProfile> = {
  small: { olts: 1, ontsPerOlt: 8, edges: 1, activeRatio: 0.8 },
  medium: { olts: 2, ontsPerOlt: 16, edges: 2, activeRatio: 0.8 },
  large: { olts: 4, ontsPerOlt: 24, edges: 4, activeRatio: 0.8 },
};

const MANAGEMENT_POOLS: Record<string, { poolKey: string; cidr: string }> = {
  BACKBONE_GATEWAY: { poolKey: "core_mgmt", cidr: "10.250.0.0/24" },
  CORE_ROUTER: { poolKey: "core_mgmt", cidr: "10.250.0.0/24" },
  EDGE_ROUTER: { poolKey: "core_mgmt", cidr: "10.250.0.0/24" },
  OLT: { poolKey: "olt_mgmt", cidr: "10.250.4.0/24" },
  ONT: { poolKey: "ont_mgmt", cidr: "10.250.1.0/24" },
};

const SESSION_STATES = {
  ACTIVE: "ACTIVE",
} as const;

const SERVICE_STATUSES = {
  UP: "UP",
} as const;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {
    profile: "small",
    activeRatio: undefined as number | undefined,
    ontsPerOlt: undefined as number | undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--profile" && next) {
      result.profile = next;
      i += 1;
      continue;
    }
    if (arg === "--active-ratio" && next) {
      result.activeRatio = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--onts" && next) {
      result.ontsPerOlt = Number(next);
      i += 1;
    }
  }

  return result;
};

const deterministicFactor = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

const ipv4ToInt = (ip: string) =>
  ip.split(".").map(Number).reduce((acc, octet) => ((acc << 8) | octet) >>> 0, 0);

const intToIpv4 = (value: number) =>
  [24, 16, 8, 0]
    .map((shift) => ((value >>> shift) & 255).toString())
    .join(".");

const buildSyntheticMac = (seed: string, suffix: number) => {
  const normalized = seed.replace(/[^a-zA-Z0-9]/g, "").padEnd(12, "0").slice(0, 12);
  const suffixHex = suffix.toString(16).padStart(2, "0");
  const hash = `${normalized.slice(0, 8)}${suffixHex}`.slice(0, 10);
  return `02:${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${hash.slice(6, 8)}:${hash.slice(8, 10)}`.toLowerCase();
};

const buildDeviceName = (type: DeviceType, index: number) => `${type.replace(/_/g, "-")}-${String(index + 1).padStart(3, "0")}`;

const createPortsForDevice = async (deviceId: string, type: DeviceType) => {
  const ports: Array<{ deviceId: string; portNumber: number; portType: string; status: string }> = [];

  if (type === "OLT") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    for (let i = 1; i <= 4; i += 1) ports.push({ deviceId, portNumber: i, portType: "PON", status: "UP" });
  } else if (type === "ONT") {
    ports.push({ deviceId, portNumber: 0, portType: "PON", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "LAN", status: "UP" });
  } else if (type === "SPLITTER") {
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    for (let i = 1; i <= 8; i += 1) ports.push({ deviceId, portNumber: i, portType: "OUT", status: "UP" });
  } else if (type === "BACKBONE_GATEWAY") {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
  } else {
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    for (let i = 1; i <= 8; i += 1) ports.push({ deviceId, portNumber: i, portType: "ACCESS", status: "UP" });
  }

  await prisma.port.createMany({ data: ports });
};

const ensureBaseIpam = async () => {
  const mgmtVrf = await prisma.vrf.upsert({
    where: { name: "mgmt_vrf" },
    update: {},
    create: { name: "mgmt_vrf", description: "Performance harness management VRF" },
  });

  await prisma.vrf.upsert({
    where: { name: "subscriber_vrf" },
    update: {},
    create: { name: "subscriber_vrf", description: "Performance harness subscriber VRF" },
  });

  const pools = Object.values(MANAGEMENT_POOLS);
  for (const pool of pools) {
    await prisma.ipPool.upsert({
      where: { poolKey: pool.poolKey },
      update: { cidr: pool.cidr, type: "MANAGEMENT", vrfId: mgmtVrf.id },
      create: {
        name: pool.poolKey,
        poolKey: pool.poolKey,
        type: "MANAGEMENT",
        cidr: pool.cidr,
        vrfId: mgmtVrf.id,
      },
    });
  }
};

const createDeviceWithPorts = async (networkId: string, type: DeviceType, index: number, x: number, y: number, provisioned = true) => {
  const device = await prisma.device.create({
    data: {
      networkId,
      name: buildDeviceName(type, index),
      type,
      model: "PerfSeed",
      x,
      y,
      status: "UP",
      provisioned,
    },
  });

  await createPortsForDevice(device.id, type);
  const ports = await prisma.port.findMany({
    where: { deviceId: device.id },
    orderBy: [{ portType: "asc" }, { portNumber: "asc" }],
  });

  return { device, ports };
};

const allocateManagementAddress = async (deviceId: string, type: DeviceType, ordinal: number) => {
  const pool = MANAGEMENT_POOLS[type];
  if (!pool) return null;
  const base = ipv4ToInt(pool.cidr.split("/")[0]);
  return intToIpv4(base + ordinal + 1);
};

const createManagementInterface = async (deviceId: string, type: DeviceType, ordinal: number) => {
  const mgmt = await prisma.interface.create({
    data: {
      deviceId,
      name: "mgmt0",
      macAddress: buildSyntheticMac(`${deviceId}-mgmt`, 99),
      role: "MGMT",
      status: "UP",
      capacity: 1000,
    },
  });

  const ip = await allocateManagementAddress(deviceId, type, ordinal);
  if (ip) {
    await prisma.ipAddress.create({
      data: {
        interfaceId: mgmt.id,
        ip,
        prefixLen: 24,
        isPrimary: true,
        vrf: "mgmt_vrf",
      },
    });
  }

  return mgmt;
};

const createOntAccessInterface = async (deviceId: string, ordinal: number) =>
  prisma.interface.create({
    data: {
      deviceId,
      name: "uni0",
      macAddress: buildSyntheticMac(`${deviceId}-uni`, ordinal % 200),
      role: "ACCESS",
      status: "UP",
      capacity: 1000,
    },
  });

const createLink = async (sourcePortId: string, targetPortId: string, fiberLength: number) =>
  prisma.link.create({
    data: {
      sourcePortId,
      targetPortId,
      fiberLength,
      fiberType: "G.652.D",
      status: "UP",
    },
  });

const createSubscriberPrivateIp = (index: number) => {
  const third = Math.floor(index / 254);
  const fourth = (index % 254) + 1;
  return `100.64.${third}.${fourth}`;
};

const createCgnatPublicIp = (index: number) => `198.51.100.${Math.floor(index / 31) + 1}`;

const ensurePerfDatabase = () => {
  if (usingDefaultPerfDb) {
    for (const suffix of ["", "-shm", "-wal"]) {
      const candidate = `${defaultPerfDbPath}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.rmSync(candidate, { force: true });
      }
    }
  }

  execSync("npx prisma db push --skip-generate", {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
  });
};

const resetDatabase = async () => {
  await prisma.cgnatMapping.deleteMany();
  await prisma.oltVlanTranslation.deleteMany();
  await prisma.subscriberSession.deleteMany();
  await prisma.ipAddress.deleteMany();
  await prisma.interface.deleteMany();
  await prisma.ipPool.deleteMany();
  await prisma.vrf.deleteMany();
  await prisma.link.deleteMany();
  await prisma.port.deleteMany();
  await prisma.device.deleteMany();
  await prisma.network.deleteMany();
};

const main = async () => {
  const args = parseArgs();
  const preset = PROFILE_PRESETS[args.profile] ?? PROFILE_PRESETS.small;
  const profile: SeedProfile = {
    ...preset,
    ...(args.activeRatio !== undefined ? { activeRatio: Math.max(0, Math.min(1, args.activeRatio)) } : {}),
    ...(args.ontsPerOlt !== undefined ? { ontsPerOlt: Math.max(1, Math.floor(args.ontsPerOlt)) } : {}),
  };

  ensurePerfDatabase();
  await resetDatabase();
  await ensureBaseIpam();

  const network = await prisma.network.create({ data: { name: "Performance" } });
  const manifest: Record<string, unknown> = {
    profile: args.profile,
    parameters: profile,
    generated_at: new Date().toISOString(),
  };

  const backbone = await createDeviceWithPorts(network.id, "BACKBONE_GATEWAY", 0, -360, -80);
  const core = await createDeviceWithPorts(network.id, "CORE_ROUTER", 0, -180, -40);
  const edges = [];
  for (let i = 0; i < profile.edges; i += 1) {
    edges.push(await createDeviceWithPorts(network.id, "EDGE_ROUTER", i, -60, 120 * i,  true));
  }

  const olts = [];
  const splitters = [];
  const onts = [];
  const ontAccessInterfaces = [];

  const mgmtOrdinals = new Map<string, number>();
  const trackMgmt = async (deviceId: string, type: DeviceType) => {
    const poolKey = MANAGEMENT_POOLS[type]?.poolKey ?? type;
    const next = mgmtOrdinals.get(poolKey) ?? 0;
    mgmtOrdinals.set(poolKey, next + 1);
    return createManagementInterface(deviceId, type, next);
  };

  await trackMgmt(backbone.device.id, "BACKBONE_GATEWAY");
  await trackMgmt(core.device.id, "CORE_ROUTER");
  for (const edge of edges) {
    await trackMgmt(edge.device.id, "EDGE_ROUTER");
  }

  await createLink(backbone.ports.find((port) => port.portType === "UPLINK")!.id, core.ports.find((port) => port.portType === "UPLINK")!.id, 5);

  for (let oltIndex = 0; oltIndex < profile.olts; oltIndex += 1) {
    const edge = edges[oltIndex % edges.length];
    const olt = await createDeviceWithPorts(network.id, "OLT", oltIndex, 120, oltIndex * 260);
    await trackMgmt(olt.device.id, "OLT");
    olts.push(olt);

    const coreAccessPort = core.ports.filter((port) => port.portType === "ACCESS")[oltIndex];
    const oltUplinkPort = olt.ports.find((port) => port.portType === "UPLINK")!;
    await createLink(coreAccessPort.id, oltUplinkPort.id, 3);

    const splitterCount = Math.ceil(profile.ontsPerOlt / 8);
    for (let splitterOffset = 0; splitterOffset < splitterCount; splitterOffset += 1) {
      const splitter = await createDeviceWithPorts(
        network.id,
        "SPLITTER",
        splitters.length,
        280,
        oltIndex * 260 + splitterOffset * 80
      );
      splitters.push(splitter);
      const oltPonPort = olt.ports.filter((port) => port.portType === "PON")[splitterOffset];
      const splitterIn = splitter.ports.find((port) => port.portType === "IN")!;
      await createLink(oltPonPort.id, splitterIn.id, 0.4);

      for (let outIndex = 0; outIndex < 8; outIndex += 1) {
        const absoluteOntIndex = oltIndex * profile.ontsPerOlt + splitterOffset * 8 + outIndex;
        if (absoluteOntIndex >= (oltIndex + 1) * profile.ontsPerOlt) break;

        const ont = await createDeviceWithPorts(
          network.id,
          "ONT",
          onts.length,
          440,
          oltIndex * 260 + splitterOffset * 80 + outIndex * 24
        );
        await trackMgmt(ont.device.id, "ONT");
        const uni = await createOntAccessInterface(ont.device.id, absoluteOntIndex);
        onts.push({ ...ont, oltId: olt.device.id, edgeId: edge.device.id });
        ontAccessInterfaces.push({ ontId: ont.device.id, interfaceId: uni.id, edgeId: edge.device.id });

        const splitterOut = splitter.ports.filter((port) => port.portType === "OUT")[outIndex];
        const ontPonPort = ont.ports.find((port) => port.portType === "PON")!;
        await createLink(splitterOut.id, ontPonPort.id, 0.15);
      }
    }
  }

  const activeSessionTarget = Math.floor(ontAccessInterfaces.length * profile.activeRatio);
  const sampleTraceQueries: Array<{ ip: string; port: number; ts: string }> = [];
  for (let i = 0; i < ontAccessInterfaces.length; i += 1) {
    const ont = ontAccessInterfaces[i];
    if (i >= activeSessionTarget) break;

    const privateIp = createSubscriberPrivateIp(i);
    const session = await prisma.subscriberSession.create({
      data: {
        interfaceId: ont.interfaceId,
        bngDeviceId: ont.edgeId,
        macAddress: buildSyntheticMac(`${ont.ontId}-session`, i),
        protocol: "DHCP",
        serviceType: i % 10 === 0 ? "VOICE" : i % 5 === 0 ? "IPTV" : "INTERNET",
        state: SESSION_STATES.ACTIVE,
        ipv4Address: privateIp,
        infraStatus: "UP",
        serviceStatus: SERVICE_STATUSES.UP,
        reasonCode: null,
      },
    });

    const publicIp = createCgnatPublicIp(i);
    const portRangeStart = 1024 + (i % 31) * 2048;
    const portRangeEnd = portRangeStart + 2047;
    const timestampStart = new Date(Date.now() - 60_000);
    const retentionExpires = new Date(Date.now() + 184 * 24 * 60 * 60 * 1000);
    await prisma.cgnatMapping.create({
      data: {
        sessionId: session.id,
        publicIp,
        privateIp,
        portRangeStart,
        portRangeEnd,
        timestampStart,
        retentionExpires,
      },
    });

    if (sampleTraceQueries.length < 5) {
      sampleTraceQueries.push({
        ip: publicIp,
        port: portRangeStart,
        ts: new Date(timestampStart.getTime() + 1000).toISOString(),
      });
    }
  }

  const counts = {
    devices: await prisma.device.count(),
    links: await prisma.link.count(),
    interfaces: await prisma.interface.count(),
    addresses: await prisma.ipAddress.count(),
    sessions: await prisma.subscriberSession.count(),
    active_sessions: await prisma.subscriberSession.count({ where: { state: "ACTIVE" } }),
    cgnat_mappings: await prisma.cgnatMapping.count(),
  };

  const output = {
    ...manifest,
    counts,
    sample_trace_queries: sampleTraceQueries,
  };

  fs.mkdirSync(perfDir, { recursive: true });
  fs.writeFileSync(path.join(perfDir, "seed-manifest.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

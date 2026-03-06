import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- Zod Schemas ---
const DeviceSchema = z.object({
  name: z.string(),
  type: z.enum(["OLT", "ONT", "SPLITTER", "ODF", "ROUTER"]),
  x: z.number(),
  y: z.number(),
  parentId: z.string().optional(),
});

const LinkSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  sourcePortId: z.string(),
  targetPortId: z.string(),
});

// --- Services (Simplified) ---

const createPortsForDevice = async (deviceId: string, type: string) => {
  const ports = [];
  if (type === "OLT") {
    // 1 Uplink, 4 PON
    ports.push({ deviceId, portNumber: 0, portType: "UPLINK", status: "UP" });
    for (let i = 1; i <= 4; i++) {
      ports.push({ deviceId, portNumber: i, portType: "PON", status: "UP" });
    }
  } else if (type === "ONT") {
    // 1 PON, 1 LAN
    ports.push({ deviceId, portNumber: 0, portType: "PON", status: "UP" });
    ports.push({ deviceId, portNumber: 1, portType: "LAN", status: "UP" });
  } else if (type === "SPLITTER") {
    // 1 IN, 8 OUT
    ports.push({ deviceId, portNumber: 0, portType: "IN", status: "UP" });
    for (let i = 1; i <= 8; i++) {
      ports.push({ deviceId, portNumber: i, portType: "OUT", status: "UP" });
    }
  }
  
  if (ports.length > 0) {
    await prisma.port.createMany({ data: ports });
  }
};

// --- API Routes ---

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Devices
app.get("/api/devices", async (req, res) => {
  const devices = await prisma.device.findMany({
    include: { ports: true },
  });
  res.json(devices);
});

app.post("/api/devices", async (req, res) => {
  try {
    const data = DeviceSchema.parse(req.body);
    // For MVP, we use a default network
    let network = await prisma.network.findFirst();
    if (!network) {
      network = await prisma.network.create({ data: { name: "Default" } });
    }

    const device = await prisma.device.create({
      data: {
        ...data,
        networkId: network.id,
        status: "OK",
        model: "Generic",
      },
    });

    await createPortsForDevice(device.id, device.type);
    
    const deviceWithPorts = await prisma.device.findUnique({
      where: { id: device.id },
      include: { ports: true },
    });

    io.emit("device:created", deviceWithPorts);
    res.status(201).json(deviceWithPorts);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e });
  }
});

app.delete("/api/devices/:id", async (req, res) => {
  const { id } = req.params;
  // Cascade delete ports and links handled by Prisma if configured, 
  // but for now manual cleanup might be safer or rely on cascade.
  // Schema doesn't specify cascade, so we delete manually.
  await prisma.link.deleteMany({
    where: {
      OR: [
        { sourcePort: { deviceId: id } },
        { targetPort: { deviceId: id } },
      ],
    },
  });
  await prisma.port.deleteMany({ where: { deviceId: id } });
  await prisma.device.delete({ where: { id } });
  
  io.emit("device:deleted", { id });
  res.status(204).send();
});

// Links
app.get("/api/links", async (req, res) => {
  const links = await prisma.link.findMany({
    include: {
      sourcePort: true,
      targetPort: true,
    },
  });
  res.json(links);
});

app.post("/api/links", async (req, res) => {
  try {
    const { sourcePortId, targetPortId } = LinkSchema.parse(req.body);
    
    // Check if ports exist and are free (simplified)
    const existingLink = await prisma.link.findFirst({
      where: {
        OR: [
          { sourcePortId },
          { targetPortId },
          { sourcePortId: targetPortId }, // Loopback check
        ],
      },
    });

    if (existingLink) {
      return res.status(409).json({ error: "Port already occupied" });
    }

    const link = await prisma.link.create({
      data: {
        sourcePortId,
        targetPortId,
        fiberLength: 10, // Default
        fiberType: "SMF",
        status: "OK",
      },
      include: {
        sourcePort: true,
        targetPort: true,
      },
    });

    io.emit("link:created", link);
    res.status(201).json(link);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e });
  }
});

app.delete("/api/links/:id", async (req, res) => {
  const { id } = req.params;
  await prisma.link.delete({ where: { id } });
  io.emit("link:deleted", { id });
  res.status(204).send();
});

// Topology
app.get("/api/topology", async (req, res) => {
  const devices = await prisma.device.findMany({ include: { ports: true } });
  const links = await prisma.link.findMany({ include: { sourcePort: true, targetPort: true } });
  
  // Transform to React Flow format
  const nodes = devices.map(d => ({
    id: d.id,
    type: d.type, // Map to frontend node types
    position: { x: d.x, y: d.y },
    data: { ...d },
  }));

  const edges = links.map(l => ({
    id: l.id,
    source: l.sourcePort.deviceId,
    target: l.targetPort.deviceId,
    sourceHandle: l.sourcePortId,
    targetHandle: l.targetPortId,
    data: { ...l },
  }));

  res.json({ nodes, edges });
});

// Ports Summary
app.get("/api/ports/summary/:deviceId", async (req, res) => {
  const { deviceId } = req.params;
  const ports = await prisma.port.findMany({
    where: { deviceId },
    include: { outgoingLink: true, incomingLink: true },
  });
  res.json(ports);
});


// --- Traffic Service ---
const TRAFFIC_INTERVAL_MS = 1000;

setInterval(async () => {
  try {
    const devices = await prisma.device.findMany();
    
    // Simulate traffic updates
    const updates = devices.map(d => ({
      id: d.id,
      trafficLoad: Math.floor(Math.random() * 100), // Random load 0-100%
      rxPower: -10 - Math.random() * 5, // Random Rx power -10 to -15 dBm
    }));

    if (updates.length > 0) {
      io.emit("device:metrics", updates);
    }
  } catch (e) {
    console.error("Simulation error:", e);
  }
}, TRAFFIC_INTERVAL_MS);

// --- Server Start ---

async function start() {
  // Vite middleware for development
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
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "client/dist/index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();

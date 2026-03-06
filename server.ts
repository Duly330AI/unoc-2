import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Networks
  app.get("/api/networks", async (req, res) => {
    const networks = await prisma.network.findMany();
    res.json(networks);
  });

  app.post("/api/networks", async (req, res) => {
    const { name } = req.body;
    const network = await prisma.network.create({
      data: { name },
    });
    res.json(network);
  });

  // Devices
  app.get("/api/networks/:networkId/devices", async (req, res) => {
    const { networkId } = req.params;
    const devices = await prisma.device.findMany({
      where: { networkId },
      include: { ports: true },
    });
    res.json(devices);
  });

  app.post("/api/devices", async (req, res) => {
    const { networkId, name, type, x, y, model } = req.body;
    const device = await prisma.device.create({
      data: {
        networkId,
        name,
        type,
        model,
        x,
        y,
        status: "OK",
      },
    });
    res.json(device);
  });

  // Links
  app.get("/api/networks/:networkId/links", async (req, res) => {
    const { networkId } = req.params;
    // Links are global or tied to devices in a network.
    // For simplicity, fetch all links where source or target device is in the network.
    // Or just fetch all links for now if the schema links to devices.
    // Let's assume links are fetched by network context.
    // We need to filter links by devices in the network.
    const devices = await prisma.device.findMany({
      where: { networkId },
      select: { id: true },
    });
    const deviceIds = devices.map((d) => d.id);
    
    // This query is a bit complex without direct networkId on link, but manageable.
    // Actually, let's add networkId to Link for simplicity in the schema.
    const links = await prisma.link.findMany({
      where: {
        OR: [
          { sourcePort: { deviceId: { in: deviceIds } } },
          { targetPort: { deviceId: { in: deviceIds } } },
        ],
      },
    });
    res.json(links);
  });

  app.post("/api/links", async (req, res) => {
    const { sourcePortId, targetPortId, fiberLength, fiberType } = req.body;
    const link = await prisma.link.create({
      data: {
        sourcePortId,
        targetPortId,
        fiberLength,
        fiberType,
        status: "OK",
      },
    });
    res.json(link);
  });

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
    // Production serving
    app.use(express.static(path.resolve(__dirname, "client/dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "client/dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

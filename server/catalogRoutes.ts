import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type CatalogRoutesDeps = {
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
  hardwareCatalog: Array<Record<string, unknown> & { catalog_id: string; device_type: string }>;
  tariffs: Array<unknown>;
  ipamPrefixes: Array<{ role: string; cidr: string; vrf: string }>;
  ipamRoleForDeviceType: (rawType: string) => string | null;
};

export const registerCatalogRoutes = ({
  app,
  asyncRoute,
  prisma,
  sendError,
  hardwareCatalog,
  tariffs,
  ipamPrefixes,
  ipamRoleForDeviceType,
}: CatalogRoutesDeps) => {
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

  app.get("/api/ipam/prefixes", (_req, res) => {
    res.json({ items: ipamPrefixes });
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

      const items = ipamPrefixes.map((prefix) => {
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

  app.get(
    "/api/catalog/hardware",
    asyncRoute(async (req, res) => {
      const type = req.query.type ? String(req.query.type) : null;
      const items = hardwareCatalog.filter((entry) => {
        if (!type) return true;
        return entry.device_type.toUpperCase() === type.toUpperCase();
      });
      return res.json({ items });
    })
  );

  app.get(
    "/api/catalog/hardware/:catalogId",
    asyncRoute(async (req, res) => {
      const item = hardwareCatalog.find((entry) => entry.catalog_id === req.params.catalogId);
      if (!item) {
        return sendError(res, 404, "NOT_FOUND", "Catalog entry not found");
      }
      return res.json(item);
    })
  );

  app.get("/api/catalog/tariffs", (_req, res) => {
    res.json({ items: tariffs });
  });

  app.get("/api/batch/health", (_req, res) => {
    res.json({ status: "ok", backend: "native", available: true, version: "1.0.0" });
  });
};

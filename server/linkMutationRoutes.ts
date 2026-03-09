import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type LinkCreatePayload = {
  a_interface_id: string;
  b_interface_id: string;
  length_km?: number;
  physical_medium_id?: string;
};

type BatchCreatePayload = {
  request_id?: string;
  dry_run?: boolean;
  skip_optical_recompute?: boolean;
  links: Array<{
    a_interface_id: string;
    b_interface_id: string;
    length_km?: number;
    physical_medium_id?: string;
  }>;
};

type BatchDeletePayload = {
  request_id?: string | null;
  link_ids: string[];
};

type LinkUpdatePayload = {
  length_km?: number;
  physical_medium_id?: string;
  status?: "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
};

type LinkOverridePayload = {
  admin_override_status: "UP" | "DOWN" | "DEGRADED" | "BLOCKING" | null;
};

type LinkMutationRouteDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  parseLinkCreate: (body: unknown) => LinkCreatePayload;
  parseBatchCreate: (body: unknown) => BatchCreatePayload;
  parseBatchDelete: (body: unknown) => BatchDeletePayload;
  parseLinkUpdate: (body: unknown) => LinkUpdatePayload;
  parseLinkOverride: (body: unknown) => LinkOverridePayload;
  createLinkInternal: (payload: {
    a_interface_id: string;
    b_interface_id: string;
    length_km?: number;
    physical_medium_id?: string;
  }) => Promise<
    | { ok: true; link: any }
    | { ok: false; status: number; code: string; message: string }
  >;
  deleteLinkInternal: (linkId: string) => Promise<
    | { ok: true; link: any }
    | { ok: false; status: number; code: string; message: string }
  >;
  runBatchCreate: (payload: BatchCreatePayload) => Promise<unknown>;
  mapLinkEventPayload: (link: any, normalizeLinkStatus: (input: string | null | undefined) => any) => unknown;
  mapLinkToApi: (link: any, normalizeLinkStatus: (input: string | null | undefined) => any) => unknown;
  normalizeLinkStatus: (input: string | null | undefined) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  normalizeDeviceStatus: (input: string | null | undefined) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  sendError: (
    res: express.Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) => express.Response;
  bumpTopologyVersion: () => number;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  linkOverrides: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">;
  fiberTypeDbPerKm: Record<string, number>;
};

export const registerLinkMutationRoutes = ({
  app,
  asyncRoute,
  prisma,
  parseLinkCreate,
  parseBatchCreate,
  parseBatchDelete,
  parseLinkUpdate,
  parseLinkOverride,
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
  fiberTypeDbPerKm,
}: LinkMutationRouteDeps) => {
  app.post(
    "/api/links",
    asyncRoute(async (req, res) => {
      const payload = parseLinkCreate(req.body);
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
      emitEvent("linkAdded", mapLinkEventPayload(link, normalizeLinkStatus));
      return res.status(201).json(mapLinkToApi(link, normalizeLinkStatus));
    })
  );

  app.post(
    "/api/links/batch",
    asyncRoute(async (req, res) => {
      const payload = parseBatchCreate(req.body);
      return res.json(await runBatchCreate(payload));
    })
  );

  app.post(
    "/api/links/batch/delete",
    asyncRoute(async (req, res) => {
      const startedAt = Date.now();
      const payload = parseBatchDelete(req.body);
      const requestId = payload.request_id ?? null;
      const ids = payload.link_ids;

      const deletedLinkIds: string[] = [];
      const failedLinks: Array<{ link_id?: string; error_code: string; error_message: string }> = [];

      for (const linkId of ids) {
        const deleted = await deleteLinkInternal(linkId);
        if (!deleted.ok) {
          failedLinks.push({ link_id: linkId, error_code: deleted.code, error_message: deleted.message });
          continue;
        }
        deletedLinkIds.push(linkId);
      }

      if (deletedLinkIds.length > 0) {
        bumpTopologyVersion();
        emitEvent("batchCompleted", {
          request_id: requestId,
          deleted_link_ids: deletedLinkIds,
          failed_links: failedLinks,
        });
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
      const payload = parseLinkUpdate(req.body);
      const id = req.params.id;
      const exists = await prisma.link.findUnique({ where: { id } });
      if (!exists) {
        return sendError(res, 404, "LINK_NOT_FOUND", "Link not found");
      }

      const mediumId = payload.physical_medium_id;
      if (mediumId !== undefined && fiberTypeDbPerKm[mediumId] === undefined) {
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
      emitEvent("linkUpdated", mapLinkEventPayload(updated, normalizeLinkStatus));
      return res.json(mapLinkToApi(updated, normalizeLinkStatus));
    })
  );

  app.patch(
    "/api/links/:id/override",
    asyncRoute(async (req, res) => {
      const payload = parseLinkOverride(req.body);
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
      const updated = await prisma.link.update({
        where: { id },
        data: { status: payload.admin_override_status },
        include: { sourcePort: true, targetPort: true },
      });
      bumpTopologyVersion();
      const effectiveStatus = normalizeLinkStatus(updated.status);
      emitEvent("linkStatusUpdated", {
        id,
        admin_override_status: payload.admin_override_status,
        effective_status: effectiveStatus,
      });

      if (payload.admin_override_status === "UP") {
        const endpointDevices = await prisma.device.findMany({
          where: {
            id: {
              in: [updated.sourcePort.deviceId, updated.targetPort.deviceId],
            },
          },
          select: { id: true, status: true },
        });
        const hasDownEndpoint = endpointDevices.some((candidate: any) => normalizeDeviceStatus(candidate.status) !== "UP");
        if (hasDownEndpoint) {
          emitEvent("overrideConflict", {
            entity: "link",
            id,
            code: "OVERRIDE_CONFLICT",
            reason: "override_up_with_down_endpoint",
          });
        }
      }
      return res.json({
        id,
        admin_override_status: payload.admin_override_status,
        effective_status: effectiveStatus,
      });
    })
  );

  app.delete(
    "/api/links/:id",
    asyncRoute(async (req, res) => {
      const id = req.params.id;
      const deleted = await deleteLinkInternal(id);
      if (!deleted.ok) {
        return sendError(res, deleted.status, deleted.code, deleted.message);
      }
      bumpTopologyVersion();
      emitEvent("linkDeleted", { id });
      return res.status(204).send();
    })
  );
};

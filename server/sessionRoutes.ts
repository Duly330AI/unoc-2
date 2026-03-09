import express from "express";

type AsyncRoute = (handler: express.RequestHandler) => express.RequestHandler;

type SessionCreatePayload = {
  interfaceId: string;
  bngDeviceId: string;
  serviceType: string;
  protocol: string;
  macAddress: string;
};

type SessionListQuery = {
  device_id?: string;
  bng_device_id?: string;
  state?: string;
  service_type?: string;
  limit: number;
  offset: number;
};

type SessionPatchPayload = {
  state: string;
};

type SessionValidateVlanPathPayload = {
  device_id: string;
  bng_device_id: string;
  c_tag: number;
  s_tag?: number;
  service_type: string;
};

type ForensicsTraceQuery = {
  ip: string;
  port: number;
  ts: string;
};

type SessionRouteDeps = {
  app: express.Express;
  asyncRoute: AsyncRoute;
  prisma: any;
  parseSessionCreate: (body: unknown) => SessionCreatePayload;
  parseSessionListQuery: (query: unknown) => SessionListQuery;
  parseSessionPatch: (body: unknown) => SessionPatchPayload;
  parseSessionValidateVlanPath: (body: unknown) => SessionValidateVlanPathPayload;
  parseForensicsTraceQuery: (query: unknown) => ForensicsTraceQuery;
  sendError: (
    res: express.Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) => express.Response;
  isSubscriberDeviceType: (type: string) => boolean;
  normalizeDeviceType: (input: string) => string | undefined;
  ensureSessionVlanPathValid: (tx: any, session: any) => Promise<void>;
  validateVlanPath: (
    tx: any,
    payload: { deviceId: string; serviceType: string; cTag: number; sTag?: number | null }
  ) => Promise<{ valid: boolean; reason_code: string | null; serving_olt_id: string | null }>;
  createCgnatMappingForSession: (tx: any, session: any) => Promise<{ created: boolean; mapping: any }>;
  closeOpenCgnatMappings: (tx: any, sessionIds: string[], closedAt?: Date) => Promise<unknown>;
  buildDeviceAdjacency: (deviceIds: string[], links: any[]) => Map<string, string[]>;
  findServingOltForLeaf: (
    leafId: string,
    adjacency: Map<string, string[]>,
    typeById: Map<string, any>,
    passiveInlineTypes: Set<string>
  ) => string | null;
  deriveSessionTariff: (deviceType: string, serviceType: string) => any;
  emitEvent: (kind: string, payload: unknown, includeTopoVersion?: boolean, correlationId?: string) => void;
  passiveInlineTypes: Set<string>;
  sessionStates: Record<string, string>;
  serviceStatuses: Record<string, string>;
  reasonCodes: Record<string, string>;
};

export const registerSessionRoutes = ({
  app,
  asyncRoute,
  prisma,
  parseSessionCreate,
  parseSessionListQuery,
  parseSessionPatch,
  parseSessionValidateVlanPath,
  parseForensicsTraceQuery,
  sendError,
  isSubscriberDeviceType,
  normalizeDeviceType,
  ensureSessionVlanPathValid,
  validateVlanPath,
  createCgnatMappingForSession,
  closeOpenCgnatMappings,
  buildDeviceAdjacency,
  findServingOltForLeaf,
  deriveSessionTariff,
  emitEvent,
  passiveInlineTypes,
  sessionStates,
  serviceStatuses,
  reasonCodes,
}: SessionRouteDeps) => {
  app.post(
    "/api/sessions/validate-vlan-path",
    asyncRoute(async (req, res) => {
      const payload = parseSessionValidateVlanPath(req.body);

      const bngDevice = await prisma.device.findUnique({ where: { id: payload.bng_device_id } });
      if (!bngDevice || normalizeDeviceType(bngDevice.type) !== "EDGE_ROUTER") {
        return res.json({
          valid: false,
          reason_code: "BNG_UNREACHABLE",
          serving_olt_id: null,
        });
      }

      const result = await validateVlanPath(prisma, {
        deviceId: payload.device_id,
        serviceType: payload.service_type.toUpperCase(),
        cTag: payload.c_tag,
        sTag: payload.s_tag ?? null,
      });

      return res.json(result);
    })
  );

  app.post(
    "/api/sessions",
    asyncRoute(async (req, res) => {
      const payload = parseSessionCreate(req.body);

      const subscriberInterface = await prisma.interface.findUnique({
        where: { id: payload.interfaceId },
        include: { device: true },
      });
      if (!subscriberInterface) {
        return sendError(res, 404, "INTERFACE_NOT_FOUND", "Interface not found");
      }

      if (!isSubscriberDeviceType(subscriberInterface.device.type)) {
        return sendError(res, 400, "VALIDATION_ERROR", "Subscriber sessions require ONT, BUSINESS_ONT or AON_CPE interfaces");
      }

      const bngDevice = await prisma.device.findUnique({ where: { id: payload.bngDeviceId } });
      if (!bngDevice) {
        return sendError(res, 404, "DEVICE_NOT_FOUND", "BNG device not found");
      }

      if (normalizeDeviceType(bngDevice.type) !== "EDGE_ROUTER") {
        return sendError(res, 422, "BNG_UNREACHABLE", "BNG device must be an EDGE_ROUTER");
      }

      const session = await prisma.subscriberSession.create({
        data: {
          interfaceId: payload.interfaceId,
          bngDeviceId: payload.bngDeviceId,
          macAddress: payload.macAddress.toLowerCase(),
          protocol: payload.protocol.toUpperCase(),
          serviceType: payload.serviceType.toUpperCase(),
          state: sessionStates.INIT,
          infraStatus: "UP",
          serviceStatus: serviceStatuses.DEGRADED,
          reasonCode: reasonCodes.SESSION_NOT_ACTIVE,
        },
      });

      return res.status(201).json({
        session_id: session.id,
        state: session.state,
        infra_status: session.infraStatus,
        service_status: session.serviceStatus,
        reason_code: session.reasonCode,
        interface_id: session.interfaceId,
        bng_device_id: session.bngDeviceId,
        service_type: session.serviceType,
        protocol: session.protocol,
        mac_address: session.macAddress,
      });
    })
  );

  app.get(
    "/api/sessions",
    asyncRoute(async (req, res) => {
      const query = parseSessionListQuery(req.query);
      const where = {
        ...(query.device_id
          ? {
              interface: {
                deviceId: query.device_id,
              },
            }
          : {}),
        ...(query.bng_device_id ? { bngDeviceId: query.bng_device_id } : {}),
        ...(query.state ? { state: query.state.toUpperCase() } : {}),
        ...(query.service_type ? { serviceType: query.service_type.toUpperCase() } : {}),
      };

      const [totalCount, sessions] = await Promise.all([
        prisma.subscriberSession.count({ where }),
        prisma.subscriberSession.findMany({
          where,
          include: {
            interface: {
              include: {
                device: true,
              },
            },
          },
          orderBy: { id: "asc" },
          take: query.limit,
          skip: query.offset,
        }),
      ]);

      res.setHeader("X-Total-Count", totalCount.toString());

      return res.json(
        sessions.map((session: any) => ({
          session_id: session.id,
          state: session.state,
          infra_status: session.infraStatus,
          service_status: session.serviceStatus,
          reason_code: session.reasonCode,
          interface_id: session.interfaceId,
          device_id: session.interface.deviceId,
          bng_device_id: session.bngDeviceId,
          service_type: session.serviceType,
          protocol: session.protocol,
          mac_address: session.macAddress,
        }))
      );
    })
  );

  app.patch(
    "/api/sessions/:id",
    asyncRoute(async (req, res) => {
      const payload = parseSessionPatch(req.body);
      const requestedState = payload.state.toUpperCase();
      const session = await prisma.subscriberSession.findUnique({ where: { id: req.params.id } });
      if (!session) {
        return sendError(res, 404, "NOT_FOUND", "Session not found");
      }

      const allowedTransitions: Record<string, string[]> = {
        [sessionStates.INIT]: [sessionStates.ACTIVE],
        [sessionStates.ACTIVE]: [sessionStates.RELEASED, sessionStates.EXPIRED],
      };

      if (!Object.values(sessionStates).includes(requestedState)) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid session state transition target");
      }

      const nextAllowedStates = allowedTransitions[session.state] ?? [];
      if (!nextAllowedStates.includes(requestedState)) {
        return sendError(res, 422, "VALIDATION_ERROR", "Illegal session state transition");
      }

      let createdMapping:
        | {
            id: string;
            publicIp: string;
            portRangeStart: number;
            portRangeEnd: number;
            sessionId: string;
          }
        | undefined;

      let updated;
      try {
        updated = await prisma.$transaction(async (tx: any) => {
          if (requestedState === sessionStates.ACTIVE) {
            await ensureSessionVlanPathValid(tx, session);
          }

          const updatedSession = await tx.subscriberSession.update({
            where: { id: req.params.id },
            data: {
              state: requestedState,
              serviceStatus:
                requestedState === sessionStates.ACTIVE
                  ? serviceStatuses.UP
                  : requestedState === sessionStates.EXPIRED || requestedState === sessionStates.RELEASED
                    ? serviceStatuses.DOWN
                    : session.serviceStatus,
              reasonCode: requestedState === sessionStates.ACTIVE ? null : session.reasonCode,
            },
          });

          if (requestedState === sessionStates.ACTIVE) {
            const mappingResult = await createCgnatMappingForSession(tx, updatedSession);
            if (mappingResult.created) {
              createdMapping = {
                id: mappingResult.mapping.id,
                publicIp: mappingResult.mapping.publicIp,
                portRangeStart: mappingResult.mapping.portRangeStart,
                portRangeEnd: mappingResult.mapping.portRangeEnd,
                sessionId: mappingResult.mapping.sessionId,
              };
            }
          } else if (requestedState === sessionStates.EXPIRED || requestedState === sessionStates.RELEASED) {
            await closeOpenCgnatMappings(tx, [updatedSession.id]);
          }

          return updatedSession;
        });
      } catch (error) {
        const errorCode = (error as { code?: string } | null)?.code;
        if (errorCode === "CGNAT_POOL_EXHAUSTED") {
          return sendError(res, 409, "CGNAT_POOL_EXHAUSTED", "No CGNAT slot available for session activation");
        }
        if (errorCode === "VLAN_PATH_INVALID") {
          return sendError(res, 422, "VLAN_PATH_INVALID", "Subscriber VLAN path is invalid for the requested service");
        }
        throw error;
      }

      if (createdMapping) {
        emitEvent("cgnatMappingCreated", {
          mapping_id: createdMapping.id,
          session_id: createdMapping.sessionId,
          public_ip: createdMapping.publicIp,
          port_range: `${createdMapping.portRangeStart}-${createdMapping.portRangeEnd}`,
        });
      }

      return res.json({
        session_id: updated.id,
        state: updated.state,
        infra_status: updated.infraStatus,
        service_status: updated.serviceStatus,
        reason_code: updated.reasonCode,
        interface_id: updated.interfaceId,
        bng_device_id: updated.bngDeviceId,
        service_type: updated.serviceType,
        protocol: updated.protocol,
        mac_address: updated.macAddress,
      });
    })
  );

  app.get(
    "/api/forensics/trace",
    asyncRoute(async (req, res) => {
      const query = parseForensicsTraceQuery(req.query);
      const timestamp = new Date(query.ts);
      const mapping = await prisma.cgnatMapping.findFirst({
        where: {
          publicIp: query.ip,
          portRangeStart: { lte: query.port },
          portRangeEnd: { gte: query.port },
          timestampStart: { lte: timestamp },
          OR: [{ timestampEnd: null }, { timestampEnd: { gte: timestamp } }],
        },
        include: {
          session: {
            include: {
              interface: {
                include: {
                  device: true,
                },
              },
              bngDevice: true,
            },
          },
        },
        orderBy: [{ timestampStart: "desc" }, { id: "asc" }],
      });

      if (!mapping) {
        return sendError(res, 404, "TRACE_NOT_FOUND", "No CGNAT mapping found for the requested ip/port/timestamp");
      }

      const allDevices = await prisma.device.findMany({ select: { id: true, type: true } });
      const links = await prisma.link.findMany({
        include: {
          sourcePort: { select: { deviceId: true } },
          targetPort: { select: { deviceId: true } },
        },
      });
      const typeById = new Map<string, any>();
      for (const device of allDevices) {
        const normalized = normalizeDeviceType(device.type);
        if (!normalized) continue;
        typeById.set(device.id, normalized);
      }
      const adjacency = buildDeviceAdjacency(
        allDevices.map((device: any) => device.id),
        links
      );
      const subscriberDevice = mapping.session.interface.device;
      const oltId = isSubscriberDeviceType(subscriberDevice.type)
        ? findServingOltForLeaf(subscriberDevice.id, adjacency, typeById, passiveInlineTypes)
        : null;
      const tariff = deriveSessionTariff(subscriberDevice.type, mapping.session.serviceType);

      const response = {
        query: { ip: query.ip, port: query.port, ts: query.ts },
        mapping: {
          mapping_id: mapping.id,
          private_ip: mapping.privateIp,
          public_ip: mapping.publicIp,
          port_range: `${mapping.portRangeStart}-${mapping.portRangeEnd}`,
          timestamp_start: mapping.timestampStart.toISOString(),
          timestamp_end: mapping.timestampEnd?.toISOString() ?? null,
          retention_expires: mapping.retentionExpires.toISOString(),
        },
        session: {
          session_id: mapping.session.id,
          state: mapping.session.state,
          service_type: mapping.session.serviceType,
          protocol: mapping.session.protocol,
          mac_address: mapping.session.macAddress,
        },
        device: {
          id: subscriberDevice.id,
          type: normalizeDeviceType(subscriberDevice.type) ?? subscriberDevice.type,
          infra_status: mapping.session.infraStatus,
          service_status: mapping.session.serviceStatus,
        },
        tariff,
        topology: {
          olt_id: oltId,
          bng_id: mapping.session.bngDeviceId,
          pop_id: null,
        },
      };

      emitEvent("forensicsTraceResolved", response, false);

      return res.json(response);
    })
  );
};

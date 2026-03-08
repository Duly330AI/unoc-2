type DeviceStatus = "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
type LinkStatus = "UP" | "DOWN" | "DEGRADED" | "BLOCKING";

type PassabilitySnapshot<TDevice extends { id: string; type: string; status: string; provisioned?: boolean | null }, TLink> = {
  links: TLink[];
  adjacency: Map<string, string[]>;
  typeById: Map<string, string>;
  statusById: Map<string, DeviceStatus>;
  provisionedById: Map<string, boolean>;
};

type RuntimeStatusDeps = {
  defaultType: string;
  passableInlineTypes: Set<string>;
  routerClassTypes: Set<string>;
  alwaysOnlineTypes: Set<string>;
  isSubscriberDeviceType: (type: string) => boolean;
  normalizeDeviceType: (input: string) => string | undefined;
  normalizeDeviceStatus: (input: string | null | undefined) => DeviceStatus;
  normalizeLinkStatus: (input: string | null | undefined) => LinkStatus;
  hasDeviceOverride: (deviceId: string) => boolean;
};

type DiagnosticsResult = {
  device_id: string;
  upstream_l3_ok: boolean;
  chain: string[];
  reason_codes: string[];
};

export const isPassableRuntimeStatus = (status: DeviceStatus | LinkStatus) => status !== "DOWN" && status !== "BLOCKING";

export const buildDeviceAdjacency = (
  deviceIds: string[],
  links: Array<{ sourcePort: { deviceId: string }; targetPort: { deviceId: string } }>
) => {
  const adjacency = new Map<string, string[]>();
  for (const deviceId of deviceIds) {
    adjacency.set(deviceId, []);
  }

  for (const link of links) {
    const a = link.sourcePort.deviceId;
    const b = link.targetPort.deviceId;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }

  for (const [deviceId, neighbors] of adjacency.entries()) {
    adjacency.set(deviceId, neighbors.sort((a, b) => a.localeCompare(b)));
  }

  return adjacency;
};

export const findServingOltForLeaf = (
  leafId: string,
  adjacency: Map<string, string[]>,
  typeById: Map<string, string>,
  passiveInlineTypes: Set<string>
) => {
  const queue: string[] = [leafId];
  const visited = new Set<string>([leafId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighborId of adjacency.get(current) ?? []) {
      if (visited.has(neighborId)) continue;
      const neighborType = typeById.get(neighborId);
      if (!neighborType) continue;
      if (neighborType === "OLT") return neighborId;
      if (!passiveInlineTypes.has(neighborType)) continue;
      visited.add(neighborId);
      queue.push(neighborId);
    }
  }

  return null;
};

export const hasPathToSpecificDevice = (
  startId: string,
  targetId: string,
  adjacency: Map<string, string[]>,
  typeById: Map<string, string>,
  isAllowedIntermediate: (type: string) => boolean
) => {
  if (startId === targetId) return true;

  const queue: string[] = [startId];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      if (next === targetId) return true;
      const nextType = typeById.get(next);
      if (!nextType || !isAllowedIntermediate(nextType)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return false;
};

export const findPathToMatchingDevice = (
  startId: string,
  adjacency: Map<string, string[]>,
  typeById: Map<string, string>,
  matchesTarget: (deviceId: string, type: string) => boolean,
  isAllowedIntermediate: (type: string) => boolean
) => {
  const queue: Array<{ id: string; path: string[] }> = [{ id: startId, path: [startId] }];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current.id) ?? []) {
      if (visited.has(next)) continue;
      const nextType = typeById.get(next);
      if (!nextType) continue;
      const nextPath = [...current.path, next];
      if (matchesTarget(next, nextType)) {
        return nextPath;
      }
      if (!isAllowedIntermediate(nextType)) continue;
      visited.add(next);
      queue.push({ id: next, path: nextPath });
    }
  }

  return null;
};

export const buildPassabilityState = <
  TDevice extends { id: string; type: string; status: string; provisioned?: boolean | null },
  TLink extends { status: string; sourcePort: { deviceId: string }; targetPort: { deviceId: string } }
>(
  devices: TDevice[],
  links: TLink[],
  deps: RuntimeStatusDeps
): PassabilitySnapshot<TDevice, TLink> => {
  const typeById = new Map<string, string>();
  const statusById = new Map<string, DeviceStatus>();
  const provisionedById = new Map<string, boolean>();
  for (const device of devices) {
    const normalizedType = deps.normalizeDeviceType(device.type) ?? deps.defaultType;
    typeById.set(device.id, normalizedType);
    statusById.set(device.id, deps.normalizeDeviceStatus(device.status));
    provisionedById.set(device.id, Boolean(device.provisioned));
  }

  const passableLinks = links.filter((link) => {
    if (!isPassableRuntimeStatus(deps.normalizeLinkStatus(link.status))) return false;
    const sourceStatus = statusById.get(link.sourcePort.deviceId);
    const targetStatus = statusById.get(link.targetPort.deviceId);
    return Boolean(
      sourceStatus &&
        targetStatus &&
        (deps.hasDeviceOverride(link.sourcePort.deviceId) ? isPassableRuntimeStatus(sourceStatus) : sourceStatus !== "BLOCKING") &&
        (deps.hasDeviceOverride(link.targetPort.deviceId) ? isPassableRuntimeStatus(targetStatus) : targetStatus !== "BLOCKING")
    );
  });

  const adjacency = buildDeviceAdjacency(
    devices.map((device) => device.id),
    passableLinks
  );

  return {
    links: passableLinks,
    adjacency,
    typeById,
    statusById,
    provisionedById,
  };
};

export const buildL3AnchorRouterSet = (
  adjacency: Map<string, string[]>,
  typeById: Map<string, string>,
  statusById: Map<string, DeviceStatus>,
  routerClassTypes: Set<string>
) => {
  const backboneIds = Array.from(typeById.entries())
    .filter(([deviceId, type]) => type === "BACKBONE_GATEWAY" && isPassableRuntimeStatus(statusById.get(deviceId) ?? "DOWN"))
    .map(([deviceId]) => deviceId)
    .sort((a, b) => a.localeCompare(b));

  if (backboneIds.length === 0) {
    return new Set(
      Array.from(typeById.entries())
        .filter(([deviceId, type]) => routerClassTypes.has(type) && isPassableRuntimeStatus(statusById.get(deviceId) ?? "DOWN"))
        .map(([deviceId]) => deviceId)
    );
  }

  const visited = new Set<string>(backboneIds);
  const queue = [...backboneIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      const nextType = typeById.get(next);
      if (!nextType || !routerClassTypes.has(nextType)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return visited;
};

export const computeDeviceDiagnosticsFromSnapshot = (
  snapshot: {
    adjacency: Map<string, string[]>;
    typeById: Map<string, string>;
    statusById: Map<string, DeviceStatus>;
    provisionedById: Map<string, boolean>;
  },
  device: { id: string; type: string; status: string; provisioned?: boolean | null },
  deps: RuntimeStatusDeps
): DiagnosticsResult => {
  const deviceId = device.id;
  const deviceType = snapshot.typeById.get(deviceId) ?? deps.normalizeDeviceType(device.type) ?? deps.defaultType;
  const reasonCodes: string[] = [];
  const selfStatus = snapshot.statusById.get(deviceId) ?? deps.normalizeDeviceStatus(device.status);
  const anchorRouters = buildL3AnchorRouterSet(snapshot.adjacency, snapshot.typeById, snapshot.statusById, deps.routerClassTypes);
  const isPassableRouterTarget = (candidateId: string, type: string) =>
    deps.routerClassTypes.has(type) && isPassableRuntimeStatus(snapshot.statusById.get(candidateId) ?? "DOWN");
  const pushReason = (reason: string) => {
    if (!reasonCodes.includes(reason)) {
      reasonCodes.push(reason);
    }
  };
  const hasExplicitOverride = deps.hasDeviceOverride(deviceId);

  if (!snapshot.provisionedById.get(deviceId) && (deviceType === "OLT" || deviceType === "AON_SWITCH" || deps.isSubscriberDeviceType(deviceType))) {
    pushReason("not_provisioned");
  }
  if ((hasExplicitOverride || selfStatus === "BLOCKING") && !isPassableRuntimeStatus(selfStatus)) {
    pushReason("device_not_passable");
  }
  if ((snapshot.adjacency.get(deviceId) ?? []).length === 0 && deviceType !== "BACKBONE_GATEWAY") {
    pushReason("device_not_in_graph");
  }

  let chain: string[] = [deviceId];
  let upstreamOk = false;

  if (reasonCodes.length === 0 || reasonCodes.every((reason) => reason === "device_not_in_graph")) {
    if (deviceType === "BACKBONE_GATEWAY") {
      upstreamOk = isPassableRuntimeStatus(selfStatus);
    } else if (deps.routerClassTypes.has(deviceType)) {
      const path = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (candidateId, type) => type === "BACKBONE_GATEWAY" || (candidateId !== deviceId && anchorRouters.has(candidateId)),
        (type) => deps.routerClassTypes.has(type)
      );
      if (path) {
        chain = path;
        upstreamOk = true;
      } else {
        pushReason("no_router_path");
      }
    } else if (deviceType === "OLT") {
      const path = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (candidateId, type) => deps.routerClassTypes.has(type) && anchorRouters.has(candidateId),
        (type) => type === "OLT" || deps.routerClassTypes.has(type)
      );
      if (path) {
        chain = path;
        upstreamOk = true;
      } else {
        pushReason("no_router_path");
      }
    } else if (deviceType === "AON_SWITCH") {
      const path = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (candidateId, type) => deps.routerClassTypes.has(type) && anchorRouters.has(candidateId),
        (type) => type === "AON_SWITCH" || deps.routerClassTypes.has(type)
      );
      if (path) {
        chain = path;
        upstreamOk = true;
      } else {
        pushReason("no_router_path");
      }
    } else if (deviceType === "ONT" || deviceType === "BUSINESS_ONT") {
      const oltPath = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (_candidateId, type) => type === "OLT",
        (type) => deps.passableInlineTypes.has(type)
      );
      if (!oltPath) {
        pushReason("no_serving_olt");
      } else {
        const servingOltId = oltPath[oltPath.length - 1]!;
        const routerPath = findPathToMatchingDevice(
          servingOltId,
          snapshot.adjacency,
          snapshot.typeById,
          (candidateId, type) => isPassableRouterTarget(candidateId, type),
          (type) => type === "OLT" || deps.routerClassTypes.has(type)
        );
        if (!routerPath) {
          pushReason("no_router_path");
          chain = oltPath;
        } else {
          chain = [...oltPath, ...routerPath.slice(1)];
          upstreamOk = true;
        }
      }
    } else if (deviceType === "AON_CPE") {
      const path = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (candidateId, type) => isPassableRouterTarget(candidateId, type),
        (type) => type === "AON_SWITCH" || deps.routerClassTypes.has(type)
      );
      if (path) {
        chain = path;
        upstreamOk = true;
      } else {
        pushReason("no_router_path");
      }
    } else if (deps.passableInlineTypes.has(deviceType)) {
      const upstreamPath = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (candidateId, type) => type === "OLT" || isPassableRouterTarget(candidateId, type),
        (type) => deps.passableInlineTypes.has(type) || type === "OLT" || deps.routerClassTypes.has(type)
      );
      const downstreamPath = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (_candidateId, type) => deps.isSubscriberDeviceType(type),
        (type) => deps.passableInlineTypes.has(type)
      );
      if (!upstreamPath) {
        pushReason("no_router_path");
      }
      if (!downstreamPath) {
        pushReason("no_downstream_terminator");
      }
      if (upstreamPath) {
        chain = upstreamPath;
      }
      upstreamOk = Boolean(upstreamPath && downstreamPath);
    } else {
      const path = findPathToMatchingDevice(
        deviceId,
        snapshot.adjacency,
        snapshot.typeById,
        (candidateId, type) => deps.routerClassTypes.has(type) && anchorRouters.has(candidateId),
        () => true
      );
      if (path) {
        chain = path;
        upstreamOk = true;
      } else if (!deps.alwaysOnlineTypes.has(deviceType)) {
        pushReason("no_router_path");
      }
    }
  }

  return {
    device_id: deviceId,
    upstream_l3_ok: upstreamOk,
    chain,
    reason_codes: reasonCodes,
  };
};

export const evaluateDeviceRuntimeStatus = (
  snapshot: {
    adjacency: Map<string, string[]>;
    typeById: Map<string, string>;
    statusById: Map<string, DeviceStatus>;
    provisionedById: Map<string, boolean>;
  },
  device: { id: string; type: string; status: string; provisioned?: boolean | null },
  deps: RuntimeStatusDeps
): DeviceStatus => {
  const deviceType = snapshot.typeById.get(device.id) ?? deps.normalizeDeviceType(device.type) ?? deps.defaultType;
  const selfStatus = snapshot.statusById.get(device.id) ?? deps.normalizeDeviceStatus(device.status);
  const passableBaseStatus: DeviceStatus = selfStatus === "DEGRADED" ? "DEGRADED" : "UP";
  const hasExplicitOverride = deps.hasDeviceOverride(device.id);

  if (hasExplicitOverride) {
    return selfStatus === "BLOCKING" ? "DOWN" : selfStatus;
  }

  if (deps.alwaysOnlineTypes.has(deviceType)) {
    return "UP";
  }

  const diagnostics = computeDeviceDiagnosticsFromSnapshot(snapshot, device, deps);

  if (deps.routerClassTypes.has(deviceType)) {
    return diagnostics.upstream_l3_ok ? passableBaseStatus : "DOWN";
  }

  if (deviceType === "OLT" || deviceType === "AON_SWITCH") {
    if (!snapshot.provisionedById.get(device.id)) {
      return "DOWN";
    }
    return diagnostics.upstream_l3_ok ? passableBaseStatus : "DOWN";
  }

  if (deps.isSubscriberDeviceType(deviceType)) {
    if (!snapshot.provisionedById.get(device.id)) {
      return "DOWN";
    }
    return passableBaseStatus;
  }

  if (deps.passableInlineTypes.has(deviceType)) {
    if (
      diagnostics.reason_codes.includes("device_not_passable") ||
      diagnostics.reason_codes.includes("no_router_path") ||
      diagnostics.reason_codes.includes("device_not_in_graph")
    ) {
      return "DOWN";
    }
    return "UP";
  }

  return selfStatus === "BLOCKING" ? "DOWN" : selfStatus;
};

export const hasSubscriberUpstreamViability = (
  deviceId: string,
  subscriberType: string,
  bngDeviceId: string | null,
  adjacency: Map<string, string[]>,
  typeById: Map<string, string>,
  statusById: Map<string, DeviceStatus>,
  provisionedById: Map<string, boolean>,
  deps: Pick<RuntimeStatusDeps, "passableInlineTypes" | "routerClassTypes">
) => {
  if (!provisionedById.get(deviceId)) return false;
  const selfStatus = statusById.get(deviceId);
  if (!selfStatus || !isPassableRuntimeStatus(selfStatus)) return false;

  if (!bngDeviceId) return false;
  const bngType = typeById.get(bngDeviceId);
  const bngStatus = statusById.get(bngDeviceId);
  if (bngType !== "EDGE_ROUTER" || !bngStatus || !isPassableRuntimeStatus(bngStatus)) {
    return false;
  }

  if (subscriberType === "ONT" || subscriberType === "BUSINESS_ONT") {
    const servingOltId = findServingOltForLeaf(deviceId, adjacency, typeById, deps.passableInlineTypes);
    if (!servingOltId) return false;

    const oltStatus = statusById.get(servingOltId);
    if (!oltStatus || !isPassableRuntimeStatus(oltStatus)) return false;

    return hasPathToSpecificDevice(
      servingOltId,
      bngDeviceId,
      adjacency,
      typeById,
      (type) => type === "OLT" || deps.routerClassTypes.has(type)
    );
  }

  if (subscriberType === "AON_CPE") {
    return hasPathToSpecificDevice(
      deviceId,
      bngDeviceId,
      adjacency,
      typeById,
      (type) => type === "AON_SWITCH" || deps.routerClassTypes.has(type)
    );
  }

  return false;
};

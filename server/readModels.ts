type RuntimeStatusDeps = {
  buildPassabilityState: (devices: any[], links: any[]) => {
    adjacency: Map<string, string[]>;
    typeById: Map<string, string>;
    statusById: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">;
    provisionedById: Map<string, boolean>;
  };
  evaluateDeviceRuntimeStatus: (snapshot: any, device: any) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  normalizeDeviceType: (input: string) => string | undefined;
  normalizeDeviceStatus: (input: string | null | undefined) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
  normalizeLinkStatus: (input: string | null | undefined) => "UP" | "DOWN" | "DEGRADED" | "BLOCKING";
};

export const buildRuntimeStatusByDeviceId = (
  devices: any[],
  links: any[],
  deps: Pick<RuntimeStatusDeps, "buildPassabilityState" | "evaluateDeviceRuntimeStatus">
) => {
  const snapshot = deps.buildPassabilityState(devices, links);
  const runtimeStatusById = new Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">();

  for (const device of devices) {
    runtimeStatusById.set(device.id, deps.evaluateDeviceRuntimeStatus(snapshot, device));
  }

  return runtimeStatusById;
};

export const mapDeviceToNode = (
  device: any,
  deps: Pick<RuntimeStatusDeps, "normalizeDeviceType" | "normalizeDeviceStatus">,
  runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">
) => ({
  id: device.id,
  type: "device",
  position: { x: device.x, y: device.y },
  data: {
    id: device.id,
    name: device.name,
    label: device.name,
    type: deps.normalizeDeviceType(device.type) ?? device.type,
    status: runtimeStatusById?.get(device.id) ?? deps.normalizeDeviceStatus(device.status),
    parent_container_id: device.parentContainerId ?? null,
    ports: device.ports,
  },
});

export const mapDeviceToApi = (
  device: any,
  deps: Pick<RuntimeStatusDeps, "normalizeDeviceType" | "normalizeDeviceStatus">,
  runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">
) => ({
  ...device,
  type: deps.normalizeDeviceType(device.type) ?? device.type,
  status: runtimeStatusById?.get(device.id) ?? deps.normalizeDeviceStatus(device.status),
  parent_container_id: device.parentContainerId ?? null,
});

export const mapLinkToEdge = (link: any, normalizeLinkStatus: RuntimeStatusDeps["normalizeLinkStatus"]) => ({
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

export const mapLinkToApi = (link: any, normalizeLinkStatus: RuntimeStatusDeps["normalizeLinkStatus"]) => ({
  ...link,
  status: normalizeLinkStatus(link.status),
  a_interface_id: link.sourcePortId,
  b_interface_id: link.targetPortId,
  a_device_id: link.sourcePort?.deviceId,
  b_device_id: link.targetPort?.deviceId,
  length_km: link.fiberLength,
  physical_medium_id: link.fiberType,
});

export const mapLinkEventPayload = (link: any, normalizeLinkStatus: RuntimeStatusDeps["normalizeLinkStatus"]) => ({
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

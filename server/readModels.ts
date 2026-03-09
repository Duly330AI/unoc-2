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

type RuntimeStatus = "UP" | "DOWN" | "DEGRADED" | "BLOCKING";

type ContainerAggregate = {
  health: "UP" | "DOWN" | "DEGRADED";
  downstreamMbps: number;
  upstreamMbps: number;
  occupancy: number;
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

export const buildContainerAggregateById = (
  devices: any[],
  runtimeStatusById: Map<string, RuntimeStatus>,
  latestMetrics: Array<{ id: string; downstreamMbps?: number; upstreamMbps?: number }> | undefined,
  deps: Pick<RuntimeStatusDeps, "normalizeDeviceType">
) => {
  const childIdsByParentId = new Map<string, string[]>();
  const deviceById = new Map<string, any>();
  const metricsById = new Map(
    (latestMetrics ?? []).map((metric) => [
      metric.id,
      {
        downstreamMbps: Number((metric.downstreamMbps ?? 0).toFixed(2)),
        upstreamMbps: Number((metric.upstreamMbps ?? 0).toFixed(2)),
      },
    ])
  );
  const subscriberTypes = new Set(["ONT", "BUSINESS_ONT", "AON_CPE"]);
  const containerTypes = new Set(["POP", "CORE_SITE"]);

  for (const device of devices) {
    deviceById.set(device.id, device);
    if (device.parentContainerId) {
      const current = childIdsByParentId.get(device.parentContainerId) ?? [];
      current.push(device.id);
      childIdsByParentId.set(device.parentContainerId, current);
    }
  }

  const cache = new Map<string, ContainerAggregate>();

  const buildAggregate = (containerId: string): ContainerAggregate => {
    const cached = cache.get(containerId);
    if (cached) {
      return cached;
    }

    const childIds = childIdsByParentId.get(containerId) ?? [];
    let hasCritical = false;
    let hasDegraded = false;
    let downstreamMbps = 0;
    let upstreamMbps = 0;
    let occupancy = 0;

    for (const childId of childIds) {
      const child = deviceById.get(childId);
      if (!child) continue;

      const childType = deps.normalizeDeviceType(child.type) ?? child.type;
      const childStatus = runtimeStatusById.get(childId) ?? "DOWN";
      const childMetric = metricsById.get(childId);

      downstreamMbps = Number((downstreamMbps + (childMetric?.downstreamMbps ?? 0)).toFixed(2));
      upstreamMbps = Number((upstreamMbps + (childMetric?.upstreamMbps ?? 0)).toFixed(2));

      if (childStatus === "DOWN" || childStatus === "BLOCKING") {
        hasCritical = true;
      } else if (childStatus === "DEGRADED") {
        hasDegraded = true;
      }

      if (subscriberTypes.has(childType) && child.provisioned) {
        occupancy += 1;
      }

      if (containerTypes.has(childType)) {
        const childAggregate = buildAggregate(childId);
        downstreamMbps = Number((downstreamMbps + childAggregate.downstreamMbps).toFixed(2));
        upstreamMbps = Number((upstreamMbps + childAggregate.upstreamMbps).toFixed(2));
        occupancy += childAggregate.occupancy;

        if (childAggregate.health === "DOWN") {
          hasCritical = true;
        } else if (childAggregate.health === "DEGRADED") {
          hasDegraded = true;
        }
      }
    }

    const aggregate: ContainerAggregate = {
      health: hasCritical ? "DOWN" : hasDegraded ? "DEGRADED" : "UP",
      downstreamMbps,
      upstreamMbps,
      occupancy,
    };
    cache.set(containerId, aggregate);
    return aggregate;
  };

  const aggregatesById = new Map<string, ContainerAggregate>();
  for (const device of devices) {
    const type = deps.normalizeDeviceType(device.type) ?? device.type;
    if (!containerTypes.has(type)) continue;
    aggregatesById.set(device.id, buildAggregate(device.id));
  }

  return aggregatesById;
};

export const mapDeviceToNode = (
  device: any,
  deps: Pick<RuntimeStatusDeps, "normalizeDeviceType" | "normalizeDeviceStatus">,
  runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">,
  containerAggregateById?: Map<string, ContainerAggregate>
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
    container_aggregate: containerAggregateById?.get(device.id) ?? null,
    ports: device.ports,
  },
});

export const mapDeviceToApi = (
  device: any,
  deps: Pick<RuntimeStatusDeps, "normalizeDeviceType" | "normalizeDeviceStatus">,
  runtimeStatusById?: Map<string, "UP" | "DOWN" | "DEGRADED" | "BLOCKING">,
  containerAggregateById?: Map<string, ContainerAggregate>
) => ({
  ...device,
  type: deps.normalizeDeviceType(device.type) ?? device.type,
  status: runtimeStatusById?.get(device.id) ?? deps.normalizeDeviceStatus(device.status),
  parent_container_id: device.parentContainerId ?? null,
  container_aggregate: containerAggregateById?.get(device.id) ?? null,
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

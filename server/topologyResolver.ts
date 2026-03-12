import { buildDeviceAdjacency, findServingOltForLeaf } from "./runtimeStatus";

type TopologyContext = {
  adjacency: Map<string, string[]>;
  typeById: Map<string, string>;
};

export const buildTopologyContext = (
  devices: Array<{ id: string; type: string }>,
  links: Array<{ sourcePort: { deviceId: string }; targetPort: { deviceId: string } }>,
  normalizeDeviceType: (input: string) => string | undefined
): TopologyContext => {
  const deviceIds = devices.map((entry) => entry.id);
  const adjacency = buildDeviceAdjacency(deviceIds, links);
  const typeById = new Map<string, string>();
  for (const entry of devices) {
    const normalized = normalizeDeviceType(entry.type);
    if (!normalized) continue;
    typeById.set(entry.id, normalized);
  }
  return { adjacency, typeById };
};

export const resolveServingOltForLeaf = (
  leafId: string,
  context: TopologyContext,
  passiveInlineTypes: Set<string>
): string | null => findServingOltForLeaf(leafId, context.adjacency, context.typeById, passiveInlineTypes);

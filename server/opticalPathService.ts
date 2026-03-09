import { createHash } from "node:crypto";

type DeviceTypeNormalizer = (input: string) => string | undefined;

type OpticalPathServiceDeps = {
  prisma: any;
  normalizeDeviceType: DeviceTypeNormalizer;
  fiberTypeDbPerKm: Record<string, number>;
  passiveInsertionLossDb: Record<string, number>;
};

type OpticalDeviceRef = { id: string; type: string };
type OpticalCandidate = {
  oltId: string;
  totalLossDb: number;
  totalLengthKm: number;
  hopCount: number;
  pathDevices: string[];
  pathLinks: string[];
  totalLinkLossDb: number;
  pathSignature: string;
};

const buildPathSignature = (deviceIds: string[], linkIds: string[]) => {
  const tokens: string[] = [];
  for (let i = 0; i < deviceIds.length; i += 1) {
    tokens.push(`N:${deviceIds[i]}`);
    if (i < linkIds.length) {
      tokens.push(`L:${linkIds[i]}`);
    }
  }
  const canonical = tokens.join(",");
  return createHash("sha256").update(canonical).digest("hex");
};

export const createOpticalPathService = ({
  prisma,
  normalizeDeviceType,
  fiberTypeDbPerKm,
  passiveInsertionLossDb,
}: OpticalPathServiceDeps) => {
  const resolveOpticalPathForDevice = async (deviceId: string) => {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      return null;
    }

    const allDevices = (await prisma.device.findMany({ select: { id: true, type: true } })) as OpticalDeviceRef[];
    const typeByDeviceId = new Map<string, string>(allDevices.map((candidate) => [candidate.id, candidate.type]));

    const links = await prisma.link.findMany({
      include: {
        sourcePort: { include: { device: true } },
        targetPort: { include: { device: true } },
      },
    });

    const neighbors = new Map<
      string,
      Array<{ to: string; linkId: string; weight: number; linkLossDb: number; lengthKm: number }>
    >();

    for (const link of links) {
      const a = link.sourcePort.deviceId;
      const b = link.targetPort.deviceId;
      const attenuation = fiberTypeDbPerKm[link.fiberType] ?? fiberTypeDbPerKm.SMF;
      const lengthKm = Math.max(0, link.fiberLength);
      const linkLossDb = lengthKm * attenuation;
      const normalizedA = normalizeDeviceType(link.sourcePort.device.type) ?? "";
      const normalizedB = normalizeDeviceType(link.targetPort.device.type) ?? "";
      const passiveA = passiveInsertionLossDb[normalizedA] ?? 0;
      const passiveB = passiveInsertionLossDb[normalizedB] ?? 0;

      if (!neighbors.has(a)) neighbors.set(a, []);
      if (!neighbors.has(b)) neighbors.set(b, []);

      // Interior passive losses are charged on traversal into the passive node.
      neighbors.get(a)!.push({
        to: b,
        linkId: link.id,
        weight: linkLossDb + passiveB,
        linkLossDb,
        lengthKm,
      });
      neighbors.get(b)!.push({
        to: a,
        linkId: link.id,
        weight: linkLossDb + passiveA,
        linkLossDb,
        lengthKm,
      });
    }

    const start = device.id;
    const dist = new Map<string, number>([[start, 0]]);
    const distLengthKm = new Map<string, number>([[start, 0]]);
    const distHops = new Map<string, number>([[start, 0]]);
    const parent = new Map<string, { from: string; linkId: string; linkLossDb: number; lengthKm: number }>();
    const visited = new Set<string>();

    const allNodeIds = Array.from(typeByDeviceId.keys()) as string[];
    while (allNodeIds.length > 0) {
      let current: string | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const nodeId of allNodeIds) {
        if (visited.has(nodeId)) continue;
        const distance = dist.get(nodeId);
        if (distance !== undefined && distance < best) {
          best = distance;
          current = nodeId;
        }
      }
      if (!current) break;

      visited.add(current);

      for (const edge of neighbors.get(current) ?? []) {
        if (visited.has(edge.to)) continue;
        const candidate = best + edge.weight;
        const candidateLengthKm = (distLengthKm.get(current) ?? 0) + edge.lengthKm;
        const candidateHops = (distHops.get(current) ?? 0) + 1;
        const existing = dist.get(edge.to);
        const existingLengthKm = distLengthKm.get(edge.to);
        const existingHops = distHops.get(edge.to);
        const shouldReplace =
          existing === undefined ||
          candidate < existing - 1e-9 ||
          (Math.abs(candidate - existing) < 1e-9 &&
            (existingLengthKm === undefined ||
              candidateLengthKm < existingLengthKm - 1e-9 ||
              (Math.abs(candidateLengthKm - existingLengthKm) < 1e-9 &&
                (existingHops === undefined || candidateHops < existingHops))));

        if (shouldReplace) {
          dist.set(edge.to, candidate);
          distLengthKm.set(edge.to, candidateLengthKm);
          distHops.set(edge.to, candidateHops);
          parent.set(edge.to, {
            from: current,
            linkId: edge.linkId,
            linkLossDb: edge.linkLossDb,
            lengthKm: edge.lengthKm,
          });
        }
      }
    }

    const oltCandidates = allDevices
      .filter((candidate) => normalizeDeviceType(candidate.type) === "OLT" && dist.has(candidate.id))
      .map((candidate): OpticalCandidate => {
        const pathDevices: string[] = [];
        const pathLinks: string[] = [];
        let totalLinkLossDb = 0;
        let totalLengthKm = 0;
        let cursor = candidate.id;

        while (cursor !== device.id) {
          pathDevices.push(cursor);
          const step = parent.get(cursor);
          if (!step) break;
          pathLinks.push(step.linkId);
          totalLinkLossDb += step.linkLossDb;
          totalLengthKm += step.lengthKm;
          cursor = step.from;
        }

        pathDevices.push(device.id);
        pathDevices.reverse();
        pathLinks.reverse();

        const pathSignature = buildPathSignature(pathDevices, pathLinks);

        return {
          oltId: candidate.id,
          totalLossDb: dist.get(candidate.id) ?? Number.POSITIVE_INFINITY,
          totalLengthKm,
          hopCount: pathLinks.length,
          pathDevices,
          pathLinks,
          totalLinkLossDb,
          pathSignature,
        };
      })
      .filter((candidate) => Number.isFinite(candidate.totalLossDb));

    oltCandidates.sort((a, b) => {
      if (Math.abs(a.totalLossDb - b.totalLossDb) > 1e-9) return a.totalLossDb - b.totalLossDb;
      if (Math.abs(a.totalLengthKm - b.totalLengthKm) > 1e-9) return a.totalLengthKm - b.totalLengthKm;
      if (a.hopCount !== b.hopCount) return a.hopCount - b.hopCount;
      const oltCompare = a.oltId.localeCompare(b.oltId);
      if (oltCompare !== 0) return oltCompare;
      return a.pathSignature.localeCompare(b.pathSignature);
    });

    const selected = oltCandidates[0];

    if (!selected) {
      return { device_id: device.id, found: false as const, path: [] as unknown[] };
    }

    const totalLossDb = Number(selected.totalLossDb.toFixed(4));
    const totalLinkLossRounded = Number(selected.totalLinkLossDb.toFixed(4));
    const totalPassiveLossDb = Number(Math.max(0, totalLossDb - totalLinkLossRounded).toFixed(4));

    return {
      device_id: device.id,
      found: true as const,
      path: {
        device_ids: selected.pathDevices,
        link_ids: selected.pathLinks,
        olt_id: selected.oltId,
        total_loss_db: totalLossDb,
        total_link_loss_db: totalLinkLossRounded,
        total_passive_loss_db: totalPassiveLossDb,
        total_physical_length_km: Number(selected.totalLengthKm.toFixed(4)),
        hop_count: Math.max(0, selected.hopCount),
        path_signature: selected.pathSignature,
      },
    };
  };

  return { resolveOpticalPathForDevice };
};

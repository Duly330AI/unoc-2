type EventPhase = 1 | 2 | 3 | 4 | 5;

type QueuedEnvelope = {
  kind: string;
  payload: unknown;
  includeTopoVersion: boolean;
  correlationId?: string;
  ts: string;
  topoVersion?: number;
};

type QueuedEntry = {
  seq: number;
  envelope: QueuedEnvelope;
};

type AggregateEventPayload = {
  tick?: number;
  items?: Array<Record<string, unknown>>;
};

type AggregateState = {
  seq: number;
  envelope: QueuedEnvelope;
  itemsByKey: Map<string, Record<string, unknown>>;
};

type RealtimeBucket = {
  appendOnly: Map<EventPhase, QueuedEntry[]>;
  aggregateByKind: Map<string, AggregateState>;
  dedupedByGroupKey: Map<string, QueuedEntry>;
};

type EventPolicy = {
  phase: EventPhase;
  mode: "append" | "aggregate-items" | "dedupe";
  groupKey?: string;
  itemKey?: (item: Record<string, unknown>) => string | null;
  dedupeKey?: (payload: any) => string | null;
};

const EVENT_KIND_POLICIES: Record<string, EventPolicy> = {
  deviceCreated: { phase: 1, mode: "append" },
  deviceUpdated: { phase: 1, mode: "append" },
  deviceDeleted: { phase: 1, mode: "append" },
  deviceProvisioned: { phase: 1, mode: "append" },
  linkAdded: { phase: 1, mode: "append" },
  linkUpdated: { phase: 1, mode: "append" },
  linkDeleted: { phase: 1, mode: "append" },
  batchCompleted: { phase: 1, mode: "append" },
  subscriberSessionUpdated: { phase: 2, mode: "append" },
  cgnatMappingCreated: { phase: 2, mode: "append" },
  forensicsTraceResolved: { phase: 2, mode: "append" },
  deviceSignalUpdated: {
    phase: 3,
    mode: "aggregate-items",
    itemKey: (item) => (typeof item.id === "string" ? item.id : null),
  },
  deviceStatusUpdated: {
    phase: 4,
    mode: "aggregate-items",
    itemKey: (item) => (typeof item.id === "string" ? item.id : null),
  },
  linkStatusUpdated: {
    phase: 4,
    mode: "dedupe",
    groupKey: "linkStatusUpdated",
    dedupeKey: (payload) => (typeof payload?.id === "string" ? payload.id : null),
  },
  deviceOverrideChanged: {
    phase: 4,
    mode: "dedupe",
    groupKey: "deviceOverrideChanged",
    dedupeKey: (payload) => (typeof payload?.id === "string" ? payload.id : null),
  },
  overrideConflict: {
    phase: 4,
    mode: "dedupe",
    groupKey: "overrideConflict",
    dedupeKey: (payload) =>
      typeof payload?.id === "string" && typeof payload?.entity === "string" ? `${payload.entity}:${payload.id}` : null,
  },
  deviceMetricsUpdated: {
    phase: 5,
    mode: "aggregate-items",
    itemKey: (item) => (typeof item.id === "string" ? item.id : null),
  },
  segmentCongestionDetected: {
    phase: 5,
    mode: "dedupe",
    groupKey: "segmentCongestion",
    dedupeKey: (payload) => (typeof payload?.segmentId === "string" ? payload.segmentId : null),
  },
  segmentCongestionCleared: {
    phase: 5,
    mode: "dedupe",
    groupKey: "segmentCongestion",
    dedupeKey: (payload) => (typeof payload?.segmentId === "string" ? payload.segmentId : null),
  },
};

const PHASE_KIND_ORDER: Record<EventPhase, string[]> = {
  1: ["deviceCreated", "deviceUpdated", "deviceDeleted", "deviceProvisioned", "linkAdded", "linkUpdated", "linkDeleted", "batchCompleted"],
  2: ["subscriberSessionUpdated", "cgnatMappingCreated", "forensicsTraceResolved"],
  3: ["deviceSignalUpdated"],
  4: ["deviceStatusUpdated", "linkStatusUpdated", "deviceOverrideChanged", "overrideConflict"],
  5: ["deviceMetricsUpdated", "segmentCongestionDetected", "segmentCongestionCleared"],
};

const sortEntriesByPhaseAndKind = (phase: EventPhase, entries: QueuedEntry[]) => {
  const kindOrder = new Map(PHASE_KIND_ORDER[phase].map((kind, index) => [kind, index]));
  return entries.sort((a, b) => {
    const kindDelta = (kindOrder.get(a.envelope.kind) ?? Number.MAX_SAFE_INTEGER) - (kindOrder.get(b.envelope.kind) ?? Number.MAX_SAFE_INTEGER);
    if (kindDelta !== 0) return kindDelta;
    return a.seq - b.seq;
  });
};

type RealtimeOutboxDeps = {
  getRequestId: () => string | undefined;
  getTopologyVersion: () => number;
  emit: (payload: Record<string, unknown>) => void;
};

export const createRealtimeOutboxManager = ({ getRequestId, getTopologyVersion, emit }: RealtimeOutboxDeps) => {
  const realtimeOutbox = new Map<string, RealtimeBucket>();
  let realtimeSeq = 0;

  const getRealtimeBucket = (bucketId: string): RealtimeBucket => {
    const existing = realtimeOutbox.get(bucketId);
    if (existing) return existing;

    const created: RealtimeBucket = {
      appendOnly: new Map<EventPhase, QueuedEntry[]>(),
      aggregateByKind: new Map<string, AggregateState>(),
      dedupedByGroupKey: new Map<string, QueuedEntry>(),
    };
    realtimeOutbox.set(bucketId, created);
    return created;
  };

  const buildQueuedEnvelope = (
    kind: string,
    payload: unknown,
    includeTopoVersion = true,
    correlationId?: string
  ): QueuedEnvelope => {
    const requestId = correlationId ?? getRequestId();
    return {
      kind,
      payload,
      includeTopoVersion,
      correlationId: requestId,
      ts: new Date().toISOString(),
      ...(includeTopoVersion ? { topoVersion: getTopologyVersion() } : {}),
    };
  };

  const serializeEnvelope = (envelope: QueuedEnvelope) => {
    const payload: Record<string, unknown> = {
      type: "event",
      kind: envelope.kind,
      payload: envelope.payload,
      ts: envelope.ts,
      ...(envelope.correlationId ? { correlation_id: envelope.correlationId } : {}),
    };

    if (envelope.includeTopoVersion && envelope.topoVersion !== undefined) {
      payload.topo_version = envelope.topoVersion;
    }

    return payload;
  };

  const flush = (bucketId?: string) => {
    const bucketIds = bucketId ? [bucketId] : Array.from(realtimeOutbox.keys());

    for (const currentBucketId of bucketIds) {
      const bucket = realtimeOutbox.get(currentBucketId);
      if (!bucket) continue;

      for (const phase of [1, 2, 3, 4, 5] as const) {
        const appendEntries = bucket.appendOnly.get(phase) ?? [];
        for (const entry of appendEntries.sort((a, b) => a.seq - b.seq)) {
          emit(serializeEnvelope(entry.envelope));
        }

        const aggregateEntries = sortEntriesByPhaseAndKind(
          phase,
          Array.from(bucket.aggregateByKind.values())
            .filter((entry) => EVENT_KIND_POLICIES[entry.envelope.kind]?.phase === phase)
            .map((entry) => ({
              seq: entry.seq,
              envelope: {
                ...entry.envelope,
                payload: {
                  ...(entry.envelope.payload as AggregateEventPayload),
                  items: Array.from(entry.itemsByKey.values()).sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? ""))),
                },
              },
            }))
        );
        for (const entry of aggregateEntries) {
          emit(serializeEnvelope(entry.envelope));
        }

        const dedupedEntries = sortEntriesByPhaseAndKind(
          phase,
          Array.from(bucket.dedupedByGroupKey.values()).filter((entry) => EVENT_KIND_POLICIES[entry.envelope.kind]?.phase === phase)
        );
        for (const entry of dedupedEntries) {
          emit(serializeEnvelope(entry.envelope));
        }
      }

      realtimeOutbox.delete(currentBucketId);
    }
  };

  const clear = (bucketId?: string) => {
    if (bucketId) {
      realtimeOutbox.delete(bucketId);
      return;
    }
    realtimeOutbox.clear();
  };

  const emitEvent = (kind: string, payload: unknown, includeTopoVersion = true, correlationId?: string) => {
    const envelope = buildQueuedEnvelope(kind, payload, includeTopoVersion, correlationId);
    const bucketId = envelope.correlationId ?? "global";
    const bucket = getRealtimeBucket(bucketId);
    const policy = EVENT_KIND_POLICIES[kind] ?? { phase: 2 as EventPhase, mode: "append" as const };
    const seq = ++realtimeSeq;

    if (policy.mode === "append") {
      const phaseEntries = bucket.appendOnly.get(policy.phase) ?? [];
      phaseEntries.push({ seq, envelope });
      bucket.appendOnly.set(policy.phase, phaseEntries);
      return;
    }

    if (policy.mode === "aggregate-items") {
      const payloadWithItems = envelope.payload as AggregateEventPayload;
      const items = Array.isArray(payloadWithItems?.items) ? payloadWithItems.items : [];
      const aggregate = bucket.aggregateByKind.get(kind) ?? {
        seq,
        envelope,
        itemsByKey: new Map<string, Record<string, unknown>>(),
      };

      for (const rawItem of items) {
        const item = rawItem as Record<string, unknown>;
        const key = policy.itemKey?.(item);
        if (!key) continue;
        aggregate.itemsByKey.set(key, item);
      }

      aggregate.seq = seq;
      aggregate.envelope = {
        ...envelope,
        payload: {
          ...(aggregate.envelope.payload as AggregateEventPayload),
          ...(payloadWithItems ?? {}),
        },
      };
      bucket.aggregateByKind.set(kind, aggregate);
      return;
    }

    const dedupeKey = policy.dedupeKey?.(payload);
    if (!dedupeKey) {
      const phaseEntries = bucket.appendOnly.get(policy.phase) ?? [];
      phaseEntries.push({ seq, envelope });
      bucket.appendOnly.set(policy.phase, phaseEntries);
      return;
    }

    bucket.dedupedByGroupKey.set(`${policy.groupKey ?? kind}:${dedupeKey}`, { seq, envelope });
  };

  return {
    emitEvent,
    flush,
    clear,
  };
};

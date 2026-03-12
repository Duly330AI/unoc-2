export type TopoVersionAction = 'ignore' | 'accept' | 'resync';
export type TickSeqAction = 'ignore' | 'accept' | 'resync';
export type RealtimeResyncEventAction = 'apply' | 'buffer';
export type RealtimeEnvelopeDecision = {
  action: 'apply' | 'resync' | 'buffer';
  reason: 'none' | 'topo_gap' | 'tick_gap' | 'baseline_inflight';
  topoAction: TopoVersionAction;
  tickSeqAction: TickSeqAction;
  nextTopoVersion?: number;
  nextTickSeq?: number;
};

const BASELINE_RESYNC_COVERED_EVENT_KINDS = new Set([
  'deviceCreated',
  'deviceUpdated',
  'deviceDeleted',
  'deviceContainerChanged',
  'linkAdded',
  'linkUpdated',
  'linkDeleted',
  'linkStatusUpdated',
  'deviceMetricsUpdated',
  'deviceStatusUpdated',
  'deviceSignalUpdated',
  'subscriberSessionUpdated',
  'deviceOverrideChanged',
  'overrideConflict',
  'segmentCongestionDetected',
  'segmentCongestionCleared',
]);

const TICK_SCOPED_EVENT_KINDS = new Set([
  'deviceMetricsUpdated',
  'deviceStatusUpdated',
  'deviceSignalUpdated',
  'segmentCongestionDetected',
  'segmentCongestionCleared',
]);

export const classifyTopoVersionAction = (
  lastTopoVersion: number | undefined,
  incomingTopoVersion: number | undefined
): TopoVersionAction => {
  if (incomingTopoVersion === undefined) {
    return 'ignore';
  }

  if (lastTopoVersion !== undefined && incomingTopoVersion > lastTopoVersion + 1) {
    return 'resync';
  }

  if (lastTopoVersion === undefined || incomingTopoVersion > lastTopoVersion) {
    return 'accept';
  }

  return 'ignore';
};

export const extractRealtimeTickSeq = (kind: string | undefined, payload: any): number | undefined => {
  if (!kind || !TICK_SCOPED_EVENT_KINDS.has(kind)) {
    return undefined;
  }

  if (typeof payload?.tick_seq === 'number') {
    return payload.tick_seq as number;
  }

  if (typeof payload?.tick === 'number') {
    return payload.tick as number;
  }

  const firstItem = Array.isArray(payload?.items) ? payload.items[0] : undefined;
  if (typeof firstItem?.tick_seq === 'number') {
    return firstItem.tick_seq as number;
  }
  if (typeof firstItem?.metric_tick_seq === 'number') {
    return firstItem.metric_tick_seq as number;
  }

  return undefined;
};

export const classifyTickSeqAction = (
  lastTickSeq: number | undefined,
  incomingTickSeq: number | undefined
): TickSeqAction => {
  if (incomingTickSeq === undefined) {
    return 'ignore';
  }

  if (lastTickSeq !== undefined && incomingTickSeq > lastTickSeq + 1) {
    return 'resync';
  }

  if (lastTickSeq === undefined || incomingTickSeq > lastTickSeq) {
    return 'accept';
  }

  return 'ignore';
};

export const createBaselineResyncController = (runBaselineResync: () => Promise<void>) => {
  let inFlight: Promise<void> | null = null;
  let rerunRequested = false;

  const flush = async () => {
    do {
      rerunRequested = false;
      await runBaselineResync();
    } while (rerunRequested);
  };

  return {
    requestResync: async () => {
      if (inFlight) {
        rerunRequested = true;
        return inFlight;
      }

      inFlight = flush().finally(() => {
        inFlight = null;
      });

      return inFlight;
    },
    isInFlight: () => inFlight !== null,
  };
};

export const classifyRealtimeResyncEventAction = (
  kind: string | undefined,
  baselineResyncInFlight: boolean
): RealtimeResyncEventAction => {
  if (!kind) {
    return 'apply';
  }

  if (baselineResyncInFlight && BASELINE_RESYNC_COVERED_EVENT_KINDS.has(kind)) {
    return 'buffer';
  }

  return 'apply';
};

export const decideRealtimeEnvelopeAction = (params: {
  kind: string | undefined;
  payload: any;
  topoVersion: number | undefined;
  lastTopoVersion: number | undefined;
  lastTickSeq: number | undefined;
  baselineResyncInFlight: boolean;
}): RealtimeEnvelopeDecision => {
  const topoAction = classifyTopoVersionAction(params.lastTopoVersion, params.topoVersion);
  if (topoAction === 'resync') {
    return {
      action: 'resync',
      reason: 'topo_gap',
      topoAction,
      tickSeqAction: 'ignore',
    };
  }

  const incomingTickSeq = extractRealtimeTickSeq(params.kind, params.payload);
  const tickSeqAction = classifyTickSeqAction(params.lastTickSeq, incomingTickSeq);
  if (tickSeqAction === 'resync') {
    return {
      action: 'resync',
      reason: 'tick_gap',
      topoAction,
      tickSeqAction,
    };
  }

  if (classifyRealtimeResyncEventAction(params.kind, params.baselineResyncInFlight) === 'buffer') {
    return {
      action: 'buffer',
      reason: 'baseline_inflight',
      topoAction,
      tickSeqAction,
    };
  }

  return {
    action: 'apply',
    reason: 'none',
    topoAction,
    tickSeqAction,
    nextTopoVersion: topoAction === 'accept' ? params.topoVersion : undefined,
    nextTickSeq: tickSeqAction === 'accept' ? incomingTickSeq : undefined,
  };
};

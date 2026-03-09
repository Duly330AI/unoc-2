export type TopoVersionAction = 'ignore' | 'accept' | 'resync';
export type RealtimeResyncEventAction = 'apply' | 'drop_and_rerun';

const BASELINE_RESYNC_COVERED_EVENT_KINDS = new Set([
  'deviceCreated',
  'deviceUpdated',
  'deviceDeleted',
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

export const classifyRealtimeResyncEventAction = (kind: string | undefined, baselineResyncInFlight: boolean): RealtimeResyncEventAction => {
  if (!kind) {
    return 'apply';
  }

  if (baselineResyncInFlight && BASELINE_RESYNC_COVERED_EVENT_KINDS.has(kind)) {
    return 'drop_and_rerun';
  }

  return 'apply';
};

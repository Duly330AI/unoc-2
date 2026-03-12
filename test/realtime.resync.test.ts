import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTickSeqAction,
  classifyRealtimeResyncEventAction,
  classifyTopoVersionAction,
  createBaselineResyncController,
  decideRealtimeEnvelopeAction,
  extractRealtimeTickSeq,
} from '../client/src/store/realtimeResync.ts';

test('realtime resync: topo version action classifies accept, gap resync, and stale ignore', () => {
  assert.equal(classifyTopoVersionAction(undefined, undefined), 'ignore');
  assert.equal(classifyTopoVersionAction(undefined, 10), 'accept');
  assert.equal(classifyTopoVersionAction(10, 11), 'accept');
  assert.equal(classifyTopoVersionAction(10, 12), 'resync');
  assert.equal(classifyTopoVersionAction(10, 10), 'ignore');
  assert.equal(classifyTopoVersionAction(10, 9), 'ignore');
});

test('realtime resync: tick seq action classifies accept, gap resync, and stale ignore', () => {
  assert.equal(classifyTickSeqAction(undefined, undefined), 'ignore');
  assert.equal(classifyTickSeqAction(undefined, 10), 'accept');
  assert.equal(classifyTickSeqAction(10, 11), 'accept');
  assert.equal(classifyTickSeqAction(10, 12), 'resync');
  assert.equal(classifyTickSeqAction(10, 10), 'ignore');
  assert.equal(classifyTickSeqAction(10, 9), 'ignore');
});

test('realtime resync: tick seq extraction prefers canonical tick_seq and falls back to legacy metric fields', () => {
  assert.equal(extractRealtimeTickSeq('deviceMetricsUpdated', { tick_seq: 21, tick: 20 }), 21);
  assert.equal(extractRealtimeTickSeq('deviceSignalUpdated', { tick: 22 }), 22);
  assert.equal(
    extractRealtimeTickSeq('deviceMetricsUpdated', {
      items: [{ id: 'd1', metric_tick_seq: 23 }],
    }),
    23
  );
  assert.equal(extractRealtimeTickSeq('subscriberSessionUpdated', { tick_seq: 24 }), undefined);
  assert.equal(extractRealtimeTickSeq(undefined, { tick_seq: 25 }), undefined);
});

test('realtime resync: concurrent requests dedupe and coalesce to one rerun', async () => {
  let runCount = 0;
  const releases: Array<() => void> = [];

  const controller = createBaselineResyncController(async () => {
    runCount += 1;
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
  });

  const first = controller.requestResync();
  assert.equal(controller.isInFlight(), true);

  const second = controller.requestResync();
  const third = controller.requestResync();

  await Promise.resolve();
  assert.equal(runCount, 1);

  releases.shift()?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runCount, 2);

  releases.shift()?.();
  await Promise.all([first, second, third]);

  assert.equal(runCount, 2);
  assert.equal(controller.isInFlight(), false);
});

test('realtime resync: baseline-covered events are dropped and rerun while resync is in flight', () => {
  assert.equal(classifyRealtimeResyncEventAction('deviceMetricsUpdated', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('deviceStatusUpdated', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('deviceSignalUpdated', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('subscriberSessionUpdated', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('deviceContainerChanged', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('linkAdded', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('segmentCongestionDetected', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('segmentCongestionCleared', true), 'drop_and_rerun');
});

test('realtime resync: events apply normally when no baseline resync is in flight or kind is unknown', () => {
  assert.equal(classifyRealtimeResyncEventAction('deviceMetricsUpdated', false), 'apply');
  assert.equal(classifyRealtimeResyncEventAction('deviceContainerChanged', false), 'apply');
  assert.equal(classifyRealtimeResyncEventAction('unknownKind', true), 'apply');
  assert.equal(classifyRealtimeResyncEventAction(undefined, true), 'apply');
});

test('realtime resync: topo gap forces resync before tick or baseline checks', () => {
  const decision = decideRealtimeEnvelopeAction({
    kind: 'deviceContainerChanged',
    payload: { tick_seq: 42 },
    topoVersion: 10,
    lastTopoVersion: 8,
    lastTickSeq: 41,
    baselineResyncInFlight: true,
  });

  assert.equal(decision.action, 'resync');
  assert.equal(decision.reason, 'topo_gap');
});

test('realtime resync: tick gap forces resync after topo accept', () => {
  const decision = decideRealtimeEnvelopeAction({
    kind: 'deviceMetricsUpdated',
    payload: { tick_seq: 10 },
    topoVersion: 5,
    lastTopoVersion: 4,
    lastTickSeq: 8,
    baselineResyncInFlight: false,
  });

  assert.equal(decision.action, 'resync');
  assert.equal(decision.reason, 'tick_gap');
});

test('realtime resync: baseline inflight drops baseline-covered mutation events', () => {
  const decision = decideRealtimeEnvelopeAction({
    kind: 'deviceContainerChanged',
    payload: { tick_seq: 2 },
    topoVersion: 2,
    lastTopoVersion: 1,
    lastTickSeq: 1,
    baselineResyncInFlight: true,
  });

  assert.equal(decision.action, 'resync');
  assert.equal(decision.reason, 'baseline_inflight');
});

test('realtime resync: apply updates topo and tick when accepted', () => {
  const decision = decideRealtimeEnvelopeAction({
    kind: 'deviceMetricsUpdated',
    payload: { tick_seq: 4 },
    topoVersion: 6,
    lastTopoVersion: 5,
    lastTickSeq: 3,
    baselineResyncInFlight: false,
  });

  assert.equal(decision.action, 'apply');
  assert.equal(decision.reason, 'none');
  assert.equal(decision.nextTopoVersion, 6);
  assert.equal(decision.nextTickSeq, 4);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRealtimeResyncEventAction,
  classifyTopoVersionAction,
  createBaselineResyncController,
} from '../client/src/store/realtimeResync.ts';

test('realtime resync: topo version action classifies accept, gap resync, and stale ignore', () => {
  assert.equal(classifyTopoVersionAction(undefined, undefined), 'ignore');
  assert.equal(classifyTopoVersionAction(undefined, 10), 'accept');
  assert.equal(classifyTopoVersionAction(10, 11), 'accept');
  assert.equal(classifyTopoVersionAction(10, 12), 'resync');
  assert.equal(classifyTopoVersionAction(10, 10), 'ignore');
  assert.equal(classifyTopoVersionAction(10, 9), 'ignore');
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
  assert.equal(classifyRealtimeResyncEventAction('subscriberSessionUpdated', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('linkAdded', true), 'drop_and_rerun');
  assert.equal(classifyRealtimeResyncEventAction('segmentCongestionDetected', true), 'drop_and_rerun');
});

test('realtime resync: events apply normally when no baseline resync is in flight or kind is unknown', () => {
  assert.equal(classifyRealtimeResyncEventAction('deviceMetricsUpdated', false), 'apply');
  assert.equal(classifyRealtimeResyncEventAction('unknownKind', true), 'apply');
  assert.equal(classifyRealtimeResyncEventAction(undefined, true), 'apply');
});

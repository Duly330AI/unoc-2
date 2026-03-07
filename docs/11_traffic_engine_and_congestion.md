# 11. Traffic Engine and Congestion

This document defines deterministic traffic simulation, GPON segment aggregation, congestion hysteresis, and realtime event contracts.

Stack context:
- Backend: Node.js services + Socket.io
- Frontend: React stores consuming deltas and snapshots

## Implementation Snapshot (2026-03-07)

Current backend implementation status:
- Deterministic tick loop exists (`TRAFFIC_TICK_INTERVAL_MS`, deterministic factor from `device_id + tick_seq`).
- `deviceMetricsUpdated` is emitted as changed-only delta batch.
- `deviceStatusUpdated` is emitted when device status changes.
- `deviceSignalUpdated` compact deltas are emitted from runtime metrics updates.
- `/api/sim/status` and `/api/metrics/snapshot` endpoints are available.
- `segmentCongestionDetected` / `segmentCongestionCleared` are emitted with hysteresis semantics for OLT-level segment abstraction.

Not yet fully implemented versus target model:
- Leaf eligibility gating (`provisioned + upstream viability`) is not fully enforced in current tick loop.
- Full multi-layer segment modeling (beyond OLT-level abstraction) is not fully implemented in runtime.

## 1. Engine Goals

MVP goals:
- deterministic periodic traffic generation
- hierarchical upstream aggregation
- stable congestion states without flicker
- delta emission with reconnect snapshot recovery

Non-goals (MVP):
- per-flow QoS and queue models
- latency simulation
- historical persistence as primary source-of-truth

## 2. Traffic Generation

## 2.1 Eligible Leaf Classes

Leaf generation applies to:
- `ONT`
- `BUSINESS_ONT`
- `AON_CPE`

Eligibility baseline:
- provisioned and effectively online
- upstream L3 viability must be true (status diagnostics gated)

## 2.2 Modes

- `variable`: deterministic pseudo-random factor per `(seed, device_id, tick_seq)`
- `percent`: fixed tariff ratio

Directionality:
- symmetric mode allowed
- asymmetric tariff mode supported (`max_up` and `max_down`)

## 2.3 Determinism

PRNG contract:
- stable seeded generator
- seed material includes `TRAFFIC_RANDOM_SEED`, `device_id`, `tick_seq`
- identical inputs produce identical series

## 3. Aggregation Model

## 3.1 Tick Flow

Per tick:
1. build immutable topology snapshot
2. generate leaf traffic
3. aggregate post-order toward upstream/core
4. compute utilization per relevant entity

Rules:
- offline leaves contribute zero
- aggregation order deterministic

## 3.2 OLT-Level GPON Aggregation Semantics

Current GPON abstraction:
- direct OLT<->ONT links are invalid
- OLT PON branch is modeled with OLT-level aggregation in MVP
- ONTs attached to the same OLT share one GPON segment capacity budget in MVP

Segment identity:
- deterministic key is the OLT identity (`segmentId = oltId`)

Scope note:
- per-PON/per-splitter aggregation is deferred to later tracks

## 3.3 Capacity Semantics

Capacity precedence:
1. explicit profile/model capacity
2. class default
3. fallback policy

GPON baseline (if no override):
- downstream `2.5 Gbps`
- upstream `1.25 Gbps`

Utilization:
- `utilization = throughput / capacity`
- capacity values from DB/catalog are canonical in Mbps and must be normalized before division when throughput is represented in Gbps
- values over `100%` are retained (no clamping)
- missing/zero capacity -> `utilization = null` + warning log

## 4. Congestion Hysteresis

## 4.1 Thresholds

Device/link:
- enter at `>= 100%`
- clear at `<= 95%`

GPON segment:
- enter at `>= 95%`
- clear at `<= 85%`

## 4.2 State Machine

- `NORMAL -> CONGESTED` only when entering threshold
- `CONGESTED -> NORMAL` only when clearing threshold
- no event on steady state

## 5. Event Contracts

## 5.1 Congestion Events

- `segmentCongestionDetected`
- `segmentCongestionCleared`

Example envelope:

```json
{
  "type": "event",
  "kind": "segmentCongestionDetected",
  "payload": {
    "segmentId": "olt-1",
    "oltId": "olt-1",
    "utilization": 0.98,
    "tick": 12345
  },
  "topo_version": 123,
  "correlation_id": "sim-12345",
  "ts": "2026-03-07T12:00:00.000Z"
}
```

## 5.2 Metrics Delta Events

Primary periodic event:
- `deviceMetricsUpdated`

Rules:
- send changed items only
- include per-item version
- status/topology stabilization events precede metrics/congestion in same window

## 5.3 Snapshot Recovery

- `GET /api/metrics/snapshot` provides baseline replacement state
- on reconnect or `topo_version` gap, client replaces local baseline before new delta handling

## 6. Runtime Controls

Config keys:
- `TRAFFIC_ENABLED`
- `TRAFFIC_TICK_INTERVAL_MS`
- `STRICT_ONT_ONLINE_ONLY`
- `TRAFFIC_RANDOM_SEED`

Loop requirements:
- maintain target cadence
- account for tick processing time
- continue after recoverable errors
- graceful shutdown supported

Backpressure:
- collapse queued metric deltas to latest when buffers saturate

## 7. Resilience Rules

- tick exceptions logged/counted; engine continues
- negative generated values clamped to zero with warning
- no-leaf fast path allowed while keeping monotonic tick sequence

## 8. Observability

Metrics:
- `unoc_sim_tick_duration_seconds`
- `unoc_sim_changed_devices`
- `unoc_sim_active_leaves`
- `unoc_sim_skipped_ticks_total`

Health:
- `GET /api/sim/status` -> `{ enabled, interval_ms, last_tick_seq, running }`

Logs:
- tick start/end
- changed entity counts
- congestion transitions

## 9. Testing Baseline

Unit:
- deterministic PRNG output
- asymmetric tariff behavior
- GPON segment aggregation correctness (OLT-level)
- hysteresis transitions

Integration:
- event emission only on transitions
- delta + snapshot reconciliation
- backpressure collapse behavior

## 10. Future Tracks

- first-class link metrics stream
- advanced queueing/latency models
- persisted historical analysis windows
- multi-ODF-per-PON support and richer passive tree modeling

## 11. Cross-Document Contract

- `03_ipam_and_status.md`
- `05_realtime_and_ui_model.md`
- `06_future_extensions_and_catalog.md`
- `08_ports.md`
- `13_api_reference.md`

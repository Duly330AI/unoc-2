# 11. Traffic Engine and Congestion

This document defines deterministic traffic simulation, GPON segment aggregation, congestion hysteresis, and realtime event contracts.

Normative language:
- `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `MAY` are interpreted as binding requirement keywords.
- If this document and a non-canonical note conflict, this document's normative statements take precedence.

Stack context:
- Backend: Node.js services + Socket.io
- Frontend: React stores consuming deltas and snapshots

## Implementation Snapshot (2026-03-09)

Current backend implementation status:
- Deterministic tick loop exists (`TRAFFIC_TICK_INTERVAL_MS`, deterministic factor from `device_id + tick_seq`).
- `deviceMetricsUpdated` is emitted as changed-only delta batch.
- metric payloads carry combined `trafficMbps` for backwards compatibility and explicit directional totals via `downstreamMbps` and `upstreamMbps`.
- `deviceStatusUpdated` is emitted when device status changes.
- `deviceSignalUpdated` compact deltas are emitted from runtime metrics updates.
- `/api/sim/status` and `/api/metrics/snapshot` endpoints are available.
- `segmentCongestionDetected` / `segmentCongestionCleared` are emitted with hysteresis semantics for OLT-level segment abstraction.
- Congestion hysteresis is regression-tested for detect/steady/clear transitions on a real overloaded OLT chain.

Not yet fully implemented versus target model:
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
- per-service generation requires non-expired `ACTIVE` subscriber session state for the bound service (`internet`/`iptv`/`voice`).
- without active session, generated traffic for that service is `0` even when infra path is up.
- infrastructure status remains independent from subscriber service status; traffic gating uses session/service state in addition to infra viability.

## 2.2 Modes

- `variable`: deterministic pseudo-random factor per `(seed, device_id, tick_seq)`
- `percent`: fixed tariff ratio

Directionality:
- symmetric mode allowed
- asymmetric tariff mode supported (`max_up` and `max_down`)
- current runtime emits direction-aware totals per device; downstream budgets/clamps remain the canonical congestion gate, while upstream is aggregated separately.
- current runtime now clamps upstream best-effort per GPON segment against the `1.25 Gbps` baseline and derives congestion from the worse of downstream/upstream utilization.

## 2.3 Determinism

PRNG contract:
- stable seeded generator
- seed material includes `TRAFFIC_RANDOM_SEED`, `device_id`, `tick_seq`
- identical inputs produce identical series

## 3. Aggregation Model

## 3.1 Tick Flow

Per tick:
1. build immutable topology snapshot
2. build immutable subscriber-session snapshot
3. run downstream pre-order pass from core/OLT toward leaves for downstream capacity distribution
4. generate leaf traffic (session-gated, constrained by the established downstream budgets/clamps where applicable)
5. aggregate post-order toward upstream/core
6. compute utilization and congestion state per relevant entity
7. export metrics/events for the tick

Rules:
- offline leaves contribute zero
- aggregation order deterministic
- downstream pre-order distribution is deterministic and service-aware, and MUST execute before the upstream post-order aggregation pass:
  - strict-priority services (`VOICE`, `IPTV`) are assigned first,
  - best-effort (`INTERNET`) receives remaining downstream capacity,
  - if downstream segment budget is exhausted, best-effort leaf metrics are clamped deterministically using the proportional share formula in 3.2.

## 3.2 OLT-Level GPON Aggregation Semantics

Current GPON abstraction:
- direct OLT<->ONT links are invalid
- GPON segment identity is modeled from the serving OLT to the first passive aggregation node in the access branch
- ONTs attached behind the same first passive aggregation node share one GPON segment capacity budget
- under segment overload, service aggregation order is deterministic:
  1. strict-priority services (`VOICE`, `IPTV`)
  2. best-effort service (`INTERNET`) on remaining capacity
- downstream over-budget handling:
  - strict-priority allocations are preserved first,
  - best-effort downstream is reduced/clamped by deterministic proportional-share:
    - `remaining_capacity = segment_downstream_capacity - strict_priority_allocated`
    - `share_i = remaining_capacity * (requested_i / sum(requested_best_effort_all))`
    - `effective_i = min(requested_i, share_i)`
  - if `sum(requested_best_effort_all) == 0`, all best-effort `effective_i = 0`.
- upstream over-budget handling mirrors the same proportional-share rule against the GPON upstream baseline (`1.25 Gbps`), using upstream demand and strict-priority upstream reservations.

Segment identity:
- deterministic key is `segmentId = oltId:firstPassiveId`
- if no passive aggregation node is found, fallback remains `segmentId = oltId`

Scope note:
- deeper per-PON/per-branch modeling below the first passive aggregation point is deferred to later tracks

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

Service priority aggregation:
- under congestion, aggregation order is strict-priority first (for example `VOICE`/`IPTV`), then best-effort internet.
- packet-level queue simulation remains out of scope for MVP.

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
    "segmentId": "olt-1:splitter-1",
    "oltId": "olt-1",
    "utilization": 0.98,
    "direction": "DOWNSTREAM",
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
- strict-priority-before-best-effort aggregation under overload
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
- `15_subscriber_IPAM_Services_BNG.md`
- `13_api_reference.md`

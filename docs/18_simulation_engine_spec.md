# 18. Simulation Engine Spec

Normative language:
- `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `MAY` are interpreted as binding requirement keywords.
- If this document and a non-canonical note conflict, this document's normative statements take precedence.

## 1. Purpose

Define authoritative simulation-engine behavior for runtime ticks, event emission, ordering, and failure handling.

Authoritative runtime:
- Backend (Node.js service loop in `server.ts`)
- Frontend consumes deltas/snapshots and renders only

## 2. Tick and Version Model

Primary runtime tick:
- server-side interval (`TRAFFIC_TICK_INTERVAL_MS`, default 1000ms)
- canonical tick field in contracts is `tick_seq`

Compatibility note:
- runtime payloads may still expose legacy metric field names such as `metric_tick_seq` during transition.
- contract consumers SHOULD normalize to `tick_seq`.

Topology versioning:
- `topo_version` increments only on topology mutations
- metric/status ticks MUST NOT increment `topo_version`

## 3. Simulation Responsibilities

Per tick (deterministic order):
1. read immutable topology snapshot
2. read immutable subscriber-session snapshot
3. generate leaf traffic (session-gated)
4. aggregate upstream post-order
5. apply downstream pre-order capacity distribution
6. update in-memory metric snapshot
7. emit metric/status deltas

## 4. Event Contract

Canonical envelope stream:
- socket channel `event` with `kind=deviceMetricsUpdated`
- socket channel `event` with `kind=deviceStatusUpdated`
- topology mutation events carry `topo_version`

Rules:
- payloads MUST use canonical envelope (`type`, `kind`, `payload`, `ts`, optional `topo_version`)
- event ordering MUST follow realtime contract from `05_realtime_and_ui_model.md`

## 5. Optical and Traffic Semantics

Current runtime baseline:
- deterministic synthetic baseline is active
- full physical-path recompute is contract-driven by optical docs and remains implementation-phased

Normative integration targets:
- optical path/budget semantics: `04_signal_budget_and_overrides.md`
- link/path constraints: `04_links_and_batch.md`
- traffic gating/aggregation/congestion: `11_traffic_engine_and_congestion.md`
- subscriber session gating: `15_subscriber_IPAM_Services_BNG.md`

## 6. Failure Handling

- recoverable tick errors are logged; loop continues
- empty-topology ticks are valid no-op updates
- sustained emission backpressure MUST degrade gracefully (coalescing/snapshot recovery path), not corrupt ordering guarantees

## 7. Performance Targets

Initial target:
- stable operation at project-scale test datasets
- no cascading resync caused by metric backpressure

Extended targets:
- defined in `12_testing_and_performance_harness.md`
- tracked in `ROADMAP_V2.md`

## 8. Cross-Document Contract

- `05_realtime_and_ui_model.md`
- `11_traffic_engine_and_congestion.md`
- `12_testing_and_performance_harness.md`
- `13_api_reference.md`
- `15_subscriber_IPAM_Services_BNG.md`

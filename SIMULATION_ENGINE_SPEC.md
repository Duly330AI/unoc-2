# SIMULATION_ENGINE_SPEC.md

## Purpose
Define the authoritative simulation engine behavior.

Authoritative runtime:
- Backend (Node.js service loop in `server.ts`)
- Frontend consumes deltas/snapshots and renders only

## Tick Model

Primary runtime tick:
- server-side interval (`TRAFFIC_TICK_INTERVAL_MS`, default 1000ms)
- metric stream uses `metric_tick_seq`

Topology versioning:
- `topology_version` increments only on topology mutations
- metric ticks do not advance topology version

## Simulation Responsibilities

Per tick:
1. read current device set
2. compute deterministic synthetic load and rx values
3. update in-memory metric snapshot
4. emit metric deltas
5. emit status updates derived from signal/load buckets

## Event Contract

Canonical envelope stream:
- socket channel `event` with `kind=deviceMetricsUpdated`, payload includes metric items and tick
- socket channel `event` with `kind=deviceStatusUpdated`, payload includes status items and tick
- topology events carry `topo_version`; metric/status ticks do not increment topology version

## Path and Optical Notes

Current implementation is deterministic synthetic baseline and does not yet perform full physical path traversal per tick.

Roadmap target:
- integrate full optical path computations and segment-aware congestion from docs/04_links_and_batch.md, docs/04b_signal_budget_and_overrides.md and docs/11_traffic_engine_and_congestion.md.

## Failure Handling

- recoverable tick errors are logged; loop continues
- empty topology ticks are valid (no-op updates)

## Performance Targets

Initial target:
- stable operation at project-scale test datasets
- no cascading resync caused by metric backpressure

Extended targets are defined in docs/12 and docs/ROADMAP.md.

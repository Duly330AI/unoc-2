# Contract Drift Checklist

This checklist is used before merging documentation or API/runtime contract changes.

## 1. Event Envelope Consistency

- All Socket examples use canonical envelope:
  - `type`
  - `kind`
  - `payload`
  - `topo_version`
  - `correlation_id`
  - `ts`
- No flat event examples (`{"event":"..."}`) remain in canonical specs.
- Event names are identical across:
  - `05_realtime_and_ui_model.md`
  - `11_traffic_engine_and_congestion.md`
  - `13_api_reference.md`

## 2. Link and Optical Medium Contract

- `physical_medium_id` is canonical in link create/update contracts.
- Medium IDs follow ITU-like style (for example `G.652.D`, `G.657.A1/A2`, `G.652.D OSP`).
- Optical docs, API docs, and data catalogs use the same medium key style.

## 3. Status Model Separation

- Runtime status enum is only: `UP`, `DOWN`, `DEGRADED`, `BLOCKING`.
- Lifecycle state is not encoded in runtime status values.
- Lifecycle flags (for example `provisioned`) are documented separately.
- Pseudocode in docs matches normative status rules (no stale fallback behavior).

## 4. Optical Path Resolution Contract

- Dijkstra-based weighted path selection documented in all relevant specs.
- Ranking cost includes:
  - link attenuation (`length_km * attenuation_db_per_km`)
  - passive insertion losses (interior passives)
- Deterministic tie-break order is explicitly documented.
- Optical-path endpoint payload fields are aligned with spec:
  - `total_loss_db`
  - `total_link_loss_db`
  - `total_passive_loss_db`
  - `total_physical_length_km`
  - `hop_count`
  - `path_signature`

## 5. Units and Utilization

- Capacity unit origin is clear (`*_mbps` from DB/catalog).
- Throughput units in payloads are explicit (for example `*_gbps`).
- Normalization rule before utilization division is documented.
- No mixed-unit utilization formulas remain ambiguous.

## 6. Device Type and Cockpit Mapping

- All canonical device types used in provisioning/runtime docs are mapped in cockpit docs.
- Seed/implicit entities (for example `BACKBONE_GATEWAY`) are explicitly handled.
- Fallback behavior (`GenericCockpit`) is only for unknown/unmapped types.

## 7. Cross-Reference Integrity

- No stale file references (renamed/removed docs) remain.
- Cross-links in `ARCHITECTURE.md`, `ROADMAP_V2.md`, and command/test docs are valid.
- Run:

```bash
rg -n "04b_signal_budget_and_overrides|TODO:old|legacy spec" docs SIMULATION_ENGINE_SPEC.md
```

## 8. Minimum Verification Commands

Run locally before merge:

```bash
npm run lint
npm test
npm run build
```

If docs changed in contracts, also verify:

```bash
rg -n "\"event\":|physical_medium_id|topo_version|path_signature|utilization = throughput / capacity" docs
```

## 9. Merge Gate

Merge only when:

- all checklist sections are reviewed,
- contract-changing docs and implementation are aligned,
- ROADMAP tasks reflect remaining open work (no hidden gaps).

## 10. 40-Point Claim Matrix (2026-03-07)

Legend:
- `implemented`: claim matches current runtime behavior.
- `partial`: claim is directionally right but not fully guaranteed/implemented.
- `planned`: documented in specs/roadmap but not in runtime yet.
- `incorrect`: claim conflicts with current runtime.

| # | Claim (short) | Status | Evidence | Fix Task |
| --- | --- | --- | --- | --- |
| 1 | Concurrent device overrides are last-write-wins | implemented | `PATCH /api/devices/:id/override` updates device status directly | none |
| 2 | UP override with broken upstream emits `OVERRIDE_CONFLICT` | planned | event not emitted in runtime; only documented target | TASK-222, TASK-217 |
| 3 | Link override can force path conflict + conflict event | planned | no explicit conflict event path in runtime | TASK-222, TASK-217 |
| 4 | Coalescing window dedupes recompute triggers | planned | docs say not fully closed in runtime snapshot | TASK-217, TASK-130 |
| 5 | Provision/delete race protected by atomic provisioning tx | incorrect | no `$transaction` in current provision endpoint | TASK-215 |
| 6 | Dijkstra uses immutable snapshot across tick | partial | runtime has path traversal; full snapshot isolation not explicit | TASK-118 |
| 7 | Link delete during path calc handled via next tick recompute | partial | eventual behavior plausible; not hard-guaranteed contract in code | TASK-118, TASK-217 |
| 8 | Deprovisioned nodes blocked via `is_link_passable` | incorrect | no persisted `provisioned` lifecycle state in schema/runtime | TASK-215, TASK-218 |
| 9 | `path_signature` deterministic tie-break | implemented | optical-path response includes `path_signature` | TASK-118 (hardening) |
| 10 | Invalid OLT tx power rejected by Zod range checks | incorrect | no such validated OLT power patch path in runtime | TASK-119 |
| 11 | Traffic aggregation loop-proof via DAG enforcement | partial | visited sets exist; full DAG/loop policy not complete in runtime | TASK-118, TASK-181 |
| 12 | `capacity=null` yields `utilization=null` warning path | planned | documented, not fully implemented end-to-end in runtime payload | TASK-181 |
| 13 | UP->DOWN->UP same tick collapses to final snapshot | partial | concept exists, full coalescing not fully implemented | TASK-217 |
| 14 | Congestion hysteresis 95/85 fully active runtime | planned | documented; segment congestion events not fully implemented | TASK-043, TASK-185 |
| 15 | Segment UP with all ONTs DOWN => 0% load | partial | expected if gating/aggregation complete; not fully closed runtime | TASK-218, TASK-181 |
| 16 | Link animation resilient via CSS dashoffset/GPU | incorrect | no canonical link animation implementation in current UI | TASK-219, TASK-220 |
| 17 | Dragging node re-routes edges in realtime | implemented | React Flow default behavior with node drag | none |
| 18 | Panel anti-flicker guaranteed by batching under heavy deltas | partial | React batching exists; app-level throttling/coalescing not complete | TASK-217, TASK-220 |
| 19 | Container reflow + drag conflict handled deterministically | planned | no full container reflow engine in current UI | TASK-221 |
| 20 | Link-target deleted during draw causes rollback toast | partial | backend fails call; UI sets error state (not full optimistic rollback/toast) | TASK-140 |
| 21 | Batch create+delete same request prevented by endpoint design | implemented | endpoints split: `/api/links/batch`, `/api/links/batch/delete` | none |
| 22 | Batch create uses partial-failure contract | implemented | `failed_links`/`created_link_ids` returned | TASK-109 (already baseline) |
| 23 | Delete during recompute resolved by eventual consistency | partial | plausible with current loops; no strict recompute queue contract | TASK-185, TASK-217 |
| 24 | Medium patch races serialized via DB row-level lock contract | incorrect | current stack is SQLite-targeted; row-lock claim not guaranteed | TASK-216 |
| 25 | PATCH on deleted link returns 404 | implemented | `PATCH /api/links/:id` checks existence first | none |
| 26 | Parent assign to deleted container rejected by backend FK | incorrect | no parent-container patch endpoint in runtime | TASK-176, TASK-221 |
| 27 | Container move isolated from child metric deltas | planned | container movement/reflow not fully implemented | TASK-221 |
| 28 | Lost parent sync recovered via topo-version gap | partial | gap detection exists in client store; parent events incomplete | TASK-129, TASK-221 |
| 29 | Indirect container-parent loops blocked server-side | incorrect | no parent traversal validator endpoint in runtime | TASK-176 |
| 30 | Simultaneous parent assignments resolved atomically | incorrect | parent assignment API path not implemented | TASK-176 |
| 31 | Provision+interface generation guarded by tx + `provisioned` check | incorrect | no persisted `provisioned` and no tx guard in provision route | TASK-215 |
| 32 | IP allocated then interface write fails -> full rollback | incorrect | transactional IP allocation path not implemented | TASK-216 |
| 33 | Parent-required provisioning checked atomically | partial | strict ONT/AON checks exist; parent-required transactional guard absent | TASK-215, TASK-176 |
| 34 | Provision succeeds then optical break flips ONT down | partial | dynamic recompute model is target; not fully closed for all paths | TASK-118, TASK-218 |
| 35 | Duplicate `mgmt0` blocked by DB unique + concurrency guard | incorrect | no interface table/unique contract active in runtime schema | TASK-216 |
| 36 | Delayed websocket ordering handled by version checks | partial | topo-version gap logic exists in client; full per-event seq handling incomplete | TASK-129, TASK-185 |
| 37 | Status event for unknown device is ignored safely | implemented | client map/update paths naturally ignore missing node ids | none |
| 38 | Stale signal events discarded by strict versioning | incorrect | no strict per-event stale-drop policy for all event classes in client | TASK-185, TASK-129 |
| 39 | Resync loop protected by client backoff/rate-limit | incorrect | no explicit backoff loop control in current store code | TASK-129 |
| 40 | Deltas buffered during resync then replayed | incorrect | no explicit delta buffer/replay queue in current client | TASK-185, TASK-129 |

Notes:
- This matrix is implementation-reality focused and intentionally stricter than roadmap/spec targets.
- Update statuses whenever runtime behavior changes; do not treat `planned` rows as done.

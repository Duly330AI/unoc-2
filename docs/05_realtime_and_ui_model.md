# 05. Realtime and UI Model

This document defines realtime event contracts, UI interaction behavior, deterministic client synchronization, and failure semantics.

Stack context:
- Backend: Node.js + Express + Prisma + Socket.io
- Frontend: React + TypeScript + React Flow

## Implementation Snapshot (2026-03-07)

Current backend implementation status:
- Socket envelope (`type`, `kind`, `payload`, `ts`, optional `topo_version`) is active.
- Core events such as `deviceCreated`, `deviceUpdated`, `linkAdded`, `linkUpdated`, `linkDeleted`, `deviceMetricsUpdated`, `deviceStatusUpdated`, `deviceSignalUpdated` are emitted.
- Congestion transition events (`segmentCongestionDetected`, `segmentCongestionCleared`) are emitted for OLT-level segment abstraction.
- Realtime delivery now uses correlation-bound outbox buckets on the server with deterministic flush phases and in-window deduplication for signal/status/metrics classes.

Not yet fully implemented versus target model:
- Client-side reconnect/version-gap recovery logic is partially covered; advanced buffering/replay policy is not fully closed.
- `deviceContainerChanged` emission requires container reparent APIs that are still planned.
- Full validation of delayed websocket ordering against client-side version-handling remains open.

## 1. Realtime Delta Events

## 1.1 Event Inventory (Current + Planned)

| Event | Payload (shape) | Trigger | Coalesce | Notes |
| --- | --- | --- | --- | --- |
| `deviceCreated` | `{ id, type, name, status }` | `POST /api/devices` | append-only | topology/operations phase |
| `deviceStatusUpdated` | `{ tick, items:[{ id, status }] }` | Status recompute | per-device dedupe in flush bucket | status phase |
| `deviceSignalUpdated` | `{ tick, items:[{ id, received_dbm, signal_status }] }` | Signal recompute | per-device dedupe in flush bucket | signal phase |
| `linkMetricsUpdated` | `{ tick, items:[{ id, traffic_gbps, utilization_percent, version }] }` | Traffic tick delta | yes | Emit only for changed links |
| `linkUpdated` | `{ id, length_km, physical_medium_id?, physical_medium_code?, link_loss_db }` | Optical patch | append-only | topology/operations phase |
| `deviceOpticalUpdated` | `{ id, insertion_loss_db?, tx_power_dbm?, sensitivity_min_dbm? }` | Optical attribute patch | yes | Passive/OLT/ONT updates |
| `linkAdded` | `{ id, a_interface_id, b_interface_id, a_device_id, b_device_id, effective_status }` | `POST /api/links` | append-only | topology/operations phase |
| `linkDeleted` | `{ id }` | `DELETE /api/links/:id` | append-only | topology/operations phase |
| `linkStatusUpdated` | `{ id, status, override? }` | Link override / dependency change | per-link dedupe in flush bucket | status phase |
| `deviceOverrideChanged` | `{ id, override_status, effective_status }` | Override mutation | per-device dedupe in flush bucket | status phase |
| `deviceContainerChanged` | `{ id, parent_container_id }` | Assignment / unassign | no | `parent_container_id` may be `null` |
| `subscriberSessionUpdated` | `{ session_id, device_id, bng_device_id, service_type, state, infra_status?, service_status, reason_code?, vlan_path_valid? }` | Session lifecycle transition | append-only | subscriber/service phase |
| `cgnatMappingCreated` | `{ mapping_id, session_id, public_ip, port_range }` | CGNAT allocation | append-only | subscriber/service phase |
| `forensicsTraceResolved` | `{ query, mapping, session, topology }` | Trace query resolution | append-only | subscriber/service phase |
| `deviceMetricsUpdated` | `{ tick, items:[{ id, trafficLoad, trafficMbps, rxPower, status, metric_tick_seq }] }` | Traffic tick delta | per-device dedupe in flush bucket | metrics phase |
| `segmentCongestionDetected` | `{ segmentId, oltId, utilization, tick }` | Congestion enter | per-segment last-write-wins in flush bucket | metrics phase |
| `segmentCongestionCleared` | `{ segmentId, oltId, utilization, tick }` | Congestion clear | per-segment last-write-wins in flush bucket | metrics phase |

## 1.2 Coalescing Strategy

Server runtime maintains correlation-bound outbox buckets.

Rules:
- API requests and simulation ticks write events into a bucket keyed by request correlation ID or tick correlation ID.
- Topology/operations and subscriber/service events are append-only inside the bucket.
- Signal events are deduped per device ID.
- Status events are deduped per entity/event policy (for example device, link, override conflict target).
- Metrics/congestion events are deduped per entity/segment.
- Flush occurs after successful request completion and at the end of the traffic simulation tick.
- Failed requests discard their request bucket instead of emitting partial state.

## 1.3 Socket Contract (Authoritative)

Transport:
- Socket.io namespace/path under API prefix (`/api/socket.io` in deployment; resolved by server config)
- no client-side event name translation layer

Envelope:

```json
{
  "type": "event",
  "kind": "deviceStatusUpdated",
  "payload": {},
  "topo_version": 101,
  "correlation_id": "req_...",
  "ts": "2026-03-07T12:00:00.000Z"
}
```

Contract requirements:
- `topo_version` is monotonic and allows gap detection.
- If client receives a version gap (e.g. 100 -> 102), it must trigger full topology resync.
- Heartbeat/ping-pong must be enabled by Socket.io defaults and stale clients cleaned up server-side.

## 1.4 Event Ordering Guarantees

Within one flush bucket, server emission order is deterministic by phase:
1. topology and operations (`deviceCreated`, `deviceUpdated`, `deviceDeleted`, `deviceProvisioned`, `linkAdded`, `linkUpdated`, `linkDeleted`, `batchCompleted`)
2. subscriber and service events (`subscriberSessionUpdated`, `cgnatMappingCreated`, `forensicsTraceResolved`)
3. signal deltas (`deviceSignalUpdated`)
4. status deltas (`deviceStatusUpdated`, `linkStatusUpdated`, `deviceOverrideChanged`, `overrideConflict`)
5. metrics and congestion (`deviceMetricsUpdated`, `segmentCongestionDetected`, `segmentCongestionCleared`)

Guarantees:
- For deduped classes, last write wins within the current bucket.
- Ordering is guaranteed within one request/tick bucket only.
- Cross-bucket delivery still relies on Socket.io transport ordering plus client gap detection; this remains a partial area for reconnect hardening.

## 2. UI Interaction Model

Layout:
- Header + viewer tabs
- Three-column workspace: Palette | Canvas | Context Panel

Central canvas invariant:
- Spatial state (pan/zoom/node positions/link geometry) is owned by canvas engine only.
- Cockpit components receive data updates but must not mutate geometry.
- Content overflow must be handled in component internals (truncate/wrap), never by resizing topology geometry.

## 2.0 Contract Clarifications (2026-03-07)

To avoid over-interpreting the spec, the following points are explicit:
- Link flow visualization method is not contract-bound to `stroke-dashoffset`; any deterministic approach is acceptable.
- Asymmetric tariff handling is required in traffic computation, but no mandatory dual-path/dual-color canvas encoding is currently specified.
- Color semantics in this doc are normative for status classes; no canonical traffic-intensity colormap is fixed yet.
- UI pre-validation for link/provisioning actions is optional; backend validation is authoritative.
- Override visibility is guaranteed in details/context panels; dedicated canvas iconography is optional until specified.
- `Child-selector` workflow for container endpoint assistance is planned UX and may be absent in current MVP UI.
- React Flow performance assumptions must not claim viewport node removal by default.
  - Offscreen elements may still be part of render tree depending on library/runtime behavior.
  - Performance controls must be implemented explicitly (animation gating, batching, optional manual virtualization strategy).
- Critical-path delete protection is currently not a guaranteed UX contract.

## 2.1 Core Interactions

| Action | Mechanism | Backend Result | UI Feedback |
| --- | --- | --- | --- |
| Create device (single) | Drag palette -> canvas | `POST /api/devices` | Ghost -> solid on success |
| Create devices (bulk) | Context menu on palette item | Batch create workflow | Aggregated toast |
| Select | Click | `selection[]` update | Highlight |
| Multi-select | Ctrl/Cmd + click | Append selection | Combined panel |
| Start link | Context menu start | link mode | Cursor/hint change |
| Complete link | Click target | `POST /api/links` | Link flash + toast on error |
| Provision | Context panel action | `POST /api/devices/:id/provision` | Spinner -> badge |
| Multi-provision | Selection action | batch/iterative provision calls | Aggregated result |
| Assign parent POP | Selection action | parent patch endpoint | Success/failure summary |
| Edit link optical props | Link panel form | `PATCH /api/links/:id` | Inline validation |
| Edit passive loss | Device panel numeric input | `PATCH /api/devices/:id` | Debounced delta updates |
| View ONT optical analysis | ONT details panel | read API + socket deltas | Live summary + on-demand breakdown |

## 2.2 Frontend State Model

```ts
store = {
  devices: Device[],
  links: Link[],
  selection: string[],
  ui: { viewMode: "topology" },
  pending: {
    deviceCreates: Set<string>,
    linkCreates: Set<string>,
    opticalEdits: Set<string>
  }
}
```

## 2.3 Feedback Principles

- Non-blocking toasts for failures.
- Optimistic updates only where rollback is deterministic.
- Bulk operations always return a summarized outcome.
- Undo actions are short-lived and explicitly scoped to operation IDs.

Service-health UX rule:
- UI must distinguish infrastructure health from subscriber service health.
- `Infra UP` does not imply `Service UP` without active session and valid service path.
- UI-facing payloads should carry separate fields (`infra_status`, `service_status`) for deterministic rendering.
- Visual differentiation is mandatory (for example dedicated badge row/color/token), so operators can identify `Infra UP + Service DOWN` at a glance.

## 3. Detailed Panels and Contracts

## 3.1 Bulk Device Creation Modal

Contract:
- Trigger: palette context action
- Inputs: `count` (min 1, max policy), optional naming prefix, required parent for `OLT`/`AON_SWITCH` when container policy demands it
- Accessibility: focus trap, ESC close, Enter confirm, autofocus first field
- Undo: reverse-order deletion of created IDs
- Placement: overlap-aware clustered layout, persisted through layout endpoint

## 3.2 Ports and Interfaces Summary

Endpoint:
- `GET /api/ports/summary/:device_id`

Response:

```json
{
  "device_id": "...",
  "total": 0,
  "by_role": {
    "UPLINK": { "total": 0, "used": 0 },
    "ACCESS": { "total": 0, "used": 0 },
    "PON": { "total": 0, "used": 0, "max_subscribers": 0 },
    "MANAGEMENT": { "total": 1, "used": 1 }
  }
}
```

Counting rules:
- `ACCESS`/`UPLINK`: linked interfaces count
- `PON` on OLT: provisioned ONTs resolved to this OLT (current model aggregates at OLT level, not per-PON-interface)
- `MANAGEMENT`: `1` if mgmt interface exists, else `0`

## 3.3 Link Details Panel

Editable:
- `physical_medium` from `GET /api/optical/fiber-types`
- `length_km` (float, e.g. step `0.01`)

Read-only:
- computed `link_loss_db`

Validation:
- inline field-level errors with backend code mapping

Save strategy:
- explicit save in MVP (debounce optional later)

## 3.4 Passive/OLT/ONT Panels

Passive (ODF/NVT/HOP/Splitter):
- `insertion_loss_db` editable (min 0, step 0.1), debounced patch
- Splitter-specific used/total badge from splitter parameters

OLT:
- `tx_power_dbm` editable (slider + numeric)
- dependent ONT count + last recompute timestamp

ONT Analysis:
- display Tx, total attenuation, Rx, margin, status
- path breakdown table (order, element, id, contribution, cumulative)
- empty state if no path
- if override forces UP while signal path invalid, show warning banner
- include Subscriber Sessions view with:
  - WAN IP (IPv4 and/or IPv6-PD when present),
  - protocol (`DHCP`/`PPPoE`),
  - session state (`INIT`, `ACTIVE`, `EXPIRED`, `RELEASED`),
  - bound VLAN tuple (`c_tag`, `s_tag`) and service type.

Note:
- `deviceSignalUpdated` stays compact; full path details are fetched via dedicated API (for example `GET /api/devices/:id/optical-path`).

## 4. Link/Container UX Constraints

Rules:
- Containers (`POP`, `CORE_SITE`) are never valid link endpoints.
- In link mode, clicking a container opens child-device selector filtered by link rules.
- Server must still reject any container endpoint payloads.
- `mgmt0` is not a valid link endpoint.
- Link compatibility is validated against `LINK_TYPE_RULES`.
- Splitter oversubscription is blocked with explicit error codes/details.

## 5. Cockpit Mapping and Rendering Semantics

Stable mapping:
- `CORE_ROUTER`, `EDGE_ROUTER` -> Router cockpit
- `OLT` -> OLT cockpit
- `AON_SWITCH` -> AON switch cockpit
- `ONT`, `BUSINESS_ONT` -> ONT cockpit
- `AON_CPE` -> AON CPE cockpit
- passive inline (`ODF`, `NVT`, `SPLITTER`, `HOP`) -> passive cockpit
- `POP` -> POP cockpit
- `CORE_SITE` -> core-site cockpit

Render invariants:
- containers in background layer,
- children and links above,
- containment/slot attraction may guide child placement but must remain deterministic.

## 6. Capacity, Animation, Congestion

## 6.1 Router Total Capacity Contract

Backend response fields:
- `parameters.capacity.effective_device_capacity_mbps`
- `parameters.effective_capacity_mbps`

UI convention:
- label `TotCap (Gbps)`
- value `current / max` with deterministic rounding/unit rules

## 6.2 Link Flow Animation

- Animate only when utilization > 0.
- Speed scales with utilization but is capped.
- Dash spacing scales with physical link length.
- Suspend animation while tab is hidden.

## 6.3 Congestion with Hysteresis

Thresholds:
- device/link enter >= 100%, clear <= 95%
- GPON segment enter >= 95%, clear <= 85%

Semantics:
- sticky warning behavior to avoid flicker
- update indicators only on threshold crossings

## 7. Error Codes and Failure Semantics

Error code source-of-truth:
- centralized backend enum/module only

Representative codes:
- `POOL_EXHAUSTED`
- `P2P_SUPERNET_EXHAUSTED`
- `DUPLICATE_MGMT_INTERFACE`
- `DUPLICATE_LINK`
- `INVALID_PROVISION_PATH`
- `INVALID_LINK_TYPE`
- `OVERRIDE_CONFLICT`
- `ATTENUATION_PARAM_INVALID`
- `FIBER_TYPE_INVALID`
- `SIGNAL_PATH_INCOMPLETE`
- `INVALID_DEBUG_INJECTION`
- `DEBUG_INJECTION_LIMIT`
- `FEATURE_DISABLED`
- `SANDBOX_LOAD_VERSION_MISMATCH`

Rules:
- Each error must map to deterministic HTTP status and machine-readable code.
- UI toasts/panels render code + short actionable detail.

## 8. Determinism and Ordering

Deterministic guarantees:
- Stable sorting for bulk outputs and topology payloads.
- Canonical endpoint ordering where required (for example routed p2p semantics).
- Stable path tie-break with path signature.
- Realtime ordering as defined in section 1.4.

## 9. Deferred Extensions

Deferred but tracked:
- multiple OLT path comparison
- attenuation heatmap overlay
- path recommendation view
- additional viewer tabs (IPAM dashboard, signal monitor)
- lasso selection
- bulk override operations
- sandbox diff view

## 9.1 Large-Topology Rendering Strategy (Normative)

For large graph scenarios, UI behavior must remain deterministic and bounded:
- spatial ownership stays on canvas engine (`pan/zoom/node positions`) as defined above,
- LOD policy MUST reduce expensive visual features first (animations, shadows, rich labels),
- clustering/aggregation MAY be applied for overview levels but MUST preserve deterministic expand/collapse behavior,
- node/link detail panels remain source-of-truth and MUST not be replaced by approximated cluster state.

Operational thresholds (baseline contract):
- `>= 1,000` visible nodes: disable non-essential link animations by policy.
- `>= 2,500` visible nodes: activate simplified edge rendering profile.
- `>= 5,000` visible nodes: switch to overview-first mode with explicit operator opt-in for full-detail rendering.

Interaction guarantees under scale:
- select, multi-select, and context panel open MUST remain available.
- link-create mode MAY be temporarily restricted in overview-first mode and must show explicit UX hint.
- resync/snapshot recovery logic MUST remain identical across normal and scaled render modes.

## 10. Cross-Document Contract

- `04_signal_budget_and_overrides.md`: signal events, classification and override precedence
- `04_links_and_batch.md`: link lifecycle, batch semantics and validation
- `07_container_model_and_ui.md`: container behavior and child handling
- `15_subscriber_IPAM_Services_BNG.md`: subscriber session/cgnat/forensics event extensions
- `13_api_reference.md`: canonical REST/Socket contracts
- `16_ui_ipam_explorer.md`: IPAM explorer view contracts
- `17_ui_forensics_trace.md`: forensics trace UI contracts

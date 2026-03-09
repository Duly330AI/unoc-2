# 09. Cockpit Nodes (Components, Props, Rendering Rules)

This document defines cockpit mapping, prop contracts, rendering invariants, and performance/a11y requirements.

Stack context:
- Frontend: React + TypeScript + React Flow
- Data sources: REST summaries + socket deltas + shared stores

## 1. Device-Type to Component Mapping

Canonical mapping:
- `CORE_ROUTER` -> `RouterCockpit`
- `EDGE_ROUTER` -> `RouterCockpit`
- `BACKBONE_GATEWAY` -> `RouterCockpit`
- `OLT` -> `OLTCockpit`
- `AON_SWITCH` -> `AONSwitchCockpit`
- `ONT`, `BUSINESS_ONT` -> `ONTCockpit`
- `AON_CPE` -> `AONCPECockpit`
- `POP` -> `POPCockpit`
- `CORE_SITE` -> `CoreSiteCockpit`
- passive inline (`ODF`, `NVT`, `SPLITTER`, `HOP`) -> `PassiveCockpit`

Fallback:
- unknown type -> `GenericCockpit`

Backbone gateway note:
- `BACKBONE_GATEWAY` is typically implicit/seeded in MVP and may be hidden from normal palette flows.
- If surfaced (debug/admin flows), it must still resolve to `RouterCockpit` instead of `GenericCockpit`.

## 2. Common Props Contract

Normalized props:
- `device`: canonical device DTO
- `metrics?`: current metrics slice
- `portSummary?`: aggregated summary from `GET /api/ports/summary/:device_id`
- `links?`: neighboring link metadata
- `selectionState?`: optional UI selection metadata

Capacity compatibility fields:
- `parameters.capacity.effective_device_capacity_mbps`
- `parameters.effective_capacity_mbps`

Resilience:
- optional props must soft-fail to neutral state

## 3. Rendering Rules by Cockpit

## 3.1 RouterCockpit

- current MVP card uses live load plus `portSummary.by_role.UPLINK`/`ACCESS`
- current MVP card now surfaces direction-aware runtime load (`downstreamMbps`, `upstreamMbps`) when present
- current MVP card now also surfaces BNG role metadata when present:
  - `bng_cluster_id`
  - optional `bng_anchor_id`
  - compact pool utilization bars from `GET /api/bng/pools` (including `sub_ipv4` and `sub_ipv6_pd` when present)
- current render is summary-oriented, not full `TotCap` implementation yet
- future `TotCap (Gbps)` contract remains the target once direction-aware capacity data is exposed end-to-end
- if router has BNG role/capability:
  - show `bng_cluster_id`,
  - show subscriber pool utilization summary (`sub_ipv4`, `sub_ipv6_pd`) for assigned BNG domain,
  - show CGNAT pool utilization summary (`cgnat_public`) where applicable.

## 3.2 OLTCockpit

- uses `portSummary.by_role.PON` for occupancy/capacity badges
- per-interface matrix detail (if shown) comes from interface-specific data source, not summary endpoint
- drill-down ONT lists via `/api/ports/ont-list/:device_id`
- current MVP card shows `PON used/total`, `Split`, `Uplink used/total`, connected ONT count, and a compact ONT list preview

## 3.3 AONSwitchCockpit

- uses `portSummary.by_role.ACCESS` and `UPLINK` for used/total badges

## 3.4 ONTCockpit and AONCPECockpit

- compact KPI view
- current MVP card shows:
  - explicit infra badge
  - explicit service badge
  - separated downstream/upstream runtime load when available
  - session/service state
  - assigned session IPv4 when present
  - assigned delegated IPv6-PD prefix when present
  - WAN address fallback from `/api/interfaces/:device_id`
  - protocol and service type
- ONT optical-only detail rows (`received`, `margin`, `signal_status`) remain future work
- AON CPE omits optical-only rows
- both must support live subscriber session slices:
  - assigned WAN/private IP and/or delegated prefix,
  - lease/session remaining time where available,
  - service type (`INTERNET`, `IPTV`, `VOICE`) and current session state.

## 3.5 PassiveCockpit

- current MVP card uses aggregate port-summary semantics for ingress/egress/total
- splitter currently shows output occupancy from runtime port summary; richer splitter-parameter contract remains future work

## 3.6 Container Cockpits

- aggregate child health with precedence `DOWN > DEGRADED > UP`
- aggregate occupancy/traffic as read model only
- aggregation is recursive over descendants (`CORE_SITE -> POP -> devices`)
- never treated as link endpoints

## 4. Realtime Integration

Cockpits subscribe to shared stores updated by:
- metrics/status/link deltas
- snapshot replacement flows after reconnect/gap

Gap behavior:
- on `topo_version` gap, clients resync before applying subsequent deltas

## 5. Accessibility

- ARIA labels for KPIs and matrices
- keyboard navigation with visible focus
- high-contrast support
- status not conveyed by color alone

## 6. Performance

- stable props + memoization to reduce rerenders
- suspend expensive polling for offscreen/inactive nodes
- batch visual updates under burst deltas
- virtualization for large matrices is deferred

Large-topology cockpit strategy (normative baseline):
- cockpits MUST support progressive detail degradation without changing semantic values.
- at elevated node counts, cockpits SHOULD switch from verbose KPI rows to compact status/capacity badges.
- offscreen/inactive cockpit internals SHOULD defer expensive formatting/computation.
- fallback to `GenericCockpit` MUST NOT be used as a scale shortcut for known device types.

## 7. Testing Baseline

- mapping coverage (`device_type -> cockpit`)
- TotCap formatting and capacity fallback tests
- role-summary badge rendering tests
- optional-prop resilience tests
- reconnect/snapshot reconciliation tests

## 8. Error and Fallback Behavior

- missing metrics -> placeholders
- malformed optional payload -> ignore + diagnostic log
- unknown device type -> `GenericCockpit`

## 9. Cross-Document Contract

- `05_realtime_and_ui_model.md`
- `07_container_model_and_ui.md`
- `08_ports.md`
- `11_traffic_engine_and_congestion.md`
- `13_api_reference.md`

# 13. API Reference

This document is the canonical external contract for REST endpoints and Socket events.

Base conventions:
- Base path: `/api`
- Content type: `application/json`
- IDs: UUID-style identifiers unless explicitly stated otherwise
- Error responses include machine-readable `code`

## 1. REST Conventions

Standard response behavior:
- `2xx` for success
- `4xx` for client errors with deterministic error code
- `5xx` for unhandled server errors

Canonical error envelope:

```json
{
  "error": {
    "code": "INVALID_LINK_TYPE",
    "message": "Human-readable summary",
    "details": { "field": "link_type" }
  },
  "request_id": "req_..."
}
```

## 2. Topology APIs

- `GET /api/topology`
  - returns full graph payload for client bootstrap
  - in MVP, server ensures `Backbone Gateway` implicit seed exists before first topology bootstrap response
  - seed behavior is idempotent and internal (no dedicated create endpoint required)
  - response: `{ nodes: [], edges: [], topo_version: number }`

## 3. Device APIs

- `GET /api/devices`
- `POST /api/devices`
- `GET /api/devices/:id`
- `PATCH /api/devices/:id`
- `DELETE /api/devices/:id`
- `POST /api/devices/:id/provision`
- `PATCH /api/devices/:id/override`

Contract notes:
- creation/provisioning enforces parent/role constraints
- patch operations return deterministic validation errors for unsupported fields

## 4. Link APIs

- `GET /api/links`
- `POST /api/links`
- `DELETE /api/links/:id`
- `POST /api/links/batch`
- `POST /api/links/batch/delete`
- `PATCH /api/links/:id`
- `PATCH /api/links/:id/override`

Contract notes:
- container endpoint IDs are rejected
- compatibility/link-rule validations return canonical error codes
- batch responses include partial-failure details when applicable
- in MVP GPON mode, direct `OLT <-> ONT` link creation is rejected
- canonical link fields are `a_interface_id`, `b_interface_id`, `length_km`, `physical_medium_id`
- realtime `linkAdded` payload must include endpoint interface IDs and device IDs (`a_interface_id`, `b_interface_id`, `a_device_id`, `b_device_id`)

## 5. Ports and Interfaces APIs

- `GET /api/ports/summary/:device_id`
- `GET /api/ports/summary?ids=...`
- `GET /api/ports/ont-list/:device_id`
- `GET /api/interfaces/:deviceId`

Contract notes:
- ports summary response is aggregate-by-role (`device_id`, `total`, `by_role`)
- bulk summary response includes canonical `by_device_id` mapping; `items` list may be present as compatibility alias
- `ids` query supports repeated (`?ids=a&ids=b`) and comma-separated (`?ids=a,b`) serialization
- role semantics include `MANAGEMENT.used = 1|0` depending on mgmt interface presence
- interface-level role enum may expose `MGMT`; summary payload maps this role to `MANAGEMENT`
- current PON `used` is OLT-level aggregated ONT count in the active model
- interfaces response includes addresses where present

## 6. Optical and Catalog APIs

- `GET /api/optical/fiber-types`
- `GET /api/catalog/hardware?type=...`
- `GET /api/catalog/hardware/:catalog_id`
- `GET /api/catalog/tariffs`
- `GET /api/devices/:id/optical-path` (details endpoint for full path breakdown)

Contract notes:
- UI uses fiber-types endpoint as source-of-truth
- compact signal events may omit path details; fetch via details endpoint
- optical path endpoint resolves path via Dijkstra and deterministic tie-break chain from `04_signal_budget_and_overrides.md`
- ranking attenuation includes `sum(length_km * attenuation_db_per_km)` plus interior passive insertion losses
- endpoint payload should expose at least:
  - `total_loss_db`
  - `total_link_loss_db`
  - `total_passive_loss_db`
  - `total_physical_length_km`
  - `hop_count`
  - `path_signature`

## 7. Metrics and Simulation APIs

- `GET /api/metrics/snapshot`
- `GET /api/sim/status`

Contract notes:
- snapshot used after reconnect/version gaps
- status endpoint exposes engine runtime health

## 7b. IPAM APIs

- `GET /api/ipam/prefixes`
- `GET /api/ipam/pools`

## 7c. Subscriber Services APIs

- `POST /api/sessions`
- `GET /api/sessions?device_id=...`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/validate-vlan-path`
- `GET /api/forensics/trace?ip=...&port=...&ts=...`
- `GET /api/bng/pools?bng_id=...`

Contract notes:
- Session creation requires valid optical/base path and valid service VLAN path.
- Session lifecycle states are canonical: `INIT`, `ACTIVE`, `EXPIRED`, `RELEASED`.
- Subscriber session identifiers and CGNAT mappings must be queryable deterministically for traceability.
- Infrastructure and service dimensions are separate (`infra_status` vs `service_status`).

Normative request/response shapes (planned):

`POST /api/sessions`

Request:

```json
{
  "device_id": "uuid",
  "interface_id": "uuid",
  "protocol": "DHCP",
  "service_type": "INTERNET",
  "mac_address": "02:55:4E:00:00:01",
  "c_tag": 100,
  "s_tag": 1010,
  "bng_device_id": "uuid"
}
```

Response:

```json
{
  "session_id": "uuid",
  "state": "INIT",
  "infra_status": "UP",
  "service_status": "DEGRADED",
  "reason_code": "SESSION_NOT_ACTIVE"
}
```

`PATCH /api/sessions/:id`

Request:

```json
{
  "state": "ACTIVE"
}
```

Response:

```json
{
  "session_id": "uuid",
  "state": "ACTIVE",
  "infra_status": "UP",
  "service_status": "UP",
  "reason_code": null
}
```

`GET /api/forensics/trace`

Response:

```json
{
  "query": { "ip": "198.51.100.5", "port": 5000, "ts": "2026-03-07T12:00:00Z" },
  "mapping": { "mapping_id": "uuid", "private_ip": "100.64.1.50", "public_ip": "198.51.100.5", "port_range": "4096-6143" },
  "session": { "session_id": "uuid", "state": "ACTIVE", "service_type": "INTERNET" },
  "device": { "id": "uuid", "type": "ONT", "infra_status": "UP", "service_status": "UP" },
  "topology": { "olt_id": "uuid", "bng_id": "uuid", "pop_id": "uuid" }
}
```

`GET /api/bng/pools`

Response:

```json
{
  "bng_id": "uuid",
  "cluster_id": "bng_cluster_frankfurt_01",
  "pools": [
    { "pool_key": "sub_ipv4", "vrf": "internet_vrf", "allocated": 1024, "capacity": 65536, "utilization_percent": 1.56 },
    { "pool_key": "sub_ipv6_pd", "vrf": "internet_vrf", "allocated": 768, "capacity": 4096, "utilization_percent": 18.75 },
    { "pool_key": "cgnat_public", "vrf": "cgnat_vrf", "allocated": 900, "capacity": 2048, "utilization_percent": 43.95 }
  ]
}
```

## 8. Socket Event Contract

Transport:
- Socket.io under API namespace/path configured by server deployment

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

Gap handling:
- clients detect non-monotonic/gapped `topo_version`
- on gap, clients resync topology + metrics snapshots

## 9. Server->Client Event Inventory

Core events:
- `deviceCreated`
- `deviceStatusUpdated`
- `deviceSignalUpdated`
- `deviceOverrideChanged`
- `deviceContainerChanged`
- `linkAdded`
- `linkUpdated`
- `linkDeleted`
- `linkStatusUpdated`
- `deviceMetricsUpdated`
- `linkMetricsUpdated` (when enabled)
- `segmentCongestionDetected`
- `segmentCongestionCleared`
- `subscriberSessionUpdated`
- `cgnatMappingCreated`
- `forensicsTraceResolved`

Planned event payload notes:
- `subscriberSessionUpdated` should include `infra_status`, `service_status`, and stable `reason_code`.
- `forensicsTraceResolved` should include deterministic references (`mapping_id`, `session_id`, `device_id`, `bng_id`).

Ordering contract (within one window):
1. topology/optical mutation updates
2. signal updates
3. status updates
4. metrics/congestion updates

## 10. Error Code Reference (Canonical)

Representative codes:
- `INVALID_PROVISION_PATH`
- `ALREADY_PROVISIONED`
- `POOL_EXHAUSTED`
- `P2P_SUPERNET_EXHAUSTED`
- `DUPLICATE_MGMT_INTERFACE`
- `DUPLICATE_LINK`
- `INVALID_LINK_TYPE`
- `OVERRIDE_CONFLICT`
- `ATTENUATION_PARAM_INVALID`
- `FIBER_TYPE_INVALID`
- `SIGNAL_PATH_INCOMPLETE`
- `FEATURE_DISABLED`
- `SESSION_POOL_EXHAUSTED`
- `VLAN_PATH_INVALID`
- `BNG_UNREACHABLE`
- `SESSION_NOT_ACTIVE`

Every public error path must map to one canonical code and deterministic HTTP status.

## 11. Versioning and Compatibility

Rules:
- breaking contract changes require explicit versioning strategy
- docs and contract tests update in same change

## 12. Contract Testing Requirements

Must be validated by automated tests:
- endpoint existence and method correctness
- payload shape and error envelope
- websocket event names/payloads/order
- gap/reconnect recovery behavior

## 13. Cross-Document Contract

- `05_realtime_and_ui_model.md`: realtime consumption model
- `08_ports.md`: ports semantics
- `10_interfaces_and_addresses.md`: interface/address model
- `11_traffic_engine_and_congestion.md`: metrics and congestion behaviors
- `15_subscriber_IPAM_Services_BNG.md`: subscriber session/forensics planned contracts
- `12_testing_and_performance_harness.md`: contract test strategy

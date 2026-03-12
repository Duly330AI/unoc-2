# 08. Ports and Interface Summaries

This document defines the authoritative ports summary contract, occupancy semantics, and UI consumption model.

Stack context:
- Backend: Node.js + Express + Prisma + Socket.io
- Frontend: React + TypeScript + React Flow

## 1. Scope

Goals:
- stable and deterministic ports summary contract
- clear used/total semantics per role
- cache-safe behavior under polling and topology mutations

Non-goal:
- full per-interface CRUD lifecycle

## 2. Canonical Roles

Summary roles:
- `PON`
- `ACCESS`
- `UPLINK`
- `MANAGEMENT`

Role mapping note:
- interface/database enum may use `MGMT`; ports summary payload maps this canonically to `MANAGEMENT`.

Optional/extended roles may exist in runtime (`TRUNK`, etc.) and must follow the same summary shape.

## 3. API Contracts

## 3.1 `GET /api/ports/summary/:device_id`

Purpose:
- return aggregated port usage for one device

Canonical response:

```json
{
  "device_id": "...",
  "total": 0,
  "by_role": {
    "PON": { "total": 0, "used": 0, "max_subscribers": 64 },
    "ACCESS": { "total": 0, "used": 0 },
    "UPLINK": { "total": 0, "used": 0 },
    "MANAGEMENT": { "total": 1, "used": 1 }
  }
}
```

Semantics:
- response is aggregate-by-role, not per-interface list
- missing role keys may be omitted or returned with zero values by implementation policy

## 3.2 `GET /api/ports/ont-list/:device_id`

Purpose:
- compact ONT-family list for container/cockpit drill-downs

Item fields:
- `id`
- `name`
- `type` (`ONT | BUSINESS_ONT | AON_CPE`)
Semantics:
- items are derived from ONT-family devices that resolve a serving OLT through the passive inline chain (not just direct links).

## 3.3 Bulk Variant

`GET /api/ports/summary?ids=...`
- returns mapping `by_device_id: { [device_id]: summary-object }`
- compatibility alias `items: Summary[]` may be included
- repeated `ids` (`?ids=a&ids=b`) and comma-separated (`?ids=a,b`) are both supported
- unknown IDs are skipped; `requested` and `returned` counts indicate omissions

## 4. Occupancy Rules (Normative)

- `ACCESS`/`UPLINK`: `used` = number of interfaces of that role that are endpoints of at least one link
- `PON` (on OLT): `used` = number of provisioned ONT-family devices that resolve optical path to this OLT (aggregated across PON ports in current model)
- `MANAGEMENT`: `used = 1` if mgmt interface exists, else `0`

Important note:
- Current model is OLT-level PON usage aggregation; per-PON-interface occupancy is a future extension unless explicitly implemented.

## 5. OLT-Level GPON Interplay

In current OLT-level GPON mode:
- OLT<->ONT direct links are invalid
- OLT segment identity is OLT-based (`segmentId = oltId`)
- PON occupancy reflects ONT membership on the OLT segment budget, not raw direct link count

Deferred note:
- per-ODF/per-PON segment decomposition is a future extension and not part of current occupancy semantics.

## 6. Capacity Semantics

- `PON.max_subscribers` derives from port/profile capabilities (e.g. hardware catalog model attributes)
- non-PON role capacities are optional and may come from interface/model metadata
- unknown capacity remains explicit (`null` or omitted), never guessed client-side
- MVP fallback: if no profile/capability is available, `PON.max_subscribers` defaults to 64 (explicitly encoded server-side).

## 7. Caching, Invalidation, Rate Control

Caching baseline:
- in-memory key `(topology_version, device_id)`
- short TTL
- per-key lock to avoid dogpile recompute
 - cache is bypassed on topology version changes; identical topology versions may reuse cached summaries

Invalidation:
- topology/version bumps invalidate prior cache keys
- optical/path-dependent usage recomputes against latest topology state

Rate control:
- endpoint throttling with deterministic `429` behavior
- bulk summary preferred for multi-device polling
- `Retry-After` header returns cooldown seconds on 429
- cache hits bypass rate limiting; rate limiting applies only when a compute is required

## 8. UI Consumption Rules

- details panels and cockpit badges consume aggregate-by-role summary
- per-interface rendering (if needed) uses dedicated interfaces endpoints, not summary contract
- splitter-specific badges come from splitter parameters contract

## 9. Error Semantics

- unknown `device_id` -> `404`
- invalid query shape -> deterministic `4xx` with canonical code

## 10. Testing Baseline

Backend:
- role-accurate used-count assertions
- OLT PON aggregation assertions
- management used flag assertions
- cache invalidation and bulk determinism

Frontend:
- role-badge rendering from `by_role`
- graceful missing-role handling
- polling suspend/resume and `429` handling

## 11. Future Extensions

- optional per-port occupancy endpoint for matrix-level detail
- role-level traffic overlays (`rx/tx`) in summary
- ETag/version-aware polling optimizations

## 12. Cross-Document Contract

- `05_realtime_and_ui_model.md`
- `09_cockpit_nodes.md`
- `10_interfaces_and_addresses.md`
- `11_traffic_engine_and_congestion.md`
- `13_api_reference.md`

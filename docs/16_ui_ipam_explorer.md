# 16. UI IPAM Explorer (Pools, Prefixes, Allocations)

Normative language:
- `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `MAY` are interpreted as binding requirement keywords.
- If this document and a non-canonical note conflict, this document's normative statements take precedence.

## 1. Scope

This document defines the UI contract for IPAM operator views:
- pool and prefix inventory,
- allocation drill-down,
- deterministic search/filter behavior,
- reconciliation with backend snapshot/delta flows.

Out of scope:
- subscriber-session lifecycle UX (see `15_subscriber_IPAM_Services_BNG.md`),
- packet-level traffic or QoS simulation views.

## 2. Screens and Navigation

Required views:
1. `IPAM Overview`
2. `Pool Detail`
3. `Allocation Explorer`

Navigation contract:
- The IPAM tab MUST be reachable from the main cockpit workspace without leaving topology context.
- Deep links SHOULD support opening a specific pool by `pool_key`.

## 3. IPAM Overview

Data sources:
- `GET /api/ipam/prefixes`
- `GET /api/ipam/pools`

Required columns:
- `pool_key`
- `canonical_name`
- `vrf`
- `cidr`
- `allocated_count`
- `capacity`
- `utilization_percent`
- `status` (derived warning state)

Derived warning state:
- `OK` when utilization `< 80%`
- `WARNING` when `>= 80% and < 95%`
- `CRITICAL` when `>= 95%`

Rules:
- Sorting MUST be deterministic (default: `pool_key` ascending).
- Missing values MUST render as neutral placeholder and not crash table rendering.

## 4. Pool Detail

Pool detail MUST show:
- pool metadata (`pool_key`, `vrf`, `cidr`, purpose),
- utilization timeline summary (if metrics exist),
- deterministic list of allocations.

Allocation list required fields:
- `allocation_id`
- `ip`
- `prefix_len`
- `entity_type` (`device`, `interface`, `session`, `cgnat_mapping`)
- `entity_id`
- `created_at`

Filtering:
- exact IP search,
- entity-id search,
- entity-type filter,
- time range filter (if timestamps exist).

## 5. Allocation Explorer

Purpose:
- operator can answer: "who owns this address now?" deterministically.

Lookup contract:
- input supports single IP string.
- result MUST return either:
  - a single current owner binding, or
  - explicit `NOT_ALLOCATED`.

For overlapping VRFs:
- result MUST include `vrf` to avoid ambiguous display.

## 6. Realtime and Consistency

Rules:
- UI MAY apply optimistic local filters, but source data remains backend-authoritative.
- On topology/version gap, UI MUST re-fetch IPAM datasets before rendering stale rows.
- Coalesced updates MUST preserve stable row identity by canonical IDs.

## 7. Large-Topology and Performance

Minimum requirements:
- table virtualization for allocation lists with large row counts,
- debounced search input,
- server-side pagination support when payload size exceeds local policy.

Recommended thresholds:
- switch to paged mode at `>= 5,000` allocation rows.

## 8. Errors and Empty States

Errors:
- backend/network error -> retry panel + last successful snapshot timestamp.
- unknown code -> generic deterministic fallback message with error code echo.

Empty states:
- no pools -> explicit onboarding hint.
- no allocations in pool -> neutral empty state.

## 9. Accessibility

- keyboard-only navigation across tables and filters,
- ARIA labels for pool utilization and warning badges,
- status information MUST NOT rely on color alone.

## 10. Cross-Document Contract

- `03_ipam_and_status.md`
- `05_realtime_and_ui_model.md`
- `12_testing_and_performance_harness.md`
- `13_api_reference.md`
- `15_subscriber_IPAM_Services_BNG.md`

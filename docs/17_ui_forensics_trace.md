# 17. UI Forensics Trace (CGNAT to Subscriber Resolution)

Normative language:
- `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `MAY` are interpreted as binding requirement keywords.
- If this document and a non-canonical note conflict, this document's normative statements take precedence.

## 1. Scope

This document defines the UI contract for forensic trace workflows based on:
- `GET /api/forensics/trace`
- subscriber/session metadata from phase-5 contracts.

Goal:
- deterministic operator workflow from `public_ip + port + timestamp` to session/device/topology context.

## 2. Trace Screen Layout

Required sections:
1. `Query Form`
2. `Trace Result Summary`
3. `Mapping and Session Detail`
4. `Topology Context`
5. `Audit Metadata`

## 3. Query Form Contract

Inputs:
- `public_ip` (required)
- `port` (required, integer)
- `timestamp` (required, UTC ISO-8601)

Validation:
- input validation MUST run client-side before request submit.
- backend validation remains authoritative; UI MUST render backend code/message.

Submit behavior:
- exactly one active query execution per form instance,
- repeated submit with unchanged payload MAY be de-duplicated locally.

## 4. Result Contract

The result view MUST include:
- resolved mapping (`mapping_id`, private/public tuple, port range),
- resolved session (`session_id`, state, service_type),
- resolved device (`device_id`, type, `infra_status`, `service_status`),
- topology anchors (`olt_id`, `bng_id`, `pop_id` when present).

Determinism rules:
- result sections MUST keep stable order across identical responses.
- IDs and timestamps MUST be shown as copyable text.

## 5. Not Found and Ambiguity Handling

If no mapping matches query:
- render explicit `TRACE_NOT_FOUND` state (not generic empty table).

If multiple matches are possible (migration/overlap windows):
- UI MUST show deterministic tie-break order from backend response,
- UI MUST display all candidate rows with clear ranking/priority index.

## 6. Operational Actions

Supported actions:
- copy trace bundle as JSON,
- open related device in topology view,
- open related session in subscriber panel (if enabled),
- export immutable trace report for audit.

Action safety:
- actions MUST NOT mutate runtime state.

## 7. Realtime and Snapshot Behavior

Rules:
- Trace result is point-in-time and MUST remain immutable in current view.
- Live deltas MAY update side badges (current status), but original query result MUST be preserved.
- user can request explicit "refresh-now" to resolve current-state trace again.

## 8. Performance and Scale

Requirements:
- query response rendering MUST remain responsive for payloads with nested references.
- optional secondary lists (candidate mappings/session history) SHOULD use virtualization at high row counts.

## 9. Security and Access Considerations

UI constraints:
- trace queries SHOULD be role-gated in production deployments.
- result exports MUST include query timestamp and requesting operator context fields when available.

## 10. Testing Contract

Minimum tests:
- valid trace query -> deterministic render path.
- not-found query -> explicit `TRACE_NOT_FOUND` state.
- malformed query -> stable field-level validation.
- copy/export actions include expected deterministic references.

## 11. Cross-Document Contract

- `05_realtime_and_ui_model.md`
- `12_testing_and_performance_harness.md`
- `13_api_reference.md`
- `14_commands_playbook.md`
- `15_subscriber_IPAM_Services_BNG.md`

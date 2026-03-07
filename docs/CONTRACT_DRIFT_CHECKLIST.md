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
- `fiberType`/`fiberLength` are documented only as compatibility aliases where needed.
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
- Cross-links in `ARCHITECTURE.md`, `ROADMAP.md`, and command/test docs are valid.
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

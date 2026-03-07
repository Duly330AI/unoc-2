# Doc Versioning Policy

Normative language:
- `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `MAY` are interpreted as binding requirement keywords.
- If this policy conflicts with non-canonical notes, this policy takes precedence.

## 1. Scope

This policy defines how documentation versions, snapshots, and authority boundaries are handled in UNOC v3.

## 2. Authority Hierarchy

Canonical source-of-truth:
1. `docs/ROADMAP_V2.md` (operational implementation source-of-truth)
2. active numbered specs in `docs/01...18`
3. `docs/ARCHITECTURE.md` for high-level structure

Non-canonical/archived inputs:
- `MASTER_SPEC_UNOC_LITE.md` is archived legacy context only.
- Build prompts or tool-specific prompt files are implementation aids and MUST NOT override canonical contracts.

## 3. Snapshot Dating Rules

- `Implementation Snapshot (YYYY-MM-DD)` MUST reflect an actual snapshot date in ISO format.
- Snapshot sections are descriptive runtime reality, not normative target requirements.
- Normative requirements MUST be placed in dedicated contract sections, not in snapshot bullets.

## 4. Contract Change Rules

When changing contract behavior:
- update the relevant canonical spec(s),
- update `ROADMAP_V2.md` task linkage/status where required,
- update cross-document references if file names/paths change,
- keep checklist integrity in `docs/CONTRACT_DRIFT_CHECKLIST.md`.

## 5. Naming and Version Consistency

- Machine-readable enums SHOULD use canonical formats defined by the active domain specs.
- Human-readable labels MAY differ in UI text if mapping is explicit.
- Units (`mbps`, `gbps`, `dB`, `dB/km`) MUST remain explicit and conversion rules documented where mixed.

## 6. File Lifecycle

- Active specs belong in `docs/` with stable, traceable naming.
- Legacy documents SHOULD be marked clearly as archived.
- Renames/migrations MUST include reference updates in checklist/roadmap/architecture docs.

## 7. Merge Gate

Documentation PRs SHOULD pass:
- contract drift checklist review,
- `npm run lint`,
- `npm test`,
- `npm run build`.

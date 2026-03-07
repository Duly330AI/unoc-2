# GEMINI_BUILD_PROMPT.md

Instruction:
Build and evolve the project using `docs/ARCHITECTURE.md` + `docs/01_overview_and_domain_model.md` through `docs/14_commands_playbook.md` + `docs/ROADMAP.md` as the authoritative source.

Rules:
- Do not treat `MASTER_SPEC_UNOC_LITE.md` as primary source-of-truth.
- Backend remains authoritative for topology, status, optical and metrics state.
- Realtime contracts must follow documented API/event contracts.
- Keep changes deterministic, testable, and aligned with roadmap tasks.
- Prefer incremental implementation with passing `lint/test/build` gates.

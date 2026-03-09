# 14. Commands Playbook

This playbook lists operational commands for setup, development, testing, quality checks, and performance runs.

Normative interpretation for requirement keywords in this document follows `docs/DOC_VERSIONING_POLICY.md`.

Stack context:
- Node.js + TypeScript (`tsx`)
- Express + Prisma
- Vite client build pipeline

## 1. Prerequisites

Required locally:
- Node.js (project-compatible modern LTS)
- npm
- SQLite for local DB file workflows (or configured external DB)

Optional for perf load tests:
- network access for `npx artillery run perf/load-test.yml`

## 2. Environment Setup

## 2.1 Install Dependencies

```bash
npm install
```

## 2.2 Environment Variables

Create `.env` (for example from `.env.example`) and define at minimum:
- `DATABASE_URL`

Optional/feature-specific:
- `GEMINI_API_KEY`
- `APP_URL`
- simulation/perf flags as required by runtime

WSL/SQLite warning:
- If you run this repo inside WSL, DO NOT keep the working copy under `/mnt/c/...` when using the default SQLite dev database.
- Use the native Linux filesystem instead, for example `~/projects/unoc`.
- SQLite on mounted Windows filesystems is significantly more likely to hit lock errors or corruption after abrupt shutdowns or concurrent dev tooling.

## 2.3 Prisma Bootstrap

```bash
npx prisma generate
npx prisma db push
```

Runtime note:
- The server enables SQLite WAL mode automatically at startup for `file:` databases.
- This improves local read/write concurrency, but it does not eliminate the filesystem risk of running SQLite on `/mnt/c/...` in WSL.

Optional DB inspection:

```bash
npx prisma studio
```

## 3. Development Commands

## 3.1 Run App in Development Mode

```bash
npm run dev
```

Current script:
- `node --import tsx server.ts`

Behavior:
- starts backend runtime and serves frontend through configured dev integration
- default local URL is `http://localhost:3000`

## 3.2 Clean Build Artifacts

```bash
npm run clean
```

## 4. Test and Quality Commands

## 4.1 Run Full Test Suite

```bash
npm test
```

## 4.2 Run Smoke Tests Only

```bash
npm run test:smoke
```

## 4.3 Type/Lint Check

```bash
npm run lint
```

## 4.4 Production Build

```bash
npm run build
```

## 4.5 Preview Built Client

```bash
npm run preview
```

## 5. Performance Harness Commands

## 5.1 Seed Benchmark Dataset

```bash
npm run perf:seed
```

Current script target:
- `tsx server/scripts/perf-seed.ts`

## 5.2 Execute Load Scenario

```bash
npm run perf:load
```

Current script target:
- `artillery run perf/load-test.yml`

## 6. Recommended Local Run Order

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Recommended after an unclean shutdown or malformed local SQLite state:

```bash
rm -f dev.db dev.db-shm dev.db-wal prisma/dev.db prisma/dev.db-shm prisma/dev.db-wal
npx prisma generate
npx prisma db push
npm run dev
```

Notes:
- keep only the DB file family that matches your configured `DATABASE_URL`
- if the repo lives under `/mnt/c/...` in WSL, move it to the native Linux filesystem before trusting repeated SQLite runs
- do not run the dev server and ad-hoc destructive DB cleanup against the same SQLite file concurrently

Before merge/release checks:

```bash
npm run lint
npm test
npm run build
```

## 7. Troubleshooting Quick Notes

- Prisma/client mismatch after dependency updates:
  - rerun `npx prisma generate`
- DB schema drift in local dev:
  - rerun `npx prisma db push` on intended target DB
- SQLite reports `database disk image is malformed`:
  - stop the dev server
  - delete the affected SQLite file family (`dev.db`, `dev.db-wal`, `dev.db-shm`)
  - rerun `npx prisma generate && npx prisma db push`
  - if this repeats under WSL, move the repo out of `/mnt/c/...`
- Perf load command fails:
  - verify network access for `npx`
  - verify `perf/load-test.yml` presence

## 8. CI Mapping

Minimum CI gates map to:
- `npm run lint`
- `npm test`
- `npm run build`

Performance scripts are optional in baseline CI and can run in dedicated perf profiles.

Current command-to-gate mapping:

| Command | Purpose | Gate Level |
| --- | --- | --- |
| `npm run lint` | TypeScript compile/type gate | mandatory baseline |
| `npm test` | API, simulation, and realtime regression gate | mandatory baseline |
| `npm run build` | frontend production build gate | mandatory baseline |
| `npm run perf:seed` | deterministic perf dataset generation | optional perf profile |
| `npm run perf:load` | load harness against running backend | optional perf profile |

## 9. Cross-Document Contract

- `12_testing_and_performance_harness.md`: quality/perf strategy and gates
- `13_api_reference.md`: API surface validated by tests and load scenarios
- `ARCHITECTURE.md`: component/service context for commands
- `CONTRACT_DRIFT_CHECKLIST.md`: pre-merge checklist for contract consistency

## 10. Subscriber Trace Commands (Planned)

Operational trace workflows for virtual terminals/ops consoles:

Precondition:
- The commands below are limited to the currently implemented subscriber/session surface.

```bash
# Trace CGNAT/public endpoint back to subscriber/session context
curl "/api/forensics/trace?ip=198.51.100.5&port=5000&ts=2026-03-07T12:00:00Z"
```

```bash
# Inspect active sessions on one access device
curl "/api/sessions?device_id=<ONT_OR_CPE_ID>"
```

```bash
# Create or update session state in simulation workflows
curl -X POST "/api/sessions" -H "Content-Type: application/json" -d '{...}'
curl -X PATCH "/api/sessions/<SESSION_ID>" -H "Content-Type: application/json" -d '{"state":"RELEASED"}'
```

Current limitation:
- VLAN path validation is enforced inline during session activation; there is currently no dedicated `POST /api/sessions/validate-vlan-path` endpoint.
- Session teardown currently uses `PATCH /api/sessions/:id` to transition state; there is no `DELETE /api/sessions/:id` route.

Traceability note:
- all trace outputs should include deterministic references to session, mapping, tariff, and topology anchors (OLT/BNG/POP).

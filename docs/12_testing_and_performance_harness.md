# 12. Testing & Performance Harness

This document describes the currently implemented testing baseline and planned performance tooling.

## 1. Testing Strategy (Current)

### 1.1 API Smoke Tests
- Tool: `node:test` + `supertest`
- Scope: Core backend flow (`POST /api/devices`, `POST /api/links`, `GET /api/topology`)
- Location: `test/api.smoke.test.ts`
- Database: Isolated SQLite test file (`prisma/test.db`) created for test run

### 1.2 Simulation Unit Test
- Tool: `node:test`
- Scope: Basic simulation correctness for ONU status and Rx power update
- Location: `test/simulation.test.ts`

## 2. Performance Harness (Planned)

The architecture targets larger topologies (multi-thousand nodes), but load harnessing is currently a planned track.

### 2.1 Seed Script
- Script entry exists: `npm run perf:seed`
- Current status: script path is reserved, implementation to be completed.

### 2.2 Load Test
- Script entry exists: `npm run perf:load`
- Current status: load scenario files are planned.

## 3. CI Baseline

Current minimum CI gates:
1. `npm run lint`
2. `npm test`
3. `npm run build`

## 4. Next Expansion Steps

1. Add endpoint-level negative tests (validation + 4xx cases).
2. Add WebSocket event contract tests.
3. Add reproducible performance datasets and benchmark reports.

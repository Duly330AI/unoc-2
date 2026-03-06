

# 12. Testing & Performance Harness

This document outlines the testing strategy and performance benchmarking tools for the project.

## 1. Testing Strategy

### 1.1 Unit Testing
*   **Tool:** Jest (or Vitest).
*   **Scope:** Services, Utilities, Helper functions.
*   **Mocking:** Heavy use of mocks for Database (Prisma) and External Services.
*   **Location:** `backend/src/**/*.test.ts`.

### 1.2 Integration Testing
*   **Tool:** Jest + Supertest.
*   **Scope:** API Endpoints (Controllers).
*   **Database:** Uses an in-memory SQLite database (or a Dockerized Postgres) reset between tests.
*   **Focus:** Verify HTTP status codes, payload validation, and basic data persistence.

### 1.3 End-to-End (E2E) Testing
*   **Tool:** Playwright.
*   **Scope:** Critical user flows (Provisioning a device, Creating a link).
*   **Environment:** Runs against a fully running dev environment.

## 2. Performance Harness

To ensure the system handles 10k+ devices, a performance harness is provided.

### 2.1 Load Generation Script
*   **Location:** `backend/scripts/perf-seed.ts`.
*   **Function:** Generates a synthetic topology.
    *   1 Core Router.
    *   10 OLTs.
    *   640 ONTs (64 per OLT).
    *   Randomized traffic patterns.
*   **Usage:** `npm run perf:seed`.

### 2.2 Benchmarking
*   **Tool:** Artillery (or K6).
*   **Scenarios:**
    *   **High Read:** 100 concurrent users fetching the Network Map.
    *   **High Write:** Bulk provisioning of 100 devices.
*   **Metrics:** Latency (p95, p99), Error Rate, CPU/Memory usage.

## 3. Continuous Integration (CI)
*   **Pipeline:**
    1.  Lint (`npm run lint`).
    2.  Unit/Integration Tests (`npm test`).
    3.  Build (`npm run build`).

# UNOC v3 – Architecture Overview

**Spec Revision:** Node.js/Prisma/React Refactor – 2024

This file is the **entry point** and guide to the detailed documents under `/docs/`.

---

## 🎯 Target Architecture

UNOC v3 is a **Network Emulator** and **Planning Tool** built on a modern web stack.

### Core Principles
*   **Full-Stack TypeScript:** Node.js backend, React frontend.
*   **Data-Driven:** All network state is persisted in a relational DB (Postgres/SQLite) via Prisma.
*   **Real-Time:** Changes propagate instantly via WebSockets (Socket.io).
*   **Deterministic:** Traffic generation and signal calculations are reproducible.

### Tech Stack
*   **Frontend:** React 18, Vite, Tailwind CSS, React Flow (Visualization).
*   **Backend:** Node.js, Express.js.
*   **Database:** PostgreSQL (Production), SQLite (Dev/Test).
*   **ORM:** Prisma.
*   **Real-Time:** Socket.io.

---

## 📂 Documentation Map

| Topic | File | Description |
| :--- | :--- | :--- |
| **Domain Model** | [01_overview_and_domain_model.md](./01_overview_and_domain_model.md) | Entities (Device, Link), Types, Hierarchy. |
| **Provisioning** | [02_provisioning_model.md](./02_provisioning_model.md) | Rules for connecting devices (GPON, P2P). |
| **IPAM & Status** | [03_ipam_and_status.md](./03_ipam_and_status.md) | IP Allocation, Status Propagation Logic. |
| **Signal Budget** | [04_signal_budget_and_overrides.md](./04_signal_budget_and_overrides.md) | Optical calculations (Tx/Rx/Loss). |
| **Real-Time UI** | [05_realtime_and_ui_model.md](./05_realtime_and_ui_model.md) | WebSocket events, Optimistic UI updates. |
| **Catalog & Traffic** | [06_future_extensions_and_catalog.md](./06_future_extensions_and_catalog.md) | Hardware Catalog, Traffic Generation basics. |
| **Containers** | [07_container_model_and_ui.md](./07_container_model_and_ui.md) | POPs, Racks, Nested Visualization. |
| **Ports** | [08_ports.md](./08_ports.md) | Interface modeling, Port Matrix UI. |
| **Cockpits** | [09_cockpit_nodes.md](./09_cockpit_nodes.md) | Detailed device views (SVG/React). |
| **Interfaces** | [10_interfaces_and_addresses.md](./10_interfaces_and_addresses.md) | Interface entities, MAC/IP details. |
| **Congestion** | [11_traffic_engine_and_congestion.md](./11_traffic_engine_and_congestion.md) | Congestion logic, Hysteresis, GPON segments. |
| **Testing** | [12_testing_and_performance_harness.md](./12_testing_and_performance_harness.md) | Jest, Playwright, Load Testing. |
| **API Reference** | [13_api_reference.md](./13_api_reference.md) | REST Endpoints, WebSocket Events. |
| **Commands** | [14_commands_playbook.md](./14_commands_playbook.md) | CLI commands for Dev/Build/Test. |

---

## 🏗️ Key Services (Backend)

*   **DeviceService:** CRUD for Devices, Hierarchy management.
*   **LinkService:** Link creation, validation (Provisioning Matrix).
*   **StatusService:** Propagates status changes (Admin Override -> Upstream -> Signal).
*   **OpticalService:** Calculates signal loss and budget.
*   **TrafficService:** Generates synthetic traffic and detects congestion.
*   **SocketService:** Manages WebSocket connections and event broadcasting.

## 🎨 Key Components (Frontend)

*   **TopologyMap:** Main React Flow canvas.
*   **Cockpit:** Context-aware device details panel.
*   **DeviceNode/LinkEdge:** Custom React Flow components.
*   **Store:** Zustand/Context for client-side state management.

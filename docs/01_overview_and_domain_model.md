# 1. Overview

UNOC v3 models a fiber / access network topology (FTTH) with active and passive devices, container nodes (POPs & CORE_SITE), links, and optical signal propagation. The backend (Node.js + Express + Prisma) is authoritative; the frontend (React + TypeScript + React Flow) renders and incrementally updates a visual topology.

Guiding Principles:

- API-first & type-synchronized (Prisma Schema → generated TS types).
- Deterministic operations.
- Clear separation of concerns.

### 1.1 Implementation status (Current Prototype)

This snapshot lists what’s implemented now versus planned.

- **Frontend (React + Vite):**
  - **Topology Visualization:** Implemented using React Flow. Supports drag-and-drop of devices (OLT, Splitter, ONU, Switch) and linking.
  - **State Management:** Zustand store (`client/src/store/useStore.ts`) manages nodes and edges.
  - **Simulation Loop:** A client-side simulation engine (`client/src/simulation/simulationEngine.ts`) runs periodically to calculate optical signal loss and update device status based on thresholds (e.g., -27 dBm).
  - **Sidebar:** Device palette for dragging nodes onto the canvas.

- **Backend (Node.js + Express):**
  - **API:** REST endpoints for `networks`, `devices`, and `links`.
  - **Database:** SQLite with Prisma ORM. Schema defines `Network`, `Device`, `Port`, and `Link` models.
  - **Vite Integration:** Server acts as middleware for Vite, enabling a unified dev server.

- **Planned / In Progress:**
  - **WebSocket Integration:** For real-time updates from a server-side simulation.
  - **Advanced IPAM:** Lazy allocation of management IPs.
  - **Complex Optical Pathfinding:** Server-side calculation of total path attenuation including fiber loss and connector loss.

## 2. Domain Model & Classification

### 2.1 Core Entities

- **Device:** Active (OLT, Switch, ONU) or passive (Splitter) nodes.
- **Link:** Connection between devices (fiber segments).
- **Network:** Container for a topology.
- **Port:** Interface on a device.

### 2.2 Device Classification Table

| Device Type      | Role Class        | Notes                                                       |
| ---------------- | ----------------- | ----------------------------------------------------------- |
| OLT              | active            | Optical line terminal; signal origin for ONUs               |
| Switch           | active            | Active aggregation switch                                   |
| Splitter         | passive_inline    | Optical splitter (adds attenuation, e.g., 3.5dB)            |
| ONU              | active (edge)     | Customer termination; signal path endpoint                  |

### 2.3 Optical & Signal Attributes (Light Feature)

The following domain attributes enable the signal ("Licht") simulation layer:

| Entity                  | Field               | Type                      | Default                   | Description                                                               |
| ----------------------- | ------------------- | ------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| OLT                     | tx_power_dbm        | float                     | +5.0                      | Transmit optical power launched downstream.                               |
| ONU                     | sensitivity_min_dbm | float                     | -27.0                     | Minimum receive power for valid signal (below → BROKEN).                  |
| Splitter                | insertion_loss_db   | float                     | 3.5                       | High attenuation element.                                                 |
| Link                    | length              | float                     | 1.0                       | Physical fiber length (km) used for loss computation (e.g., 0.35 dB/km).   |

**Simulation Logic (Current Client-Side):**
- The simulation engine traverses the graph from OLTs.
- It subtracts link loss (length * 0.35) and device insertion loss (Splitters).
- It calculates `received_power` at the ONU.
- If `received_power` < `sensitivity_min_dbm`, the ONU status is set to `BROKEN`. Otherwise `OK`.

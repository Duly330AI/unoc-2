# 08. Ports & Interface Summaries

This document specifies how device interfaces (ports) are modeled, summarized, and visualized.

## 1. Concepts

*   **Interface:** A physical or logical port on a device (e.g., "eth0", "pon1").
*   **Port Role:** Defines the function of the port.
    *   `PON`: Downstream port on an OLT (connects to Splitters/ONTs).
    *   `ACCESS`: Downstream port on a Switch (connects to active equipment).
    *   `UPLINK`: Upstream port (connects to Core/Backbone).
    *   `TRUNK`: Inter-switch link.
*   **Occupancy:**
    *   **PON:** Number of unique ONTs reachable downstream from this port.
    *   **Others:** 1 if linked, 0 if not.

## 2. API Contracts

### 2.1 GET /api/ports/summary/:deviceId

Returns a summary of all interfaces on a device, optimized for UI rendering (e.g., Port Matrix).

**Response:**
```json
[
  {
    "id": "uuid-if-1",
    "name": "pon1",
    "role": "PON",
    "status": "UP",
    "occupancy": 12, // 12 ONTs downstream
    "capacity": 32   // Max 32 ONTs
  },
  {
    "id": "uuid-if-2",
    "name": "eth0",
    "role": "UPLINK",
    "status": "UP",
    "occupancy": 1,
    "capacity": 1
  }
]
```

### 2.2 GET /api/ports/ont-list/:deviceId

Returns a list of ONTs associated with a container (POP/Core Site).

## 3. Backend Implementation

### 3.1 Occupancy Calculation
*   **Service:** `PortService`.
*   **PON Ports:** Requires graph traversal (BFS/DFS) starting from the PON port to find all reachable ONTs.
    *   *Optimization:* This can be expensive. Results should be cached.
*   **Other Ports:** Simple check if `Interface.linkId` is not null.

### 3.2 Caching Strategy
To avoid re-traversing the graph on every UI poll:
*   **Key:** `deviceId` + `topologyVersion`.
*   **Mechanism:** In-memory LRU cache.
*   **Invalidation:** When `topologyVersion` changes (link added/removed), the cache is implicitly invalidated (keys no longer match).

## 4. UI Visualization

### 4.1 OLT Cockpit (Port Matrix)
*   **Grid:** Renders a grid of PON ports.
*   **Color:**
    *   **Green:** Occupancy > 0, Status UP.
    *   **Red:** Status DOWN.
    *   **Gray:** Occupancy 0.
*   **Interaction:** Hovering a cell shows details (Name, Occupancy/Capacity).

### 4.2 Switch Cockpit
*   **List/Grid:** Shows Access and Uplink ports.

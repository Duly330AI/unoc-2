# 13. API Reference

This document serves as the reference for the REST API and WebSocket events.

## 1. REST API

### 1.1 Conventions
*   **Base URL:** `/api`
*   **Content-Type:** `application/json`
*   **IDs:** UUID v4.

### 1.2 Topology
*   `GET /api/topology`
    *   Returns the full graph (nodes and edges) formatted for React Flow.
    *   **Response:** `{ nodes: Node[], edges: Edge[] }`

### 1.3 Devices
*   `GET /api/devices` - List all devices (supports filtering by `type`).
*   `POST /api/devices` - Create a new device.
*   `GET /api/devices/:id` - Get device details.
*   `PATCH /api/devices/:id` - Update device (name, position, status).
*   `DELETE /api/devices/:id` - Delete device (cascades to links).

### 1.4 Links
*   `GET /api/links` - List all links.
*   `POST /api/links` - Create a link (Source -> Target).
*   `DELETE /api/links/:id` - Delete a link.

### 1.5 Ports
*   `GET /api/ports/summary/:deviceId`
    *   Returns a summary of interfaces (occupancy, status) for the Port Matrix.

### 1.6 Metrics
*   `GET /api/metrics/snapshot`
    *   Returns the current traffic metrics for all devices (used for initial load).

## 2. WebSocket Events

The backend uses Socket.io to emit real-time updates.

### 2.1 Connection
*   **Namespace:** `/` (Default).
*   **Auth:** None for MVP.

### 2.2 Server -> Client Events
*   `device:created` - Payload: `Device`.
*   `device:updated` - Payload: `Device` (partial).
*   `device:deleted` - Payload: `{ id: string }`.
*   `link:created` - Payload: `Link`.
*   `link:deleted` - Payload: `{ id: string }`.
*   `device:metrics` - Payload: `Metrics[]` (Batch update of traffic stats).
*   `device:status` - Payload: `{ id: string, status: DeviceStatus }`.

### 2.3 Client -> Server Events
*   (None for MVP - all mutations happen via REST API).

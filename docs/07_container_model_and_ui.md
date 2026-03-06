# 07. Container Model & UI

This document describes how devices are grouped into physical locations (POPs, Core Sites) and how these containers are visualized.

## 1. Data Model

Containers are simply `Devices` with specific types (`POP`, `CORE_SITE`) that can contain other devices.

### 1.1 Schema
The `Device` entity in Prisma includes a self-referencing `parentId` field.

```prisma
model Device {
  id       String  @id @default(uuid())
  type     String  // "POP", "OLT", "ONT", etc.
  parentId String? // ID of the container device
  parent   Device? @relation("DeviceToDevice", fields: [parentId], references: [id])
  children Device[] @relation("DeviceToDevice")
  // ...
}
```

### 1.2 Hierarchy Rules
1.  **Containers:** `POP` and `CORE_SITE` are top-level entities.
2.  **Children:** Active devices (`OLT`, `SWITCH`) and Passive devices (`SPLITTER`, `ODF`) can be assigned to a Container.
3.  **Nesting:** MVP restricts nesting to 1 level (Device inside Container) for UI simplicity.

## 2. UI Implementation (React Flow)

We use **React Flow's Sub-Flow / Group Node** features to visualize containers.

### 2.1 Visualization
*   **Group Nodes:** Containers are rendered as large, resizable nodes with a `zIndex` that places them behind their children.
*   **Parent-Child:** When a device is inside a container, its position is relative to the container's coordinate system.
*   **Expansion:** Containers can be collapsed (showing summary metrics) or expanded (showing internal devices).

### 2.2 Interactions
*   **Drag & Drop (Assignment):**
    *   Dragging a device *into* a container node highlights the container.
    *   Dropping it triggers a `PATCH /devices/:id` with `{ parentId: containerId }`.
    *   The UI optimistically updates the node's `parentNode` property in React Flow.
*   **Drag & Drop (Unassignment):**
    *   Dragging a device *out* of a container sets `parentId: null`.

### 2.3 Link Proxying
Links connect specific interfaces on specific devices. Purely visual containers cannot be link endpoints.

**UX Flow:**
1.  User starts a link from an external device.
2.  User clicks on a **Container**.
3.  **Modal Opens:** "Select Target Device in [Container Name]".
4.  User selects an internal device (e.g., "OLT-01").
5.  **Link Created:** The link is created between the external device and "OLT-01".
6.  **Visuals:** The edge is drawn to the specific child node inside the container.

## 3. Aggregated Metrics

Containers display summary health and capacity data derived from their children.

### 3.1 Health Status
*   **DOWN:** If *any* critical child (OLT, Switch) is DOWN.
*   **DEGRADED:** If any child is DEGRADED or a non-critical child is DOWN.
*   **UP:** All children are UP.

### 3.2 Capacity
*   **Ports Used:** Sum of used ports on all child devices.
*   **Total Ports:** Sum of total ports on all child devices.

## 4. API Interactions

*   **Move Device:**
    *   `PATCH /devices/:id` -> `{ "parentId": "uuid-pop-1" }`
*   **Get Container Details:**
    *   `GET /devices/:id?include=children` (Prisma `include` syntax).

## 5. Validation

The backend enforces:
*   **Type Rules:** An `OLT` can go into a `POP`, but a `POP` cannot go into an `OLT`.
*   **Cycles:** A container cannot contain itself.

# 04. Links & Batch Operations

This document describes the Link model, topology rules, and batch processing capabilities in the Node.js backend.

## 1. Link Model

Links represent physical connections (Fiber, Ethernet) between devices.

### 1.1 Data Structure

In the Prisma schema, a `Link` connects two `Ports` (or `Interfaces`).

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Unique identifier. |
| `sourceId` | UUID | ID of the source Port/Interface. |
| `targetId` | UUID | ID of the target Port/Interface. |
| `type` | Enum | `GPON`, `ETHERNET`, `P2P`. |
| `distance` | Float | Length in kilometers (affects optical loss). |
| `status` | Enum | `UP`, `DOWN`, `DEGRADED`. |
| `attributes` | JSON | Metadata (e.g., fiber strand ID, color). |

### 1.2 Topology Rules

The `LinkService` enforces these rules during creation:

1.  **No Self-Loops:** Source and Target must be different.
2.  **Port Uniqueness:** A physical port can typically hold only one link (unless it's a logical interface).
3.  **Type Compatibility:**
    *   `OLT` (PON Port) <-> `Splitter` (In Port)
    *   `Splitter` (Out Port) <-> `ONU` (PON Port)
    *   `Supernode` <-> `OLT` (Uplink)

## 2. CRUD Operations

Standard REST endpoints manage links.

*   `GET /api/links` - List all links (supports filtering by device).
*   `POST /api/links` - Create a single link.
*   `DELETE /api/links/:id` - Remove a link.
*   `PATCH /api/links/:id` - Update attributes (e.g., distance).

## 3. Batch Operations

To support bulk actions (e.g., importing a topology or connecting a 64-port OLT), the API supports batch operations.

### 3.1 Batch Create

**Endpoint:** `POST /api/links/batch`

**Logic:**
The backend uses a Prisma transaction (`$transaction`) to ensure atomicity. Either all links are created, or none are (to prevent partial topology states).

```typescript
// Pseudo-code for Batch Create
async createBatch(links: CreateLinkDto[]) {
  return await prisma.$transaction(async (tx) => {
    const results = [];
    for (const link of links) {
      // Validate ports exist and are free
      await validateLink(tx, link);
      const created = await tx.link.create({ data: link });
      results.push(created);
    }
    return results;
  });
}
```

**Request Body:**
```json
{
  "links": [
    { "sourceId": "uuid-1", "targetId": "uuid-2", "type": "GPON" },
    { "sourceId": "uuid-3", "targetId": "uuid-4", "type": "GPON" }
  ]
}
```

### 3.2 Batch Delete

**Endpoint:** `POST /api/links/batch/delete`

**Request Body:**
```json
{
  "ids": ["uuid-link-1", "uuid-link-2"]
}
```

## 4. Performance & Scalability

*   **Node.js Event Loop:** Handles concurrent requests efficiently.
*   **Prisma:** `createMany` is used where possible for raw inserts, but `$transaction` with individual validation is preferred for topology integrity.
*   **Scale:** The current SQLite/Postgres setup easily handles thousands of links. For millions, we would introduce read replicas and sharding (not in MVP scope).

## 5. Events

Link changes emit WebSocket events to update the client-side graph:

*   `link:created`
*   `link:deleted`
*   `link:updated`

These events trigger a "Graph Refresh" on the frontend, causing React Flow to re-render the edges.

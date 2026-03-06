# 03. IPAM & Status Logic

This document details the IP Address Management (IPAM) strategy and the Device Status propagation logic for the Fiber Monitor application.

## 1. IP Address Management (IPAM)

The IPAM system is designed to be "lazy" and "just-in-time". IP addresses are allocated only when a device is provisioned.

### 1.1 IP Pools

We define logical IP pools based on device roles. These are currently managed via a simple allocation strategy in the `IpamService`.

| Pool Name | CIDR | Device Types | Purpose |
| :--- | :--- | :--- | :--- |
| **Core Mgmt** | `10.250.0.0/24` | Supernode, Router | Infrastructure management. |
| **OLT Mgmt** | `10.250.4.0/24` | OLT | OLT management interfaces. |
| **AON Mgmt** | `10.250.2.0/24` | Switch | Active Ethernet switch management. |
| **ONU Mgmt** | `10.250.1.0/24` | ONU | Customer premise equipment. |

### 1.2 Allocation Strategy (Node.js Implementation)

The `IpamService` uses a "Next Available" algorithm backed by the database:

1.  **Identify Pool:** Determine the correct pool based on the device type.
2.  **Fetch Used IPs:** Query the `Device` table for all `ipAddress` values currently assigned within that pool's range.
3.  **Find Gap:** Iterate through the subnet (e.g., .1 to .254) and return the first address not in the "Used" list.
4.  **Concurrency:** Uses a database transaction or optimistic locking to prevent double assignment.

```typescript
// Pseudo-code for IpamService
async allocateIp(type: DeviceType): Promise<string> {
  const pool = getPoolForType(type); // e.g., '10.250.1.0/24'
  const usedIps = await prisma.device.findMany({
    where: { type, ipAddress: { startsWith: pool.prefix } },
    select: { ipAddress: true }
  });
  
  return findFirstFreeIp(pool, usedIps);
}
```

## 2. Device Status Model

Device status reflects the operational state of the network. It is a combination of administrative state (Provisioned/Draft) and operational state (Online/Offline).

### 2.1 Status Enum

The `DeviceStatus` enum (or equivalent string union) tracks these states:

*   `DRAFT`: Created but not yet active.
*   `PROVISIONED`: Configured and logically active.
*   `ONLINE`: Operational and reachable (heartbeat/signal OK).
*   `OFFLINE`: Unreachable or signal lost.
*   `ERROR`: Configuration or hardware failure.

### 2.2 Status Propagation Logic

Status propagation is a critical feature. A failure in an upstream device (e.g., OLT) must propagate "Down" status to all downstream devices (ONUs).

**Propagation Rules:**

1.  **Root Cause:** If a device goes `OFFLINE` (e.g., OLT power loss), it is the root cause.
2.  **Cascade:** All devices that depend *exclusively* on that root device for connectivity must also transition to `OFFLINE` (or a specific `UNREACHABLE` state).
3.  **Recovery:** When the root device recovers (`ONLINE`), downstream devices re-evaluate their status.

### 2.3 Implementation (StatusService)

The `StatusService` runs in the Node.js backend. It can be triggered by:
*   **Events:** A device status change event (e.g., from a heartbeat monitor or manual toggle).
*   **Schedule:** A periodic "health check" job.

**Algorithm:**

1.  **Trigger:** Device A changes status to `OFFLINE`.
2.  **Traverse:** Perform a BFS/DFS downstream from Device A using the `Link` table.
3.  **Update:** For each visited node (Device B, C...), update their status to `OFFLINE` (unless they have a redundant path, which is rare in PON).
4.  **Notify:** Emit WebSocket events to the frontend to update the graph visualization immediately.

```typescript
// Pseudo-code for Status Propagation
async propagateStatus(rootDeviceId: string, newStatus: DeviceStatus) {
  // 1. Update Root
  await updateDeviceStatus(rootDeviceId, newStatus);

  // 2. Find Downstream
  const downstreamDevices = await graphService.getDescendants(rootDeviceId);

  // 3. Update Downstream
  for (const device of downstreamDevices) {
    await updateDeviceStatus(device.id, newStatus === 'ONLINE' ? 'ONLINE' : 'OFFLINE');
  }
  
  // 4. Emit Event
  io.emit('status:update', { rootId: rootDeviceId, affected: downstreamDevices.length });
}
```

## 3. Optical Signal Status (Simplified)

In addition to logical connectivity, PON networks rely on optical power levels.

*   **OLT:** Has a `tx_power` (e.g., +3 dBm).
*   **Splitter:** Has an `insertion_loss` (e.g., -3.5 dB for 1:2, -7.0 dB for 1:4).
*   **Fiber:** Has loss per km (e.g., 0.35 dB/km).
*   **ONU:** Receives the signal. `rx_power = tx_power - sum(losses)`.

**Status Rule:**
*   If `rx_power` < `sensitivity_threshold` (e.g., -28 dBm), the ONU status is `OFFLINE` (Signal Low).

This calculation is currently performed:
1.  **Frontend:** For immediate feedback during drag-and-drop.
2.  **Backend:** Planned for authoritative validation.

## 4. API Endpoints

### IPAM
*   `GET /api/ipam/pools` - List available pools and utilization.

### Status
*   `GET /api/devices/:id/status` - Get current detailed status (including signal levels).
*   `POST /api/devices/:id/status` - Manually force a status (for testing/simulation).

# 12. Subscriber IPAM, Services, and BNG Abstraction

## Implementation Snapshot (2026-03-07)

Current runtime baseline:
- The active runtime primarily covers infrastructure management IPAM and aggregated traffic simulation.
- First-class subscriber session objects, CGNAT mappings, and service VLAN validation are not yet fully implemented in runtime APIs.

Status of this document:
- This document is normative design input for the next implementation phase (Subscriber Services Layer).
- It intentionally extends current scope and must be tracked via dedicated roadmap tasks before claiming runtime parity.

## 1. GAP Analysis & Motivation

**Current State (UNOC v3 Baseline):**
The current architecture models **Management IPAM** (assigning IPs to OLTs, ONTs, and Routers for infrastructure management) and calculates **aggregated bandwidth utilization** (Traffic Engine).

**The Gap:**
A realistic ISP access network requires a consistent IP hierarchy from the end-customer (Subscriber) up to the Core/Backbone. Without Subscriber IPAM, DHCP, PPPoE, CGNAT, Service VLANs, and VRFs, a device cannot be considered truly "online" in a service provider context. An ONT without a subscriber IP or active DHCP lease is offline for the customer, even if its management interface is UP.

**Target State:**
To close this gap before the architecture solidifies, we must introduce a **Subscriber Services Layer** that models:
1.  **BNG Topology:** Explicitly modeling the Broadband Network Gateway (BNG) role on Edge Routers, including redundancy and regional anchoring.
2.  **Core/Edge Router VRFs:** Separation of `mgmt` VRF and `subscriber` VRFs, including support for overlapping IP pools across different regions/VRFs.
3.  **Subscriber IP Pools:** IPv4, IPv6 Prefix Delegation (IPv6-PD), and CGNAT pools with strict hierarchical assignment (Region → POP → BNG).
4.  **Service VLANs:** Modeling of Internet, IPTV, and Voice services with Trunking/Tagging (S-Tag/C-Tag) and strict path validation.
5.  **DHCP/PPPoE Sessions:** Tracking active leases and sessions bound to specific ONT/CPE ports, including full lifecycle (Renewal, Rebind, Timeout).
6.  **CGNAT Abstraction:** Modeling CGNAT pools, mappings, and retention metadata for forensic correlation, directly linked to sessions.

---

## 2. BNG Topology & Subscriber IPAM

### 2.1 BNG Role & Topology Anchoring
The BNG is not a new physical device type, but a **Role** assigned to an `EDGE_ROUTER`.
*   **Anchoring:** A BNG serves a specific `POP` or `CORE_SITE`.
*   **Redundancy:** Two Edge Routers in the same POP can share a BNG cluster ID (Active/Standby or Active/Active via VRRP/MC-LAG abstraction).

### 2.2 VRF Separation & Overlapping Pools
Routers must support multiple VRFs to isolate traffic and allow overlapping IP spaces (e.g., `10.0.0.0/16` used in Region A and Region B simultaneously).
*   `mgmt_vrf`: Exclusively for infrastructure management.
*   `internet_vrf`: Public internet routing table.
*   `iptv_vrf` / `voice_vrf`: Dedicated routing tables.

### 2.3 Subscriber IP Pools (Hierarchical)
Pools are defined strictly per BNG to prevent accidental cross-usage.

```json
{
  "pool_id": "pool_sub_v4_region1_bng1",
  "type": "SUBSCRIBER_IPV4",
  "cidr": "100.64.0.0/16",
  "vrf": "internet_vrf",
  "bng_cluster_id": "bng_cluster_frankfurt_01",
  "allocation_strategy": {
    "type": "DHCP",
    "lease_time_seconds": 86400,
    "reuse_policy": "STICKY_MAC" // or DYNAMIC_ROUND_ROBIN
  }
}
```

---

## 3. Service VLAN Model & Path Validation

To transport subscriber traffic to the BNG, the access network uses VLANs. **Crucially, a session can only establish if the VLAN path is physically and logically valid.**

### 3.1 VLAN Domains & Profiles
VLANs are scoped per OLT or per POP (VLAN Domain). `VLAN 100` on POP A is isolated from `VLAN 100` on POP B.

### 3.2 Port Binding & Strict Validation
Service VLANs are bound to the **Access Ports** of the ONT/CPE.

```json
{
  "device_id": "ont_123",
  "port_number": 1,
  "port_type": "LAN",
  "services": [
    { "type": "INTERNET", "c_tag": 100, "s_tag": 1010 },
    { "type": "IPTV", "c_tag": 200, "s_tag": 1010 }
  ]
}
```
**Validation Rule:** Before a session is created, the system verifies:
`ONT (C-Tag 100) -> OLT (pushes S-Tag 1010) -> Trunk Link -> BNG (terminates S-Tag 1010)`. If this path is broken or misconfigured, the session request is rejected.

---

## 4. DHCP & PPPoE Session Lifecycle

An ONT/CPE is only fully "UP" for the customer if a session is established.

### 4.1 Session Object & Multi-Session Support
A single ONT can host multiple sessions (e.g., Bridge-Mode with multiple CPEs behind it).

```json
{
  "session_id": "sess_98765",
  "device_id": "ont_123",
  "port_number": 1,
  "protocol": "DHCP",
  "mac_address": "00:1A:2B:3C:4D:5E",
  "ipv4_address": "100.64.1.50",
  "ipv6_pd": "2001:db8:1000:1a00::/56",
  "state": "ACTIVE", // INIT, ACTIVE, EXPIRED, RELEASED
  "lease_start": "2026-03-07T08:00:00Z",
  "lease_expires": "2026-03-08T08:00:00Z",
  "bng_device_id": "edge_router_01",
  "service_type": "INTERNET"
}
```

### 4.2 Lifecycle & Error Handling
*   **Creation:** Triggered after optical path and VLAN validation.
*   **Timeout/Expiry:** If the simulation tick passes `lease_expires`, state transitions to `EXPIRED`. Traffic drops to 0.
*   **Pool Exhaustion:** If no IP is available, session stays `INIT`, ONT status degrades to `DEGRADED (No IP)`.
*   **BNG Down:** If the BNG goes DOWN, all associated sessions transition to `EXPIRED` (simulating connection drop).

---

## 5. CGNAT Abstraction & Forensic API

CGNAT is modeled as **Metadata and Capacity**, directly linked to the Session object to ensure a perfect forensic trace.

### 5.1 CGNAT Pool Definition
```json
{
  "cgnat_pool_id": "cgnat_public_01",
  "public_cidr": "198.51.100.0/24",
  "ports_per_subscriber": 2048,
  "bng_cluster_id": "bng_cluster_frankfurt_01"
}
```

### 5.2 Forensic Mapping & Retention
When a session gets a private IP (e.g., 100.64.x.x), a mapping is generated. A single session can have multiple sequential mappings if ports are exhausted and re-allocated.

```json
{
  "mapping_id": "map_112233",
  "session_id": "sess_98765",
  "subscriber_private_ip": "100.64.1.50",
  "cgnat_public_ip": "198.51.100.5",
  "port_range_start": 4096,
  "port_range_end": 6143,
  "timestamp_start": "2026-03-07T08:00:00Z",
  "timestamp_end": null,
  "retention_expires": "2026-09-07T08:00:00Z" // 6 months retention
}
```

### 5.3 Forensic Trace API
To satisfy Lawful Intercept (LI) use cases, the system provides a deterministic trace API.

**Endpoint:** `GET /api/forensics/trace?ip=198.51.100.5&port=5000&ts=2026-03-07T12:00:00Z`

**Response:**
```json
{
  "public_ip": "198.51.100.5",
  "port": 5000,
  "timestamp": "2026-03-07T12:00:00Z",
  "mapping": { "private_ip": "100.64.1.50" },
  "session": { "mac": "00:1A:2B:3C:4D:5E", "protocol": "DHCP" },
  "device": { "id": "ont_123", "type": "ONT", "status": "UP" },
  "tariff": { "name": "Gigabit Home", "max_down": 1000 },
  "topology": { "olt_id": "olt_01", "bng_id": "edge_router_01", "pop": "POP_FRA_01" }
}
```

---

## 6. Integration Points with Traffic Engine

The existing Traffic Engine must respect Services and Priorities.

1.  **Service-Aware Tariffs:** A Tariff includes service definitions with priorities:
    *   Internet: 1000 Mbps (Best Effort)
    *   IPTV: 50 Mbps (Strict Priority)
    *   Voice: 2 Mbps (Strict Priority)
2.  **Traffic Generation Gate:** The PRNG only generates traffic for an ONT if a valid `ACTIVE` session exists for that specific service.
3.  **Priority Aggregation:** When a GPON segment is congested (> 2.5 Gbps), the Traffic Engine must ensure that IPTV and Voice traffic (Strict Priority) are aggregated first. Only the remaining capacity is available for Internet (Best Effort) traffic.
4.  **VLAN Filtering:** Traffic views can filter utilization by Service VLAN (e.g., "Show me total IPTV multicast traffic on this OLT").

---

## 7. Implementation Roadmap (Revised)

1.  **Phase 1: Data Model & Schema (Foundation)**
    *   Add `VRF`, `IPPool` (Subscriber types), and `ServiceVLAN` entities to Prisma schema.
    *   Add `SubscriberSession` and `CGNATMapping` tables with retention fields.
2.  **Phase 2: BNG & VLAN Validation (Topology)**
    *   Implement BNG role assignment on Edge Routers.
    *   Implement strict VLAN path validation (`is_vlan_path_valid`) before session creation.
3.  **Phase 3: Session Lifecycle (State Machine)**
    *   Implement DHCP/PPPoE session creation, expiry, and teardown logic tied to the simulation tick.
    *   Handle edge cases: Pool exhaustion, BNG failure, Clock-drift safe timestamps.
4.  **Phase 4: Forensics & CGNAT (Compliance)**
    *   Implement CGNAT pool logic and deterministic mapping generator.
    *   Implement the `GET /api/forensics/trace` API.
5.  **Phase 5: Traffic Engine Integration (Simulation)**
    *   Update `server.ts` traffic loop to gate traffic by `ACTIVE` sessions.
    *   Implement basic Strict Priority vs Best Effort aggregation during congestion.

---

## 8. Cross-Document Alignment Checklist

When this track advances, update in lockstep:
- `03_ipam_and_status.md`: subscriber pool semantics, VRF separation, service-status gating.
- `05_realtime_and_ui_model.md`: session/CGNAT/forensics events and UI state model.
- `10_interfaces_and_addresses.md`: subscriber-facing service bindings and constraints.
- `11_traffic_engine_and_congestion.md`: session-gated generation and priority aggregation.
- `13_api_reference.md`: session + forensics endpoints and error contracts.
- `14_commands_playbook.md`: trace commands and operational workflows.

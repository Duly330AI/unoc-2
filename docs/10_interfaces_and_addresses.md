

# 10. Interfaces & Addresses

This document details the data model for Device Interfaces and IP Addresses.

## 1. Data Model

### 1.1 Interface
Represents a physical or logical port on a device.

*   **id:** UUID.
*   **deviceId:** FK to Device.
*   **name:** System name (e.g., "eth0", "pon1").
*   **macAddress:** Unique MAC address (e.g., "02:00:00:00:00:01").
*   **role:** `PON`, `UPLINK`, `ACCESS`, `TRUNK`, `MGMT`.
*   **status:** `UP`, `DOWN`.

### 1.2 Address
Represents an IPv4 address assigned to an interface.

*   **id:** UUID.
*   **interfaceId:** FK to Interface.
*   **ip:** IPv4 address (dotted string).
*   **prefixLen:** CIDR prefix length (e.g., 24).
*   **primary:** Boolean (true for the main address).

## 2. MAC Address Generation

To ensure determinism and avoid collisions, MAC addresses are generated centrally.

*   **OUI:** `02:55:4E` (Locally Administered).
*   **Algorithm:** Monotonic counter based on the number of existing interfaces in the DB.
    *   `mac = OUI + hex(counter)`
*   **Service:** `MacAllocator` (Node.js service).

## 3. Interface Naming

Interfaces are named deterministically based on the Hardware Model and Port Profile.

*   **Pattern:** `{baseName}{index}` (e.g., `pon1`, `uplink0`).
*   **Management:** Usually `mgmt0`.

## 4. API Usage

### 4.1 GET /api/interfaces/:deviceId
Returns all interfaces and their assigned addresses for a device.

**Response:**
```json
[
  {
    "id": "...",
    "name": "mgmt0",
    "mac": "02:55:4E:00:00:01",
    "role": "MGMT",
    "status": "UP",
    "addresses": [
      {
        "ip": "10.0.0.1",
        "prefixLen": 24,
        "primary": true
      }
    ]
  }
]
```

## 5. Testing
*   **Determinism:** Tests should verify that provisioning the same device twice results in the same Interface names and MAC addresses (if the DB is reset).
model.md`
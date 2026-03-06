# 04. Signal Budget & Status Overrides

This document details the optical signal calculation logic and the administrative override system.

## 1. Status Evaluation Logic

The `StatusService` determines the effective status of every device based on a hierarchy of factors.

### 1.1 Precedence Rules
1.  **Admin Override:** If `adminOverride` is set, it takes absolute precedence.
2.  **Root Cause Failure:** If an upstream dependency (e.g., OLT) is `OFFLINE`, the device is `OFFLINE`.
3.  **Optical Signal:** If `rxPower` is below sensitivity, the device is `OFFLINE`.
4.  **Operational State:** If reachable and healthy, `ONLINE`.

### 1.2 Implementation (Node.js)
```typescript
function computeEffectiveStatus(device: Device, upstreamStatus: DeviceStatus, signal: SignalResult): DeviceStatus {
  if (device.adminOverride === 'DOWN') return 'OFFLINE';
  if (device.adminOverride === 'UP') return 'ONLINE';
  if (upstreamStatus === 'OFFLINE') return 'OFFLINE';
  if (device.type === 'ONU' && signal.status === 'NO_SIGNAL') return 'OFFLINE';
  return 'ONLINE';
}
```

## 2. Optical Signal Budget

For PON networks, `Rx Power` is calculated as:
$$ Rx_{dBm} = Tx_{dBm} - \sum Loss_{dB} $$

### 2.1 Standard Loss Values
| Component | Parameter | Value |
| :--- | :--- | :--- |
| **OLT Tx** | `tx_power` | +3.0 to +7.0 dBm |
| **Fiber (G.652)** | `attenuation` | 0.35 dB/km |
| **Splitter 1:2** | `loss` | 3.5 dB |
| **Splitter 1:4** | `loss` | 7.0 dB |
| **Splitter 1:8** | `loss` | 10.5 dB |
| **Splitter 1:16** | `loss` | 14.0 dB |
| **Splitter 1:32** | `loss` | 17.5 dB |
| **Splitter 1:64** | `loss` | 21.0 dB |
| **Connector** | `loss` | 0.5 dB |
| **ONU Rx** | `sensitivity` | -28.0 dBm |

### 2.2 Signal Status
*   **OK:** Margin > 3.0 dB
*   **WARNING:** Margin 0.0 - 3.0 dB
*   **CRITICAL:** Margin < 0.0 dB (Link Down)

## 3. Admin Overrides

Administrators can force the status of a device or link for maintenance.

### 3.1 Device Override
*   **Field:** `adminOverride` (`UP`, `DOWN`, `null`).
*   **API:** `PATCH /api/devices/:id` -> `{ "adminOverride": "DOWN" }`.

### 3.2 Link Override
*   **Field:** `adminOverride` (`UP`, `DOWN`, `null`).
*   **API:** `PATCH /api/links/:id` -> `{ "adminOverride": "DOWN" }`.
    *   `DOWN`: Logically breaks the link (Pathfinding ignores it).

## 4. API Endpoints

*   `GET /api/optical/fiber-types`: List supported fiber types.
*   `POST /api/optical/calculate`: "What-If" scenario calculation.

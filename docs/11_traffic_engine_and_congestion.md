

# 11. Traffic Engine & Congestion Details

This document provides deep-dive details on the Traffic Engine (TEv2), specifically focusing on Congestion Management and GPON Segment logic. It complements the high-level overview in `06_future_extensions_and_catalog.md`.

## 1. Traffic Generation Details

### 1.1 Asymmetric Tariffs
While the MVP defaults to symmetric traffic, the engine supports asymmetric generation:
*   **Upstream:** `rand * tariff.maxUpMbps`
*   **Downstream:** `rand * tariff.maxDownMbps`
*   **Aggregation:** Upstream and Downstream totals are aggregated separately at each node.

## 2. GPON Segment Logic

A **GPON Segment** is defined as the optical path from a specific OLT PON Port to its first passive aggregation point (usually an ODF or Splitter).

### 2.1 Capacity
*   **Default:** Down 2.5 Gbps / Up 1.25 Gbps (GPON standard).
*   **Override:** If the OLT has a Hardware Model, the `speed_gbps` from the Port Profile is used.

### 2.2 Aggregation
*   The engine sums the traffic of all ONTs connected to a specific OLT PON port.
*   This sum is compared against the PON port's capacity, *not* just the OLT's backplane capacity.

## 3. Congestion Management

To prevent UI flickering, congestion detection uses **hysteresis**.

### 3.1 Thresholds

| Scope | Condition | Threshold | Action |
| :--- | :--- | :--- | :--- |
| **Device / Link** | **Enter** | Utilization ≥ 100% | Mark Congested (Red) |
| | **Exit** | Utilization ≤ 95% | Clear Congestion |
| **GPON Segment** | **Enter** | Utilization ≥ 95% | Mark Congested (Red) |
| | **Exit** | Utilization ≤ 85% | Clear Congestion |

### 3.2 Detection Logic
1.  **Calculate Utilization:** `currentMbps / capacityMbps`.
2.  **Check State:**
    *   If currently `NORMAL` and `util >= ENTER_THRESHOLD` -> Transition to `CONGESTED`.
    *   If currently `CONGESTED` and `util <= EXIT_THRESHOLD` -> Transition to `NORMAL`.
3.  **Emit Event:** Only emit `segment.congestion.detected` or `segment.congestion.cleared` on state transitions.

## 4. Events

### 4.1 segment.congestion.detected
```json
{
  "event": "segment.congestion.detected",
  "segmentId": "olt-1::pon-1::odf-1",
  "oltId": "olt-1",
  "ponPortId": "pon-1",
  "utilization": 0.98,
  "tick": 12345
}
```

### 4.2 deviceMetricsUpdated
Standard periodic update (see `06`).
vents
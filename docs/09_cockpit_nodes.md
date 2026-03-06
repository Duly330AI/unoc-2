# 09. Cockpit Nodes

Cockpits are the primary visualization units in the Network Map. They are implemented as **React Flow Custom Nodes**.

## 1. Architecture

### 1.1 Node Structure
Each node consists of two layers:
1.  **Base Node Wrapper:** Handles common functionality (Selection, Dragging, Status Border, Context Menu).
2.  **Cockpit Component:** Renders the device-specific visualization.

### 1.2 Component Mapping

| Device Role | Component | Visualization |
| :--- | :--- | :--- |
| `CORE_ROUTER` | `RouterCockpit` | Traffic Bars (Up/Down), Capacity |
| `OLT` | `OLTCockpit` | Port Matrix (PON Ports), Aggregated Traffic |
| `ONT` | `ONTCockpit` | Signal Gauge, User Traffic |
| `SPLITTER` | `PassiveCockpit` | Simple Icon, Loss Value |

## 2. Data & Props

Cockpit components receive data via the React Flow `data` prop.

```typescript
interface CockpitData {
  device: Device;       // Static device data (Name, IP, Model)
  status: DeviceStatus; // UP, DOWN, DEGRADED
  metrics?: Metrics;    // Real-time traffic (Up/Down Mbps)
  ports?: PortSummary[];// Port status (for OLT Matrix)
}
```

## 3. Visualization Strategies

### 3.1 Router Cockpit
*   **Traffic:** Two horizontal bars (Upstream/Downstream).
*   **Capacity:** Text label (e.g., "1.2 / 10 Gbps").
*   **Implementation:** Simple SVG `<rect>` elements for bars (performant).

### 3.2 OLT Cockpit (Port Matrix)
*   **Grid:** 4x4 or 8x4 grid of PON ports.
*   **Cells:** Colored squares based on port status/occupancy.
*   **Implementation:** SVG `<rect>` grid.
    *   *Optimization:* Use a single `<svg>` for the entire matrix to reduce DOM nodes.

### 3.3 ONT Cockpit
*   **Signal:** Radial gauge showing Optical Power (dBm).
*   **Implementation:** SVG `<path>` (arc) or a lightweight library like `react-gauge-component` (if available) or custom SVG.

## 4. Performance Optimization

*   **React.memo:** All Cockpit components **MUST** be wrapped in `React.memo`.
*   **Prop Stability:** Ensure `metrics` objects are not recreated on every frame if values haven't changed (handled by the Store/Selector layer).
*   **Throttling:** The Traffic Engine emits events every 2s. The UI should interpolate values for smooth animations (using CSS transitions or `framer-motion`).

## 5. Interaction
*   **Hover:** Shows a tooltip with detailed metrics.
*   **Click:** Selects the node (handled by React Flow).
*   **Double Click:** Opens the Device Details Side Panel.

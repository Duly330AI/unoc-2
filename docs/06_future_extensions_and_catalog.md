# 06. Future Extensions & Catalog

This document outlines features deferred to future phases and details the Hardware Catalog and Traffic Simulation logic.

## 1. Future Extensions

| Category    | Deferred Items                                                    |
| ----------- | ----------------------------------------------------------------- |
| Networking  | Dual-stack IPv6, Multi-backbone domains, advanced path caching    |
| UI          | Lasso selection, Bulk override UI, Additional viewer dashboards   |
| Persistence | Durable migrations, de-provision IP reclamation                   |
| Security    | AuthN/AuthZ, multi-tenancy, RBAC                                  |
| Performance | Large-scale (10k devices) optimization                            |

## 2. Reference Catalog (Hardware)

The Hardware Catalog provides immutable default values for devices (e.g., transmission power, sensitivity).

### 2.1 Data Source
For the MVP, the catalog is stored in `backend/src/data/catalog.json`.

```json
{
  "models": [
    {
      "id": "OLT-HUAWEI-MA5800",
      "type": "OLT",
      "vendor": "Huawei",
      "model": "MA5800-X2",
      "specs": {
        "txPower": 5.0,
        "ports": 16
      }
    },
    {
      "id": "ONT-HUAWEI-HG8245",
      "type": "ONT",
      "vendor": "Huawei",
      "model": "HG8245",
      "specs": {
        "sensitivity": -28.0
      }
    }
  ],
  "fiberTypes": [
    {
      "code": "G.652",
      "attenuation": 0.22 // dB/km
    }
  ]
}
```

### 2.2 Usage
*   **Provisioning:** When a device is provisioned, if no specific hardware model is selected, a default is applied.
*   **Optical Calculation:** The `OpticalService` looks up `txPower` and `sensitivity` from the catalog if not overridden on the device instance.

## 3. Traffic Simulation (Traffic Engine)

The Traffic Engine generates synthetic traffic metrics to visualize network activity.

### 3.1 Architecture
*   **Service:** `TrafficEngine` (Node.js class).
*   **Loop:** `setInterval` (default 2s).
*   **State:** In-memory `Map<DeviceId, Metrics>`.

### 3.2 Logic
1.  **Tick Start:** Increment `tickSeq`.
2.  **Leaf Generation:** For each active ONT:
    *   Generate `upstreamMbps` using a deterministic PRNG (seeded by `deviceId` + `tickSeq`).
    *   `downstreamMbps` = `upstreamMbps` (symmetric for MVP).
3.  **Aggregation:**
    *   Traverse the topology (using `parentId` and Links).
    *   Sum `upstreamMbps` at each aggregation point (Splitter -> OLT -> Switch -> POP).
4.  **Utilization:**
    *   `utilization %` = `currentMbps` / `capacityMbps`.
5.  **Broadcast:**
    *   Emit `device:metrics` event via Socket.io with the new values.

### 3.3 Persistence
Metrics are **ephemeral**. They are not stored in the database.
*   **Snapshot:** `GET /api/metrics/snapshot` returns the current in-memory state for new clients.

## 4. Smart Cockpits (UI)

The frontend uses React Flow custom nodes ("Cockpits") to visualize this data.

*   **SVG Rendering:** Nodes render SVG charts (bars, gauges) based on the metrics received via WebSocket.
*   **Performance:** Updates are throttled/batched to avoid React render thrashing (using `requestAnimationFrame`).

### 16.15 Neue Konstanten / Konfiguration (Frontend Konvention)

```

COCKPIT_BASE_WIDTH = 120
COCKPIT_BASE_HEIGHT = 70
PORT_MATRIX_MAX_VISIBLE = 32
TOOLTIP_SHOW_DELAY_MS = 80
TOOLTIP_HIDE_DELAY_MS = 120
RENDER_BUDGET_WARN_THRESHOLD = 0.25 # ms per cockpit avg (heuristic)

```

### 16.16 Teststrategie (Zusatz zu §15.15)

Unit: Mapping funktionen (util→bucket, signal→icon). Snapshot: minimal structural DOM (strip dynamic numbers). Perf Harness: Synthetic 2k Device Delta → assert < X mutated nodes. E2E: Hover link → correct tooltip; injection immediate micro-tick pulses only affected nodes.

### 16.17 Aufgaben Mapping (TASK-071..086 / optional 087..088)

Siehe TASK.md Abschnitt Milestone M8 für vollständige Auflistung & Abhängigkeiten.

### 16.18 Legenden & Farbquellen

Single file colorScale.ts exportiert: STATUS_COLORS, UTIL_BUCKET_COLORS, SIGNAL_COLORS, PORT_OCCUPANCY_COLORS. Frontend Legend UI bezieht sich ausschließlich auf diese Maps (Vermeidung divergenter Hardcodes).

### 16.19 Render Budget Overlay (Dev Feature)

Optional panel (`?renderDebug=1`) zeigt: lastFrameCockpitRenders, avgRenderTimeMs, changedDevicesCount. Aktiv nur in devMode.

### 16.20 Migration & Einführungsreihenfolge

Incremental Rollout (Ref): 1 Base + Router Cockpit → 2 Link Utilization → 3 Signal ONT → 4 Port Matrix → 5 Passive Cockpits → 6 Tooltip Engine → 7 Performance pass → 8 Accessibility/Theming → 9 Tests & Polish.

### 16.21 Abhängigkeiten zu existierenden Abschnitten

Re-use event contract (§8), determinism ordering (§11), simulation metrics (§15), config endpoint (§15.20). No schema duplication; signal & metrics shapes remain authoritative in respective sections.

### 16.22 Fehlerbehandlung & Edge Cases

UI handling for partial payloads and ordering:

- If signalStore entry lacks path or margin_db, display UNKNOWN chip and avoid misleading values.
- If deviceStatusUpdated arrives before deviceSignalUpdated, ONT cockpit shows status border updated immediately; signal chip updates later without layout shift.
- If linkMetricsUpdated missing for a link, default utilization bucket to 0% neutral styling.
- Drop out-of-order deltas by version.

### 16.23 Änderungsprotokoll Bezug

Revision r3 introduced this section; any deviation in implementation must update both this section & TASK.md dependencies.

---

End Section 16.

## 17. Stable Physics Engine (Incremental D3 Force Layout) (ON HOLD)

Status: ON HOLD / To Be Redefined. Drag/pin and deterministic transforms remain under simple non-physics movement. Full incremental force integration is paused; the section below is retained for future resumption and may be revised.

Authoritative design for a non-destructive, incremental D3 forceSimulation integration. Eliminates layout "twitch" by preserving internal integrator state across all topology changes. References: §9 (UI Interaction Model) & §16 (Cockpits) — this section governs spatial lifecycle only.

### 17.1 Prinzip & Lebenszyklus

- Single instantiation: `forceSimulation` created once during initial topology bootstrap; NEVER re-created due to graph mutations.
- Node identity preservation: PhysicsNode objects retained (mutated in-place) so velocities (vx, vy), alpha, and cooling curve continuity are maintained.
- Separation of concerns: Semantic device/link data lives in Pinia (topologyStore). A distinct physics layer mirrors only layout fields (x,y,vx,vy,fx,fy, pinned flags).

### 17.2 Datenstrukturen

Physics Node (runtime only): `{ id, type, x, y, vx, vy, fx?, fy?, pinned, userPinned, systemPinned, degree, createdAt, lastManualMoveAt? }`.
Physics Store State: `nodes: Map<id,PhysicsNode>`, `links: PhysicsLink[]`, `running:boolean`, `pinnedCount`, `layoutVersion`, `pendingDirty:Set<id>`, `config:{ repelStrength, linkDistanceBase, linkDistancePassiveFactor, collideRadius, alphaMin, alphaDecay }`.

### 17.3 Initialisierung & Platzierung

1. Lade Geräte & Links (erste vollständige Snapshot-Phase).
2. Falls persistierte Koordinaten vorhanden → anwenden.
3. Sonst heuristisches Seed-Layout:
   - Backbone/Core: Ring / radial (golden angle) um Zentrum.
   - POP / Container: Nähe Parent / Backbone-Knoten.
   - OLT / AON: Gruppiert um POP / Backbone.
   - ONT / CPE: Fächer (sector) um zugehörige OLT mit zufälligem Jitter.
4. Simulation Forces:

```

forceSimulation(nodes)
.force('link', forceLink(links).id(d=>d.id).distance(linkDistanceFor))
.force('charge', forceManyBody().strength(config.repelStrength))
.force('center', forceCenter(width/2, height/2))
.force('collide', forceCollide().radius(config.collideRadius))
.alpha(1)
.alphaDecay(config.alphaDecay)
.alphaMin(config.alphaMin)
.on('tick', tickHandler)

```

### 17.4 Inkrementelle Graph-Updates

Ein Vue-Watcher detektiert strukturelle Änderungen (IDs hinzu/entfernt). Algorithmus:

1. Added Devices → PhysicsNode anlegen, Startposition: Mittelwert existierender Nachbarn (oder Center + jitter wenn isoliert).
2. Removed Devices → aus Node-Map & Array entfernen (zuerst Links filtern, dann Node entfernen).
3. Added / Removed Links: Rebuild link array minimal (Filter + Append).
4. Apply:

```

simulation.nodes(currentNodesArray)
simulation.force('link').links(currentLinksArray)
if (structuralChanged) simulation.alpha(adaptiveAlpha).restart()

```

Adaptive Alpha: kleine Mutation (<=2 nodes) => 0.12; sonst 0.3.

### 17.5 Benutzerinteraktion: Drag & Pinning

- Drag Start: `alphaTarget(0.25).restart()`.
- Drag Move: set `node.fx = x; node.fy = y; node.userPinned = true; pendingDirty.add(id)`.
- Drag End: `alphaTarget(0)`.
- Multi-Select Pin / Unpin: toggelt `userPinned` (fx/fy setzen oder löschen).

### 17.6 Stop / Start Physics

Stop:

```

simulation.stop()
for node: if !node.userPinned { node.systemPinned = true; node.fx = node.x; node.fy = node.y }
running=false

```

Start:

```

for node: if node.systemPinned { node.systemPinned=false; if(!node.userPinned){ node.fx=null; node.fy=null } }
running=true
simulation.alpha(1).restart()

```

Dual-Level Pinning (userPinned vs systemPinned) verhindert versehentliches Lösen bewusst fixierter Nodes.

### 17.7 Persistenz & Backend Sync

PATCH Endpoint: `/api/layout/positions` payload `{ version?, positions:[{id,x,y,pinned}] }`.
Throttle: Flush alle 2s oder wenn `pendingDirty.size >= 40`.
Merge-Strategie beim Reload: Server-Koordinaten überschreiben lokale nur falls Node nicht `userPinned` (Konflikte protokollieren). Version mismatch -> Soft-Merge (kein Hard-Reset).

### 17.8 Tick Handler & DOM Update

`tickHandler` mutiert ausschließlich:

- Node `<g>`: `transform="translate(x,y)"`.
- Link `<line>` (oder path) Attribute: `x1,y1,x2,y2` (oder `d`).
  Keine Vue-Reaktivität für jede Koordinate (Performance). Frame-Metriken sammeln (optional) für Render Budget Overlay (§16.19).

### 17.9 Link-Stabilität

Links referenzieren persistente Node-Objekte (`source` / `target`). Keine Re-Creation → Kein "Verlust" beim Verschieben. Entfernen sicher über Filter + Rebinding.

### 17.10 Edge Cases

| Szenario                   | Mitigation                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Node entfernt während Drag | Drag-End prüft Existenz; ignoriert sonst                                             |
| Massive Node-Batches       | Temporär `alpha(0.5)`, niedrigere charge (-40) danach revert                         |
| >5k ONTs                   | After settle: auto `simulation.stop()` + lazy incremental local relax                |
| >70% pinned                | Hinweis & Option "Disable Physics"                                                   |
| Reconnect ohne Layoutdaten | Heuristische Neuplatzierung + Interpolation beim Eintreffen persistierter Positionen |

### 17.11 Adaptive Performance

- Dynamische charge-Funktion: `strength = base * sqrt(1000 / max(n,1000))` clamp.
- Skip DOM Updates: Option nur jeden 2. Tick bei hoher CPU.
- AutoStop bei Inaktivität: Kein Delta + keine Interaktion > 30s.
- Anti-Jitter Filter: Positionsdelta < 0.05px → skip transform write.

### 17.12 Tests

Unit: placement heuristics (deterministisch mit seed), mergeLogik, adaptiveAlpha.
Integration (Vitest+jsdom): Add/Remove Node verändert nicht existierende Node-Referenzen. Drag setzt fx/fy & pinned Flags. Persistence throttle (fake timers). Snapshot Guard: Kein zusätzlicher `new forceSimulation` nach init.

### 17.13 Erweiterungen (Future)

- Worker-Offload (Positionsberechnung in Worker, DOM apply main thread)
- Cluster / LOD (verweist §16.13) vor Physikstart für entfernte Zoomlevel
- GPU Link Layer ab >10k Links
- Layout Health Metrics (avgLinkStretch, pinnedRatio) Overlay

### 17.14 Risiken & Mitigation

| Risiko                          | Wirkung      | Mitigation                                        |
| ------------------------------- | ------------ | ------------------------------------------------- |
| Unbeabsichtigter Neuaufbau      | Layout-Reset | Dev assert wrapper um forceSimulation             |
| Persistenz Flood                | Backend Load | Batched + distinct ID merges                      |
| Performance Drift große Graphen | Latenz       | Adaptive forces + AutoStop + Worker Option        |
| Race Delta vs Drag              | Spring-Back  | `node.dragging=true` ignoriert externe pos-Deltas |

### 17.15 Aufgaben Mapping

Siehe TASK.md (TASK-092..106). Implementation MUSS diese Reihenfolge respektieren: Bootstrap (093) → Delta Applier (094) → Drag (095) → Placement (097) → Persistence (098) → Merge (099) → Perf Metrics (100) → Tests (101) → Docs (102) → Adaptive (103) → Partial Freeze (104) → Health Overlay (105) → Worker POC (106).

### 17.16 Änderungsprotokoll

Revision r4 fügt stabile Physics Engine hinzu. Änderungen an Force-Parametern oder Persistenzschema erfordern Update dieses Abschnitts und TASK.md Dependencies.

---

End Section 17.

## 18. Pathfinding Logic

<!-- Existing Section 18 content retained above (placeholder note for context; actual detailed pathfinding spec already present earlier in doc). -->

## 19. Ring Protection (Failure Link Protection)

### 19.1 Motivation

Placeholder: Prevent loops in physical fiber rings by logically blocking one deterministic link; enable fast failover & recovery.

### 19.2 Terminology

Placeholder: physical_status (raw) vs logical_status (exposed), protection_mode (AUTO_BLOCKING, AUTO_FORWARDING, MANUAL_BLOCKING, NONE), ring_id (hash of sorted link ids).

### 19.3 High-level Goals

Placeholder: Deterministic selection, minimal churn, debounce flaps, override precedence, scalable detection.

### 19.4 Data Model Changes

Placeholder: Extend Link.status with BLOCKING; add Link.protection_mode; future API dual-status exposure.

### 19.5 Configuration Flags

Placeholder: ENABLE_RING_PROTECTION, RING_PROTECTION_DETERMINISM, RING_PROTECTION_DEBOUNCE_MS, RING_PROTECTION_RECOVERY_DELAY_MS, RING_PROTECTION_MAX_CYCLE_LENGTH, RING_PROTECTION_MAX_RINGS_TRACKED, RING_PROTECTION_OVERLAP_STRATEGY, RING_PROTECTION_IGNORE_PASSIVE_NODES.

### 19.6 State Machine

Placeholder: Healthy (one BLOCKING) → Failover (BLOCKING→UP when other DOWN) → Recovery (re-block after delay) → Healthy.

### 19.7 Algorithm Outline

Placeholder: Build active graph; compute cycle basis; select deterministically; apply status transitions with debounce.

### 19.8 Determinism Rules

Placeholder: Lexicographically highest link id (initial policy), stable absent mutations.

### 19.9 Event Model

Placeholder: New link.protection.updated event emitted before link.status.changed; ordering table update pending.

### 19.10 Overlapping Rings Strategy

Placeholder: Phase 1 PER_CYCLE; future MIN_BLOCK_SET optimization.

### 19.11 Debounce & Recovery

Placeholder: Separate debounce & recovery delay windows mitigate flapping.

### 19.12 Admin Overrides

Placeholder: Manual block supersedes auto; alternate candidate chosen.

### 19.13 Metrics & Observability

Placeholder: Counters (failover/recovery), histograms (convergence), gauges (ring_total, overlapping_factor).

### 19.14 Testing Strategy

Placeholder: Unit (cycles, selection), Integration (failover/recovery), Property (invariant), Performance (1k links cycles).

### 19.15 Limitations & Future Work

Placeholder: No persistence initial, no weighted policy, no domain partitioning yet.

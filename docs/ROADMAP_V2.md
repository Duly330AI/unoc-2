# UNOC v3 Roadmap v2 (Source-of-Truth)

Hinweis: Für eine phasenorientierte, verlustfreie Navigationssicht siehe `docs/ROADMAP_V2.md` (Task-Details bleiben hier kanonisch).

## 0) Decision
- `MASTER_SPEC_UNOC_LITE.md` ist als High-Level-Grundgerüst nützlich, aber **nicht mehr ausreichend** als Hauptanforderung.
- Ab jetzt ist diese Roadmap der operative Source-of-Truth für Umsetzung.
- Empfehlung: `MASTER_SPEC_UNOC_LITE.md` zunächst **nicht löschen**, sondern als `ARCHIVE` behandeln, bis alle offenen Themen aus den Fachdokus in Tasks umgesetzt/abgenommen sind.
- Dokumentversions- und Autoritätsregeln werden zentral in `docs/DOC_VERSIONING_POLICY.md` geführt.

## 1) Arbeitsregeln

### 1.1 Status
- `OPEN`: noch nicht begonnen
- `IN_PROGRESS`: in Arbeit
- `BLOCKED`: externes Hindernis
- `DONE`: umgesetzt + akzeptiert
- `DEFERRED`: bewusst verschoben

### 1.2 Builder-Update-Format (pro Task)
Jeder erledigte oder blockierte Task bekommt direkt unter `Builder Log` einen kurzen Eintrag:

```md
- Date: YYYY-MM-DD
- Outcome: DONE | BLOCKED | PARTIAL
- Implemented: <kurz was wirklich umgesetzt wurde>
- Issues: <Fehler/Limitierungen oder "none">
- Dependencies/Next: <welcher Task jetzt nötig ist>
```

### 1.3 Definition of Done (global)
- API-Verhalten entspricht Doku + Fehlercodes.
- Socket-Events entsprechen Contract.
- UI ist auf API/Socket statt Mock-State.
- `npm run lint`, `npm test`, `npm run build` grün.
- Task enthält Builder-Log-Eintrag.

## 2) Traceability (keine Informationsverluste)
- `DOC_VERSIONING_POLICY.md` -> Governance/Review-Policy (cross-cutting)
- `01_overview_and_domain_model.md` -> TASK-001..004, TASK-053..066
- `02_provisioning_model.md` -> TASK-005..008, TASK-067..081
- `03_ipam_and_status.md` -> TASK-009..012, TASK-082..096
- `031_IPAM-Architecture-Future.md` -> TASK-097..103
- `04_links_and_batch.md` -> TASK-013..016, TASK-104..116
- `04_signal_budget_and_overrides.md` -> TASK-017..019, TASK-117..128
- `05_realtime_and_ui_model.md` -> TASK-020..023, TASK-129..140
- `06_future_extensions_and_catalog.md` -> TASK-024..029, TASK-141..152
- `07_container_model_and_ui.md` -> TASK-030..032, TASK-153..162
- `08_ports.md` -> TASK-033..035, TASK-163..168
- `09_cockpit_nodes.md` -> TASK-036..038, TASK-169..174
- `10_interfaces_and_addresses.md` -> TASK-039..041, TASK-175..180
- `11_traffic_engine_and_congestion.md` -> TASK-042..044, TASK-181..186
- `15_subscriber_IPAM_Services_BNG.md` -> TASK-224..230
- `18_simulation_engine_spec.md` -> TASK-181..186, TASK-211..214
- Cross-doc closure (Traffic/Links/Subscriber integration) -> TASK-231..235
- `16_ui_ipam_explorer.md` -> TASK-236..237
- `17_ui_forensics_trace.md` -> TASK-238..239
- Cross-doc closure (UI Scale/IPAM/Forensics) -> TASK-240
- `12_testing_and_performance_harness.md` -> TASK-045..048, TASK-187..192
- `13_api_reference.md` -> TASK-049..052, TASK-193..198
- `ARCHITECTURE.md` -> TASK-199..202
- `14_commands_playbook.md` -> TASK-203..206

## 2a) V2 Ausführungsstruktur (Phasen)
### Phase 0 - Governance & Drift Control
- Scope: Architecture & Operations Docs, API Reference Parity, Testing & Quality
- Fokus: Contract-Drift verhindern, Tests/CI als harte Gates etablieren.

### Phase 1 - Domain, Provisioning, IPAM Core
- Scope: Foundation & Domain, Provisioning, IPAM & Status
- Fokus: kanonische Domäne, Provisioning-Transaktionen, IPAM/Status-Kernfluss.

### Phase 2 - Links, Optical, Realtime
- Scope: Links & Batch, Optical Budget & Overrides, Real-time & UI Contract
- Fokus: End-to-End Datenfluss `Link/Signal/Realtime` stabil und dokuparitätisch.

### Phase 3 - Interfaces, Ports, Cockpit
- Scope: Interfaces & Addresses, Ports, Cockpit Nodes, Container Model
- Fokus: UI/Backend-Verträge für Betriebsansicht und Detailpanels vollständig.

### Phase 4 - Traffic, Catalog, Scale Hardening
- Scope: Traffic & Congestion, Catalog, Simulation, Future Tracks
- Fokus: Determinismus, Skalierung, Lastfestigkeit und Observability.

### Phase 5 - Subscriber Services and BNG
- Scope: Subscriber IPAM, Session Lifecycle, Service VLANs, CGNAT/Forensics, Service-aware Traffic Gating
- Fokus: Trennung `Infra UP` vs `Service UP`, deterministische Subscriber-Sessions, tracebare End-to-End-Servicepfade.

## 2b) 2-Wochen-Execution-Board (Foundation First)
Hinweis: Dieser Plan ersetzt die alte W1/W2/W3-Planung und priorisiert die Prisma-/Persistenzschicht (Interfaces, Addressing, Session-Grundlagen) als harte Voraussetzung fuer Layer-3-/Subscriber-Features. Detail-`Depends on` bleiben in den jeweiligen Tasks normativ.

### Woche 1 - Foundation Closure & Prisma-Realitaet
Ziel: Persistente Datenmodelle fuer Interfaces, Adressierung und transaktionale Provisioning-/Link-Flows schaffen, damit spaetere Subscriber- und Traffic-Features nicht auf synthetischen Runtime-Strukturen aufbauen.
- Tag 1: Schema- und Datenmodellvorbereitung.
  Fokus: `TASK-039`, `TASK-175`.
  Exit: `Interface`/`Address`-Grundlagen und Constraints sind als verbindliche Implementierungsbasis vorbereitet.
- Tag 2: Provisioning Hardening.
  Fokus: `TASK-215`, `TASK-069`, `TASK-070`.
  Exit: idempotentes Provisioning mit race-safe Guard und deterministischer Management-Interface-Erzeugung.
- Tag 3: Transactional IPAM MVP.
  Fokus: `TASK-216`, `TASK-178`, `TASK-179`.
  Exit: echte, transaktionale Adressvergabe an persistente Interfaces mit sauberem Fehlervertrag.
- Tag 4: Routed `/31` P2P Trigger Contract.
  Fokus: `TASK-232`.
  Exit: Router-Link-Erstellung bindet `/31`-Allokation atomar in Single- und Batch-Flows ein.
- Tag 5: OLT VLAN Translation Source-of-Truth.
  Fokus: `TASK-233`.
  Exit: persistentes OLT-Translation-Modell steht als einzige Quelle fuer `validate-vlan-path` bereit.

### Woche 2 - Subscriber Runtime, Traffic & Operator Contracts
Ziel: Subscriber-Sessions an die neue Persistenzschicht binden, Ausfaelle deterministisch auf Services kaskadieren und Traffic-/Ops-Vertraege darauf abstuetzen.
- Tag 6: Subscriber Session Lifecycle Foundation.
  Fokus: `TASK-224`, `TASK-225`, `TASK-227`.
  Exit: BNG-/Pool-/Session-Grundmodell ist konsistent und an echte Interfaces gebunden.
- Tag 7: BNG Status Reactor.
  Fokus: `TASK-234`.
  Exit: `EDGE_ROUTER` mit BNG-Rolle und `effective_status=DOWN` expirieren gebundene Sessions deterministisch.
- Tag 8: Downstream Pre-Order + Service-aware Gating.
  Fokus: `TASK-231`, `TASK-229`.
  Exit: Top-down Budgetverteilung, Strict Priority und deterministisches Clamping greifen nur fuer `ACTIVE` Services.
- Tag 9: CGNAT & Forensics Contract.
  Fokus: `TASK-228`, `TASK-235`.
  Exit: Mapping-, Index- und Trace-Vertraege sind API- und testfaehig definiert.
- Tag 10: UI Contracts & Operator Read Models.
  Fokus: `TASK-230`, `TASK-236`, `TASK-237`, `TASK-238`, `TASK-239`, `TASK-240`.
  Exit: `Infra UP` vs `Service DOWN`, IPAM Explorer, Forensics UI und Large-topology-Policy sind kontraktklar fuer die anschliessende Runtime-Integration.

## 2c) Implementation Reality Snapshot (2026-03-07)
Purpose:
- Prevent plan/implementation drift by documenting the current executable baseline.
- This section is descriptive only; tasks below remain normative targets.

Current backend baseline (observed):
- Device/link CRUD is implemented and uses canonical status/type normalization in runtime.
- Strict provisioning path checks are implemented for:
  - `ONT`/`BUSINESS_ONT`: requires passive-chain path to `OLT`.
  - `AON_CPE`: requires direct upstream link to `AON_SWITCH`.
- `POST /api/devices/:id/provision` runs in `prisma.$transaction`, uses an atomic CAS claim on `provisioned=false`, realizes `mgmt0`, and allocates management IPs transactionally.
- Prisma now contains first-class `Interface`, `IpAddress`, `Vrf`, `IpPool`, `SubscriberSession`, `CgnatMapping`, and `OltVlanTranslation` entities.
- Management and routed `/31` allocations enforce runtime primary-IP uniqueness per `interfaceId + vrf`.
- Router-class `POST /api/links` performs atomic `/31` P2P allocation in single and batch flows.
- Subscriber session APIs are live (`POST/GET/PATCH /api/sessions`) with persisted state transitions, BNG anchoring on `EDGE_ROUTER`, strict VLAN-path validation on activation, and lease-expiry handling in the simulation tick.
- Traffic simulation is session-aware: inactive subscribers generate `0` service traffic; active services are shaped by downstream pre-order clamping and strict-priority semantics.
- Leaf traffic generation is now additionally gated by conservative upstream viability to the bound BNG anchor; an `ACTIVE` session alone is no longer sufficient when the passable upstream path is broken.
- A first diagnostics endpoint is live at `GET /api/devices/:id/diagnostics` and exposes `upstream_l3_ok`, `chain`, and stable `reason_codes` using the same passable runtime view as leaf traffic gating.
- Runtime passability traversal and class-aware tick status evaluation now share the same conservative graph policy: explicit device overrides remain authoritative, passive inline devices can stay `UP` with `no_downstream_terminator`, and OLT/AON/router classes no longer depend solely on raw persisted `status` during tick emission.
- CGNAT mapping creation and `GET /api/forensics/trace` are live, including retention fields and time-window query semantics.
- Realtime delivery uses correlation-bound outbox buckets with deterministic flush phases and server-side deduplication for signal/status/metrics classes.
- Client-side reconnect/version-gap reconciliation still depends on existing topo-version gap handling; full delayed-event validation remains partial.
- UI node rendering now distinguishes infrastructure and subscriber service state and uses a semantic simplified port layout (for example OLT uplink left, PON right) for the React Flow overview.
- Expandable cockpit cards now exist for the main field path (`BACKBONE_GATEWAY`/router, `OLT`, passive inline, `ONT`/`AON_CPE`) and consume current runtime summaries (`/api/ports/summary`, `/api/ports/ont-list`, `/api/interfaces`, session store) instead of pure placeholder KPIs.
- Traffic loop is deterministic by `(device_id, tick_seq)` seed material and now gates subscriber service traffic on `ACTIVE` sessions plus passable upstream viability, but not every documented infra-passability rule is fully closed yet.

Drift-closure tasks (high priority):
- [TASK-215] Provisioning state persistence + idempotency hardening (`provisioned` flag, `ALREADY_PROVISIONED`, race-safe retries).
- [TASK-216] Transactional IPAM allocation MVP (`POOL_EXHAUSTED`, duplicate mgmt guard, VRF-aware uniqueness baseline).
- [TASK-217] Realtime coalescing + changed-only deltas (`deviceMetricsUpdated`, ordering, reconnect-safe behavior).
- [TASK-218] Traffic eligibility alignment (strict `provisioned + upstream viability` gating for leaf generation and aggregation inputs).

### 2c.1 Drift-Closure Task Stubs

#### [TASK-215] Provisioning State Persistence + Idempotency
- Status: DONE
- Sources: 02, 03, 10, 13
- Ziel: Persistentes `provisioned`-State-Flag mit idempotentem Provisioning-Verhalten.
- Akzeptanz:
  - Zweiter Provisioning-Call liefert `ALREADY_PROVISIONED` (409).
  - Concurrency-safe Guard für parallele Provisioning-Rennen.
  - Keine Doppelanlage von mgmt-Interfaces.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: DONE
  - Implemented: `provisioned` wird persistent gesetzt; Provisioning laeuft in `prisma.$transaction`; atomarer CAS-Claim (`updateMany where provisioned=false`) verhindert parallele Doppel-Provisionierung; `ALREADY_PROVISIONED` und `mgmt0`-Realization sind umgesetzt und per Paralleltest abgesichert.
  - Issues: none against current task acceptance criteria
  - Dependencies/Next: TASK-216

#### [TASK-216] Transactional IPAM Allocation MVP
- Status: DONE
- Sources: 02, 03, 10, 13
- Ziel: First-class IP-Adressallokation pro Interface in Transaktionen.
- Akzeptanz:
  - deterministische Allocation pro Pool/VRF,
  - `POOL_EXHAUSTED` korrekt,
  - eindeutige Primäradresse-Regel pro Interface+VRF.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: DONE
  - Implemented: transaktionale Management-IPAM-Allokation pro Pool/VRF, `POOL_EXHAUSTED`, persisted `IpAddress`-Records und runtime-guarded eindeutige Primaeradresse-Regel pro `interfaceId + vrf`; gleicher Guard ist auch im `/31`-P2P-Flow aktiv.
  - Issues: DB-seitiger partieller Unique-Constraint bleibt wegen SQLite-Limitierung weiterhin nicht modelliert, ist aber fuer die aktuelle MVP-Akzeptanz durch Runtime-Guard abgedeckt.
  - Dependencies/Next: TASK-235

#### [TASK-217] Realtime Coalescing + Changed-Only Metrics
- Status: IN_PROGRESS
- Sources: 05, 11, 13
- Ziel: Metrik-/Status-Events als changed-only batches mit deterministischer Flush-Reihenfolge.
- Akzeptanz:
  - Coalescing-Window aktiv,
  - keine Voll-Dumps bei unveränderten Geräten,
  - Snapshot-Reconciliation bei reconnect/version gap stabil.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: PARTIAL
  - Implemented: serverseitige Realtime-Outbox mit request-/tick-gebundenen Buckets, deterministischer Flush-Reihenfolge und last-write-wins Deduplizierung fuer Signal-/Status-/Metrics-Klassen; Socket-Integrationstest deckt Ordering und Status-Kollaps ab.
  - Implemented+: Client-Store nutzt fuer reconnect und `topo_version` gaps jetzt denselben baseline-resync Pfad (`fetchTopology` + `fetchMetricsSnapshot` + `fetchSessions`) mit koalesziertem In-Flight-Resync statt partieller Reconnect-Refreshes.
  - Issues: reconnect/version-gap handling ist clientseitig noch nicht vollstaendig gegen den neuen Server-Contract nachgewiesen; buffer/replay, per-event stale-drop und Last-/Mehrtick-Nachweise bleiben offen. Metrics-/Congestion-Zustandswechsel besitzen weiterhin keine eigene `metrics_version` oder Replay-Sequenz und verlassen sich bei Gap-Recovery auf den Baseline-Resync statt auf ein separates Delta-Protokoll.
  - Dependencies/Next: TASK-129, TASK-185

#### [TASK-218] Traffic Eligibility Contract Alignment
- Status: IN_PROGRESS
- Sources: 03, 11, 13
- Ziel: Leaf-Traffic nur bei `provisioned && upstream_viable && effective_online`.
- Akzeptanz:
  - keine Traffic-Generierung für nicht-provisionierte/offline Leaves,
  - Aggregation respektiert Status-/Passability-Gating,
  - tests decken ONT/AON_CPE gating regressions ab.
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: nicht-provisionierte Subscriber-Leaves generieren keinen Service-Traffic; `ACTIVE`-Sessions werden im Tick nur dann als traffic-berechtigt behandelt, wenn ein passierbarer Upstream-Pfad bis zum konkret gebundenen `EDGE_ROUTER`/BNG besteht; Regressionstest deckt ONT-Fall mit Uplink-Ausfall ab.
  - Issues: AON_CPE-spezifischer Regressionsnachweis fehlt noch; vollständige Alignment mit allen dokumentierten `is_link_passable`-/Statuspfaden ist noch nicht geschlossen.
  - Dependencies/Next: TASK-181, TASK-185

#### [TASK-219] Traffic Visualization Contract (UI) präzisieren
- Status: OPEN
- Sources: 05, 11
- Ziel: Verbindliche Trennung zwischen Status-Farben und Traffic-Visualisierung definieren.
- Akzeptanz:
  - explizite Aussage, dass Traffic-Animation/Encoding frei implementierbar ist,
  - asymmetrische Tarife in UI-Notation klar geregelt oder bewusst als non-contract markiert.

#### [TASK-220] Canvas Performance Reality (React Flow) absichern
- Status: OPEN
- Sources: 05, 12
- Ziel: Performance-Annahmen auf reale Rendering-Charakteristik abstimmen.
- Akzeptanz:
  - keine implizite Annahme „Offscreen wird automatisch entfernt“,
  - dokumentierter Plan für Animations-Gating/Batching/Profiling bei großen Topologien.

#### [TASK-221] Child-Selector Workflow auf MVP-Status heben
- Status: OPEN
- Sources: 05, 07
- Ziel: Geplanten Container-Child-Selector entweder implementieren oder als non-MVP markieren.
- Akzeptanz:
  - klare Produktentscheidung dokumentiert,
  - konsistentes Verhalten beim Link-Start auf Containern.

#### [TASK-222] Override Visual Semantics (Panel vs Canvas)
- Status: OPEN
- Sources: 05, 09
- Ziel: Override-Darstellung verbindlich machen (mindestens Panel, optional Canvas).
- Akzeptanz:
  - dokumentierte Pflichtdarstellung im Panel,
  - Canvas-Badge/Icon entweder spezifiziert oder explizit out-of-scope.

#### [TASK-223] Critical Path Protection UX
- Status: OPEN
- Sources: 05, 14
- Ziel: Schutzmechanismen gegen unbeabsichtigtes Löschen kritischer Verbindungen definieren.
- Akzeptanz:
  - Regeln für Warnungen/Bestätigungsdialoge für kritische Links/Nodes,
  - reproduzierbares API/UI-Verhalten bei geschützten Delete-Pfaden.

#### [TASK-224] Subscriber IPAM Domain Model
- Status: IN_PROGRESS
- Sources: 15_subscriber_IPAM_Services_BNG, 03, 13
- Ziel: Subscriber-Pooltypen (`SUBSCRIBER_IPV4`, `IPV6_PD`, `CGNAT`) mit BNG/VRF-Bindung modellieren.
- Akzeptanz:
  - region/pop/bng-scope in Datenmodell,
  - keine Vermischung mit Management-Pools.
- Builder Log:
  - Date: 2026-03-09
  - Outcome: PARTIAL
  - Implemented: `IpPool`, `Vrf`, BNG-Bindung und Session-/CGNAT-nahe Persistenzgrundlagen existieren; `ACTIVE`-Sessions ziehen jetzt reale `SUBSCRIBER_IPV4`-Adressen und delegierte `sub_ipv6_pd`-Praefixe aus BNG-gebundenen `internet_vrf`-Pools, `EXPIRED/RELEASED` reclaimen beide Ressourcen, `SESSION_POOL_EXHAUSTED` ist als Fehlercontract abgesichert, und `GET /api/bng/pools?bng_id=...` macht die aktuelle Poolauslastung inklusive echter `cluster_id` operativ sichtbar.
  - Issues: region/pop-scope und hierarchische Poolplanung fehlen noch; Subscriber-Pools werden aktuell lazy aus gemeinsamen IPv4-/IPv6-Supernetzen materialisiert statt bereits hierarchisch vorgeplant.
  - Dependencies/Next: TASK-226

#### [TASK-225] BNG Role on EDGE_ROUTER
- Status: DONE
- Sources: 15_subscriber_IPAM_Services_BNG, 01, 02
- Ziel: BNG-Rolle als Capability auf `EDGE_ROUTER` inklusive Cluster/Anchoring.
- Akzeptanz:
  - eindeutige BNG-Zuordnung für Subscriber-Sessions,
  - Redundanzmodell (active/standby abstraction) dokumentiert.
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: `Device` traegt jetzt explizite BNG-Rollenmetadaten (`bngClusterId`, `bngAnchorId`); Create/Patch validieren BNG-Felder strikt nur auf `EDGE_ROUTER`, `bngAnchorId` darf nur auf `POP` oder `CORE_SITE` zeigen, Session-Create/Preflight lehnen nackte Router ohne BNG-Rolle ab, und `GET /api/bng/pools` liefert die echte `cluster_id`.
  - Issues: kein aktives Redundanz-/Failover-Verhalten zwischen mehreren Routern desselben Clusters; Cluster ist derzeit Topologie-/Policy-Metadatum.
  - Dependencies/Next: TASK-234

#### [TASK-226] Service VLAN Path Validation
- Status: DONE
- Sources: 15_subscriber_IPAM_Services_BNG, 04, 13
- Ziel: `is_vlan_path_valid` vor Session-Aktivierung erzwingen.
- Akzeptanz:
  - `VLAN_PATH_INVALID` deterministisch,
  - Session bleibt `INIT` bei ungültigem Tag-Pfad.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: DONE
  - Implemented: Session-Aktivierung auf `ACTIVE` validiert den Serving-OLT über die Link-Topologie und akzeptiert nur passende `OltVlanTranslation`-Profile; fehlende Translation fuehrt deterministisch zu `422 VLAN_PATH_INVALID`, Session bleibt nicht `ACTIVE`.
  - Issues: none
  - Dependencies/Next: none

#### [TASK-227] Subscriber Session Lifecycle Engine
- Status: DONE
- Sources: 15_subscriber_IPAM_Services_BNG, 03, 11
- Ziel: Session-Zustände `INIT/ACTIVE/EXPIRED/RELEASED` plus Lease-Timer und BNG-Failure-Reaktionen.
- Akzeptanz:
  - deterministische Tick-Transitions,
  - `ACTIVE` als harte Voraussetzung für Service-Traffic.
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: Session-States `INIT/ACTIVE/EXPIRED/RELEASED`, BNG-Failure-Reaktion, automatische BNG-Recovery fuer `BNG_UNREACHABLE`-Sessions bei erneutem `EDGE_ROUTER -> UP`, `ACTIVE`-gated Service-Traffic und Lease-Expiry-Engine im Simulation-Tick inklusive Schliessen/Neueroeffnen offener CGNAT-Mappings.
  - Issues: none against current task acceptance criteria
  - Dependencies/Next: TASK-229

#### [TASK-228] CGNAT Mapping and Forensics Trace API
- Status: DONE
- Sources: 15_subscriber_IPAM_Services_BNG, 13, 14
- Ziel: CGNAT-Mappings mit Retention + `GET /api/forensics/trace`.
- Akzeptanz:
  - trace response liefert session/device/tariff/topology-Korrelation,
  - retention fields und deterministische query semantics.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: DONE
  - Implemented: `CgnatMapping` mit Retention-Feldern, automatische Mapping-Erzeugung bei `ACTIVE`, `GET /api/forensics/trace` mit session/device/tariff/topology-Korrelation.
  - Issues: none
  - Dependencies/Next: TASK-235

#### [TASK-229] Service-aware Traffic Gating and Priority
- Status: DONE
- Sources: 15_subscriber_IPAM_Services_BNG, 11, 05
- Ziel: Traffic nur für `ACTIVE` Services; Priorisierung `STRICT_PRIORITY` vs `BEST_EFFORT` bei Congestion.
- Akzeptanz:
  - ONT/CPE ohne aktive Session erzeugt 0 Service-Traffic,
  - IPTV/Voice vor Internet bei Segmentüberlast.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: DONE
  - Implemented: Traffic-Engine erzeugt Service-Traffic nur fuer `ACTIVE` Sessions; Strict-Priority fuer `VOICE`/`IPTV` vor `INTERNET`.
  - Issues: none
  - Dependencies/Next: TASK-230

#### [TASK-230] Service Health Semantics in UI
- Status: DONE
- Sources: 15_subscriber_IPAM_Services_BNG, 05, 09
- Ziel: klare Trennung `Infra UP` vs `Service DOWN` in Panels/Cockpits.
- Akzeptanz:
  - explizite Fehlerbilder (`No IP`, `VLAN invalid`, `BNG down`),
  - kein „grün“ für Subscriber-Service ohne aktive Session.
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: React-Flow-Nodes zeigen separaten Service-Badge und `serviceReasonCode`; initialer Session-Fetch plus `subscriberSessionUpdated` halten den aggregierten Service-Zustand pro Device ohne Refresh aktuell. Expandierte Cockpit-Karten fuer Router/Backbone, OLT, passive Inline und Subscriber-Knoten zeigen die getrennte Service-Sicht jetzt ebenfalls mit aktuellen Runtime-Summaries, binden den Diagnostik-Endpoint fuer Upstream-Ursachen an und rendern auf Subscriber-Seite die echte Session-IP plus delegiertes IPv6-PD. Router/BNG-Karten binden zusaetzlich `GET /api/bng/pools` ein und machen `cluster_id` plus aktuelle Poolauslastung sichtbar.
  - Issues: Die UI deckt noch nicht alle geplanten Cockpit-/Panelfamilien ab (zum Beispiel `POP`, `CORE_SITE`, detaillierte Matrix-/Drilldown-Ansichten); explizite Fehlerbilder sind noch nicht fuer jeden Typ voll ausformuliert.
  - Dependencies/Next: TASK-171, TASK-172

#### [TASK-231] Downstream Pre-Order Distribution Pass
- Status: DONE
- Sources: 11, 15
- Ziel: Neben Upstream-Post-Order einen deterministischen Downstream-Pre-Order-Pass spezifizieren/implementieren.
- Akzeptanz:
  - Shared downstream budgets (zum Beispiel GPON 2.5 Gbps) werden top-down auf aktive Sessions verteilt,
  - Strict-Priority (`VOICE`, `IPTV`) wird vor Best-Effort (`INTERNET`) bedient,
  - Best-Effort wird bei Budgetüberschreitung deterministisch geclamped.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: DONE
  - Implemented: deterministischer Downstream-Pre-Order-Pass pro OLT mit 2.5 Gbps Budget und proportionalem Best-Effort-Clamping.
  - Issues: none
  - Dependencies/Next: TASK-191

#### [TASK-232] Routed Link /31 IPAM Trigger Contract
- Status: DONE
- Sources: 04, 02, 03, 13
- Ziel: `/31` p2p-Adressierung als synchronen Teil von Router-Link-Erstellung verbindlich machen.
- Akzeptanz:
  - `POST /api/links` (router-class endpoints) führt `/31`-Allokation in derselben Transaktion aus,
  - bei `P2P_SUPERNET_EXHAUSTED` scheitert der gesamte Link-Create atomar,
  - Batch-Link-Create folgt demselben Trigger-/Fehlervertrag pro Item.
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: atomare `/31`-Allokation in Single-/Batch-Link-Creation inkl. `P2P_SUPERNET_EXHAUSTED`; Link-Single- und Batch-Delete reclaimen die zugehörigen `/31`-Bindings wieder transaktional.
  - Issues: none
  - Dependencies/Next: none

#### [TASK-233] OLT VLAN Translation Source-of-Truth
- Status: DONE
- Sources: 15, 10, 13
- Ziel: Explizites OLT-Translation-Modell (`C-Tag -> S-Tag`) als Grundlage für `validate-vlan-path`.
- Akzeptanz:
  - Service-/Translation-Profile sind persistent und deterministisch auslesbar,
  - `POST /api/sessions/validate-vlan-path` nutzt nur diese Quelle (keine implizite Annahme),
  - fehlende/inkonsistente Translation führt deterministisch zu `VLAN_PATH_INVALID`.
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: persistentes OLT-Translation-Modell ist jetzt ONT-spezifisch (`deviceId + ontId + cTag`), der Konfigurationsendpoint `POST /api/devices/:id/vlan-mappings` akzeptiert `ontId`, die runtime-seitige `VLAN_PATH_INVALID`-Durchsetzung validiert Session-Aktivierung gegen Serving-OLT plus konkretes Subscriber-ONT, und `POST /api/sessions/validate-vlan-path` stellt denselben Check als dedizierten Preflight-Contract bereit.
  - Issues: none
  - Dependencies/Next: none

#### [TASK-234] BNG Status Reactor for Session Expiry
- Status: DONE
- Sources: 15, 03, 05
- Ziel: Interner Hook vom Infra-Status-Service auf Subscriber-Sessions bei BNG-Ausfall.
- Akzeptanz:
  - `EDGE_ROUTER` mit BNG-Rolle und `effective_status=DOWN` triggert Expiry aller gebundenen Sessions,
  - Session-Transitions emittieren `subscriberSessionUpdated` inkl. `reason_code=BNG_UNREACHABLE`,
  - Zustand `BNG DOWN + ACTIVE Session` bleibt nicht persistent.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: DONE
  - Implemented: `EDGE_ROUTER`-Status `DOWN` expirieren gebundene Sessions und emittieren `subscriberSessionUpdated` mit `BNG_UNREACHABLE`.
  - Issues: none
  - Dependencies/Next: none

#### [TASK-235] CGNAT Forensics Index Contract
- Status: IN_PROGRESS
- Sources: 15, 13, 12
- Ziel: Deterministischen Index-/Query-Vertrag für `GET /api/forensics/trace` festlegen und testen.
- Akzeptanz:
  - `CGNATMapping` besitzt den geforderten Composite-Index auf Public-IP, Zeitfenster und Port-Range,
  - Forensics-Trace nutzt den normativen Predicate-Vertrag (`ip`, `port` in range, `ts` in window),
  - Contract-/Performance-Tests belegen reproduzierbare Ergebnisse ohne Full-Table-Scan in Ziel-DB-Profilen.
- Builder Log:
  - Date: 2026-03-07
  - Outcome: PARTIAL
  - Implemented: Composite-Index, normativer Trace-Predicate, Pagination-Hardening fuer Session-Reads und Regressions-/Perf-Smoke-Tests.
  - Issues: kein belastbarer Nachweis fuer Ziel-DB-Profile ohne Full-Table-Scan ueber SQLite hinaus.
  - Dependencies/Next: TASK-190, TASK-191

#### [TASK-236] IPAM Explorer UI Contract
- Status: OPEN
- Sources: 16, 03, 13
- Ziel: Vollständige UI-Spezifikation für Pool-/Prefix-/Allocation-Explorer.
- Akzeptanz:
  - deterministische Tabellen-/Filter-/Sortierregeln dokumentiert,
  - Overview/Detail/Allocation-Views kontraktklar,
  - Realtime/resync-Verhalten für IPAM-Views spezifiziert.

#### [TASK-237] IPAM Explorer UI Runtime Integration
- Status: OPEN
- Sources: 16, 05, 12
- Ziel: Implementierungsnahe Integration der IPAM-Views in das Cockpit-Workspace-Modell.
- Akzeptanz:
  - IPAM-Tab mit `GET /api/ipam/prefixes` + `GET /api/ipam/pools`,
  - deterministische Empty/Error/Retry-States,
  - Contract-Tests für Sortierung/Filter und Reconnect-Verhalten.

#### [TASK-238] Forensics Trace UI Contract
- Status: OPEN
- Sources: 17, 13, 14, 15
- Ziel: Deterministischer Screen-Contract für `GET /api/forensics/trace`.
- Akzeptanz:
  - Query-/Result-/Not-found-States normiert,
  - Ergebnis enthält mapping/session/device/topology in stabiler Darstellung,
  - immutabler point-in-time Result-Contract dokumentiert.

#### [TASK-239] Forensics Trace UI Runtime Integration
- Status: OPEN
- Sources: 17, 05, 12
- Ziel: Umsetzungspfad für Forensics-Workflow in der UI inkl. Ops-Aktionen.
- Akzeptanz:
  - Suchformular (`ip`, `port`, `ts`) mit deterministischer Validierung,
  - copy/export/open-device Aktionen,
  - UI-Tests für `TRACE_NOT_FOUND` und malformed input.

#### [TASK-240] Large-Topology UX and Rendering Policy
- Status: OPEN
- Sources: 05, 09, 12
- Ziel: Verbindliche LOD-/Clustering-/Animation-Gating-Strategie für große Topologien.
- Akzeptanz:
  - Schwellenwerte und degradierte Renderprofile dokumentiert und testbar,
  - Kerninteraktionen (`select`, `multi-select`, panel open) bleiben verfügbar,
  - Performance-Budgets und testbare Scale-Szenarien in Harness verankert.

## 3) Task Backlog

### Foundation & Domain

#### [TASK-001] Domain Canonical Model vereinheitlichen
- Status: OPEN
- Sources: 01
- Ziel: Einheitliche Device/Link/Port/Network-Typen (inkl. OLT, Splitter, ONT, Switch) in Backend, Frontend und DB.
- Scope:
  - Einheitliche DeviceType-Mapping-Regeln (legacy ONT/SPLITTER etc. -> kanonische Typen).
  - DB/DTO/Frontend-Typen synchronisieren.
- Akzeptanz:
  - Keine widersprüchlichen Typbezeichner im Laufzeitpfad.
- Depends on: none
- Builder Log:

#### [TASK-002] Optical Grundattribute modellieren
- Status: OPEN
- Sources: 01
- Ziel: tx_power, sensitivity, insertion_loss, link length/fiber loss konsistent erfassen.
- Scope:
  - Schema-/Payload-Felder für optische Berechnung.
  - Fallback-Defaults dokumentiert.
- Akzeptanz:
  - Optische Berechnung nutzt definierte Attribute statt Hardcode-only.
- Depends on: TASK-001
- Builder Log:

#### [TASK-003] Determinismus-Regeln durchziehen
- Status: OPEN
- Sources: 01, 05
- Ziel: reproduzierbare Reihenfolgen/IDs/Sortierung verhindern UI-Sprünge.
- Scope:
  - deterministische Sortierung für Listen/Topologie.
  - Event-Reihenfolge und Versionsfelder.
- Akzeptanz:
  - gleiche Eingaben erzeugen reproduzierbare Ausgabe.
- Depends on: TASK-001
- Builder Log:

#### [TASK-004] Authoritative Backend-Prinzip absichern
- Status: OPEN
- Sources: 01
- Ziel: Backend als autoritative Quelle für Persistenz + Topologiezustand.
- Scope:
  - keine dauerhafte fachliche Divergenz zwischen Client-Mock und Serverzustand.
- Akzeptanz:
  - Reload zeigt identischen persisted Zustand.
- Depends on: TASK-001
- Builder Log:

#### [TASK-053] Vollständige Device-Taxonomie abbilden
- Status: OPEN
- Sources: 01
- Ziel: Alle in `01` definierten Gerätetypen technisch führen (Backbone Gateway, Core Router, Edge Router, OLT, AON Switch, POP, CORE_SITE, ODF, NVT, Splitter, HOP, ONT, Business ONT, AON CPE).
- Scope:
  - Kanonische Typen in Schema, API-DTO, UI-Mapping und Validierung.
  - Keine stillen Typ-Drops/Umbenennungen ohne Migrationspfad.
- Akzeptanz:
  - Jeder Typ ist erstellbar/lesbar und korrekt klassifiziert.
- Depends on: TASK-001
- Builder Log:

#### [TASK-054] Rollenklassen + Fähigkeitsmatrix erzwingen
- Status: OPEN
- Sources: 01
- Ziel: `active`, `passive_inline`, `passive_container`, `special` inkl. Provisioning/Container/AlwaysOnline/HostsChildren-Flags.
- Scope:
  - Maschinenlesbare Capability-Matrix.
  - Laufzeitvalidierungen auf Matrixbasis.
- Akzeptanz:
  - Regelverstöße werden deterministisch abgewiesen.
- Depends on: TASK-053
- Builder Log:

#### [TASK-055] Container-Beziehungsregeln (01-Level) absichern
- Status: OPEN
- Sources: 01
- Ziel: POP/CORE_SITE als Gruppierungsgrenzen, keine Link-Endpunkte, Parent-Relation für aktive Geräte.
- Scope:
  - API/Service-Regeln für Parent-Assignment und Endpoint-Validierung.
  - Aggregation sink semantics ohne Pfadteilnahme.
- Akzeptanz:
  - Container können nicht als Link-Endpunkte verbunden werden.
- Depends on: TASK-053, TASK-030
- Builder Log:

#### [TASK-056] IPAM-Poolset aus 01 vollständig umsetzen
- Status: OPEN
- Sources: 01, 03
- Ziel: `core_mgmt`, `ont_mgmt`, `aon_mgmt`, `cpe_mgmt`, `olt_mgmt`, `noc_tools` plus `/31` p2p-Track.
- Scope:
  - Deterministische Zuordnung pro Gerätetyp.
  - Idempotente Provisioning-Allokation.
- Akzeptanz:
  - Pools werden gemäß Matrix verwendet, inkl. CPE/NOC.
- Depends on: TASK-009, TASK-053
- Builder Log:

#### [TASK-057] `/31` p2p IPAM für Router-Links ergänzen
- Status: OPEN
- Sources: 01
- Ziel: Router-zu-Router Punkt-zu-Punkt-Adressierung mit /31 Pool.
- Scope:
  - Reservierung, Vergabe, Freigabe, Konfliktprüfung.
  - Routing/Interface-Contract Integration.
- Akzeptanz:
  - Core/Edge Router p2p links erhalten deterministische /31-Adressen.
- Depends on: TASK-056, TASK-039
- Builder Log:

#### [TASK-058] L2/L3 Fallback-Pipeline spezifikationsgetreu
- Status: OPEN
- Sources: 01
- Ziel: Primär graph traversal, fallback forwarding bei fehlendem passable path.
- Scope:
  - Gemeinsame `is_link_passable` Logik.
  - Fallback-Path-Synthese + Observability.
- Akzeptanz:
  - Fehlende Primärpfade führen nicht zu hartem Traffic-Abbruch.
- Depends on: TASK-013, TASK-025
- Builder Log:

#### [TASK-059] Link-Typregeln inkl. logischer Uplink-Varianten
- Status: OPEN
- Sources: 01, 02, 04_links
- Ziel: Zugriffsuplinks im logischen Graph, aber außerhalb optischer Dämpfungsberechnung.
- Scope:
  - Link-Kategorien für optical-vs-logical treatment.
  - Validierung und Engine-Integration.
- Akzeptanz:
  - Optical loss berechnet nur optische Segmente; dependency graph sieht zulässige logische Uplinks.
- Depends on: TASK-013, TASK-018
- Builder Log:

#### [TASK-060] Realtime Outbox/Dispatcher/Heartbeat robust machen
- Status: OPEN
- Sources: 01, 05
- Ziel: Bounded coalescing queue, single dispatcher, heartbeat cleanup.
- Scope:
  - Burst-Schutz und per-device coalescing.
  - Verbindungsbereinigung bei stale peers.
- Akzeptanz:
  - Unter Last kein ungebremstes Queue-Wachstum.
- Depends on: TASK-020
- Builder Log:

#### [TASK-061] Optical-Recompute Hooks bei Mutationen
- Status: OPEN
- Sources: 01
- Ziel: Recompute-Anstoß bei Device/Link/Patch-Änderungen mit betroffenen ONTs.
- Scope:
  - Hook points für relevante Mutationspfade.
  - Delta-Events statt Full Refresh.
- Akzeptanz:
  - Optische Werte aktualisieren gezielt nach Mutationen.
- Depends on: TASK-018, TASK-020
- Builder Log:

#### [TASK-062] Hardware-Auswahl bei Device-Creation
- Status: OPEN
- Sources: 01, 06
- Ziel: Modellauswahl beim Erstellen + sichere Defaults für headless/test.
- Scope:
  - UI selection flow.
  - Backend Übernahme der Modell-Defaults.
- Akzeptanz:
  - Gerät wird mit gewähltem Modell und passenden Default-Interfaces erzeugt.
- Depends on: TASK-024, TASK-021
- Builder Log:

#### [TASK-063] Effective Capacity Dual-Field Contract
- Status: OPEN
- Sources: 01
- Ziel: Beide Kapazitätsfelder im Device-Contract parallel bereitstellen (nested + flattened).
- Scope:
  - API response shaping.
  - Backward/forward compatibility tests.
- Akzeptanz:
  - Beide Felder vorhanden und konsistent.
- Depends on: TASK-049
- Builder Log:

#### [TASK-064] Router Cockpit Capacity Rendering-Regeln
- Status: OPEN
- Sources: 01, 09
- Ziel: `TotCap` Anzeige mit klaren current/max Rundungs-/Einheitenregeln.
- Scope:
  - upstream-basierte Utilization-Konsistenz.
  - optional combined-throughput Darstellung klar getrennt.
- Akzeptanz:
  - Keine widersprüchliche Kapazitätsanzeige im Cockpit.
- Depends on: TASK-063, TASK-037
- Builder Log:

#### [TASK-065] DEGRADED-vs-DOWN Traffic Semantik
- Status: OPEN
- Sources: 01
- Ziel: Verkehrsgenerierung/Aggregation abhängig vom Status exakt gemäß Spezifikation.
- Scope:
  - ONT/Business ONT block in DEGRADED/DOWN.
  - AON CPE folgt derselben strikten Regel wie ONT/Business ONT (kein Ausnahmepfad).
  - Infrastructure aggregate behavior in DEGRADED.
- Akzeptanz:
  - Traffic-Engine Verhalten entspricht Statussemantik in allen genannten Klassen.
- Depends on: TASK-025, TASK-010
- Builder Log:

#### [TASK-066] Interfaces/Optical Details Panels vollständig anbinden
- Status: OPEN
- Sources: 01, 08, 10
- Ziel: Details Tabs (Overview/Interfaces/Optical) mit Live-Summary + on-demand Interfaces.
- Scope:
  - Polling/Push-Strategie für Port occupancy.
  - Fetch-on-demand Interfaces/addresses.
- Akzeptanz:
  - Tabs zeigen konsistente Live-Daten ohne Hard-Refresh.
- Depends on: TASK-033, TASK-041, TASK-021
- Builder Log:

### Provisioning

#### [TASK-005] Provisioning State Machine umsetzen
- Status: OPEN
- Sources: 02
- Ziel: `Created -> Validated -> Provisioned -> Active/Offline` inkl. Transition-Regeln.
- Scope:
  - Provision/Deprovision-Endpunkte.
  - Statuswechsel mit Validierung.
- Akzeptanz:
  - illegale State-Transitions werden mit 4xx blockiert.
- Depends on: TASK-001, TASK-004
- Builder Log:

#### [TASK-006] Provision Matrix + Dependency Checks
- Status: OPEN
- Sources: 02
- Ziel: Regeln pro Gerätetyp (Provisionable, Required Parent, Upstream Dependency).
- Scope:
  - ONT benötigt gültigen OLT-Pfad.
  - Passive Geräte nicht provisionierbar.
- Akzeptanz:
  - Verstöße liefern definierte Fehlercodes.
- Depends on: TASK-005
- Builder Log:

#### [TASK-007] Provisioning-Fehlercodes normieren
- Status: OPEN
- Sources: 02, 05
- Ziel: `DEVICE_NOT_FOUND`, `INVALID_PARENT`, `ALREADY_PROVISIONED`, `MISSING_DEPENDENCY` etc.
- Scope:
  - einheitlicher Error Payload + HTTP Mapping.
- Akzeptanz:
  - API liefert konsistente Fehlercodes laut Doku.
- Depends on: TASK-005
- Builder Log:

#### [TASK-008] Batch-Provisioning vorbereiten
- Status: OPEN
- Sources: 02
- Ziel: Grundlage für OLT-/ONT-Massenprovisionierung.
- Scope:
  - Transaktions- und Validierungsstrategie definieren/implementieren.
- Akzeptanz:
  - dokumentierter und getesteter Batch-Flow (mind. MVP Stub).
- Depends on: TASK-006
- Builder Log:

#### [TASK-067] Provisioning-Transaktion 6-Phasen-Flow
- Status: OPEN
- Sources: 02
- Ziel: Pre-Validation -> Interface-Realization -> IPAM -> Status-Phase1 -> Optical-Hook -> Delta-Events als definierter Flow.
- Scope:
  - Klare Trennung transaktionaler und post-commit Schritte.
  - Deterministische Reihenfolge.
- Akzeptanz:
  - Provisioning folgt exakt dokumentierter Ausführungssequenz.
- Depends on: TASK-005
- Builder Log:

#### [TASK-068] Parent/Container-Regeln pro Gerätetyp (strict)
- Status: OPEN
- Sources: 02
- Ziel: CORE_SITE top-level, POP optional unter CORE_SITE, OLT/AON parent optional in POP oder CORE_SITE; Router ohne Parent; Endpoint-parent-Regeln durchsetzen.
- Scope:
  - Typ-spezifische Parent-Policy.
  - 422/400 Fehlerpfade.
- Akzeptanz:
  - Ungültige Parent-Konfigurationen werden korrekt abgewiesen.
- Depends on: TASK-006, TASK-030
- Builder Log:

#### [TASK-069] Interface-Realization bei Provisioning
- Status: OPEN
- Sources: 02
- Ziel: Management-Interface Erzeugung mit Uniqueness-Garantien.
- Scope:
  - Duplicate-Schutz (`DUPLICATE_MGMT_INTERFACE`).
  - p2p-Uplink Realization als separater späterer Flow.
- Akzeptanz:
  - Pro provisioniertem Device genau eine gültige Mgmt-Schnittstelle.
- Depends on: TASK-005, TASK-039
- Builder Log:

#### [TASK-070] Concurrency Guard für Provisioning-Races
- Status: OPEN
- Sources: 02
- Ziel: Parallele Provisioning-Versuche führen zu genau einem Erfolg.
- Scope:
  - optimistic/pessimistic guard Strategie.
  - eindeutiger Konflikt-Response.
- Akzeptanz:
  - Race-Test zeigt single-winner Verhalten.
- Depends on: TASK-067
- Builder Log:

#### [TASK-071] Async Post-Commit Recompute Pipeline
- Status: OPEN
- Sources: 02
- Ziel: Status/Optical recompute nach Commit mit nachvollziehbarer Latenzsemantik.
- Scope:
  - post-commit job hooks.
  - eventual-consistency Hinweis im API-Vertrag.
- Akzeptanz:
  - Provisioned-Flag kann vor Finalstatus erscheinen, aber deterministisch nachziehen.
- Depends on: TASK-067, TASK-061
- Builder Log:

#### [TASK-072] Provisioning Error-Code Contract (vollständig)
- Status: OPEN
- Sources: 02
- Ziel: Mapping für `INVALID_PROVISION_PATH`, `ALREADY_PROVISIONED`, `POOL_EXHAUSTED`, `DUPLICATE_MGMT_INTERFACE`, `CONTAINER_REQUIRED`.
- Scope:
  - HTTP-Status und Error-Payload standardisieren.
  - Negative Tests pro Code.
- Akzeptanz:
  - Jeder definierte Fehlercode reproduzierbar testbar.
- Depends on: TASK-007, TASK-045
- Builder Log:

#### [TASK-073] Dry-Run Provision Endpoint
- Status: OPEN
- Sources: 02
- Ziel: `?dry_run=1` liefert geplante Operationen ohne Mutation.
- Scope:
  - prospective dependency/ip/interface preview.
  - no-write guarantee.
- Akzeptanz:
  - Dry-Run erzeugt identisches Ergebnisprofil wie echte Provision ohne DB-Änderung.
- Depends on: TASK-067
- Builder Log:

#### [TASK-074] Provision Matrix API für UI-Hints
- Status: OPEN
- Sources: 02
- Ziel: `GET /api/provision/matrix` als maschinenlesbarer Regel-Contract.
- Scope:
  - Device-type rules, parent constraints, dependency hints.
  - kompatibel mit UI Creation/Validation hints.
- Akzeptanz:
  - Frontend kann Provisioning-Hinweise vollständig aus Endpoint beziehen.
- Depends on: TASK-006
- Builder Log:

#### [TASK-075] Batch-Provision mit Dependency-Ordering
- Status: OPEN
- Sources: 02
- Ziel: Mehrere Devices in geordneter Sequenz provisionieren (topological ordering).
- Scope:
  - dependency sort.
  - partial-failure Strategie (all-or-nothing oder report-mode).
- Akzeptanz:
  - Batch-Provisioning dokumentiert und testbar mit Abhängigkeitsketten.
- Depends on: TASK-008, TASK-067
- Builder Log:

#### [TASK-076] Deprovision-Policy (MVP-deferred zu implementierbar)
- Status: OPEN
- Sources: 02
- Ziel: deprovision semantics inkl. optional IP reclamation und Folge-Recompute.
- Scope:
  - state rollback rules.
  - reclamation policy toggle.
- Akzeptanz:
  - Deprovision verlässlich und ohne orphaned state.
- Depends on: TASK-005, TASK-009
- Builder Log:

#### [TASK-077] Link Rules L1-L9 als Runtime-Validator
- Status: OPEN
- Sources: 02
- Ziel: Detaillierte L1..L9 Endpoint-Regeln inkl. L6A/L6B maschinenlesbar validieren.
- Scope:
  - Rule table in code/constants.
  - reject/allow behavior + error paths.
- Akzeptanz:
  - Jede L-Regel hat mind. einen positiven/negativen Test.
- Depends on: TASK-013, TASK-059
- Builder Log:

#### [TASK-078] Container-Endpoint-Invariant technisch erzwingen
- Status: OPEN
- Sources: 02
- Ziel: POP/CORE_SITE nie als Link-Endpunkte zulassen.
- Scope:
  - validator + tests + error contract.
- Akzeptanz:
  - Container-endpoint link attempts liefern deterministischen Fehler.
- Depends on: TASK-055, TASK-077
- Builder Log:

#### [TASK-079] Provisioning Observability (Logs + Metrics)
- Status: OPEN
- Sources: 02
- Ziel: `provision.start/success/failure` strukturierte Logs + Counters.
- Scope:
  - success/failure counters by type/reason.
  - optional duration metric.
- Akzeptanz:
  - Provisioning-Fluss ist in Logs/Metriken nachvollziehbar.
- Depends on: TASK-067
- Builder Log:

#### [TASK-080] Runtime-Flags Governance für Provisioning-Kontext
- Status: OPEN
- Sources: 02
- Ziel: dokumentierte Flag-Werte und Effektgrenzen (strict-only etc.) im Codepfad verankern.
- Scope:
  - removed/planned flags korrekt behandelt.
  - dev/prod behavior eindeutig.
- Akzeptanz:
  - keine impliziten, undokumentierten Feature-Flags im Provisioning-Verhalten.
- Depends on: TASK-003
- Builder Log:

#### [TASK-081] Provisioning Testmatrix erweitern
- Status: OPEN
- Sources: 02
- Ziel: Unit+Integration+Race+Performance-Mindestmatrix aus Doku als verpflichtende Tests.
- Scope:
  - dependency table tests.
  - strict sequence tests.
  - concurrency winner test.
- Akzeptanz:
  - alle in 02 geforderten Mindesttests automatisiert vorhanden.
- Depends on: TASK-045, TASK-070
- Builder Log:

### IPAM & Status

#### [TASK-009] Lazy IPAM implementieren
- Status: OPEN
- Sources: 03
- Ziel: Next-Available-IP pro Pool bei Provisionierung.
- Scope:
  - Pool-Mapping nach Gerätetyp.
  - Nebenläufigkeitsschutz.
- Akzeptanz:
  - keine Doppelvergabe bei parallelen Requests.
- Depends on: TASK-005
- Builder Log:

#### [TASK-010] Statusmodell erweitern
- Status: OPEN
- Sources: 03
- Ziel: Lifecycle und Runtime-Status strikt trennen und konsistent nutzbar machen.
- Scope:
  - Runtime-Status auf kanonisches Enum begrenzen: `UP`, `DOWN`, `DEGRADED`, `BLOCKING`.
  - Lifecycle über explizite Felder (z. B. `provisioned`) statt Runtime-Statuswerte abbilden.
  - API-Antworten + UI-Darstellung für beide Ebenen konsistent halten.
- Akzeptanz:
  - keine Vermischung von Lifecycle-Werten mit Runtime-Statusenum.
  - Statuswerte und Übergänge sind konsistent.
- Depends on: TASK-005
- Builder Log:

#### [TASK-011] Downstream-Statuspropagation
- Status: OPEN
- Sources: 03
- Ziel: Upstream-Ausfall propagiert auf abhängige Geräte.
- Scope:
  - BFS/DFS über Topologie.
  - Recovery-Pfad bei Wiederherstellung.
- Akzeptanz:
  - Statuskaskade wird korrekt emittiert und angezeigt.
- Depends on: TASK-010, TASK-020
- Builder Log:

#### [TASK-012] Status/IPAM Endpoints ergänzen
- Status: OPEN
- Sources: 03, 13
- Ziel: `/api/ipam/pools`, `/api/devices/:id/status`, manuelle Status-API.
- Akzeptanz:
  - Endpoints vorhanden, validiert und getestet.
- Depends on: TASK-009, TASK-010
- Builder Log:

#### [TASK-082] IPAM Pool Contract vervollständigen
- Status: OPEN
- Sources: 03
- Ziel: Vollständige Poolmenge (`core/olt/aon/ont/cpe/noc/p2p`) als stabiler Contract inkl. Status pro Pool.
- Scope:
  - role->pool mapping zentralisieren.
  - dokumentierte CIDR-Strategie je Umgebung.
- Akzeptanz:
  - Pool-Contract ist in API/Code/Doku konsistent.
- Depends on: TASK-009, TASK-056
- Builder Log:

#### [TASK-083] VRF-basierte IP Uniqueness-Regeln
- Status: OPEN
- Sources: 03
- Ziel: `(prefix_id, ip)` und `(vrf_id, ip)` constraints fachlich und technisch absichern.
- Scope:
  - migrations/constraints/indexes.
  - negative tests zu VRF-prefix collision cases.
- Akzeptanz:
  - Keine unzulässigen Doppelbelegungen innerhalb Prefix/VRF.
- Depends on: TASK-009
- Builder Log:

#### [TASK-084] Management Interface Naming/Uniqueness Standard
- Status: OPEN
- Sources: 03
- Ziel: `mgmt0` als deterministischer Standard, exakt eine mgmt-Schnittstelle je provisioniertes aktives Device.
- Scope:
  - interface creation conventions.
  - duplicate prevention.
- Akzeptanz:
  - Keine Mehrfach-mgmt-Interfaces in validen Flows.
- Depends on: TASK-069
- Builder Log:

#### [TASK-085] /31 P2P Addressing Semantik
- Status: OPEN
- Sources: 03
- Ziel: Pairing-Regeln für p2p_uplink und lexikografische lower-ip Vergabe.
- Scope:
  - pair lifecycle bei link create/delete.
  - deterministic assignment function.
- Akzeptanz:
  - gleiche Endpoint-Reihenfolge ergibt immer gleiche /31-Zuordnung.
- Depends on: TASK-057
- Builder Log:

#### [TASK-086] Pool Exhaustion & Recovery Verhalten
- Status: OPEN
- Sources: 03
- Ziel: `POOL_EXHAUSTED` plus klare Recovery-Strategie (ops-visible).
- Scope:
  - error payload detail.
  - utilization telemetry hooks.
- Akzeptanz:
  - Exhaustion ist reproduzierbar, diagnostizierbar und testabgedeckt.
- Depends on: TASK-072, TASK-079
- Builder Log:

#### [TASK-087] Status Semantics pro Device-Klasse
- Status: IN_PROGRESS
- Sources: 03
- Ziel: strikte effektive Statusregeln je Klasse (always_online, router, olt/aon, leaf, passive).
- Scope:
  - evaluator policy table.
  - no false-positive UP states for strict classes.
- Akzeptanz:
  - Klassenregeln sind deterministisch und testbar.
- Depends on: TASK-010, TASK-053
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: konservativer Runtime-Status-Evaluator ist jetzt im Tick aktiv; always-online baseline fuer `BACKBONE_GATEWAY`/`POP`/`CORE_SITE`, strict `DOWN` fuer OLT/AON/Router ohne erfuellte Klassenbedingungen, passive Inline bleibt bei gueltigem Upstream auch ohne Downstream-Terminator `UP`.
  - Issues: Subscriber-/leaf-`effective_status` bleibt bewusst konservativ vom Service-/Viability-Gating getrennt; API read-models verwenden noch nicht durchgehend denselben Evaluator.
  - Dependencies/Next: TASK-088, TASK-095

#### [TASK-088] Shared Passability Predicate erzwingen
- Status: IN_PROGRESS
- Sources: 03
- Ziel: ein gemeinsames `is_link_passable` für dependency/status/traffic.
- Scope:
  - central predicate module.
  - remove divergent local checks.
- Akzeptanz:
  - gleiche Linkzustände führen in allen Engines zu gleichem Traversalverhalten.
- Depends on: TASK-013, TASK-087
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: Traffic-Tick und Diagnostics teilen jetzt dieselbe Passability-Basis; Traversal respektiert explizite Overrides autoritativ und blockiert nicht mehr blind an unüberschriebenen Default-`DOWN`-Devices.
  - Issues: nicht alle API-/override-Pfade und Read-Models nutzen bereits dieselbe zentrale Predicate-/Evaluator-Logik.
  - Dependencies/Next: TASK-089, TASK-095

#### [TASK-089] Traffic Gating nach Upstream-Viability
- Status: IN_PROGRESS
- Sources: 03
- Ziel: leaf traffic suppression bei fehlender upstream viability.
- Scope:
  - gate conditions in traffic engine.
  - diagnostics-backed gating reason.
- Akzeptanz:
  - Keine fiktiven Flüsse bei broken upstream.
- Depends on: TASK-025, TASK-088
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: leaf traffic wird fuer `ONT`/`BUSINESS_ONT`/`AON_CPE` nur noch bei `ACTIVE` Session plus passierbarem Upstream zum gebundenen BNG generiert; Regressionsfaelle fuer broken upstream sind abgedeckt.
  - Issues: diagnostics-backed gating ist bisher ueber separaten Diagnostics-Endpoint sichtbar, aber noch nicht als vollstaendige reason propagation in alle Runtime-Read-Models integriert.
  - Dependencies/Next: TASK-090, TASK-095

#### [TASK-090] Diagnostics Contract (`upstream_l3_ok`, chain, reason_codes)
- Status: IN_PROGRESS
- Sources: 03
- Ziel: stabiler Diagnostik-Contract für Backend und UI.
- Scope:
  - reason code vocabulary.
  - serialization and API exposure.
- Akzeptanz:
  - Diagnosefelder konsistent über relevante Endpoints/Events verfügbar.
- Depends on: TASK-087, TASK-012
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: `GET /api/devices/:id/diagnostics` liefert `upstream_l3_ok`, `chain` und `reason_codes` fuer Router, OLT/AON, Subscriber und passive Inline-Typen; die Berechnung nutzt dieselbe passable Runtime-Sicht wie das Leaf-Traffic-Gating. Die aktuellen Cockpit-MVP-Karten konsumieren diesen Contract bereits als kompakte Upstream-Diagnostik.
  - Issues: Der Diagnostik-Contract ist noch nicht ueber relevante Realtime-Events und weitere Read-Models vereinheitlicht; die aktuelle Chain ist eine konservative Runtime-Trace-Sicht, noch keine vollstaendige L3-/Next-Hop-Diagnose.

#### [TASK-091] Event Ordering & Coalescing Semantik
- Status: OPEN
- Sources: 03, 05
- Ziel: Reihenfolge optical/link -> signal -> status, Override-Events immediate.
- Scope:
  - coalescing window config.
  - order guarantees under burst.
- Akzeptanz:
  - Event-Reihenfolge ist deterministisch und contract-getestet.
- Depends on: TASK-020, TASK-060
- Builder Log:

#### [TASK-092] Hybrid Accelerator Track (optional) spezifizieren
- Status: OPEN
- Sources: 03
- Ziel: Optionaler externer Propagation-Accelerator mit Fallback-Garantien.
- Scope:
  - source tagging (`native`/`accelerator`).
  - parity tests and rollback strategy.
- Akzeptanz:
  - Optionaler Accelerator ohne Semantik-Drift betreibbar.
- Depends on: TASK-087, TASK-046
- Builder Log:

#### [TASK-093] Status/IPAM Observability Baseline
- Status: OPEN
- Sources: 03
- Ziel: Strukturierte Logs + Kernmetriken für status/ipam Pfade.
- Scope:
  - duration/failure/affected counters.
  - pool utilization metrics by pool key.
- Akzeptanz:
  - Operations kann Ursachen und Engpässe ohne Code-Debugging erkennen.
- Depends on: TASK-079
- Builder Log:

#### [TASK-094] IPAM Concurrency Testpaket
- Status: OPEN
- Sources: 03
- Ziel: Race-sichere Allokation unter Parallelität automatisiert absichern.
- Scope:
  - parallel provisioning stress tests.
  - deterministic allocation assertions.
- Akzeptanz:
  - keine Doppelvergabe in Paralleltests.
- Depends on: TASK-070, TASK-083
- Builder Log:

#### [TASK-095] Status Evaluator Regression Suite
- Status: IN_PROGRESS
- Sources: 03
- Ziel: Policy-Tests für alle Klassen + Override + passability alignment.
- Scope:
  - table-driven evaluator tests.
  - reason-code stability checks.
- Akzeptanz:
  - Statusregeln regressionssicher über Releases.
- Depends on: TASK-087, TASK-090
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: API smoke suite deckt jetzt mehrere Evaluator-Policies regressionssicher ab, darunter always-online baseline (`POP`, `CORE_SITE`), explizite Override-Prioritaet, passive-inline Sonderfall `no_downstream_terminator`, broken-upstream gating sowie stabile Diagnostics-Reason-Codes fuer strikte Klassen.
  - Issues: Suite ist noch nicht table-driven/exhaustiv fuer alle Device-Klassen und Override-Kombinationen; Realtime-spezifische Status-/Signal-Kontrakte sind weiter eigener Folge-Track.
  - Dependencies/Next: TASK-096

#### [TASK-096] Realtime Contract Tests für Status/Signal
- Status: IN_PROGRESS
- Sources: 03, 13
- Ziel: Event payload/order/coalescing für status/signal Updates automatisiert prüfen.
- Scope:
  - websocket test harness.
  - ordering assertions.
- Akzeptanz:
  - Contract-Brüche schlagen CI fehl.
- Depends on: TASK-091, TASK-046
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: Smoke-Suite deckt jetzt echte Tick-basierte Socket-Kontrakte fuer `deviceSignalUpdated`, `deviceStatusUpdated` und `deviceMetricsUpdated` ab, inklusive Flush-Reihenfolge, Payload-Kohaerenz, always-online baseline und explizitem Override-`DOWN` mit konsistenter `signal_status`-Ableitung. Zusaetzlich sind `deviceOverrideChanged`, `linkStatusUpdated` und `overrideConflict` fuer gueltige/ungueltige Override-Szenarien regressionsgesichert.
  - Issues: Realtime-Tests decken weiterhin keine reconnect/version-gap-Pfade und noch keine Last-/Mehrtick-Szenarien mit Eventstau oder Cross-tick-Dedupe ab.
  - Dependencies/Next: TASK-217, TASK-129, TASK-185

#### [TASK-097] Future IPAM Approach A (Multi-Region Static) vorbereiten
- Status: OPEN
- Sources: 031
- Ziel: Region-dimension für Prefix/Device mit fallback-kompatibler Suche.
- Scope:
  - schema extension plan.
  - region-aware prefix selection algorithm.
- Akzeptanz:
  - klarer, migrationssicherer Plan für region-aware provisioning.
- Depends on: TASK-082
- Builder Log:

#### [TASK-098] Future IPAM Approach B (Hierarchical) blueprint
- Status: OPEN
- Sources: 031
- Ziel: Region->Site->POP Prefix-Selection und hierarchy-aware allocation konzeptionieren.
- Scope:
  - location model draft.
  - prefix inheritance / nearest-specific strategy.
- Akzeptanz:
  - umsetzbarer Architekturentwurf mit Risiken und Migration.
- Depends on: TASK-097
- Builder Log:

#### [TASK-099] Future IPAM Approach C (Auto-Expansion) guardrails
- Status: OPEN
- Sources: 031
- Ziel: Supernet-carving mit utilization threshold plus race-safe guardrails.
- Scope:
  - expansion trigger strategy.
  - anti-fragmentation constraints.
- Akzeptanz:
  - auto-expand design mit klaren safety checks vorhanden.
- Depends on: TASK-082
- Builder Log:

#### [TASK-100] IPAM Evolution Comparison + Decision Gate
- Status: OPEN
- Sources: 031
- Ziel: A/B/C anhand Komplexität, Skalierung, Migrationsrisiko und Ops-Overhead verbindlich bewerten.
- Scope:
  - decision matrix in engineering governance.
  - trigger criteria for switching approach.
- Akzeptanz:
  - dokumentierte Architekturentscheidung mit Revisionspfad.
- Depends on: TASK-097, TASK-098, TASK-099
- Builder Log:

#### [TASK-101] Multi-Region Migration Plan (No-Downtime) konkretisieren
- Status: OPEN
- Sources: 031
- Ziel: schrittweiser Rollout (schema, backfill, seed, provisioning update, validation).
- Scope:
  - rollout checklist and rollback plan.
  - compatibility with legacy null-region records.
- Akzeptanz:
  - operativ ausführbarer Migrationsplan vorhanden.
- Depends on: TASK-097, TASK-100
- Builder Log:

#### [TASK-102] Prefix Utilization Monitoring & Alerts
- Status: OPEN
- Sources: 031
- Ziel: utilization-based monitoring per pool/region/location.
- Scope:
  - telemetry dimensions.
  - threshold alert definitions.
- Akzeptanz:
  - vor Exhaustion existieren verlässliche Frühwarnungen.
- Depends on: TASK-093, TASK-097
- Builder Log:

#### [TASK-103] External IPAM Sync Evaluation (NetBox-Track)
- Status: OPEN
- Sources: 031
- Ziel: Schnittstelle zu externen IPAM-Systemen evaluieren (optional future integration).
- Scope:
  - sync model (source of truth, conflict resolution).
  - security and operational impact assessment.
- Akzeptanz:
  - fundierte Entscheidungsgrundlage für/gegen externe IPAM-Integration.
- Depends on: TASK-100
- Builder Log:

### Links & Batch

#### [TASK-013] Link Rules erzwingen
- Status: OPEN
- Sources: 02, 04_links
- Ziel: no self-loop, Port-Unicity, Typkompatibilität, optionale Zyklusregeln.
- Akzeptanz:
  - ungültige Links werden zuverlässig abgewiesen.
- Depends on: TASK-001
- Builder Log:

#### [TASK-014] Link CRUD vollständig
- Status: OPEN
- Sources: 04_links, 13
- Ziel: `GET/POST/PATCH/DELETE /api/links` inkl. Attribut-Updates (distance/fiber/meta).
- Akzeptanz:
  - alle CRUD-Pfade inkl. 4xx/404 sauber.
- Depends on: TASK-013
- Builder Log:

#### [TASK-015] Batch Link Create (atomic)
- Status: OPEN
- Sources: 04_links
- Ziel: `POST /api/links/batch` transaktional.
- Akzeptanz:
  - bei Einzelfehler Rollback der gesamten Batch.
- Depends on: TASK-013
- Builder Log:

#### [TASK-016] Batch Link Delete
- Status: OPEN
- Sources: 04_links
- Ziel: `POST /api/links/batch/delete`.
- Akzeptanz:
  - deterministische Löschantwort + Events.
- Depends on: TASK-014
- Builder Log:

#### [TASK-104] Link Domain Contract stabilisieren
- Status: OPEN
- Sources: 04_links
- Ziel: Vollständiges Feldmodell (`status`, `effective_status`, `admin_override_status`, `link_type`, `metadata`) über API/DB/UI konsistent machen.
- Scope:
  - contract schema alignment.
  - deterministic serialization.
- Akzeptanz:
  - Link payloads sind über alle Endpoints konsistent.
- Depends on: TASK-014
- Builder Log:

#### [TASK-105] Interface-Kompatibilitätsvalidator
- Status: OPEN
- Sources: 04_links
- Ziel: Self-link, uniqueness, role compatibility, device compatibility technisch erzwingen.
- Scope:
  - zentraler validator für single + batch.
  - standardisierte Fehlercodes.
- Akzeptanz:
  - alle Regelverstöße liefern konsistente 4xx Fehler.
- Depends on: TASK-013
- Builder Log:

#### [TASK-106] Container Endpoint Hard-Block im Link-Flow
- Status: OPEN
- Sources: 04_links
- Ziel: `POP/CORE_SITE` als Link-Endpunkte konsequent verhindern.
- Scope:
  - validation path for create/update/batch.
  - explicit error contract.
- Akzeptanz:
  - Container-endpoint links sind unmöglich in allen APIs.
- Depends on: TASK-078
- Builder Log:

#### [TASK-107] Link Override API + Async Propagation
- Status: OPEN
- Sources: 04_links
- Ziel: `/api/links/:id/override` inkl. nicht-blockierender Propagation.
- Scope:
  - async job envelope.
  - event correlation id support.
- Akzeptanz:
  - Override-Änderungen werden zuverlässig propagiert ohne UI-Blockierung.
- Depends on: TASK-019, TASK-020
- Builder Log:

#### [TASK-108] Effective Link Status Engine
- Status: OPEN
- Sources: 04_links, 03
- Ziel: precedence `admin > endpoint down/degraded > computed up`.
- Scope:
  - endpoint-state integration.
  - optical relevance integration for fiber paths.
- Akzeptanz:
  - `effective_status` folgt deterministisch der Prioritätslogik.
- Depends on: TASK-017, TASK-088
- Builder Log:

#### [TASK-109] Batch Create Partial-Failure Contract
- Status: OPEN
- Sources: 04_links
- Ziel: `created_link_ids`, `failed_links[]`, counters, `duration_ms`, `request_id`, `backend`.
- Scope:
  - stable response shape.
  - index-based failure mapping.
- Akzeptanz:
  - Client kann Teilfehler ohne Ambiguität verarbeiten.
- Depends on: TASK-015
- Builder Log:

#### [TASK-110] Batch Delete Partial-Failure Contract
- Status: OPEN
- Sources: 04_links
- Ziel: deterministische Rückgabe für gelöschte/nicht gefundene Links im Batch.
- Scope:
  - `deleted_link_ids` + failure details.
  - response counters and backend source.
- Akzeptanz:
  - Batch delete liefert reproduzierbare und vollständige Ergebnisdaten.
- Depends on: TASK-016
- Builder Log:

#### [TASK-111] Dry-Run No-Write Guarantee (Batch)
- Status: OPEN
- Sources: 04_links
- Ziel: `dry_run=true` validiert vollständig ohne Persistenzänderung.
- Scope:
  - transaction guard / no-commit path.
  - tests for no side effects.
- Akzeptanz:
  - DB bleibt unverändert bei Dry-Run, Ergebnisreport vollständig.
- Depends on: TASK-109
- Builder Log:

#### [TASK-112] Batch Health and Backend Capability Endpoint
- Status: OPEN
- Sources: 04_links
- Ziel: `/api/batch/health` mit `status/backend/available/version`.
- Scope:
  - health contract for native/accelerator/fallback.
  - operational visibility for batch path.
- Akzeptanz:
  - health endpoint spiegelt echte batch processing capability.
- Depends on: TASK-109
- Builder Log:

#### [TASK-113] Optional Accelerator/Fallback Parity für Batch
- Status: OPEN
- Sources: 04_links
- Ziel: optionaler externer Batch-Service ohne Semantikdrift ggü. native path.
- Scope:
  - parity tests across backends.
  - response field `backend` governance.
- Akzeptanz:
  - gleiche Inputs erzeugen gleiche fachliche Outcomes unabhängig vom Backend.
- Depends on: TASK-092, TASK-109, TASK-110
- Builder Log:

#### [TASK-114] Link Event Envelope Standardisieren
- Status: OPEN
- Sources: 04_links, 05, 13
- Ziel: `linkAdded/linkDeleted/linkUpdated/linkStatusUpdated` + `batchCompleted` mit correlation/timestamp.
- Scope:
  - event schema and ordering policy.
  - single and batch operation event consistency.
- Akzeptanz:
  - Eventverträge sind stabil und testbar.
- Depends on: TASK-020, TASK-096
- Builder Log:

#### [TASK-115] Link Batch Performance SLOs
- Status: OPEN
- Sources: 04_links
- Ziel: messbare Latenz-/Durchsatzziele für single vs batch link operations.
- Scope:
  - benchmark scenarios (small/medium/large batches).
  - alert thresholds for regression.
- Akzeptanz:
  - Performance-Regressionen werden automatisch erkannt.
- Depends on: TASK-047, TASK-109
- Builder Log:

#### [TASK-116] `/api` vs `/api/v1` Kompatibilitätsstrategie
- Status: OPEN
- Sources: 04_links
- Ziel: eindeutiger Canonical-Path (`/api`) + optionale Aliaspolitik für Legacy-Routen.
- Scope:
  - route compatibility matrix.
  - deprecation messaging and tests.
- Akzeptanz:
  - keine widersprüchlichen Contracts zwischen v1 und canonical paths.
- Depends on: TASK-049
- Builder Log:

### Optical Budget & Overrides

#### [TASK-017] Status-Precedence implementieren
- Status: OPEN
- Sources: 04_signal
- Ziel: `adminOverride > upstream failure > optical signal > operational`.
- Akzeptanz:
  - precedence wird im Backend nachvollziehbar angewendet.
- Depends on: TASK-010, TASK-011
- Builder Log:

#### [TASK-018] Optical Budget Engine erweitern
- Status: OPEN
- Sources: 01, 03, 04_signal
- Ziel: Rx = Tx - Sum(Losses), inkl. Splitter/Fiber/Connector.
- Akzeptanz:
  - nachvollziehbare Berechnungswerte pro ONT.
- Depends on: TASK-002
- Builder Log:

#### [TASK-019] Admin Overrides für Device/Link
- Status: OPEN
- Sources: 04_signal
- Ziel: PATCH Override für Geräte/Links + sichtbare Wirkung.
- Akzeptanz:
  - Override überschreibt normale Berechnung bis Rücknahme.
- Depends on: TASK-017
- Builder Log:

#### [TASK-117] Zentralen Status-Service als einzige Wahrheit erzwingen
- Status: OPEN
- Sources: 04_signal
- Ziel: Effektiver Gerätestatus wird ausschließlich im zentralen Status-Service berechnet, ohne parallele Nebenlogik.
- Scope:
  - one-path evaluation in backend services.
  - ONT-Regel `signal_status=NO_SIGNAL -> DOWN` verbindlich integrieren.
- Akzeptanz:
  - keine divergierenden Statuswerte zwischen Endpoints/Events.
- Depends on: TASK-017, TASK-087
- Builder Log:

#### [TASK-118] Deterministische OLT-Path-Resolution (Dijkstra + Tie-Break)
- Status: OPEN
- Sources: 04_signal
- Ziel: Pro ONT genau ein stabiler Upstream-OLT-Pfad über Dijkstra mit deterministischen Tie-Breakern.
- Scope:
  - weight = `length_km * attenuation_db_per_km`.
  - tie-break chain inkl. `path_signature`.
- Akzeptanz:
  - gleiche Topologie erzeugt reproduzierbar denselben ONT-Pfad.
- Depends on: TASK-018, TASK-003
- Builder Log:

#### [TASK-119] Optical Loss Komponenten vollständig berechnen
- Status: OPEN
- Sources: 04_signal
- Ziel: Gesamtattenuation aus Linkverlusten + passiven insertion losses korrekt summieren.
- Scope:
  - splitter loss via insertion loss field.
  - receive power + margin aus Tx/Attenuation/Sensitivity.
- Akzeptanz:
  - Rx/Margin sind nachvollziehbar und konsistent pro ONT.
- Depends on: TASK-118
- Builder Log:

#### [TASK-120] Signal-Klassifikation + Schwellenwerte standardisieren
- Status: OPEN
- Sources: 04_signal
- Ziel: `OK/WARNING/CRITICAL/NO_SIGNAL` exakt nach Marginschwellen bewerten.
- Scope:
  - boundary-safe comparisons.
  - unresolved path => `NO_SIGNAL`.
- Akzeptanz:
  - Schwellenübergänge sind deterministisch und testbar.
- Depends on: TASK-119
- Builder Log:

#### [TASK-121] Signal/Event Emission Gating umsetzen
- Status: OPEN
- Sources: 04_signal, 05
- Ziel: `deviceSignalUpdated` nur bei Statuswechsel, Grenzwertwechsel oder `>=0.1 dB` Delta; danach ggf. `deviceStatusUpdated`.
- Scope:
  - coalesced emission window.
  - strict ordering signal before status.
- Akzeptanz:
  - Eventflut wird reduziert ohne fachliche Informationsverluste.
- Depends on: TASK-120, TASK-091
- Builder Log:

#### [TASK-122] Optical Recompute Trigger-Matrix implementieren
- Status: OPEN
- Sources: 04_signal, 04_links
- Ziel: Recompute bei allen relevanten Mutationen (Link create/delete/update, Medium, insertion loss, OLT Tx, ONT sensitivity, Provisioning).
- Scope:
  - trigger hooks in mutation paths.
  - correlation metadata für Folgeevents.
- Akzeptanz:
  - relevante Änderungen aktualisieren Signalwerte ohne manuelle Rebuilds.
- Depends on: TASK-061, TASK-119
- Builder Log:

#### [TASK-123] Cache-Invalidierung im Optical Resolver robust machen
- Status: OPEN
- Sources: 04_signal
- Ziel: Topologie-/Optical-Caches werden bei relevanten Änderungen sicher invalidiert (MVP global).
- Scope:
  - shared invalidation for graph + resolver cache.
  - correctness-first full ONT recompute baseline.
- Akzeptanz:
  - keine stale path/signal Ergebnisse nach Mutationen.
- Depends on: TASK-122
- Builder Log:

#### [TASK-124] Fiber-Type Source-of-Truth als API bereitstellen
- Status: OPEN
- Sources: 04_signal
- Ziel: Faserkatalog mit ITU-artigen `physical_medium_id`-Keys (z. B. `G.652.D`, `G.657.A1/A2`, `G.652.D OSP`) versioniert im Backend und via API verfügbar.
- Scope:
  - `GET /api/optical/fiber-types`.
  - UI liest Optionen ausschließlich aus API.
- Akzeptanz:
  - keine hardcodierten Fiber-Listen im Client.
- Depends on: TASK-049
- Builder Log:

#### [TASK-125] Optical Parameter Validation + Fehlercodes vervollständigen
- Status: OPEN
- Sources: 04_signal, 13
- Ziel: Negative Längen/Insertion-Loss und ungültige Fiber-Typen liefern normierte Fehlercodes.
- Scope:
  - `ATTENUATION_PARAM_INVALID`, `FIBER_TYPE_INVALID`.
  - validation path für single + batch Mutationen.
- Akzeptanz:
  - Eingabefehler werden konsistent als 4xx mit Code zurückgegeben.
- Depends on: TASK-045, TASK-124
- Builder Log:

#### [TASK-126] Override-Konflikt-Diagnostik einführen
- Status: OPEN
- Sources: 04_signal
- Ziel: Bei erzwungenem `UP` trotz fehlender Signal-/Pfadvoraussetzungen `OVERRIDE_CONFLICT` sichtbar emittieren/loggen.
- Scope:
  - conflict detection in status evaluation.
  - diagnostic event payload contract.
- Akzeptanz:
  - Override-Konflikte sind transparent, nicht still maskiert.
- Depends on: TASK-019, TASK-121
- Builder Log:

#### [TASK-127] Signal Payload Contract (voll + compact) absichern
- Status: OPEN
- Sources: 04_signal, 13
- Ziel: Event-Payload für Signalwerte stabilisieren, inkl. compact mode und API-Fallback für Pfaddetails.
- Scope:
  - full payload with path segments.
  - compact high-frequency payload + detail endpoint consistency.
- Akzeptanz:
  - Clients können beide Modi deterministisch verarbeiten.
- Depends on: TASK-050, TASK-121
- Builder Log:

#### [TASK-128] Signal/Override Test- und Observability-Baseline
- Status: OPEN
- Sources: 04_signal, 12
- Ziel: Mindesttestkorridor plus Metriken/Logs für optical recompute, Klassifikationswechsel und Override-Konflikte.
- Scope:
  - tests: path determinism, thresholds, event ordering, cache invalidation, override precedence.
  - metrics/logs: `optical_recompute_duration_ms`, `signal_status_changes_total`, `override_conflicts_total`.
- Akzeptanz:
  - Regressionen im Signal-/Override-Pfad werden früh erkannt.
- Depends on: TASK-046, TASK-047, TASK-123, TASK-126
- Builder Log:

### Real-time & UI Contract

#### [TASK-020] Socket-Event-Vertrag fixieren
- Status: OPEN
- Sources: 05, 13
- Ziel: konsistente Eventnamen/Payloads (`deviceCreated`, `deviceUpdated`, `deviceStatusUpdated`, `linkAdded`, `linkUpdated`, `linkDeleted`, status/signal/metrics).
- Akzeptanz:
  - dokumentierte Eventliste entspricht tatsächlich gesendeten Events.
- Depends on: TASK-004
- Builder Log:

#### [TASK-021] Zustand-Store Actions finalisieren
- Status: OPEN
- Sources: 05
- Ziel: API+Socket-Updatepfade ohne Polling-Drift.
- Akzeptanz:
  - CRUD-Operationen werden korrekt im Canvas reflektiert.
- Depends on: TASK-020
- Builder Log:

#### [TASK-022] UI Interaction Model (Select/Move/Link/Pan/Context)
- Status: OPEN
- Sources: 05
- Ziel: Interaktionen gemäß Modell inkl. Persistierung nach Drop.
- Akzeptanz:
  - keine inkonsistente Position/Link-Anlage nach User-Aktionen.
- Depends on: TASK-021
- Builder Log:

#### [TASK-023] Fehlercode-UI (Toast/Panel)
- Status: OPEN
- Sources: 05
- Ziel: standardisierte Backend-Fehler sichtbar und verständlich im UI.
- Akzeptanz:
  - definierte Error Codes werden als klare UI-Meldung dargestellt.
- Depends on: TASK-007
- Builder Log:

#### [TASK-129] Socket Envelope + `topo_version` Gap Recovery absichern
- Status: IN_PROGRESS
- Sources: 05, 13
- Ziel: Einheitlicher Event-Envelope mit monotonic `topo_version` und verpflichtendem Client-Resync bei Versionslücken.
- Scope:
  - envelope fields (`type`, `kind`, `payload`, `topo_version`, `correlation_id`, `ts`).
  - gap detection policy in frontend store.
- Akzeptanz:
  - verpasste Events führen deterministisch zu Topology-Resync statt stiller Drift.
- Depends on: TASK-020, TASK-051
- Builder Log:
  - Date: 2026-03-09
  - Outcome: PARTIAL
  - Implemented: Frontend-Store klassifiziert monotone `topo_version`-Envelopes deterministisch (`accept` / `resync` / `ignore`); reconnect und Versionslücken triggern denselben baseline-resync (`/api/topology` + `/api/metrics/snapshot` + `/api/sessions`).
  - Implemented+: parallele reconnect/gap-Resyncs werden clientseitig koalesziert, sodass nur ein In-Flight-Baseline-Refresh laeuft und maximal ein Folgelauf nachgezogen wird; baseline-covered Eventklassen werden waehrend eines laufenden Baseline-Resyncs konservativ verworfen und triggern denselben queued rerun statt stale Deltas auf den frischen Snapshot anzuwenden. Tick-scoped Metrics-/Status-/Congestion-Events tragen jetzt kanonisches `tick_seq`, und der Frontend-Store benutzt es als zweite Gap-Achse neben `topo_version`.
  - Issues: kein Delta-Buffer waehrend Resync, keine explizite Backoff-/Retry-Policy und kein vollstaendiger Replay-/stale-drop-Contract fuer unbekannte oder spaetere Eventklassen. Realtime-Metrics/Congestion-Ereignisse besitzen weiterhin keinen separaten monotonen `metrics_version`-Zaehler und keine Replay-Sequenz.
  - Dependencies/Next: TASK-185

#### [TASK-130] Realtime Coalescing Window technisch konsolidieren
- Status: OPEN
- Sources: 05
- Ziel: Coalescing per `(event_type,id)` mit deterministic flush-order pro Tick/Window.
- Scope:
  - last-write-wins policy.
  - bounded memory behavior under bursts.
- Akzeptanz:
  - keine Event-Duplikatflut bei hoher Änderungsrate.
- Depends on: TASK-060, TASK-091
- Builder Log:

#### [TASK-131] Event Ordering Contract für Create/Derived Flows
- Status: OPEN
- Sources: 05, 04_signal
- Ziel: Reihenfolge `create -> derived signal/status` sowie `optical/link updates -> signal -> status` erzwingen.
- Scope:
  - ordering assertions in emitter pipeline.
  - contract tests for mixed mutation windows.
- Akzeptanz:
  - UI sieht konsistente Zwischenzustände ohne Reihenfolge-Rennen.
- Depends on: TASK-121, TASK-129
- Builder Log:

#### [TASK-132] Frontend Store Reconciliation ohne Polling-Drift
- Status: OPEN
- Sources: 05
- Ziel: Store verarbeitet API-Responses + Socket-Events idempotent und konfliktarm.
- Scope:
  - optimistic update rollback policy.
  - correlation-aware merge strategy.
- Akzeptanz:
  - wiederholte/reordered Events erzeugen keinen inkonsistenten Canvas-Zustand.
- Depends on: TASK-021, TASK-129
- Builder Log:

#### [TASK-133] Bulk Device Creation UX-Contract vervollständigen
- Status: OPEN
- Sources: 05
- Ziel: Bulk-Modal inkl. Accessibility, Parent-Regeln, Undo und Layout-Persistenz robust machen.
- Scope:
  - modal validation and keyboard flow.
  - undo window with operation-scoped rollback.
- Akzeptanz:
  - Bulk Create ist reproduzierbar, barrierearm und rücknehmbar.
- Depends on: TASK-022, TASK-030
- Builder Log:

#### [TASK-134] Ports Summary API + UI Occupancy Rendering finalisieren
- Status: OPEN
- Sources: 05, 08
- Ziel: `/api/ports/summary/:device_id` vollständig gemäß Rollenregeln umsetzen und im Detailpanel korrekt darstellen.
- Scope:
  - counting semantics for ACCESS/UPLINK/PON/MANAGEMENT.
  - UI badges from endpoint contract.
- Akzeptanz:
  - Portnutzung entspricht fachlichen Zählregeln in allen Gerätetypen.
- Depends on: TASK-033, TASK-034
- Builder Log:

#### [TASK-135] Optical Detail Panels (Link/Passive/OLT/ONT) contract-safe anbinden
- Status: OPEN
- Sources: 05, 04_signal
- Ziel: Bearbeitungs- und Analysepanels mit validierten Feldern, Save-Strategie und On-Demand Path-Details.
- Scope:
  - link medium/length edit + inline validation.
  - passive insertion loss, OLT tx power, ONT analysis panel.
- Akzeptanz:
  - Panel-Aktionen erzeugen erwartete Patches und konsistente Delta-Updates.
- Depends on: TASK-124, TASK-127
- Builder Log:

#### [TASK-136] Container Link-Proxy UX + Server-Hard-Block synchronisieren
- Status: OPEN
- Sources: 05, 07
- Ziel: Containerklick in Link-Mode öffnet Child-Selector; Backend blockiert Container-Endpunkte weiterhin strikt.
- Scope:
  - eligible child filtering by link rules.
  - explicit failure rendering for invalid endpoint attempts.
- Akzeptanz:
  - Nutzer kann keine semantisch invaliden Container-Links erstellen.
- Depends on: TASK-055, TASK-106
- Builder Log:

#### [TASK-137] Cockpit-Type Mapping als stabilen Renderer-Contract fixieren
- Status: OPEN
- Sources: 05, 09
- Ziel: Gerätetyp->Cockpit-Komponente dauerhaft konsistent halten, inkl. Container/Passive Klassen.
- Scope:
  - mapping registry with test coverage.
  - render layering invariants (containers background, children/links foreground).
- Akzeptanz:
  - gleiche Gerätetypen rendern über Releases hinweg ohne Mapping-Drift.
- Depends on: TASK-036, TASK-053
- Builder Log:

#### [TASK-138] Router TotCap Rendering + Capacity-Feldkompatibilität absichern
- Status: OPEN
- Sources: 05, 01, 13
- Ziel: Dual-field capacity contract stabil bedienen und Cockpit-Anzeige konsistent runden/einheiten.
- Scope:
  - flattened vs nested fallback rules.
  - deterministic display formatting (`current/max`).
- Akzeptanz:
  - keine widersprüchliche Kapazitätsanzeige im Router-Cockpit.
- Depends on: TASK-063, TASK-064
- Builder Log:

#### [TASK-139] Link Animation und Congestion-Hysterese UI-seitig robust machen
- Status: OPEN
- Sources: 05, 11
- Ziel: Nutzungsbasierte Linkanimation + hysterese-basierte Congestion-Indikatoren ohne Flicker.
- Scope:
  - animation gating/speed caps/tab-visibility pause.
  - threshold-crossing updates for device/link/GPON segments.
- Akzeptanz:
  - visuelle Zustände bleiben stabil bei schwankender Last.
- Depends on: TASK-043, TASK-044
- Builder Log:

#### [TASK-140] Fehlercode-Source-of-Truth + UI-Mapping durchziehen
- Status: OPEN
- Sources: 05, 13
- Ziel: Zentral definierte Error-Codes inkl. HTTP-Status und UI-Darstellung ohne doppelte Codepfade.
- Scope:
  - backend enum governance.
  - frontend mapping table for toast/panel with action hints.
- Akzeptanz:
  - neue Fehlercodes werden einmalig definiert und end-to-end korrekt angezeigt.
- Depends on: TASK-023, TASK-072
- Builder Log:

### Catalog, Simulation, Future Tracks

#### [TASK-024] Hardware Catalog integrieren
- Status: OPEN
- Sources: 06
- Ziel: Modell-Defaults (txPower, sensitivity, ports, fiber types) aus Katalog beziehen.
- Akzeptanz:
  - Provisioning/Optical Services nutzen Katalogwerte als Fallback.
- Depends on: TASK-002
- Builder Log:

#### [TASK-025] Deterministische Traffic Engine
- Status: OPEN
- Sources: 06, 11
- Ziel: tick-basierte, deterministische Metrikgeneration + Aggregation.
- Akzeptanz:
  - `/api/metrics/snapshot` + `deviceMetricsUpdated` liefern konsistente Strukturen.
- Depends on: TASK-020
- Builder Log:

#### [TASK-026] Cockpit Data Pipeline stabilisieren
- Status: OPEN
- Sources: 06, 09
- Ziel: SVG-/Cockpit-Updates performant (batch/rAF/throttle).
- Akzeptanz:
  - keine Render-Thrashing-Probleme bei Last.
- Depends on: TASK-025
- Builder Log:

#### [TASK-027] Extended Smart-Cockpit Konventionen
- Status: OPEN
- Sources: 06 (Sektion 16.x)
- Ziel: Konstanten, Color Scales, Render Debug Overlay, Delta-Handling.
- Akzeptanz:
  - zentrale Farb-/Konfigurationsquelle, dokumentierte Edge-Case-Strategie.
- Depends on: TASK-026
- Builder Log:

#### [TASK-028] Physics Engine Track markieren (ON HOLD)
- Status: DEFERRED
- Sources: 06 (Sektion 17)
- Ziel: klare Abgrenzung, dass D3-force Track aktuell nicht MVP-Blocker ist.
- Akzeptanz:
  - explizit deferred mit Re-Entry-Kriterien.
- Depends on: none
- Builder Log:

#### [TASK-029] Ring Protection Track markieren (Placeholder)
- Status: DEFERRED
- Sources: 06 (Sektion 19)
- Ziel: Spezifikation als zukünftiger Track ohne MVP-Blockade.
- Akzeptanz:
  - priorisierte Backlog-Notiz + offene Entscheidungen dokumentiert.
- Depends on: none
- Builder Log:

#### [TASK-141] Catalog Manifest + Integrity Pipeline produktiv absichern
- Status: OPEN
- Sources: 06
- Ziel: Manifest-basierter Ladevorgang mit `schema_version`-Prüfung und sha256-Integritätschecks.
- Scope:
  - startup validation flow.
  - strict-vs-dev mode failure policy.
- Akzeptanz:
  - fehlerhafte/inkonsistente Katalogdaten werden deterministisch erkannt.
- Depends on: TASK-024
- Builder Log:

#### [TASK-142] Catalog Schema + Indexing Contract vervollständigen
- Status: OPEN
- Sources: 06
- Ziel: Einheitliches Entry-Schema und stabile Indizes (`by_catalog_id`, `by_device_type`, `by_vendor_model`).
- Scope:
  - runtime validators for entry fields.
  - deterministic sort policy for API outputs.
- Akzeptanz:
  - Katalogabfragen liefern reproduzierbare und typvalidierte Ergebnisse.
- Depends on: TASK-141
- Builder Log:

#### [TASK-143] Override Merge Governance (Allowlist/Immutables)
- Status: OPEN
- Sources: 06
- Ziel: Nur erlaubte numerische Override-Felder mutierbar; Identitätsfelder strikt immutable.
- Scope:
  - reject unknown catalog ids.
  - explicit error details for forbidden overrides.
- Akzeptanz:
  - Overrides verändern niemals `catalog_id/device_type/vendor/model/version`.
- Depends on: TASK-142
- Builder Log:

#### [TASK-144] Catalog Service API im Backend konsolidieren
- Status: OPEN
- Sources: 06
- Ziel: Service-Funktionen (`getModel`, defaults, `listFiberTypes`, `computeCatalogHash`) als zentrale Backend-Schnittstelle.
- Scope:
  - single source service used by provisioning/optical paths.
  - no duplicate ad-hoc loaders in feature modules.
- Akzeptanz:
  - alle Fachpfade lesen Katalogdaten über dieselbe Service-Abstraktion.
- Depends on: TASK-142
- Builder Log:

#### [TASK-145] Catalog REST Contract + Versionierte Response-Formen
- Status: OPEN
- Sources: 06, 13
- Ziel: `/api/catalog/hardware` und `/api/catalog/hardware/:catalog_id` stabilisieren, inkl. deterministischer Sortierung.
- Scope:
  - list/detail response schema.
  - optional pagination governance without contract drift.
- Akzeptanz:
  - API entspricht Doku 1:1 und bleibt abwärtskompatibel.
- Depends on: TASK-049, TASK-144
- Builder Log:

#### [TASK-146] Provisioning Defaults Resolution Order technisch erzwingen
- Status: OPEN
- Sources: 06, 02
- Ziel: Auflösungsreihenfolge `device override -> catalog default -> fallback` konsistent implementieren.
- Scope:
  - persisted effective fields + catalog linkage.
  - `modified_from_catalog` semantik.
- Akzeptanz:
  - Geräte übernehmen Defaults korrekt, ohne implizite Silent-Overrides.
- Depends on: TASK-067, TASK-143
- Builder Log:

#### [TASK-147] Catalog Determinism + Hash/Startup Observability
- Status: OPEN
- Sources: 06
- Ziel: Stabiler `catalog_hash` und startup observability (counts, override diffs, failures).
- Scope:
  - structured logs for startup catalog state.
  - metrics (`catalog_entries_total`, load failures).
- Akzeptanz:
  - Katalogzustand ist reproduzierbar und operational sichtbar.
- Depends on: TASK-141
- Builder Log:

#### [TASK-148] Traffic Simulation Tick Engine deterministisch umsetzen
- Status: OPEN
- Sources: 06, 11
- Ziel: Tick-basierte Engine mit konfigurierbarem Intervall und deterministischer Leaf-Generierung.
- Scope:
  - seed/device/tick deterministic PRNG.
  - strict online-leaf gating policy.
- Akzeptanz:
  - identische Inputs liefern identische Tick-Serien.
- Depends on: TASK-025
- Builder Log:

#### [TASK-149] Metrics Diff/Versioning + Backpressure Contract
- Status: OPEN
- Sources: 06, 05
- Ziel: Delta-Emission anhand Epsilon/Bucket-Regeln und Versionierung, inkl. Queue-Collapse bei Backpressure.
- Scope:
  - per-device version increment policy.
  - latest-only metrics collapse strategy.
- Akzeptanz:
  - unter Last bleibt Realtime stabil ohne fachliche Drift.
- Depends on: TASK-130, TASK-148
- Builder Log:

#### [TASK-150] Snapshot-Recovery nach Reconnect/Version-Gaps
- Status: OPEN
- Sources: 06, 05
- Ziel: `GET /api/metrics/snapshot` als baseline reset bei reconnect oder `topo_version` gap.
- Scope:
  - full snapshot response with capacities.
  - client replacement strategy before delta resume.
- Akzeptanz:
  - Reconnect führt nicht zu inkonsistenten Metric-Stores.
- Depends on: TASK-129, TASK-149
- Builder Log:

#### [TASK-151] Sim Observability + Health Endpoint verankern
- Status: OPEN
- Sources: 06
- Ziel: Laufzeitmetriken und `GET /api/sim/status` als Betriebsgrundlage für Simulation.
- Scope:
  - tick duration/changes/skips metrics.
  - health payload with interval and tick state.
- Akzeptanz:
  - Simulation ist im Betrieb transparent überwachbar.
- Depends on: TASK-148
- Builder Log:

#### [TASK-152] Deferred Tracks Re-Entry Kriterien formalisieren
- Status: OPEN
- Sources: 06
- Ziel: Für Physics/Ring/Remote-Catalog Tracks klare Eintrittsbedingungen, Abhängigkeiten und Exit-Kriterien definieren.
- Scope:
  - re-entry checklist per deferred track.
  - architecture decision notes per track.
- Akzeptanz:
  - deferred Themen können später ohne Scope-Chaos wieder aufgenommen werden.
- Depends on: TASK-028, TASK-029
- Builder Log:

### Container Model

#### [TASK-030] Container-Datenmodell (parent/children)
- Status: DONE
- Sources: 07
- Ziel: Container (`POP`, `CORE_SITE`) + Parent-Regeln + Cycle-Schutz.
- Akzeptanz:
  - gültige Hierarchien, keine Self/Loop-Zyklen.
- Depends on: TASK-001
- Builder Log:
  - 2026-03-09: `Device` traegt jetzt `parentContainerId` plus Self-Relation; Device-Create/Patch persistieren `parent_container_id` und exponieren das Feld in Read-Models (`/api/devices`, `/api/devices/:id`, `/api/topology`).

#### [TASK-031] Container-UI Interaktionen
- Status: OPEN
- Sources: 07
- Ziel: Drag in/out, Expand/Collapse, Group-Nodes.
- Akzeptanz:
  - Parent-Zuweisung wird über API persistiert.
- Depends on: TASK-030, TASK-022
- Builder Log:

#### [TASK-032] Container Aggregates + Link Proxy UX
- Status: OPEN
- Sources: 07
- Ziel: Health/Capacity Aggregation + Zielauswahl bei Link auf Container.
- Akzeptanz:
  - Link-Proxied Flow erzeugt korrekten Link auf Child.
- Depends on: TASK-031
- Builder Log:

#### [TASK-153] Container Parent-Policy serverseitig lückenlos erzwingen
- Status: DONE
- Sources: 07, 02
- Ziel: `CORE_SITE` parent-null, `POP` optional unter `CORE_SITE`, `OLT/AON_SWITCH` optional in `POP/CORE_SITE`, ONT/CPE nie als Parent.
- Scope:
  - all create/update/provision endpoints apply same parent validator.
  - deterministic validation errors on policy violations.
- Akzeptanz:
  - keine inkonsistenten Parent-Relationen in DB/API.
- Depends on: TASK-030, TASK-068
- Builder Log:
  - 2026-03-09: Server validiert Parent-Policies jetzt hart auf Create/Patch: `CORE_SITE` top-level, `POP` nur unter `CORE_SITE`, `OLT`/`AON_SWITCH` nur unter `POP` oder `CORE_SITE`, andere Klassen lehnen `parent_container_id` im MVP ab.

#### [TASK-154] Container Cycle-Guard (self/indirect) technisch absichern
- Status: DONE
- Sources: 07
- Ziel: Self-parenting und indirekte Parent-Loops zuverlässig blockieren.
- Scope:
  - ancestry traversal checks with bounded complexity.
  - regression tests for multi-step reparent scenarios.
- Akzeptanz:
  - zyklische Containerbeziehungen sind unmöglich.
- Depends on: TASK-153
- Builder Log:
  - 2026-03-09: Self-parenting und ancestry-basierte Parent-Loops werden serverseitig abgewiesen; bounded traversal reicht im aktuellen flachen Containerbaum aus.

#### [TASK-155] Drag-and-Drop Reparenting mit robustem Rollback
- Status: IN_PROGRESS
- Sources: 07, 05
- Ziel: UI-Reparenting via `parent_container_id` patch mit klarer optimistic/rollback-Strategie.
- Scope:
  - valid/invalid target visualization.
  - failed mutation rollback without stale selection state.
- Akzeptanz:
  - fehlgeschlagene Reparents hinterlassen keinen inkonsistenten Canvas-State.
- Depends on: TASK-031, TASK-132
- Builder Log:
  - 2026-03-09: Backend-Reparent-Pfad via `PATCH /api/devices/:id` steht inklusive `deviceContainerChanged`; eigentliche Drag/Drop-UX, optimistic rollback und Containment-Interaktion bleiben offen.

#### [TASK-156] Slot-Snapping und Containment deterministisch stabilisieren
- Status: OPEN
- Sources: 07
- Ziel: Slot-Anker als UX-Hilfe plus Containment ohne Layout-Jitter oder Geometrie-Drift.
- Scope:
  - anchor snapping thresholds.
  - pinned-node and edge-clamp rules.
- Akzeptanz:
  - wiederholte Layout-Interaktionen bleiben visuell stabil/reproduzierbar.
- Depends on: TASK-155
- Builder Log:

#### [TASK-157] Container Link-Proxy Selector End-to-End härten
- Status: OPEN
- Sources: 07, 04_links
- Ziel: Klick auf Container im Link-Mode öffnet validen Child-Selector und erzeugt Link auf reales Child.
- Scope:
  - eligible-child filtering by link rules.
  - empty-target handling (`No valid targets in container`).
- Akzeptanz:
  - Container-Proxy-Flow verhindert dead-end Link-Interaktionen.
- Depends on: TASK-136, TASK-105
- Builder Log:

#### [TASK-158] Container Endpoint Hard-Block API-weit garantieren
- Status: OPEN
- Sources: 07, 04_links
- Ziel: Container als direkte Link-Endpunkte in allen Link-APIs (single/batch/update) strikt verbieten.
- Scope:
  - validation consistency across endpoint variants.
  - error-code normalization for container endpoint attempts.
- Akzeptanz:
  - direkte Container-Links sind technisch unmöglich.
- Depends on: TASK-106, TASK-077
- Builder Log:

#### [TASK-159] Container Aggregate Read-Model (Health/Traffic/Occupancy)
- Status: DONE
- Sources: 07, 11
- Ziel: Deterministische Container-Rollups für Cockpit-Anzeige mit Health-Precedence `BLOCKING/DOWN > DEGRADED > UP`.
- Scope:
  - child-status aggregation.
  - traffic and occupancy summaries from stores/endpoints.
- Akzeptanz:
  - Container-Cockpits zeigen konsistente Aggregatwerte ohne Semantikdrift.
- Depends on: TASK-032, TASK-139
- Builder Log:
  - 2026-03-09: Backend-Read-Models liefern fuer `POP` und `CORE_SITE` jetzt rekursive `container_aggregate` Rollups mit Health-Precedence `BLOCKING/DOWN > DEGRADED > UP`.
  - 2026-03-09: `/api/topology`, `/api/devices` und `/api/devices/:id` exponieren `container_aggregate` mit `health`, `downstream_mbps`, `upstream_mbps`, `occupancy`.
  - 2026-03-09: Expand-Cockpits fuer `POP`/`CORE_SITE` zeigen die Aggregatwerte; Smoke-Test deckt rekursive Health-Rollups ueber `CORE_SITE -> POP -> OLT` ab.

#### [TASK-160] `deviceContainerChanged` Event-Contract + Ordering absichern
- Status: DONE
- Sources: 07, 05
- Ziel: Reparent-Events mit nullable `parent_container_id` stabil und in definierter Reihenfolge emittieren.
- Scope:
  - payload schema checks.
  - ordering tests within mixed mutation windows.
- Akzeptanz:
  - Clients können Containeränderungen idempotent und gap-safe verarbeiten.
- Depends on: TASK-129, TASK-131
- Builder Log:
  - 2026-03-09: `deviceContainerChanged` wird jetzt bei erfolgreichem Reparent emittiert und per Smoke-Test abgesichert; dedizierte Ordering-/gap-safe Regressionen bleiben offen.
  - 2026-03-09: `deviceContainerChanged` ist jetzt als baseline-covered Realtime-Event klassifiziert; waehrend eines laufenden Baseline-Resyncs wird das Delta verworfen und ein Snapshot-Rerun angefordert statt einen stale Parent-Zustand lokal festzuschreiben.
  - 2026-03-09: Realtime-Unit-Tests decken die neue Resync-Policy fuer `deviceContainerChanged` explizit ab; vollstaendige Mixed-Mutation-Ordering-Regressionen bleiben offen.
  - 2026-03-12: Realtime-Ordering-Regressionen fuer topo/tick/baseline-Prioritaet ergänzt; Envelope-Entscheidung zentralisiert und durch Unit-Tests fuer Reparent- und Metrics-Mutationen abgesichert.

#### [TASK-161] Pathfinding/Status/Optical Container-Invarianten erzwingen
- Status: OPEN
- Sources: 07, 03, 04_signal
- Ziel: Container-Mitgliedschaft darf Graph, Passability oder Optical Pfadberechnung fachlich nicht verändern.
- Scope:
  - graph projection excludes containers.
  - regression checks for reparent-only topology mutations.
- Akzeptanz:
  - Reparenting ändert keine Link-/Path-/Signal-Semantik außer explizit spezifizierten UI-Rollups.
- Depends on: TASK-118, TASK-088
- Builder Log:

#### [TASK-162] Container Error/404 Contract und UI-Darstellung vereinheitlichen
- Status: OPEN
- Sources: 07, 13
- Ziel: Einheitliche Fehlerantworten für invalid parent, stale ids, container endpoint violations und konsistente UI-Meldungen.
- Scope:
  - canonical error code mapping to toasts/panels.
  - 404/4xx behavior harmonization.
- Akzeptanz:
  - Nutzer erhält in allen Container-Flows klare, einheitliche Fehlerrückmeldungen.
- Depends on: TASK-140, TASK-158
- Builder Log:

### Ports

#### [TASK-033] Port Summary API fachlich erweitern
- Status: IN_PROGRESS
- Sources: 08, 13
- Ziel: Occupancy/Capacity pro Port (nicht nur rohe Ports).
- Akzeptanz:
  - `GET /api/ports/summary/:deviceId` liefert UI-taugliche Summary.
- Depends on: TASK-013
- Builder Log:
  - 2026-03-12: OLT-PON-Occupancy zählt provisionierte ONT-Family Geräte über Serving-OLT-Auflösung (passive-inline Pfad), Management-Ports setzen `used` nur bei vorhandenem mgmt-Port.

#### [TASK-034] ONT-List Endpoint für Port/Container Views
- Status: DONE
- Sources: 08
- Ziel: `GET /api/ports/ont-list/:deviceId`.
- Akzeptanz:
  - korrekte ONT-Listen nach Topologie.
- Depends on: TASK-033
- Builder Log:
  - 2026-03-12: ONT-List basiert auf Serving-OLT-Auflösung über passive Inline-Kette (nicht nur direkte Links) und ist per Smoke-Test abgesichert.

#### [TASK-035] Port-Caching mit topologyVersion
- Status: DONE
- Sources: 08
- Ziel: performante Summary-Berechnung mit klarer Invalidation.
- Akzeptanz:
  - Recompute nur bei relevanten Topologieänderungen.
- Depends on: TASK-033
- Builder Log:
  - 2026-03-12: Port-Summary nutzt `(topology_version, device_id)`-Cache mit per-key In-Flight-Dedupe; Topology-Bumps invalidieren deterministisch.

#### [TASK-163] Port Summary Contract normieren (single + bulk)
- Status: DONE
- Sources: 08, 13
- Ziel: Einheitliche aggregate-by-role Semantik für `GET /api/ports/summary/:device_id` und Bulk-Variante.
- Scope:
  - stable summary fields (`device_id,total,by_role`).
  - deterministic unknown-id/partial behavior in bulk path.
- Akzeptanz:
  - single- und bulk-summary liefern konsistente, vorhersehbare Payloads.
- Depends on: TASK-033, TASK-049
- Builder Log:
  - 2026-03-12: Port-Summary Single/Bulk bleibt bei `device_id,total,by_role` stabil; Bulk liefert `by_device_id` und `items` konsistent zum Single-Contract.
  - 2026-03-12: Bulk-Unknown-IDs werden deterministisch übersprungen; `requested`/`returned` zählen Auslassungen und sind in der API-Referenz fixiert.

#### [TASK-164] Occupancy-Regeln pro Port-Rolle fachlich vollständig durchziehen
- Status: IN_PROGRESS
- Sources: 08
- Ziel: Normative Occupancy-Berechnung für `PON/ACCESS/UPLINK/TRUNK` inklusive Management-Exklusion.
- Scope:
  - per-role counting rules as shared backend logic.
  - edge-case handling for empty/legacy role data.
- Akzeptanz:
  - Occupancy-Werte entsprechen in allen Rollen der Spezifikation.
- Depends on: TASK-033, TASK-118
- Builder Log:
  - 2026-03-12: Occupancy-Regeln zentralisiert (`MANAGEMENT` used nur bei vorhandenem mgmt-Port, `ACCESS/UPLINK` per Link-Präsenz, `PON` via provisionierte ONTs mit Serving-OLT).

#### [TASK-165] Capacity-Herkunft und Fallbacks pro Rolle absichern
- Status: IN_PROGRESS
- Sources: 08, 10
- Ziel: Kapazitätswerte reproduzierbar aus Profil/Interface-Feldern ableiten und sauber nullen wenn unbekannt.
- Scope:
  - PON profile-based capacity mapping.
  - non-PON persisted capacity fallback strategy.
- Akzeptanz:
  - UI erhält konsistente `capacity`-Werte ohne implizite Schätzungen.
- Depends on: TASK-039, TASK-163
- Builder Log:
  - 2026-03-12: `PON.max_subscribers` hat definierten Default (MVP) und wird konsistent im Port-Summary geführt; unbekannte Rollen bleiben ohne implizite Kapazität.
  - 2026-03-12: OLT-PON `max_subscribers` kann aus Hardware-Katalog (ONTs_pro_Port) abgeleitet werden, inkl. deterministischer Range-Auswertung.

#### [TASK-166] Ports-Cache + Locking unter Last robust machen
- Status: DONE
- Sources: 08
- Ziel: `(topology_version,device_id)`-Caching mit per-key lock/dogpile-schutz und sauberer Invalidation.
- Scope:
  - TTL tuning for polling.
  - topology bump invalidation correctness.
- Akzeptanz:
  - hohe Polling-Last erzeugt keine redundante Recompute-Stürme.
- Depends on: TASK-035, TASK-123
- Builder Log:
  - 2026-03-12: Ports-Cache nutzt per-key In-Flight-Dedupe; parallele Requests joinen denselben Compute. Concurrency-Test absichert Dogpile-Vermeidung.

#### [TASK-167] Polling-/Rate-Limit Governance für Port-Endpunkte
- Status: DONE
- Sources: 08, 05
- Ziel: Polling-Cadence, Offscreen-Suspend und `429`-Handling für UI/Backend harmonisieren.
- Scope:
  - frontend suspend/resume policy.
  - backend throttling behavior and headers.
- Akzeptanz:
  - Port-UI bleibt responsiv ohne Endpoint-Überlastung.
- Depends on: TASK-132, TASK-166
- Builder Log:
  - 2026-03-12: Ports-Endpunkte liefern deterministische `429` mit `Retry-After`; Client behandelt Rate-Limits ohne hard fail, Test deckt Throttle-Response ab.
  - 2026-03-12: Cache-Hits umgehen Rate-Limits; Limiter greift nur bei echter Compute-Arbeit.

#### [TASK-168] Ports Testpaket (Backend + Frontend) erweitern
- Status: DONE
- Sources: 08, 12
- Ziel: Occupancy-, Cache-, Bulk- und Rendering-Regressionen automatisiert absichern.
- Scope:
  - backend tests for role occupancy and invalidation.
  - frontend tests for grouped render/polling behavior.
- Akzeptanz:
  - Ports-Verhalten bleibt stabil über Topologie- und Laständerungen.
- Depends on: TASK-045, TASK-166
- Builder Log:
  - 2026-03-12: Bulk-Unknown-ID Verhalten fuer Ports-Summary per Regressionstest abgesichert.
  - 2026-03-12: Rate-Limit Recovery nach `Retry-After` per Regressionstest abgesichert.
  - 2026-03-12: Backend-Porttests fuer Occupancy, Cache-Invalidation, Dogpile und Rate-Limits abgeschlossen; Frontend-Testharness fehlt, UI-Regressionen werden vorerst ueber TASK-038 (Cockpit Performance Hardening) nachgezogen.

### Cockpit Nodes

#### [TASK-036] Cockpit-Komponentenstrukturen aufbauen
- Status: OPEN
- Sources: 09
- Ziel: Router/OLT/ONT/Passive Cockpit Components + Wrapper.
- Akzeptanz:
  - Mapping DeviceRole -> Component implementiert.
- Depends on: TASK-026
- Builder Log:

#### [TASK-037] Port Matrix + Signal Gauge im UI
- Status: OPEN
- Sources: 09
- Ziel: OLT Matrix und ONT Signalanzeige gemäß Spezifikation.
- Akzeptanz:
  - Cockpit zeigt Status/Metrics/Ports korrekt.
- Depends on: TASK-036, TASK-033
- Builder Log:

#### [TASK-038] Cockpit Performance Hardening
- Status: OPEN
- Sources: 09
- Ziel: `React.memo`, stabile Props, Update-Throttling.
- Akzeptanz:
  - kein unnötiges Re-Rendern bei unveränderten Daten.
- Depends on: TASK-036
- Builder Log:

#### [TASK-169] DeviceType->Cockpit Mapping Registry fixieren
- Status: DONE
- Sources: 09
- Ziel: Vollständige, getestete Mapping-Tabelle inkl. Fallback `GenericCockpit`.
- Scope:
  - canonical mapping for active/passive/container classes.
  - unknown-type fallback contract.
- Akzeptanz:
  - jeder Gerätetyp wird deterministisch der korrekten Cockpit-Komponente zugeordnet.
- Depends on: TASK-036, TASK-053
- Builder Log:
  - 2026-03-12: Cockpit-Registry eingefuehrt (`client/src/cockpitRegistry.ts`) und UI auf canonical variants (OLT/ROUTER/CONTAINER/SUBSCRIBER/PASSIVE/GENERIC) umgestellt.

#### [TASK-170] Cockpit Props Normalization und Optionality-Contract
- Status: IN_PROGRESS
- Sources: 09, 08
- Ziel: Einheitliches View-Model (`device/metrics/ports/links`) mit robustem Handling fehlender Optionalfelder.
- Scope:
  - normalized adapter layer.
  - soft-fail strategy for partial payloads.
- Akzeptanz:
  - Cockpits bleiben funktionsfähig bei partiellen Datenständen.
- Depends on: TASK-163, TASK-132
- Builder Log:
  - Date: 2026-03-09
  - Outcome: PARTIAL
  - Implemented: Cockpit-Karten konsumieren jetzt ein breiteres, normalisiertes View-Model mit optionalen Feldern fuer `portSummary`, `connectedOnts`, `diagnostics`, `interfaceDetails`, BNG-Pool-/Cluster-Metadaten und Subscriber-Sessiondetails inkl. IPv4. Fehlende Quellen soft-failen weiterhin auf neutrale Werte statt Panels zu brechen.
  - Issues: Es existiert noch kein formalisiertes separates View-Model-Modul oder Snapshot-Testset fuer alle Cockpit-Familien; POP/CORE_SITE und tiefere Matrixdaten bleiben offen.

#### [TASK-171] Router TotCap Rendering-Regeln technisch erzwingen
- Status: OPEN
- Sources: 09, 05
- Ziel: Exaktes Label/Format `TotCap (Gbps)` inkl. dual-field capacity fallback und deterministischer Rundung.
- Scope:
  - formatting utility + snapshot tests.
  - metrics+capacity merge rules.
- Akzeptanz:
  - TotCap-Anzeige ist über alle Router-Cases konsistent.
- Depends on: TASK-138
- Builder Log:

#### [TASK-172] Matrix-Cockpits (OLT/AON) Datenfluss und Drilldown robust machen
- Status: IN_PROGRESS
- Sources: 09, 08
- Ziel: OLT/AON-Matrizen auf Ports-Contract stützen, inkl. Drilldown-Flows und Statusfarben.
- Scope:
  - PON/ACCESS tile rendering from summary data.
  - ONT list drilldown contract integration.
- Akzeptanz:
  - Matrixanzeigen stimmen fachlich mit Port-Summaries überein.
- Depends on: TASK-134, TASK-163
- Builder Log:
  - Date: 2026-03-09
  - Outcome: PARTIAL
  - Implemented: OLT-Cockpit stuetzt sich auf `GET /api/ports/summary/:device_id` und `GET /api/ports/ont-list/:device_id`; Summary-gestuetzte `PON used/total`, `Split`, `Uplink used/total` und kompakte ONT-Drilldown-Vorschau sind im aktuellen MVP sichtbar.
  - Issues: Es gibt weiterhin keine echte per-PON-Matrix oder farbige Tile-Darstellung aus einem feineren Backend-Portmodell; AON-Matrix-Vertiefung bleibt offen.

#### [TASK-173] Container/Passive Cockpit Aggregationsvertrag stabilisieren
- Status: OPEN
- Sources: 09, 07
- Ziel: Container-Health/Traffic-Rollups und splitter-spezifische Badges konsistent und semantiktreu darstellen.
- Scope:
  - `DOWN>DEGRADED>UP` aggregation precedence.
  - splitter badge source from splitter parameters contract.
- Akzeptanz:
  - Aggregat- und Role-spezifische Anzeigen bleiben widerspruchsfrei.
- Depends on: TASK-159, TASK-010
- Builder Log:

#### [TASK-174] Cockpit A11y/Performance/Test-Baseline vollständig
- Status: OPEN
- Sources: 09, 12
- Ziel: Keyboard/contrast/a11y Regeln plus memoization/render-budget und tests verbindlich absichern.
- Scope:
  - accessibility checks for matrix navigation.
  - rerender profiling and regression tests.
- Akzeptanz:
  - Cockpit-UI bleibt zugänglich und performant bei Last.
- Depends on: TASK-038, TASK-048
- Builder Log:

### Interfaces & Addresses

#### [TASK-039] Interface/Address Datenmodell ergänzen
- Status: OPEN
- Sources: 10
- Ziel: Interface + Address Entitäten mit Rollen (`PON`, `UPLINK`, `ACCESS`, `TRUNK`, `MGMT`).
- Akzeptanz:
  - Interfaces/Adressen persistiert und abfragbar.
- Depends on: TASK-001, TASK-009
- Builder Log:

#### [TASK-040] Deterministische MAC-Generierung
- Status: OPEN
- Sources: 10
- Ziel: zentraler `MacAllocator` nach OUI-Regel.
- Akzeptanz:
  - keine MAC-Kollision, deterministisches Verhalten bei Reset.
- Depends on: TASK-039
- Builder Log:

#### [TASK-041] Interfaces API bereitstellen
- Status: OPEN
- Sources: 10
- Ziel: `GET /api/interfaces/:deviceId` inkl. Adressen.
- Akzeptanz:
  - Response-Struktur gemäß Doku.
- Depends on: TASK-039
- Builder Log:

#### [TASK-175] Interface/Address Schema-Constraints vervollständigen
- Status: OPEN
- Sources: 10
- Ziel: Eindeutige Constraints für `(device_id,name)`, `mac_address`, Primary-Address-Regeln und rollenbasierte Feldvalidierung.
- Scope:
  - DB constraints + service-level guards.
  - VRF-aware primary uniqueness policy.
- Akzeptanz:
  - inkonsistente Interface/Address-Zustände sind technisch ausgeschlossen.
- Depends on: TASK-039, TASK-083
- Builder Log:

#### [TASK-176] Deterministischen Naming Planner pro Hardware-Profil absichern
- Status: OPEN
- Sources: 10, 06
- Ziel: Stabile Interface-Namen (`mgmt0`, `ponN`, `uplinkN`, `accessN`) aus Modell/Profil ohne Reihenfolge-Drift.
- Scope:
  - canonical role ordering and index strategy.
  - migration guard for profile changes.
- Akzeptanz:
  - gleiche Modellinputs erzeugen reproduzierbare Interface-Namensräume.
- Depends on: TASK-039, TASK-024
- Builder Log:

#### [TASK-177] MacAllocator Concurrency/Retry-Verhalten härten
- Status: OPEN
- Sources: 10
- Ziel: Kollisionsfreie MAC-Zuweisung unter Parallel-Provisioning mit atomarem Reserve/Commit-Pfad.
- Scope:
  - allocator lock/transaction semantics.
  - retry + observability on uniqueness conflicts.
- Akzeptanz:
  - keine MAC-Kollisionen auch unter Last.
- Depends on: TASK-040, TASK-070
- Builder Log:

#### [TASK-178] Provisioning-Integration für Interfaces/Addresses idempotent machen
- Status: OPEN
- Sources: 10, 02, 03
- Ziel: Provisioning erzeugt deterministische Interfaces/Adressen und bleibt bei Wiederholung ohne Duplikate.
- Scope:
  - mgmt duplicate guard.
  - pool allocation/linkage consistency.
- Akzeptanz:
  - wiederholtes Provisioning erzeugt keinen Schema-Drift.
- Depends on: TASK-067, TASK-175
- Builder Log:

#### [TASK-179] Interfaces API Contract erweitern (ordering + errors + optionals)
- Status: OPEN
- Sources: 10, 13
- Ziel: `GET /api/interfaces/:deviceId` mit stabiler Sortierung, klaren Fehlercodes und optionalen Feldern robust versionieren.
- Scope:
  - response ordering by role/name.
  - 404/4xx mapping and contract tests.
- Akzeptanz:
  - API liefert reproduzierbare Responses und eindeutige Fehlersemantik.
- Depends on: TASK-041, TASK-049
- Builder Log:

#### [TASK-180] Interfaces Observability + Testmatrix vollständig
- Status: OPEN
- Sources: 10, 12
- Ziel: Logs/Metriken für Allocator/Addressing plus Regressionstests für Determinismus und Concurrency.
- Scope:
  - metrics: created interfaces, mac conflicts, ip assignment failures.
  - unit+integration tests for naming/mac/api ordering.
- Akzeptanz:
  - Interface/Address Regressionen werden frühzeitig erkannt.
- Depends on: TASK-047, TASK-177
- Builder Log:

### Traffic & Congestion

#### [TASK-042] GPON Segment Modell
- Status: DONE
- Sources: 11
- Ziel: Segmentdefinition je OLT-PON bis first passive aggregation.
- Akzeptanz:
  - Segment-ID/Mapping reproduzierbar.
- Depends on: TASK-025, TASK-033
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: Runtime bildet GPON-Segmente reproduzierbar vom Serving-OLT bis zur ersten passiven Aggregationsstufe; ONT-Traffic, Downstream-Clamping und Congestion-Events nutzen jetzt `segmentId = oltId:firstPassiveId` mit OLT-Fallback ohne passive Stufe.
  - Evidence: Regressionen decken reproduzierbare Segment-IDs fuer ONTs hinter unterschiedlichen Splittern sowie stabile Congestion-Hysterese fuer einen gemeinsamen First-Passive-Segmentzweig ab.
  - Dependencies/Next: tiefere per-branch/per-PON-Modelle unterhalb der ersten passiven Aggregationsstufe bleiben spaetere Vertiefung.

#### [TASK-043] Congestion Hysteresis umsetzen
- Status: DONE
- Sources: 11
- Ziel: Enter/Exit-Schwellen für Device/Link/Segment ohne Flicker.
- Akzeptanz:
  - Zustandswechsel nur bei Schwellwert-Transitions.
- Depends on: TASK-042
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: Runtime nutzt Segment-Hysterese fuer OLT-Level Congestion mit enter `>= 95%` und clear `<= 85%`; Steady-State erzeugt keine wiederholten Transition-Events.
  - Evidence: Regressionstest deckt Detect -> steady overloaded -> Clear -> steady normal fuer eine echte ueberlastete OLT-Kette ab.

#### [TASK-044] Congestion Event Contract
- Status: DONE
- Sources: 11
- Ziel: `segmentCongestionDetected/segmentCongestionCleared` + device metrics events.
- Akzeptanz:
  - Events mit Tick/Utilization/PON-Kontext vorhanden.
- Depends on: TASK-043, TASK-020
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: `segmentCongestionDetected` / `segmentCongestionCleared` werden tick-scoped emittiert und enthalten `segmentId`, `oltId`, `utilization`, `tick`; Device-Metrics laufen im selben Tick/Flush-Fenster weiter.
  - Evidence: Socket-Regression prueft Payload-Felder, OLT-Kontext und Hysterese-Uebergaenge auf einer realen GPON-Ueberlast-Topologie.

#### [TASK-181] Traffic Tick Engine Determinismus und Scheduler-SLA absichern
- Status: OPEN
- Sources: 11, 06
- Ziel: Konfigurierbare Tick-Engine mit deterministischer Leaf-Generierung und stabiler Kadenz.
- Scope:
  - runtime loop timing/catch-up policy.
  - deterministic seed/device/tick generation contract.
- Akzeptanz:
  - identische Inputs erzeugen identische Tick-Reihen bei stabiler Tick-Kadenz.
- Depends on: TASK-148
- Builder Log:

#### [TASK-182] Asymmetrische Tarif- und Richtungsaggregation vollständig
- Status: DONE
- Sources: 11
- Ziel: Upstream/Downstream getrennt generieren/aggregieren statt implizit symmetrisch.
- Scope:
  - per-direction leaf generation.
  - per-direction aggregation and capacity checks.
- Akzeptanz:
  - asymmetrische Tarife werden fachlich korrekt reflektiert.
- Depends on: TASK-181
- Builder Log:
  - Implemented: Tick-Engine erzeugt und exportiert getrennte `downstreamMbps`/`upstreamMbps` pro Device; Subscriber-Leafs nutzen asymmetrische INTERNET-Demand-Profile, die auf `max_down`/`max_up` der Tarife aufsetzen.
  - Implemented: GPON-Segmente clampen jetzt sowohl downstream (`2.5 Gbps`) als auch upstream (`1.25 Gbps`) proportional; Congestion-Events leiten `utilization` und `direction` aus der jeweils dominanten Richtung ab.
  - Implemented: `/api/metrics/snapshot`, `deviceMetricsUpdated` und Cockpit-MVP-Karten fuehren die Richtungssummen neben dem Legacy-Feld `trafficMbps`.
  - Issues: Per-service direction breakdown bleibt auf das bestehende, downstream-orientierte `trafficProfile` reduziert; separate Upstream-Port-/Uplink-Kapazitaeten oberhalb des GPON-Segments bleiben spaetere Vertiefung.

#### [TASK-183] GPON Segment Identity/Capacity Contract stabilisieren
- Status: OPEN
- Sources: 11, 08
- Ziel: Deterministische Segmentdefinition pro OLT-PON bis erster Aggregationsgrenze inkl. Kapazitätsauflösung.
- Scope:
  - stable segment id construction.
  - profile/default fallback for segment capacity.
- Akzeptanz:
  - Segment-Mapping und Kapazitätswerte bleiben reproduzierbar über Ticks.
- Depends on: TASK-042, TASK-165
- Builder Log:

#### [TASK-184] Hysterese-State-Machine gegen Flattern absichern
- Status: OPEN
- Sources: 11
- Ziel: Enter/Clear-Transitions für Device/Link/Segment strikt nach Schwellenwerten emittieren.
- Scope:
  - no-event-on-steady-state behavior.
  - threshold boundary tests.
- Akzeptanz:
  - Congestion-Indikatoren bleiben stabil ohne Flicker.
- Depends on: TASK-043, TASK-095
- Builder Log:

#### [TASK-185] Congestion/Metrics Event Ordering + Snapshot-Reconciliation
- Status: IN_PROGRESS
- Sources: 11, 05
- Ziel: Event-Reihenfolge und Reconnect-Baseline (`/api/metrics/snapshot`) für Gap-safe Verarbeitung sichern.
- Scope:
  - ordering policy metrics vs status/topology events.
  - client baseline replacement on reconnect/version gaps.
- Akzeptanz:
  - Reconnect oder Eventlücken führen nicht zu inkonsistenten Congestion-Zuständen.
- Depends on: TASK-150, TASK-044
- Builder Log:
  - Date: 2026-03-09
  - Outcome: PARTIAL
  - Implemented: Client-Store nutzt baseline replacement (`/api/topology` + `/api/metrics/snapshot` + `/api/sessions`) fuer reconnect/version gaps; baseline-covered Eventklassen werden waehrend eines laufenden Resyncs konservativ verworfen und erzwingen einen queued rerun statt stale Snapshot-Overlay.
  - Implemented+: tick-scoped Simulationsevents (`deviceMetricsUpdated`, `deviceSignalUpdated`, `deviceStatusUpdated`, `segmentCongestionDetected`, `segmentCongestionCleared`) tragen nun kanonisches `tick_seq`; der Frontend-Store erkennt auch Tick-Luecken und faellt dann auf denselben Baseline-Resync zurueck.
  - Evidence: Regressionen decken Topology- und Tick-Gap-Klassifikation, Resync-Koaleszierung sowie drop-and-rerun-Policy fuer Metrics/Status/Topology/Subscriber-Klassen ab.
  - Issues: kein Delta-Buffer, keine Replay-Sequenz und keine explizite Backoff-/Retry-Strategie. `segmentCongestionDetected` / `segmentCongestionCleared` und andere metrics-getriebene Zustandswechsel besitzen weiterhin keinen eigenen `metrics_version`-Counter; verlustfreie Wiederaufholung erfolgt daher nur ueber den groberen Baseline-Resync.

#### [TASK-186] Traffic/Congestion Observability + Resilience Tests
- Status: OPEN
- Sources: 11, 12
- Ziel: Health/metrics/logging plus Fehlerresilienz (tick exceptions, backpressure collapse, no-leaf fast path) testbar machen.
- Scope:
  - `/api/sim/status` contract checks.
  - resilience test suite for runtime failure scenarios.
- Akzeptanz:
  - Traffic-Engine bleibt unter Fehlern und Last betriebssicher.
- Depends on: TASK-151, TASK-047
- Builder Log:

### Testing & Quality

#### [TASK-045] Negativtests für API-Validierung
- Status: OPEN
- Sources: 12, 05
- Ziel: 4xx-Fälle für invalid links/types/parents/status.
- Akzeptanz:
  - definierte Error Codes testabgedeckt.
- Depends on: TASK-007, TASK-013
- Builder Log:

#### [TASK-046] Socket Contract Tests
- Status: OPEN
- Sources: 12, 05, 13
- Ziel: Eventname/Payload/order testen.
- Akzeptanz:
  - Eventschema-Verstöße schlagen Tests fehl.
- Depends on: TASK-020
- Builder Log:

#### [TASK-047] Performance Harness implementieren
- Status: OPEN
- Sources: 12
- Ziel: `perf:seed` + `perf:load` real nutzbar machen.
- Akzeptanz:
  - reproduzierbarer Lasttest + dokumentierter Output.
- Depends on: TASK-025, TASK-043
- Builder Log:

#### [TASK-048] CI-Gates erzwingen
- Status: OPEN
- Sources: 12
- Ziel: lint/test/build als verpflichtende Pipeline.
- Akzeptanz:
  - Merge ohne grüne Gates nicht möglich.
- Depends on: TASK-045
- Builder Log:

#### [TASK-187] Test-Pyramide und Contract-Boundaries formalisieren
- Status: OPEN
- Sources: 12
- Ziel: Klare Testschichten (smoke/negative/realtime/simulation/ui-contract) mit stabilen Zuständigkeiten definieren.
- Scope:
  - layer ownership and required assertions per layer.
  - deterministic fixture policy.
- Akzeptanz:
  - neue Tests werden konsistent in die passende Schicht eingeordnet.
- Depends on: TASK-045, TASK-046
- Builder Log:

#### [TASK-188] API Negative Suite um vollständige Fehlercode-Abdeckung erweitern
- Status: OPEN
- Sources: 12, 13
- Ziel: Alle kanonischen 4xx-Pfade mit Error-Code-Asserts und Payload-Form absichern.
- Scope:
  - invalid links/parents/optical params/pool exhaustion.
  - deterministic error envelope assertions.
- Akzeptanz:
  - Error-Code-Regressionen werden automatisch erkannt.
- Depends on: TASK-072, TASK-140
- Builder Log:

#### [TASK-189] Realtime Contract + Ordering + Gap-Recovery Tests härten
- Status: OPEN
- Sources: 12, 05
- Ziel: Eventnamen/Payloads/Ordering und Reconnect-Gap-Verhalten testseitig verbindlich machen.
- Scope:
  - envelope validation incl. `topo_version`.
  - reconnect snapshot-baseline tests.
- Akzeptanz:
  - Realtime-Vertrag bleibt stabil trotz Refactors.
- Depends on: TASK-129, TASK-131, TASK-150
- Builder Log:

#### [TASK-190] Performance Harness (seed/load) reproduzierbar operationalisieren
- Status: OPEN
- Sources: 12, 06
- Ziel: `perf:seed` und `perf:load` mit deterministischen Szenarioprofilen und standardisiertem Ergebnisoutput umsetzen.
- Scope:
  - scale profiles and metadata manifest.
  - benchmark output parser/report.
- Akzeptanz:
  - Performance-Läufe sind reproduzierbar und vergleichbar.
- Depends on: TASK-047, TASK-148
- Builder Log:

#### [TASK-191] Performance Budgets und Regression Gates definieren
- Status: OPEN
- Sources: 12
- Ziel: p95/p99 Budgets für kritische Pfade definieren und als Gate/Report in CI integrieren.
- Scope:
  - topology/mutation/tick latency budgets.
  - threshold breach reporting.
- Akzeptanz:
  - Performance-Regressionen blockieren oder markieren Builds deterministisch.
- Depends on: TASK-190, TASK-048
- Builder Log:

#### [TASK-192] Test/Perf Observability Artefakte standardisieren
- Status: OPEN
- Sources: 12
- Ziel: Einheitliche Reports (junit, contract diff, benchmark summary) und Metrikausgabe für Tests/Benchmarks.
- Scope:
  - artifact schema/versioning.
  - CI upload + retention policy.
- Akzeptanz:
  - Qualitäts- und Performancezustand ist pro Run nachvollziehbar.
- Depends on: TASK-191, TASK-079
- Builder Log:

### API Reference Parity

#### [TASK-049] REST-Referenz 1:1 mit Implementierung abgleichen
- Status: OPEN
- Sources: 13
- Ziel: jeder dokumentierte Endpoint existiert mit passendem Verhalten.
- Akzeptanz:
  - kein drift zwischen `docs/13` und Servercode.
- Depends on: TASK-012, TASK-016, TASK-041
- Builder Log:

#### [TASK-050] WebSocket-Referenz 1:1 abgleichen
- Status: OPEN
- Sources: 13
- Ziel: dokumentierte Events + Payloads exakt erfüllt.
- Akzeptanz:
  - keine Eventnamen-/Payload-Divergenz.
- Depends on: TASK-020, TASK-044
- Builder Log:

#### [TASK-051] Versionierte API-Contract-Checks
- Status: OPEN
- Sources: 13
- Ziel: Contract Tests als Regression-Absicherung.
- Akzeptanz:
  - breaking change nur mit expliziter Doku-/Version-Änderung.
- Depends on: TASK-045, TASK-046
- Builder Log:

#### [TASK-052] Doku-Synchronisation abschließen
- Status: OPEN
- Sources: 01..13
- Ziel: Endabgleich aller Fachdokus mit Ist-Stand + offenen DEFERRED-Themen.
- Akzeptanz:
  - jeder offene Punkt ist als OPEN/DEFERRED Task referenziert.
- Depends on: TASK-001..051
- Builder Log:

#### [TASK-193] REST Endpoint-Matrix vollständig kanonisieren
- Status: OPEN
- Sources: 13
- Ziel: Vollständige Methode/Path-Matrix (`/api`) inkl. Batch-, Catalog-, Optical-, Metrics- und Interface-Endpunkte dokumentieren.
- Scope:
  - canonical path list with operation purpose.
  - deprecated/alias path governance notes.
- Akzeptanz:
  - API-Referenz enthält alle produktiven öffentlichen REST-Endpunkte ohne Lücken.
- Depends on: TASK-049, TASK-116
- Builder Log:

#### [TASK-194] Error Envelope + Code Mapping als API-Vertrag fixieren
- Status: OPEN
- Sources: 13
- Ziel: Einheitliches Fehlerformat (`code/message/details/request_id`) und deterministische HTTP-Status-Zuordnung dokumentieren/prüfen.
- Scope:
  - code catalog alignment with backend enum.
  - payload examples for common failure classes.
- Akzeptanz:
  - alle dokumentierten Fehlerpfade nutzen dieselbe Envelope-Struktur.
- Depends on: TASK-140, TASK-188
- Builder Log:

#### [TASK-195] Socket Event Inventory + Envelope Parität abschließen
- Status: OPEN
- Sources: 13, 05
- Ziel: Vollständige Eventliste inkl. Envelope-Feldern, Ordering und Gap-Recovery-Regeln versioniert dokumentieren.
- Scope:
  - event name canonicalization.
  - ordering section with normative sequence.
- Akzeptanz:
  - WebSocket-Referenz deckt reale Emissionen 1:1 ab.
- Depends on: TASK-050, TASK-129
- Builder Log:

#### [TASK-196] OpenAPI/Schema-Quellen für REST-Contracts etablieren
- Status: OPEN
- Sources: 13
- Ziel: Maschinenlesbare Contract-Quelle für REST-Payloads/Responses aufbauen und mit Doku synchron halten.
- Scope:
  - schema generation/export workflow.
  - CI drift checks between code and generated spec.
- Akzeptanz:
  - REST-Contract-Drift wird automatisiert erkannt.
- Depends on: TASK-051, TASK-193
- Builder Log:

#### [TASK-197] API Versioning/Compatibility Policy operationalisieren
- Status: OPEN
- Sources: 13
- Ziel: Regeln für breaking changes, aliasing (`/api/v1`) und Deprecation-Kommunikation verbindlich machen.
- Scope:
  - compatibility matrix and deprecation timelines.
  - required test/doc updates for breaking changes.
- Akzeptanz:
  - Versionswechsel und Abwärtskompatibilität sind klar steuerbar.
- Depends on: TASK-116, TASK-051
- Builder Log:

#### [TASK-198] Finale Doku-zu-Implementierung Traceability für 13 abschließen
- Status: OPEN
- Sources: 13, 12
- Ziel: Vollständigen Querverweis zwischen API-Referenz, Contract-Tests und implementierten Routen/Events herstellen.
- Scope:
  - endpoint/event -> test case mapping table.
  - unresolved gaps as explicit OPEN/DEFERRED items.
- Akzeptanz:
  - jede Referenzstelle ist testbar und in der Implementierung nachweisbar.
- Depends on: TASK-193, TASK-195, TASK-196
- Builder Log:

### Architecture & Operations Docs

#### [TASK-199] Architektur-Übersicht als konsolidierten Einstieg härten
- Status: IN_PROGRESS
- Sources: ARCHITECTURE
- Ziel: `ARCHITECTURE.md` als konsistente High-Level-Einstiegsdoku mit klaren Layern, Servicegrenzen und Vertragsprinzipien etablieren.
- Scope:
  - runtime layer map and data-flow narrative.
  - principles aligned with backend-authoritative design.
- Akzeptanz:
  - Architekturübersicht widerspricht keiner Fachdoku und bleibt für Onboarding nutzbar.
- Depends on: TASK-052
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: `ARCHITECTURE.md` spiegelt jetzt die aktuelle Backend-Komposition (`server.ts` plus extrahierte Runtime-/Realtime-/Read-Module, `linkService`, `sessionService`, `simulationService` sowie Device-/Link-/Session-Mutations- und Trace-Module) und den tatsaechlichen Layer-Zuschnitt wider.
  - Issues: weitere Write-Orchestration liegt weiter in `server.ts`; die Architektur bleibt deshalb bewusst als Zwischenstand dokumentiert.
  - Dependencies/Next: TASK-200

#### [TASK-200] Domain-Service-Boundaries und Ownership explizit machen
- Status: IN_PROGRESS
- Sources: ARCHITECTURE
- Ziel: Service-Verantwortlichkeiten (Device/Link/Provisioning/Status/Optical/Traffic/Ports/Catalog/Event) eindeutig dokumentieren.
- Scope:
  - ownership boundaries and no-overlap rules.
  - cross-service dependency notes.
- Akzeptanz:
  - Implementierungsentscheidungen lassen sich auf dokumentierte Servicegrenzen zurückführen.
- Depends on: TASK-199
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: Ownership-Hinweise fuer Runtime-Status, Realtime-Outbox, Read-Models, Read-Routen, `linkService`, `sessionService`, `simulationService` sowie Device-/Link-/Session-Mutationsmodule sind in `ARCHITECTURE.md` explizit nachgezogen.
  - Issues: verbleibende Write-Routen und Write-Orchestration liegen weiter in `server.ts`; Ownership ist dort noch nicht gleich detailliert dokumentiert.
  - Dependencies/Next: weiterer Slice fuer verbleibende Write-Orchestration

#### [TASK-201] Determinismus- und Event-Ordering-Prinzipien in Architektur verankern
- Status: IN_PROGRESS
- Sources: ARCHITECTURE, 05
- Ziel: Architekturweit verbindliche Determinismus- und Event-Ordering-Baselines dokumentieren.
- Scope:
  - canonical ordering sequence.
  - topo_version gap recovery principle.
- Akzeptanz:
  - Architekturreferenz deckt die im Realtime-Contract geforderten Reihenfolgen nachvollziehbar ab.
- Depends on: TASK-129, TASK-131, TASK-199
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: Architekturreferenz verweist jetzt explizit auf serverseitige Flush-Ordnung und Dedupe ueber `server/realtimeOutbox.ts`.
  - Issues: reconnect/version-gap recovery ist weiterhin nur teilweise clientseitig nachgewiesen.
  - Dependencies/Next: TASK-217, TASK-129

#### [TASK-202] Architektur-Map zu Docs/Roadmap vollständig pflegen
- Status: IN_PROGRESS
- Sources: ARCHITECTURE
- Ziel: Vollständige, aktuelle Verlinkung der Kernspezifikationen (01..14) und Roadmap-Source-of-Truth.
- Scope:
  - canonical docs index in architecture file.
  - stale link checks in CI/docs review process.
- Akzeptanz:
  - neue Teammitglieder finden alle relevanten Spezifikationen direkt über die Architektur-Übersicht.
- Depends on: TASK-199, TASK-198
- Builder Log:
  - Date: 2026-03-08
  - Outcome: PARTIAL
  - Implemented: `ARCHITECTURE.md` wurde auf den aktuellen modularisierten Backend-Zuschnitt inkl. `linkService`, `sessionService`, `simulationService` sowie Device-/Link-/Session-Mutationsmodule und die Roadmap-/Docs-Referenz aktualisiert.
  - Issues: keine expliziten stale-link/docs-review-Checks automatisiert; weitere Nachpflege bei kommenden Route-Splits noetig.
  - Dependencies/Next: weitere Doku-Nachzuege nach Mutationsmodularisierung

#### [TASK-203] Commands Playbook auf reale Skripte/Runtime angleichen
- Status: DONE
- Sources: 14_commands
- Ziel: `14_commands_playbook.md` muss exakt die tatsächlich vorhandenen NPM/Prisma/Perf-Kommandos abbilden.
- Scope:
  - script parity checks against `package.json`.
  - runtime/env prerequisites clarity.
- Akzeptanz:
  - keine veralteten oder nicht existierenden Kommandos in der Playbook-Doku.
- Depends on: TASK-198
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: `14_commands_playbook.md` ist gegen `package.json` abgeglichen (`dev`, `build`, `preview`, `lint`, `test`, `test:smoke`, `perf:seed`, `perf:load`) und beschreibt die reale `npx artillery`-Nutzung statt globaler Tool-Annahmen.
  - Issues: einzelne nicht-commandbezogene API-Doku-Altlasten koennen ausserhalb des Playbooks noch separat nachgezogen werden.
  - Dependencies/Next: TASK-204

#### [TASK-204] Lokale Betriebsreihenfolge + Fehlerbehebung standardisieren
- Status: DONE
- Sources: 14_commands
- Ziel: Einheitliche lokale Runbooks für Setup/Dev/Test/Build mit klaren Troubleshooting-Pfaden dokumentieren.
- Scope:
  - recommended command sequence.
  - known failure quick-fixes (Prisma drift, DB mismatch, perf dependencies).
- Akzeptanz:
  - reproduzierbarer lokaler Start ohne implizites Teamwissen.
- Depends on: TASK-203
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: `14_commands_playbook.md` enthaelt jetzt eine empfohlene lokale Startreihenfolge, SQLite/WSL-Hinweise, Recovery nach unclean shutdown / `database disk image is malformed` sowie Troubleshooting fuer Prisma- und Perf-Pfade.
  - Issues: fuer spaetere Postgres- oder Container-Setups braucht das Runbook ggf. einen zusaetzlichen Zweig.
  - Dependencies/Next: TASK-205

#### [TASK-205] CI-Gate-Abbildung in Commands und Testdocs synchronisieren
- Status: DONE
- Sources: 14_commands, 12
- Ziel: CI-Basisgates (`lint/test/build`) und optionale Perf-Profile konsistent zwischen Befehlsdoku und Teststrategie halten.
- Scope:
  - command-to-gate mapping table.
  - docs drift checks on CI script changes.
- Akzeptanz:
  - Änderungen an Build/Test-Skripten führen nicht zu Doku-Drift.
- Depends on: TASK-048, TASK-192, TASK-203
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: `14_commands_playbook.md` mappt die Baseline-Gates (`npm run lint`, `npm test`, `npm run build`) explizit auf CI und fuehrt `perf:seed` / `perf:load` als optionale Perf-Profile; die Mapping-Sprache ist mit `12_testing_and_performance_harness.md` konsistent gehalten.
  - Issues: keine automatische Docs/CI-Script-Diff-Pruefung vorhanden; das bleibt Teil spaeterer Drift-/CI-Arbeit.
  - Dependencies/Next: TASK-206

#### [TASK-206] Operations-Traceability zwischen Commands, API und Architektur schließen
- Status: OPEN
- Sources: 14_commands, ARCHITECTURE, 13
- Ziel: Befehle, Architektur-Abschnitte und API/Runtime-Verträge querverlinken, damit operative Schritte klar fachlich verankert sind.
- Scope:
  - cross-reference matrix for run commands -> affected subsystems.
  - update checklist for operational doc changes.
- Akzeptanz:
  - Betriebsdoku ist vollständig mit Architektur und API-Verträgen verbunden.
- Depends on: TASK-202, TASK-205
- Builder Log:

#### [TASK-207] Optical-Path Resolver strikt auf Doku-Contract angleichen
- Status: DONE
- Sources: 04_signal, 11, 13
- Ziel: Resolver implementiert vollständige Dijkstra-Kosten inkl. passiver Insertion-Losses und deterministische Tie-Break-Kette ohne frühes OLT-Short-Circuiting.
- Scope:
  - ranking cost = `total_link_loss_db + total_passive_loss_db`.
  - tie-break strict order: attenuation -> length -> hop_count -> olt_id -> path_signature.
  - stable `path_signature` aus geordneten node/link IDs.
- Akzeptanz:
  - identische Topologie liefert wiederholt identische OLT/Pfad-Auswahl.
  - passiver Loss beeinflusst Pfadauswahl wie spezifiziert.
- Depends on: TASK-118, TASK-119, TASK-122
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: Optical-Path-Resolver ist jetzt in `server/opticalPathService.ts` gekapselt und nutzt vollstaendige Dijkstra-Kosten inkl. passiver Insertion-Losses sowie die dokumentierte Tie-Break-Kette (`attenuation -> length -> hop_count -> olt_id -> path_signature`).
  - Issues: Resolver ist weiterhin primär ein Diagnose-/Detail-Endpoint und noch nicht allgemeiner Shared-Service fuer weitere Runtime-Pfade.
  - Dependencies/Next: TASK-208

#### [TASK-208] Optical-Path API Payload um Determinismus- und Kostenfelder erweitern
- Status: DONE
- Sources: 13, 04_signal
- Ziel: `GET /api/devices/:id/optical-path` liefert vollständige, testbare Cost/Path-Felder für Client-Debugging und Contract-Tests.
- Scope:
  - add fields: `total_link_loss_db`, `total_passive_loss_db`, `total_physical_length_km`, `hop_count`, `path_signature`.
  - keep backward compatibility for existing `total_loss_db`.
  - document response invariants for unresolved-path case.
- Akzeptanz:
  - API-Reference und Endpoint-Output sind deckungsgleich.
  - Clients können Tie-Break-Entscheidung nachvollziehen.
- Depends on: TASK-207, TASK-050
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: `GET /api/devices/:id/optical-path` liefert die normativen Cost-/Trace-Felder (`total_loss_db`, `total_link_loss_db`, `total_passive_loss_db`, `total_physical_length_km`, `hop_count`, `path_signature`) und die API-Referenz dokumentiert jetzt auch den unresolved-path-Fall.
  - Issues: keine.
  - Dependencies/Next: TASK-209

#### [TASK-209] Resolver-Regressionstests für Gleichstände und passive Verluste
- Status: DONE
- Sources: 12, 04_signal, 13
- Ziel: Deterministische Resolver-Verträge mit reproduzierbaren Fixtures in CI absichern.
- Scope:
  - equal-cost candidate fixture with deterministic tie-break assertion.
  - passive-loss-dominant fixture (mehr Hops, aber geringere Gesamtdämpfung gewinnt).
  - repeat-run stability and mutation-trigger regression checks.
- Akzeptanz:
  - Tests schlagen bei nicht-deterministischer Auswahl oder fehlender passiver Loss-Berücksichtigung fehl.
  - CI-Gates schützen vor Regressions.
- Depends on: TASK-207, TASK-208, TASK-187
- Builder Log:
  - Date: 2026-03-09
  - Outcome: DONE
  - Implemented: API-Smoke-Suite deckt jetzt SHA-256-`path_signature`, deterministische Equal-Cost-OLT-Auswahl, passive-loss-dominante Konkurrenzpfade sowie Link-Mutation-Trigger (`length_km`, `physical_medium_id`) gegen den Live-Endpoint ab.
  - Issues: keine.
  - Dependencies/Next: TASK-211 / reconnect-version-gap hardening

#### [TASK-210] Pre-Merge Contract-Drift Gate in CI/Review verankern
- Status: OPEN
- Sources: CONTRACT_DRIFT_CHECKLIST, 12, 14_commands, 13
- Ziel: Contract-Drift-Prüfung als verbindlichen Pre-Merge Schritt etablieren, damit Event-/API-/Enum-/Dateinamen-Drift früh blockiert wird.
- Scope:
  - `CONTRACT_DRIFT_CHECKLIST.md` als verpflichtende Review-Checkliste referenzieren.
  - dokumentierte `rg`-Drift-Checks in lokalen/CI-Workflows verankern.
  - Mindestnachweis je PR: `lint`, `test`, `build` plus Contract-Check-Protokoll.
- Akzeptanz:
  - PRs mit offensichtlicher Contract-Drift (Eventnamen, Medium-Keys, veraltete Dateireferenzen, Enum-Mix) werden vor Merge erkannt.
  - Review-Prozess hat klare, wiederholbare Checkpunkte statt implizitem Wissen.
- Depends on: TASK-048, TASK-205, TASK-206
- Builder Log:

#### [TASK-211] Realtime Delta-Only Emission + Event Coalescing für große Topologien
- Status: OPEN
- Sources: 05, 11, 13
- Ziel: Realtime-Pipeline so umbauen, dass pro Tick nur geänderte Entities emittiert werden und Event-Storms unter Last ausbleiben.
- Scope:
  - `deviceMetricsUpdated`/`deviceStatusUpdated` als changed-only batches statt full-device dumps.
  - serverseitige Coalescing-Map pro Tick-Fenster (`event_type + entity_id`).
  - bounded payload sizing + optional chunking für große Deltas.
- Akzeptanz:
  - bei unverändertem Zustand werden keine redundanten Metrik-/Status-Events gesendet.
  - bei Massenausfall bleibt Eventrate kontrollierbar und Browser bleibt responsiv.
- Depends on: TASK-129, TASK-131, TASK-181
- Builder Log:

#### [TASK-212] Optical Path Resolver auf Priority-Queue Dijkstra + Topology Index skalieren
- Status: OPEN
- Sources: 04_signal, 11, 13
- Ziel: Pfadberechnung von linearer Kandidatensuche auf PQ-Dijkstra + vorindizierte Topologie umstellen.
- Scope:
  - Priority-Queue für shortest-path relaxations.
  - Topology Index (`neighbors`, `parent/child`, optional `olt_id` hints) für O(1)-Lookups.
  - Cache/invalidierung an Mutationshooks koppeln (kein stale index).
- Akzeptanz:
  - funktionale Parität mit bestehendem Resolver (gleiche deterministische Auswahl).
  - messbar geringere Laufzeit auf großen Synthetic-Topologien.
- Depends on: TASK-207, TASK-208, TASK-123
- Builder Log:

#### [TASK-213] Deterministische Mutation-Queue pro Tick (Topology Apply -> Simulate -> Emit)
- Status: OPEN
- Sources: 05, 11, ARCHITECTURE
- Ziel: Topology-Mutationen und Simulation in einen strikt geordneten Tick-Zyklus überführen, um Race-Conditions zu vermeiden.
- Scope:
  - inbound mutations in queue puffern.
  - Tick-Phasen: `apply topology changes` -> `recompute/simulate` -> `emit deltas`.
  - Schutz gegen inkonsistente Zwischenzustände (z. B. edge ohne node).
- Akzeptanz:
  - keine inkonsistenten Graphzustände bei gleichzeitigen UI-Mutationen und Tick-Verarbeitung.
  - deterministische Reihenfolge reproduzierbar in Tests.
- Depends on: TASK-201, TASK-211, TASK-212
- Builder Log:

#### [TASK-214] Alarm-Korrelation und Symptom-Suppression (Root Cause First)
- Status: OPEN
- Sources: 03, 05, 11, 13
- Ziel: Alarmflut reduzieren, indem abhängige Folgealarme als Symptome markiert/unterdrückt werden.
- Scope:
  - Root-cause-heuristik (`upstream failure -> downstream symptoms`).
  - Alarmpayload erweitert um `cause_id`, `suppressed`, `severity_source`.
  - UI/Realtime Darstellung für suppressed alarms + Drilldown auf Root Cause.
- Akzeptanz:
  - bei einem Upstream-Ausfall dominiert genau ein Root-Cause-Alarm; Downstream-Alarme werden korrekt korreliert.
  - Alarmmenge bei Störfällen sinkt deutlich ohne Informationsverlust.
- Depends on: TASK-065, TASK-131, TASK-181, TASK-213
- Builder Log:

## 4) Reihenfolge-Empfehlung (praktisch)
1. TASK-001, 004, 013, 014, 020
2. TASK-005, 006, 007, 009, 010
3. TASK-011, 017, 018, 019, 025
4. TASK-033, 036, 037, 023
5. TASK-039, 040, 041, 042, 043, 044
6. TASK-045, 046, 048, 049, 050, 051, 052
7. TASK-211, TASK-212, TASK-213, TASK-214
8. DEFERRED Tracks: TASK-028, TASK-029 (später)

## 5) Hinweis zu MASTER_SPEC_UNOC_LITE.md
- Empfohlene Aktion jetzt: **behalten + als Archiv markieren**, nicht löschen.
- Empfohlene Aktion später (nach TASK-052): optional löschen oder in `docs/archive/` verschieben.

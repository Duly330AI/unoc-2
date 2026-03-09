import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  OnConnect,
  OnEdgesChange,
  OnNodesChange,
  applyEdgeChanges,
  applyNodeChanges,
} from 'reactflow';
import { io, Socket } from 'socket.io-client';
import { DeviceType, normalizeDeviceType } from '../deviceTypes';
import { classifyTopoVersionAction, createBaselineResyncController } from './realtimeResync';

export interface DeviceData {
  label: string;
  type: DeviceType;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'BLOCKING';
  serviceStatus?: 'UP' | 'DOWN' | 'DEGRADED' | null;
  serviceReasonCode?: string | null;
  rxPower?: number;
  trafficLoad?: number;
  expanded?: boolean;
  portSummary?: {
    total: number;
    byRole: Record<string, { total: number; used: number; maxSubscribers?: number }>;
  };
  connectedOnts?: Array<{ id: string; name: string; type: string }>;
  diagnostics?: {
    upstreamL3Ok: boolean;
    chain: string[];
    reasonCodes: string[];
  };
  interfaceDetails?: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    addresses: Array<{ ip: string; prefix_len: number; is_primary: boolean; vrf: string }>;
  }>;
  ports?: Array<{ id: string; portNumber: number; portType: string; status: string }>;
}

export interface LinkData {
  length_km?: number;
  physical_medium_id?: string;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'BLOCKING';
}

interface TopologyResponse {
  topo_version?: number;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: {
      name: string;
      type: DeviceType | string;
      status: DeviceData['status'];
      ports?: DeviceData['ports'];
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    data: {
      length_km?: number;
      physical_medium_id?: string;
      status: LinkData['status'];
    };
  }>;
}

interface SessionListItem {
  session_id: string;
  state: string;
  infra_status: 'UP' | 'DOWN' | 'DEGRADED' | 'BLOCKING';
  service_status: 'UP' | 'DOWN' | 'DEGRADED';
  reason_code: string | null;
  interface_id: string;
  device_id: string;
  bng_device_id: string;
  service_type: string;
  protocol: string;
  mac_address: string;
}

interface SessionSnapshot {
  sessionId: string;
  deviceId: string;
  state: string;
  serviceStatus: 'UP' | 'DOWN' | 'DEGRADED';
  reasonCode: string | null;
  interfaceId: string;
  bngDeviceId: string;
  serviceType: string;
  protocol: string;
  macAddress: string;
}

interface AppState {
  nodes: Node<DeviceData>[];
  edges: Edge<LinkData>[];
  serviceSessionsById: Record<string, SessionSnapshot>;
  socketInitialized: boolean;
  socketConnected: boolean;
  layoutBusy: boolean;
  lastTopoVersion?: number;
  lastError?: string;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  updateNodeData: (id: string, data: Partial<DeviceData>) => void;
  toggleNodeExpanded: (id: string) => void;
  fetchDeviceCockpitData: (id: string, type: DeviceType) => Promise<void>;
  persistNodePosition: (id: string, position: { x: number; y: number }) => Promise<void>;
  tidyLayout: () => Promise<void>;
  updateEdgeData: (id: string, data: Partial<LinkData>) => void;
  setNodes: (nodes: Node<DeviceData>[]) => void;
  setEdges: (edges: Edge<LinkData>[]) => void;
  fetchTopology: () => Promise<void>;
  fetchMetricsSnapshot: () => Promise<void>;
  fetchSessions: () => Promise<void>;
  createDevice: (device: { name: string; type: DeviceType; x: number; y: number }) => Promise<void>;
  createLink: (
    aInterfaceId: string,
    bInterfaceId: string,
    opts?: { length_km?: number; physical_medium_id?: string }
  ) => Promise<void>;
  initializeSocket: () => void;
  fetchOpticalPath: (deviceId: string) => Promise<void>;
  clearPathHighlight: () => void;
}

const socket: Socket = io({ path: '/api/socket.io' });

const buildLinkEdgeStyle = (status: LinkData['status']) => {
  if (status === 'UP') {
    return { stroke: '#94a3b8', strokeWidth: 1.5 };
  }
  if (status === 'DEGRADED') {
    return { stroke: '#f59e0b', strokeWidth: 1.75, strokeDasharray: '6 4' };
  }
  if (status === 'BLOCKING') {
    return { stroke: '#8b5cf6', strokeWidth: 1.75, strokeDasharray: '3 3' };
  }
  return { stroke: '#ef4444', strokeWidth: 1.75, strokeDasharray: '8 4' };
};

const deriveDeviceServiceState = (sessions: SessionSnapshot[]) => {
  if (sessions.length === 0) {
    return { serviceStatus: null, serviceReasonCode: null };
  }

  const activeSession = sessions.find((session) => session.state === 'ACTIVE' || session.serviceStatus === 'UP');
  if (activeSession) {
    return { serviceStatus: 'UP' as const, serviceReasonCode: null };
  }

  const downSession = sessions.find(
    (session) => session.state === 'EXPIRED' || session.state === 'RELEASED' || session.serviceStatus === 'DOWN'
  );
  if (downSession) {
    return {
      serviceStatus: 'DOWN' as const,
      serviceReasonCode: downSession.reasonCode,
    };
  }

  const degradedSession = sessions.find(
    (session) => session.state === 'INIT' || session.serviceStatus === 'DEGRADED'
  );
  if (degradedSession) {
    return {
      serviceStatus: 'DEGRADED' as const,
      serviceReasonCode: degradedSession.reasonCode,
    };
  }

  return { serviceStatus: null, serviceReasonCode: null };
};

const applyServiceSnapshotsToNodes = (
  nodes: Node<DeviceData>[],
  serviceSessionsById: Record<string, SessionSnapshot>
) => {
  const sessionsByDeviceId = new Map<string, SessionSnapshot[]>();
  Object.values(serviceSessionsById).forEach((session) => {
    const current = sessionsByDeviceId.get(session.deviceId) ?? [];
    current.push(session);
    sessionsByDeviceId.set(session.deviceId, current);
  });

  return nodes.map((node) => {
    const serviceState = deriveDeviceServiceState(sessionsByDeviceId.get(node.id) ?? []);
    return {
      ...node,
      data: {
        ...node.data,
        serviceStatus: serviceState.serviceStatus,
        serviceReasonCode: serviceState.serviceReasonCode,
      },
    };
  });
};

const mapTopologyNode = (
  node: TopologyResponse['nodes'][number],
  serviceSessionsById: Record<string, SessionSnapshot>
): Node<DeviceData> => {
  const serviceState = deriveDeviceServiceState(serviceSessionsById[node.id] ? [serviceSessionsById[node.id]] : []);

  return {
    id: node.id,
    type: 'device',
    position: node.position,
    data: {
      label: node.data.name,
      type: normalizeDeviceType(node.data.type),
      status: node.data.status,
      serviceStatus: serviceState.serviceStatus,
      serviceReasonCode: serviceState.serviceReasonCode,
      expanded: false,
      portSummary: undefined,
      connectedOnts: undefined,
      diagnostics: undefined,
      interfaceDetails: undefined,
      ports: node.data.ports,
    },
  };
};

const mapTopologyEdge = (edge: TopologyResponse['edges'][number]): Edge<LinkData> => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  sourceHandle: edge.sourceHandle,
  targetHandle: edge.targetHandle,
  type: 'smoothstep',
  pathOptions: { offset: 24, borderRadius: 12 },
  style: buildLinkEdgeStyle(edge.data.status),
  data: {
    length_km: edge.data.length_km ?? 0,
    physical_medium_id: edge.data.physical_medium_id,
    status: edge.data.status,
  },
});

const layoutLayerForType = (type: DeviceType) => {
  if (type === 'BACKBONE_GATEWAY') return 0;
  if (type === 'CORE_ROUTER') return 1;
  if (type === 'EDGE_ROUTER') return 2;
  if (type === 'OLT' || type === 'AON_SWITCH') return 3;
  if (type === 'SPLITTER' || type === 'ODF' || type === 'NVT' || type === 'HOP') return 4;
  if (type === 'ONT' || type === 'BUSINESS_ONT' || type === 'AON_CPE') return 5;
  if (type === 'SWITCH') return 3;
  return 2;
};

const buildSemanticLayoutPositions = (nodes: Node<DeviceData>[]) => {
  const layers = new Map<number, Node<DeviceData>[]>();
  for (const node of nodes) {
    const layer = layoutLayerForType(node.data.type);
    const items = layers.get(layer) ?? [];
    items.push(node);
    layers.set(layer, items);
  }

  const byId = new Map<string, { x: number; y: number }>();
  for (const [layer, layerNodes] of Array.from(layers.entries()).sort((a, b) => a[0] - b[0])) {
    const sorted = [...layerNodes].sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      if (a.position.x !== b.position.x) return a.position.x - b.position.x;
      return a.data.label.localeCompare(b.data.label);
    });

    sorted.forEach((node, index) => {
      byId.set(node.id, {
        x: 80 + layer * 320,
        y: 80 + index * 150,
      });
    });
  }

  return byId;
};

export const useStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  serviceSessionsById: {},
  socketInitialized: false,
  socketConnected: false,
  layoutBusy: false,
  lastTopoVersion: undefined,
  lastError: undefined,

  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes) as Node<DeviceData>[],
    });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges) as Edge<LinkData>[],
    });
  },

  onConnect: async (connection: Connection) => {
    if (connection.source && connection.target && connection.sourceHandle && connection.targetHandle) {
      await get().createLink(connection.sourceHandle, connection.targetHandle);
    }
  },

  updateNodeData: (id: string, data: Partial<DeviceData>) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, ...data } as DeviceData };
        }
        return node;
      }),
    });
  },

  toggleNodeExpanded: (id: string) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, expanded: !node.data.expanded } } : node
      ),
    });
  },

  fetchDeviceCockpitData: async (id, type) => {
    const supportsPortSummary =
      type === 'OLT' ||
      type === 'CORE_ROUTER' ||
      type === 'EDGE_ROUTER' ||
      type === 'BACKBONE_GATEWAY' ||
      type === 'AON_SWITCH' ||
      type === 'SPLITTER' ||
      type === 'ODF' ||
      type === 'NVT' ||
      type === 'HOP';
    const supportsInterfaces = type === 'ONT' || type === 'BUSINESS_ONT' || type === 'AON_CPE';

    if (!supportsPortSummary && !supportsInterfaces) {
      return;
    }

    try {
      const requests: Array<Promise<Response>> = [];
      if (supportsPortSummary) {
        requests.push(fetch(`/api/ports/summary/${id}`));
      }
      if (type === 'OLT') {
        requests.push(fetch(`/api/ports/ont-list/${id}`));
      }
      if (supportsInterfaces) {
        requests.push(fetch(`/api/interfaces/${id}`));
      }
      requests.push(fetch(`/api/devices/${id}/diagnostics`));

      const responses = await Promise.all(requests);
      let responseIdx = 0;
      const summaryRes = supportsPortSummary ? responses[responseIdx++] : undefined;
      const ontListRes = type === 'OLT' ? responses[responseIdx++] : undefined;
      const interfacesRes = supportsInterfaces ? responses[responseIdx++] : undefined;
      const diagnosticsRes = responses[responseIdx++];

      if (summaryRes && !summaryRes.ok) {
        throw new Error(`HTTP ${summaryRes.status}`);
      }
      if (ontListRes && !ontListRes.ok) {
        throw new Error(`HTTP ${ontListRes.status}`);
      }
      if (interfacesRes && !interfacesRes.ok) {
        throw new Error(`HTTP ${interfacesRes.status}`);
      }
      if (!diagnosticsRes.ok) {
        throw new Error(`HTTP ${diagnosticsRes.status}`);
      }

      const summary = summaryRes
        ? ((await summaryRes.json()) as {
            device_id: string;
            total: number;
            by_role?: Record<string, { total?: number; used?: number; max_subscribers?: number }>;
          })
        : { device_id: id, total: 0, by_role: {} };
      const ontList = ontListRes
        ? ((await ontListRes.json()) as {
            device_id: string;
            items?: Array<{ id: string; name: string; type: string }>;
          })
        : { device_id: id, items: [] };
      const interfaces = interfacesRes
        ? ((await interfacesRes.json()) as Array<{
            id: string;
            name: string;
            role: string;
            status: string;
            addresses: Array<{ ip: string; prefix_len: number; is_primary: boolean; vrf: string }>;
          }>)
        : [];
      const diagnostics = (await diagnosticsRes.json()) as {
        device_id: string;
        upstream_l3_ok: boolean;
        chain?: string[];
        reason_codes?: string[];
      };

      const byRole = Object.fromEntries(
        Object.entries(summary.by_role ?? {}).map(([role, value]) => [
          role,
          {
            total: value.total ?? 0,
            used: value.used ?? 0,
            maxSubscribers: value.max_subscribers,
          },
        ])
      );

      set((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  portSummary: {
                    total: summary.total ?? 0,
                    byRole,
                  },
                  connectedOnts: ontList.items ?? [],
                  diagnostics: {
                    upstreamL3Ok: diagnostics.upstream_l3_ok,
                    chain: diagnostics.chain ?? [],
                    reasonCodes: diagnostics.reason_codes ?? [],
                  },
                  interfaceDetails: interfaces,
                },
              }
            : node
        ),
        lastError: undefined,
      }));
    } catch (error) {
      console.error('Failed to fetch cockpit data:', error);
      set({ lastError: 'Failed to fetch cockpit data' });
    }
  },

  persistNodePosition: async (id, position) => {
    const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, position: rounded } : node)),
    }));

    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rounded),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status} ${JSON.stringify(errorPayload)}`);
      }
      set({ lastError: undefined });
    } catch (error) {
      console.error('Failed to persist node position:', error);
      set({ lastError: `Persist layout failed: ${String(error)}` });
      await get().fetchTopology();
    }
  },

  tidyLayout: async () => {
    const layoutPositions = buildSemanticLayoutPositions(get().nodes);
    set({ layoutBusy: true });
    set((state) => ({
      nodes: state.nodes.map((node) => {
        const next = layoutPositions.get(node.id);
        return next ? { ...node, position: next } : node;
      }),
    }));

    try {
      await Promise.all(
        Array.from(layoutPositions.entries()).map(async ([id, position]) => {
          const res = await fetch(`/api/devices/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(position),
          });
          if (!res.ok) {
            const errorPayload = await res.json().catch(() => ({}));
            throw new Error(`HTTP ${res.status} ${JSON.stringify(errorPayload)}`);
          }
        })
      );
      set({ lastError: undefined, layoutBusy: false });
    } catch (error) {
      console.error('Failed to tidy layout:', error);
      set({ lastError: `Tidy layout failed: ${String(error)}`, layoutBusy: false });
      await get().fetchTopology();
    }
  },

  updateEdgeData: (id: string, data: Partial<LinkData>) => {
    set({
      edges: get().edges.map((edge) => {
        if (edge.id === id) {
          return { ...edge, data: { ...edge.data, ...data } as LinkData };
        }
        return edge;
      }),
    });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  fetchTopology: async () => {
    try {
      const res = await fetch('/api/topology');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as TopologyResponse;
      const serviceSessionsById = get().serviceSessionsById;
      const priorNodeStateById = new Map(
        get().nodes.map((node) => [
          node.id,
          {
            expanded: Boolean(node.data.expanded),
            portSummary: node.data.portSummary,
            connectedOnts: node.data.connectedOnts,
            diagnostics: node.data.diagnostics,
            interfaceDetails: node.data.interfaceDetails,
          },
        ])
      );
      set({
        nodes: applyServiceSnapshotsToNodes(
          data.nodes.map((node) => {
            const mapped = mapTopologyNode(node, serviceSessionsById);
            const prior = priorNodeStateById.get(mapped.id);
            return {
              ...mapped,
              data: {
                ...mapped.data,
                expanded: prior?.expanded ?? false,
                portSummary: prior?.portSummary,
                connectedOnts: prior?.connectedOnts,
                diagnostics: prior?.diagnostics,
                interfaceDetails: prior?.interfaceDetails,
              },
            };
          }),
          serviceSessionsById
        ),
        edges: data.edges.map(mapTopologyEdge),
        lastTopoVersion: data.topo_version ?? get().lastTopoVersion,
        lastError: undefined,
      });
    } catch (error) {
      console.error('Failed to fetch topology:', error);
      set({ lastError: 'Failed to fetch topology' });
    }
  },

  fetchMetricsSnapshot: async () => {
    try {
      const res = await fetch('/api/metrics/snapshot');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = (await res.json()) as {
        tick?: number;
        devices?: Array<{ id: string; trafficLoad: number; rxPower: number; status?: DeviceData['status'] }>;
      };
      const updatesById = new Map((payload.devices ?? []).map((item) => [item.id, item]));
      set((state) => ({
        nodes: state.nodes.map((node) => {
          const update = updatesById.get(node.id);
          if (!update) return node;
          return {
            ...node,
            data: {
              ...node.data,
              trafficLoad: update.trafficLoad,
              rxPower: update.rxPower,
              status: update.status ?? node.data.status,
            },
          };
        }),
      }));
    } catch (error) {
      console.error('Failed to fetch metrics snapshot:', error);
      set({ lastError: 'Failed to fetch metrics snapshot' });
    }
  },

  fetchSessions: async () => {
    try {
      const limit = 100;
      let offset = 0;
      let totalCount = Number.POSITIVE_INFINITY;
      const sessions: SessionListItem[] = [];

      while (offset < totalCount) {
        const res = await fetch(`/api/sessions?limit=${limit}&offset=${offset}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const page = (await res.json()) as SessionListItem[];
        const headerCount = Number(res.headers.get('X-Total-Count') ?? Number.NaN);
        if (Number.isFinite(headerCount)) {
          totalCount = headerCount;
        }
        sessions.push(...page);

        if (page.length < limit) {
          break;
        }
        offset += page.length;
      }

      const serviceSessionsById = sessions.reduce<Record<string, SessionSnapshot>>((acc, session) => {
        acc[session.session_id] = {
          sessionId: session.session_id,
          deviceId: session.device_id,
          state: session.state,
          serviceStatus: session.service_status,
          reasonCode: session.reason_code,
          interfaceId: session.interface_id,
          bngDeviceId: session.bng_device_id,
          serviceType: session.service_type,
          protocol: session.protocol,
          macAddress: session.mac_address,
        };
        return acc;
      }, {});

      set((state) => ({
        serviceSessionsById,
        nodes: applyServiceSnapshotsToNodes(state.nodes, serviceSessionsById),
        lastError: undefined,
      }));
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      set({ lastError: 'Failed to fetch sessions' });
    }
  },

  createDevice: async (device) => {
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(device),
      });

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status} ${JSON.stringify(errorPayload)}`);
      }
      set({ lastError: undefined });
    } catch (error) {
      console.error('Failed to create device:', error);
      set({ lastError: `Create device failed: ${String(error)}` });
    }
  },

  createLink: async (aInterfaceId, bInterfaceId, opts) => {
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          a_interface_id: aInterfaceId,
          b_interface_id: bInterfaceId,
          length_km: opts?.length_km ?? 1.0,
          physical_medium_id: opts?.physical_medium_id ?? 'G.652.D',
        }),
      });

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status} ${JSON.stringify(errorPayload)}`);
      }
      set({ lastError: undefined });
    } catch (error) {
      console.error('Failed to create link:', error);
      set({ lastError: `Create link failed: ${String(error)}` });
    }
  },

  fetchOpticalPath: async (deviceId) => {
    try {
      const res = await fetch(`/api/devices/${deviceId}/optical-path`);
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status} ${JSON.stringify(errorPayload)}`);
      }
      const payload = await res.json();
      const linkIds = new Set<string>((payload?.path?.link_ids ?? []) as string[]);
      set((state) => ({
        edges: state.edges.map((edge) => ({
          ...edge,
          style: linkIds.has(edge.id)
            ? { ...buildLinkEdgeStyle(edge.data?.status ?? 'UP'), stroke: '#f97316', strokeWidth: 3 }
            : buildLinkEdgeStyle(edge.data?.status ?? 'UP'),
        })),
        lastError: undefined,
      }));
    } catch (error) {
      console.error('Failed to fetch optical path:', error);
      set({ lastError: `Optical path failed: ${String(error)}` });
    }
  },

  clearPathHighlight: () => {
    set((state) => ({
      edges: state.edges.map((edge) => ({
        ...edge,
        style: buildLinkEdgeStyle(edge.data?.status ?? 'UP'),
      })),
    }));
  },

  initializeSocket: () => {
    if (get().socketInitialized) {
      return;
    }

    const baselineResync = createBaselineResyncController(async () => {
      await get().fetchTopology();
      await get().fetchMetricsSnapshot();
      await get().fetchSessions();
    });

    socket.on('connect', () => {
      set({ socketConnected: true });
      void baselineResync.requestResync();
    });

    socket.on('disconnect', () => {
      set({ socketConnected: false });
    });

    socket.on('event', async (envelope: any) => {
      const kind = envelope?.kind as string | undefined;
      const payload = envelope?.payload;
      const topoVersion = typeof envelope?.topo_version === 'number' ? (envelope.topo_version as number) : undefined;
      if (!kind) return;

      const topoVersionAction = classifyTopoVersionAction(get().lastTopoVersion, topoVersion);
      if (topoVersionAction === 'resync') {
        await baselineResync.requestResync();
        return;
      }
      if (topoVersionAction === 'accept' && topoVersion !== undefined) {
        set({ lastTopoVersion: topoVersion });
      }

      if (kind === 'deviceCreated') {
        const device = payload;
        const newNode: Node<DeviceData> = {
          id: device.id,
          type: 'device',
          position: { x: device.x, y: device.y },
          data: {
            label: device.name,
            type: normalizeDeviceType(device.type),
            status: device.status,
            serviceStatus: null,
            serviceReasonCode: null,
            ports: device.ports,
          },
        };
        set((state) => ({ nodes: [...state.nodes, newNode] }));
        return;
      }

      if (kind === 'deviceUpdated') {
        const device = payload;
        set((state) => ({
          nodes: state.nodes.map((node) =>
            node.id === device.id
              ? {
                  ...node,
                  position: { x: device.x, y: device.y },
                  data: {
                    ...node.data,
                    label: device.name,
                    type: normalizeDeviceType(device.type),
                    status: device.status,
                    ports: device.ports,
                  },
                }
              : node
          ),
        }));
        return;
      }

      if (kind === 'deviceDeleted') {
        const id = payload?.id as string;
        set((state) => {
          const serviceSessionsById = Object.fromEntries(
            Object.entries(state.serviceSessionsById).filter(([, session]) => session.deviceId !== id)
          );
          return {
            serviceSessionsById,
            nodes: state.nodes.filter((node) => node.id !== id),
            edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
          };
        });
        return;
      }

      if (kind === 'linkAdded' || kind === 'linkUpdated') {
        const link = payload;
        const sourceDeviceId = link.a_device_id;
        const targetDeviceId = link.b_device_id;
        const sourceInterfaceId = link.a_interface_id;
        const targetInterfaceId = link.b_interface_id;
        if (!sourceDeviceId || !targetDeviceId || !sourceInterfaceId || !targetInterfaceId) {
          return;
        }

        const edge: Edge<LinkData> = {
          id: link.id,
          source: sourceDeviceId,
          target: targetDeviceId,
          sourceHandle: sourceInterfaceId,
          targetHandle: targetInterfaceId,
          type: 'smoothstep',
          pathOptions: { offset: 24, borderRadius: 12 },
          style: buildLinkEdgeStyle((link.effective_status ?? link.status) as LinkData['status']),
          data: {
            length_km: link.length_km,
            physical_medium_id: link.physical_medium_id,
            status: link.effective_status ?? link.status,
          },
        };

        set((state) => {
          const exists = state.edges.some((candidate) => candidate.id === edge.id);
          if (exists) {
            return { edges: state.edges.map((candidate) => (candidate.id === edge.id ? edge : candidate)) };
          }
          return { edges: [...state.edges, edge] };
        });
        return;
      }

      if (kind === 'linkDeleted') {
        const id = payload?.id as string;
        set((state) => ({ edges: state.edges.filter((edge) => edge.id !== id) }));
        return;
      }

      if (kind === 'linkStatusUpdated') {
        const id = payload?.id as string;
        const effectiveStatus = payload?.effective_status as LinkData['status'] | undefined;
        if (!id || !effectiveStatus) return;
        set((state) => ({
          edges: state.edges.map((edge) =>
            edge.id === id
              ? { ...edge, data: { ...edge.data, status: effectiveStatus }, style: buildLinkEdgeStyle(effectiveStatus) }
              : edge
          ),
        }));
        return;
      }

      if (kind === 'deviceMetricsUpdated') {
        const items = (payload?.items ?? []) as Array<{
          id: string;
          trafficLoad: number;
          rxPower: number;
          status?: DeviceData['status'];
        }>;
        const updatesById = new Map(items.map((item) => [item.id, item]));
        set((state) => ({
          nodes: state.nodes.map((node) => {
            const update = updatesById.get(node.id);
            if (!update) return node;
            return {
              ...node,
              data: {
                ...node.data,
                trafficLoad: update.trafficLoad,
                rxPower: update.rxPower,
                status: update.status ?? node.data.status,
              },
            };
          }),
        }));
        return;
      }

      if (kind === 'deviceStatusUpdated') {
        const items = (payload?.items ?? []) as Array<{ id: string; status: DeviceData['status'] }>;
        const updatesById = new Map(items.map((item) => [item.id, item]));
        set((state) => ({
          nodes: state.nodes.map((node) => {
            const update = updatesById.get(node.id);
            if (!update) return node;
            return { ...node, data: { ...node.data, status: update.status } };
          }),
        }));
        return;
      }

      if (kind === 'subscriberSessionUpdated') {
        const sessionId = payload?.session_id as string | undefined;
        if (!sessionId) return;

        const existingSession = get().serviceSessionsById[sessionId];
        if (!existingSession) {
          await get().fetchSessions();
          return;
        }

        const nextSnapshot: SessionSnapshot = {
          sessionId,
          deviceId: existingSession.deviceId,
          state: String(payload?.state ?? existingSession.state),
          serviceStatus: (payload?.service_status ?? existingSession.serviceStatus) as SessionSnapshot['serviceStatus'],
          reasonCode: (payload?.reason_code ?? existingSession.reasonCode) as string | null,
          interfaceId: existingSession.interfaceId,
          bngDeviceId: existingSession.bngDeviceId,
          serviceType: existingSession.serviceType,
          protocol: existingSession.protocol,
          macAddress: existingSession.macAddress,
        };

        set((state) => {
          const serviceSessionsById = {
            ...state.serviceSessionsById,
            [sessionId]: nextSnapshot,
          };
          return {
            serviceSessionsById,
            nodes: applyServiceSnapshotsToNodes(state.nodes, serviceSessionsById),
          };
        });
      }
    });

    set({ socketInitialized: true });
  },
}));

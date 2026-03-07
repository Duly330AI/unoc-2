import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import { io, Socket } from 'socket.io-client';

export type DeviceType = 'BackboneGateway' | 'OLT' | 'Splitter' | 'ONT' | 'Switch' | 'PatchPanel' | 'Amplifier' | 'POP' | 'CORE_SITE';

export interface DeviceData {
  label: string;
  type: DeviceType;
  status: 'OK' | 'WARNING' | 'FAILURE' | 'OFFLINE';
  rxPower?: number;
  trafficLoad?: number;
  ports?: Array<{ id: string; portNumber: number; portType: string; status: string }>;
}

export interface LinkData {
  length_km?: number;
  physical_medium_id?: string;
  fiberLength?: number;
  fiberType?: string;
  status: 'OK' | 'BROKEN';
}

interface TopologyResponse {
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
      fiberLength?: number;
      fiberType?: string;
      status: LinkData['status'];
    };
  }>;
}

interface AppState {
  nodes: Node<DeviceData>[];
  edges: Edge<LinkData>[];
  socketInitialized: boolean;
  lastError?: string;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  updateNodeData: (id: string, data: Partial<DeviceData>) => void;
  updateEdgeData: (id: string, data: Partial<LinkData>) => void;
  setNodes: (nodes: Node<DeviceData>[]) => void;
  setEdges: (edges: Edge<LinkData>[]) => void;
  fetchTopology: () => Promise<void>;
  createDevice: (device: { name: string; type: DeviceType; x: number; y: number }) => Promise<void>;
  createLink: (
    sourceId: string,
    targetId: string,
    sourcePortId: string,
    targetPortId: string,
    opts?: { length_km?: number; physical_medium_id?: string }
  ) => Promise<void>;
  initializeSocket: () => void;
  fetchOpticalPath: (deviceId: string) => Promise<void>;
  clearPathHighlight: () => void;
}

const socket: Socket = io();

const normalizeDeviceType = (rawType: string): DeviceType => {
  if (rawType === 'ONU') return 'ONT';
  if (rawType === 'SPLITTER') return 'Splitter';
  if (rawType === 'SWITCH' || rawType === 'ROUTER') return 'Switch';
  if (rawType === 'BACKBONE_GATEWAY' || rawType === 'BackboneGateway') return 'BackboneGateway';
  if (rawType === 'POP') return 'POP';
  if (rawType === 'CORE_SITE') return 'CORE_SITE';
  if (rawType === 'ODF' || rawType === 'PATCHPANEL') return 'PatchPanel';
  if (rawType === 'AMPLIFIER') return 'Amplifier';
  if (rawType === 'OLT' || rawType === 'Splitter' || rawType === 'ONT' || rawType === 'Switch' || rawType === 'PatchPanel' || rawType === 'Amplifier' || rawType === 'BackboneGateway' || rawType === 'POP' || rawType === 'CORE_SITE') {
    return rawType;
  }
  return 'Switch';
};

const mapTopologyNode = (node: TopologyResponse['nodes'][number]): Node<DeviceData> => ({
  id: node.id,
  type: 'default',
  position: node.position,
  data: {
    label: node.data.name,
    type: normalizeDeviceType(node.data.type),
    status: node.data.status,
    ports: node.data.ports,
  },
});

const mapTopologyEdge = (edge: TopologyResponse['edges'][number]): Edge<LinkData> => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  sourceHandle: edge.sourceHandle,
  targetHandle: edge.targetHandle,
  type: 'smoothstep',
  data: {
    length_km: edge.data.length_km ?? edge.data.fiberLength ?? 0,
    physical_medium_id: edge.data.physical_medium_id ?? edge.data.fiberType,
    fiberLength: edge.data.fiberLength ?? edge.data.length_km,
    fiberType: edge.data.fiberType ?? edge.data.physical_medium_id,
    status: edge.data.status,
  },
});

export const useStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  socketInitialized: false,
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
      await get().createLink(connection.source, connection.target, connection.sourceHandle, connection.targetHandle);
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
      set({
        nodes: data.nodes.map(mapTopologyNode),
        edges: data.edges.map(mapTopologyEdge),
        lastError: undefined,
      });
    } catch (error) {
      console.error('Failed to fetch topology:', error);
      set({ lastError: 'Failed to fetch topology' });
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

  createLink: async (sourceId, targetId, sourcePortId, targetPortId, opts) => {
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          targetId,
          sourcePortId,
          targetPortId,
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
            ? { ...(edge.style ?? {}), stroke: '#f97316', strokeWidth: 3 }
            : { ...(edge.style ?? {}), stroke: '#94a3b8', strokeWidth: 1.25 },
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
        style: { ...(edge.style ?? {}), stroke: '#94a3b8', strokeWidth: 1.25 },
      })),
    }));
  },

  initializeSocket: () => {
    if (get().socketInitialized) {
      return;
    }

    socket.on('event', (envelope: any) => {
      const kind = envelope?.kind as string | undefined;
      const payload = envelope?.payload;
      if (!kind) return;

      if (kind === 'deviceCreated') {
        const device = payload;
        const newNode: Node<DeviceData> = {
          id: device.id,
          type: 'default',
          position: { x: device.x, y: device.y },
          data: {
            label: device.name,
            type: normalizeDeviceType(device.type),
            status: device.status,
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
        set((state) => ({
          nodes: state.nodes.filter((node) => node.id !== id),
          edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
        }));
        return;
      }

      if (kind === 'linkAdded' || kind === 'linkUpdated') {
        const link = payload;
        const edge: Edge<LinkData> = {
          id: link.id,
          source: link.sourcePort.deviceId,
          target: link.targetPort.deviceId,
          sourceHandle: link.sourcePortId,
          targetHandle: link.targetPortId,
          type: 'smoothstep',
          data: {
            length_km: link.fiberLength,
            physical_medium_id: link.fiberType,
            fiberLength: link.fiberLength,
            fiberType: link.fiberType,
            status: link.status,
          },
        };

        set((state) => {
          const exists = state.edges.some((e) => e.id === edge.id);
          if (exists) {
            return { edges: state.edges.map((e) => (e.id === edge.id ? edge : e)) };
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
              ? { ...edge, data: { ...edge.data, status: effectiveStatus } }
              : edge
          ),
        }));
        return;
      }

      if (kind === 'deviceMetricsUpdated') {
        const items = (payload?.items ?? []) as Array<{ id: string; trafficLoad: number; rxPower: number; status?: DeviceData['status'] }>;
        set((state) => ({
          nodes: state.nodes.map((node) => {
            const update = items.find((candidate) => candidate.id === node.id);
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
        set((state) => ({
          nodes: state.nodes.map((node) => {
            const item = items.find((candidate) => candidate.id === node.id);
            if (!item) return node;
            return { ...node, data: { ...node.data, status: item.status } };
          }),
        }));
      }
    });

    set({ socketInitialized: true });
  },
}));

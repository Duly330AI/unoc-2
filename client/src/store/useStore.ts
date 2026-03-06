import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import { io, Socket } from 'socket.io-client';

export type DeviceType = 'OLT' | 'Splitter' | 'ONU' | 'Switch' | 'PatchPanel' | 'Amplifier';

export interface DeviceData {
  label: string;
  type: DeviceType;
  status: 'OK' | 'WARNING' | 'FAILURE';
  rxPower?: number;
  trafficLoad?: number;
  ports?: any[];
}

export interface LinkData {
  length: number;
  loss?: number;
  status: 'OK' | 'BROKEN';
}

interface AppState {
  nodes: Node<DeviceData>[];
  edges: Edge<LinkData>[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (node: Node<DeviceData>) => void;
  updateNodeData: (id: string, data: Partial<DeviceData>) => void;
  updateEdgeData: (id: string, data: Partial<LinkData>) => void;
  setNodes: (nodes: Node<DeviceData>[]) => void;
  setEdges: (edges: Edge<LinkData>[]) => void;
  
  // API Actions
  fetchTopology: () => Promise<void>;
  createDevice: (device: { name: string; type: DeviceType; x: number; y: number }) => Promise<void>;
  createLink: (sourceId: string, targetId: string, sourcePortId: string, targetPortId: string) => Promise<void>;
  initializeSocket: () => void;
}

const socket = io();

export const useStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
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
    // Optimistic update handled by socket
    if (connection.source && connection.target && connection.sourceHandle && connection.targetHandle) {
       await get().createLink(connection.source, connection.target, connection.sourceHandle, connection.targetHandle);
    }
  },
  addNode: (node: Node<DeviceData>) => {
    set({
      nodes: [...get().nodes, node],
    });
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

  // API Actions
  fetchTopology: async () => {
    try {
      const res = await fetch('/api/topology');
      const data = await res.json();
      
      // Transform backend data to React Flow format if needed
      // Assuming backend returns { nodes: [], edges: [] } in correct format
      // But we need to map backend Device to Node<DeviceData>
      const nodes = data.nodes.map((d: any) => ({
        id: d.id,
        type: 'deviceNode', // Assuming we have a custom node type
        position: d.position,
        data: { 
          label: d.data.name, 
          type: d.data.type, 
          status: d.data.status,
          ports: d.data.ports 
        },
      }));

      const edges = data.edges.map((l: any) => ({
        id: l.id,
        source: l.source,
        target: l.target,
        sourceHandle: l.sourceHandle,
        targetHandle: l.targetHandle,
        data: { length: l.data.fiberLength, status: l.data.status }
      }));

      set({ nodes, edges });
    } catch (error) {
      console.error("Failed to fetch topology:", error);
    }
  },

  createDevice: async (device) => {
    try {
      await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(device),
      });
    } catch (error) {
      console.error("Failed to create device:", error);
    }
  },

  createLink: async (sourceId, targetId, sourcePortId, targetPortId) => {
    try {
      await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, targetId, sourcePortId, targetPortId }),
      });
    } catch (error) {
      console.error("Failed to create link:", error);
    }
  },

  initializeSocket: () => {
    socket.on('device:created', (device: any) => {
      const newNode: Node<DeviceData> = {
        id: device.id,
        type: 'deviceNode',
        position: { x: device.x, y: device.y },
        data: { 
          label: device.name, 
          type: device.type as DeviceType, 
          status: device.status as any,
          ports: device.ports
        },
      };
      set((state) => ({ nodes: [...state.nodes, newNode] }));
    });

    socket.on('link:created', (link: any) => {
      const newEdge: Edge<LinkData> = {
        id: link.id,
        source: link.sourcePort.deviceId,
        target: link.targetPort.deviceId,
        sourceHandle: link.sourcePortId,
        targetHandle: link.targetPortId,
        data: { length: link.fiberLength, status: link.status as any },
      };
      set((state) => ({ edges: [...state.edges, newEdge] }));
    });
    
    socket.on('device:deleted', ({ id }: { id: string }) => {
      set((state) => ({
        nodes: state.nodes.filter((n) => n.id !== id),
        edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      }));
    });

    socket.on('link:deleted', ({ id }: { id: string }) => {
      set((state) => ({ edges: state.edges.filter((e) => e.id !== id) }));
    });

    socket.on('device:metrics', (updates: any[]) => {
      set((state) => ({
        nodes: state.nodes.map((node) => {
          const update = updates.find((u) => u.id === node.id);
          if (update) {
            return {
              ...node,
              data: {
                ...node.data,
                trafficLoad: update.trafficLoad,
                rxPower: update.rxPower,
              },
            };
          }
          return node;
        }),
      }));
    });
  },
}));

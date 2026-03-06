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

export type DeviceType = 'OLT' | 'Splitter' | 'ONU' | 'Switch' | 'PatchPanel' | 'Amplifier';

export interface DeviceData {
  label: string;
  type: DeviceType;
  status: 'OK' | 'WARNING' | 'FAILURE';
  rxPower?: number;
  trafficLoad?: number;
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
}

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
  onConnect: (connection: Connection) => {
    set({
      edges: addEdge({ ...connection, type: 'smoothstep', data: { length: 1, status: 'OK' } }, get().edges) as Edge<LinkData>[],
    });
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
}));

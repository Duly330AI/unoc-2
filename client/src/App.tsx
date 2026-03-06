import React, { useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  ReactFlowProvider,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore, DeviceType } from './store/useStore';
import { runSimulation } from './simulation/simulationEngine';
import { LucideIcon, Router, Split, Monitor, Server, Activity, AlertTriangle, CheckCircle } from 'lucide-react';

const nodeTypes = {
  // We can define custom node types here if needed
};

const DeviceIcon = ({ type }: { type: DeviceType }) => {
  switch (type) {
    case 'OLT': return <Server className="w-6 h-6 text-blue-600" />;
    case 'Splitter': return <Split className="w-6 h-6 text-orange-500" />;
    case 'ONU': return <Monitor className="w-6 h-6 text-green-600" />;
    default: return <Activity className="w-6 h-6 text-gray-500" />;
  }
};

const Sidebar = () => {
  const onDragStart = (event: React.DragEvent, nodeType: DeviceType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-800">Devices</h2>
      <div className="flex flex-col gap-2">
        {['OLT', 'Splitter', 'ONU', 'Switch'].map((type) => (
          <div
            key={type}
            className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded cursor-grab hover:bg-gray-100"
            onDragStart={(event) => onDragStart(event, type as DeviceType)}
            draggable
          >
            <DeviceIcon type={type as DeviceType} />
            <span>{type}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <h3 className="text-sm font-semibold text-gray-500">Status</h3>
        <div className="flex items-center gap-2 mt-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="text-sm">Simulation Running</span>
        </div>
      </div>
    </aside>
  );
};

const Flow = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setNodes,
    setEdges,
  } = useStore();

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as DeviceType;

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = reactFlowWrapper.current!.getBoundingClientRect();
      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type: 'default', // Using default node for now, can be custom
        position: {
          x: event.clientX - position.left - 20,
          y: event.clientY - position.top - 20,
        },
        data: { label: type, type, status: 'OK' },
      };

      addNode(newNode);
    },
    [addNode]
  );

  // Simulation Loop
  useEffect(() => {
    const interval = setInterval(() => {
      const { nodes, edges, setNodes, setEdges } = useStore.getState();
      
      if (nodes.length > 0) {
        const { nodes: newNodes, edges: newEdges } = runSimulation(nodes, edges);
        // Only update if something changed significantly to avoid re-renders?
        // For now, just update. Ideally, we compare.
        setNodes(newNodes);
        setEdges(newEdges);
      }
    }, 1000); // Run every 1s for now to be safe, can lower to 100ms later

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen w-screen" ref={reactFlowWrapper}>
      <Sidebar />
      <div className="flex-1 h-full bg-gray-50">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={(instance) => console.log('Flow loaded:', instance)}
          onDrop={onDrop}
          onDragOver={onDragOver}
          fitView
        >
          <Controls />
          <MiniMap />
          <Background gap={12} size={1} />
          <Panel position="top-right" className="bg-white p-2 rounded shadow-sm border border-gray-200">
             <div className="text-xs text-gray-500">
                Nodes: {nodes.length} | Edges: {edges.length}
             </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}

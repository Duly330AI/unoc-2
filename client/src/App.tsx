import React, { useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  NodeProps,
  NodeTypes,
  ReactFlowProvider,
  Panel,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from './store/useStore';
import { DEVICE_TYPE_LABEL, DEVICE_TYPE_PALETTE_ORDER, DeviceType } from './deviceTypes';
import { getSimpleDeviceIcon } from './icons/iconRegistry';

const DeviceIcon = ({ type }: { type: DeviceType }) => {
  return <img src={getSimpleDeviceIcon(type)} alt={DEVICE_TYPE_LABEL[type]} className="w-6 h-6 object-contain" />;
};

const Sidebar = () => {
  const socketConnected = useStore((s) => s.socketConnected);
  const onDragStart = (event: React.DragEvent, nodeType: DeviceType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-800">Devices</h2>
      <div className="flex flex-col gap-2">
        {DEVICE_TYPE_PALETTE_ORDER.map((type) => (
          <div
            key={type}
            className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded cursor-grab hover:bg-gray-100"
            onDragStart={(event) => onDragStart(event, type)}
            draggable
          >
            <DeviceIcon type={type} />
            <span>{DEVICE_TYPE_LABEL[type]}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <h3 className="text-sm font-semibold text-gray-500">Status</h3>
        <div className="flex items-center gap-2 mt-2">
          <div className={`w-3 h-3 rounded-full ${socketConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm">{socketConnected ? 'Connected to Backend' : 'Disconnected'}</span>
        </div>
      </div>
    </aside>
  );
};

const DeviceNode = ({ data }: NodeProps<{ label: string; type: DeviceType }>) => {
  const type = data.type;
  return (
    <div className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1 shadow-sm min-w-[120px]">
      <img src={getSimpleDeviceIcon(type)} alt={DEVICE_TYPE_LABEL[type]} className="h-5 w-5 object-contain" />
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{DEVICE_TYPE_LABEL[type]}</span>
        <span className="text-xs text-slate-800 truncate max-w-[140px]">{data.label}</span>
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  device: DeviceNode,
};

const Flow = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { project } = useReactFlow();
  const {
    nodes,
    edges,
    lastError,
    onNodesChange,
    onEdgesChange,
    onConnect,
    fetchTopology,
    initializeSocket,
    createDevice,
    fetchOpticalPath,
    clearPathHighlight,
  } = useStore();

  useEffect(() => {
    initializeSocket();
    fetchTopology();
  }, [fetchTopology, initializeSocket]);

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

      const reactFlowBounds = reactFlowWrapper.current!.getBoundingClientRect();
      const position = project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      createDevice({
        name: `${type}-${Date.now()}`,
        type,
        x: position.x,
        y: position.y,
      });
    },
    [createDevice, project]
  );

  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <div className="flex-1 h-full bg-gray-50" ref={reactFlowWrapper}>
        <ReactFlow
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => { void fetchOpticalPath(node.id); }}
          onPaneClick={() => clearPathHighlight()}
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
             {lastError ? (
              <div className="mt-1 text-xs text-red-600 max-w-[360px] break-words">{lastError}</div>
             ) : null}
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

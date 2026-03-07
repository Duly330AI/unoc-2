import React, { useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  NodeProps,
  NodeTypes,
  Position,
  ReactFlowProvider,
  Panel,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from './store/useStore';
import {
  comparePortsForDirection,
  DEVICE_TYPE_LABEL,
  DEVICE_TYPE_PALETTE_ORDER,
  DeviceType,
  getPortDirection,
} from './deviceTypes';
import { getSimpleDeviceIcon } from './icons/iconRegistry';

const DeviceIcon = ({ type }: { type: DeviceType }) => {
  return <img src={getSimpleDeviceIcon(type)} alt={DEVICE_TYPE_LABEL[type]} className="w-6 h-6 object-contain" />;
};

const infraNodeClass = (status: 'UP' | 'DOWN' | 'DEGRADED' | 'BLOCKING') => {
  if (status === 'UP') return 'border-emerald-400 bg-emerald-50';
  if (status === 'DEGRADED') return 'border-amber-400 bg-amber-50';
  if (status === 'BLOCKING') return 'border-violet-400 bg-violet-50';
  return 'border-rose-400 bg-rose-50';
};

const serviceBadgeClass = (status?: 'UP' | 'DOWN' | 'DEGRADED' | null) => {
  if (status === 'UP') return 'bg-emerald-500 text-white';
  if (status === 'DEGRADED') return 'bg-amber-500 text-white';
  if (status === 'DOWN') return 'bg-rose-500 text-white';
  return 'bg-slate-200 text-slate-500';
};

const computeHandleTop = (index: number, total: number) => {
  if (total <= 1) return '50%';
  return `${14 + ((index + 1) / (total + 1)) * 72}%`;
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

const DeviceNode = ({
  data,
}: NodeProps<{
  label: string;
  type: DeviceType;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'BLOCKING';
  serviceStatus?: 'UP' | 'DOWN' | 'DEGRADED' | null;
  serviceReasonCode?: string | null;
  ports?: Array<{ id: string; portType: string }>;
}>) => {
  const type = data.type;
  const normalizedPorts = (data.ports ?? []).map((port) => ({
    ...port,
    normalizedPortType: String(port.portType ?? '').toUpperCase(),
  }));
  const leftPorts = normalizedPorts
    .filter((port) => getPortDirection(type, port.normalizedPortType) === 'left')
    .sort((a, b) => comparePortsForDirection('left', a.normalizedPortType, b.normalizedPortType));
  const rightPorts = normalizedPorts
    .filter((port) => getPortDirection(type, port.normalizedPortType) === 'right')
    .sort((a, b) => comparePortsForDirection('right', a.normalizedPortType, b.normalizedPortType));
  const maxVisiblePorts = Math.max(leftPorts.length, rightPorts.length, 1);
  const nodeMinWidth = maxVisiblePorts >= 8 ? 'min-w-[220px]' : maxVisiblePorts >= 4 ? 'min-w-[180px]' : 'min-w-[150px]';
  const serviceTitle = data.serviceReasonCode
    ? `Service ${data.serviceStatus ?? 'UNKNOWN'}: ${data.serviceReasonCode}`
    : data.serviceStatus
      ? `Service ${data.serviceStatus}`
      : 'No subscriber service state';
  return (
    <div className={`relative flex items-center gap-3 rounded border px-3 py-2 shadow-sm ${nodeMinWidth} ${infraNodeClass(data.status)}`}>
      {leftPorts.map((port, idx) => {
        const top = computeHandleTop(idx, leftPorts.length);
        return (
          <Handle
            key={port.id}
            id={port.id}
            type="target"
            position={Position.Left}
            style={{ top, width: 8, height: 8, borderRadius: 9999, background: '#475569' }}
            title={port.normalizedPortType}
          />
        );
      })}
      {rightPorts.map((port, idx) => {
        const top = computeHandleTop(idx, rightPorts.length);
        return (
          <Handle
            key={port.id}
            id={port.id}
            type="source"
            position={Position.Right}
            style={{ top, width: 8, height: 8, borderRadius: 9999, background: '#475569' }}
            title={port.normalizedPortType}
          />
        );
      })}
      <div
        className={`absolute -right-2 -top-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-sm ${serviceBadgeClass(data.serviceStatus)}`}
        title={serviceTitle}
      >
        svc
      </div>
      <img src={getSimpleDeviceIcon(type)} alt={DEVICE_TYPE_LABEL[type]} className="h-5 w-5 object-contain" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{DEVICE_TYPE_LABEL[type]}</span>
        <span className="text-xs text-slate-800 truncate">{data.label}</span>
        {data.serviceStatus ? (
          <span className="text-[10px] uppercase tracking-wide text-slate-600">
            Service {data.serviceStatus}
          </span>
        ) : null}
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
    fetchSessions,
  } = useStore();

  useEffect(() => {
    initializeSocket();
    void fetchTopology();
    void fetchSessions();
  }, [fetchSessions, fetchTopology, initializeSocket]);

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

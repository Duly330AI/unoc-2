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
import { getCockpitDeviceIcon, getSimpleDeviceIcon } from './icons/iconRegistry';

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

const statusTextClass = (status: 'UP' | 'DOWN' | 'DEGRADED' | 'BLOCKING') => {
  if (status === 'UP') return 'text-emerald-700';
  if (status === 'DEGRADED') return 'text-amber-700';
  if (status === 'BLOCKING') return 'text-violet-700';
  return 'text-rose-700';
};

const isRouterLikeType = (type: DeviceType) =>
  type === 'CORE_ROUTER' || type === 'EDGE_ROUTER' || type === 'BACKBONE_GATEWAY';

const isSubscriberType = (type: DeviceType) =>
  type === 'ONT' || type === 'BUSINESS_ONT' || type === 'AON_CPE';

const isPassiveInlineType = (type: DeviceType) =>
  type === 'SPLITTER' || type === 'ODF' || type === 'NVT' || type === 'HOP';

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
  id,
  data,
}: NodeProps<{
  label: string;
  type: DeviceType;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'BLOCKING';
  serviceStatus?: 'UP' | 'DOWN' | 'DEGRADED' | null;
  serviceReasonCode?: string | null;
  expanded?: boolean;
  rxPower?: number;
  trafficLoad?: number;
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
  ports?: Array<{ id: string; portType: string }>;
}>) => {
  const toggleNodeExpanded = useStore((s) => s.toggleNodeExpanded);
  const fetchDeviceCockpitData = useStore((s) => s.fetchDeviceCockpitData);
  const deviceSessions = useStore((s) =>
    Object.values(s.serviceSessionsById).filter((session) => session.deviceId === id)
  );
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
  const isExpanded = Boolean(data.expanded);
  const maxVisiblePorts = Math.max(leftPorts.length, rightPorts.length, 1);
  const nodeMinWidth = isExpanded
    ? 'min-w-[260px]'
    : maxVisiblePorts >= 8
      ? 'min-w-[220px]'
      : maxVisiblePorts >= 4
        ? 'min-w-[180px]'
        : 'min-w-[150px]';
  const serviceTitle = data.serviceReasonCode
    ? `Service ${data.serviceStatus ?? 'UNKNOWN'}: ${data.serviceReasonCode}`
    : data.serviceStatus
      ? `Service ${data.serviceStatus}`
      : 'No subscriber service state';
  const portSummary = data.portSummary;
  const ponSummary = portSummary?.byRole.PON;
  const uplinkSummary = portSummary?.byRole.UPLINK;
  const accessSummary = portSummary?.byRole.ACCESS;
  const connectedOnts = data.connectedOnts ?? [];
  const diagnostics = data.diagnostics;
  const primaryAddress = data.interfaceDetails
    ?.flatMap((item) => item.addresses)
    .find((address) => address.is_primary);
  const primarySession = deviceSessions.find((session) => session.state === 'ACTIVE') ?? deviceSessions[0];
  const diagnosticsSummary = diagnostics
    ? diagnostics.upstreamL3Ok
      ? 'Upstream OK'
      : diagnostics.reasonCodes.join(', ') || 'Upstream failed'
    : 'Diagnostics unavailable';
  const diagnosticsChain = diagnostics?.chain.length ? diagnostics.chain.join(' -> ') : null;
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
      <button
        type="button"
        className="absolute -left-2 -top-2 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm"
        onClick={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!isExpanded) {
            await fetchDeviceCockpitData(id, type);
          }
          toggleNodeExpanded(id);
        }}
        title={isExpanded ? 'Collapse cockpit card' : 'Expand cockpit card'}
      >
        {isExpanded ? '−' : '+'}
      </button>
      <div
        className={`absolute -right-2 -top-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-sm ${serviceBadgeClass(data.serviceStatus)}`}
        title={serviceTitle}
      >
        svc
      </div>
      {isExpanded ? (
        <>
          <img src={getCockpitDeviceIcon(type)} alt={DEVICE_TYPE_LABEL[type]} className="h-16 w-16 shrink-0 object-contain" />
          {type === 'OLT' ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">OLT Cockpit</span>
              <span className="text-sm font-semibold text-slate-900 truncate">{data.label}</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide">
                <span className="text-slate-500">Infra</span>
                <span className={statusTextClass(data.status)}>{data.status}</span>
                <span className="text-slate-500">PON</span>
                <span className="text-slate-700">
                  {ponSummary ? `${ponSummary.used}/${ponSummary.total}` : 'N/A'}
                </span>
                <span className="text-slate-500">Split</span>
                <span className="text-slate-700">
                  {ponSummary?.maxSubscribers ? `1:${ponSummary.maxSubscribers}` : 'Aggregated'}
                </span>
                <span className="text-slate-500">Uplink</span>
                <span className="text-slate-700">
                  {uplinkSummary ? `${uplinkSummary.used}/${uplinkSummary.total}` : 'N/A'}
                </span>
                <span className="text-slate-500">ONTs</span>
                <span className="text-slate-700">{connectedOnts.length}</span>
                <span className="text-slate-500">Load</span>
                <span className="text-slate-700">{data.trafficLoad ?? 0}%</span>
              </div>
              <span className="text-[10px] text-slate-600 truncate" title={diagnosticsSummary}>
                {diagnosticsSummary}
              </span>
              {diagnosticsChain ? (
                <span className="text-[10px] text-slate-500 truncate" title={diagnosticsChain}>
                  {diagnosticsChain}
                </span>
              ) : null}
              {connectedOnts.length > 0 ? (
                <div className="mt-1 flex flex-col gap-0.5 text-[10px] text-slate-600">
                  {connectedOnts.slice(0, 3).map((ont) => (
                    <span key={ont.id} className="truncate" title={`${ont.type} ${ont.name}`}>
                      {ont.type}: {ont.name}
                    </span>
                  ))}
                  {connectedOnts.length > 3 ? (
                    <span className="text-slate-500">+{connectedOnts.length - 3} more</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : isRouterLikeType(type) ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Router Cockpit</span>
              <span className="text-sm font-semibold text-slate-900 truncate">{data.label}</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide">
                <span className="text-slate-500">Infra</span>
                <span className={statusTextClass(data.status)}>{data.status}</span>
                <span className="text-slate-500">Load</span>
                <span className="text-slate-700">{data.trafficLoad ?? 0}%</span>
                <span className="text-slate-500">Uplink</span>
                <span className="text-slate-700">
                  {uplinkSummary ? `${uplinkSummary.used}/${uplinkSummary.total}` : 'N/A'}
                </span>
                <span className="text-slate-500">Access</span>
                <span className="text-slate-700">
                  {accessSummary ? `${accessSummary.used}/${accessSummary.total}` : 'N/A'}
                </span>
                <span className="text-slate-500">Ports</span>
                <span className="text-slate-700">{portSummary?.total ?? 'N/A'}</span>
                <span className="text-slate-500">Service</span>
                <span className="text-slate-700">{data.serviceStatus ?? 'N/A'}</span>
              </div>
              <span className="text-[10px] text-slate-600 truncate" title={diagnosticsSummary}>
                {diagnosticsSummary}
              </span>
              {diagnosticsChain ? (
                <span className="text-[10px] text-slate-500 truncate" title={diagnosticsChain}>
                  {diagnosticsChain}
                </span>
              ) : null}
              {data.serviceReasonCode ? (
                <span className="text-[10px] text-slate-600 truncate" title={data.serviceReasonCode}>
                  {data.serviceReasonCode}
                </span>
              ) : null}
            </div>
          ) : isSubscriberType(type) ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">{DEVICE_TYPE_LABEL[type]} Cockpit</span>
              <span className="text-sm font-semibold text-slate-900 truncate">{data.label}</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide">
                <span className="text-slate-500">Infra</span>
                <span className={statusTextClass(data.status)}>{data.status}</span>
                <span className="text-slate-500">Service</span>
                <span className="text-slate-700">{data.serviceStatus ?? 'N/A'}</span>
                <span className="text-slate-500">Load</span>
                <span className="text-slate-700">{data.trafficLoad ?? 0}%</span>
                <span className="text-slate-500">Rx</span>
                <span className="text-slate-700">
                  {typeof data.rxPower === 'number' ? `${data.rxPower.toFixed(1)} dBm` : 'N/A'}
                </span>
                <span className="text-slate-500">WAN</span>
                <span className="text-slate-700">
                  {primaryAddress ? `${primaryAddress.ip}/${primaryAddress.prefix_len}` : 'N/A'}
                </span>
                <span className="text-slate-500">Session</span>
                <span className="text-slate-700">{primarySession?.state ?? 'N/A'}</span>
                <span className="text-slate-500">ServiceType</span>
                <span className="text-slate-700">{primarySession?.serviceType ?? 'N/A'}</span>
                <span className="text-slate-500">Protocol</span>
                <span className="text-slate-700">{primarySession?.protocol ?? 'N/A'}</span>
              </div>
              <span className="text-[10px] text-slate-600 truncate" title={diagnosticsSummary}>
                {diagnosticsSummary}
              </span>
              {diagnosticsChain ? (
                <span className="text-[10px] text-slate-500 truncate" title={diagnosticsChain}>
                  {diagnosticsChain}
                </span>
              ) : null}
              {data.serviceReasonCode ? (
                <span className="text-[10px] text-slate-600 truncate" title={data.serviceReasonCode}>
                  {data.serviceReasonCode}
                </span>
              ) : null}
            </div>
          ) : isPassiveInlineType(type) ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Passive Cockpit</span>
              <span className="text-sm font-semibold text-slate-900 truncate">{data.label}</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide">
                <span className="text-slate-500">Infra</span>
                <span className={statusTextClass(data.status)}>{data.status}</span>
                <span className="text-slate-500">Ingress</span>
                <span className="text-slate-700">
                  {uplinkSummary ? `${uplinkSummary.used}/${uplinkSummary.total}` : 'N/A'}
                </span>
                <span className="text-slate-500">Egress</span>
                <span className="text-slate-700">
                  {accessSummary ? `${accessSummary.used}/${accessSummary.total}` : 'N/A'}
                </span>
                <span className="text-slate-500">Ports</span>
                <span className="text-slate-700">{portSummary?.total ?? 'N/A'}</span>
                <span className="text-slate-500">Load</span>
                <span className="text-slate-700">{data.trafficLoad ?? 0}%</span>
              </div>
              <span className="text-[10px] text-slate-600 truncate" title={diagnosticsSummary}>
                {diagnosticsSummary}
              </span>
              {diagnosticsChain ? (
                <span className="text-[10px] text-slate-500 truncate" title={diagnosticsChain}>
                  {diagnosticsChain}
                </span>
              ) : null}
              {type === 'SPLITTER' && accessSummary ? (
                <span className="text-[10px] text-slate-600">
                  Split outputs {accessSummary.used}/{accessSummary.total}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">{DEVICE_TYPE_LABEL[type]} Cockpit</span>
              <span className="text-sm font-semibold text-slate-900 truncate">{data.label}</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide">
                <span className="text-slate-500">Infra</span>
                <span className={statusTextClass(data.status)}>{data.status}</span>
                <span className="text-slate-500">Service</span>
                <span className="text-slate-700">{data.serviceStatus ?? 'N/A'}</span>
                <span className="text-slate-500">Load</span>
                <span className="text-slate-700">{data.trafficLoad ?? 0}%</span>
                <span className="text-slate-500">Rx</span>
                <span className="text-slate-700">{typeof data.rxPower === 'number' ? `${data.rxPower.toFixed(1)} dBm` : 'N/A'}</span>
              </div>
              {data.serviceReasonCode ? (
                <span className="text-[10px] text-slate-600 truncate" title={data.serviceReasonCode}>
                  {data.serviceReasonCode}
                </span>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <>
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
        </>
      )}
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
          defaultEdgeOptions={{ type: 'smoothstep' }}
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

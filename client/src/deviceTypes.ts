export type DeviceType =
  | "BACKBONE_GATEWAY"
  | "CORE_ROUTER"
  | "EDGE_ROUTER"
  | "OLT"
  | "AON_SWITCH"
  | "SPLITTER"
  | "ONT"
  | "BUSINESS_ONT"
  | "AON_CPE"
  | "SWITCH"
  | "ODF"
  | "NVT"
  | "HOP"
  | "POP"
  | "CORE_SITE";

const DEVICE_TYPE_ALIASES: Record<string, DeviceType> = {
  BACKBONE_GATEWAY: "BACKBONE_GATEWAY",
  CORE_ROUTER: "CORE_ROUTER",
  EDGE_ROUTER: "EDGE_ROUTER",
  OLT: "OLT",
  AON_SWITCH: "AON_SWITCH",
  SPLITTER: "SPLITTER",
  ONT: "ONT",
  BUSINESS_ONT: "BUSINESS_ONT",
  AON_CPE: "AON_CPE",
  SWITCH: "SWITCH",
  ODF: "ODF",
  NVT: "NVT",
  HOP: "HOP",
  POP: "POP",
  CORE_SITE: "CORE_SITE",
};

const CANONICAL_TYPES = new Set<DeviceType>([
  "BACKBONE_GATEWAY",
  "CORE_ROUTER",
  "EDGE_ROUTER",
  "OLT",
  "AON_SWITCH",
  "SPLITTER",
  "ONT",
  "BUSINESS_ONT",
  "AON_CPE",
  "SWITCH",
  "ODF",
  "NVT",
  "HOP",
  "POP",
  "CORE_SITE",
]);

export const normalizeDeviceType = (rawType: string): DeviceType => {
  if (!rawType) return "SWITCH";
  const direct = rawType as DeviceType;
  if (CANONICAL_TYPES.has(direct)) return direct;
  const alias = DEVICE_TYPE_ALIASES[rawType.toUpperCase()];
  return alias ?? "SWITCH";
};

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  BACKBONE_GATEWAY: "Backbone Gateway",
  CORE_ROUTER: "Core Router",
  EDGE_ROUTER: "Edge Router",
  OLT: "OLT",
  AON_SWITCH: "AON Switch",
  SPLITTER: "Splitter",
  ONT: "ONT",
  BUSINESS_ONT: "Business ONT",
  AON_CPE: "AON CPE",
  SWITCH: "Switch",
  ODF: "ODF",
  NVT: "NVT",
  HOP: "HOP",
  POP: "POP",
  CORE_SITE: "Core Site",
};

export const DEVICE_TYPE_PALETTE_ORDER: DeviceType[] = [
  "BACKBONE_GATEWAY",
  "CORE_SITE",
  "POP",
  "CORE_ROUTER",
  "EDGE_ROUTER",
  "OLT",
  "AON_SWITCH",
  "SPLITTER",
  "ONT",
  "BUSINESS_ONT",
  "AON_CPE",
  "SWITCH",
];

export type DevicePortDirection = "left" | "right" | "hidden";

const LEFT_PORT_PRIORITY: Record<string, number> = {
  UPLINK: 10,
  IN: 20,
  PON: 30,
  ACCESS: 40,
  LAN: 50,
  OUT: 60,
};

const RIGHT_PORT_PRIORITY: Record<string, number> = {
  ACCESS: 10,
  LAN: 20,
  OUT: 30,
  PON: 40,
  UPLINK: 50,
  IN: 60,
};

export const getPortDirection = (deviceType: DeviceType, rawPortType: string): DevicePortDirection => {
  const portType = String(rawPortType ?? "").toUpperCase();

  if (portType === "MANAGEMENT" || portType === "MGMT") {
    return "hidden";
  }

  if (deviceType === "OLT") {
    if (portType === "UPLINK") return "left";
    if (portType === "PON") return "right";
  }

  if (deviceType === "SPLITTER" || deviceType === "ODF" || deviceType === "NVT" || deviceType === "HOP") {
    if (portType === "IN") return "left";
    if (portType === "OUT") return "right";
  }

  if (deviceType === "ONT" || deviceType === "BUSINESS_ONT") {
    if (portType === "PON") return "left";
    if (portType === "LAN") return "right";
  }

  if (deviceType === "AON_CPE") {
    if (portType === "ACCESS") return "left";
  }

  if (
    deviceType === "BACKBONE_GATEWAY" ||
    deviceType === "CORE_ROUTER" ||
    deviceType === "EDGE_ROUTER" ||
    deviceType === "AON_SWITCH" ||
    deviceType === "SWITCH"
  ) {
    if (portType === "UPLINK") return "left";
    if (portType === "ACCESS" || portType === "LAN") return "right";
  }

  if (portType === "UPLINK" || portType === "IN" || portType === "PON") {
    return "left";
  }

  if (portType === "ACCESS" || portType === "LAN" || portType === "OUT") {
    return "right";
  }

  return "hidden";
};

export const comparePortsForDirection = (direction: Exclude<DevicePortDirection, "hidden">, a: string, b: string) => {
  const leftPriority = LEFT_PORT_PRIORITY[a] ?? 999;
  const rightPriority = RIGHT_PORT_PRIORITY[a] ?? 999;
  const otherLeftPriority = LEFT_PORT_PRIORITY[b] ?? 999;
  const otherRightPriority = RIGHT_PORT_PRIORITY[b] ?? 999;

  if (direction === "left") {
    return leftPriority - otherLeftPriority || a.localeCompare(b);
  }

  return rightPriority - otherRightPriority || a.localeCompare(b);
};

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

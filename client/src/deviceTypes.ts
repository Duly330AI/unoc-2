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
  ONU: "ONT",
  ONT: "ONT",
  BUSINESS_ONT: "BUSINESS_ONT",
  BUSINESSONT: "BUSINESS_ONT",
  AON_CPE: "AON_CPE",
  AONCPE: "AON_CPE",
  AON_SWITCH: "AON_SWITCH",
  AONSWITCH: "AON_SWITCH",
  SPLITTER: "SPLITTER",
  SWITCH: "SWITCH",
  BACKBONE_GATEWAY: "BACKBONE_GATEWAY",
  BACKBONEGATEWAY: "BACKBONE_GATEWAY",
  CORE_ROUTER: "CORE_ROUTER",
  COREROUTER: "CORE_ROUTER",
  EDGE_ROUTER: "EDGE_ROUTER",
  EDGEROUTER: "EDGE_ROUTER",
  CORE_SITE: "CORE_SITE",
  CORESITE: "CORE_SITE",
  POP: "POP",
  ODF: "ODF",
  PATCHPANEL: "ODF",
  NVT: "NVT",
  HOP: "HOP",
  AMPLIFIER: "NVT",
  BACKBONEGATEWAY_LEGACY: "BACKBONE_GATEWAY",
  COREROUTER_LEGACY: "CORE_ROUTER",
  EDGEROUTER_LEGACY: "EDGE_ROUTER",
  AONSWITCH_LEGACY: "AON_SWITCH",
  BUSINESSONT_LEGACY: "BUSINESS_ONT",
  AONCPE_LEGACY: "AON_CPE",
  SWITCH_LEGACY: "SWITCH",
  PATCHPANEL_LEGACY: "ODF",
  AMPLIFIER_LEGACY: "NVT",
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
  const alias = DEVICE_TYPE_ALIASES[rawType.toUpperCase()] ?? DEVICE_TYPE_ALIASES[`${rawType.toUpperCase()}_LEGACY`];
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

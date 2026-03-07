export type DeviceType =
  | "BackboneGateway"
  | "CoreRouter"
  | "EdgeRouter"
  | "OLT"
  | "AONSwitch"
  | "Splitter"
  | "ONT"
  | "BusinessONT"
  | "AONCPE"
  | "Switch"
  | "PatchPanel"
  | "Amplifier"
  | "POP"
  | "CORE_SITE";

const DEVICE_TYPE_ALIASES: Record<string, DeviceType> = {
  ONU: "ONT",
  ONT: "ONT",
  BUSINESS_ONT: "BusinessONT",
  BUSINESSONT: "BusinessONT",
  AON_CPE: "AONCPE",
  AONCPE: "AONCPE",
  AON_SWITCH: "AONSwitch",
  AONSWITCH: "AONSwitch",
  SPLITTER: "Splitter",
  SWITCH: "Switch",
  ROUTER: "Switch",
  BACKBONE_GATEWAY: "BackboneGateway",
  BACKBONEGATEWAY: "BackboneGateway",
  CORE_ROUTER: "CoreRouter",
  COREROUTER: "CoreRouter",
  EDGE_ROUTER: "EdgeRouter",
  EDGEROUTER: "EdgeRouter",
  CORE_SITE: "CORE_SITE",
  CORESITE: "CORE_SITE",
  POP: "POP",
  ODF: "PatchPanel",
  PATCHPANEL: "PatchPanel",
  NVT: "PatchPanel",
  HOP: "PatchPanel",
  AMPLIFIER: "Amplifier",
};

const CANONICAL_TYPES = new Set<DeviceType>([
  "BackboneGateway",
  "CoreRouter",
  "EdgeRouter",
  "OLT",
  "AONSwitch",
  "Splitter",
  "ONT",
  "BusinessONT",
  "AONCPE",
  "Switch",
  "PatchPanel",
  "Amplifier",
  "POP",
  "CORE_SITE",
]);

export const normalizeDeviceType = (rawType: string): DeviceType => {
  if (!rawType) return "Switch";
  const direct = rawType as DeviceType;
  if (CANONICAL_TYPES.has(direct)) return direct;
  const alias = DEVICE_TYPE_ALIASES[rawType.toUpperCase()];
  return alias ?? "Switch";
};

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  BackboneGateway: "Backbone Gateway",
  CoreRouter: "Core Router",
  EdgeRouter: "Edge Router",
  OLT: "OLT",
  AONSwitch: "AON Switch",
  Splitter: "Splitter",
  ONT: "ONT",
  BusinessONT: "Business ONT",
  AONCPE: "AON CPE",
  Switch: "Switch",
  PatchPanel: "Patch Panel",
  Amplifier: "Amplifier",
  POP: "POP",
  CORE_SITE: "Core Site",
};

export const DEVICE_TYPE_PALETTE_ORDER: DeviceType[] = [
  "BackboneGateway",
  "CORE_SITE",
  "POP",
  "CoreRouter",
  "EdgeRouter",
  "OLT",
  "AONSwitch",
  "Splitter",
  "ONT",
  "BusinessONT",
  "AONCPE",
  "Switch",
];

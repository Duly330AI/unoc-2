import { DeviceType, normalizeDeviceType } from "./deviceTypes";

export type CockpitVariant = "OLT" | "ROUTER" | "CONTAINER" | "SUBSCRIBER" | "PASSIVE" | "GENERIC";

const ROUTER_TYPES = new Set<DeviceType>([
  "BACKBONE_GATEWAY",
  "CORE_ROUTER",
  "EDGE_ROUTER",
  "AON_SWITCH",
  "SWITCH",
]);

const CONTAINER_TYPES = new Set<DeviceType>(["POP", "CORE_SITE"]);

const SUBSCRIBER_TYPES = new Set<DeviceType>(["ONT", "BUSINESS_ONT", "AON_CPE"]);

const PASSIVE_TYPES = new Set<DeviceType>(["SPLITTER", "ODF", "NVT", "HOP"]);

export const getCockpitVariant = (input: DeviceType | string): CockpitVariant => {
  const type = typeof input === "string" ? normalizeDeviceType(input) : input;

  if (type === "OLT") return "OLT";
  if (ROUTER_TYPES.has(type)) return "ROUTER";
  if (CONTAINER_TYPES.has(type)) return "CONTAINER";
  if (SUBSCRIBER_TYPES.has(type)) return "SUBSCRIBER";
  if (PASSIVE_TYPES.has(type)) return "PASSIVE";
  return "GENERIC";
};

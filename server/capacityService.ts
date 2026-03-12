type CatalogEntry = {
  catalog_id: string;
  device_type: string;
  vendor: string;
  model: string;
  version: string;
  attributes: Record<string, unknown>;
};

export const DEFAULT_PON_MAX_SUBSCRIBERS = 64;

const parseMaxSubscribers = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const matches = value.match(/\d+/g);
    if (!matches || matches.length === 0) return null;
    const numbers = matches.map((item) => Number(item)).filter((num) => Number.isFinite(num));
    if (numbers.length === 0) return null;
    return Math.max(...numbers);
  }
  return null;
};

export const resolvePonMaxSubscribers = (args: {
  deviceType: string;
  model: string | null;
  hardwareCatalog: CatalogEntry[];
  normalizeDeviceType: (input: string) => string | undefined;
}): number | null => {
  const normalizedType = args.normalizeDeviceType(args.deviceType);
  if (normalizedType !== "OLT") return null;
  if (!args.model) return null;

  const entry = args.hardwareCatalog.find(
    (item) => item.device_type.toUpperCase() === "OLT" && item.model.toLowerCase() === args.model!.toLowerCase()
  );
  if (!entry) return null;

  const attributes = entry.attributes ?? {};
  return (
    parseMaxSubscribers((attributes as Record<string, unknown>)["ONTs_pro_Port"]) ??
    parseMaxSubscribers((attributes as Record<string, unknown>)["onts_pro_port"]) ??
    parseMaxSubscribers((attributes as Record<string, unknown>)["onts_per_port"]) ??
    null
  );
};

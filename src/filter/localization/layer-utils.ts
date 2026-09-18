/**
 * Pure layer identity / field / match helpers for LocalizationPanel.
 */

export function getFeatureLayerKey(layer: any): string {
  const id = (layer?.id || "").toString().trim();
  const url = (layer?.url || "").toString().trim();
  const title = (layer?.title || "").toString().trim();
  return id || url || title || "unknown_layer";
}

/** Exact → case-insensitive → partial field name match. */
export function findLayerFieldName(
  layer: any,
  name: string,
): string | null {
  try {
    const fields: any[] = layer?.fields || [];
    if (!Array.isArray(fields) || !fields.length) return null;
    const exact = fields.find((f) => String(f?.name || "") === name);
    if (exact?.name) return exact.name;
    const ci = fields.find(
      (f) => String(f?.name || "").toLowerCase() === name.toLowerCase(),
    );
    if (ci?.name) return ci.name;
    const partial = fields.find((f) => {
      const n = String(f?.name || "").toLowerCase();
      const q = name.toLowerCase();
      return n.includes(q) || q.includes(n);
    });
    return partial?.name ?? null;
  } catch {
    return null;
  }
}

export function buildCropDistinctCacheKey(
  layer: any,
  field: string,
  where: string,
): string {
  const url =
    String(layer?.url || "") ||
    `${String(layer?.layer?.url || "")}/${String(layer?.id ?? "")}`;
  return `${url}|${field}|${where}`;
}

export type LayerViloyatMatchState = "match" | "mismatch" | "unknown";

/**
 * Whether a layer is known to belong to the selected viloyat key.
 * Inject maps + key builders from the panel.
 */
export function getLayerMatchStateForViloyat(opts: {
  effectiveViloyat: string;
  layer: any;
  viloyatKeyToLayerKeys: Record<string, string[]>;
  makeRegionDistrictKey: (raw: string | null | undefined) => string;
  getLayerKey?: (layer: any) => string;
}): LayerViloyatMatchState {
  const { effectiveViloyat, layer, viloyatKeyToLayerKeys } = opts;
  if (!effectiveViloyat) return "unknown";
  const vKey = opts.makeRegionDistrictKey(effectiveViloyat);
  if (!vKey) return "unknown";
  const matchingLayerKeys = viloyatKeyToLayerKeys[vKey] || [];
  if (!matchingLayerKeys.length) return "unknown";
  const layerKey = (opts.getLayerKey || getFeatureLayerKey)(layer);
  return matchingLayerKeys.includes(layerKey) ? "match" : "mismatch";
}

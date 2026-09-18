/**
 * Pure helpers for shown region-year MapImage extent collection.
 * ArcGIS queryExtent / goTo stay in LocalizationPanel.
 */
import { isEmptyMapExtent } from "./map-zoom-policy";

export type ShownRegionYearExtentEntry = {
  layer?: any;
  sublayers?: any[];
};

/**
 * Sublayers to query for a shown region-year entry.
 * Prefer entry.sublayers ∪ live allSublayers; else the parent layer.
 */
export function collectShownRegionYearQueryTargets(
  entry: ShownRegionYearExtentEntry | null | undefined,
): any[] {
  if (!entry) return [];
  const liveSublayers: any[] =
    (entry.layer as any)?.allSublayers?.toArray?.() || [];
  const childSublayers = Array.from(
    new Set<any>([...(entry.sublayers || []), ...liveSublayers]),
  );
  if (childSublayers.length > 0) return childSublayers;
  return entry.layer ? [entry.layer] : [];
}

/**
 * Live definitionExpression for extent query.
 * Returns null when empty or blocked (`1=0`) — matches shown-region / district paths.
 */
export function readQueryableDefinitionExpression(layer: any): string | null {
  const where = String(layer?.definitionExpression || "1=1").trim();
  if (!where || where === "1=0") return null;
  return where;
}

/** Union non-empty extents (clone first, then union). */
export function unionMapExtents(extents: any[]): any | null {
  let merged: any = null;
  for (const extent of extents) {
    if (isEmptyMapExtent(extent)) continue;
    merged = merged ? merged.union(extent) : extent.clone?.() || extent;
  }
  return isEmptyMapExtent(merged) ? null : merged;
}

/**
 * Fallback when DE queryExtent yields nothing: parent MapImage fullExtent.
 */
export function unionShownRegionYearFullExtents(
  entries: ShownRegionYearExtentEntry[] | null | undefined,
): any | null {
  if (!entries?.length) return null;
  const fulls: any[] = [];
  for (const entry of entries) {
    const full = (entry.layer as any)?.fullExtent;
    if (!isEmptyMapExtent(full)) fulls.push(full);
  }
  return unionMapExtents(fulls);
}

/**
 * Crop / NDVI / vegetation spatial FeatureLayer WHERE for extent query.
 * Intentionally no trim — matches applyMapFiltersOptimized crop path.
 */
export function readSpatialFeatureExtentWhere(layer: any): string | null {
  const where = layer?.definitionExpression || "1=1";
  if (where === "1=0") return null;
  return where;
}

/** After load: only layers with geometryType are queryExtent-capable. */
export function canQuerySpatialFeatureExtent(layer: any): boolean {
  return !!(layer as any)?.geometryType;
}

/**
 * Accumulate crop-path spatial extents.
 * Uses `extent.clone()` (not clone?.() || extent) — matches panel crop loop.
 */
export function appendSpatialFeatureExtent(merged: any, extent: any): any {
  if (isEmptyMapExtent(extent)) return merged ?? null;
  return merged ? merged.union(extent) : extent.clone();
}

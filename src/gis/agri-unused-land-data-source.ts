/**
 * Shared access to the Agri_unused_land FeatureLayer (unused-land polygons).
 *
 * Separate ArcGIS Server service from Agri_table_data — same field-naming
 * convention for the geo/year scope (viloyat, tuman, yil, region, district,
 * uniqueid), so it can be filtered the same way, but it is its own service
 * and must be loaded independently.
 */
import { getAgriServiceUrls } from "../shared/agri-service-urls";
import { createSingletonLayerLoader } from "../shared/agri-singleton-layer-loader";

/** Logger disabled — keep call sites without console noise. */
export function agriUnusedLandLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export function getAgriUnusedLandUrl(): string {
  return getAgriServiceUrls().unusedLandUrl;
}

export interface AgriUnusedLandLayerHandle {
  layer: any;
  fields: string[];
}

const getAgriUnusedLandLayerCached = createSingletonLayerLoader(
  getAgriUnusedLandUrl,
  agriUnusedLandLog,
);

/**
 * Loads (once) the Agri_unused_land FeatureLayer by URL. Cached as a
 * singleton promise so every widget shares the same loaded layer instance.
 */
export async function getAgriUnusedLandLayer(): Promise<AgriUnusedLandLayerHandle> {
  return getAgriUnusedLandLayerCached();
}

/**
 * Shared access to the Agri_reserve_land FeatureLayer (reserve-land polygons).
 *
 * Separate ArcGIS Server service from Agri_table_data — same field-naming
 * convention for the geo/year scope (viloyat, tuman, yil, region, district,
 * uniqueid), so it can be filtered the same way, but it is its own service
 * and must be loaded independently.
 */
import { getAgriServiceUrls } from "../shared/agri-service-urls";
import { createSingletonLayerLoader } from "../shared/agri-singleton-layer-loader";

/** Logger disabled — keep call sites without console noise. */
export function agriReserveLandLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export function getAgriReserveLandUrl(): string {
  return getAgriServiceUrls().reserveLandUrl;
}

export interface AgriReserveLandLayerHandle {
  layer: any;
  fields: string[];
}

const getAgriReserveLandLayerCached = createSingletonLayerLoader(
  getAgriReserveLandUrl,
  agriReserveLandLog,
);

/**
 * Loads (once) the Agri_reserve_land FeatureLayer by URL. Cached as a
 * singleton promise so every widget shares the same loaded layer instance.
 */
export async function getAgriReserveLandLayer(): Promise<AgriReserveLandLayerHandle> {
  return getAgriReserveLandLayerCached();
}

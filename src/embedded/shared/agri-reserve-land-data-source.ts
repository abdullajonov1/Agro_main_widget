/**
 * Shared access to the Agri_reserve_land FeatureLayer (reserve-land polygons).
 *
 * Separate ArcGIS Server service from Agri_table_data — same field-naming
 * convention for the geo/year scope (viloyat, tuman, yil, region, district,
 * uniqueid), so it can be filtered the same way, but it is its own service
 * and must be loaded independently.
 */
import { loadArcGISJSAPIModules } from "jimu-arcgis";

/** Logger disabled — keep call sites without console noise. */
export function agriReserveLandLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export const AGRI_RESERVE_LAND_URL =
  "https://sgm.uzspace.uz/server/rest/services/Agriculture/Agri_reserve_land/FeatureServer/1";

export interface AgriReserveLandLayerHandle {
  layer: any;
  fields: string[];
}

let agriReserveLandLayerPromise: Promise<AgriReserveLandLayerHandle> | null =
  null;

/**
 * Loads (once) the Agri_reserve_land FeatureLayer by URL. Cached as a
 * singleton promise so every widget shares the same loaded layer instance.
 */
export async function getAgriReserveLandLayer(): Promise<AgriReserveLandLayerHandle> {
  if (!agriReserveLandLayerPromise) {
    agriReserveLandLog("load:start", { url: AGRI_RESERVE_LAND_URL });
    agriReserveLandLayerPromise = (async () => {
      const [FeatureLayer] = await loadArcGISJSAPIModules([
        "esri/layers/FeatureLayer",
      ]);
      const layer = new FeatureLayer({ url: AGRI_RESERVE_LAND_URL });
      await layer.load();
      const fields: string[] = (layer.fields || []).map((f: any) => f.name);
      agriReserveLandLog("load:success", {
        url: AGRI_RESERVE_LAND_URL,
        title: (layer as any)?.title,
        fieldCount: fields.length,
        fields,
      });
      return { layer, fields };
    })().catch((err) => {
      agriReserveLandLayerPromise = null;
      agriReserveLandLog("load:FAILED", {
        url: AGRI_RESERVE_LAND_URL,
        error: String(err?.message || err),
        status: err?.details?.httpStatus ?? err?.httpStatus ?? null,
      });
      throw err;
    });
  }
  return agriReserveLandLayerPromise;
}

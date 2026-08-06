/**
 * Shared access to the Agri_unused_land FeatureLayer (unused-land polygons).
 *
 * Separate ArcGIS Server service from Agri_table_data — same field-naming
 * convention for the geo/year scope (viloyat, tuman, yil, region, district,
 * uniqueid), so it can be filtered the same way, but it is its own service
 * and must be loaded independently.
 */
import { loadArcGISJSAPIModules } from "jimu-arcgis";

/** Logger disabled — keep call sites without console noise. */
export function agriUnusedLandLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export const AGRI_UNUSED_LAND_URL =
  "https://sgm.uzspace.uz/server/rest/services/Agriculture/Agri_unused_land/FeatureServer/2";

export interface AgriUnusedLandLayerHandle {
  layer: any;
  fields: string[];
}

let agriUnusedLandLayerPromise: Promise<AgriUnusedLandLayerHandle> | null =
  null;

/**
 * Loads (once) the Agri_unused_land FeatureLayer by URL. Cached as a
 * singleton promise so every widget shares the same loaded layer instance.
 */
export async function getAgriUnusedLandLayer(): Promise<AgriUnusedLandLayerHandle> {
  if (!agriUnusedLandLayerPromise) {
    agriUnusedLandLog("load:start", { url: AGRI_UNUSED_LAND_URL });
    agriUnusedLandLayerPromise = (async () => {
      const [FeatureLayer] = await loadArcGISJSAPIModules([
        "esri/layers/FeatureLayer",
      ]);
      const layer = new FeatureLayer({ url: AGRI_UNUSED_LAND_URL });
      await layer.load();
      const fields: string[] = (layer.fields || []).map((f: any) => f.name);
      agriUnusedLandLog("load:success", {
        url: AGRI_UNUSED_LAND_URL,
        title: (layer as any)?.title,
        fieldCount: fields.length,
        fields,
      });
      return { layer, fields };
    })().catch((err) => {
      agriUnusedLandLayerPromise = null;
      agriUnusedLandLog("load:FAILED", {
        url: AGRI_UNUSED_LAND_URL,
        error: String(err?.message || err),
        status: err?.details?.httpStatus ?? err?.httpStatus ?? null,
      });
      throw err;
    });
  }
  return agriUnusedLandLayerPromise;
}

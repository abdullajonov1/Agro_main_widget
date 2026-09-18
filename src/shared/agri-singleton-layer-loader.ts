import { loadArcGISJSAPIModules } from "jimu-arcgis";

export interface AgriSingletonLayerHandle {
  layer: any;
  fields: string[];
}

type LayerLogFn = (phase: string, detail?: Record<string, unknown>) => void;

/**
 * Factory for cached singleton FeatureLayer/Table loaders used across
 * agri-table / vegetation / reserve / unused data sources.
 */
export function createSingletonLayerLoader(
  getUrl: () => string,
  logFn: LayerLogFn,
): () => Promise<AgriSingletonLayerHandle> {
  let layerPromise: Promise<AgriSingletonLayerHandle> | null = null;

  return async (): Promise<AgriSingletonLayerHandle> => {
    if (!layerPromise) {
      const url = getUrl();
      logFn("load:start", { url });
      layerPromise = (async () => {
        const [FeatureLayer] = await loadArcGISJSAPIModules([
          "esri/layers/FeatureLayer",
        ]);
        const layer = new FeatureLayer({ url });
        await layer.load();
        const fields: string[] = (layer.fields || []).map((f: any) => f.name);
        logFn("load:success", {
          url,
          title: (layer as any)?.title,
          fieldCount: fields.length,
          fields,
        });
        return { layer, fields };
      })().catch((err) => {
        layerPromise = null;
        logFn("load:FAILED", {
          url,
          error: String(err?.message || err),
          status: err?.details?.httpStatus ?? err?.httpStatus ?? null,
        });
        throw err;
      });
    }
    return layerPromise;
  };
}

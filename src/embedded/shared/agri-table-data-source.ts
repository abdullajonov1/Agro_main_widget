/**
 * Shared access to the external Agri_table_data Table.
 *
 * This table is NOT an operational layer inside any web map — it is a
 * standalone ArcGIS Server Table (Geometry Type: N/A) — so it cannot be
 * resolved via JimuMapView or a builder-assigned Data Source. Every embedded
 * AgriDashboard widget loads this same singleton layer directly by URL and
 * queries it for its own fields (viloyat, tuman, maydon, turi, yil, f_name,
 * f_inn, f_cad, region, district, yld, crop_id, year1, year2, year3).
 */
import { loadArcGISJSAPIModules } from "jimu-arcgis";

/** Logger disabled — keep call sites without console noise. */
export function agriTableLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export const AGRI_TABLE_DATA_URL =
  "https://sgm.uzspace.uz/server/rest/services/Agriculture/Agri_table_data/FeatureServer/2";

/** Join key linking a clicked polygon feature (spatial layer) to its Agri_table_data record. */
export const AGRI_TABLE_JOIN_FIELD = "uniqueid";

export interface AgriTableLayerHandle {
  layer: any;
  fields: string[];
}

let agriTableLayerPromise: Promise<AgriTableLayerHandle> | null = null;

/**
 * Loads (once) the external Agri_table_data Table by URL. Cached as a
 * singleton promise so every widget shares the same loaded layer instance.
 */
export async function getAgriTableDataLayer(): Promise<AgriTableLayerHandle> {
  if (!agriTableLayerPromise) {
    agriTableLog("load:start", { url: AGRI_TABLE_DATA_URL });
    agriTableLayerPromise = (async () => {
      const [FeatureLayer] = await loadArcGISJSAPIModules([
        "esri/layers/FeatureLayer",
      ]);
      const layer = new FeatureLayer({ url: AGRI_TABLE_DATA_URL });
      await layer.load();
      const fields: string[] = (layer.fields || []).map((f: any) => f.name);
      agriTableLog("load:success", {
        url: AGRI_TABLE_DATA_URL,
        title: (layer as any)?.title,
        fieldCount: fields.length,
        fields,
      });
      return { layer, fields };
    })().catch((err) => {
      agriTableLayerPromise = null;
      agriTableLog("load:FAILED", {
        url: AGRI_TABLE_DATA_URL,
        error: String(err?.message || err),
        status: err?.details?.httpStatus ?? err?.httpStatus ?? null,
      });
      throw err;
    });
  }
  return agriTableLayerPromise;
}

export function escapeAgriValue(value: string): string {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * Looks up a single Agri_table_data record by its uniqueid — the join key
 * used by AgriPopup after resolving the clicked polygon on the spatial layer.
 */
export async function queryAgriRecordByUniqueId(
  uniqueId: string,
): Promise<Record<string, any> | null> {
  const raw = String(uniqueId ?? "").trim();
  if (!raw) return null;

  const { layer } = await getAgriTableDataLayer();
  const query = layer.createQuery();
  query.where = `${AGRI_TABLE_JOIN_FIELD}='${escapeAgriValue(raw)}'`;
  query.outFields = ["*"];
  query.returnGeometry = false;
  query.num = 1;

  const result = await layer.queryFeatures(query);
  const feature = result?.features?.[0];
  return feature?.attributes ?? null;
}

const AGRI_QUERY_PAGE_SIZE = 2000;
const AGRI_QUERY_MAX_PAGES = 200;

/**
 * Temporary kill switch: this pagination was firing large/duplicate request
 * bursts (both AgriGraff10 and AgriLocalization call it independently on the
 * same filter change, with no cross-widget cache) and lagging the page.
 * Flip back to true once that's sorted out.
 *
 * Throws (rather than returning []) while disabled: every call site wraps
 * this in a "best-effort" try/catch that leaves definitionExpression
 * untouched on failure. Returning [] would instead resolve to a real
 * "uniqueid IN ()" -> "1=0" (hide everything) result, which silently
 * overwrites whatever syncRegionYearLayerVisibility() just set on the same
 * sublayers — the exact "shows the layer then immediately hides it again"
 * race between AgriLocalization and AgriGraff10.
 */
const AGRI_UNIQUEID_QUERY_ENABLED = false;

/**
 * Queries Agri_table_data for the distinct uniqueid values matching a WHERE
 * clause (paginated — the service's MaxRecordCount is 2000). Used to mirror
 * the dashboard's filters onto the spatial polygon layer(s) rendered on the
 * map, since Agri_table_data itself has no geometry to filter directly.
 */
export async function queryAgriUniqueIdsForWhere(
  where: string,
): Promise<string[]> {
  if (!AGRI_UNIQUEID_QUERY_ENABLED) {
    throw new Error(
      "queryAgriUniqueIdsForWhere is temporarily disabled (AGRI_UNIQUEID_QUERY_ENABLED=false)",
    );
  }

  const clean = String(where ?? "").trim();
  if (!clean || clean === "1=0") return [];

  const { layer } = await getAgriTableDataLayer();
  const ids = new Set<string>();
  let offset = 0;

  for (let page = 0; page < AGRI_QUERY_MAX_PAGES; page++) {
    const query = layer.createQuery();
    const oidField = layer.objectIdField || "objectid";
    query.where = clean;
    query.outFields = [AGRI_TABLE_JOIN_FIELD, oidField];
    query.returnGeometry = false;
    // DISTINCT uniqueid + ORDER BY objectid is invalid in PostgreSQL
    // (SQLSTATE 42P10). The Set below already removes duplicate uniqueids.
    (query as any).returnDistinctValues = false;
    // Stable ordering is required for resultOffset paging to not skip/repeat rows.
    query.orderByFields = [`${oidField} ASC`];
    (query as any).resultOffset = offset;
    (query as any).resultRecordCount = AGRI_QUERY_PAGE_SIZE;

    const result = await layer.queryFeatures(query);
    const features = result?.features ?? [];
    for (const f of features) {
      const v = f.attributes?.[AGRI_TABLE_JOIN_FIELD];
      if (v != null && v !== "") ids.add(String(v));
    }
    if (features.length < AGRI_QUERY_PAGE_SIZE) break;
    offset += AGRI_QUERY_PAGE_SIZE;
  }

  return Array.from(ids);
}

/**
 * Builds a `uniqueid IN (...)` clause for the spatial companion layer from a
 * set of Agri_table_data uniqueids. Returns "1=0" (match nothing) when empty.
 */
export function buildSpatialJoinWhere(uniqueIds: string[]): string {
  if (!uniqueIds.length) return "1=0";
  const values = uniqueIds
    .map((id) => `'${escapeAgriValue(id)}'`)
    .join(",");
  return `${AGRI_TABLE_JOIN_FIELD} IN (${values})`;
}

export interface AgriRegionDistrictMappingRow {
  viloyat: string;
  region: number;
  tuman: string;
  district: number;
}

export interface AgriTuriCropMappingRow {
  turi: string;
  cropId: string;
}

let agriRegionDistrictMappingsPromise: Promise<
  AgriRegionDistrictMappingRow[]
> | null = null;
let agriTuriCropMappingsPromise: Promise<AgriTuriCropMappingRow[]> | null =
  null;

/**
 * Distinct viloyat/region/tuman/district combinations from the full
 * Agri_table_data table — one grouped query instead of sampling the first
 * 50k rows from a widget-local layer (which may only cover a few viloyats).
 * Cached so Localization + Graff share one network round-trip.
 */
export async function queryAgriRegionDistrictMappings(): Promise<
  AgriRegionDistrictMappingRow[]
> {
  if (!agriRegionDistrictMappingsPromise) {
    agriRegionDistrictMappingsPromise = (async () => {
      const { layer } = await getAgriTableDataLayer();
      const query = layer.createQuery();
      query.where = "1=1";
      query.groupByFieldsForStatistics = [
        "viloyat",
        "region",
        "tuman",
        "district",
      ];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: layer.objectIdField || "objectid",
          outStatisticFieldName: "cnt",
        },
      ] as any;
      query.returnGeometry = false;

      const result = await layer.queryFeatures(query);
      const rows: AgriRegionDistrictMappingRow[] = [];
      for (const feature of result?.features ?? []) {
        const attrs = (feature as any)?.attributes || {};
        const viloyat = String(attrs.viloyat ?? "").trim();
        const tuman = String(attrs.tuman ?? "").trim();
        const region = Number(attrs.region);
        const district = Number(attrs.district);
        if (
          !viloyat ||
          !tuman ||
          !Number.isFinite(region) ||
          !Number.isFinite(district)
        ) {
          continue;
        }
        rows.push({ viloyat, region, tuman, district });
      }
      agriTableLog("regionDistrictMappings:success", { rowCount: rows.length });
      return rows;
    })().catch((err) => {
      agriRegionDistrictMappingsPromise = null;
      throw err;
    });
  }
  return agriRegionDistrictMappingsPromise;
}

/** Distinct turi → crop_id pairs from Agri_table_data. Cached singleton. */
export async function queryAgriTuriCropMappings(): Promise<
  AgriTuriCropMappingRow[]
> {
  if (!agriTuriCropMappingsPromise) {
    agriTuriCropMappingsPromise = (async () => {
      const { layer } = await getAgriTableDataLayer();
      const query = layer.createQuery();
      query.where = "1=1";
      query.groupByFieldsForStatistics = ["turi", "crop_id"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: layer.objectIdField || "objectid",
          outStatisticFieldName: "cnt",
        },
      ] as any;
      query.returnGeometry = false;

      const result = await layer.queryFeatures(query);
      const rows: AgriTuriCropMappingRow[] = [];
      for (const feature of result?.features ?? []) {
        const attrs = (feature as any)?.attributes || {};
        const turi = String(attrs.turi ?? "").trim();
        const cropId = String(attrs.crop_id ?? "").trim();
        if (!turi || !cropId) continue;
        rows.push({ turi, cropId });
      }
      agriTableLog("turiCropMappings:success", { rowCount: rows.length });
      return rows;
    })().catch((err) => {
      agriTuriCropMappingsPromise = null;
      throw err;
    });
  }
  return agriTuriCropMappingsPromise;
}

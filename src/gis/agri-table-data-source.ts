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
import { escapeAgriValue } from "../data/agri-sql";
import { combineAccessWhere } from "../shared/agri-access-config";
import { getAgriServiceUrls } from "../shared/agri-service-urls";
import { createSingletonLayerLoader } from "../shared/agri-singleton-layer-loader";

export { escapeAgriValue };

/** Logger disabled — keep call sites without console noise. */
export function agriTableLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export function getAgriTableDataUrl(): string {
  return getAgriServiceUrls().tableDataUrl;
}

/** Join key linking a clicked polygon feature (spatial layer) to its Agri_table_data record. */
export const AGRI_TABLE_JOIN_FIELD = "uniqueid";

export interface AgriTableLayerHandle {
  layer: any;
  fields: string[];
}

const getAgriTableDataLayerCached = createSingletonLayerLoader(
  getAgriTableDataUrl,
  agriTableLog,
);

/**
 * Loads (once) the external Agri_table_data Table by URL. Cached as a
 * singleton promise so every widget shares the same loaded layer instance.
 */
export async function getAgriTableDataLayer(): Promise<AgriTableLayerHandle> {
  return getAgriTableDataLayerCached();
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
 * Temporary kill switch for uniqueid→spatial mirroring.
 *
 * History: pagination fired large/duplicate bursts (Graff + Localization).
 * Dedup/cache now exists (`agri-query-gateway`), but re-enabling still needs a
 * measured republic-filter network pass — callers turn an empty id list into
 * `uniqueid IN ()` → `1=0` on companion FeatureLayers.
 *
 * While false: returns [] immediately (no network). Do not flip to true without
 * verifying MapImage-owned layers stay owned by Localization DE sync.
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
    return [];
  }

  return pageAgriUniqueIdsForWhere(where);
}

/**
 * Always-on uniqueid resolve for an exact STIR (`f_inn`) selection.
 * Header search selects one farmer — typically tens of parcels, safe to page.
 */
export async function queryAgriUniqueIdsForFarmerInn(
  inn: string,
  scopeWhere?: string,
): Promise<string[]> {
  const cleanInn = String(inn || "").trim();
  if (!cleanInn) return [];
  const innClause = `UPPER(f_inn)=UPPER('${escapeAgriValue(cleanInn)}')`;
  const scope = String(scopeWhere || "").trim();
  const where =
    scope && scope !== "1=1" && scope !== "1=0"
      ? `(${scope}) AND (${innClause})`
      : innClause;
  return pageAgriUniqueIdsForWhere(where);
}

async function pageAgriUniqueIdsForWhere(where: string): Promise<string[]> {
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

let agriTableUniqueIdSamplesPromise: Promise<string[]> | null = null;

/**
 * A few live uniqueid values from Agri_table_data (cached for the session) —
 * used to detect the id style (braces / letter case) of this deployment.
 */
export async function getAgriTableUniqueIdSamples(): Promise<string[]> {
  if (!agriTableUniqueIdSamplesPromise) {
    agriTableUniqueIdSamplesPromise = (async () => {
      const { layer } = await getAgriTableDataLayer();
      const query = layer.createQuery();
      query.where = `${AGRI_TABLE_JOIN_FIELD} IS NOT NULL`;
      query.outFields = [AGRI_TABLE_JOIN_FIELD];
      query.returnGeometry = false;
      (query as any).num = 5;
      (query as any).resultRecordCount = 5;
      const result = await layer.queryFeatures(query);
      return ((result?.features ?? []) as any[])
        .map((feature) =>
          String(
            feature?.attributes?.[AGRI_TABLE_JOIN_FIELD] ??
              feature?.attributes?.[AGRI_TABLE_JOIN_FIELD.toUpperCase()] ??
              "",
          ).trim(),
        )
        .filter(Boolean);
    })().catch((err) => {
      agriTableUniqueIdSamplesPromise = null;
      throw err;
    });
  }
  return agriTableUniqueIdSamplesPromise;
}

export interface AgriTableUniqueIdStyle {
  braced: boolean;
  letterCase: "upper" | "lower" | "mixed";
}

export async function getAgriTableUniqueIdStyle(): Promise<AgriTableUniqueIdStyle | null> {
  try {
    const samples = await getAgriTableUniqueIdSamples();
    if (!samples.length) return null;
    const braced = samples.every(
      (sample) => sample.startsWith("{") && sample.endsWith("}"),
    );
    const letters = samples.join("").replace(/[^a-zA-Z]/g, "");
    const letterCase: AgriTableUniqueIdStyle["letterCase"] = !letters
      ? "mixed"
      : letters === letters.toUpperCase()
        ? "upper"
        : letters === letters.toLowerCase()
          ? "lower"
          : "mixed";
    return { braced, letterCase };
  } catch {
    return null;
  }
}

/**
 * The backing database (PostgreSQL) compares strings case-sensitively, and
 * uniqueid styles differ between services: agri_vegetation_indices stores
 * lower-case unbraced GUIDs while Agri_table_data deployments may store
 * braced and/or upper-case ones. Expand every id to the variant(s) the table
 * actually stores so `uniqueid IN (...)` joins do not silently miss rows.
 * When the styles already match this returns the input ids unchanged.
 */
export async function expandUniqueIdsForAgriTable(
  ids: string[],
): Promise<string[]> {
  const style = await getAgriTableUniqueIdStyle().catch(
    (): null => null,
  );
  const out = new Set<string>();
  for (const raw of ids) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    out.add(trimmed);
    const core = trimmed.replace(/[{}]/g, "");
    if (!style) {
      // Style unknown — cover the common GUID spellings.
      out.add(core);
      out.add(core.toUpperCase());
      out.add(`{${core.toUpperCase()}}`);
      continue;
    }
    let adapted = core;
    if (style.letterCase === "upper") adapted = adapted.toUpperCase();
    else if (style.letterCase === "lower") adapted = adapted.toLowerCase();
    if (style.braced) adapted = `{${adapted}}`;
    out.add(adapted);
  }
  return Array.from(out);
}

/**
 * Builds a `uniqueid IN (...)` clause for the spatial companion layer from a
 * set of Agri_table_data uniqueids. Returns "1=0" (match nothing) when empty.
 * Expands brace / bare variants so vegetation (often unbraced) still matches
 * Agri_table `{GUID}` rows.
 */
export function buildSpatialJoinWhere(uniqueIds: string[]): string {
  if (!uniqueIds.length) return "1=0";
  const expanded = new Set<string>();
  for (const raw of uniqueIds) {
    const id = String(raw || "").trim();
    if (!id) continue;
    const core = id.replace(/[{}]/g, "");
    if (!core) continue;
    expanded.add(id);
    expanded.add(core);
    expanded.add(`{${core}}`);
  }
  if (!expanded.size) return "1=0";
  const values = Array.from(expanded)
    .map((id) => `'${escapeAgriValue(id)}'`)
    .join(",");
  return `${AGRI_TABLE_JOIN_FIELD} IN (${values})`;
}

export interface AgriRegionDistrictMappingRow {
  viloyat: string;
  region: number;
  tuman: string;
  district: number;
  /** Row count for this combination — used for majority-vote when codes conflict. */
  count: number;
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
      // Agri_table has viloyat/region — same fields access rules use.
      query.where = combineAccessWhere("1=1");
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
        const count = Number(attrs.cnt);
        if (
          !viloyat ||
          !tuman ||
          !Number.isFinite(region) ||
          !Number.isFinite(district)
        ) {
          continue;
        }
        rows.push({
          viloyat,
          region,
          tuman,
          district,
          count: Number.isFinite(count) && count > 0 ? count : 1,
        });
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
      query.where = combineAccessWhere("1=1");
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

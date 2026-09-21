/**
 * Shared access to the external agri_vegetation_indices Table (NDVI/SAVI/
 * EVI/RVI/CI vegetation index readings per polygon per raster_date).
 *
 * This replaces the previous apisoil.sgm.uzspace.uz REST API dependency
 * used by AgriGraff10's graph view: same underlying data, served directly
 * from ArcGIS Server (same portal/token as every other AgriDashboard data
 * source), so the chart no longer depends on a separate external
 * microservice being reachable.
 */
import { getAgriServiceUrls } from "../shared/agri-service-urls";
import { createSingletonLayerLoader } from "../shared/agri-singleton-layer-loader";
import { dedupedQueryFeatures } from "../data/agri-query-gateway";
import { rememberAsync } from "../data/agri-persistent-cache";
import { escapeArcGIS, dateEqualsClause } from "../data/agri-sql";
import { combineAccessWhereIfFieldsExist } from "../shared/agri-access-config";
import { buildSpatialJoinWhere } from "./agri-table-data-source";
import { loadArcGISJSAPIModules } from "jimu-arcgis";

export { dateEqualsClause } from "../data/agri-sql";

/** Fields present on agri_vegetation_indices — access rules using only these apply. */
const VEG_LAYER_ACCESS_FIELDS = [
  "region",
  "district",
  "crop_id",
  "turi",
  "raster_date",
  "ndvi_status",
  "uniqueid",
  "yil",
  "year",
  "px_all",
] as const;

/**
 * Attach client access WHERE when it only references vegetation-schema fields
 * (e.g. `region=1724`). Rules on `viloyat` are skipped here — that field is
 * absent on this table; Localization UI lock (lockedViloyat) scopes those users.
 */
function withVegAccessWhere(mainWhere: string): string {
  return combineAccessWhereIfFieldsExist(mainWhere, VEG_LAYER_ACCESS_FIELDS);
}

/** agri_vegetation_indices px_all comes from a 3m x 3m raster: 9 m² / 10,000. */
const VEG_PIXEL_AREA_HA = 0.0009;

/** VH / crop-window diagnostics — visible in browser console. */
export function agriVhLog(
  phase: string,
  detail?: Record<string, unknown>,
): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[AgriVH] ${phase}`, detail ?? "");
  } catch {
    /* ignore */
  }
}

/** Optional diagnostic hook; intentionally quiet in the published dashboard. */
export function agriVegetationLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

/** Notification feed diagnostics — summary only (avoid page spam). */
function agriNotifyLog(
  phase: string,
  detail?: Record<string, unknown>,
): void {
  try {
    if (
      phase === "query:start" ||
      phase === "query:done" ||
      phase === "dates:window" ||
      phase === "count:day-done" ||
      phase.endsWith(":error") ||
      phase.endsWith("-failed")
    ) {
      // eslint-disable-next-line no-console
      console.log(`[AgriNotify] ${phase}`, detail ?? "");
    }
  } catch {
    /* ignore */
  }
}

export function getAgriVegetationIndicesUrl(): string {
  return getAgriServiceUrls().vegetationIndicesUrl;
}

export interface AgriVegetationLayerHandle {
  layer: any;
  fields: string[];
}

const getAgriVegetationIndicesLayerCached = createSingletonLayerLoader(
  getAgriVegetationIndicesUrl,
  agriVegetationLog,
);

/**
 * Loads (once) the external agri_vegetation_indices Table by URL. Cached as
 * a singleton promise so every widget shares the same loaded layer instance
 * — mirrors getAgriTableDataLayer() in agri-table-data-source.ts.
 */
export async function getAgriVegetationIndicesLayer(): Promise<AgriVegetationLayerHandle> {
  return getAgriVegetationIndicesLayerCached();
}

async function queryVegFeatures(
  layer: any,
  query: any,
): Promise<__esri.FeatureSet> {
  const outFields = query.outFields;
  // Single choke point for access — do not also wrap at every WHERE builder.
  const where = withVegAccessWhere(String(query.where || "1=1"));
  return dedupedQueryFeatures(layer, {
    where,
    outFields: Array.isArray(outFields)
      ? outFields
      : outFields
        ? [String(outFields)]
        : undefined,
    groupByFieldsForStatistics: query.groupByFieldsForStatistics,
    outStatistics: query.outStatistics,
    orderByFields: query.orderByFields,
    returnGeometry: query.returnGeometry ?? false,
    returnDistinctValues: query.returnDistinctValues,
    num: query.num,
    resultRecordCount: query.resultRecordCount,
    resultOffset: query.resultOffset,
  });
}

/** In-flight / session cache so AgriPopup + AgriGraff share one FeatureServer hit. */
const vegetationSeriesByUniqueIdCache = new Map<
  string,
  Promise<Array<Record<string, any>>>
>();

/**
 * One polygon's full vegetation index time series, ordered by date —
 * mirrors the shape previously returned by GET /api/v1/vegetation/uniqueid/{id}.
 */
export async function queryVegetationSeriesForUniqueId(
  uniqueId: string,
): Promise<Array<Record<string, any>>> {
  const raw = String(uniqueId ?? "").trim();
  if (!raw) return [];

  const clean = raw.replace(/[{}]/g, "");
  const cacheKey = clean || raw;
  const cached = vegetationSeriesByUniqueIdCache.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    const variants = Array.from(
      new Set(
        [raw, clean, clean ? `{${clean}}` : ""]
          .map((v) => String(v || "").trim())
          .filter(Boolean),
      ),
    );

    const { layer } = await getAgriVegetationIndicesLayer();
    // One query with OR — avoids sequential empty round-trips on brace mismatch.
    const query = layer.createQuery();
    query.where = variants
      .map((candidate) => `uniqueid='${escapeArcGIS(candidate)}'`)
      .join(" OR ");
    query.outFields = ["*"];
    query.returnGeometry = false;
    query.orderByFields = ["raster_date ASC"];
    query.num = 2000;

    const result = await queryVegFeatures(layer, query);
    return (result?.features ?? []).map((f: any) => ({
      ...(f.attributes || {}),
    }));
  })();

  vegetationSeriesByUniqueIdCache.set(cacheKey, request);
  while (vegetationSeriesByUniqueIdCache.size > 64) {
    const oldestKey = vegetationSeriesByUniqueIdCache.keys().next().value;
    if (!oldestKey) break;
    vegetationSeriesByUniqueIdCache.delete(oldestKey);
  }
  try {
    return await request;
  } catch (err) {
    vegetationSeriesByUniqueIdCache.delete(cacheKey);
    throw err;
  }
}

const VEG_AVG_FIELDS = [
  "ndvi",
  "ndvi_min",
  "ndvi_max",
  "savi",
  "savi_min",
  "savi_max",
  "evi",
  "rvi",
  "rvi_min",
  "rvi_max",
  "ci",
  "ci_min",
  "ci_max",
  "ndwi",
  "ndwi_min",
  "ndwi_max",
];

/** Lighter republic overview: means only (no min/max bands) — ~6 avgs vs 16. */
export const VEG_AVG_FIELDS_CORE = [
  "ndvi",
  "savi",
  "evi",
  "rvi",
  "ci",
  "ndwi",
];

export interface VegetationRegionalTimeseriesParams {
  region?: number;
  district?: number;
  /** yyyy-mm-dd */
  startDate?: string;
  /** yyyy-mm-dd */
  endDate?: string;
  /**
   * Crop type filter. agri_vegetation_indices has no human-readable crop
   * name field, only crop_id — callers must resolve the selected turi name
   * to its crop_id first (e.g. via a turi -> crop_id lookup built from
   * Agri_table_data, which carries both).
  */
  cropId?: string;
  /** Multiple selected crops; queried together so one uniqueid is still counted once. */
  cropIds?: string[];
  /** Optional vegetation status selected in the VH widget. */
  ndviStatus?: string;
  /**
   * Subset of VEG_AVG_FIELDS to average.
   * - No region (republic / cold start): pass `["ndvi"]` (or other selected
   *   columns) — do not AVG SAVI/EVI/… until a viloyat/tuman is chosen or
   *   the user toggles more legend indices.
   * - Viloyat/tuman: omit this to load the full min/max band set once.
   */
  avgFields?: string[];
}

const vegetationRegionalTimeseriesCache = new Map<
  string,
  Promise<Array<Record<string, any>>>
>();

/**
 * Regional (aggregate) vegetation index time series — mean of every index
 * per raster_date, across every polygon matching region/district/date
 * range. Mirrors the shape previously returned by
 * GET /api/v1/vegetation/regional/timeseries: rows keyed by `date` plus the
 * bare index names (ndvi, savi, ...) and `polygon_count`.
 *
 * Requires a date window — never runs as `1=1` over the full history table.
 */
export async function queryVegetationRegionalTimeseries(
  params: VegetationRegionalTimeseriesParams,
): Promise<Array<Record<string, any>>> {
  if (!params.startDate || !params.endDate) {
    agriVegetationLog("regionalTimeseries:SKIP-no-date-window", {
      region: params.region ?? null,
      district: params.district ?? null,
    });
    return [];
  }

  const avgFields = (
    params.avgFields?.length ? params.avgFields : VEG_AVG_FIELDS
  ).filter((field) => VEG_AVG_FIELDS.includes(field));
  const fieldsForStats = avgFields.length ? avgFields : VEG_AVG_FIELDS;

  const clauses: string[] = [];
  if (params.region != null) {
    clauses.push(`region='${escapeArcGIS(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeArcGIS(String(params.district))}'`);
  }
  if (params.ndviStatus) {
    clauses.push(
      `ndvi_status='${escapeArcGIS(String(params.ndviStatus))}'`,
    );
  }
  clauses.push(
    `raster_date >= DATE '${params.startDate}' AND raster_date <= DATE '${params.endDate}'`,
  );
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    clauses.push(`crop_id='${escapeArcGIS(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    clauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeArcGIS(value)}'`)
        .join(",")})`,
    );
  }
  const where = clauses.join(" AND ");
  const cacheKey = `${where}|avg=${fieldsForStats.join(",")}`;
  return rememberAsync({
    memory: vegetationRegionalTimeseriesCache,
    namespace: "veg-regional",
    key: cacheKey,
    factory: async () => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const query = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = ["raster_date"];
      query.orderByFields = ["raster_date ASC"];
      query.outStatistics = [
        ...fieldsForStats.map((field) => ({
          statisticType: "avg",
          onStatisticField: field,
          outStatisticFieldName: `avg_${field}`,
        })),
        {
          statisticType: "count",
          onStatisticField: "objectid",
          outStatisticFieldName: "polygon_count",
        },
      ] as any;
      query.returnGeometry = false;

      const result = await queryVegFeatures(layer, query);
      const rows = (result?.features ?? []).map((feature: any) =>
        feature.attributes || {},
      );
      return rows.map((row: any) => {
        const normalized: Record<string, any> = {
          date: row.raster_date,
          polygon_count: row.polygon_count ?? 0,
        };
        for (const field of VEG_AVG_FIELDS) {
          const avgKey = `avg_${field}`;
          if (Object.prototype.hasOwnProperty.call(row, avgKey)) {
            normalized[field] = row[avgKey];
          } else if (field.endsWith("_min") || field.endsWith("_max")) {
            // Core-field queries omit min/max — collapse band to the mean.
            const base = field.replace(/_(min|max)$/, "");
            normalized[field] = row[`avg_${base}`] ?? null;
          } else {
            normalized[field] = null;
          }
        }
        return normalized;
      });
    },
  });
}

/** Normalizes an ArcGIS date attribute (epoch ms, Date, or string) to "YYYY-MM-DD". */
export function formatArcgisDateToYmd(value: any): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Whole-day equality clause for a Date field — safer than `field = DATE
 * 'YYYY-MM-DD'`, which can miss rows if the stored value carries a
 * non-midnight time component.
 * @deprecated import from `data/agri-sql` — re-exported for existing callers.
 */
// dateEqualsClause: see re-export from agri-sql above.

/** Inclusive raster_date window: startYmd .. endYmd (both calendar days). */
export function dateRangeInclusiveClause(
  dateField: string,
  startYmd: string,
  endYmd: string,
): string {
  const start = String(startYmd || "").trim();
  const end = String(endYmd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return "1=0";
  }
  if (start > end) return "1=0";
  const endParts = end.split("-").map((p) => parseInt(p, 10));
  const next = new Date(
    Date.UTC(endParts[0], endParts[1] - 1, endParts[2] + 1),
  );
  const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return `${dateField} >= DATE '${start}' AND ${dateField} < DATE '${nextYmd}'`;
}

export interface VegetationScopeParams {
  region?: number;
  district?: number;
}

/**
 * Distinct raster_date values (as "YYYY-MM-DD", ascending) available for a
 * region/district — drives the NDVI date picker. Replaces the old
 * "scan the polygon layer for status_YYYY_MM_DD columns" approach, which
 * only worked against a layer that actually had those wide columns
 * (Agri_table_data doesn't).
 */
const vegetationAvailableDatesCache = new Map<string, Promise<string[]>>();

export async function queryVegetationAvailableDates(
  params: VegetationScopeParams = {},
): Promise<string[]> {
  const cacheKey = `r=${params.region ?? ""}|d=${params.district ?? ""}`;
  const promise = rememberAsync({
    memory: vegetationAvailableDatesCache,
    namespace: "veg-dates",
    key: cacheKey,
    factory: async (): Promise<string[]> => {
      const { layer } = await getAgriVegetationIndicesLayer();

      const clauses: string[] = [];
      if (params.region != null) {
        clauses.push(`region='${escapeArcGIS(String(params.region))}'`);
      }
      if (params.district != null) {
        clauses.push(`district='${escapeArcGIS(String(params.district))}'`);
      }
      const where = clauses.length ? clauses.join(" AND ") : "1=1";

      const query = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = ["raster_date"];
      query.orderByFields = ["raster_date ASC"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: "objectid",
          outStatisticFieldName: "cnt",
        },
      ] as any;
      query.returnGeometry = false;

      const result = await queryVegFeatures(layer, query);
      const dateSet = new Set<string>();
      for (const feature of result?.features ?? []) {
        const ymd = formatArcgisDateToYmd(
          (feature as any)?.attributes?.raster_date,
        );
        if (ymd) dateSet.add(ymd);
      }
      return Array.from(dateSet).sort();
    },
  });
  while (vegetationAvailableDatesCache.size > 32) {
    const oldestKey = vegetationAvailableDatesCache.keys().next().value;
    if (!oldestKey) break;
    vegetationAvailableDatesCache.delete(oldestKey);
  }
  return promise;
}

export interface VegetationLatestDateByRegion {
  region: number;
  /** Latest "YYYY-MM-DD" that has vegetation rows for this region. */
  date: string;
}

const vegetationLatestDatesByRegionCache = new Map<
  string,
  Promise<VegetationLatestDateByRegion[]>
>();

/**
 * Latest available vegetation date for every region that has data.
 * Republic-wide VH uses this instead of one global latest date: satellite
 * coverage dates differ by region, so a global latest date can contain only
 * one region and undercount the rest of Uzbekistan.
 */
export async function queryVegetationLatestDatesByRegion(
  params: { year?: string } = {},
): Promise<VegetationLatestDateByRegion[]> {
  const year = String(params.year || "").match(/\b(18|19|20)\d{2}\b/)?.[0];
  // v2: MAX(raster_date) per region (1 row/viloyat). Old groupBy(region,date)
  // + num cap silently dropped newest days and undercounted republic VH.
  const cacheKey = `v2-max|${year || "*"}`;

  const promise = rememberAsync({
    memory: vegetationLatestDatesByRegionCache,
    namespace: "veg-latest-by-region",
    key: cacheKey,
    factory: async (): Promise<VegetationLatestDateByRegion[]> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const clauses: string[] = [
        "region IS NOT NULL",
        "raster_date IS NOT NULL",
      ];
      if (year) {
        const nextYear = String(Number(year) + 1);
        clauses.push(
          `raster_date >= DATE '${year}-01-01' AND raster_date < DATE '${nextYear}-01-01'`,
        );
      }

      const query = layer.createQuery();
      query.where = clauses.join(" AND ");
      query.groupByFieldsForStatistics = ["region"];
      query.orderByFields = ["region ASC"];
      query.outStatistics = [
        {
          statisticType: "max",
          onStatisticField: "raster_date",
          outStatisticFieldName: "max_raster_date",
        },
      ] as any;
      query.returnGeometry = false;
      query.num = 100;

      const result = await queryVegFeatures(layer, query);
      const latestDates: VegetationLatestDateByRegion[] = [];
      for (const feature of result?.features ?? []) {
        const attributes = (feature as any)?.attributes || {};
        const region = Number(attributes.region);
        const date = formatArcgisDateToYmd(
          attributes.max_raster_date ?? attributes.raster_date,
        );
        if (!Number.isFinite(region) || !date) continue;
        latestDates.push({ region, date });
      }
      latestDates.sort((a, b) => a.region - b.region);

      agriVhLog("latest-dates-by-region", {
        year: year || null,
        regionCount: latestDates.length,
        latestDates,
        algo: "max-raster-date-per-region",
      });
      return latestDates;
    },
  });
  while (vegetationLatestDatesByRegionCache.size > 4) {
    const oldestKey = vegetationLatestDatesByRegionCache.keys().next().value;
    if (!oldestKey) break;
    vegetationLatestDatesByRegionCache.delete(oldestKey);
  }
  return promise;
}

function buildVegetationScopeClauses(params: {
  region?: number;
  district?: number;
  year?: string;
  cropId?: string;
  cropIds?: string[];
  startDate?: string;
  endDate?: string;
  /** Single-day equality when set (overrides start/end). */
  date?: string;
}): string[] {
  const clauses: string[] = [];
  if (params.region != null && Number.isFinite(params.region)) {
    clauses.push(`region='${escapeArcGIS(String(params.region))}'`);
  }
  if (params.district != null && Number.isFinite(params.district)) {
    clauses.push(`district='${escapeArcGIS(String(params.district))}'`);
  }
  const year = String(params.year || "").match(/\b(18|19|20)\d{2}\b/)?.[0];
  if (year) {
    const nextYear = String(Number(year) + 1);
    clauses.push(
      `raster_date >= DATE '${year}-01-01' AND raster_date < DATE '${nextYear}-01-01'`,
    );
  }
  if (params.date) {
    clauses.push(dateEqualsClause("raster_date", params.date));
  } else if (params.startDate && params.endDate) {
    clauses.push(
      dateRangeInclusiveClause(
        "raster_date",
        params.startDate,
        params.endDate,
      ),
    );
  }
  const cropFilter = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  );
  if (cropFilter.length === 1) {
    clauses.push(`crop_id='${escapeArcGIS(cropFilter[0])}'`);
  } else if (cropFilter.length > 1) {
    clauses.push(
      `crop_id IN (${cropFilter.map((v) => `'${escapeArcGIS(v)}'`).join(",")})`,
    );
  }
  return clauses;
}

const vegetationDistinctCropIdsCache = new Map<string, Promise<string[]>>();
const vegetationMaxRasterDateCache = new Map<string, Promise<string | null>>();

export interface VegetationAvgNdviUniqueRow {
  uniqueid: string;
  avgNdvi: number;
  maxPxAll: number;
  areaHa: number;
}

const vegetationAvgNdviByUniqueIdCache = new Map<
  string,
  Promise<{
    rows: VegetationAvgNdviUniqueRow[];
    truncated: boolean;
    maxRecordCount: number;
    exceededTransferLimit: boolean;
  }>
>();
const vegetationAvgNdviOidCursorCache = new Map<
  string,
  Promise<VegetationAvgNdviUniqueRow[]>
>();

/**
 * Distinct crop_id values in scope (year + optional region/district).
 * When `cropIds` is provided, returns only those that exist in the table.
 */
export async function queryVegetationDistinctCropIds(params: {
  region?: number;
  district?: number;
  year?: string;
  cropIds?: string[];
} = {}): Promise<string[]> {
  const requested = Array.from(
    new Set((params.cropIds || []).map((v) => String(v).trim()).filter(Boolean)),
  );
  const clauses = buildVegetationScopeClauses({
    region: params.region,
    district: params.district,
    year: params.year,
    cropIds: requested.length ? requested : undefined,
  });
  clauses.push("crop_id IS NOT NULL");
  const where = clauses.length ? clauses.join(" AND ") : "crop_id IS NOT NULL";
  const cacheKey = `v9-crop-ids|${where}`;

  return rememberAsync({
    memory: vegetationDistinctCropIdsCache,
    namespace: "veg-crop-ids",
    key: cacheKey,
    factory: async (): Promise<string[]> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const oidField = String(layer.objectIdField || "objectid");
      const query = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = ["crop_id"];
      query.orderByFields = ["crop_id ASC"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: oidField,
          outStatisticFieldName: "cnt",
        },
      ] as any;
      query.returnGeometry = false;
      query.num = 500;
      const result = await queryVegFeatures(layer, query);
      const out: string[] = [];
      for (const feature of result?.features ?? []) {
        const cropId = String(
          (feature as any)?.attributes?.crop_id ?? "",
        ).trim();
        if (cropId) out.push(cropId);
      }
      return out;
    },
  });
}

const vegetationDistinctRegionsCache = new Map<string, Promise<number[]>>();
const vegetationDistinctDistrictsCache = new Map<string, Promise<number[]>>();

/** Distinct region codes with vegetation rows in the selected year. */
export async function queryVegetationDistinctRegions(params: {
  year?: string;
} = {}): Promise<number[]> {
  const year = String(params.year || "").match(/\b(18|19|20)\d{2}\b/)?.[0];
  const cacheKey = year || "*";
  return rememberAsync({
    memory: vegetationDistinctRegionsCache,
    namespace: "veg-regions",
    key: cacheKey,
    factory: async (): Promise<number[]> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const oidField = String(layer.objectIdField || "objectid");
      const clauses = ["region IS NOT NULL"];
      if (year) {
        const nextYear = String(Number(year) + 1);
        clauses.push(
          `raster_date >= DATE '${year}-01-01' AND raster_date < DATE '${nextYear}-01-01'`,
        );
      }
      const query = layer.createQuery();
      query.where = clauses.join(" AND ");
      query.groupByFieldsForStatistics = ["region"];
      query.orderByFields = ["region ASC"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: oidField,
          outStatisticFieldName: "cnt",
        },
      ] as any;
      query.returnGeometry = false;
      query.num = 100;
      const result = await queryVegFeatures(layer, query);
      const out: number[] = [];
      for (const feature of result?.features ?? []) {
        const region = Number((feature as any)?.attributes?.region);
        if (Number.isFinite(region)) out.push(region);
      }
      agriVhLog("distinct-regions", { year: year || null, regions: out });
      return out;
    },
  });
}

/** Distinct district codes for one region (+ optional crop/date window). */
export async function queryVegetationDistinctDistricts(params: {
  region: number;
  year?: string;
  cropId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<number[]> {
  const region = Number(params.region);
  if (!Number.isFinite(region)) return [];
  const clauses = buildVegetationScopeClauses({
    region,
    year: params.year,
    cropId: params.cropId,
    startDate: params.startDate,
    endDate: params.endDate,
  });
  clauses.push("district IS NOT NULL");
  const where = clauses.join(" AND ");
  const cacheKey = `v9-districts|${where}`;
  return rememberAsync({
    memory: vegetationDistinctDistrictsCache,
    namespace: "veg-districts",
    key: cacheKey,
    factory: async (): Promise<number[]> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const oidField = String(layer.objectIdField || "objectid");
      const query = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = ["district"];
      query.orderByFields = ["district ASC"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: oidField,
          outStatisticFieldName: "cnt",
        },
      ] as any;
      query.returnGeometry = false;
      query.num = 200;
      const result = await queryVegFeatures(layer, query);
      const out: number[] = [];
      for (const feature of result?.features ?? []) {
        const district = Number((feature as any)?.attributes?.district);
        if (Number.isFinite(district)) out.push(district);
      }
      return out;
    },
  });
}

/**
 * Latest raster_date (YYYY-MM-DD) for one crop in scope.
 * `endDateCap` clamps the result (ndviDateLocked window end).
 */
export async function queryVegetationMaxRasterDate(params: {
  region?: number;
  district?: number;
  year?: string;
  /** When omitted, max date is for the whole region/district scope. */
  cropId?: string;
  endDateCap?: string;
}): Promise<string | null> {
  const cropId = String(params.cropId || "").trim();
  const cap = String(params.endDateCap || "").trim();
  const clauses = buildVegetationScopeClauses({
    region: params.region,
    district: params.district,
    year: params.year,
    cropId: cropId || undefined,
  });
  if (cap && /^\d{4}-\d{2}-\d{2}$/.test(cap)) {
    const capParts = cap.split("-").map((p) => parseInt(p, 10));
    const next = new Date(
      Date.UTC(capParts[0], capParts[1] - 1, capParts[2] + 1),
    );
    const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    clauses.push(`raster_date < DATE '${nextYmd}'`);
  }
  clauses.push("raster_date IS NOT NULL");
  const where = clauses.length ? clauses.join(" AND ") : "raster_date IS NOT NULL";
  const cacheKey = `v9e-max-date|${where}`;

  return rememberAsync({
    memory: vegetationMaxRasterDateCache,
    namespace: "veg-max-date",
    key: cacheKey,
    factory: async (): Promise<string | null> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const query = layer.createQuery();
      query.where = where;
      query.returnGeometry = false;
      query.outStatistics = [
        {
          statisticType: "max",
          onStatisticField: "raster_date",
          outStatisticFieldName: "max_raster_date",
        },
      ] as any;
      const result = await queryVegFeatures(layer, query);
      const raw =
        (result?.features?.[0] as any)?.attributes?.max_raster_date ??
        (result?.features?.[0] as any)?.attributes?.raster_date;
      return formatArcgisDateToYmd(raw);
    },
  });
}

const vegetationMaxDateByRegionCache = new Map<
  string,
  Promise<Map<number, string>>
>();

/**
 * One round-trip: MAX(raster_date) per region for a year (republic VH prefetch).
 */
export async function queryVegetationMaxRasterDateByRegion(params: {
  year: string;
  endDateCap?: string;
}): Promise<Map<number, string>> {
  const year = String(params.year || "").match(/\b(18|19|20)\d{2}\b/)?.[0];
  if (!year) return new Map();
  const cap = String(params.endDateCap || "").trim();
  const cacheKey = `v9g-max-by-region|${year}|${cap}`;

  return rememberAsync({
    memory: vegetationMaxDateByRegionCache,
    namespace: "veg-max-date-by-region",
    key: cacheKey,
    factory: async (): Promise<Map<number, string>> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const nextYear = String(Number(year) + 1);
      const clauses = [
        "region IS NOT NULL",
        "raster_date IS NOT NULL",
        `raster_date >= DATE '${year}-01-01' AND raster_date < DATE '${nextYear}-01-01'`,
      ];
      if (cap && /^\d{4}-\d{2}-\d{2}$/.test(cap)) {
        const capParts = cap.split("-").map((p) => parseInt(p, 10));
        const next = new Date(
          Date.UTC(capParts[0], capParts[1] - 1, capParts[2] + 1),
        );
        const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
        clauses.push(`raster_date < DATE '${nextYmd}'`);
      }
      const query = layer.createQuery();
      query.where = clauses.join(" AND ");
      query.groupByFieldsForStatistics = ["region"];
      query.orderByFields = ["region ASC"];
      query.outStatistics = [
        {
          statisticType: "max",
          onStatisticField: "raster_date",
          outStatisticFieldName: "max_raster_date",
        },
      ] as any;
      query.returnGeometry = false;
      query.num = 100;
      const result = await queryVegFeatures(layer, query);
      const out = new Map<number, string>();
      for (const feature of result?.features ?? []) {
        const attrs = (feature as any)?.attributes || {};
        const region = Number(attrs.region);
        const ymd = formatArcgisDateToYmd(
          attrs.max_raster_date ?? attrs.raster_date,
        );
        if (!Number.isFinite(region) || !ymd) continue;
        out.set(region, ymd);
      }
      agriVhLog("max-date-by-region", {
        year,
        cap: cap || null,
        regions: Array.from(out.entries()).map(([region, maxDate]) => ({
          region,
          maxDate,
        })),
      });
      return out;
    },
  });
}

/**
 * Per-uniqueid AVG(ndvi) + MAX(px_all) inside an inclusive raster_date window.
 * Pass cropId / cropIds to limit crops; omit both = all crops in the geo scope
 * (one query instead of N per-crop round-trips).
 */
export async function queryVegetationAvgNdviByUniqueId(params: {
  region?: number;
  district?: number;
  cropId?: string;
  cropIds?: string[];
  startDate: string;
  endDate: string;
}): Promise<VegetationAvgNdviUniqueRow[]> {
  const startDate = String(params.startDate || "").trim();
  const endDate = String(params.endDate || "").trim();
  if (!startDate || !endDate) return [];

  const cropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  );

  if (params.region == null || !Number.isFinite(Number(params.region))) {
    agriVhLog("avg-ndvi:REJECT-no-region", {
      cropIds: cropIds.length ? cropIds : null,
      startDate,
      endDate,
      hint: "Use per-region batching for republic VH",
    });
    return [];
  }

  const region = Number(params.region);
  const district =
    params.district != null && Number.isFinite(Number(params.district))
      ? Number(params.district)
      : undefined;

  const once = await queryVegetationAvgNdviByUniqueIdOnce({
    region,
    district,
    cropIds: cropIds.length ? cropIds : undefined,
    startDate,
    endDate,
  });

  if (!once.truncated) return once.rows;

  return queryVegetationAvgNdviByUniqueIdPaged({
    region,
    district,
    cropIds: cropIds.length ? cropIds : undefined,
    startDate,
    endDate,
    seedRows: once.rows,
    pageSize: once.maxRecordCount,
  });
}

/**
 * Continue groupBy stats after the first truncated page.
 * Fan out by uniqueid hex prefix (16 shards in parallel) — sgm ignores
 * resultOffset, so sequential uniqueid > lastId alone is too slow.
 */
async function queryVegetationAvgNdviByUniqueIdPaged(params: {
  region: number;
  district?: number;
  cropIds?: string[];
  startDate: string;
  endDate: string;
  seedRows: VegetationAvgNdviUniqueRow[];
  pageSize: number;
}): Promise<VegetationAvgNdviUniqueRow[]> {
  const clauses = buildVegetationScopeClauses({
    region: params.region,
    district: params.district,
    cropIds: params.cropIds,
    startDate: params.startDate,
    endDate: params.endDate,
  });
  clauses.push("uniqueid IS NOT NULL");
  clauses.push("ndvi IS NOT NULL");
  const baseWhere = clauses.join(" AND ");
  const cacheKey = `v9h-avg-ndvi-paged|${baseWhere}`;

  return rememberAsync({
    memory: vegetationAvgNdviOidCursorCache,
    namespace: "veg-avg-ndvi-paged",
    key: cacheKey,
    // Full uniqueid pages are large — memory-only (avoid truncated localStorage).
    ttlMs: 0,
    factory: async (): Promise<VegetationAvgNdviUniqueRow[]> => {
      const { layer, fields } = await getAgriVegetationIndicesLayer();
      const fieldByLower = new Map(
        (fields || []).map((f) => [String(f).toLowerCase(), String(f)]),
      );
      const uniqueIdField =
        fieldByLower.get("uniqueid") ||
        fieldByLower.get("unique_id") ||
        fieldByLower.get("globalid") ||
        "uniqueid";
      const ndviField = fieldByLower.get("ndvi") || "ndvi";
      const pxField = fieldByLower.get("px_all") || "px_all";
      const pageSize = Math.max(
        500,
        Math.min(10000, params.pageSize > 0 ? params.pageSize : 2000),
      );

      const hexDigits = "0123456789abcdef".split("");
      const shardClauses = hexDigits.map((d) => {
        const u = d.toUpperCase();
        return `(${uniqueIdField} LIKE '{${u}%' OR ${uniqueIdField} LIKE '{${d}%' OR ${uniqueIdField} LIKE '${u}%' OR ${uniqueIdField} LIKE '${d}%')`;
      });
      const otherClause = `NOT (${shardClauses.join(" OR ")})`;
      const allShardWheres = [...shardClauses, otherClause];

      agriVhLog("avg-ndvi:uniqueid-shards", {
        region: params.region,
        district: params.district ?? null,
        cropIds: params.cropIds || null,
        startDate: params.startDate,
        endDate: params.endDate,
        firstPageRows: params.seedRows.length,
        pageSize,
        shardCount: allShardWheres.length,
      });

      const fetchShardPages = async (
        shardWhere: string,
      ): Promise<VegetationAvgNdviUniqueRow[]> => {
        const out: VegetationAvgNdviUniqueRow[] = [];
        let lastId = "";
        let pages = 0;
        const maxPages = 80;
        while (pages < maxPages) {
          pages += 1;
          const where = lastId
            ? `${baseWhere} AND ${shardWhere} AND ${uniqueIdField} > '${escapeArcGIS(lastId)}'`
            : `${baseWhere} AND ${shardWhere}`;
          const query = layer.createQuery();
          query.where = where;
          query.groupByFieldsForStatistics = [uniqueIdField];
          query.orderByFields = [`${uniqueIdField} ASC`];
          query.outStatistics = [
            {
              statisticType: "avg",
              onStatisticField: ndviField,
              outStatisticFieldName: "avg_ndvi",
            },
            {
              statisticType: "max",
              onStatisticField: pxField,
              outStatisticFieldName: "max_px_all",
            },
          ] as any;
          query.returnGeometry = false;
          query.num = pageSize;

          const result = await queryVegFeatures(layer, query);
          const features = result?.features ?? [];
          if (!features.length) break;

          let pageMaxId = lastId;
          for (const feature of features) {
            const attrs = (feature as any)?.attributes || {};
            const uniqueid = String(
              attrs[uniqueIdField] ?? attrs.uniqueid ?? "",
            ).trim();
            const avgNdvi = Number(attrs.avg_ndvi);
            const maxPxAll = Number(attrs.max_px_all) || 0;
            if (!uniqueid || !Number.isFinite(avgNdvi)) continue;
            out.push({
              uniqueid,
              avgNdvi,
              maxPxAll,
              areaHa: maxPxAll * VEG_PIXEL_AREA_HA,
            });
            if (uniqueid > pageMaxId) pageMaxId = uniqueid;
          }

          if (pageMaxId === lastId) break;
          lastId = pageMaxId;
          if (features.length < pageSize) break;
        }
        return out;
      };

      // 4 shards at a time — keep headroom when several viloyats page in parallel.
      const shardRows: VegetationAvgNdviUniqueRow[] = [];
      const shardConcurrency = 4;
      for (let i = 0; i < allShardWheres.length; i += shardConcurrency) {
        const batch = allShardWheres.slice(i, i + shardConcurrency);
        const parts = await Promise.all(batch.map((w) => fetchShardPages(w)));
        for (const part of parts) shardRows.push(...part);
      }

      const byId = new Map<string, VegetationAvgNdviUniqueRow>();
      for (const row of params.seedRows) byId.set(row.uniqueid, row);
      for (const row of shardRows) byId.set(row.uniqueid, row);

      const rows = Array.from(byId.values());
      agriVhLog("avg-ndvi:uniqueid-shards-done", {
        region: params.region,
        district: params.district ?? null,
        cropIds: params.cropIds || null,
        startDate: params.startDate,
        endDate: params.endDate,
        fieldCount: rows.length,
        areaHaSum: Math.round(rows.reduce((s, r) => s + (r.areaHa || 0), 0)),
      });
      return rows;
    },
  });
}

async function queryVegetationAvgNdviByUniqueIdOnce(params: {
  region: number;
  district?: number;
  cropIds?: string[];
  startDate: string;
  endDate: string;
}): Promise<{
  rows: VegetationAvgNdviUniqueRow[];
  truncated: boolean;
  maxRecordCount: number;
  exceededTransferLimit: boolean;
}> {
  const clauses = buildVegetationScopeClauses({
    region: params.region,
    district: params.district,
    cropIds: params.cropIds,
    startDate: params.startDate,
    endDate: params.endDate,
  });
  clauses.push("uniqueid IS NOT NULL");
  clauses.push("ndvi IS NOT NULL");
  const where = clauses.join(" AND ");
  const cacheKey = `v9h-avg-ndvi-stats|${where}`;

  return rememberAsync({
    memory: vegetationAvgNdviByUniqueIdCache,
    namespace: "veg-avg-ndvi",
    key: cacheKey,
    factory: async () => {
      const { layer, fields } = await getAgriVegetationIndicesLayer();
      const fieldByLower = new Map(
        (fields || []).map((f) => [String(f).toLowerCase(), String(f)]),
      );
      const uniqueIdField =
        fieldByLower.get("uniqueid") ||
        fieldByLower.get("unique_id") ||
        fieldByLower.get("globalid") ||
        "uniqueid";
      const ndviField = fieldByLower.get("ndvi") || "ndvi";
      const pxField = fieldByLower.get("px_all") || "px_all";
      const maxRecordCount = Math.max(
        500,
        Math.min(
          100000,
          Number(layer?.maxRecordCount) > 0
            ? Math.floor(Number(layer.maxRecordCount))
            : 2000,
        ),
      );

      const query = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = [uniqueIdField];
      query.orderByFields = [`${uniqueIdField} ASC`];
      query.outStatistics = [
        {
          statisticType: "avg",
          onStatisticField: ndviField,
          outStatisticFieldName: "avg_ndvi",
        },
        {
          statisticType: "max",
          onStatisticField: pxField,
          outStatisticFieldName: "max_px_all",
        },
      ] as any;
      query.returnGeometry = false;
      query.num = maxRecordCount;

      const result = await queryVegFeatures(layer, query);
      const rows: VegetationAvgNdviUniqueRow[] = [];
      for (const feature of result?.features ?? []) {
        const attrs = (feature as any)?.attributes || {};
        const uniqueid = String(
          attrs[uniqueIdField] ?? attrs.uniqueid ?? "",
        ).trim();
        const avgNdvi = Number(attrs.avg_ndvi);
        const maxPxAll = Number(attrs.max_px_all) || 0;
        if (!uniqueid || !Number.isFinite(avgNdvi)) continue;
        rows.push({
          uniqueid,
          avgNdvi,
          maxPxAll,
          areaHa: maxPxAll * VEG_PIXEL_AREA_HA,
        });
      }
      const exceededTransferLimit = Boolean(
        (result as any)?.exceededTransferLimit,
      );
      const truncated =
        exceededTransferLimit || rows.length >= maxRecordCount;
      if (truncated) {
        agriVhLog("avg-ndvi-stats:truncated", {
          cropIds: params.cropIds || null,
          region: params.region,
          district: params.district ?? null,
          rowCount: rows.length,
          maxRecordCount,
          exceededTransferLimit,
        });
      }
      return { rows, truncated, maxRecordCount, exceededTransferLimit };
    },
  });
}

export interface VegetationStatusCountsParams extends VegetationScopeParams {
  /** "YYYY-MM-DD" */
  date: string;
  /**
   * Crop type filter. agri_vegetation_indices has no human-readable crop
   * name field, only crop_id — callers must resolve the selected turi name
   * to its crop_id first (e.g. via a turi -> crop_id lookup built from
   * Agri_table_data, which carries both).
   */
  cropId?: string;
  /** Multiple selected crops; queried together so one uniqueid is counted once. */
  cropIds?: string[];
  /**
   * Optional STIR-scoped polygon ids. When set, status counts are limited to
   * these uniqueids (header farmer search).
   */
  uniqueIds?: string[];
}

export interface VegetationStatusCount {
  ndvi_status: string;
  /** Number of distinct polygon/field uniqueids in this status. */
  count: number;
  /** Raster area counted once per uniqueid (3m x 3m pixel = 0.0009 ha). */
  areaHa: number;
  /** Stable polygon IDs assigned to this status after deduplication. */
  uniqueIds: string[];
}

const VEG_STATUS_ROW_PAGE_SIZE = 2000;
const VEG_STATUS_ROW_MAX_PAGES = 250;
const vegetationStatusCountsCache = new Map<
  string,
  Promise<VegetationStatusCount[]>
>();
const vegetationAssignedUniqueIdsCache = new Map<
  string,
  Map<string, string[]>
>();

/**
 * Row counts grouped by ndvi_status for one date + region/district scope —
 * the data behind the "Vegetatsiya Holati" bar chart (Past/O'rta/Yaxshi/A'lo).
 */
export async function queryVegetationStatusCounts(
  params: VegetationStatusCountsParams,
): Promise<VegetationStatusCount[]> {
  const { layer, fields } = await getAgriVegetationIndicesLayer();

  const clauses: string[] = [dateEqualsClause("raster_date", params.date)];
  if (params.region != null) {
    clauses.push(`region='${escapeArcGIS(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeArcGIS(String(params.district))}'`);
  }
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    clauses.push(`crop_id='${escapeArcGIS(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    clauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeArcGIS(value)}'`)
        .join(",")})`,
    );
  }
  const farmerUniqueIds = Array.from(
    new Set(
      (params.uniqueIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (farmerUniqueIds.length) {
    clauses.push(buildSpatialJoinWhere(farmerUniqueIds));
  } else if (Array.isArray(params.uniqueIds) && params.uniqueIds.length === 0) {
    return [];
  }
  const where = clauses.join(" AND ");

  const fieldByLower = new Map(
    fields.map((field) => [String(field).toLowerCase(), String(field)]),
  );
  // `uniqueid` is the stable polygon join key. ArcGIS' system GlobalID, when
  // present, identifies an individual table row and must not be preferred.
  const uniqueIdField =
    fieldByLower.get("uniqueid") ||
    fieldByLower.get("unique_id") ||
    fieldByLower.get("globalid") ||
    fieldByLower.get("global_id");
  if (!uniqueIdField) {
    agriVegetationLog("status-counts:FAILED-no-uniqueid-field", { fields });
    return [];
  }

  const cacheKey = `${where}|id=${uniqueIdField}`;
  const cached = vegetationStatusCountsCache.get(cacheKey);
  if (cached) return cached;

  const request = (async (): Promise<VegetationStatusCount[]> => {
    type OneField = {
      rawUniqueId: string;
      statuses: Map<string, { pxAll: number; rowCount: number }>;
    };
    const byUniqueId = new Map<string, OneField>();
    let sourceRowCount = 0;
    let pagesFetched = 0;
    let truncated = false;
    const oidField = String(layer.objectIdField || "objectid");

    const readAttribute = (
      attributes: Record<string, unknown>,
      field: string,
    ): unknown =>
      attributes?.[field] ??
      attributes?.[field.toLowerCase()] ??
      attributes?.[field.toUpperCase()];

    // Collapse duplicate raster rows on the ArcGIS server first. The old path
    // downloaded every raw row (hundreds of thousands nationwide, often 200+
    // pages) and only then deduplicated in the browser. Grouping by the stable
    // polygon id + status preserves the same majority-status rule while
    // transferring only one compact vote row per id/status pair.
    const pageSize = resolveVegetationUniqueIdPageSize(layer);
    try {
      let offset = 0;
      let previousPageSignature = "";
      for (let page = 0; page < VEG_STATUS_ROW_MAX_PAGES; page++) {
      const query: any = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = [uniqueIdField, "ndvi_status"];
      query.orderByFields = [`${uniqueIdField} ASC`, "ndvi_status ASC"];
      query.outFields = [uniqueIdField, "ndvi_status"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: oidField,
          outStatisticFieldName: "row_count",
        },
        {
          statisticType: "max",
          onStatisticField: "px_all",
          outStatisticFieldName: "max_px_all",
        },
      ];
      query.returnGeometry = false;
      query.start = offset;
      query.resultOffset = offset;
      query.num = pageSize;
      query.resultRecordCount = pageSize;

      const result = await queryVegFeatures(layer, query);
      const features = result?.features ?? [];
      if (!features.length) break;
      pagesFetched += 1;

      const firstAttrs = (features[0]?.attributes || {}) as Record<string, unknown>;
      const lastAttrs = (features[features.length - 1]?.attributes || {}) as Record<
        string,
        unknown
      >;
      const pageSignature = `${String(readAttribute(firstAttrs, uniqueIdField) || "")}|${String(
        readAttribute(firstAttrs, "ndvi_status") || "",
      )}|${String(readAttribute(lastAttrs, uniqueIdField) || "")}|${String(
        readAttribute(lastAttrs, "ndvi_status") || "",
      )}`;
      if (page > 0 && pageSignature === previousPageSignature) {
        throw new Error("Vegetation grouped pagination did not advance.");
      }
      previousPageSignature = pageSignature;

      for (const feature of features) {
        const attributes = (feature?.attributes || {}) as Record<string, unknown>;
        const rawUniqueId = readAttribute(attributes, uniqueIdField);
        if (rawUniqueId == null || String(rawUniqueId).trim() === "") continue;
        const rawUniqueIdString = String(rawUniqueId).trim();
        const uniqueId = rawUniqueIdString.toLowerCase();
        const status = String(readAttribute(attributes, "ndvi_status") || "")
          .trim()
          .toLowerCase();
        if (!status) continue;
        const rowCount = Math.max(
          1,
          Number(readAttribute(attributes, "row_count")) || 0,
        );
        const pxAll = Number(readAttribute(attributes, "max_px_all")) || 0;
        sourceRowCount += rowCount;

        const field = byUniqueId.get(uniqueId) || {
          rawUniqueId: rawUniqueIdString,
          statuses: new Map<string, { pxAll: number; rowCount: number }>(),
        };
        const vote = field.statuses.get(status) || { pxAll: 0, rowCount: 0 };
        vote.rowCount += rowCount;
        vote.pxAll = Math.max(vote.pxAll, pxAll);
        field.statuses.set(status, vote);
        byUniqueId.set(uniqueId, field);
      }

      offset += features.length;
      if (features.length < pageSize) break;
        if (page === VEG_STATUS_ROW_MAX_PAGES - 1) truncated = true;
      }
    } catch (groupedError) {
      // Older ArcGIS services can reject pagination on aggregated queries.
      // Keep an exact raw-row fallback so the widget still produces data on
      // those deployments instead of ending in a permanent empty state.
      agriVegetationLog("status-counts:grouped-fallback", {
        where,
        error: String((groupedError as any)?.message || groupedError),
      });
      byUniqueId.clear();
      sourceRowCount = 0;
      pagesFetched = 0;
      truncated = false;
      let lastOid = -1;
      for (let page = 0; page < VEG_STATUS_ROW_MAX_PAGES; page++) {
        const query: any = layer.createQuery();
        query.where =
          lastOid < 0 ? where : `(${where}) AND ${oidField} > ${lastOid}`;
        query.orderByFields = [`${oidField} ASC`];
        query.outFields = [oidField, uniqueIdField, "ndvi_status", "px_all"];
        query.returnGeometry = false;
        query.num = pageSize;
        query.resultRecordCount = pageSize;

        const result = await queryVegFeatures(layer, query);
        const features = result?.features ?? [];
        if (!features.length) break;
        pagesFetched += 1;
        let pageMaxOid = lastOid;
        for (const feature of features) {
          const attributes = (feature?.attributes || {}) as Record<string, unknown>;
          const oid = Number(readAttribute(attributes, oidField));
          if (Number.isFinite(oid) && oid > pageMaxOid) pageMaxOid = oid;
          const rawUniqueId = readAttribute(attributes, uniqueIdField);
          if (rawUniqueId == null || String(rawUniqueId).trim() === "") continue;
          const rawUniqueIdString = String(rawUniqueId).trim();
          const uniqueId = rawUniqueIdString.toLowerCase();
          const status = String(readAttribute(attributes, "ndvi_status") || "")
            .trim()
            .toLowerCase();
          if (!status) continue;
          const pxAll = Number(readAttribute(attributes, "px_all")) || 0;
          sourceRowCount += 1;
          const field = byUniqueId.get(uniqueId) || {
            rawUniqueId: rawUniqueIdString,
            statuses: new Map<string, { pxAll: number; rowCount: number }>(),
          };
          const vote = field.statuses.get(status) || { pxAll: 0, rowCount: 0 };
          vote.rowCount += 1;
          vote.pxAll = Math.max(vote.pxAll, pxAll);
          field.statuses.set(status, vote);
          byUniqueId.set(uniqueId, field);
        }
        if (!(pageMaxOid > lastOid)) {
          truncated = true;
          break;
        }
        lastOid = pageMaxOid;
        if (features.length < pageSize) break;
        if (page === VEG_STATUS_ROW_MAX_PAGES - 1) truncated = true;
      }
    }

    const byStatus = new Map<string, { count: number; pxAll: number }>();
    const assignedIdsByStatus = new Map<string, string[]>();
    let statusPairCount = 0;
    for (const field of byUniqueId.values()) {
      const rankedStatuses = Array.from(field.statuses.entries()).sort(
        ([statusA, a], [statusB, b]) =>
          b.rowCount - a.rowCount || b.pxAll - a.pxAll || statusA.localeCompare(statusB),
      );
      statusPairCount += rankedStatuses.length;
      const assigned = rankedStatuses[0];
      if (!assigned) continue;
      const [status, vote] = assigned;
      const bucket = byStatus.get(status) || { count: 0, pxAll: 0 };
      bucket.count += 1;
      bucket.pxAll += vote.pxAll;
      byStatus.set(status, bucket);
      const ids = assignedIdsByStatus.get(status) || [];
      ids.push(field.rawUniqueId);
      assignedIdsByStatus.set(status, ids);
    }
    // Only publish the id→status assignment when paging completed. A truncated
    // sweep would make queryVegetationUniqueIdsForStatus() serve a short list
    // from cache instead of running its own (deeper) query, so the VH map
    // filter would silently drop fields.
    if (truncated) {
      vegetationAssignedUniqueIdsCache.delete(cacheKey);
      agriVegetationLog("status-counts:assigned-cache-skipped-truncated", {
        where,
        uniqueIdCount: byUniqueId.size,
      });
    } else {
      vegetationAssignedUniqueIdsCache.set(cacheKey, assignedIdsByStatus);
    }

    const rows = Array.from(byStatus.entries()).map(([status, bucket]) => ({
      ndvi_status: status,
      count: bucket.count,
      areaHa: bucket.pxAll * VEG_PIXEL_AREA_HA,
      uniqueIds: assignedIdsByStatus.get(status) || [],
    }));
    agriVegetationLog("status-counts:deduplicated", {
      where,
      uniqueIdField,
      pagesFetched,
      sourceRowCount,
      uniqueIdCount: byUniqueId.size,
      duplicateSourceRowsRemoved: Math.max(0, sourceRowCount - byUniqueId.size),
      statusConflictRowsRemoved: Math.max(0, statusPairCount - byUniqueId.size),
      truncated,
      rows: rows.map((row) => ({
        ndvi_status: row.ndvi_status,
        count: row.count,
        areaHa: row.areaHa,
      })),
    });
    return rows;
  })();

  vegetationStatusCountsCache.set(cacheKey, request);
  while (vegetationStatusCountsCache.size > 64) {
    const oldestKey = vegetationStatusCountsCache.keys().next().value;
    if (!oldestKey) break;
    vegetationStatusCountsCache.delete(oldestKey);
  }
  try {
    return await request;
  } catch (error) {
    vegetationStatusCountsCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Kill-switch for lightweight VH bar totals (groupBy ndvi_status only).
 * When true, **republic** overview uses status stats (fast).
 */
export const REPUBLIC_VH_USE_STATUS_STATS = true;

/**
 * When true, viloyat/tuman VH **bar paint** uses the same 1-RT status-stats
 * path as republic. Exact uniqueid majority-vote remains the fallback when
 * stats return empty, and map VH clicks still resolve uniqueids separately.
 * Set false if bar totals must match exact vote before any VH bucket click.
 */
export const REGION_VH_BAR_USE_STATUS_STATS = true;

const vegetationStatusStatsCache = new Map<
  string,
  Promise<VegetationStatusCount[]>
>();

function buildVegetationStatusWhere(
  params: VegetationStatusCountsParams,
): string {
  const clauses: string[] = [dateEqualsClause("raster_date", params.date)];
  if (params.region != null) {
    clauses.push(`region='${escapeArcGIS(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeArcGIS(String(params.district))}'`);
  }
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    clauses.push(`crop_id='${escapeArcGIS(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    clauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeArcGIS(value)}'`)
        .join(",")})`,
    );
  }
  return clauses.join(" AND ");
}

/**
 * Lightweight VH totals for republic overview: ONE grouped stats query per
 * region/date (groupBy ndvi_status). No uniqueid paging, no uniqueIds list.
 *
 * Tradeoff vs queryVegetationStatusCounts: duplicate raster rows for the same
 * uniqueid can inflate area/fieldCount slightly. Callers that need exact
 * majority-vote semantics (viloyat/tuman + map uniqueid filter) must keep
 * using queryVegetationStatusCounts.
 */
export async function queryVegetationStatusCountsByStatus(
  params: VegetationStatusCountsParams,
): Promise<VegetationStatusCount[]> {
  const date = String(params.date || "").trim();
  if (!date) return [];

  const where = buildVegetationStatusWhere(params);
  // oid field is stable on this service; keep key small for persist.
  const cacheKey = `status-stats|${where}`;
  const promise = rememberAsync({
    memory: vegetationStatusStatsCache,
    namespace: "veg-status-stats",
    key: cacheKey,
    factory: async (): Promise<VegetationStatusCount[]> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const oidField = String(layer.objectIdField || "objectid");
      const query: any = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = ["ndvi_status"];
      query.orderByFields = ["ndvi_status ASC"];
      query.outFields = ["ndvi_status"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: oidField,
          outStatisticFieldName: "row_count",
        },
        {
          statisticType: "sum",
          onStatisticField: "px_all",
          outStatisticFieldName: "sum_px_all",
        },
      ];
      query.returnGeometry = false;
      // Status cardinality is tiny (4 buckets); one page is enough.
      query.num = 50;
      query.resultRecordCount = 50;

      const result = await queryVegFeatures(layer, query);
      const readAttribute = (
        attributes: Record<string, unknown>,
        field: string,
      ): unknown =>
        attributes?.[field] ??
        attributes?.[field.toLowerCase()] ??
        attributes?.[field.toUpperCase()];

      const rows: VegetationStatusCount[] = [];
      for (const feature of result?.features ?? []) {
        const attributes = (feature?.attributes || {}) as Record<
          string,
          unknown
        >;
        const status = String(readAttribute(attributes, "ndvi_status") || "")
          .trim()
          .toLowerCase();
        if (!status) continue;
        const count = Math.max(
          0,
          Number(readAttribute(attributes, "row_count")) || 0,
        );
        const pxAll = Math.max(
          0,
          Number(readAttribute(attributes, "sum_px_all")) || 0,
        );
        if (count <= 0 && pxAll <= 0) continue;
        rows.push({
          ndvi_status: status,
          count,
          areaHa: pxAll * VEG_PIXEL_AREA_HA,
          uniqueIds: [],
        });
      }

      agriVegetationLog("status-counts:by-status", {
        where,
        rowCount: rows.length,
        rows: rows.map((row) => ({
          ndvi_status: row.ndvi_status,
          count: row.count,
          areaHa: row.areaHa,
        })),
      });
      return rows;
    },
  });
  while (vegetationStatusStatsCache.size > 64) {
    const oldestKey = vegetationStatusStatsCache.keys().next().value;
    if (!oldestKey) break;
    vegetationStatusStatsCache.delete(oldestKey);
  }
  return promise;
}

/**
 * Republic VH overview: group region scopes by shared latest date, then one
 * stats query per date (`region IN (...)` + groupBy ndvi_status). Typically
 * 1–3 round-trips instead of ~14 per-region queries.
 */
export async function queryVegetationStatusCountsByRegionScopes(
  scopes: Array<{ region: number; date: string }>,
  cropIds?: string[],
): Promise<VegetationStatusCount[]> {
  const byDate = new Map<string, number[]>();
  for (const scope of scopes) {
    const date = String(scope.date || "").trim();
    const region = Number(scope.region);
    if (!date || !Number.isFinite(region)) continue;
    const list = byDate.get(date) || [];
    list.push(region);
    byDate.set(date, list);
  }
  if (!byDate.size) return [];

  const cropFilter = Array.from(
    new Set((cropIds || []).map((v) => String(v).trim()).filter(Boolean)),
  );

  const batches = await Promise.all(
    Array.from(byDate.entries()).map(([date, regions]) =>
      queryVegetationStatusCountsForRegionsOnDate({
        date,
        regions: Array.from(new Set(regions)),
        cropIds: cropFilter.length ? cropFilter : undefined,
      }),
    ),
  );
  return batches.flat();
}

async function queryVegetationStatusCountsForRegionsOnDate(params: {
  date: string;
  regions: number[];
  cropIds?: string[];
}): Promise<VegetationStatusCount[]> {
  const date = String(params.date || "").trim();
  const regions = Array.from(
    new Set(
      (params.regions || [])
        .map((r) => Number(r))
        .filter((r) => Number.isFinite(r)),
    ),
  );
  if (!date || !regions.length) return [];

  if (regions.length === 1) {
    return queryVegetationStatusCountsByStatus({
      date,
      region: regions[0],
      cropIds: params.cropIds,
    });
  }

  const clauses: string[] = [
    dateEqualsClause("raster_date", date),
    `region IN (${regions.map((r) => `'${escapeArcGIS(String(r))}'`).join(",")})`,
  ];
  const cropFilter = Array.from(
    new Set((params.cropIds || []).map((v) => String(v).trim()).filter(Boolean)),
  );
  if (cropFilter.length === 1) {
    clauses.push(`crop_id='${escapeArcGIS(cropFilter[0])}'`);
  } else if (cropFilter.length > 1) {
    clauses.push(
      `crop_id IN (${cropFilter.map((v) => `'${escapeArcGIS(v)}'`).join(",")})`,
    );
  }
  const where = clauses.join(" AND ");
  const cacheKey = `status-stats-multi|${where}`;
  return rememberAsync({
    memory: vegetationStatusStatsCache,
    namespace: "veg-status-stats",
    key: cacheKey,
    factory: async (): Promise<VegetationStatusCount[]> => {
      const { layer } = await getAgriVegetationIndicesLayer();
      const oidField = String(layer.objectIdField || "objectid");
      const query: any = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = ["ndvi_status"];
      query.orderByFields = ["ndvi_status ASC"];
      query.outFields = ["ndvi_status"];
      query.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: oidField,
          outStatisticFieldName: "row_count",
        },
        {
          statisticType: "sum",
          onStatisticField: "px_all",
          outStatisticFieldName: "sum_px_all",
        },
      ];
      query.returnGeometry = false;
      query.num = 50;
      query.resultRecordCount = 50;

      const result = await queryVegFeatures(layer, query);
      const readAttribute = (
        attributes: Record<string, unknown>,
        field: string,
      ): unknown =>
        attributes?.[field] ??
        attributes?.[field.toLowerCase()] ??
        attributes?.[field.toUpperCase()];

      const out: VegetationStatusCount[] = [];
      for (const feature of result?.features ?? []) {
        const attributes = (feature?.attributes || {}) as Record<
          string,
          unknown
        >;
        const status = String(readAttribute(attributes, "ndvi_status") || "")
          .trim()
          .toLowerCase();
        if (!status) continue;
        const count = Math.max(
          0,
          Number(readAttribute(attributes, "row_count")) || 0,
        );
        const pxAll = Math.max(
          0,
          Number(readAttribute(attributes, "sum_px_all")) || 0,
        );
        if (count <= 0 && pxAll <= 0) continue;
        out.push({
          ndvi_status: status,
          count,
          areaHa: pxAll * VEG_PIXEL_AREA_HA,
          uniqueIds: [],
        });
      }
      agriVegetationLog("status-counts:by-status-multi-region", {
        where,
        regionCount: regions.length,
        rowCount: out.length,
      });
      return out;
    },
  });
}

export interface VegetationUniqueIdsForStatusParams
  extends VegetationStatusCountsParams {
  /** ndvi_status value, e.g. "past" | "orta" | "yaxshi" | "juda_yaxshi" */
  ndviStatus: string;
}

const VEG_UNIQUEID_PAGE_SIZE = 2000;
const VEG_UNIQUEID_MAX_PAGES = 50; // up to ~100k ids at default page size
/** Hard ceiling — never ask the service for more than this per page. */
const VEG_UNIQUEID_PAGE_SIZE_MAX = 10000;

/**
 * Prefer the layer's maxRecordCount so large viloyat VH uniqueid sets need
 * fewer round-trips (same rows, fewer Network rows / same ArcGIS auth token).
 */
function resolveVegetationUniqueIdPageSize(layer: any): number {
  const fromLayer = Number(layer?.maxRecordCount);
  if (Number.isFinite(fromLayer) && fromLayer >= 500) {
    return Math.min(Math.floor(fromLayer), VEG_UNIQUEID_PAGE_SIZE_MAX);
  }
  return VEG_UNIQUEID_PAGE_SIZE;
}

/**
 * Uniqueids whose vegetation row matches the selected Vegetatsiya Holati
 * bucket (ndvi_status) for a given date + region/district. Used to filter
 * map polygons — the polygon layer's static `vh` attribute does NOT carry
 * these bar-chart categories.
 *
 * Uses objectid-cursor paging (`objectid > lastOid`) instead of resultOffset,
 * which some ArcGIS table services ignore (silently re-returning the first
 * page and making callers look "stuck" at MaxRecordCount).
 */
export async function queryVegetationUniqueIdsForStatus(
  params: VegetationUniqueIdsForStatusParams,
): Promise<string[]> {
  const status = String(params.ndviStatus || "")
    .trim()
    .toLowerCase();
  if (!status || !params.date) return [];

  const { layer, fields } = await getAgriVegetationIndicesLayer();
  const scopeClauses: string[] = [dateEqualsClause("raster_date", params.date)];
  if (params.region != null) {
    scopeClauses.push(`region='${escapeArcGIS(String(params.region))}'`);
  }
  if (params.district != null) {
    scopeClauses.push(`district='${escapeArcGIS(String(params.district))}'`);
  }
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    scopeClauses.push(`crop_id='${escapeArcGIS(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    scopeClauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeArcGIS(value)}'`)
        .join(",")})`,
    );
  }
  const fieldByLower = new Map(
    fields.map((field) => [String(field).toLowerCase(), String(field)]),
  );
  const uniqueIdField =
    fieldByLower.get("uniqueid") ||
    fieldByLower.get("unique_id") ||
    fieldByLower.get("globalid") ||
    fieldByLower.get("global_id") ||
    "uniqueid";
  const scopeWhere = scopeClauses.join(" AND ");
  const assignedCacheKey = `${scopeWhere}|id=${uniqueIdField}`;
  const assignedIds =
    vegetationAssignedUniqueIdsCache.get(assignedCacheKey)?.get(status);
  if (assignedIds) {
    agriVegetationLog("uniqueids-for-status:assigned-cache", {
      status,
      date: params.date,
      region: params.region ?? null,
      district: params.district ?? null,
      count: assignedIds.length,
    });
    return assignedIds.slice();
  }

  const baseClauses = [
    ...scopeClauses,
    `ndvi_status='${escapeArcGIS(status)}'`,
  ];
  const baseWhere = baseClauses.join(" AND ");

  const ids = new Set<string>();
  const oidField = String(layer.objectIdField || "objectid");
  const pageSize = resolveVegetationUniqueIdPageSize(layer);
  const maxPages = Math.max(
    VEG_UNIQUEID_MAX_PAGES,
    Math.ceil(100_000 / pageSize),
  );
  let lastOid = -1;
  let pagesFetched = 0;
  let truncated = false;

  agriVegetationLog("uniqueids-for-status:start", {
    where: baseWhere,
    status,
    date: params.date,
    region: params.region ?? null,
    district: params.district ?? null,
    oidField,
    pageSize,
  });

  const readOid = (attrs: Record<string, unknown>): number => {
    const raw =
      attrs?.[oidField] ??
      attrs?.[oidField.toLowerCase()] ??
      attrs?.OBJECTID ??
      attrs?.objectid;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };
  const readUniqueId = (attrs: Record<string, unknown>): string => {
    const raw =
      attrs?.[uniqueIdField] ??
      attrs?.[uniqueIdField.toLowerCase()] ??
      attrs?.[uniqueIdField.toUpperCase()];
    return raw == null || raw === "" ? "" : String(raw);
  };

  for (let page = 0; page < maxPages; page++) {
    const where =
      lastOid < 0
        ? baseWhere
        : `(${baseWhere}) AND ${oidField} > ${lastOid}`;
    const query = layer.createQuery();
    query.where = where;
    query.outFields = [uniqueIdField, oidField];
    query.returnGeometry = false;
    query.orderByFields = [`${oidField} ASC`];
    (query as any).resultRecordCount = pageSize;
    // Do not rely on resultOffset — cursor paging above is the source of truth.

    const result = await queryVegFeatures(layer, query);
    const features = result?.features ?? [];
    pagesFetched += 1;
    if (!features.length) break;

    let pageMaxOid = lastOid;
    let newIds = 0;
    for (const f of features) {
      const attrs = (f.attributes || {}) as Record<string, unknown>;
      const oid = readOid(attrs);
      if (Number.isFinite(oid) && oid > pageMaxOid) pageMaxOid = oid;
      const v = readUniqueId(attrs);
      if (v) {
        const before = ids.size;
        ids.add(v);
        if (ids.size > before) newIds += 1;
      }
    }
    if (!(pageMaxOid > lastOid)) {
      truncated = true;
      break;
    }
    lastOid = pageMaxOid;

    if (features.length < pageSize) break;
    if (newIds === 0) {
      truncated = true;
      break;
    }
    if (page === maxPages - 1) truncated = true;
  }

  agriVegetationLog("uniqueids-for-status:done", {
    status,
    date: params.date,
    count: ids.size,
    pagesFetched,
    pageSize,
    truncated,
  });

  return Array.from(ids);
}

/** VH bar category label → ndvi_status value in agri_vegetation_indices. */
export const VH_CATEGORY_TO_NDVI_STATUS: Record<string, string> = {
  "1-Juda yaxshi": "juda_yaxshi",
  "2-Yaxshi": "yaxshi",
  "3-O'rta": "orta",
  "4-Past": "past",
};

export interface VegetationCropBreakdownParams {
  date: string;
  ndviStatus: string;
  region?: number;
  district?: number;
}

export interface VegetationCropBreakdownRow {
  cropId: string;
  areaHa: number;
  fieldCount: number;
}

const vegetationCropBreakdownCache = new Map<
  string,
  Promise<VegetationCropBreakdownRow[]>
>();

const vegetationCropStatsCache = new Map<
  string,
  Promise<VegetationCropBreakdownRow[]>
>();

/** Crop cardinality is a short list; one page always covers it. */
const VEG_CROP_STATS_MAX_ROWS = 200;

function buildVegetationCropScopeWhere(
  params: VegetationCropBreakdownParams,
  status: string,
): string {
  const clauses: string[] = [
    dateEqualsClause("raster_date", params.date),
    `ndvi_status='${escapeArcGIS(status)}'`,
  ];
  if (params.region != null) {
    clauses.push(`region='${escapeArcGIS(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeArcGIS(String(params.district))}'`);
  }
  return clauses.join(" AND ");
}

/**
 * Crop mix for one VH status + date + region/district in a single grouped
 * stats query (groupBy crop_id, sum px_all).
 *
 * Same tradeoff as queryVegetationStatusCountsByStatus: duplicate raster rows
 * for one uniqueid are summed instead of majority-voted, so these totals match
 * the Vegetatsiya Holati bar buckets exactly. The uniqueid-level variant below
 * groups by a very high cardinality field and needs dozens of pages per
 * viloyat, which left the Ekin Turi panel loading for minutes.
 */
export async function queryVegetationCropStatsForStatus(
  params: VegetationCropBreakdownParams,
): Promise<VegetationCropBreakdownRow[]> {
  const status = String(params.ndviStatus || "")
    .trim()
    .toLowerCase();
  if (!status || !params.date) return [];

  const { layer, fields } = await getAgriVegetationIndicesLayer();
  const fieldByLower = new Map(
    fields.map((field) => [String(field).toLowerCase(), String(field)]),
  );
  const cropIdField =
    fieldByLower.get("crop_id") || fieldByLower.get("cropid") || "crop_id";
  const oidField = String(layer.objectIdField || "objectid");
  const where = buildVegetationCropScopeWhere(params, status);
  const cacheKey = `crop-stats|${where}|crop=${cropIdField}|oid=${oidField}`;
  const cached = vegetationCropStatsCache.get(cacheKey);
  if (cached) return cached;

  const request = (async (): Promise<VegetationCropBreakdownRow[]> => {
    const query: any = layer.createQuery();
    query.where = where;
    query.groupByFieldsForStatistics = [cropIdField];
    query.orderByFields = [`${cropIdField} ASC`];
    query.outFields = [cropIdField];
    query.outStatistics = [
      {
        statisticType: "count",
        onStatisticField: oidField,
        outStatisticFieldName: "row_count",
      },
      {
        statisticType: "sum",
        onStatisticField: "px_all",
        outStatisticFieldName: "sum_px_all",
      },
    ];
    query.returnGeometry = false;
    query.num = VEG_CROP_STATS_MAX_ROWS;
    query.resultRecordCount = VEG_CROP_STATS_MAX_ROWS;

    const result = await queryVegFeatures(layer, query);
    const readAttribute = (
      attributes: Record<string, unknown>,
      field: string,
    ): unknown =>
      attributes?.[field] ??
      attributes?.[field.toLowerCase()] ??
      attributes?.[field.toUpperCase()];

    const rows: VegetationCropBreakdownRow[] = [];
    for (const feature of result?.features ?? []) {
      const attributes = (feature?.attributes || {}) as Record<string, unknown>;
      const cropId = String(readAttribute(attributes, cropIdField) || "").trim();
      if (!cropId) continue;
      const fieldCount = Math.max(
        0,
        Number(readAttribute(attributes, "row_count")) || 0,
      );
      const pxAll = Math.max(
        0,
        Number(readAttribute(attributes, "sum_px_all")) || 0,
      );
      if (fieldCount <= 0 && pxAll <= 0) continue;
      rows.push({
        cropId,
        areaHa: pxAll * VEG_PIXEL_AREA_HA,
        fieldCount,
      });
    }

    agriVegetationLog("crop-stats:done", {
      where,
      cropIdField,
      // rawFeatureCount > rowCount means groups were dropped because
      // crop_id is null/empty in agri_vegetation_indices for this scope.
      rawFeatureCount: (result?.features ?? []).length,
      rowCount: rows.length,
    });
    return rows;
  })();

  vegetationCropStatsCache.set(cacheKey, request);
  while (vegetationCropStatsCache.size > 64) {
    const oldestKey = vegetationCropStatsCache.keys().next().value;
    if (!oldestKey) break;
    vegetationCropStatsCache.delete(oldestKey);
  }
  try {
    return await request;
  } catch (error) {
    vegetationCropStatsCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Crop mix (by crop_id) for one VH status + date + region/district — same
 * source as the Vegetatsiya Holati bar. Exact per-uniqueid variant kept as the
 * fallback for services that reject grouped stats on crop_id.
 */
export async function queryVegetationCropBreakdownForStatus(
  params: VegetationCropBreakdownParams,
): Promise<VegetationCropBreakdownRow[]> {
  const status = String(params.ndviStatus || "")
    .trim()
    .toLowerCase();
  if (!status || !params.date) return [];

  const where = buildVegetationCropScopeWhere(params, status);
  const cacheKey = where;
  const cached = vegetationCropBreakdownCache.get(cacheKey);
  if (cached) return cached;

  const request = (async (): Promise<VegetationCropBreakdownRow[]> => {
    const { layer, fields } = await getAgriVegetationIndicesLayer();
    const fieldByLower = new Map(
      fields.map((field) => [String(field).toLowerCase(), String(field)]),
    );
    const uniqueIdField =
      fieldByLower.get("uniqueid") ||
      fieldByLower.get("unique_id") ||
      fieldByLower.get("globalid") ||
      fieldByLower.get("global_id");
    const cropIdField =
      fieldByLower.get("crop_id") || fieldByLower.get("cropid") || "crop_id";
    if (!uniqueIdField) return [];

    type FieldCrop = { cropId: string; pxAll: number };
    const byUniqueId = new Map<string, FieldCrop>();

    const readAttribute = (
      attributes: Record<string, unknown>,
      field: string,
    ): unknown =>
      attributes?.[field] ??
      attributes?.[field.toLowerCase()] ??
      attributes?.[field.toUpperCase()];

    let offset = 0;
    let previousPageSignature = "";
    for (let page = 0; page < VEG_STATUS_ROW_MAX_PAGES; page++) {
      const query: any = layer.createQuery();
      query.where = where;
      query.groupByFieldsForStatistics = [uniqueIdField, cropIdField];
      query.orderByFields = [`${uniqueIdField} ASC`, `${cropIdField} ASC`];
      query.outFields = [uniqueIdField, cropIdField];
      query.outStatistics = [
        {
          statisticType: "max",
          onStatisticField: "px_all",
          outStatisticFieldName: "max_px_all",
        },
      ];
      query.returnGeometry = false;
      query.start = offset;
      query.resultOffset = offset;
      query.num = VEG_STATUS_ROW_PAGE_SIZE;
      query.resultRecordCount = VEG_STATUS_ROW_PAGE_SIZE;

      const result = await queryVegFeatures(layer, query);
      const features = result?.features ?? [];
      if (!features.length) break;

      const firstAttrs = (features[0]?.attributes || {}) as Record<
        string,
        unknown
      >;
      const lastAttrs = (features[features.length - 1]?.attributes ||
        {}) as Record<string, unknown>;
      const pageSignature = [
        String(readAttribute(firstAttrs, uniqueIdField) || ""),
        String(readAttribute(firstAttrs, cropIdField) || ""),
        String(readAttribute(lastAttrs, uniqueIdField) || ""),
        String(readAttribute(lastAttrs, cropIdField) || ""),
      ].join("|");
      // Some services ignore resultOffset on aggregated queries and keep
      // re-serving page 1. Stop with partial data instead of repeating the
      // same expensive page for every remaining slot.
      if (page > 0 && pageSignature === previousPageSignature) {
        agriVegetationLog("crop-breakdown:pagination-stalled", {
          where,
          page,
          collected: byUniqueId.size,
        });
        break;
      }
      previousPageSignature = pageSignature;

      for (const feature of features) {
        const attributes = (feature?.attributes || {}) as Record<
          string,
          unknown
        >;
        const rawUniqueId = readAttribute(attributes, uniqueIdField);
        if (rawUniqueId == null || String(rawUniqueId).trim() === "") continue;
        const uniqueId = String(rawUniqueId).trim().toLowerCase();
        const cropId = String(readAttribute(attributes, cropIdField) || "")
          .trim();
        if (!cropId) continue;
        const pxAll = Number(readAttribute(attributes, "max_px_all")) || 0;
        const prev = byUniqueId.get(uniqueId);
        if (!prev || pxAll > prev.pxAll) {
          byUniqueId.set(uniqueId, { cropId, pxAll });
        }
      }

      offset += features.length;
      if (features.length < VEG_STATUS_ROW_PAGE_SIZE) break;
    }

    const byCrop = new Map<string, { areaHa: number; fieldCount: number }>();
    for (const entry of byUniqueId.values()) {
      const bucket = byCrop.get(entry.cropId) || {
        areaHa: 0,
        fieldCount: 0,
      };
      bucket.fieldCount += 1;
      bucket.areaHa += entry.pxAll * VEG_PIXEL_AREA_HA;
      byCrop.set(entry.cropId, bucket);
    }

    return Array.from(byCrop.entries())
      .map(([cropId, stats]) => ({
        cropId,
        areaHa: stats.areaHa,
        fieldCount: stats.fieldCount,
      }))
      .filter((row) => row.areaHa > 0 || row.fieldCount > 0);
  })();

  vegetationCropBreakdownCache.set(cacheKey, request);
  while (vegetationCropBreakdownCache.size > 64) {
    const oldestKey = vegetationCropBreakdownCache.keys().next().value;
    if (!oldestKey) break;
    vegetationCropBreakdownCache.delete(oldestKey);
  }
  try {
    return await request;
  } catch (err) {
    vegetationCropBreakdownCache.delete(cacheKey);
    throw err;
  }
}

export interface VegetationRecentRegionRow {
  regionCode: string;
  fieldCount: number;
}

export interface VegetationRecentDayGroup {
  /** YYYY-MM-DD — calendar day of processed_at (when rows were loaded) */
  date: string;
  regions: VegetationRecentRegionRow[];
  totalFields: number;
}

const vegetationRecentDaysCache = new Map<
  string,
  Promise<VegetationRecentDayGroup[]>
>();

function readVegAttr(attrs: Record<string, any>, ...names: string[]): any {
  if (!attrs) return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(attrs, name)) return attrs[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(attrs)) {
      if (key.toLowerCase() === lower) return attrs[key];
    }
  }
  return undefined;
}

function shiftYmd(ymd: string, deltaDays: number): string | null {
  const parts = String(ymd || "").split("-");
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Uzbekistan (Asia/Tashkent) is UTC+5 year-round (no DST). */
const TASHKENT_TZ_OFFSET_MS = 5 * 60 * 60 * 1000;

function epochMsFromDateValue(value: any): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Calendar day in Tashkent for a processed_at timestamp. */
function formatEpochToTashkentYmd(value: any): string | null {
  const ms = epochMsFromDateValue(value);
  if (ms == null) return null;
  const shifted = new Date(ms + TASHKENT_TZ_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function tashkentDayBoundsMs(
  ymd: string,
): { startMs: number; endMs: number } | null {
  const parts = String(ymd || "")
    .trim()
    .split("-")
    .map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Midnight Tashkent = that civil date at 00:00 UTC minus +5h.
  const startMs = Date.UTC(y, m - 1, d) - TASHKENT_TZ_OFFSET_MS;
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

function formatUtcSqlTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * One Tashkent calendar day of processed_at (overnight loads stay on local day).
 * Prefer TIMESTAMP range; fall back callers already use DATE for raster_date.
 */
function processedAtTashkentDayWhere(dateField: string, ymd: string): string {
  const bounds = tashkentDayBoundsMs(ymd);
  if (!bounds) return "1=0";
  return (
    `${dateField} >= TIMESTAMP '${formatUtcSqlTimestamp(bounds.startMs)}' ` +
    `AND ${dateField} < TIMESTAMP '${formatUtcSqlTimestamp(bounds.endMs)}'`
  );
}

/**
 * Exactly `dayCount` consecutive Tashkent calendar days ending at MAX(processed_at).
 * Does NOT skip empty days — that was pulling in Sep 7 / Sep 6 instead of Sep 13–11.
 */
async function fetchLastProcessedAtCalendarWindow(
  layer: any,
  dateField: string,
  dayCount: number,
): Promise<string[]> {
  const maxQuery = layer.createQuery();
  maxQuery.where = `${dateField} IS NOT NULL`;
  maxQuery.returnGeometry = false;
  maxQuery.outStatistics = [
    {
      statisticType: "max",
      onStatisticField: dateField,
      outStatisticFieldName: "max_processed_at",
    },
  ] as any;

  const maxResult = await queryVegFeatures(layer, maxQuery);
  const maxRaw = readVegAttr(
    (maxResult?.features?.[0] as any)?.attributes || {},
    "max_processed_at",
    dateField,
  );
  const maxYmd = formatEpochToTashkentYmd(maxRaw);
  agriNotifyLog("dates:window", {
    dateField,
    maxRaw,
    maxYmdUtc: formatArcgisDateToYmd(maxRaw),
    maxYmdTashkent: maxYmd,
    dayCount,
  });
  if (!maxYmd) return [];

  const days: string[] = [];
  for (let i = 0; i < dayCount; i++) {
    const ymd = shiftYmd(maxYmd, -i);
    if (ymd) days.push(ymd);
  }
  return days;
}

/**
 * DISTINCT uniqueid per region for one processed_at day.
 * Fast path: returnDistinctValues + returnCountOnly (1 request per region).
 * Server does not support countDistinct stats — never use those.
 */
async function countDistinctUniqueIdsForProcessedDay(
  layer: any,
  dateField: string,
  regionField: string,
  uniqueIdField: string,
  oidField: string,
  ymd: string,
): Promise<Map<string, number>> {
  const pageSize = resolveVegetationUniqueIdPageSize(layer);
  const whereCandidates = [
    processedAtTashkentDayWhere(dateField, ymd),
    // Fallback: UTC DATE range (same as raster_date clauses) if TIMESTAMP is rejected.
    dateEqualsClause(dateField, ymd),
  ];

  let where = whereCandidates[0];
  let regionList: string[] = [];

  for (let i = 0; i < whereCandidates.length; i++) {
    where = whereCandidates[i];
    regionList = await listRegionsForProcessedDay(
      layer,
      where,
      regionField,
      oidField,
      ymd,
    );
    if (regionList.length) {
      if (i > 0) {
        agriNotifyLog("count:day-done", {
          ymd,
          path: "where-fallback-date-clause",
          regions: regionList.length,
        });
      }
      break;
    }
  }

  agriNotifyLog("count:start-day", {
    ymd,
    where,
    dateField,
    regionField,
    uniqueIdField,
  });

  if (!regionList.length) {
    agriNotifyLog("count:day-done", {
      ymd,
      path: "no-regions",
      totalDistinctUniqueIds: 0,
      byRegion: [],
    });
    return new Map();
  }

  const distinctCounts = await countDistinctUniqueIdsByRegionParallel(
    layer,
    where,
    regionField,
    uniqueIdField,
    regionList,
    ymd,
  );
  if (distinctCounts) return distinctCounts;

  agriNotifyLog("count:fallback-oid-cursor", {
    ymd,
    reason: "returnDistinctValues+returnCountOnly unavailable",
    regionHint: regionList,
  });

  return countDistinctViaOidCursor(
    layer,
    where,
    regionField,
    uniqueIdField,
    oidField,
    ymd,
    pageSize,
  );
}

function resolveVegetationQueryUrl(layer: any): string {
  const raw = String(layer?.url || getAgriVegetationIndicesUrl() || "").replace(
    /\/$/,
    "",
  );
  if (/\/FeatureServer\/\d+$/i.test(raw)) return raw;
  if (/\/FeatureServer$/i.test(raw)) {
    const configured = String(getAgriVegetationIndicesUrl() || "").replace(
      /\/$/,
      "",
    );
    if (/\/FeatureServer\/\d+$/i.test(configured)) return configured;
  }
  return raw;
}

/**
 * ArcGIS: returnDistinctValues=true + returnCountOnly=true → distinct field count.
 * One HTTP call per region (typically 3–6 regions/day).
 */
async function queryDistinctFieldCount(
  layer: any,
  where: string,
  field: string,
): Promise<number | null> {
  // 1) FeatureLayer.queryFeatureCount with distinct flag
  try {
    const query = layer.createQuery();
    query.where = where;
    query.outFields = [field];
    query.returnDistinctValues = true;
    query.returnGeometry = false;
    (query as any).returnCountOnly = true;
    if (typeof layer.queryFeatureCount === "function") {
      const count = await layer.queryFeatureCount(query);
      if (Number.isFinite(count) && count >= 0) return Number(count);
    }
  } catch (err) {
    agriNotifyLog("count:distinct-api-failed", {
      where: where.slice(0, 120),
      error: String((err as any)?.message || err),
    });
  }

  // 2) Direct REST (most reliable for returnCountOnly + returnDistinctValues)
  try {
    const [esriRequest] = await loadArcGISJSAPIModules(["esri/request"]);
    const base = resolveVegetationQueryUrl(layer);
    const res = await esriRequest(`${base}/query`, {
      query: {
        f: "json",
        where,
        outFields: field,
        returnDistinctValues: true,
        returnCountOnly: true,
        returnGeometry: false,
      },
      responseType: "json",
    });
    if (res?.data?.error) {
      throw new Error(String(res.data.error.message || "query error"));
    }
    const count = Number(res?.data?.count);
    if (Number.isFinite(count) && count >= 0) return count;
  } catch (err) {
    agriNotifyLog("count:distinct-rest-failed", {
      where: where.slice(0, 120),
      error: String((err as any)?.message || err),
    });
  }

  return null;
}

async function countDistinctUniqueIdsByRegionParallel(
  layer: any,
  baseWhere: string,
  regionField: string,
  uniqueIdField: string,
  regions: string[],
  ymd: string,
): Promise<Map<string, number> | null> {
  const results = await Promise.all(
    regions.map(async (regionCode) => {
      const where = `${baseWhere} AND ${regionField}='${escapeArcGIS(regionCode)}'`;
      const fieldCount = await queryDistinctFieldCount(
        layer,
        where,
        uniqueIdField,
      );
      agriNotifyLog("count:region-distinct", {
        ymd,
        regionCode,
        fieldCount,
      });
      return { regionCode, fieldCount };
    }),
  );

  if (results.some((row) => row.fieldCount == null)) {
    agriNotifyLog("count:region-distinct-incomplete", { ymd, results });
    return null;
  }

  const out = new Map<string, number>();
  for (const row of results) {
    const n = Number(row.fieldCount) || 0;
    if (n > 0) out.set(row.regionCode, n);
  }

  agriNotifyLog("count:day-done", {
    ymd,
    path: "returnDistinctValues+returnCountOnly",
    regions: out.size,
    totalDistinctUniqueIds: Array.from(out.values()).reduce((s, n) => s + n, 0),
    byRegion: Array.from(out.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([regionCode, fieldCount]) => ({ regionCode, fieldCount })),
  });

  return out;
}

async function listRegionsForProcessedDay(
  layer: any,
  where: string,
  regionField: string,
  oidField: string,
  ymd: string,
): Promise<string[]> {
  try {
    const query = layer.createQuery();
    query.where = where;
    query.groupByFieldsForStatistics = [regionField];
    query.orderByFields = [`${regionField} ASC`];
    query.outStatistics = [
      {
        statisticType: "count",
        onStatisticField: oidField,
        outStatisticFieldName: "row_cnt",
      },
    ] as any;
    query.returnGeometry = false;
    query.num = 100;
    const result = await queryVegFeatures(layer, query);
    const regions: string[] = [];
    for (const feature of result?.features ?? []) {
      const attrs = (feature as any)?.attributes || {};
      const regionCode = String(
        readVegAttr(attrs, regionField, "region") ?? "",
      ).trim();
      const rowCnt = Number(readVegAttr(attrs, "row_cnt")) || 0;
      if (regionCode && rowCnt > 0) regions.push(regionCode);
    }
    agriNotifyLog("count:regions-for-day", { ymd, regions });
    return regions;
  } catch (err) {
    agriNotifyLog("count:regions-for-day-failed", {
      ymd,
      error: String((err as any)?.message || err),
    });
    return [];
  }
}

async function countDistinctViaOidCursor(
  layer: any,
  where: string,
  regionField: string,
  uniqueIdField: string,
  oidField: string,
  ymd: string,
  pageSize: number,
): Promise<Map<string, number>> {
  const regionSets = new Map<string, Set<string>>();
  let lastOid: number | null = null;
  let pages = 0;
  let rowsRead = 0;
  const maxPages = 2500;

  while (pages < maxPages) {
    pages += 1;
    const clauses = [where];
    if (lastOid != null && Number.isFinite(lastOid)) {
      clauses.push(`${oidField} > ${lastOid}`);
    }
    const query = layer.createQuery();
    query.where = clauses.join(" AND ");
    query.outFields = [oidField, uniqueIdField, regionField];
    query.orderByFields = [`${oidField} ASC`];
    query.returnGeometry = false;
    query.num = pageSize;
    query.resultRecordCount = pageSize;

    const result = await queryVegFeatures(layer, query);
    const features = result?.features ?? [];
    if (!features.length) break;

    let pageMaxOid = lastOid;
    for (const feature of features) {
      const attrs = (feature as any)?.attributes || {};
      const oid = Number(readVegAttr(attrs, oidField, "objectid", "OBJECTID"));
      const uniqueId = String(
        readVegAttr(attrs, uniqueIdField, "uniqueid") ?? "",
      ).trim();
      const regionCode = String(
        readVegAttr(attrs, regionField, "region") ?? "",
      ).trim();
      if (Number.isFinite(oid)) {
        pageMaxOid = pageMaxOid == null ? oid : Math.max(pageMaxOid, oid);
      }
      if (!uniqueId || !regionCode) continue;
      let set = regionSets.get(regionCode);
      if (!set) {
        set = new Set<string>();
        regionSets.set(regionCode, set);
      }
      set.add(uniqueId);
    }

    rowsRead += features.length;
    if (pages === 1 || pages % 50 === 0 || features.length < pageSize) {
      agriNotifyLog("count:page", {
        ymd,
        page: pages,
        got: features.length,
        rowsRead,
        regionCount: regionSets.size,
        distinctUniqueIdsSoFar: Array.from(regionSets.values()).reduce(
          (sum, set) => sum + set.size,
          0,
        ),
      });
    }

    if (pageMaxOid == null || pageMaxOid === lastOid) break;
    lastOid = pageMaxOid;
    if (features.length < pageSize) break;
  }

  const counts = new Map<string, number>();
  for (const [regionCode, set] of regionSets) {
    counts.set(regionCode, set.size);
  }

  agriNotifyLog("count:day-done", {
    ymd,
    path: "oid-cursor",
    pages,
    rowsRead,
    regions: counts.size,
    totalDistinctUniqueIds: Array.from(counts.values()).reduce(
      (s, n) => s + n,
      0,
    ),
    byRegion: Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([regionCode, fieldCount]) => ({ regionCode, fieldCount })),
  });

  return counts;
}

/**
 * Last N Tashkent calendar days from MAX(processed_at), with DISTINCT uniqueid
 * counts per region. Empty days are kept so the UI shows a true 5-day window.
 */
export async function queryVegetationRecentDayRegionCounts(
  dayCount = 5,
): Promise<VegetationRecentDayGroup[]> {
  const n = Math.max(1, Math.min(14, Math.floor(Number(dayCount)) || 5));
  // v8: fixed calendar window (no skip-empty backfill) + Tashkent day bounds
  const cacheKey = `v8-processed_at-calendar-window|${n}`;

  return rememberAsync({
    memory: vegetationRecentDaysCache,
    namespace: "veg-recent-days",
    key: cacheKey,
    factory: async (): Promise<VegetationRecentDayGroup[]> => {
      agriNotifyLog("query:start", { dayCount: n, cacheKey });
      const { layer, fields } = await getAgriVegetationIndicesLayer();
      const fieldByLower = new Map(
        (fields || []).map((f) => [String(f).toLowerCase(), String(f)]),
      );
      const dateField =
        fieldByLower.get("processed_at") ||
        fieldByLower.get("processedat") ||
        "processed_at";
      const regionField = fieldByLower.get("region") || "region";
      const uniqueIdField =
        fieldByLower.get("uniqueid") ||
        fieldByLower.get("unique_id") ||
        fieldByLower.get("globalid") ||
        "uniqueid";
      const oidField = String(layer.objectIdField || "objectid");

      const selectedDates = await fetchLastProcessedAtCalendarWindow(
        layer,
        dateField,
        n,
      );
      if (!selectedDates.length) {
        agriNotifyLog("query:no-dates");
        return [];
      }

      const groups = await Promise.all(
        selectedDates.map(async (date) => {
          const regionMap = await countDistinctUniqueIdsForProcessedDay(
            layer,
            dateField,
            regionField,
            uniqueIdField,
            oidField,
            date,
          );
          const regions: VegetationRecentRegionRow[] = Array.from(
            regionMap.entries(),
          )
            .map(([regionCode, fieldCount]) => ({ regionCode, fieldCount }))
            .filter((row) => row.fieldCount > 0)
            .sort(
              (a, b) =>
                b.fieldCount - a.fieldCount ||
                a.regionCode.localeCompare(b.regionCode),
            );
          return {
            date,
            regions,
            totalFields: regions.reduce((sum, row) => sum + row.fieldCount, 0),
          };
        }),
      );

      const byDate = new Map(groups.map((g) => [g.date, g]));
      const ordered = selectedDates
        .map((d) => byDate.get(d))
        .filter(Boolean) as VegetationRecentDayGroup[];

      agriNotifyLog("query:done", {
        days: ordered.map((g) => ({
          date: g.date,
          totalFields: g.totalFields,
          regionCount: g.regions.length,
          topRegions: g.regions.slice(0, 5),
        })),
      });

      return ordered;
    },
  });
}

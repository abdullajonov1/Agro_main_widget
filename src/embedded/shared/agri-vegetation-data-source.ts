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
import { loadArcGISJSAPIModules } from "jimu-arcgis";

/** Optional diagnostic hook; intentionally quiet in the published dashboard. */
export function agriVegetationLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export const AGRI_VEGETATION_INDICES_URL =
  "https://sgm.uzspace.uz/server/rest/services/Agriculture/agri_vegetation_indices/FeatureServer/1";

export interface AgriVegetationLayerHandle {
  layer: any;
  fields: string[];
}

let agriVegetationLayerPromise: Promise<AgriVegetationLayerHandle> | null = null;

/**
 * Loads (once) the external agri_vegetation_indices Table by URL. Cached as
 * a singleton promise so every widget shares the same loaded layer instance
 * — mirrors getAgriTableDataLayer() in agri-table-data-source.ts.
 */
export async function getAgriVegetationIndicesLayer(): Promise<AgriVegetationLayerHandle> {
  if (!agriVegetationLayerPromise) {
    agriVegetationLog("load:start", { url: AGRI_VEGETATION_INDICES_URL });
    agriVegetationLayerPromise = (async () => {
      const [FeatureLayer] = await loadArcGISJSAPIModules([
        "esri/layers/FeatureLayer",
      ]);
      const layer = new FeatureLayer({ url: AGRI_VEGETATION_INDICES_URL });
      await layer.load();
      const fields: string[] = (layer.fields || []).map((f: any) => f.name);
      agriVegetationLog("load:success", {
        url: AGRI_VEGETATION_INDICES_URL,
        title: (layer as any)?.title,
        fieldCount: fields.length,
        fields,
      });
      return { layer, fields };
    })().catch((err) => {
      agriVegetationLayerPromise = null;
      agriVegetationLog("load:FAILED", {
        url: AGRI_VEGETATION_INDICES_URL,
        error: String(err?.message || err),
        status: err?.details?.httpStatus ?? err?.httpStatus ?? null,
      });
      throw err;
    });
  }
  return agriVegetationLayerPromise;
}

function escapeAgriVeg(value: string): string {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * One polygon's full vegetation index time series, ordered by date —
 * mirrors the shape previously returned by GET /api/v1/vegetation/uniqueid/{id}.
 */
export async function queryVegetationSeriesForUniqueId(
  uniqueId: string,
): Promise<Array<Record<string, any>>> {
  const raw = String(uniqueId ?? "").trim();
  if (!raw) return [];

  const { layer } = await getAgriVegetationIndicesLayer();
  const query = layer.createQuery();
  query.where = `uniqueid='${escapeAgriVeg(raw)}'`;
  query.outFields = ["*"];
  query.returnGeometry = false;
  query.orderByFields = ["raster_date ASC"];
  query.num = 2000;

  const result = await layer.queryFeatures(query);
  return (result?.features ?? []).map((f: any) => ({ ...(f.attributes || {}) }));
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
}

/**
 * Regional (aggregate) vegetation index time series — mean of every index
 * per raster_date, across every polygon matching region/district/date
 * range. Mirrors the shape previously returned by
 * GET /api/v1/vegetation/regional/timeseries: rows keyed by `date` plus the
 * bare index names (ndvi, savi, ...) and `polygon_count`.
 */
export async function queryVegetationRegionalTimeseries(
  params: VegetationRegionalTimeseriesParams,
): Promise<Array<Record<string, any>>> {
  const { layer } = await getAgriVegetationIndicesLayer();

  const clauses: string[] = [];
  if (params.region != null) {
    clauses.push(`region='${escapeAgriVeg(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeAgriVeg(String(params.district))}'`);
  }
  if (params.ndviStatus) {
    clauses.push(
      `ndvi_status='${escapeAgriVeg(String(params.ndviStatus))}'`,
    );
  }
  if (params.startDate && params.endDate) {
    clauses.push(
      `raster_date >= DATE '${params.startDate}' AND raster_date <= DATE '${params.endDate}'`,
    );
  }
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    clauses.push(`crop_id='${escapeAgriVeg(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    clauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeAgriVeg(value)}'`)
        .join(",")})`,
    );
  }
  const where = clauses.length ? clauses.join(" AND ") : "1=1";

  const query = layer.createQuery();
  query.where = where;
  query.groupByFieldsForStatistics = ["raster_date"];
  query.orderByFields = ["raster_date ASC"];
  query.outStatistics = [
    ...VEG_AVG_FIELDS.map((field) => ({
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

  const result = await layer.queryFeatures(query);
  const rows = (result?.features ?? []).map((feature: any) =>
    feature.attributes || {},
  );
  return rows.map((row: any) => {
    const normalized: Record<string, any> = {
      date: row.raster_date,
      polygon_count: row.polygon_count ?? 0,
    };
    for (const field of VEG_AVG_FIELDS) {
      normalized[field] = row[`avg_${field}`];
    }
    return normalized;
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
 */
function dateEqualsClause(dateField: string, ymd: string): string {
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  if (!y || !m || !d) return "1=0";
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return `${dateField} >= DATE '${ymd}' AND ${dateField} < DATE '${nextYmd}'`;
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
export async function queryVegetationAvailableDates(
  params: VegetationScopeParams = {},
): Promise<string[]> {
  const { layer } = await getAgriVegetationIndicesLayer();

  const clauses: string[] = [];
  if (params.region != null) {
    clauses.push(`region='${escapeAgriVeg(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeAgriVeg(String(params.district))}'`);
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

  const result = await layer.queryFeatures(query);
  const dateSet = new Set<string>();
  for (const feature of result?.features ?? []) {
    const ymd = formatArcgisDateToYmd((feature as any)?.attributes?.raster_date);
    if (ymd) dateSet.add(ymd);
  }
  return Array.from(dateSet).sort();
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
  const { layer } = await getAgriVegetationIndicesLayer();

  const clauses: string[] = ["region IS NOT NULL"];
  const year = String(params.year || "").match(/\b(18|19|20)\d{2}\b/)?.[0];
  const cacheKey = year || "*";
  const cached = vegetationLatestDatesByRegionCache.get(cacheKey);
  if (cached) return cached;
  if (year) {
    const nextYear = String(Number(year) + 1);
    clauses.push(
      `raster_date >= DATE '${year}-01-01' AND raster_date < DATE '${nextYear}-01-01'`,
    );
  }

  const query = layer.createQuery();
  query.where = clauses.join(" AND ");
  query.groupByFieldsForStatistics = ["region", "raster_date"];
  query.orderByFields = ["region ASC", "raster_date ASC"];
  query.outStatistics = [
    {
      statisticType: "count",
      onStatisticField: "objectid",
      outStatisticFieldName: "cnt",
    },
  ] as any;
  query.returnGeometry = false;
  query.num = 2000;

  const request = (async (): Promise<VegetationLatestDateByRegion[]> => {
    const result = await layer.queryFeatures(query);
    const latestByRegion = new Map<number, string>();
    for (const feature of result?.features ?? []) {
      const attributes = (feature as any)?.attributes || {};
      const region = Number(attributes.region);
      const date = formatArcgisDateToYmd(attributes.raster_date);
      if (!Number.isFinite(region) || !date) continue;
      const previous = latestByRegion.get(region);
      if (!previous || date > previous) latestByRegion.set(region, date);
    }

    const latestDates = Array.from(latestByRegion.entries())
      .map(([region, date]) => ({ region, date }))
      .sort((a, b) => a.region - b.region);

    agriVegetationLog("latest-dates-by-region", {
      year: year || null,
      pairCount: result?.features?.length ?? 0,
      regionCount: latestDates.length,
      latestDates,
    });
    return latestDates;
  })();

  vegetationLatestDatesByRegionCache.set(cacheKey, request);
  while (vegetationLatestDatesByRegionCache.size > 4) {
    const oldestKey = vegetationLatestDatesByRegionCache.keys().next().value;
    if (!oldestKey) break;
    vegetationLatestDatesByRegionCache.delete(oldestKey);
  }
  try {
    return await request;
  } catch (error) {
    vegetationLatestDatesByRegionCache.delete(cacheKey);
    throw error;
  }
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
/** agri_vegetation_indices px_all comes from a 3m x 3m raster: 9 m² / 10,000. */
const VEG_PIXEL_AREA_HA = 0.0009;
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
    clauses.push(`region='${escapeAgriVeg(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeAgriVeg(String(params.district))}'`);
  }
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    clauses.push(`crop_id='${escapeAgriVeg(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    clauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeAgriVeg(value)}'`)
        .join(",")})`,
    );
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
      query.num = VEG_STATUS_ROW_PAGE_SIZE;
      query.resultRecordCount = VEG_STATUS_ROW_PAGE_SIZE;

      const result = await layer.queryFeatures(query);
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
      if (features.length < VEG_STATUS_ROW_PAGE_SIZE) break;
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
        query.num = VEG_STATUS_ROW_PAGE_SIZE;
        query.resultRecordCount = VEG_STATUS_ROW_PAGE_SIZE;

        const result = await layer.queryFeatures(query);
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
        if (features.length < VEG_STATUS_ROW_PAGE_SIZE) break;
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
    vegetationAssignedUniqueIdsCache.set(cacheKey, assignedIdsByStatus);

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
  try {
    return await request;
  } catch (error) {
    vegetationStatusCountsCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Kill-switch for republic VH overview. When false, Localization always uses
 * the exact uniqueid majority-vote pager (legacy ~700 queries on startup).
 */
export const REPUBLIC_VH_USE_STATUS_STATS = true;

const vegetationStatusStatsCache = new Map<
  string,
  Promise<VegetationStatusCount[]>
>();

function buildVegetationStatusWhere(
  params: VegetationStatusCountsParams,
): string {
  const clauses: string[] = [dateEqualsClause("raster_date", params.date)];
  if (params.region != null) {
    clauses.push(`region='${escapeAgriVeg(String(params.region))}'`);
  }
  if (params.district != null) {
    clauses.push(`district='${escapeAgriVeg(String(params.district))}'`);
  }
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    clauses.push(`crop_id='${escapeAgriVeg(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    clauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeAgriVeg(value)}'`)
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

  const { layer } = await getAgriVegetationIndicesLayer();
  const where = buildVegetationStatusWhere(params);
  const oidField = String(layer.objectIdField || "objectid");
  const cacheKey = `status-stats|${where}|oid=${oidField}`;
  const cached = vegetationStatusStatsCache.get(cacheKey);
  if (cached) return cached;

  const request = (async (): Promise<VegetationStatusCount[]> => {
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

    const result = await layer.queryFeatures(query);
    const readAttribute = (
      attributes: Record<string, unknown>,
      field: string,
    ): unknown =>
      attributes?.[field] ??
      attributes?.[field.toLowerCase()] ??
      attributes?.[field.toUpperCase()];

    const rows: VegetationStatusCount[] = [];
    for (const feature of result?.features ?? []) {
      const attributes = (feature?.attributes || {}) as Record<string, unknown>;
      const status = String(readAttribute(attributes, "ndvi_status") || "")
        .trim()
        .toLowerCase();
      if (!status) continue;
      const count = Math.max(0, Number(readAttribute(attributes, "row_count")) || 0);
      const pxAll = Math.max(0, Number(readAttribute(attributes, "sum_px_all")) || 0);
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
  })();

  vegetationStatusStatsCache.set(cacheKey, request);
  while (vegetationStatusStatsCache.size > 64) {
    const oldestKey = vegetationStatusStatsCache.keys().next().value;
    if (!oldestKey) break;
    vegetationStatusStatsCache.delete(oldestKey);
  }
  try {
    return await request;
  } catch (error) {
    vegetationStatusStatsCache.delete(cacheKey);
    throw error;
  }
}

export interface VegetationUniqueIdsForStatusParams
  extends VegetationStatusCountsParams {
  /** ndvi_status value, e.g. "past" | "orta" | "yaxshi" | "juda_yaxshi" */
  ndviStatus: string;
}

const VEG_UNIQUEID_PAGE_SIZE = 2000;
const VEG_UNIQUEID_MAX_PAGES = 50; // up to ~100k ids

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
    scopeClauses.push(`region='${escapeAgriVeg(String(params.region))}'`);
  }
  if (params.district != null) {
    scopeClauses.push(`district='${escapeAgriVeg(String(params.district))}'`);
  }
  const requestedCropIds = Array.from(
    new Set(
      [...(params.cropIds || []), ...(params.cropId ? [params.cropId] : [])]
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
  if (requestedCropIds.length === 1) {
    scopeClauses.push(`crop_id='${escapeAgriVeg(requestedCropIds[0])}'`);
  } else if (requestedCropIds.length > 1) {
    scopeClauses.push(
      `crop_id IN (${requestedCropIds
        .map((value) => `'${escapeAgriVeg(value)}'`)
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
    `ndvi_status='${escapeAgriVeg(status)}'`,
  ];
  const baseWhere = baseClauses.join(" AND ");

  const ids = new Set<string>();
  const oidField = String(layer.objectIdField || "objectid");
  let lastOid = -1;
  let pagesFetched = 0;
  let truncated = false;
  let expectedCount: number | null = null;

  agriVegetationLog("uniqueids-for-status:start", {
    where: baseWhere,
    status,
    date: params.date,
    region: params.region ?? null,
    district: params.district ?? null,
    oidField,
  });

  try {
    const countQuery = layer.createQuery();
    countQuery.where = baseWhere;
    expectedCount = await layer.queryFeatureCount(countQuery);
  } catch {
    expectedCount = null;
  }

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

  for (let page = 0; page < VEG_UNIQUEID_MAX_PAGES; page++) {
    const where =
      lastOid < 0
        ? baseWhere
        : `(${baseWhere}) AND ${oidField} > ${lastOid}`;
    const query = layer.createQuery();
    query.where = where;
    query.outFields = [uniqueIdField, oidField];
    query.returnGeometry = false;
    query.orderByFields = [`${oidField} ASC`];
    (query as any).resultRecordCount = VEG_UNIQUEID_PAGE_SIZE;
    // Do not rely on resultOffset — cursor paging above is the source of truth.

    const result = await layer.queryFeatures(query);
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

    if (features.length < VEG_UNIQUEID_PAGE_SIZE) break;
    if (newIds === 0) {
      truncated = true;
      break;
    }
    if (page === VEG_UNIQUEID_MAX_PAGES - 1) truncated = true;
  }

  if (
    expectedCount != null &&
    Number.isFinite(expectedCount) &&
    ids.size < expectedCount &&
    truncated
  ) {
    // Keep truncated=true; expectedCount confirms we stopped short.
  } else if (
    expectedCount != null &&
    Number.isFinite(expectedCount) &&
    ids.size < expectedCount &&
    pagesFetched > 0
  ) {
    // Feature count can exceed distinct uniqueids (dup rows). Only warn.
    agriVegetationLog("uniqueids-for-status:count-gap", {
      status,
      date: params.date,
      uniqueIdCount: ids.size,
      expectedCount,
      pagesFetched,
    });
  }

  agriVegetationLog("uniqueids-for-status:done", {
    status,
    date: params.date,
    count: ids.size,
    expectedCount,
    pagesFetched,
    truncated,
  });

  return Array.from(ids);
}

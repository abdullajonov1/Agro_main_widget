/**
 * Central stats cache/orchestrator for Agro_widgetV5.
 *
 * Goal:
 * - avoid repeating identical ArcGIS `queryFeatures` groupBy/outStatistics work
 * - share in-flight promises so concurrent widgets don't spike
 * - persist resolved aggregates for 1 hour across page refresh
 *
 * Note:
 * - This module does NOT rebuild widget-specific WHERE logic.
 *   Widgets provide `where` and the needed group/stat fields.
 */

import { dedupedQueryFeatures } from "./agri-query-gateway";
import { withStatsQuerySlot } from "./agri-query-scheduler";
import type { DedupedLayerQuerySpec } from "./agri-query-gateway";
import {
  AGRI_PERSIST_TTL_MS,
  clearAgriPersistentNamespace,
  getAgriPersistentCache,
  setAgriPersistentCache,
} from "./agri-persistent-cache";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const STATS_CACHE_TTL_MS = AGRI_PERSIST_TTL_MS;
const PERSIST_NS = "stats";

const cache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

function now(): number {
  return Date.now();
}

function layerUrl(layer: any): string {
  return String(layer?.url || layer?.layer?.url || "").trim();
}

/** Service field name matching `name` case-insensitively, "" when absent. */
function findLayerFieldName(layer: any, name: string): string {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return "";
  const fields: any[] = Array.isArray(layer?.fields) ? layer.fields : [];
  if (!fields.length) return "";
  for (const field of fields) {
    const fieldName = String(field?.name || "");
    if (fieldName.toLowerCase() === wanted) return fieldName;
  }
  return "";
}

function stableKey(parts: Array<unknown>): string {
  return parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join("|");
}

function getCached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit) {
    if (hit.expiresAt <= now()) {
      cache.delete(key);
    } else {
      return hit.value as T;
    }
  }
  const persisted = getAgriPersistentCache<T>(PERSIST_NS, key);
  if (persisted == null) return null;
  cache.set(key, { expiresAt: now() + STATS_CACHE_TTL_MS, value: persisted });
  return persisted;
}

function setCached<T>(key: string, value: T): void {
  cache.set(key, { expiresAt: now() + STATS_CACHE_TTL_MS, value });
  setAgriPersistentCache(PERSIST_NS, key, value, STATS_CACHE_TTL_MS);
}

async function getGroupedFeaturesCached(
  layer: __esri.FeatureLayer,
  spec: Omit<DedupedLayerQuerySpec, "returnGeometry"> & {
    returnGeometry?: boolean;
  },
  keyParts: Array<unknown>,
): Promise<any[]> {
  const url = layerUrl(layer);
  const key = stableKey([url, ...keyParts]);

  const cached = getCached<any[]>(key);
  if (cached) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<any[]>;

  const promise = withStatsQuerySlot(async () => {
    const res = await dedupedQueryFeatures(layer, {
      ...(spec as any),
      returnGeometry: spec.returnGeometry ?? false,
    });
    const feats = res?.features ?? [];
    setCached(key, feats);
    return feats;
  }).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

export type PieCategoryStatRow = { key: string; value: number };

export async function getPieCategoryStatsCached(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  categoryField: string;
  areaField?: string | null;
  objectIdField?: string;
}): Promise<PieCategoryStatRow[]> {
  const { layer, where, categoryField } = opts;
  const areaField = opts.areaField ? String(opts.areaField) : "";
  const objectIdField = opts.objectIdField || "OBJECTID";

  const outStats = areaField
    ? [
        {
          statisticType: "sum",
          onStatisticField: areaField,
          outStatisticFieldName: "agg",
        },
      ]
    : [
        {
          statisticType: "count",
          onStatisticField: objectIdField,
          outStatisticFieldName: "agg",
        },
      ];

  const feats = await getGroupedFeaturesCached(
    layer,
    {
      where,
      outFields: [categoryField],
      groupByFieldsForStatistics: [categoryField],
      outStatistics: outStats,
      returnGeometry: false,
    },
    [
      where,
      categoryField.toLowerCase(),
      areaField
        ? `sum:${areaField.toLowerCase()}`
        : `count:${objectIdField.toLowerCase()}`,
      outStats,
    ],
  );

  return feats
    .map((f: any) => ({
      key: f?.attributes?.[categoryField],
      value: Number(f?.attributes?.agg ?? 0),
    }))
    .filter((r: PieCategoryStatRow) => r.key && r.value > 0);
}

export async function getRegionGroupFeaturesCached(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  groupField: string;
  /**
   * Numeric code field (`region` / `district`) grouped together with the name
   * so callers can key bars by code instead of spelling. Omit for name-only.
   */
  codeField?: string | null;
  statMode: "sum" | "count";
  areaField?: string | null;
  objectIdField?: string;
}): Promise<any[]> {
  const { layer, where, groupField, statMode } = opts;
  const objectIdField = opts.objectIdField || layer.objectIdField || "OBJECTID";
  const areaField = opts.areaField ? String(opts.areaField) : "";
  const codeField = String(opts.codeField || "").trim();

  const useSum = statMode === "sum" && !!areaField;
  const outName = useSum ? "sum_m" : "cnt_m";
  const outStats = [
    {
      statisticType: useSum ? "sum" : "count",
      onStatisticField: useSum ? areaField : objectIdField,
      outStatisticFieldName: outName,
    },
  ];
  // Grouping by a field the service does not expose fails the whole statistics
  // query, so fall back to name-only grouping when the code field is missing.
  const resolvedCodeField =
    codeField && codeField.toLowerCase() !== groupField.toLowerCase()
      ? findLayerFieldName(layer, codeField)
      : "";
  const groupFields = resolvedCodeField
    ? [groupField, resolvedCodeField]
    : [groupField];

  return getGroupedFeaturesCached(
    layer,
    {
      where,
      groupByFieldsForStatistics: groupFields,
      outStatistics: outStats,
      orderByFields: [`${outName} DESC`],
      returnGeometry: false,
    },
    [
      where,
      groupFields.map((f) => f.toLowerCase()).join(","),
      useSum
        ? `sum:${areaField.toLowerCase()}`
        : `count:${objectIdField.toLowerCase()}`,
      outStats,
    ],
  );
}

/** Single outStatistic (sum/count/avg…) with cache + query slot.
 * Returns null when the service returns no aggregate attribute (no matching rows).
 */
export async function getOutStatisticCachedNullable(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  statisticType: "sum" | "count" | "avg" | "min" | "max";
  onStatisticField: string;
  outStatisticFieldName?: string;
}): Promise<number | null> {
  const outName = opts.outStatisticFieldName || "agg";
  const outStats = [
    {
      statisticType: opts.statisticType,
      onStatisticField: opts.onStatisticField,
      outStatisticFieldName: outName,
    },
  ];

  const feats = await getGroupedFeaturesCached(
    opts.layer,
    {
      where: opts.where || "1=1",
      outStatistics: outStats,
      returnGeometry: false,
    },
    [
      opts.where || "1=1",
      `${opts.statisticType}:${String(opts.onStatisticField).toLowerCase()}`,
      outStats,
    ],
  );

  const rawAgg = feats?.[0]?.attributes?.[outName];
  if (rawAgg == null || rawAgg === "") return null;
  const n = Number(rawAgg);
  return Number.isFinite(n) ? n : null;
}

/** Same as nullable, but maps missing aggregate → 0 (dashboard sum defaults). */
export async function getOutStatisticCached(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  statisticType: "sum" | "count" | "avg" | "min" | "max";
  onStatisticField: string;
  outStatisticFieldName?: string;
}): Promise<number> {
  return (await getOutStatisticCachedNullable(opts)) ?? 0;
}

export function clearAgriStatsStoreCache(): void {
  cache.clear();
  inFlight.clear();
  clearAgriPersistentNamespace(PERSIST_NS);
}

/** VH bar chart — cached vegetation status counts (Bar panel via Localization). */
export {
  queryVegetationStatusCounts as getVhBarStatusCountsCached,
  queryVegetationStatusCountsByStatus as getVhBarStatusCountsByStatusCached,
  queryVegetationStatusCountsByRegionScopes as getVhBarStatusCountsByRegionScopesCached,
} from "../gis/agri-vegetation-data-source";

/** Graff index chart — cached regional / polygon vegetation series. */
export {
  queryVegetationRegionalTimeseries as getGraffRegionalTimeseriesCached,
  queryVegetationSeriesForUniqueId as getGraffPolygonSeriesCached,
} from "../gis/agri-vegetation-data-source";


/**
 * Shared Graff regional timeseries helpers.
 * Used by dashboard controller (DashboardPack prefetch) and GraffPanel fallback.
 */

import { getTuriCropLookupKey } from "../shared/agri-crop-labels";
import type {
  AgriRegionDistrictMappingRow,
  AgriTuriCropMappingRow,
} from "../gis/agri-table-data-source";
import { getGraffRegionalTimeseriesCached } from "./agri-stats-store";
import { makeRegionDistrictKey } from "../filter/localization/geo-keys";
import { VH_TO_NDVI_STATUS } from "../filter/localization/vh-constants";

export type GraffRegionalTimeseriesRow = {
  date: string;
  ndvi: number;
  ndvi_min: number;
  ndvi_max: number;
  savi: number;
  savi_min: number;
  savi_max: number;
  rvi: number;
  rvi_min: number;
  rvi_max: number;
  ci: number;
  ci_min: number;
  ci_max: number;
  evi: number;
  ndwi: number;
  ndwi_min: number;
  ndwi_max: number;
  polygon_count: number;
  [key: string]: any;
};

/** Merge per-crop regional timeseries groups (exact GraffPanel algorithm). */
export function mergeRegionalTimeseriesGroups(
  groups: GraffRegionalTimeseriesRow[][],
): GraffRegionalTimeseriesRow[] {
  const averageFields = ["ndvi", "savi", "rvi", "ci", "evi", "ndwi"] as const;
  const rangeFields = ["ndvi", "savi", "rvi", "ci", "ndwi"] as const;
  const buckets = new Map<string, any>();

  for (const row of groups.flat()) {
    const rawValue: unknown = row.date;
    const rawDate = String(rawValue ?? "").trim();
    let parsedDate: Date;
    if (typeof rawValue === "number" || /^\d{10,13}$/.test(rawDate)) {
      const epoch = Number(rawValue);
      parsedDate = new Date(rawDate.length === 10 ? epoch * 1000 : epoch);
    } else {
      parsedDate = new Date(rawDate);
    }
    if (Number.isNaN(parsedDate.getTime())) continue;
    const date = parsedDate.toISOString().slice(0, 10);
    if (!date) continue;
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = {
        ...row,
        date,
        polygon_count: 0,
        __fieldWeights: {} as Record<string, number>,
      };
      averageFields.forEach((field) => {
        bucket[field] = 0;
        bucket.__fieldWeights[field] = 0;
      });
      rangeFields.forEach((field) => {
        bucket[`${field}_min`] = Number.POSITIVE_INFINITY;
        bucket[`${field}_max`] = Number.NEGATIVE_INFINITY;
      });
      buckets.set(date, bucket);
    }

    const polygonCount = Math.max(0, Number(row.polygon_count) || 0);
    const weight = polygonCount || 1;
    bucket.polygon_count += polygonCount;
    averageFields.forEach((field) => {
      const raw = row[field];
      const value = raw == null ? Number.NaN : Number(raw);
      if (!Number.isFinite(value)) return;
      bucket[field] += value * weight;
      bucket.__fieldWeights[field] += weight;
    });
    rangeFields.forEach((field) => {
      const minRaw = row[`${field}_min`];
      const maxRaw = row[`${field}_max`];
      const minValue = minRaw == null ? Number.NaN : Number(minRaw);
      const maxValue = maxRaw == null ? Number.NaN : Number(maxRaw);
      if (Number.isFinite(minValue)) {
        bucket[`${field}_min`] = Math.min(bucket[`${field}_min`], minValue);
      }
      if (Number.isFinite(maxValue)) {
        bucket[`${field}_max`] = Math.max(bucket[`${field}_max`], maxValue);
      }
    });
  }

  return Array.from(buckets.values()).map((bucket) => {
    averageFields.forEach((field) => {
      const fieldWeight = Number(bucket.__fieldWeights[field]) || 0;
      bucket[field] = fieldWeight ? bucket[field] / fieldWeight : null;
    });
    rangeFields.forEach((field) => {
      if (!Number.isFinite(bucket[`${field}_min`])) bucket[`${field}_min`] = 0;
      if (!Number.isFinite(bucket[`${field}_max`])) bucket[`${field}_max`] = 0;
    });
    delete bucket.__fieldWeights;
    return bucket as GraffRegionalTimeseriesRow;
  });
}

export function buildGraffRegionalScopeKey(opts: {
  region: number | null;
  district: number | null;
  cropIds: string[];
  startDate: string;
  endDate: string;
  vh?: string;
}): string {
  const vh = String(opts.vh || "").trim();
  return JSON.stringify({
    region: opts.region,
    district: opts.district,
    cropIds: opts.cropIds.slice().sort(),
    startDate: opts.startDate || null,
    endDate: opts.endDate || null,
    vh: vh || null,
    ndviStatus: vh ? VH_TO_NDVI_STATUS[vh] || null : null,
  });
}

/**
 * Polygon vegetation series scope (panel-owned).
 * Not used by controller prefetch — uniqueid is outside DashboardFilterSlice.
 */
export function buildGraffPolygonSeriesScopeKey(opts: {
  uniqueid: string;
  regionId?: number | null;
  year?: number | null;
}): string {
  return JSON.stringify({
    uniqueid: String(opts.uniqueid || "").replace(/[{}]/g, ""),
    regionId:
      opts.regionId != null && Number.isFinite(opts.regionId)
        ? opts.regionId
        : null,
    year:
      opts.year != null && Number.isFinite(opts.year) ? opts.year : null,
  });
}

/**
 * Missing-raster / TIFF overlay cache key (exact GraffPanel format).
 */
export function buildGraffPolygonRasterCacheKey(opts: {
  uniqueid: string;
  regionId: number;
  rasterDate: string;
  indiceType: string;
}): string {
  const cleanId = String(opts.uniqueid || "").replace(/[{}]/g, "");
  return `${cleanId}|${opts.regionId}|${opts.rasterDate}|${opts.indiceType}`;
}

export function buildViloyatToRegionMap(
  rows: AgriRegionDistrictMappingRow[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows || []) {
    const key = makeRegionDistrictKey(row.viloyat);
    if (key && map[key] == null && Number.isFinite(row.region)) {
      map[key] = row.region;
    }
  }
  return map;
}

export function buildTumanToDistrictMap(
  rows: AgriRegionDistrictMappingRow[],
): Record<string, number> {
  const map: Record<string, number> = {};
  const votes: Record<string, number> = {};
  for (const row of rows || []) {
    const key = makeRegionDistrictKey(row.tuman);
    if (!key || !Number.isFinite(row.district)) continue;
    const vote =
      row.count != null && Number.isFinite(row.count) && row.count > 0
        ? Number(row.count)
        : 1;
    if (map[key] == null || vote > (votes[key] || 0)) {
      map[key] = row.district;
      votes[key] = vote;
    }
  }
  return map;
}

export function buildTuriToCropIdMap(
  rows: AgriTuriCropMappingRow[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows || []) {
    const key = getTuriCropLookupKey(row.turi);
    if (key && !map[key] && row.cropId) map[key] = String(row.cropId);
  }
  return map;
}

export function resolveGraffCropIds(
  turlar: string[],
  turi: string,
  turiToCropId: Record<string, string>,
): { cropIds: string[]; unresolved: string[] } {
  const selected = turlar.length ? turlar : turi ? [turi] : [];
  const resolved = selected.map((crop) => {
    const key = getTuriCropLookupKey(crop);
    return key ? turiToCropId[key] : undefined;
  });
  const unresolved = selected.filter((_c, i) => !resolved[i]);
  const cropIds = Array.from(
    new Set(resolved.filter((v): v is string => Boolean(v))),
  );
  return { cropIds, unresolved };
}

export function resolveGraffDistrictNumber(
  viloyat: string,
  tuman: string,
  rows: AgriRegionDistrictMappingRow[],
  viloyatToRegion: Record<string, number>,
): number | undefined {
  const tKey = makeRegionDistrictKey(tuman);
  if (!tKey) return undefined;
  const vKey = makeRegionDistrictKey(viloyat);
  if (vKey) {
    const region = viloyatToRegion[vKey];
    for (const row of rows || []) {
      if (
        makeRegionDistrictKey(row.tuman) === tKey &&
        makeRegionDistrictKey(row.viloyat) === vKey &&
        Number.isFinite(row.district)
      ) {
        return row.district;
      }
    }
    if (region != null) {
      for (const row of rows || []) {
        if (
          makeRegionDistrictKey(row.tuman) === tKey &&
          Number(row.region) === Number(region) &&
          Number.isFinite(row.district)
        ) {
          return row.district;
        }
      }
    }
  }
  for (const row of rows || []) {
    if (
      makeRegionDistrictKey(row.tuman) === tKey &&
      Number.isFinite(row.district)
    ) {
      return row.district;
    }
  }
  return undefined;
}

/**
 * Multi-crop regional timeseries + merge (Graff fetchRegionalTimeseries core).
 */
export async function queryGraffRegionalTimeseriesMerged(opts: {
  region?: number;
  district?: number;
  cropIds: string[];
  startDate: string;
  endDate: string;
  ndviStatus?: string;
  avgFields?: string[];
}): Promise<GraffRegionalTimeseriesRow[]> {
  const queryCropIds: Array<string | undefined> = opts.cropIds.length
    ? opts.cropIds
    : [undefined];
  const groups = await Promise.all(
    queryCropIds.map(
      (cropId) =>
        getGraffRegionalTimeseriesCached({
          region: opts.region,
          district: opts.district,
          cropId,
          startDate: opts.startDate,
          endDate: opts.endDate,
          ndviStatus: opts.ndviStatus,
          avgFields: opts.avgFields,
        }) as Promise<GraffRegionalTimeseriesRow[]>,
    ),
  );
  return mergeRegionalTimeseriesGroups(groups);
}

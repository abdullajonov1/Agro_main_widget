/**
 * VH bar compute pipeline — ndvi_status by raster_date.
 * LocalizationPanel supplies deps; this module has no React class state.
 */

import type { ChartFilterFlags } from "../../gis/agri-chart-filter-order";
import {
  queryVegetationAvailableDates,
  queryVegetationDistinctRegions,
  queryVegetationLatestDatesByRegion,
  queryVegetationMaxRasterDate,
  REPUBLIC_VH_USE_STATUS_STATS,
  REGION_VH_BAR_USE_STATUS_STATS,
} from "../../gis/agri-vegetation-data-source";
import {
  getVhBarStatusCountsByRegionScopesCached,
  getVhBarStatusCountsByStatusCached,
  getVhBarStatusCountsCached,
} from "../../data/agri-stats-store";
import {
  aggregateVhServiceRows,
  buildEmptyVhBarData,
  type VhServiceStatusRow,
} from "./vh-bar-aggregate";
import type { VHBarData } from "./vh-constants";

/** Same cap as LocalizationPanel uniqueid date walk — avoid year-long empty probes. */
const MAX_VH_BAR_DATE_WALK = 8;

export type VhBarComputeStateSlice = {
  viloyat: string;
  lockedViloyat: string | null;
  tuman: string;
  yil: string;
  ndviDate?: string;
  ndviDateLocked?: boolean;
};

export type VhBarComputeDeps = {
  state: VhBarComputeStateSlice;
  isMounted: () => boolean;
  viloyatToRegion: Record<string, number>;
  tumanToDistrict: Record<string, number>;
  normalizeApos: (s: string) => string;
  makeRegionDistrictKey: (raw: string | null | undefined) => string;
  getChartFilterFlags: () => ChartFilterFlags;
  getSelectedTurlar: () => string[];
  resolveCropIdForTuri: (turi: string) => string | null | undefined;
  getVhBarUsedDate: () => string | null;
  setVhBarUsedDate: (date: string | null) => void;
  setState: (patch: any) => void;
  prefetchVhStatusUniqueIds: (date: string) => void;
  log: (phase: string, detail?: any) => void;
  /** Header STIR selection — uniqueids of that farmer's parcels. */
  farmerUniqueIds?: string[] | null;
};

export async function executeVhBarCompute(
  deps: VhBarComputeDeps,
): Promise<VHBarData | null> {
  const zeroResult: VHBarData = buildEmptyVhBarData();

  const { viloyat, lockedViloyat, tuman, yil } = deps.state;
  const rawViloyat = (lockedViloyat ?? viloyat ?? "").toString();
  const effectiveViloyat = deps.normalizeApos(rawViloyat);
  const regionKey = deps.makeRegionDistrictKey(rawViloyat);
  const regionNum = effectiveViloyat
    ? /^\d+$/.test(effectiveViloyat)
      ? Number(effectiveViloyat)
      : regionKey
        ? deps.viloyatToRegion[regionKey]
        : undefined
    : undefined;
  if (
    effectiveViloyat &&
    (regionNum === undefined || !Number.isFinite(regionNum))
  ) {
    return zeroResult;
  }

  const rawTuman = (tuman ?? "").toString();
  const effectiveTuman = effectiveViloyat
    ? deps.normalizeApos(rawTuman)
    : "";
  let districtNum: number | undefined;
  if (effectiveTuman) {
    districtNum = /^\d+$/.test(effectiveTuman)
      ? Number(effectiveTuman)
      : undefined;
    if (districtNum === undefined) {
      const tumanKey = deps.makeRegionDistrictKey(rawTuman);
      const regionKey = deps.makeRegionDistrictKey(rawViloyat);
      const lookupKeys: string[] = [];
      if (regionNum != null && Number.isFinite(regionNum) && tumanKey) {
        lookupKeys.push(`region:${regionNum}|${tumanKey}`);
      }
      if (regionKey && tumanKey) {
        lookupKeys.push(`viloyat:${regionKey}|${tumanKey}`);
      }
      if (tumanKey) lookupKeys.push(tumanKey);
      for (const key of lookupKeys) {
        const mapped = deps.tumanToDistrict[key];
        if (mapped !== undefined && Number.isFinite(mapped)) {
          districtNum = mapped;
          break;
        }
      }
    }
    if (!Number.isFinite(districtNum as number)) districtNum = undefined;
  }
  if (effectiveTuman && districtNum === undefined) return zeroResult;

  const chartFlags = deps.getChartFilterFlags();
  const selectedTurlar = chartFlags.filterVhBarByCrop
    ? deps.getSelectedTurlar()
    : [];
  const cropIds = chartFlags.filterVhBarByCrop
    ? Array.from(
        new Set(
          selectedTurlar
            .map((turi) => deps.resolveCropIdForTuri(turi))
            .filter((value): value is string => Boolean(value)),
        ),
      )
    : [];
  if (selectedTurlar.length > 0 && cropIds.length !== selectedTurlar.length) {
    return zeroResult;
  }

  const cropFilter = cropIds.length ? cropIds : undefined;
  const selectedYear =
    String(yil || "").match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
  if (!selectedYear) return zeroResult;

  const farmerUniqueIds = Array.from(
    new Set(
      (deps.farmerUniqueIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  // STIR selected but no parcels resolved → empty VH bar.
  if (
    Array.isArray(deps.farmerUniqueIds) &&
    deps.farmerUniqueIds.length === 0
  ) {
    return zeroResult;
  }
  const farmerFilter = farmerUniqueIds.length ? farmerUniqueIds : undefined;

  const forcedNdvi = (deps.state.ndviDate || "").trim();

  // --- Republic: sum per-viloyat status buckets (no nation-wide uniqueid page) ---
  // Farmer STIR selection always needs a viloyat (Localization sets it from
  // the search row); skip the republic aggregate when farmerFilter is set.
  if (!effectiveViloyat && !farmerFilter) {
    try {
      let regionScopes: Array<{ region: number; date: string }> = [];
      if (deps.state.ndviDateLocked && forcedNdvi) {
        // Locked calendar day: every viloyat on that same raster_date.
        const regions = await queryVegetationDistinctRegions({
          year: selectedYear,
        });
        regionScopes = regions.map((region) => ({
          region,
          date: forcedNdvi,
        }));
      } else {
        // Unlocked: each viloyat's own latest date in the year.
        regionScopes = await queryVegetationLatestDatesByRegion({
          year: selectedYear,
        });
      }
      if (!deps.isMounted()) return null;
      if (!regionScopes.length) {
        deps.setVhBarUsedDate(null);
        return zeroResult;
      }

      let rows: VhServiceStatusRow[] = [];
      if (REPUBLIC_VH_USE_STATUS_STATS) {
        try {
          rows = await getVhBarStatusCountsByRegionScopesCached(
            regionScopes,
            cropFilter,
          );
          if (!rows.length) {
            const exactGroups = await Promise.all(
              regionScopes.map((scope) =>
                getVhBarStatusCountsCached({
                  region: scope.region,
                  date: scope.date,
                  cropIds: cropFilter,
                }),
              ),
            );
            rows = exactGroups.flat();
          }
        } catch {
          const exactGroups = await Promise.all(
            regionScopes.map((scope) =>
              getVhBarStatusCountsCached({
                region: scope.region,
                date: scope.date,
                cropIds: cropFilter,
              }),
            ),
          );
          rows = exactGroups.flat();
        }
      } else {
        const exactGroups = await Promise.all(
          regionScopes.map((scope) =>
            getVhBarStatusCountsCached({
              region: scope.region,
              date: scope.date,
              cropIds: cropFilter,
            }),
          ),
        );
        rows = exactGroups.flat();
      }

      if (!deps.isMounted()) return null;
      const result = aggregateVhServiceRows(rows);
      const usedWindowEnd = regionScopes.reduce(
        (max, scope) => (!max || scope.date > max ? scope.date : max),
        "" as string,
      );
      deps.setVhBarUsedDate(usedWindowEnd || null);
      deps.log("computeVhBarData:republic-result", {
        year: selectedYear,
        regionCount: regionScopes.length,
        regionScopes,
        lockedDate: deps.state.ndviDateLocked ? forcedNdvi || null : null,
        totalAreaHa: result.totalCount,
        categories: result.categories.map((category) => ({
          category: category.category,
          areaHa: category.count,
          fieldCount: category.fieldCount,
        })),
      });
      return result;
    } catch (error: any) {
      deps.log("computeVhBarData:republic-failed", {
        error: String(error?.message || error),
      });
      return null;
    }
  }

  // --- Viloyat / tuman: prefer MAX(date) + capped walk; status-stats when gated ---
  let candidates: string[];
  if (deps.state.ndviDateLocked && forcedNdvi) {
    candidates = [forcedNdvi];
  } else {
    const maxDatePromise = queryVegetationMaxRasterDate({
      region: regionNum,
      district: districtNum,
      year: selectedYear,
      cropId: cropFilter?.length === 1 ? cropFilter[0] : undefined,
    }).catch(() => null as string | null);

    const datesPromise = queryVegetationAvailableDates({
      region: regionNum,
      district: districtNum,
    }).catch(() => [] as string[]);

    const [maxDate, knownDatesRaw] = await Promise.all([
      maxDatePromise,
      datesPromise,
    ]);
    if (!deps.isMounted()) return null;

    let knownDates = (knownDatesRaw || []).filter((date) =>
      String(date).startsWith(`${selectedYear}-`),
    );
    if (deps.isMounted() && knownDates.length) {
      deps.setState({ ndviDateOptions: knownDates });
    }

    const newestFirst = knownDates.slice().reverse();
    const ordered: string[] = [];
    const pushUnique = (d: string | null | undefined) => {
      const v = String(d || "").trim();
      if (!v || ordered.includes(v)) return;
      ordered.push(v);
    };
    // MAX(raster_date) first — one RT that usually has rows; then newest known.
    pushUnique(maxDate);
    for (const d of newestFirst) pushUnique(d);

    if (!ordered.length) {
      deps.setVhBarUsedDate(null);
      return zeroResult;
    }
    candidates = ordered.slice(0, MAX_VH_BAR_DATE_WALK);
  }

  try {
    let bestResult: VHBarData | null = null;
    let usedDate: string | null = null;

    for (const ndviDate of candidates) {
      let rows: VhServiceStatusRow[] = [];
      // Farmer STIR: always use uniqueid-aware counts (status-stats has no ids).
      if (REGION_VH_BAR_USE_STATUS_STATS && !farmerFilter) {
        try {
          rows = await getVhBarStatusCountsByStatusCached({
            region: regionNum,
            district: districtNum,
            date: ndviDate,
            cropIds: cropFilter,
          });
        } catch {
          rows = [];
        }
      }
      if (!rows.length) {
        try {
          rows = await getVhBarStatusCountsCached({
            region: regionNum,
            district: districtNum,
            date: ndviDate,
            cropIds: cropFilter,
            uniqueIds: farmerFilter,
          });
        } catch {
          continue;
        }
      }
      if (!deps.isMounted()) return null;

      const aggregated = aggregateVhServiceRows(rows);
      if (aggregated.totalCount > 0) {
        bestResult = aggregated;
        usedDate = ndviDate;
        break;
      }
    }

    if (!bestResult) {
      deps.setVhBarUsedDate(null);
      return zeroResult;
    }

    deps.setVhBarUsedDate(usedDate);
    if (usedDate) {
      deps.prefetchVhStatusUniqueIds(usedDate);
      if (
        deps.isMounted() &&
        !deps.state.ndviDateLocked &&
        deps.state.ndviDate !== usedDate
      ) {
        deps.setState({ ndviDate: usedDate });
      }
    }

    deps.log("computeVhBarData:region-result", {
      year: selectedYear,
      region: regionNum ?? null,
      district: districtNum ?? null,
      usedDate,
      cropIds: cropFilter || null,
      statusStats: REGION_VH_BAR_USE_STATUS_STATS,
      totalAreaHa: bestResult.totalCount,
      categories: bestResult.categories.map((category) => ({
        category: category.category,
        areaHa: category.count,
        fieldCount: category.fieldCount,
      })),
    });

    return bestResult;
  } catch (error: any) {
    deps.log("computeVhBarData:region-failed", {
      error: String(error?.message || error),
    });
    return null;
  }
}

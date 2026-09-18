/**
 * Shared Indicator outStatistic helpers.
 * Used by dashboard controller (DashboardPack prefetch) and Indicator panels
 * so Pack prefetch and panel fallbacks share the same stats cache.
 */

import {
  getOutStatisticCached,
  getOutStatisticCachedNullable,
} from "./agri-stats-store";

export type IndicatorStatType = "sum" | "count" | "avg" | "min" | "max";

export async function queryIndicatorOutStat(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  statisticType: IndicatorStatType;
  onStatisticField: string;
  outStatisticFieldName?: string;
}): Promise<number> {
  return getOutStatisticCached({
    layer: opts.layer,
    where: opts.where || "1=1",
    statisticType: opts.statisticType,
    onStatisticField: opts.onStatisticField,
    outStatisticFieldName: opts.outStatisticFieldName || "agg",
  });
}

/**
 * Like queryIndicatorOutStat, but preserves "no matching rows" as null
 * (Yield / Unused / Reserve cards show "-" instead of 0).
 */
export async function queryIndicatorOutStatNullable(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  statisticType: IndicatorStatType;
  onStatisticField: string;
  outStatisticFieldName?: string;
}): Promise<number | null> {
  return getOutStatisticCachedNullable({
    layer: opts.layer,
    where: opts.where || "1=1",
    statisticType: opts.statisticType,
    onStatisticField: opts.onStatisticField,
    outStatisticFieldName: opts.outStatisticFieldName || "agg",
  });
}

/** Default dashboard indicator: sum(maydon), rounded. */
export async function queryIndicatorSumMaydon(opts: {
  layer: __esri.FeatureLayer;
  where: string;
}): Promise<number> {
  const value = await queryIndicatorOutStat({
    layer: opts.layer,
    where: opts.where || "1=1",
    statisticType: "sum",
    onStatisticField: "maydon",
  });
  return Number.isFinite(value) ? Math.round(value) : 0;
}

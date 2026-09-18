/**
 * Shared Region aggregate stats helpers.
 * Used by dashboard controller (DashboardPack prefetch) and RegionPanel fallback.
 */

import { getRegionGroupFeaturesCached } from "./agri-stats-store";
import type { DashboardRegionRow } from "../types/dashboard-pack";
import { makeRegionDistrictKey } from "../filter/localization/geo-keys";

export type RegionStatMode = "sum" | "count";

export function regionOutStatName(statMode: RegionStatMode): "sum_m" | "cnt_m" {
  return statMode === "sum" ? "sum_m" : "cnt_m";
}

export function regionSumByNameToSortedRows(
  sumByName: Record<string, number>,
): DashboardRegionRow[] {
  return Object.entries(sumByName)
    .map(([name, maydon]) => ({ name, maydon }))
    .sort((a, b) => b.maydon - a.maydon);
}

/** One bar: keyed by numeric geography code when the service returns one. */
type RegionGroupSlot = {
  /** Name shown on the bar / sent on click (the code's dominant spelling). */
  display: string;
  /** Area (or count) of the dominant spelling — decides `display`. */
  displayValue: number;
  value: number;
};

export type RegionGroupAccumulator = Record<string, RegionGroupSlot>;

/**
 * Fold ArcGIS groupBy rows onto bars keyed by the numeric geography code
 * (`region` / `district`) instead of the text name, falling back to the
 * normalized name when a row has no code.
 *
 * Keying by code is what makes the chart agree with the rest of the widget:
 * spelling variants of one district (Farg'ona / Fargona, with or without the
 * "tumani" suffix) collapse onto a single bar, and two different districts
 * that happen to share a name are no longer summed together.
 */
export function accumulateRegionGroupFeaturesByCode(
  feats: any[],
  opts: { groupField: string; codeField?: string | null; outName: string },
  into: RegionGroupAccumulator = {},
): RegionGroupAccumulator {
  const { groupField, codeField, outName } = opts;

  /** Services return attributes in their own casing (`district` / `District`). */
  const readAttr = (attrs: any, field: string): any => {
    if (attrs[field] !== undefined) return attrs[field];
    const wanted = field.toLowerCase();
    for (const key of Object.keys(attrs)) {
      if (key.toLowerCase() === wanted) return attrs[key];
    }
    return undefined;
  };

  for (const f of feats || []) {
    const attrs: any = f?.attributes || {};
    const rawName = readAttr(attrs, groupField);
    const value = Number(readAttr(attrs, outName) ?? 0);
    if (!rawName || !(value > 0)) continue;

    const name = String(rawName);
    const rawCode = codeField ? readAttr(attrs, codeField) : null;
    const codeNum =
      rawCode == null || String(rawCode).trim() === "" ? NaN : Number(rawCode);
    const key = Number.isFinite(codeNum)
      ? `code:${codeNum}`
      : `name:${makeRegionDistrictKey(name) || name}`;

    const slot = into[key];
    if (!slot) {
      into[key] = { display: name, displayValue: value, value };
      continue;
    }
    slot.value += value;
    // Keep the spelling that carries the most area — clicks send this name on.
    if (value > slot.displayValue) {
      slot.display = name;
      slot.displayValue = value;
    }
  }

  return into;
}

/** Accumulator → rows sorted by area desc, merging identical display names. */
export function regionAccumulatorToSortedRows(
  acc: RegionGroupAccumulator,
): DashboardRegionRow[] {
  const byDisplay: Record<string, number> = {};
  for (const slot of Object.values(acc)) {
    if (!(slot.value > 0)) continue;
    byDisplay[slot.display] = (byDisplay[slot.display] || 0) + slot.value;
  }
  return regionSumByNameToSortedRows(byDisplay);
}

export function attachRegionPercentages(
  rows: DashboardRegionRow[],
): { rows: DashboardRegionRow[]; totalArea: number } {
  const totalArea = rows.reduce((s, r) => s + (r.maydon || 0), 0);
  const withPct = rows.map((r) => ({
    ...r,
    percentage: totalArea ? (r.maydon / totalArea) * 100 : 0,
  }));
  return { rows: withPct, totalArea };
}

/**
 * Single-layer, single-WHERE region aggregate (no VH chunking).
 * Matches controller prefetch / Region non-VH fallback core.
 */
export async function queryRegionAggregateRows(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  groupField: string;
  /** Numeric code field grouped alongside the name (`region` / `district`). */
  codeField?: string | null;
  areaField?: string | null;
  objectIdField?: string;
}): Promise<{ rows: DashboardRegionRow[]; totalArea: number }> {
  const { layer, where, groupField } = opts;
  const areaField = opts.areaField ?? null;
  const statMode: RegionStatMode = areaField ? "sum" : "count";
  const outName = regionOutStatName(statMode);

  if (!layer?.loaded && typeof (layer as any)?.load === "function") {
    try {
      await (layer as any).load();
    } catch {
      /* query may still succeed */
    }
  }

  const feats = await getRegionGroupFeaturesCached({
    layer,
    where,
    groupField,
    codeField: opts.codeField ?? null,
    statMode,
    areaField,
    objectIdField: opts.objectIdField || layer.objectIdField || "OBJECTID",
  });

  const acc = accumulateRegionGroupFeaturesByCode(feats, {
    groupField,
    codeField: opts.codeField ?? null,
    outName,
  });
  return attachRegionPercentages(regionAccumulatorToSortedRows(acc));
}

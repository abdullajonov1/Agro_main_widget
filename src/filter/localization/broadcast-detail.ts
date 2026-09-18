/**
 * Pure helpers for LocalizationPanel.broadcastFilterState.
 * No React / map / network — only payload shaping + staleness checks.
 */

import type { ChartDim, ChartFilterFlags } from "../../gis/agri-chart-filter-order";
import { VH_TO_NDVI_STATUS } from "./vh-constants";
import { normalizeLocalizationApos } from "./geo-keys";

export type BroadcastGeoSnapshot = {
  yil: string;
  viloyat: string;
  tuman: string;
  turi: string;
  turlar: string;
  polygonMode: boolean;
  uniqueid: string;
  filterPieByVh: boolean;
  filterVhBarByCrop: boolean;
  chartDimOrder: string;
};

/** Dedupe + apostrophe-normalize crop type lists (Localization broadcast). */
export function normalizeTurlarList(
  raw: unknown,
  fallback = "",
): string[] {
  const source = Array.isArray(raw)
    ? raw
    : raw
      ? [raw]
      : fallback
        ? [fallback]
        : [];
  return Array.from(
    new Set(
      source
        .map((value) => normalizeLocalizationApos(String(value || "")))
        .filter(Boolean),
    ),
  );
}

/**
 * Map / Region VH uniqueid slices for the master filter event.
 * Huge ID arrays stay on the event; Pie still uses the chart-filter bridge.
 */
export function resolveVhUniqueidSlices(opts: {
  vh: string;
  tuman: string;
  vhMapUniqueIds: string[] | null | undefined;
  vhRegionChartUniqueIds: string[] | null | undefined;
}): {
  vhUniqueids: string[] | null;
  vhRegionChartUniqueids: string[] | null;
} {
  const { vh, tuman } = opts;
  const vhUniqueids: string[] | null =
    vh && Array.isArray(opts.vhMapUniqueIds)
      ? opts.vhMapUniqueIds.slice()
      : null;
  const vhRegionChartUniqueids: string[] | null = !vh
    ? null
    : Array.isArray(opts.vhRegionChartUniqueIds)
      ? opts.vhRegionChartUniqueIds.slice()
      : Array.isArray(opts.vhMapUniqueIds) && !String(tuman || "").trim()
        ? opts.vhMapUniqueIds.slice()
        : null;
  return { vhUniqueids, vhRegionChartUniqueids };
}

/** Bar category field/value derived from NDVI date + VH selection. */
export function buildBarCategoryBroadcast(opts: {
  polygonStatusPrefix?: string;
  effectiveNdviDate: string;
  vh: string;
}): {
  barCategoryField: string | null;
  barCategoryValue: string | null;
} {
  const prefix =
    (opts.polygonStatusPrefix || "status_").toString().trim() || "status_";
  const ndviDateStr = opts.effectiveNdviDate;
  const barCategoryField = ndviDateStr
    ? `${prefix}${ndviDateStr.replace(/-/g, "_")}`
    : null;
  const barCategoryValue =
    opts.vh && VH_TO_NDVI_STATUS[opts.vh]
      ? VH_TO_NDVI_STATUS[opts.vh]
      : null;
  return { barCategoryField, barCategoryValue };
}

export function buildBroadcastGeoSnapshot(opts: {
  yil: string;
  effectiveViloyat: string;
  tuman: string;
  turi: string;
  turlar: unknown;
  polygonMode: boolean;
  selectedGraffUniqueid?: string;
  chartFlags: ChartFilterFlags;
  chartDimOrder: ChartDim[];
}): BroadcastGeoSnapshot {
  const turlarNorm = normalizeTurlarList(opts.turlar, opts.turi);
  return {
    yil: String(opts.yil || ""),
    viloyat: String(opts.effectiveViloyat || ""),
    tuman: String(opts.tuman || ""),
    turi: String(opts.turi || ""),
    turlar: JSON.stringify(turlarNorm),
    polygonMode: Boolean(opts.polygonMode),
    uniqueid: opts.polygonMode
      ? String(opts.selectedGraffUniqueid || "")
      : "",
    filterPieByVh: opts.chartFlags.filterPieByVh,
    filterVhBarByCrop: opts.chartFlags.filterVhBarByCrop,
    chartDimOrder: opts.chartDimOrder.join(">"),
  };
}

export function isBroadcastGeoCurrent(
  snapshot: BroadcastGeoSnapshot,
  live: {
    yil: string;
    viloyat: string;
    tuman: string;
    turi: string;
    turlar: unknown;
    polygonMode: boolean;
    selectedGraffUniqueid?: string;
    chartFlags: ChartFilterFlags;
    chartDimOrder: ChartDim[];
  },
): boolean {
  return (
    snapshot.yil === String(live.yil || "") &&
    snapshot.viloyat === String(live.viloyat || "") &&
    snapshot.tuman === String(live.tuman || "") &&
    snapshot.turi === String(live.turi || "") &&
    snapshot.turlar ===
      JSON.stringify(normalizeTurlarList(live.turlar, live.turi)) &&
    snapshot.polygonMode === Boolean(live.polygonMode) &&
    snapshot.uniqueid ===
      (live.polygonMode
        ? String(live.selectedGraffUniqueid || "")
        : "") &&
    snapshot.filterPieByVh === live.chartFlags.filterPieByVh &&
    snapshot.filterVhBarByCrop === live.chartFlags.filterVhBarByCrop &&
    snapshot.chartDimOrder === live.chartDimOrder.join(">")
  );
}

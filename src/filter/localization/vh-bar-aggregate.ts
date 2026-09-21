/**
 * Pure VH bar aggregation helpers for LocalizationPanel.
 * No React / map / network — only row → VHBarData transforms.
 */

import {
  NDVI_STATUS_TO_VH,
  VH_CATEGORIES,
  type VHBarData,
  type VHBarDataItem,
} from "./vh-constants";
import { normalizeUniqueidKey } from "../../data/agri-uniqueid-sql";

export type VhServiceStatusRow = {
  ndvi_status: string;
  count: number;
  areaHa: number;
};

export type VhPolygonStatusRow = VhServiceStatusRow & {
  uniqueIds?: string[];
};

export type VhBarComputeKeyInput = {
  yil: string;
  viloyat: string;
  tuman: string;
  turlar: string[];
  ndviDate: string;
  ndviDateLocked: boolean;
  /** Kept for call-site compat; polygon focus does not change VH bar. */
  polygonMode: boolean;
  uniqueid: string;
  filterVhBarByCrop: boolean;
  /** Exact STIR filter from header search. */
  farmerInn?: string;
};

function normalizeNdviStatusKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function finalizeVhCategories(
  categoryAreaMap: Map<string, number>,
  categoryFieldCountMap: Map<string, number>,
): VHBarData {
  let totalCount = 0;
  const categories: VHBarDataItem[] = VH_CATEGORIES.map((definition) => {
    const count = categoryAreaMap.get(definition.value) || 0;
    totalCount += count;
    return {
      category: definition.value,
      label: definition.label,
      order: definition.order,
      color: definition.color,
      count,
      fieldCount: categoryFieldCountMap.get(definition.value) || 0,
      percentage: 0,
    };
  });
  categories.forEach((category) => {
    category.percentage =
      totalCount > 0 ? (category.count * 100) / totalCount : 0;
  });
  return { categories, totalCount };
}

/** Empty VH bar payload (all categories zero). */
export function buildEmptyVhBarData(): VHBarData {
  return {
    categories: VH_CATEGORIES.map((c) => ({
      category: c.value,
      label: c.label,
      order: c.order,
      color: c.color,
      count: 0,
      fieldCount: 0,
      percentage: 0,
    })),
    totalCount: 0,
  };
}

/**
 * Aggregate vegetation service rows. Each uniqueid is already assigned to one
 * status (max px_all vote), so summing does not double-count polygons.
 */
export function aggregateVhServiceRows(
  rows: VhServiceStatusRow[],
): VHBarData {
  const categoryAreaMap = new Map<string, number>();
  const categoryFieldCountMap = new Map<string, number>();
  for (const row of rows) {
    const category = NDVI_STATUS_TO_VH[normalizeNdviStatusKey(row.ndvi_status)];
    const area = Number(row.areaHa) || 0;
    const fieldCount = Number(row.count) || 0;
    if (!category || fieldCount <= 0 || area < 0) continue;
    categoryAreaMap.set(
      category,
      (categoryAreaMap.get(category) || 0) + area,
    );
    categoryFieldCountMap.set(
      category,
      (categoryFieldCountMap.get(category) || 0) + fieldCount,
    );
  }
  return finalizeVhCategories(categoryAreaMap, categoryFieldCountMap);
}

/**
 * Join vegetation status rows to polygon areas by uniqueid (deduped).
 * Kept for the table/polygon join path; Localization may call when that path
 * is active.
 */
export function aggregateVhRowsByPolygonArea(
  rows: VhPolygonStatusRow[],
  polygonAreas: Map<string, number>,
): VHBarData {
  const categoryAreaMap = new Map<string, number>();
  const categoryFieldCountMap = new Map<string, number>();
  const countedUniqueIds = new Set<string>();

  for (const row of rows) {
    const category = NDVI_STATUS_TO_VH[normalizeNdviStatusKey(row.ndvi_status)];
    if (!category) continue;

    for (const rawId of row.uniqueIds || []) {
      // Strip braces — vegetation GUIDs are often unbraced; Agri_table may
      // store {GUID}. Plain toLowerCase() made viloyat VH bars undercount.
      const uniqueId = normalizeUniqueidKey(rawId);
      if (!uniqueId || countedUniqueIds.has(uniqueId)) continue;
      const area = polygonAreas.get(uniqueId);
      if (area === undefined || !Number.isFinite(area) || area <= 0) continue;
      countedUniqueIds.add(uniqueId);
      categoryAreaMap.set(
        category,
        (categoryAreaMap.get(category) || 0) + area,
      );
      categoryFieldCountMap.set(
        category,
        (categoryFieldCountMap.get(category) || 0) + 1,
      );
    }
  }

  return finalizeVhCategories(categoryAreaMap, categoryFieldCountMap);
}

/** Stable memo/single-flight key for VH bar compute. */
export function buildVhBarComputeKey(input: VhBarComputeKeyInput): string {
  return JSON.stringify({
    algo: "ndvi-status-by-date-v2-max-per-region",
    yil: String(input.yil || ""),
    viloyat: String(input.viloyat || ""),
    tuman: String(input.tuman || ""),
    turlar: input.turlar,
    ndviDate: input.ndviDateLocked ? String(input.ndviDate || "").trim() : "",
    ndviDateLocked: Boolean(
      input.ndviDateLocked && String(input.ndviDate || "").trim(),
    ),
    filterVhBarByCrop: input.filterVhBarByCrop,
    farmerInn: String(input.farmerInn || "").trim(),
  });
}

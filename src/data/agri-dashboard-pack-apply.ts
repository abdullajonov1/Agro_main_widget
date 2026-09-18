/**
 * Pure DashboardPack → panel chart shape helpers.
 * Pack match stays in agri-dashboard-pack-match; ArcGIS fallback stays in panels.
 */
import type {
  DashboardPieRow,
  DashboardRegionPack,
  DashboardRegionRow,
} from "../types/dashboard-pack";

export type RegionAggregateView = {
  effectiveViloyat: string;
  effectiveView: "viloyat" | "tuman";
  groupField: "viloyat" | "tuman";
  /** Numeric code identifying each bar; the name is only a label. */
  codeField: "region" | "district";
};

/** Locked / drill / filter viloyat → tuman vs viloyat aggregate view. */
export function resolveRegionAggregateView(opts: {
  lockedViloyat?: string | null;
  selectedViloyatForDrillDown?: string | null;
  filterViloyat?: string | null;
}): RegionAggregateView {
  const effectiveViloyat =
    opts.lockedViloyat ||
    opts.selectedViloyatForDrillDown ||
    opts.filterViloyat ||
    "";
  const effectiveView: "viloyat" | "tuman" = effectiveViloyat
    ? "tuman"
    : "viloyat";
  const groupField = effectiveView === "viloyat" ? "viloyat" : "tuman";
  const codeField = effectiveView === "viloyat" ? "region" : "district";
  return { effectiveViloyat, effectiveView, groupField, codeField };
}

export function mapRegionPackRows(
  pack: DashboardRegionPack,
): DashboardRegionRow[] {
  return pack.rows.map((r) => ({
    name: r.name,
    maydon: r.maydon,
    percentage: r.percentage,
  }));
}

/**
 * Percentage attach for Region rows.
 * Pack path and query fallback differ slightly — preserve both branches.
 */
export function applyRegionRowPercentages(
  rows: Array<{ name: string; maydon: number; percentage?: number }>,
  packTotalArea: number | null,
): {
  totalArea: number;
  withPct: Array<{ name: string; maydon: number; percentage: number }>;
} {
  const totalArea =
    packTotalArea != null && Number.isFinite(packTotalArea)
      ? packTotalArea
      : rows.reduce((s, r) => s + (r.maydon || 0), 0);

  const withPct =
    packTotalArea != null
      ? rows.map((r) => ({
          ...r,
          percentage:
            typeof r.percentage === "number"
              ? r.percentage
              : totalArea
                ? ((r.maydon || 0) / totalArea) * 100
                : 0,
        }))
      : rows.map((r) => ({
          ...r,
          percentage: totalArea ? (r.maydon / totalArea) * 100 : 0,
        }));

  return { totalArea, withPct };
}

export type PieChartCategory = {
  key: string;
  value: number;
  percentage: number;
};

/** Pack hit: merge by crop_id (or raw key); drop empty / non-positive. */
export function buildPieCategoriesFromPackRows(
  rows: DashboardPieRow[],
): { categories: PieChartCategory[]; totalValue: number } {
  const merged = new Map<string, number>();
  for (const r of rows) {
    const key = String(r.key ?? "").trim();
    if (!key) continue;
    const value = Number(r.value || 0);
    if (!(value > 0)) continue;
    merged.set(key, (merged.get(key) || 0) + value);
  }
  const totalValue = Array.from(merged.values()).reduce((sum, v) => sum + v, 0);
  const categories = Array.from(merged.entries())
    .map(([key, value]) => ({
      key,
      value,
      percentage: totalValue ? (value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
  return { categories, totalValue };
}

/**
 * Fallback / VH merge path: keys already canonical; keep zero rows.
 * Mutates sort order of the input array (matches panel `.sort`).
 */
export function buildPieCategoriesFromMergedRows(
  rows: Array<{ key: string; value: number }>,
): { categories: PieChartCategory[]; totalValue: number } {
  const totalValue = rows.reduce((sum, r) => sum + r.value, 0);
  const categories = rows
    .sort((a, b) => b.value - a.value)
    .map((r) => ({
      key: r.key,
      value: r.value,
      percentage: totalValue ? (r.value / totalValue) * 100 : 0,
    }));
  return { categories, totalValue };
}

/** Keep only selections still present in the new category list. */
export function syncPieSelectionAgainstCategories(
  selectedCategories: string[],
  categories: Array<{ key: string }>,
  normalizeName: (value: string) => string,
): {
  validSelectedCategories: string[];
  activeSlice: number | null;
  singleSelection: string;
} {
  const validSelectedCategories = selectedCategories.filter((selected) =>
    categories.some(
      (category) =>
        normalizeName(category.key) === normalizeName(selected),
    ),
  );
  const newActiveSlice = categories.findIndex((category) =>
    validSelectedCategories.some(
      (selected) =>
        normalizeName(category.key) === normalizeName(selected),
    ),
  );
  const singleSelection =
    validSelectedCategories.length === 1 ? validSelectedCategories[0] : "";
  return {
    validSelectedCategories,
    activeSlice: newActiveSlice >= 0 ? newActiveSlice : null,
    singleSelection,
  };
}

/** Round indicator numeric stats the same way across pack hit and fallbacks. */
export function formatIndicatorStatValue(
  value: number,
  decimalPlaces: number | null | undefined,
): number {
  const dp = Number(decimalPlaces || 0);
  const n = Number(value);
  return dp > 0 ? parseFloat(n.toFixed(dp)) : Math.round(n);
}

/**
 * Whether IndicatorPanel may consume the shared sum(maydon) DashboardPack.
 * VH / uniqueid / non-default ops stay on panel queries.
 */
export function canConsumeIndicatorDashboardPack(opts: {
  op: string;
  field: string;
  selectedVegetationStatus?: string | null;
  selectedUniqueid?: string | null;
}): boolean {
  return (
    opts.op === "sum" &&
    String(opts.field || "").trim().toLowerCase() === "maydon" &&
    !String(opts.selectedVegetationStatus || "").trim() &&
    !String(opts.selectedUniqueid || "").trim()
  );
}

/**
 * Regional Graff DashboardPack gate.
 * VH regional is allowed (scopeKey carries status); polygon uniqueid is not.
 */
export function canConsumeGraffDashboardPack(opts: {
  hasVh: boolean;
  selectedUniqueid?: string | null;
  canAugmentExisting?: boolean;
}): boolean {
  void opts.hasVh; // VH regional pack is allowed; kept for call-site clarity
  if (String(opts.selectedUniqueid || "").trim()) return false;
  if (opts.canAugmentExisting) return false;
  return true;
}

/**
 * Polygon Graff Pack gate — stage 1: uniqueid required; pack rows still
 * panel-owned until a later publish stage fills graffPolygon.
 */
export function canConsumeGraffPolygonDashboardPack(opts: {
  uniqueid?: string | null;
}): boolean {
  return !!String(opts.uniqueid || "").trim();
}


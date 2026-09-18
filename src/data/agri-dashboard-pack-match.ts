/**
 * DashboardPack match helpers — panels consume pack when keys align.
 * Fallback queries stay in panels when VH / mismatch / not ready.
 */
import type {
  DashboardPack,
  DashboardIndicatorPack,
  DashboardPiePack,
  DashboardRegionPack,
  DashboardGraffPack,
  DashboardGraffPolygonPack,
} from "../types/dashboard-pack";

export function matchRegionDashboardPack(
  pack: DashboardPack,
  opts: {
    view: "viloyat" | "tuman";
    groupField: string;
    where: string;
    hasVh: boolean;
  },
): DashboardRegionPack | null {
  // Region is never VH- or crop-scoped — ignore hasVh / statsDeferredToPanels so
  // hudud bars stay on the shared pack while Pie waits on uniqueids / crop.
  void opts.hasVh;
  if (pack.phase !== "ready") return null;
  if (!pack.region) return null;
  if (
    pack.region.view === opts.view &&
    pack.region.groupField === opts.groupField &&
    pack.region.where === opts.where
  ) {
    return pack.region;
  }
  return null;
}

export function matchPieDashboardPack(
  pack: DashboardPack,
  opts: {
    where: string;
    hasVh: boolean;
  },
): DashboardPiePack | null {
  if (opts.hasVh) return null;
  if (pack.phase !== "ready" || pack.statsDeferredToPanels) return null;
  if (!pack.pie) return null;
  if (pack.pie.where !== opts.where) return null;
  // Reject stale packs grouped by turi — pie now aggregates by crop_id.
  if (String(pack.pie.categoryField || "").toLowerCase() !== "crop_id") {
    return null;
  }
  return pack.pie;
}

export function matchIndicatorDashboardPack(
  pack: DashboardPack,
  opts: {
    where: string;
    hasVh: boolean;
    attributeField?: string;
  },
): DashboardIndicatorPack | null {
  if (opts.hasVh) return null;
  if (pack.phase !== "ready" || pack.statsDeferredToPanels) return null;
  if (!pack.indicator) return null;
  const wantField = String(opts.attributeField || "maydon").toLowerCase();
  if (
    pack.indicator.statOperation === "sum" &&
    pack.indicator.attributeField.toLowerCase() === wantField &&
    pack.indicator.where === opts.where
  ) {
    return pack.indicator;
  }
  return null;
}

export function matchGraffDashboardPack(
  pack: DashboardPack,
  opts: {
    scopeKey: string;
    hasVh: boolean;
    /** Republic incremental merge must not consume a full pack. */
    canAugmentExisting?: boolean;
  },
): DashboardGraffPack | null {
  if (opts.canAugmentExisting) return null;
  if (pack.phase !== "ready") return null;
  if (!pack.graff) return null;
  // VH regional is allowed: scopeKey embeds vh/ndviStatus. Region/Pie still
  // honor statsDeferredToPanels separately.
  if (pack.graff.scopeKey !== opts.scopeKey) return null;
  return pack.graff;
}

/**
 * Polygon pack match — panel may publish graffPolygon after series fetch.
 * Controller never prefetches TIFF / polygon series.
 */
export function matchGraffPolygonDashboardPack(
  pack: DashboardPack,
  opts: { scopeKey: string; uniqueid: string },
): DashboardGraffPolygonPack | null {
  if (pack.phase !== "ready" && pack.phase !== "loading-stats") return null;
  if (!pack.graffPolygon) return null;
  const wantId = String(opts.uniqueid || "")
    .replace(/[{}]/g, "")
    .trim()
    .toLowerCase();
  const gotId = String(pack.graffPolygon.uniqueid || "")
    .replace(/[{}]/g, "")
    .trim()
    .toLowerCase();
  if (!wantId || wantId !== gotId) return null;
  if (pack.graffPolygon.scopeKey !== opts.scopeKey) return null;
  return pack.graffPolygon;
}

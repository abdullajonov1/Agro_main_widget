/**
 * Pure zoom-target policy for Localization applyMapFiltersOptimized.
 * Extent queries / view.goTo stay in the panel.
 */
import { isEmptyMapExtent, type MapZoomReason } from "./map-zoom-policy";

export function isDistrictZoomPath(
  reason: MapZoomReason,
  tuman: string,
): boolean {
  return reason === "district" && !!String(tuman || "").trim();
}

/** Region / back-from-district / polygon-exit → shown region-year extent only. */
export function preferShownRegionYearExtent(reason: MapZoomReason): boolean {
  return (
    reason === "region" ||
    reason === "district-clear" ||
    reason === "polygon-exit"
  );
}

export function zoomExpandFactorForReason(reason: MapZoomReason): number {
  if (reason === "district" || reason === "polygon-exit") return 1.03;
  if (reason === "region" || reason === "year") return 1.06;
  if (
    reason === "crop" ||
    reason === "vegetation" ||
    reason === "ndvi"
  ) {
    return 1.12;
  }
  return 1.18;
}

export function zoomGoToDurationMsForReason(reason: MapZoomReason): number {
  return reason === "region" || reason === "year" ? 450 : 700;
}

/** Debounce republic home goTo (default 450ms). */
export function shouldSkipHomeGoTo(opts: {
  now: number;
  lastHomeGoToAt: number;
  minGapMs?: number;
}): boolean {
  const gap = opts.minGapMs ?? 450;
  return opts.now - opts.lastHomeGoToAt < gap;
}

export function pickHomeExtentCandidate(opts: {
  storedHome: any;
  mapFullExtent: any;
  layerFullExtent: any;
}): any {
  return opts.storedHome || opts.mapFullExtent || opts.layerFullExtent || null;
}

export type RegionExtentPick = "field" | "admin-region" | "none";

export function pickRegionExtentSource(opts: {
  fieldExtent: any;
  adminExtent: any;
  adminLevel: "district" | "region" | "none";
}): RegionExtentPick {
  // Prefer admin outline when ready — field queryExtent on detached MapImage
  // sublayers is often the slowest step after viloyat select.
  if (
    !isEmptyMapExtent(opts.adminExtent) &&
    opts.adminLevel === "region"
  ) {
    return "admin-region";
  }
  if (!isEmptyMapExtent(opts.fieldExtent)) return "field";
  return "none";
}

/**
 * Race field vs admin region extents; resolve as soon as either is usable.
 * Falls back to pickRegionExtentSource after both settle.
 */
export async function raceRegionExtentPick(opts: {
  fieldPromise: Promise<any>;
  adminPromise: Promise<void>;
  getAdminExtent: () => any;
  getAdminLevel: () => "district" | "region" | "none";
  isEmptyExtent: (extent: any) => boolean;
}): Promise<{ source: RegionExtentPick; extent: any }> {
  const {
    fieldPromise,
    adminPromise,
    getAdminExtent,
    getAdminLevel,
    isEmptyExtent,
  } = opts;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (source: RegionExtentPick, extent: any) => {
      if (settled) return;
      if (source === "none" || isEmptyExtent(extent)) return;
      settled = true;
      resolve({ source, extent });
    };

    void fieldPromise.then((extent) => {
      finish("field", extent);
    });
    void adminPromise.then(() => {
      if (getAdminLevel() === "region") {
        finish("admin-region", getAdminExtent());
      }
    });
    void Promise.all([fieldPromise, adminPromise]).then(([fieldExtent]) => {
      if (settled) return;
      const pick = pickRegionExtentSource({
        fieldExtent,
        adminExtent: getAdminExtent(),
        adminLevel: getAdminLevel(),
      });
      settled = true;
      resolve({
        source: pick,
        extent:
          pick === "field"
            ? fieldExtent
            : pick === "admin-region"
              ? getAdminExtent()
              : null,
      });
    });
  });
}

/** After FeatureLayer union, optionally replace with shown MapImage DE extent. */
export function shouldNarrowSpatialUnionWithShownExtent(opts: {
  hasMergedSpatialExtent: boolean;
  hasTuman: boolean;
  selectedTurlarCount: number;
}): boolean {
  return (
    !!opts.hasMergedSpatialExtent &&
    (!!opts.hasTuman || opts.selectedTurlarCount > 0)
  );
}

/**
 * Crop / NDVI / vegetation: spatial union vs shown MapImage DE.
 * Async queryExtent stays in the panel.
 */
export type CropNdviExtentPlan =
  | "use-spatial"
  | "fallback-shown"
  | "narrow-shown";

export function planCropNdviExtentSource(opts: {
  hasMergedSpatialExtent: boolean;
  hasTuman: boolean;
  selectedTurlarCount: number;
}): CropNdviExtentPlan {
  if (!opts.hasMergedSpatialExtent) return "fallback-shown";
  if (
    shouldNarrowSpatialUnionWithShownExtent({
      hasMergedSpatialExtent: true,
      hasTuman: opts.hasTuman,
      selectedTurlarCount: opts.selectedTurlarCount,
    })
  ) {
    return "narrow-shown";
  }
  return "use-spatial";
}

export function districtAdminExpandFactor(): number {
  return 1.08;
}

export function districtFallbackRegionExpandFactor(): number {
  return 1.03;
}

export function homeGoToDurationMs(): number {
  return 800;
}

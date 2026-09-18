/**
 * Pure map extent / zoom-policy helpers for LocalizationPanel.
 */

export type MapZoomMode = "none" | "selection" | "home";

export type MapZoomReason =
  | "initialization"
  | "year"
  | "region"
  | "district"
  | "district-clear"
  | "crop"
  | "vegetation"
  | "ndvi"
  | "reset"
  | "other"
  | "polygon"
  | "polygon-exit";

export interface MapZoomRequest {
  mode: MapZoomMode;
  reason: MapZoomReason;
}

/** Reasons that reveal/replace layers and may warrant a full map cover. */
export const HEAVY_COVER_ZOOM_REASONS: readonly MapZoomReason[] = [
  "region",
  "year",
  "ndvi",
  "reset",
] as const;

/**
 * Reasons that still run zoom navigation even right after polygonMode clears
 * (popup close). Matches Localization applyMapFiltersOptimized.
 */
export const GEOGRAPHY_ZOOM_REASONS: readonly MapZoomReason[] = [
  "region",
  "district",
  "district-clear",
  "year",
  "crop",
  "vegetation",
  "ndvi",
  "reset",
  "polygon-exit",
] as const;

export function isGeographyZoomReason(reason: MapZoomReason): boolean {
  return (GEOGRAPHY_ZOOM_REASONS as readonly string[]).includes(reason);
}

export function isHeavyCoverZoomReason(reason: MapZoomReason): boolean {
  return (HEAVY_COVER_ZOOM_REASONS as readonly string[]).includes(reason);
}

/** Empty / missing ArcGIS Extent check used by zoom paths. */
export function isEmptyMapExtent(extent: any): boolean {
  return (
    !extent ||
    (typeof extent.isEmpty === "function"
      ? extent.isEmpty()
      : !extent.width && !extent.height)
  );
}

export type MapCoverDecision = {
  coverMap: boolean;
  coverReason: "vegetation" | "crop-renderer" | "filter";
  coverForCropReveal: boolean;
  vhOnly: boolean;
  vhCacheWarm: boolean;
};

/**
 * Whether the map surface overlay should cover clicks during filter apply.
 * Inputs are precomputed by the panel (opacity / VH cache state).
 */
export function decideMapSurfaceCover(opts: {
  expectRegionLayer: boolean;
  alreadyOpaqueRegion: boolean;
  zoomReason: MapZoomReason;
  vhSelected: boolean;
  vhUniqueIdsReady: boolean;
}): MapCoverDecision {
  const vhOnly = opts.zoomReason === "vegetation";
  const vhCacheWarm = vhOnly && opts.vhSelected && opts.vhUniqueIdsReady;
  const coverForCropReveal =
    opts.expectRegionLayer &&
    (!opts.alreadyOpaqueRegion ||
      opts.zoomReason === "region" ||
      opts.zoomReason === "year");
  const coverMap =
    (coverForCropReveal && !opts.alreadyOpaqueRegion) ||
    (vhOnly && !vhCacheWarm) ||
    (isHeavyCoverZoomReason(opts.zoomReason) && !opts.alreadyOpaqueRegion);
  const coverReason: MapCoverDecision["coverReason"] = vhOnly
    ? "vegetation"
    : coverForCropReveal
      ? "crop-renderer"
      : "filter";
  return {
    coverMap,
    coverReason,
    coverForCropReveal,
    vhOnly,
    vhCacheWarm,
  };
}

export function shouldDeferCropForFastReveal(reason: MapZoomReason): boolean {
  return reason === "region" || reason === "year";
}

/**
 * Defer VH uniqueid resolve so geography/turi DE can paint first.
 * `priorDefer` preserves a cold+narrow VH click request already set on the panel.
 * When crop is second-selected (does not scope VH uniqueids), skip defer — map
 * only ANDs turi onto the existing all-crop status ids.
 */
export function shouldDeferVhUniqueIdResolve(opts: {
  priorDefer: boolean;
  vhOnly: boolean;
  vhSelected: boolean;
  zoomReason: MapZoomReason;
  /** Crop-first scopes uniqueids; crop-second must not re-page them. */
  cropScopesVhUniqueIds?: boolean;
}): boolean {
  if (opts.priorDefer) return true;
  if (opts.vhOnly || !opts.vhSelected) return false;
  if (
    opts.zoomReason === "crop" &&
    opts.cropScopesVhUniqueIds === false
  ) {
    return false;
  }
  return (
    opts.zoomReason === "crop" ||
    opts.zoomReason === "district" ||
    opts.zoomReason === "district-clear" ||
    opts.zoomReason === "region" ||
    opts.zoomReason === "year"
  );
}

/** Whether applyMapFiltersOptimized should run view.goTo / extent navigation. */
export function shouldNavigateMapZoom(opts: {
  zoomEnabled: boolean;
  zoomMode: MapZoomMode;
  hasActiveMapView: boolean;
  zoomReason: MapZoomReason;
  polygonMode: boolean;
  justExitedPolygonMode: boolean;
}): boolean {
  if (!opts.zoomEnabled || opts.zoomMode === "none" || !opts.hasActiveMapView) {
    return false;
  }
  const isGeographyZoom = isGeographyZoomReason(opts.zoomReason);
  return (
    isGeographyZoom || (!opts.polygonMode && !opts.justExitedPolygonMode)
  );
}

/** definitionExpression digest used for change detection. */
export function buildDefinitionExpressionDigest(
  featureLayers: Array<{ definitionExpression?: string } | null | undefined>,
): string {
  return (featureLayers || [])
    .map((layer) => layer?.definitionExpression || "1=0")
    .join(" || ");
}

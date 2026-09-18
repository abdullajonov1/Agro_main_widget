/**
 * Pure helpers for Localization applyFiltersPersistent (map DE apply).
 * Side effects (layer mutation, network, MapImage) stay in the panel.
 */

export function isAgriTableDataUrl(url: unknown): boolean {
  return /agri_table_data/i.test(String(url || ""));
}

/** Append AND clause when base is a usable WHERE. */
export function andWhereIfActive(base: string, extra: string): string {
  if (!extra || !base || base === "1=0") return base;
  return `(${base}) AND (${extra})`;
}

/**
 * NDVI status clause wins over date-only clause (matches prior apply order).
 */
export function augmentWhereWithNdviClauses(opts: {
  where: string;
  statusClause: string;
  dateClause: string;
  ndviDateLocked: boolean;
}): string {
  let where = opts.where;
  if (opts.statusClause && where && where !== "1=0") {
    return andWhereIfActive(where, opts.statusClause);
  }
  if (opts.ndviDateLocked && where && where !== "1=0" && opts.dateClause) {
    return andWhereIfActive(where, opts.dateClause);
  }
  return where;
}

/**
 * Track primaryWhere while iterating feature layers (for spatial join mirror).
 * Agri_table without viloyat forces primary to 1=0 once, without overwriting
 * a later non-empty primary from another layer.
 */
export function pickPrimaryWhereForSpatialJoin(
  primaryWhere: string | null,
  where: string,
  opts: { isAgriTable: boolean; hasEffectiveViloyat: boolean },
): string | null {
  if (opts.isAgriTable && !opts.hasEffectiveViloyat) {
    return primaryWhere == null ? "1=0" : primaryWhere;
  }
  if (where && where !== "1=0") return where;
  if (primaryWhere == null) return where;
  return primaryWhere;
}

/**
 * Sync mapping from primary Agri_table WHERE → spatial FeatureLayer WHERE.
 * Non-trivial primary needs uniqueid query (async) — returns null.
 */
export function spatialWhereFromPrimarySync(
  primaryWhere: string,
): string | null {
  if (primaryWhere === "" || primaryWhere === "1=1") return "1=1";
  if (primaryWhere === "1=0") return "1=0";
  return null;
}

export type VhUniqueIdApplyPhase =
  | "ready-clear"
  | "defer-suppress"
  | "resolve";

/** First branch of applyFiltersPersistent VH uniqueid handling. */
export function decideVhUniqueIdApplyPhase(opts: {
  uniqueIdsReadyForApply: boolean;
  deferVhUniqueIdResolve: boolean;
}): VhUniqueIdApplyPhase {
  if (opts.uniqueIdsReadyForApply) return "ready-clear";
  if (opts.deferVhUniqueIdResolve) return "defer-suppress";
  return "resolve";
}

/**
 * Whether to call refreshRegionYearMapExports after syncShownRegionYearLayers.
 * Deferred VH second pass only changes uniqueid DE — JSAPI already schedules
 * export; an explicit refresh cancels the in-flight MapServer export.
 */
export function shouldForceRegionYearMapExportRefresh(opts: {
  vhDeferredSecondPass: boolean;
}): boolean {
  return !opts.vhDeferredSecondPass;
}

/** Whether a shown region-year entry counts as already opaque. */
export function isShownRegionYearLayerOpaque(entry: {
  layer?: { visible?: boolean; opacity?: number } | null;
}): boolean {
  return (
    !!entry?.layer?.visible &&
    Number((entry.layer as any)?.opacity ?? 1) > 0.05
  );
}

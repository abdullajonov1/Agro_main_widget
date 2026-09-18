/**
 * Dashboard query plan — which shared stats requests are needed for a filter.
 *
 * Intentionally NOT planned here (panel-owned, high risk):
 * - VH-scoped Pie / Indicator (deferStatsToPanels)
 * - Graff polygon series / TIFF (uniqueid outside DashboardFilterSlice)
 *
 * Region ignores VH and ekin turi (Pie) — still prefetched under an active VH status.
 * VH Graff regional timeseries MAY be prefetched (ndviStatus in scopeKey).
 */
import type { DashboardFilterSlice } from "../types/dashboard-pack";

export type DashboardQueryPlan = {
  /** Warm shared layer singletons before stats. */
  warmupLayers: boolean;
  /** Prefetch Region groupBy into DashboardPack. */
  prefetchRegion: boolean;
  /** Prefetch Pie category groupBy into DashboardPack. */
  prefetchPie: boolean;
  /** Prefetch default Indicator sum(maydon) into DashboardPack. */
  prefetchIndicator: boolean;
  /**
   * Prefetch Graff regional vegetation timeseries.
   * Allowed with VH (status in scopeKey); never for polygon uniqueid.
   */
  prefetchGraff: boolean;
  /**
   * VH / uniqueid scoping — Pie/Indicator stay panel-owned.
   * Region is still packed (ignores VH and ekin turi). Graff regional may pack too.
   */
  deferStatsToPanels: boolean;
};

/**
 * Decide which controller work to run for the current filter slice.
 * Keep this pure — no I/O — so it is easy to unit-test.
 */
export function buildDashboardQueryPlan(
  filter: DashboardFilterSlice,
): DashboardQueryPlan {
  const hasYil = !!String(filter.yil || "").trim();
  const vhActive = !!String(filter.vh || "").trim() || filter.filterPieByVh;

  if (!hasYil) {
    return {
      warmupLayers: false,
      prefetchRegion: false,
      prefetchPie: false,
      prefetchIndicator: false,
      prefetchGraff: false,
      deferStatsToPanels: false,
    };
  }

  if (vhActive) {
    return {
      warmupLayers: true,
      prefetchRegion: true,
      prefetchPie: false,
      prefetchIndicator: false,
      prefetchGraff: true,
      deferStatsToPanels: true,
    };
  }

  return {
    warmupLayers: true,
    prefetchRegion: true,
    prefetchPie: true,
    prefetchIndicator: true,
    prefetchGraff: true,
    deferStatsToPanels: false,
  };
}

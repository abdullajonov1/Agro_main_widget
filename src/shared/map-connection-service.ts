/**
 * Shared map-connection timing and JimuMapView resolution for Agro_widgetV5.
 * Keeps retry/poll limits in one place so dashboard + embedded panels stay aligned.
 */
import type { JimuMapView } from "jimu-arcgis";

/** Dashboard shell: poll until MapView exists (~10.2 s max). */
export const MAP_VIEW_WATCH_INTERVAL_MS = 300;
export const MAP_VIEW_WATCH_MAX_ATTEMPTS = 34;

/** Embedded panels: retry map widget connection (Pie, Graff, Indicator, Localization). */
export const MAP_CONNECTION_RETRY_MS = 2000;
export const MAX_MAP_CONNECTION_ATTEMPTS = 3;

/** AgriLocalization data-source-only layer resolution. */
export const DS_ONLY_RETRY_DELAY_MS = 500;
export const MAX_DS_ONLY_RETRIES = 12;

/** Staged chart mount fallback when embedded map never signals ready. */
export const CHARTS_MOUNT_FALLBACK_MS = 12000;

/**
 * Resolve the active JimuMapView for an embedded or external map widget id.
 * Returns null when MapViewManager is unavailable or the view is not ready yet.
 */
export function resolveJimuMapView(mapWidgetId: string): JimuMapView | null {
  const id = String(mapWidgetId || "").trim();
  if (!id) return null;

  try {
    const { MapViewManager } = require("jimu-arcgis") as typeof import("jimu-arcgis");
    const group = MapViewManager.getInstance().getJimuMapViewGroup(id);
    const active = group?.getActiveJimuMapView?.();
    if (active?.view) return active;
    const all = group?.getAllJimuMapViews?.() || [];
    return (all.find((jmv: JimuMapView) => !!jmv?.view) as JimuMapView) || null;
  } catch {
    return null;
  }
}

export function isMapViewReady(jimuMapView: JimuMapView | null): boolean {
  const view = jimuMapView?.view as { ready?: boolean } | undefined;
  return !!view && view.ready === true;
}

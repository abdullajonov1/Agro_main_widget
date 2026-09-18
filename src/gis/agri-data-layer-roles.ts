import { agriMapClickDebug } from "./agri-map-click-debug";

export const AGRI_MAP_VIEW_READY_EVENT = "agri-dashboard:map-view-ready";
export const AGRI_MAP_CLICK_EVENT = "agri-dashboard:map-click";
export const AGRI_XY_PAGE_CLOSED_EVENT = "agri-dashboard:xy-page-closed";
export const AGRI_XY_CHART_SELECTION_LAYER_ID = "agri-xy-chart-selection-layer";

export interface AgriMapClickDetail {
  mapWidgetId: string;
  x: number;
  y: number;
  mapPoint?: { x: number; y: number; spatialReference?: { wkid?: number } };
}

export function dispatchMapClick(detail: AgriMapClickDetail): void {
  if (!detail?.mapWidgetId || typeof window === "undefined") return;
  agriMapClickDebug("dispatchMapClick", detail);
  window.dispatchEvent(
    new CustomEvent(AGRI_MAP_CLICK_EVENT, { detail }),
  );
}

export function dispatchMapViewReady(mapWidgetId: string): void {
  if (!mapWidgetId || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AGRI_MAP_VIEW_READY_EVENT, {
      detail: { mapWidgetId },
    }),
  );
}

export function dispatchXyPageClosed(mapWidgetId?: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AGRI_XY_PAGE_CLOSED_EVENT, {
      detail: { mapWidgetId: mapWidgetId ? String(mapWidgetId) : "" },
    }),
  );
}

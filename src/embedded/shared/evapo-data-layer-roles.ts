import { evapoMapClickDebug } from "./evapo-map-click-debug";

export const EVAPO_MAP_VIEW_READY_EVENT = "evapo-dashboard:map-view-ready";
export const EVAPO_MAP_CLICK_EVENT = "evapo-dashboard:map-click";
export const EVAPO_XY_PAGE_CLOSED_EVENT = "evapo-dashboard:xy-page-closed";
export const EVAPO_XY_CHART_SELECTION_LAYER_ID = "evapo-xy-chart-selection-layer";

export interface EvapoMapClickDetail {
  mapWidgetId: string;
  x: number;
  y: number;
  mapPoint?: { x: number; y: number; spatialReference?: { wkid?: number } };
}

export function dispatchMapClick(detail: EvapoMapClickDetail): void {
  if (!detail?.mapWidgetId || typeof window === "undefined") return;
  evapoMapClickDebug("dispatchMapClick", detail);
  window.dispatchEvent(
    new CustomEvent(EVAPO_MAP_CLICK_EVENT, { detail }),
  );
}

export function dispatchMapViewReady(mapWidgetId: string): void {
  if (!mapWidgetId || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(EVAPO_MAP_VIEW_READY_EVENT, {
      detail: { mapWidgetId },
    }),
  );
}

export function dispatchXyPageClosed(mapWidgetId?: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(EVAPO_XY_PAGE_CLOSED_EVENT, {
      detail: { mapWidgetId: mapWidgetId ? String(mapWidgetId) : "" },
    }),
  );
}

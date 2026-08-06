import { AppMode, getAppStore } from "jimu-core";
import { toPlainArray } from "./evapo-data-source-engine";

export type LinkedMapLayoutScope = "dashboard" | "plm";

const MANAGED_MAP_CLASS: Record<LinkedMapLayoutScope, string> = {
  dashboard: "agri-dashboard-managed-map",
  plm: "plm-managed-map",
};

const MANAGED_RENDERER_CLASS: Record<LinkedMapLayoutScope, string> = {
  dashboard: "agri-dashboard-managed-map-renderer",
  plm: "plm-managed-map-renderer",
};

const MAP_PANEL_BORDER_RADIUS = "20px";

export interface EvapoLinkedMapLayoutOptions {
  scope: LinkedMapLayoutScope;
  hostWidgetId: string;
  getSlotElement: () => HTMLElement | null;
  getUseMapWidgetIds: () => unknown;
  onMapWidgetLinked?: (mapWidgetId: string) => void;
  /** Fired when a map widget id becomes available (config link or app discovery). */
  onMapResolved?: (mapWidgetId: string) => void;
  resizeMapView?: () => void;
}

function isMapWidgetConfig(widget: any): boolean {
  const manifestName = String(widget?.manifest?.name || "").toLowerCase();
  const uri = String(widget?.uri || "").toLowerCase();
  return manifestName === "map" || uri.includes("arcgis-map");
}

function findWidgetRenderer(widgetId: string): HTMLElement | null {
  const selectors = [
    `.widget-renderer[data-widgetid="${widgetId}"]`,
    `[data-widgetid="${widgetId}"].widget-renderer`,
    `[data-widgetid="${widgetId}"]`,
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

function findWidgetLayoutItem(widgetId: string): HTMLElement | null {
  const renderer = findWidgetRenderer(widgetId);
  if (!renderer) return null;

  const candidates = [
    renderer.closest(".layout-item.is-widget"),
    renderer.closest(".builder-layout-item"),
    renderer.closest(".layout-item"),
    renderer.closest(".section-layout-item"),
    renderer.closest('[class*="layout-item"]'),
    renderer.parentElement,
  ];

  for (const candidate of candidates) {
    if (candidate instanceof HTMLElement && candidate.contains(renderer)) {
      return candidate;
    }
  }

  return renderer;
}

export function isKnownMapWidgetId(widgetId?: string | null): boolean {
  const id = String(widgetId || "").trim();
  if (!id) return false;

  try {
    const widgets = (getAppStore().getState() as any)?.appConfig?.widgets || {};
    const widget = widgets[id];
    if (widget && isMapWidgetConfig(widget)) return true;
  } catch {
    /* app config may still be warming up */
  }

  try {
    return !!findWidgetRenderer(id);
  } catch {
    return false;
  }
}

function isMapOverlappingSlot(mapWidgetId: string, slot: DOMRect): boolean {
  const item = findWidgetLayoutItem(mapWidgetId);
  if (!item) return false;
  const rect = item.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx >= slot.left && cx <= slot.right && cy >= slot.top && cy <= slot.bottom) {
    return true;
  }
  const overlapX = Math.max(
    0,
    Math.min(rect.right, slot.right) - Math.max(rect.left, slot.left),
  );
  const overlapY = Math.max(
    0,
    Math.min(rect.bottom, slot.bottom) - Math.max(rect.top, slot.top),
  );
  const overlapArea = overlapX * overlapY;
  const mapArea = Math.max(1, rect.width * rect.height);
  return overlapArea / mapArea > 0.3;
}

/** Find the standard Map widget id from app config (published experience safe). */
export function discoverMapWidgetIdInApp(options: {
  hostWidgetId: string;
  getSlotElement?: () => HTMLElement | null;
}): string | null {
  try {
    const state = getAppStore().getState() as any;
    const widgets = state?.appConfig?.widgets || {};
    const ownId = options.hostWidgetId;
    const candidates: string[] = [];
    Object.keys(widgets).forEach((id) => {
      if (id === ownId || id.startsWith(`${ownId}-`)) return;
      if (isMapWidgetConfig(widgets[id])) candidates.push(id);
    });
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const slot = options.getSlotElement?.()?.getBoundingClientRect();
    if (!slot) return candidates[0];

    const insideSlot = candidates.filter((id) =>
      isMapOverlappingSlot(id, slot),
    );
    if (insideSlot.length === 1) return insideSlot[0];
    const pool = insideSlot.length ? insideSlot : candidates;

    let bestId = pool[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    pool.forEach((id) => {
      const item = findWidgetLayoutItem(id);
      if (!item) return;
      const rect = item.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - (slot.left + slot.width / 2);
      const dy = rect.top + rect.height / 2 - (slot.top + slot.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    });
    return bestId;
  } catch {
    return null;
  }
}

export class EvapoLinkedMapLayoutManager {
  private mapLayoutItem: HTMLElement | null = null;
  private mapWidgetRenderer: HTMLElement | null = null;
  private autoLinkAttempted = false;
  private layoutRaf = 0;
  private lastNotifiedMapId: string | null = null;

  constructor(private readonly options: EvapoLinkedMapLayoutOptions) {}

  scheduleLayout(): void {
    if (this.layoutRaf) cancelAnimationFrame(this.layoutRaf);
    this.layoutRaf = requestAnimationFrame(() => {
      this.layoutRaf = 0;
      this.sync();
    });
  }

  layoutNow(): void {
    this.sync();
  }

  destroy(): void {
    if (this.layoutRaf) cancelAnimationFrame(this.layoutRaf);
    this.layoutRaf = 0;
    this.clear();
  }

  getResolvedMapWidgetId(): string | null {
    const linked = this.getLinkedMapWidgetId();
    if (linked && isKnownMapWidgetId(linked)) return linked;
    return this.discoverMapWidgetIdFromApp();
  }

  private getLinkedMapWidgetId(): string | null {
    const ids = toPlainArray<string>(this.options.getUseMapWidgetIds());
    return ids[0] ? String(ids[0]) : null;
  }

  private findSharedLayoutSurface(slot: HTMLElement): HTMLElement | null {
    const hostItem = slot.closest(
      ".layout-item, .builder-layout-item",
    ) as HTMLElement | null;
    return hostItem?.parentElement || null;
  }

  private discoverMapWidgetIdFromApp(): string | null {
    return discoverMapWidgetIdInApp({
      hostWidgetId: this.options.hostWidgetId,
      getSlotElement: this.options.getSlotElement,
    });
  }

  private notifyMapResolved(mapWidgetId: string | null): void {
    if (!mapWidgetId || mapWidgetId === this.lastNotifiedMapId) return;
    this.lastNotifiedMapId = mapWidgetId;
    this.options.onMapResolved?.(mapWidgetId);
  }

  private tryAutoLinkMapWidget(mapWidgetId: string): void {
    const linked = this.getLinkedMapWidgetId();
    if (!mapWidgetId || (linked && isKnownMapWidgetId(linked)) || this.autoLinkAttempted) {
      return;
    }
    const slot = this.options.getSlotElement()?.getBoundingClientRect();
    if (slot && !isMapOverlappingSlot(mapWidgetId, slot)) return;

    try {
      const mode = getAppStore().getState().appRuntimeInfo?.appMode;
      if (mode !== AppMode.Design) return;
      // Runtime bundles must not depend on the builder-only package. Ask the
      // setting panel to focus the map selector; the user can confirm linkage
      // there without making published apps load `jimu-for-builder`.
      this.autoLinkAttempted = true;
      window.dispatchEvent(
        new CustomEvent("agri-main:map-settings-request", {
          detail: { widgetId: this.options.hostWidgetId, mapWidgetId },
        }),
      );
    } catch {
      /* builder-only helper */
    }
  }

  private applyMapSlotBounds(layoutItem: HTMLElement, slotEl: HTMLElement): void {
    const slotRect = slotEl.getBoundingClientRect();
    const surface = this.findSharedLayoutSurface(slotEl);

    let top = slotRect.top;
    let left = slotRect.left;
    let positionMode: "fixed" | "absolute" = "fixed";

    if (surface) {
      const surfaceRect = surface.getBoundingClientRect();
      top = slotRect.top - surfaceRect.top + surface.scrollTop;
      left = slotRect.left - surfaceRect.left + surface.scrollLeft;
      positionMode = "absolute";

      if (getComputedStyle(surface).position === "static") {
        surface.style.setProperty("position", "relative");
      }
    }

    const entries: Array<[string, string]> = [
      ["position", positionMode],
      ["top", `${top}px`],
      ["left", `${left}px`],
      ["width", `${slotRect.width}px`],
      ["height", `${slotRect.height}px`],
      ["right", "auto"],
      ["bottom", "auto"],
      ["margin", "0"],
      ["padding", "0"],
      ["transform", "none"],
      ["border-radius", MAP_PANEL_BORDER_RADIUS],
      ["overflow", "hidden"],
      ["z-index", "12"],
      ["box-sizing", "border-box"],
      ["pointer-events", "auto"],
    ];

    entries.forEach(([key, value]) => {
      layoutItem.style.setProperty(key, value, "important");
    });

    const wrapper = layoutItem.closest(".builder-layout-item") as HTMLElement | null;
    if (wrapper && wrapper !== layoutItem) {
      [
        ["position", "static"],
        ["width", "0"],
        ["height", "0"],
        ["margin", "0"],
        ["padding", "0"],
        ["overflow", "visible"],
        ["pointer-events", "none"],
      ].forEach(([key, value]) => {
        wrapper.style.setProperty(key, value, "important");
      });
    }
  }

  private fillMapRenderer(renderer: HTMLElement): void {
    const radius = MAP_PANEL_BORDER_RADIUS;
    [
      ["position", "relative"],
      ["width", "100%"],
      ["height", "100%"],
      ["top", "0"],
      ["left", "0"],
      ["margin", "0"],
      ["padding", "0"],
      ["transform", "none"],
      ["border-radius", radius],
      ["overflow", "hidden"],
      ["box-sizing", "border-box"],
    ].forEach(([key, value]) => {
      renderer.style.setProperty(key, value, "important");
    });

    renderer
      .querySelectorAll<HTMLElement>(
        ".esri-view, .esri-view-root, .esri-view-surface, .widget-map",
      )
      .forEach((node) => {
        node.style.setProperty("border-radius", radius, "important");
        node.style.setProperty("overflow", "hidden", "important");
      });
  }

  private clearManagedElement(target: HTMLElement | null): void {
    if (!target) return;
    [
      "position",
      "top",
      "left",
      "right",
      "bottom",
      "width",
      "height",
      "z-index",
      "margin",
      "padding",
      "transform",
      "border-radius",
      "overflow",
      "box-sizing",
      "pointer-events",
    ].forEach((key) => target.style.removeProperty(key));
    Object.values(MANAGED_MAP_CLASS).forEach((cls) => target.classList.remove(cls));
    Object.values(MANAGED_RENDERER_CLASS).forEach((cls) =>
      target.classList.remove(cls),
    );
  }

  private clear(): void {
    const wrapper = this.mapLayoutItem?.closest(
      ".builder-layout-item",
    ) as HTMLElement | null;
    if (wrapper && wrapper !== this.mapLayoutItem) {
      ["position", "width", "height", "margin", "padding", "overflow", "pointer-events"].forEach(
        (key) => wrapper.style.removeProperty(key),
      );
    }
    this.clearManagedElement(this.mapLayoutItem);
    this.clearManagedElement(this.mapWidgetRenderer);
    this.mapLayoutItem = null;
    this.mapWidgetRenderer = null;
  }

  private sync(): void {
    const slot = this.options.getSlotElement();
    if (!slot) {
      this.clear();
      return;
    }

    const mapWidgetId = this.getResolvedMapWidgetId();
    if (!mapWidgetId) {
      this.clear();
      return;
    }

    this.notifyMapResolved(mapWidgetId);

    if (!this.getLinkedMapWidgetId()) {
      this.tryAutoLinkMapWidget(mapWidgetId);
    }

    const layoutItem = findWidgetLayoutItem(mapWidgetId);
    const renderer = findWidgetRenderer(mapWidgetId);
    if (!layoutItem || !renderer) {
      // Published portal: map widget DOM often mounts after the dashboard — keep
      // the last positioned map instead of clearing styles (that strands the map).
      if (this.mapLayoutItem && this.mapWidgetRenderer) {
        this.applyMapSlotBounds(this.mapLayoutItem, slot);
        this.fillMapRenderer(this.mapWidgetRenderer);
        this.options.resizeMapView?.();
      }
      return;
    }

    this.mapLayoutItem = layoutItem;
    this.mapWidgetRenderer = renderer;
    layoutItem.classList.add(MANAGED_MAP_CLASS[this.options.scope]);
    renderer.classList.add(MANAGED_RENDERER_CLASS[this.options.scope]);
    this.applyMapSlotBounds(layoutItem, slot);
    this.fillMapRenderer(renderer);
    this.options.resizeMapView?.();
  }
}

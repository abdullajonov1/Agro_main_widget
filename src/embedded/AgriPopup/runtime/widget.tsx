// Polygon Attribute Inspector (AgriPolygon refactor)
// ✅ UPDATED: supports MULTIPLE selected Feature Layers (e.g. yearly layers filtered by another widget)

import Graphic from "esri/Graphic";
import FeatureLayer from "esri/layers/FeatureLayer";
import GraphicsLayer from "esri/layers/GraphicsLayer";
import Point from "esri/geometry/Point";
import esriRequest from "esri/request";
import SimpleFillSymbol from "esri/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "esri/symbols/SimpleLineSymbol";
import { JimuMapView, MapViewManager } from "jimu-arcgis";
import {
  AllWidgetProps,
  DataSourceManager,
  QueriableDataSource,
  React,
} from "jimu-core";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Download,
  FolderOpen,
  Inbox,
  LineChart,
  MapPin,
  MousePointerClick,
  Paperclip,
  Pin,
  Settings2,
  Sprout,
  ChevronUp,
  X,
} from "lucide-react";
import { EvapoHiddenConnectors } from "../../shared/EvapoHiddenConnectors";
import {
  getSelectedDsIds,
  type EvapoDataSourceEngine,
} from "../../shared/evapo-data-source-engine";
import { EVAPO_MAP_VIEW_READY_EVENT, EVAPO_MAP_CLICK_EVENT, EVAPO_XY_PAGE_CLOSED_EVENT, type EvapoMapClickDetail } from "../../shared/evapo-data-layer-roles";
import { discoverMapWidgetIdInApp } from "../../shared/evapo-linked-map-layout";
import { getSharedEvapoDataSourceEngine } from "../../shared/evapo-engine-registry";
import {
  evapoMapClickDebug,
  evapoMapClickWarn,
  logPointerStack,
} from "../../shared/evapo-map-click-debug";
import {
  extractMapLayerIdFromDsId,
  findQueryableLayerOnMapByUrl,
  findQueryableLayerOnMapById,
  getAllFeatureLayersFromMap,
  getEvapoLayerMapKey,
  getQueryableLayer,
  isMapImageOwnedLayer,
  isQueryableFieldLayer,
  normalizeQueryableLayerUrl,
} from "../../shared/feature-layer-data";
import {
  formatArcgisDateToYmd,
  queryVegetationSeriesForUniqueId,
} from "../../shared/agri-vegetation-data-source";
import {
  AGRI_TABLE_JOIN_FIELD,
  queryAgriRecordByUniqueId,
} from "../../shared/agri-table-data-source";
import AgriChartLoader from "../../../shared/AgriChartLoader";
import {
  getInitialLang,
  getInitialTheme,
  normalizeLang,
  t,
  type LangCode,
} from "./messages";

import "./AgriPolygon.css";

const console = {
  log: (..._args: any[]) => {},
  warn: (..._args: any[]) => {},
  error: (..._args: any[]) => {},
  info: (..._args: any[]) => {},
  debug: (..._args: any[]) => {},
};

type Config = {
  fieldsToShow?: string[];
  titleField?: string;
  labels?: Record<string, string>;
  settings?: {
    zoomToSelection?: boolean; // default true
    showMapPopup?: boolean; // default false
    showAttachments?: boolean; // default true (when undefined)
  };
  chartEnabled?: boolean;
  chartType?: "bar" | "line";
  chartTitle?: string;
  chartFields?: string[];
  chartColor?: string;
};

type AttachmentItem = {
  id: number;
  name?: string;
  size?: number;
  contentType?: string;
  url?: string; // direct download URL
  previewObjectUrl?: string; // created via URL.createObjectURL for <img> previews
};

interface State {
  currentLang: LangCode;
  isDarkTheme: boolean;

  jimuMapView?: JimuMapView | null;

  /** ✅ MULTI: all resolved layers from settings */
  featureLayers: __esri.FeatureLayer[];
  /** ✅ MULTI: map clicked layer => dsId (best-effort) */
  layerKeyToDsId: Record<string, string>;

  /** ✅ MULTI: store DS schemas per DS id */
  dataSourcesById: Record<string, QueriableDataSource>;

  /** which layer was last clicked (for aliases/field resolving) */
  lastClickedDsId: string | null;
  lastClickedLayerKey: string | null;

  pinToCorner: boolean;

  // attachments UI
  loadingAttachments: boolean;
  attachments: AttachmentItem[];
  attachmentsExpanded: boolean;

  loading: boolean;
  error: string | null;

  selectedAttrs: Record<string, any> | null;
  selectedOID: number | null;
  objectIdField: string | null;

  showPopup: boolean;
  /** X collapses the panel; selection + data stay until real deselect. */
  popupMinimized: boolean;
  popupPosition: { x: number; y: number } | null;
  clickScreenPoint: { x: number; y: number } | null;

  debugInfo: {
    layerInfo?: any;
    hitTestResults?: any;
    queryResults?: any;
    fieldMapping?: any;
    availableLayers?: any;
  };

  chartExpanded: boolean;
  chartHoverIndex: number | null;

  // Latest-day vegetation index values (NDVI/SAVI/RVI/CI/EVI/NDWI) for the
  // currently selected polygon, from agri_vegetation_indices.
  loadingLatestIndices: boolean;
  latestIndexDate: string | null;
  latestIndexValues: Record<string, number> | null;
}

export default class AgriPolygon extends React.PureComponent<
  AllWidgetProps<Config>,
  State
> {
  private _isMounted = false;
  private themeObserver: MutationObserver | null = null;
  private _clickHandle: IHandleLike | null = null;
  /** Monotonic id so a slow/duplicate click path cannot close a newer popup. */
  private _clickGeneration = 0;
  private _popupRef: React.RefObject<HTMLDivElement> = React.createRef();
  private _highlightLayer: __esri.GraphicsLayer | null = null;
  private _highlightGraphic: __esri.Graphic | null = null;
  private _highlightHaloGraphic: __esri.Graphic | null = null;
  private _extentBeforeSelection: __esri.Extent | null = null;
  /** Currently inspected field uniqueid (map or table via hub). Same-id map click toggles off. */
  private _activeInspectedUniqueid: string | null = null;
  /** Last yil|viloyat|tuman from masterFilterChanged — geography move closes popup. */
  private _lastMasterGeoKey = "";
  private _isDraggingPopup = false;
  private _popupDragOffset = { x: 0, y: 0 };
  private _popupLayoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _popupLayoutRaf = 0;
  private mapAreaResizeObserver: ResizeObserver | null = null;
  private readonly _featureQueryCacheTtlMs = 60 * 60 * 1000;
  private _featureQueryCache = new Map<
    string,
    { expires: number; value: Promise<__esri.Graphic | null> }
  >();
  /** Detached query clients keyed by service URL; never mutate live map sublayers. */
  private _queryOnlyLayers = new Map<string, FeatureLayer>();
  private readonly dataSourceEngine: EvapoDataSourceEngine;
  private mapViewFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private mapInitRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectedMapViewId = "";
  private mapInitRetryCount = 0;
  private readonly maxMapInitRetries = 12;
  private mapClickBootstrapTimer: ReturnType<typeof setInterval> | null = null;
  private readonly POPUP_WIDTH = 340;
  private readonly POPUP_MARGIN = 12;
  /** Match dashboard map overlays: 16px horizontal and 12px vertical inset. */
  private readonly DASHBOARD_POPUP_HORIZONTAL_INSET = 16;
  private readonly DASHBOARD_POPUP_VERTICAL_INSET = 12;
  /** Guards against a stale latest-indices response landing after a newer polygon selection. */
  private _latestIndicesRequestId = 0;

  private getPopupWidth(
    view?: __esri.MapView | __esri.SceneView | null,
  ): number {
    const margin = this.POPUP_MARGIN;
    let preferred = this.POPUP_WIDTH;

    if (this.isDashboardEmbedded()) {
      const root =
        (document.querySelector(".agri-dashboard-v3") as HTMLElement | null) ||
        document.documentElement;
      const raw = getComputedStyle(root)
        .getPropertyValue("--agri-dashboard-popup-width")
        .trim();
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        preferred = parsed;
      }
    }

    if (view) {
      const mapW = this.getMapAreaRect(view).width;
      return Math.max(220, Math.min(preferred, mapW - margin * 2));
    }
    return preferred;
  }

  private getPinnedPopupHeight(
    view: __esri.MapView | __esri.SceneView,
    topY: number,
  ): number {
    const rect = this.getMapAreaRect(view);
    if (this.isDashboardEmbedded()) {
      const bottomInset = this.DASHBOARD_POPUP_VERTICAL_INSET;
      return Math.max(160, rect.bottom - bottomInset - topY);
    }

    const margin = this.POPUP_MARGIN;
    const mapBottom = this.getEffectiveMapBottom(view, margin);
    return Math.max(160, mapBottom - topY);
  }

  private getPopupDimensions(
    view?: __esri.MapView | __esri.SceneView | null,
    pinned = false,
    position?: { x: number; y: number } | null,
  ): { width: number; height: number } {
    const width = this.getPopupWidth(view);
    if (pinned && view) {
      const topY =
        position?.y ?? this.calculatePinnedPosition(view).y;
      const height = this.getPinnedPopupHeight(view, topY);
      return { width, height };
    }
    return { width, height: width };
  }

  constructor(props: AllWidgetProps<Config>) {
    super(props);
    this.dataSourceEngine = getSharedEvapoDataSourceEngine(props.id);

    this.state = {
      currentLang: getInitialLang(),
      isDarkTheme: this.getResolvedTheme(),

      jimuMapView: null,

      featureLayers: [],
      layerKeyToDsId: {},
      dataSourcesById: {},

      lastClickedDsId: null,
      lastClickedLayerKey: null,

      pinToCorner: true,

      loadingAttachments: false,
      attachments: [],
      attachmentsExpanded: false,

      loading: false,
      error: null,

      selectedAttrs: null,
      selectedOID: null,
      objectIdField: null,

      showPopup: false,
      popupMinimized: false,
      popupPosition: null,
      clickScreenPoint: null,

      debugInfo: {},
      chartExpanded: false,
      chartHoverIndex: null,

      loadingLatestIndices: false,
      latestIndexDate: null,
      latestIndexValues: null,
    };
  }

  private getResolvedTheme = (): boolean => {
    const root = document.documentElement;
    const body = document.body;

    try {
      const savedTheme =
        localStorage.getItem("agri_v11_app_theme");

      if (savedTheme === "light") return false;
      if (savedTheme === "dark") return true;
    } catch {
      // ignore storage access issues
    }

    const isLight =
      root.classList.contains("light-theme") ||
      root.getAttribute("data-theme") === "light" ||
      body.classList.contains("light-theme");

    return getInitialTheme() ?? !isLight;
  };

  componentDidMount(): void {
    this._isMounted = true;
    this.setupThemeObserver();
    const isDarkTheme = this.getResolvedTheme();
    if (isDarkTheme !== this.state.isDarkTheme) {
      this.setState({ isDarkTheme });
    }
    document.addEventListener(
      "themeChanged",
      this.handleThemeChange as EventListener,
    );
    document.addEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
    );
    document.addEventListener("mousedown", this.handleOutsideClick);
    document.addEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChanged as EventListener,
    );
    document.addEventListener(
      "widgetSelectionChanged",
      this.handleWidgetSelectionChanged as EventListener,
    );
    window.addEventListener("resize", this.schedulePopupLayout);
    window.addEventListener(
      EVAPO_MAP_VIEW_READY_EVENT,
      this.handleMapViewReady as EventListener,
    );
    window.addEventListener(
      EVAPO_MAP_CLICK_EVENT,
      this.handleSharedMapClick as EventListener,
    );
    window.addEventListener(
      EVAPO_XY_PAGE_CLOSED_EVENT,
      this.handleXyPageClosed as EventListener,
    );
    if (!this.isDashboardEmbedded()) {
      window.addEventListener("scroll", this.schedulePopupLayout, true);
    }
    this.scheduleMapViewFallback();
    this.mapClickBootstrapTimer = setInterval(() => {
      this.ensureMapClickAttached();
    }, 2500);
    evapoMapClickDebug("AgriPolygon mounted", {
      widgetId: this.props.id,
      embedded: this.isDashboardEmbedded(),
      mapWidgetId: this.getLinkedMapWidgetId(),
      useDataSourceIds: getSelectedDsIds(this.props.useDataSources),
    });
  }

  componentWillUnmount(): void {
    this._isMounted = false;
    if (this.state.showPopup) {
      this.broadcastPopupVisibility(false);
    }
    document.removeEventListener(
      "themeChanged",
      this.handleThemeChange as EventListener,
    );
    document.removeEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
    );
    this.detachMapClick();
    this.cleanupHighlight();
    document.removeEventListener("mousedown", this.handleOutsideClick);
    document.removeEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChanged as EventListener,
    );
    document.removeEventListener(
      "widgetSelectionChanged",
      this.handleWidgetSelectionChanged as EventListener,
    );
    window.removeEventListener("resize", this.schedulePopupLayout);
    window.removeEventListener(
      EVAPO_MAP_VIEW_READY_EVENT,
      this.handleMapViewReady as EventListener,
    );
    window.removeEventListener(
      EVAPO_MAP_CLICK_EVENT,
      this.handleSharedMapClick as EventListener,
    );
    window.removeEventListener(
      EVAPO_XY_PAGE_CLOSED_EVENT,
      this.handleXyPageClosed as EventListener,
    );
    if (this.mapViewFallbackTimer) clearTimeout(this.mapViewFallbackTimer);
    if (this.mapInitRetryTimer) clearTimeout(this.mapInitRetryTimer);
    if (this.mapClickBootstrapTimer) clearInterval(this.mapClickBootstrapTimer);
    window.removeEventListener("scroll", this.schedulePopupLayout, true);
    if (this._popupLayoutTimer) clearTimeout(this._popupLayoutTimer);
    if (this._popupLayoutRaf) cancelAnimationFrame(this._popupLayoutRaf);
    this.mapAreaResizeObserver?.disconnect();
    this.mapAreaResizeObserver = null;
    window.removeEventListener("mousemove", this.onPopupDragMove);
    window.removeEventListener("mouseup", this.onPopupDragEnd);
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
    this.revokeAllAttachmentUrls();
    this._featureQueryCache.clear();
  }

  private pruneFeatureQueryCache(now = Date.now()): void {
    for (const [key, entry] of this._featureQueryCache) {
      if (entry.expires <= now) this._featureQueryCache.delete(key);
    }
  }

  private getFeatureQueryCacheKey(
    layer: __esri.FeatureLayer,
    oidField: string,
    oid: unknown,
    outFields: string[],
  ): string {
    const layerKey = String((layer as any)?.url || layer.id || layer.title || "");
    const fieldsKey = Array.from(new Set(outFields.map((f) => String(f))))
      .sort()
      .join(",");
    return `${layerKey}|${oidField}|${String(oid)}|${fieldsKey}`;
  }

  /**
   * Off-map FeatureLayer client for a live map layer's URL. Every query in
   * the click chain must run against these detached clients: createQuery /
   * queryFeatures on a live MapImage Sublayer rehydrates it and can clear its
   * runtime definitionExpression, which makes the map export (and briefly
   * paint) every district's fields until the filter guard restores it.
   */
  private getDetachedQueryLayer = async (
    layer: any,
  ): Promise<__esri.FeatureLayer | null> => {
    const url = String(layer?.url || "").trim();
    if (!url) return null;
    let detached = this._queryOnlyLayers.get(url);
    if (!detached) {
      detached = new FeatureLayer({ url });
      this._queryOnlyLayers.set(url, detached);
    }
    try {
      await detached.load();
    } catch {
      return null;
    }
    return detached as unknown as __esri.FeatureLayer;
  };

  /** Snapshot the live definitionExpression of each layer (pre-hitTest). */
  private snapshotDefinitionExpressions(
    layers: Array<__esri.FeatureLayer | any>,
  ): Map<any, string> {
    const snapshot = new Map<any, string>();
    for (const layer of layers) {
      if (!layer || snapshot.has(layer)) continue;
      try {
        snapshot.set(layer, String((layer as any).definitionExpression ?? ""));
      } catch {
        /* ignore */
      }
    }
    return snapshot;
  }

  /**
   * Restore any definitionExpression that drifted (was cleared by hitTest /
   * identify / load rehydration) synchronously, before the unfiltered
   * MapImage export can be painted.
   */
  private restoreDriftedDefinitionExpressions(
    snapshot: Map<any, string>,
  ): void {
    snapshot.forEach((expression, layer) => {
      try {
        const current = String((layer as any).definitionExpression ?? "");
        if (current !== expression) {
          (layer as any).definitionExpression = expression;
          evapoMapClickWarn("definitionExpression drift restored", {
            layer: layer?.title || layer?.url || layer?.id,
            drifted: current || "<empty>",
            restored: expression || "<empty>",
          });
        }
      } catch {
        /* ignore */
      }
    });
  }

  private async queryFeatureByObjectIdCached(
    layer: __esri.FeatureLayer,
    oidField: string,
    oid: unknown,
    outFields: string[],
  ): Promise<__esri.Graphic | null> {
    const now = Date.now();
    this.pruneFeatureQueryCache(now);
    const key = this.getFeatureQueryCacheKey(layer, oidField, oid, outFields);
    const hit = this._featureQueryCache.get(key);
    if (hit && hit.expires > now) {
      evapoMapClickDebug("feature-query:cache-hit", {
        layer: layer.title || layer.url || layer.id,
        oidField,
        oid,
        outFieldCount: outFields.length,
      });
      return hit.value;
    }

    const job = (async () => {
      const liveDefinitionExpression = String(
        (layer as any).definitionExpression || "",
      );

      // Calling queryFeatures on a live MapImage sublayer can rehydrate that
      // sublayer and temporarily clear its runtime definitionExpression. The
      // map then renders every district until Localization's guard restores
      // the filter. Query an off-map FeatureLayer client instead.
      const detachedQueryLayer = await this.getDetachedQueryLayer(layer);
      const queryLayer: __esri.FeatureLayer = detachedQueryLayer || layer;

      const q = queryLayer.createQuery();
      q.where = `${oidField} = ${Number(oid)}`;
      q.outFields = outFields;
      q.returnGeometry = true;
      evapoMapClickDebug("feature-query:request", {
        layer: layer.title || layer.url || layer.id,
        url: layer.url || null,
        where: q.where,
        outFields,
        returnGeometry: true,
      });
      const res = await queryLayer.queryFeatures(q);
      // Defensive restore for the no-URL fallback. The detached path above
      // never touches the live layer.
      if (
        queryLayer === layer &&
        String((layer as any).definitionExpression || "") !==
          liveDefinitionExpression
      ) {
        (layer as any).definitionExpression = liveDefinitionExpression;
      }
      evapoMapClickDebug("feature-query:response", {
        layer: layer.title || layer.url || layer.id,
        featureCount: res.features?.length || 0,
        hasGeometry: Boolean(res.features?.[0]?.geometry),
        attributeKeys: Object.keys(res.features?.[0]?.attributes || {}),
        queryMode: queryLayer === layer ? "live-fallback" : "detached",
        liveDefinitionExpression:
          (layer as any).definitionExpression || null,
      });
      return res.features?.[0] || null;
    })();

    this._featureQueryCache.set(key, {
      expires: now + this._featureQueryCacheTtlMs,
      value: job,
    });

    try {
      const feature = await job;
      if (!feature && this._featureQueryCache.get(key)?.value === job) {
        this._featureQueryCache.delete(key);
      }
      return feature;
    } catch (err) {
      if (this._featureQueryCache.get(key)?.value === job) {
        this._featureQueryCache.delete(key);
      }
      throw err;
    }
  }
  private tr = (
    key: string,
    params?: Record<string, string | number>,
  ): string => {
    return t(this.state.currentLang, key, params);
  };

  private setupThemeObserver = (): void => {
    const root = document.documentElement;
    const body = document.body;
    this.themeObserver = new MutationObserver(() => {
      const isDarkTheme = this.getResolvedTheme();
      if (this._isMounted && isDarkTheme !== this.state.isDarkTheme) {
        this.setState({ isDarkTheme });
      }
    });

    this.themeObserver.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    this.themeObserver.observe(body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  };

  private handleThemeChange = (e: any): void => {
    if (!this._isMounted) return;
    const detail = e?.detail || {};
    let isDarkTheme = this.getResolvedTheme();

    if (typeof detail.isDarkTheme === "boolean") {
      isDarkTheme = detail.isDarkTheme;
    } else if (typeof detail.theme === "string") {
      isDarkTheme = String(detail.theme).toLowerCase() !== "light";
    }

    if (isDarkTheme !== this.state.isDarkTheme) {
      this.setState({ isDarkTheme });
    }
  };

  private handleLanguageChange = (e: any): void => {
    if (!this._isMounted) return;
    const lang = e?.detail?.lang || e?.detail?.language || e?.detail?.code;
    const normalized = normalizeLang(lang);
    if (normalized !== this.state.currentLang) {
      this.setState({ currentLang: normalized });
    }
  };

  /* --- pinned popup helpers --- */
  private isDashboardEmbedded(): boolean {
    return String(this.props.id || "").endsWith("-popup");
  }

  /** Crop overlay top in viewport coords; null when not used. */
  private getCropOverlayTop(): number | null {
    if (!this.isDashboardEmbedded()) return null;

    const cropEl = document.querySelector(
      ".agri-dashboard-crop-overlay.agri-dashboard-managed-crop",
    ) as HTMLElement | null;
    if (cropEl) {
      const rect = cropEl.getBoundingClientRect();
      if (rect.height > 0 && Number.isFinite(rect.top)) {
        return rect.top;
      }
    }

    return null;
  }

  private getMapAreaRect(
    view: __esri.MapView | __esri.SceneView,
  ): DOMRect {
    if (this.isDashboardEmbedded()) {
      const mapSlot = document.querySelector(
        ".agri-dashboard-map-slot",
      ) as HTMLElement | null;
      if (mapSlot) {
        const slotRect = mapSlot.getBoundingClientRect();
        if (slotRect.width > 40 && slotRect.height > 40) {
          return slotRect;
        }
      }
    }
    return (view.container as HTMLElement).getBoundingClientRect();
  }

  private observeMapAreaResize(
    view: __esri.MapView | __esri.SceneView,
  ): void {
    this.mapAreaResizeObserver?.disconnect();
    this.mapAreaResizeObserver = null;

    if (typeof ResizeObserver === "undefined") return;

    const target = this.isDashboardEmbedded()
      ? ((document.querySelector(
          ".agri-dashboard-map-slot",
        ) as HTMLElement | null) || (view.container as HTMLElement | null))
      : (view.container as HTMLElement | null);
    if (!target) return;

    this.mapAreaResizeObserver = new ResizeObserver(() => {
      this.schedulePopupLayout();
    });
    this.mapAreaResizeObserver.observe(target);
  }

  private getEffectiveMapBottom(
    view: __esri.MapView | __esri.SceneView,
    gap = 4,
  ): number {
    const rect = this.getMapAreaRect(view);
    const cropTop = this.getCropOverlayTop();
    if (cropTop != null && cropTop > rect.top && cropTop <= rect.bottom + 2) {
      return cropTop - gap;
    }
    return rect.bottom - gap;
  }

  private measurePopupHeight(popupEl: HTMLElement): number {
    const header = popupEl.querySelector(
      ".agri3-popup-header",
    ) as HTMLElement | null;
    const content = popupEl.querySelector(
      ".agri3-popup-content",
    ) as HTMLElement | null;
    const headerH = header?.offsetHeight || 0;
    const contentH = content?.scrollHeight || content?.offsetHeight || 0;
    const natural = headerH + contentH;
    if (natural > 0) return Math.ceil(natural);

    const rect = popupEl.getBoundingClientRect();
    return rect.height > 0 ? Math.ceil(rect.height) : Math.ceil(popupEl.scrollHeight);
  }

  private popupPositionsEqual(
    a: { x: number; y: number } | null | undefined,
    b: { x: number; y: number },
    epsilon = 1,
  ): boolean {
    if (!a) return false;
    return (
      Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
    );
  }

  private applyPopupPosition = (pos: { x: number; y: number }): void => {
    if (this.popupPositionsEqual(this.state.popupPosition, pos)) return;
    this.setState({ popupPosition: pos });
  };

  private schedulePopupLayout = (): void => {
    if (this._isDraggingPopup) return;
    if (this._popupLayoutTimer) clearTimeout(this._popupLayoutTimer);
    this._popupLayoutTimer = setTimeout(() => {
      this._popupLayoutTimer = null;
      this.repositionPinnedIfNeeded();
    }, 48);
  };

  private schedulePopupLayoutAfterContent = (): void => {
    if (this._popupLayoutRaf) cancelAnimationFrame(this._popupLayoutRaf);
    this._popupLayoutRaf = requestAnimationFrame(() => {
      this._popupLayoutRaf = requestAnimationFrame(() => {
        this._popupLayoutRaf = 0;
        this.repositionPinnedIfNeeded();
      });
    });
  };

  private calculatePinnedPosition = (
    view: __esri.MapView | __esri.SceneView,
  ): { x: number; y: number } => {
    const rect = this.getMapAreaRect(view);
    const margin = this.POPUP_MARGIN;
    const popupWidth = this.getPopupWidth(view);
    if (this.isDashboardEmbedded()) {
      return {
        x: rect.right - popupWidth - this.DASHBOARD_POPUP_HORIZONTAL_INSET,
        y: rect.top + this.DASHBOARD_POPUP_VERTICAL_INSET,
      };
    }

    return {
      x: rect.right - popupWidth - margin,
      y: rect.top + margin,
    };
  };

  private repositionPinnedIfNeeded = () => {
    if (!this._isMounted) return;
    if (!this.state.showPopup) return;
    if (this._isDraggingPopup) return;
    const view = this.state.jimuMapView?.view;
    if (!view) return;

    if (this.state.pinToCorner) {
      const pos = this.calculatePinnedPosition(view);
      if (this.popupPositionsEqual(this.state.popupPosition, pos)) {
        this.forceUpdate();
      } else {
        this.setState({ popupPosition: pos });
      }
      return;
    }

    if (!this.state.popupPosition) return;
    const clamped = this.clampPopupToMapContainer(
      this.state.popupPosition,
      view,
    );
    this.applyPopupPosition(clamped);
  };

  private togglePinToCorner = () => {
    this.setState(
      (prev) => {
        const next = !prev.pinToCorner;
        const view = this.state.jimuMapView?.view;

        let pos = prev.popupPosition;

        if (next) {
          if (view) pos = this.calculatePinnedPosition(view);
        } else if (view && prev.clickScreenPoint) {
          pos = this.calculatePopupPosition(prev.clickScreenPoint, view);
        } else if (view) {
          const rect = (view.container as HTMLElement).getBoundingClientRect();
          pos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }

        return {
          pinToCorner: next,
          popupPosition: pos,
          chartExpanded: next ? true : prev.chartExpanded,
        };
      },
      () => {
        this.schedulePopupLayoutAfterContent();
        if (this.state.showPopup) {
          this.broadcastPopupVisibility(true);
        }
      },
    );
  };

  private handleOutsideClick = (event: MouseEvent) => {
    if (!this.state.showPopup || !this._popupRef.current) return;
    // Collapsed chip stays until an empty-map deselect / geography reset.
    if (this.state.popupMinimized) return;

    const target = event.target as Node | null;
    if (!target || this._popupRef.current.contains(target)) return;

    const mapContainer = this.state.jimuMapView?.view?.container;
    if (mapContainer && mapContainer.contains(target)) return;

    if (this.isDashboardEmbedded()) {
      const dashboardUi = (target as HTMLElement).closest?.(
        ".agri-dashboard-v3, .agri-dashboard-crop-overlay, .agri-dashboard-header, .agri-dashboard-left-panel, .agri-dashboard-bottom-row, .agri-dashboard-widget-slot, .agri-dashboard-indicator-overlay, .agri-dashboard-date-index-overlay, .agri-v20-floating-overlay",
      );
      if (dashboardUi) return;
    }

    // Outside dashboard chrome → collapse instead of wiping selection.
    this.minimizePopup();
  };

  private onPopupHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Allow normal behavior for controls inside header.
    const target = e.target as HTMLElement;
    if (target?.closest("button, a, input, textarea, select")) return;
    if (e.button !== 0) return;

    const popupEl = this._popupRef.current;
    if (!popupEl) return;

    const rect = popupEl.getBoundingClientRect();
    this._isDraggingPopup = true;
    this._popupDragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    if (this.state.pinToCorner) {
      this.setState({ pinToCorner: false });
    }

    window.addEventListener("mousemove", this.onPopupDragMove);
    window.addEventListener("mouseup", this.onPopupDragEnd);
    e.preventDefault();
  };

  private onPopupDragMove = (e: MouseEvent) => {
    if (!this._isDraggingPopup || !this._isMounted) return;
    const view = this.state.jimuMapView?.view;
    if (!view) return;

    const nextPos = {
      x: e.clientX - this._popupDragOffset.x,
      y: e.clientY - this._popupDragOffset.y,
    };
    const clamped = this.clampPopupToMapContainer(nextPos, view);
    this.applyPopupPosition(clamped);
  };

  private onPopupDragEnd = () => {
    this._isDraggingPopup = false;
    window.removeEventListener("mousemove", this.onPopupDragMove);
    window.removeEventListener("mouseup", this.onPopupDragEnd);
  };
  /** ✅ NEW: safely detect whether this layer supports attachments */
  private layerSupportsAttachments(
    layer: __esri.FeatureLayer | FeatureLayer | null | undefined,
  ): boolean {
    if (!layer) return false;

    // Different JSAPI/EB builds expose it slightly differently
    const anyLayer: any = layer as any;

    // Common signals
    if (typeof anyLayer.supportsAttachments === "boolean")
      return anyLayer.supportsAttachments;

    const cap = anyLayer.capabilities;
    const supported =
      cap?.data?.supportsAttachments ??
      cap?.data?.supportsAttachment ??
      cap?.operations?.supportsAttachments ??
      cap?.operations?.supportsAttachment;

    if (typeof supported === "boolean") return supported;

    // Unknown => assume false to avoid ugly warning
    return false;
  }

  /* ---------------- Highlight management ---------------- */

  private setupHighlightLayer = (view: __esri.MapView | __esri.SceneView) => {
    if (!this._highlightLayer) {
      this._highlightLayer = new GraphicsLayer({
        id: "agri-polygon-highlight",
        title: "Selected Polygon Highlight",
      });
      view.map.add(this._highlightLayer);
    }
  };

  private highlightPolygon = (geometry: __esri.Geometry) => {
    if (!this._highlightLayer || !geometry) return;
    this.clearHighlight();

    // Drop Graff/table selection graphics so only one outline is visible.
    try {
      this.state.jimuMapView?.view?.graphics?.removeAll?.();
    } catch {
      /* ignore */
    }

    // Wide translucent halo plus a bright cyan core keeps the selected field
    // visible over both light and dark satellite imagery.
    const haloSymbol = new SimpleFillSymbol({
      color: [0, 0, 0, 0],
      outline: new SimpleLineSymbol({
        color: [0, 229, 255, 0.32],
        width: 9,
        style: "solid",
      }),
    });
    const highlightSymbol = new SimpleFillSymbol({
      color: [0, 0, 0, 0],
      outline: new SimpleLineSymbol({
        color: [128, 245, 255, 1],
        width: 3,
        style: "solid",
      }),
    });

    this._highlightHaloGraphic = new Graphic({ geometry, symbol: haloSymbol });
    this._highlightGraphic = new Graphic({ geometry, symbol: highlightSymbol });
    this._highlightLayer.addMany([
      this._highlightHaloGraphic,
      this._highlightGraphic,
    ]);
  };

  private clearHighlight = () => {
    if (!this._highlightLayer) return;
    if (this._highlightHaloGraphic) {
      this._highlightLayer.remove(this._highlightHaloGraphic);
      this._highlightHaloGraphic = null;
    }
    if (this._highlightGraphic) {
      this._highlightLayer.remove(this._highlightGraphic);
      this._highlightGraphic = null;
    }
  };

  private restoreExtentBeforeSelection = () => {
    const view = this.state.jimuMapView?.view;
    const savedExtent = this._extentBeforeSelection;
    this._extentBeforeSelection = null;
    const zoomTo = this.props.config?.settings?.zoomToSelection !== false;
    if (!zoomTo || !savedExtent || !view) return;
    try {
      void view.goTo(savedExtent, { duration: 400 });
    } catch {
      /* ignore */
    }
  };

  private cleanupHighlight = () => {
    if (this._highlightLayer) {
      const view = this.state.jimuMapView?.view;
      if (view && view.map) {
        view.map.remove(this._highlightLayer);
      }
      this._highlightLayer = null;
      this._highlightGraphic = null;
      this._highlightHaloGraphic = null;
    }
    this._extentBeforeSelection = null;
  };

  /* ---------------- Map wiring ---------------- */

  private getLinkedMapWidgetId(): string | null {
    const ids = this.props.useMapWidgetIds as any;
    const list = ids?.length
      ? ids.asMutable?.() || ids.toArray?.() || ids
      : [];
    const first = Array.isArray(list) ? list[0] : null;
    if (first) return String(first);
    const hostId = String(this.props.id || "").replace(/-popup$/, "");
    return discoverMapWidgetIdInApp({
      hostWidgetId: hostId,
      getSlotElement: () => {
        if (hostId) {
          const scoped = document.querySelector(
            `.widget-renderer[data-widgetid="${hostId}"] .agri-dashboard-map-slot`,
          );
          if (scoped instanceof HTMLElement) return scoped;
        }
        const fallback = document.querySelector(".agri-dashboard-map-slot");
        return fallback instanceof HTMLElement ? fallback : null;
      },
    });
  }

  private getMapViewFromManager(
    mapWidgetId: string | null,
  ): JimuMapView | null {
    try {
      const manager = MapViewManager.getInstance();
      if (!manager) return null;
      if (mapWidgetId) {
        const group = manager.getJimuMapViewGroup(mapWidgetId);
        const active = group?.getActiveJimuMapView?.();
        if (active?.view) return active;
        const groupViews = group?.getAllJimuMapViews?.() || [];
        const firstLoaded = groupViews.find((view: any) => view?.view);
        if (firstLoaded) return firstLoaded;
      }
      const all = manager.getAllJimuMapViews?.() || [];
      return (
        all.find((view: any) => view?.view && view?.isActive !== false) ||
        all.find((view: any) => view?.view) ||
        null
      );
    } catch {
      return null;
    }
  }

  private handleMapViewReady = (event: Event): void => {
    const mapWidgetId = (event as CustomEvent<{ mapWidgetId?: string }>).detail
      ?.mapWidgetId;
    const linked = this.getLinkedMapWidgetId();
    if (mapWidgetId && linked && mapWidgetId !== linked) return;
    this.scheduleMapViewFallback();
  };

  private scheduleMapViewFallback = (): void => {
    // Already have a live map view — do NOT re-enter onActiveViewChange
    // (that path setState → initializeMapConnection → scheduleMapViewFallback
    // and freezes the builder with React #185 when featureLayers stay empty).
    if (this.state.jimuMapView?.view) {
      if (!this.state.featureLayers?.length) {
        this.scheduleMapInitRetry(this.state.jimuMapView);
      }
      return;
    }
    const mapWidgetId = this.getLinkedMapWidgetId();
    const fromManager = this.getMapViewFromManager(mapWidgetId);
    if (fromManager?.view) {
      this.onActiveViewChange(fromManager);
      return;
    }
    if (!mapWidgetId) return;
    if (this.mapViewFallbackTimer) clearTimeout(this.mapViewFallbackTimer);
    this.mapViewFallbackTimer = setTimeout(() => {
      this.mapViewFallbackTimer = null;
      if (!this._isMounted) return;
      if (this.state.jimuMapView?.view) return;
      const late = this.getMapViewFromManager(mapWidgetId);
      if (late?.view) this.onActiveViewChange(late);
    }, 600);
  };

  private scheduleMapInitRetry = (jmv: JimuMapView): void => {
    if (this.mapInitRetryCount >= this.maxMapInitRetries) return;
    if (this.mapInitRetryTimer) clearTimeout(this.mapInitRetryTimer);
    this.mapInitRetryCount += 1;
    this.mapInitRetryTimer = setTimeout(() => {
      this.mapInitRetryTimer = null;
      if (!this._isMounted) return;
      void this.initializeMapConnection(jmv);
    }, 800);
  };

  private expandUseDataSourceEntries(useList: any[]): any[] {
    const dsMgr = DataSourceManager.getInstance();
    const out: any[] = [];
    const seen = new Set<string>();

    for (const uds of useList) {
      const id = String(uds?.dataSourceId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(uds);

      const ds = dsMgr.getDataSource(id) as any;
      const children = ds?.getChildDataSources?.() || [];
      for (const child of children) {
        const childId = String(child?.id || "");
        if (!childId || seen.has(childId)) continue;
        seen.add(childId);
        out.push({ dataSourceId: childId, mainDataSourceId: id });
      }
    }

    return out;
  }

  private addResolvedLayer = (
    target: __esri.FeatureLayer[],
    layerKeyToDsId: Record<string, string>,
    seen: Set<string>,
    layer: any,
    dsId?: string,
  ): void => {
    const queryable = getQueryableLayer(layer) || layer;
    if (!isQueryableFieldLayer(queryable)) return;
    const key =
      getEvapoLayerMapKey(queryable) ||
      String(queryable.url || queryable.id || "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    target.push(queryable as __esri.FeatureLayer);
    if (dsId) layerKeyToDsId[key] = dsId;
  };

  private collectLayersFromDataSources = (
    jmv: JimuMapView,
    useList: any[],
  ): {
    layers: __esri.FeatureLayer[];
    layerKeyToDsId: Record<string, string>;
  } => {
    const layers: __esri.FeatureLayer[] = [];
    const layerKeyToDsId: Record<string, string> = {};
    const seen = new Set<string>();
    const map = jmv?.view?.map;

    for (const uds of useList) {
      const dsId = String(uds?.dataSourceId || "");
      if (!dsId) continue;

      const cachedDs = this.state.dataSourcesById?.[dsId] as any;
      if (cachedDs) {
        const cachedLayer =
          cachedDs.layer ||
          (typeof cachedDs.getLayer === "function"
            ? cachedDs.getLayer()
            : null);
        const live = this.toLiveMapLayer(cachedLayer, map);
        if (live) this.addResolvedLayer(layers, layerKeyToDsId, seen, live, dsId);
      }

      const dsMgr = DataSourceManager.getInstance();
      const ds = dsMgr.getDataSource(dsId) as any;
      if (ds) {
        const dsLayer =
          (typeof ds.getLayer === "function" ? ds.getLayer() : null) ||
          ds.layer;
        const live = this.toLiveMapLayer(
          getQueryableLayer(dsLayer) || dsLayer,
          map,
        );
        if (live) this.addResolvedLayer(layers, layerKeyToDsId, seen, live, dsId);
      }
    }

    return { layers, layerKeyToDsId };
  };

  onActiveViewChange = (jimuMapView: JimuMapView) => {
    this.detachMapClick();
    this.cleanupHighlight();

    if (!jimuMapView) {
      this.mapAreaResizeObserver?.disconnect();
      this.mapAreaResizeObserver = null;
      this.connectedMapViewId = "";
      this.setState({
        jimuMapView: null,
        featureLayers: [],
        objectIdField: null,
        error: this.tr("error.noMapView"),
        debugInfo: {
          ...this.state.debugInfo,
          layerInfo: this.tr("error.noMapView"),
        },
      });
      return;
    }

    const activeView = jimuMapView.view;
    if (activeView) {
      this.observeMapAreaResize(activeView);
    }

    const viewId = String(
      (jimuMapView as any).id || (jimuMapView as any).mapWidgetId || "",
    );
    // Same map already wired — do not setState again (causes freeze loops).
    if (viewId && viewId === this.connectedMapViewId && this.state.jimuMapView) {
      if (!this._clickHandle) this.attachMapClick(jimuMapView);
      if (!this.state.featureLayers?.length) {
        void this.initializeMapConnection(jimuMapView);
      }
      return;
    }
    this.connectedMapViewId = viewId;

    this.setState({ jimuMapView }, async () => {
      const view = jimuMapView.view;
      if (!view) return;

      // Attach immediately so the first field click never races layer resolve.
      this.attachMapClick(jimuMapView);

      if (view.ready) {
        this.setupHighlightLayer(view);
        await this.initializeMapConnection(jimuMapView);
        this.repositionPinnedIfNeeded();
      } else {
        const h = view.watch("ready", async (ready) => {
          if (ready) {
            h.remove();
            this.attachMapClick(jimuMapView);
            this.setupHighlightLayer(view);
            await this.initializeMapConnection(jimuMapView);
            this.repositionPinnedIfNeeded();
          }
        });
      }
    });
  };

  private initializeMapConnection = async (jmv: JimuMapView) => {
    if (!this._isMounted) return;
    const view = jmv?.view;
    if (!view || !view.map) return;

    const rawList = (this.props.useDataSources?.asMutable?.() as any[]) || [];
    const useList = this.expandUseDataSourceEntries(rawList);
    // Empty useDataSources is normal right after drop — resolve map layers only.
    // Never bounce through scheduleMapViewFallback here (that re-entered
    // onActiveViewChange and froze the page).

    this.dataSourceEngine.syncSelection(getSelectedDsIds(this.props.useDataSources));

    const resolvedLayers: __esri.FeatureLayer[] = [];
    const layerKeyToDsId: Record<string, string> = {};
    const seen = new Set<string>();

    const mapLayers = getAllFeatureLayersFromMap(view.map);
    // load() rehydrates MapImage sublayers and can drop their runtime
    // district definitionExpression — snapshot and repair synchronously so
    // a connect/retry that overlaps a field click never flashes other
    // districts' fields.
    const definitionSnapshot = this.snapshotDefinitionExpressions(mapLayers);
    for (const layer of mapLayers) {
      try {
        if (typeof layer.load === "function") await layer.load();
      } catch {
        /* ignore */
      }
      this.addResolvedLayer(resolvedLayers, layerKeyToDsId, seen, layer);
    }
    this.restoreDriftedDefinitionExpressions(definitionSnapshot);

    if (useList.length) {
      const fromDs = this.collectLayersFromDataSources(jmv, useList);
      for (const layer of fromDs.layers) {
        const live = this.toLiveMapLayer(layer, view.map) || layer;
        const key = getEvapoLayerMapKey(live) || String(live.url || live.id || "");
        const dsId = fromDs.layerKeyToDsId[key];
        this.addResolvedLayer(resolvedLayers, layerKeyToDsId, seen, live, dsId);
      }

      for (const useDs of useList) {
        const layer = await this.resolveFeatureLayerForUseDataSource(jmv, useDs);
        if (!layer) continue;

        try {
          await layer.load();
        } catch {
          /* ignore */
        }

        const dsId = String(useDs?.dataSourceId || "");
        const live = this.toLiveMapLayer(layer, view.map) || layer;
        this.addResolvedLayer(resolvedLayers, layerKeyToDsId, seen, live, dsId);
      }
    }

    if (!this._isMounted) return;

    if (!resolvedLayers.length) {
      // Soft fail — map may still be loading region-year sublayers. Retry
      // a few times without re-entering onActiveViewChange.
      // Still attach the click handler so the first field click works as soon
      // as live MapImage sublayers become hittable via getClickTargetLayers.
      if (!this._clickHandle) this.attachMapClick(jmv);
      if (
        this.state.error !== this.tr("error.selectedLayersMissing") ||
        (this.state.featureLayers?.length || 0) > 0
      ) {
        this.setState({
          featureLayers: [],
          objectIdField: null,
          error: useList.length
            ? this.tr("error.selectedLayersMissing")
            : null,
        });
      }
      this.scheduleMapInitRetry(jmv);
      return;
    }

    this.mapInitRetryCount = 0;
    evapoMapClickDebug("initializeMapConnection OK", {
      layerCount: resolvedLayers.length,
      layers: resolvedLayers.map((l) => l.title || l.url || l.id),
    });

    const prevKeys = (this.state.featureLayers || [])
      .map((l) => getEvapoLayerMapKey(l) || String(l.url || l.id || ""))
      .join("|");
    const nextKeys = resolvedLayers
      .map((l) => getEvapoLayerMapKey(l) || String(l.url || l.id || ""))
      .join("|");
    if (prevKeys === nextKeys && this._clickHandle) {
      this.attachMapClick(jmv);
      return;
    }

    this.setState(
      {
        featureLayers: resolvedLayers,
        layerKeyToDsId,
        error: null,
        debugInfo: {
          ...this.state.debugInfo,
          layerInfo: resolvedLayers.map((l) => ({
            id: l.id,
            title: l.title,
            url: l.url,
            objectIdField: l.objectIdField,
          })),
        },
      },
      () => {
        if (!this._isMounted) return;
        this.attachMapClick(jmv);
      },
    );
  };

  private toLiveMapLayer = (
    layer: any,
    map: __esri.Map | null | undefined,
  ): __esri.FeatureLayer | null => {
    if (!layer) return null;
    const url = String(layer?.url || "");
    if (map && url) {
      const byUrl = findQueryableLayerOnMapByUrl(map, url);
      if (byUrl) return byUrl as __esri.FeatureLayer;
    }
    if (map && layer?.id != null) {
      const byId = findQueryableLayerOnMapById(map, String(layer.id));
      if (byId) return byId as __esri.FeatureLayer;
    }
    const queryable = getQueryableLayer(layer);
    return (queryable || layer) as __esri.FeatureLayer;
  };

  private layerKeysMatch = (a: any, b: any): boolean => {
    if (!a || !b) return false;
    const keyA = getEvapoLayerMapKey(a);
    const keyB = getEvapoLayerMapKey(b);
    if (keyA && keyB && keyA === keyB) return true;
    if (a.id != null && b.id != null && String(a.id) === String(b.id)) {
      return true;
    }
    const urlA = normalizeQueryableLayerUrl(String(a.url || ""));
    const urlB = normalizeQueryableLayerUrl(String(b.url || ""));
    return !!(urlA && urlB && urlA === urlB);
  };

  /** Resolve the live map layer for a selected useDataSource (FeatureLayer or MapImage sublayer). */
  private resolveFeatureLayerForUseDataSource = async (
    jmv: JimuMapView,
    useDs: any,
  ): Promise<__esri.FeatureLayer | null> => {
    try {
      if (!useDs?.dataSourceId) return null;

      const dsId = String(useDs.dataSourceId);
      const map = jmv?.view?.map;
      if (!map) return null;

      const jlvByApi = (jmv as any).getJimuLayerViewByDataSourceId?.(dsId);
      const fromApi = getQueryableLayer(jlvByApi?.layer);
      if (fromApi) return this.toLiveMapLayer(fromApi, map);

      const jlvList: any[] = jmv.getAllJimuLayerViews?.() || [];
      const layerIdHint = extractMapLayerIdFromDsId(dsId);

      for (const lv of jlvList) {
        if (
          lv?.layerDataSourceId === dsId ||
          lv?.dataSourceId === dsId
        ) {
          const resolved = getQueryableLayer(lv?.layer);
          if (resolved) return this.toLiveMapLayer(resolved, map);
        }
      }

      if (layerIdHint) {
        const match = jlvList.find(
          (lv) => String(lv?.layer?.id || "") === layerIdHint,
        );
        const resolved = getQueryableLayer(match?.layer);
        if (resolved) return this.toLiveMapLayer(resolved, map);
      }

      const dsMgr = DataSourceManager.getInstance();
      const ds: any = dsMgr.getDataSource(dsId);
      if (ds) {
        try {
          if (typeof ds.fetchSchema === "function") await ds.fetchSchema();
        } catch {
          /* schema optional */
        }

        const dsLayer =
          (typeof ds.getLayer === "function" ? ds.getLayer() : null) ||
          ds.layer ||
          (typeof ds.getJimuLayer === "function" ? ds.getJimuLayer() : null);
        const queryable = getQueryableLayer(dsLayer);
        if (queryable) {
          const live = this.toLiveMapLayer(queryable, map);
          if (live) return live;
        }

        const dsUrl = String(ds?.url || queryable?.url || dsLayer?.url || "");
        if (dsUrl) {
          const byUrl = findQueryableLayerOnMapByUrl(map, dsUrl);
          if (byUrl) return byUrl as __esri.FeatureLayer;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  private clampPopupToMapContainer = (
    pos: { x: number; y: number },
    view: __esri.MapView | __esri.SceneView,
  ) => {
    const container = view.container as HTMLElement;
    const rect = container.getBoundingClientRect();
    const margin = this.POPUP_MARGIN;
    const pinned = this.state.pinToCorner;
    const { width: popupW, height: popupH } = this.getPopupDimensions(
      view,
      pinned,
      pos,
    );

    const mapLeft = rect.left;
    const mapTop = rect.top;
    const mapRight = rect.right;
    const mapBottom = this.getEffectiveMapBottom(view, margin);

    const x = Math.max(
      mapLeft + margin,
      Math.min(pos.x, mapRight - popupW - margin),
    );

    let y = pos.y;
    if (y + popupH > mapBottom) {
      y = mapBottom - popupH - margin;
    }
    y = Math.max(mapTop + margin, y);

    return { x, y };
  };

  private attachMapClick(jmv: JimuMapView) {
    this.detachMapClick();
    const view = jmv?.view as { on?: (event: string, cb: unknown) => unknown } | null;
    if (!view || typeof view.on !== "function") return;
    this._clickHandle = view.on("click", this.onViewClick) as any;
  }

  private ensureMapClickAttached = (): boolean => {
    if (!this._isMounted) return false;
    const mapWidgetId = this.getLinkedMapWidgetId();
    const jmv =
      this.state.jimuMapView?.view
        ? this.state.jimuMapView
        : this.getMapViewFromManager(mapWidgetId);
    if (!jmv?.view) return false;

    if (!this.state.jimuMapView?.view) {
      this.onActiveViewChange(jmv);
      return true;
    }

    if (!this._clickHandle) {
      this.attachMapClick(jmv);
    }
    return !!this._clickHandle;
  };

  private handleXyPageClosed = (): void => {
    if (!this.isDashboardEmbedded()) return;
    if (this.state.showPopup) {
      this.closePopup({ restoreExtent: false, notifyDeselect: false });
    }
  };

  /**
   * Close the field popup when the hub geography moves (other tuman /
   * viloyat / year) or when polygon focus is cleared. Do not restore the
   * pre-field extent on geography change — Localization is already zooming
   * to the new district/region.
   */
  private handleMasterFilterChanged = (event: Event): void => {
    if (!this._isMounted) return;
    const detail: any = (event as CustomEvent).detail || {};
    const f: any = detail.filters || {};
    const geoKey = `${String(f.yil || "")}|${String(f.viloyat || "")}|${String(f.tuman || "")}`;
    const prevGeo = this._lastMasterGeoKey;
    this._lastMasterGeoKey = geoKey;

    const geoChanged = Boolean(prevGeo) && prevGeo !== geoKey;
    const polygonCleared = f.polygonMode === false;
    const incomingUnique = String(f.uniqueid || "")
      .replace(/[{}]/g, "")
      .trim();
    if (f.polygonMode === true && incomingUnique) {
      this._activeInspectedUniqueid = incomingUnique;
      // Fallback: if selection arrived via hub but popup is still closed, open it.
      if (!this.state.showPopup) {
        void this.openPopupForUniqueid(incomingUnique, {
          zoom: false,
          notifySelection: false,
        });
      }
    } else if (polygonCleared) {
      this._activeInspectedUniqueid = null;
    }

    if (geoChanged) {
      this.closePopup({ restoreExtent: false, notifyDeselect: false });
      return;
    }
    // Same geography but hub cleared polygon focus (e.g. Graff deselect).
    if (polygonCleared && (this.state.showPopup || this.state.loading)) {
      this.closePopup({ restoreExtent: true, notifyDeselect: false });
    }
  };

  /** Immediate close when Region/Pie/year change geography (before map sync finishes). */
  private handleWidgetSelectionChanged = (event: Event): void => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent).detail || {};
    // Our own polygon notify must not close the popup we just opened.
    if (d.source === "AgriPopup") return;
    if (
      d.yil !== undefined ||
      d.viloyat !== undefined ||
      d.tuman !== undefined
    ) {
      this.closePopup({ restoreExtent: false, notifyDeselect: false });
      return;
    }
    if (d.polygonMode === false) {
      this._activeInspectedUniqueid = null;
      this.closePopup({ restoreExtent: true, notifyDeselect: false });
      return;
    }
    if (
      (d.source === "AgriGraffWidget" || d.source === "AgriGraff10") &&
      d.polygonMode === true &&
      d.uniqueid
    ) {
      const clean = String(d.uniqueid)
        .replace(/[{}]/g, "")
        .trim();
      this._activeInspectedUniqueid = clean;
      // Table / Graff selection must always open the field popup.
      void this.openPopupForUniqueid(clean, {
        zoom: false,
        notifySelection: false,
      });
    }
  };

  /**
   * Open (or refresh) the field popup for a polygon uniqueid — used when
   * selection comes from the table/Graff path (map click already opens itself).
   */
  private openPopupForUniqueid = async (
    uniqueid: string,
    opts?: { zoom?: boolean; notifySelection?: boolean },
  ): Promise<void> => {
    const clean = String(uniqueid || "")
      .replace(/[{}]/g, "")
      .trim();
    if (!clean || !this._isMounted) return;

    const active = String(this._activeInspectedUniqueid || "")
      .replace(/[{}]/g, "")
      .trim();
    if (this.state.showPopup && active === clean && this.state.selectedAttrs) {
      if (this.state.popupMinimized) {
        this.expandPopup();
      } else {
        this.broadcastPopupVisibility(true);
      }
      return;
    }

    const jmv = this.state.jimuMapView;
    const view = jmv?.view;
    if (!view || !jmv) return;

    const clickGeneration = ++this._clickGeneration;
    const isStale = () =>
      !this._isMounted || clickGeneration !== this._clickGeneration;

    this.setState({
      loading: true,
      error: null,
      loadingAttachments: true,
      attachments: [],
      attachmentsExpanded: true,
    });

    try {
      const layers = await this.resolveClickLayers(view, jmv);
      if (isStale()) return;

      let feature: __esri.Graphic | null = null;
      let clickedLayer: __esri.FeatureLayer | null = null;

      for (const layer of layers) {
        if (!this.isAgriculturalFieldLayer(layer)) continue;
        if (!this.isLayerEffectivelyVisible(layer, view)) continue;
        const detached = await this.getDetachedQueryLayer(layer);
        if (isStale()) return;
        const queryTarget = detached || layer;
        const variants = [clean, `{${clean}}`];
        for (const v of variants) {
          const q = queryTarget.createQuery();
          q.outFields = ["*"];
          q.returnGeometry = true;
          q.num = 1;
          const escaped = String(v).replace(/'/g, "''");
          q.where = `${AGRI_TABLE_JOIN_FIELD}='${escaped}'`;
          try {
            const res = await queryTarget.queryFeatures(q);
            if (res.features?.[0]) {
              feature = res.features[0];
              clickedLayer = layer;
              break;
            }
          } catch {
            /* try next variant / layer */
          }
        }
        if (feature) break;
      }

      if (!feature || !clickedLayer || isStale()) {
        if (!isStale()) {
          this.setState({
            loading: false,
            loadingAttachments: false,
            attachments: [],
          });
        }
        return;
      }

      const liveLayer =
        (this.toLiveMapLayer(clickedLayer, view.map) ||
          clickedLayer) as __esri.FeatureLayer;
      const layerKey =
        getEvapoLayerMapKey(liveLayer) ||
        String(liveLayer?.url || liveLayer?.id || "");
      const dsId = this.state.layerKeyToDsId?.[layerKey] || null;
      const oidField =
        liveLayer.objectIdField ||
        liveLayer.fields?.find((f: any) => f.type === "oid")?.name ||
        null;
      if (!oidField) {
        if (!isStale()) {
          this.setState({
            loading: false,
            loadingAttachments: false,
            showPopup: false,
          });
        }
        return;
      }

      const oid = feature.attributes?.[oidField];
      if (oid == null) {
        if (!isStale()) {
          this.setState({
            loading: false,
            loadingAttachments: false,
            showPopup: false,
          });
        }
        return;
      }

      const outFields = this.getOutFields(liveLayer as any, oidField);
      const f =
        (await this.queryFeatureByObjectIdCached(
          liveLayer,
          oidField,
          oid,
          outFields,
        )) || feature;
      if (isStale()) return;

      if (f.geometry) this.highlightPolygon(f.geometry);

      const displayAttrs = await this.resolveDisplayAttrs(f.attributes);
      if (isStale()) return;

      const shouldPin = this.state.pinToCorner;
      const popupPosition = shouldPin
        ? this.calculatePinnedPosition(view)
        : this.state.popupPosition || this.calculatePinnedPosition(view);

      const configuredFields = this.props.config?.fieldsToShow || [];
      const actualFields = Object.keys(displayAttrs);
      const missingFields = configuredFields.filter(
        (field) => !actualFields.includes(field),
      );
      const fieldsWithData = configuredFields.filter(
        (name) =>
          displayAttrs.hasOwnProperty(name) &&
          displayAttrs[name] != null &&
          displayAttrs[name] !== "",
      );

      this._activeInspectedUniqueid = clean;
      this.setState({
        loading: false,
        lastClickedDsId: dsId,
        lastClickedLayerKey: layerKey,
        selectedAttrs: displayAttrs,
        selectedOID: Number(oid),
        objectIdField: oidField,
        showPopup: true,
        popupMinimized: false,
        chartExpanded: shouldPin,
        chartHoverIndex: null,
        popupPosition,
        error:
          missingFields.length > 0
            ? this.tr("error.configuredFieldMissing", {
                fields: missingFields.join(", "),
              })
            : fieldsWithData.length === 0 && configuredFields.length > 0
              ? this.tr("error.noDataForConfiguredFields")
              : null,
      });

      if (opts?.notifySelection) {
        this.notifyGraffPolygonSelection(clean, true, Date.now());
      }
      void this.fetchLatestVegetationIndices(clean);

      if (opts?.zoom !== false && f.geometry && !isStale()) {
        try {
          if (!this._extentBeforeSelection && view.extent?.clone) {
            this._extentBeforeSelection = view.extent.clone();
          }
          const target =
            (f.geometry as any).extent?.expand?.(1.08) || f.geometry;
          void view.goTo(
            { target },
            { duration: 650, easing: "ease-in-out" as any },
          );
        } catch {
          /* ignore */
        }
      }

      if (this.props.config?.settings?.showAttachments !== false) {
        try {
          const clickedUrl = String((liveLayer as any).url || "").trim();
          const attachmentLayer =
            (clickedUrl && this._queryOnlyLayers.get(clickedUrl)) || liveLayer;
          await this.loadAttachmentsForOid(attachmentLayer as any, Number(oid));
        } catch {
          if (!isStale()) {
            this.setState({ loadingAttachments: false, attachments: [] });
          }
        }
      } else if (!isStale()) {
        this.setState({ loadingAttachments: false, attachments: [] });
      }

      if (!isStale()) {
        this.schedulePopupLayoutAfterContent();
      }
    } catch (e: any) {
      if (!isStale()) {
        this.setState({
          loading: false,
          loadingAttachments: false,
          error: e?.message || String(e),
        });
      }
    }
  };

  private handleSharedMapClick = async (event: Event): Promise<void> => {
    // Always ignore the Localization click bus. AgriPopup owns view.on("click")
    // exclusively — handling both races two full onViewClick chains: the loser
    // often clears showPopup, restores the pre-selection extent, and flashes
    // other-district fields. Localization may still dispatch for other listeners.
    evapoMapClickDebug(
      "AgriPolygon ← shared map-click SKIP (direct view click is sole owner)",
    );
    return;
  };

  private detachMapClick() {
    if (this._clickHandle?.remove) this._clickHandle.remove();
    this._clickHandle = null;
  }

  /* ---------------- Click → hitTest → query full attrs ---------------- */

  private toClickQueryGeometry = (
    view: __esri.MapView | __esri.SceneView,
    screenPoint: { x: number; y: number },
    mapPoint?: { x?: number; y?: number; spatialReference?: { wkid?: number } },
  ): __esri.Point | null => {
    if (typeof view.toMap === "function") {
      try {
        const fromView = view.toMap(screenPoint);
        if (fromView) return fromView as __esri.Point;
      } catch {
        /* ignore */
      }
    }
    const x = Number(mapPoint?.x);
    const y = Number(mapPoint?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    try {
      return new Point({
        x,
        y,
        spatialReference:
          mapPoint?.spatialReference || (view as any).spatialReference,
      });
    } catch {
      return null;
    }
  };

  private findHitGraphic = (
    hit: __esri.HitTestResult | null | undefined,
    layers: __esri.FeatureLayer[],
  ): __esri.Graphic | null => {
    const hitResult = hit?.results?.find((r) => {
      if ("graphic" in r && r.graphic) {
        const lyr: any = r.graphic.layer;
        if (!lyr) return false;
        return layers.some((L) => this.layerKeysMatch(L, lyr));
      }
      return false;
    });
    return hitResult && "graphic" in hitResult ? hitResult.graphic : null;
  };

  private pickClickGraphic = (
    hit: __esri.HitTestResult | null | undefined,
    preferredLayers: __esri.FeatureLayer[],
  ): __esri.Graphic | null => {
    const activeView = this.state.jimuMapView?.view;
    const map = activeView?.map;
    const candidates: __esri.Graphic[] = [];
    const restrictToPreferred = preferredLayers.length > 0;

    for (const r of hit?.results || []) {
      if (!r || typeof r !== "object") continue;
      const graphic =
        "graphic" in r && (r as any).graphic
          ? ((r as any).graphic as __esri.Graphic)
          : null;
      if (!graphic) continue;

      const rawLayer: any = graphic.layer;
      if (this.isHighlightLayer(rawLayer)) continue;

      const layer = this.toLiveMapLayer(
        getQueryableLayer(rawLayer) || rawLayer,
        map,
      );
      if (!layer || !this.isAgriculturalFieldLayer(layer)) continue;
      if (!activeView || !this.isLayerEffectivelyVisible(layer, activeView)) continue;
      if (!this.isAgriculturalFieldGraphic(graphic, layer)) continue;
      if (
        restrictToPreferred &&
        !preferredLayers.some((L) => this.layerKeysMatch(L, layer))
      ) {
        continue;
      }

      const geomType = String(graphic.geometry?.type || "").toLowerCase();
      const isPolygonLike =
        !geomType || geomType === "polygon" || geomType === "multipolygon";
      const hasAttributes =
        !!graphic.attributes && Object.keys(graphic.attributes).length > 0;

      if (geomType && !isPolygonLike) continue;
      if (!hasAttributes && !graphic.geometry) continue;

      candidates.push(graphic);
    }

    if (!candidates.length) return null;

    if (restrictToPreferred) {
      for (const graphic of candidates) {
        const layer = this.toLiveMapLayer(
          getQueryableLayer(graphic.layer) || graphic.layer,
          map,
        );
        if (
          layer &&
          preferredLayers.some((L) => this.layerKeysMatch(L, layer)) &&
          (layer as any).visible !== false
        ) {
          return graphic;
        }
      }
      return null;
    }

    for (const graphic of candidates) {
      const layer: any = graphic.layer;
      if (layer?.visible !== false) return graphic;
    }

    return candidates[0];
  };

  private isHighlightLayer(layer: any): boolean {
    const id = String(layer?.id || "").toLowerCase();
    const title = String(layer?.title || "").toLowerCase();
    return id === "agri-polygon-highlight" ||
      title.includes("selected polygon highlight") ||
      title.includes("sketch");
  }

  /** A sublayer is clickable only when it and every parent are visible. */
  private isLayerEffectivelyVisible(
    layer: any,
    view: __esri.MapView | __esri.SceneView,
  ): boolean {
    if (!layer || this.isHighlightLayer(layer)) return false;
    const seen = new Set<any>();
    let current: any = layer;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current.visible === false) return false;
      current = current.parent || current.layer || null;
    }
    const scale = Number((view as any)?.scale || 0);
    const minScale = Number(layer.minScale || 0);
    const maxScale = Number(layer.maxScale || 0);
    if (scale > 0 && minScale > 0 && scale > minScale) return false;
    if (scale > 0 && maxScale > 0 && scale < maxScale) return false;
    return String(layer.definitionExpression || "1=1").trim() !== "1=0";
  }

  private isAgriculturalFieldLayer(layer: any): boolean {
    if (!layer) return false;
    // Prefer queryable layers, but title/url identity is enough to accept a
    // live MapImage leaf that is still hydrating its query methods.
    const identity = `${layer.title || ""} ${layer.url || ""} ${layer.parent?.title || ""}`.toLowerCase();
    const looksAgri = /\bagri\b|agriculture|qishloq/.test(identity);
    if (!isQueryableFieldLayer(layer) && !looksAgri) return false;
    const geometryType = String(layer.geometryType || "").toLowerCase();
    if (geometryType && geometryType !== "polygon") return false;
    const fields: any[] = Array.isArray(layer.fields) ? layer.fields : [];
    const names = new Set(fields.map((field) => String(field?.name || "").toLowerCase()));
    if (names.has("uniqueid") || names.has("crop_id") || names.has("turi")) return true;
    return looksAgri;
  }

  private isAgriculturalFieldGraphic(graphic: __esri.Graphic, layer: any): boolean {
    const geometryType = String(graphic?.geometry?.type || "").toLowerCase();
    if (geometryType && geometryType !== "polygon" && geometryType !== "multipolygon") return false;
    const attrs = graphic?.attributes || {};
    const keys = new Set(Object.keys(attrs).map((key) => key.toLowerCase()));
    return keys.has("uniqueid") || keys.has("crop_id") || keys.has("turi") ||
      this.isAgriculturalFieldLayer(layer);
  }
  private getClickTargetLayers(
    view: __esri.MapView | __esri.SceneView,
  ): __esri.FeatureLayer[] {
    const { featureLayers, layerKeyToDsId } = this.state;
    const dsKeys = Object.keys(layerKeyToDsId || {});
    const map = view.map;
    const configuredLayers = featureLayers || [];
    const liveRoots =
      ((map as any)?.allLayers?.toArray?.() as any[]) || [];
    // MapImage parents are not queryable — expand to agri/feature sublayers.
    const liveMapLayers: __esri.FeatureLayer[] = [];
    const seen = new Set<string>();
    const pushLive = (layer: any) => {
      if (!layer || !isQueryableFieldLayer(layer)) return;
      const key =
        getEvapoLayerMapKey(layer) ||
        String(layer.url || layer.id || "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      liveMapLayers.push(layer as __esri.FeatureLayer);
    };
    for (const root of liveRoots) {
      const direct = getQueryableLayer(root);
      if (direct) pushLive(direct);
      const nested =
        (root as any)?.allSublayers?.toArray?.() ||
        (root as any)?.sublayers?.toArray?.() ||
        [];
      for (const sub of nested) {
        pushLive(getQueryableLayer(sub) || sub);
      }
    }

    const candidates = Array.from(
      new Set<__esri.FeatureLayer>([
        ...configuredLayers,
        ...liveMapLayers,
      ]),
    );

    return candidates
      .map((layer) => this.toLiveMapLayer(layer, map) || layer)
      .filter((layer: any) => {
        if (!this.isLayerEffectivelyVisible(layer, view)) return false;
        if (!this.isAgriculturalFieldLayer(layer)) return false;
        const key =
          getEvapoLayerMapKey(layer) ||
          String(layer.url || layer.id || "");
        if (this.isDashboardEmbedded()) return true;
        if (!dsKeys.length) return true;
        return !!layerKeyToDsId[key];
      }) as __esri.FeatureLayer[];
  }

  private async resolveClickLayers(
    view: __esri.MapView | __esri.SceneView,
    jmv: JimuMapView,
  ): Promise<__esri.FeatureLayer[]> {
    let layers = this.getClickTargetLayers(view);
    if (layers.length) return layers;

    await this.initializeMapConnection(jmv);
    layers = this.getClickTargetLayers(view);
    if (layers.length) return layers;

    // Last resort: scan map again after layers may have finished loading
    // (portal / MapImage sublayers often aren't queryable at first connect).
    try {
      const mapLayers = getAllFeatureLayersFromMap(view.map);
      for (const layer of mapLayers) {
        try {
          if (typeof layer.load === "function") await layer.load();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return this.getClickTargetLayers(view);
  }

  private resolveClickFeatureAt = async (
    ev: __esri.ViewClickEvent,
    view: __esri.MapView | __esri.SceneView,
    layers: __esri.FeatureLayer[],
  ): Promise<{
    graphic: __esri.Graphic;
    queryHitLayer: __esri.FeatureLayer | null;
  } | null> => {
    const clickScreenPoint = { x: ev.x, y: ev.y };
    const queryGeometry = this.toClickQueryGeometry(
      view,
      clickScreenPoint,
      ev.mapPoint,
    );

    const queryLayers =
      layers.length > 0
        ? layers
        : (this.getClickTargetLayers(view) as __esri.FeatureLayer[]);

    // hitTest / identify can rehydrate MapImage sublayers and clear their
    // runtime definitionExpression (district filter) — snapshot every click
    // candidate now and restore any drift synchronously afterwards, before
    // an unfiltered export gets painted (other-district fields flash).
    const definitionSnapshot = this.snapshotDefinitionExpressions([
      ...layers,
      ...queryLayers,
    ]);

    // Always hit-test the rendered map without an include restriction. Map-image
    // sublayers frequently have runtime ids/URLs that differ from configured DS
    // wrappers; restricting include/preferred layers makes visible fields unclickable.
    const hit = await view.hitTest(ev);
    this.restoreDriftedDefinitionExpressions(definitionSnapshot);
    // Only accept graphics belonging to the configured agricultural layers.
    // WebMap sketch/map-notes graphics can contain page-sized polygons; treating
    // one as a field makes goTo zoom out to a world extent.
    // Empty `layers` still allows agricultural hits (no preferred restriction).
    let g = this.pickClickGraphic(hit, layers);
    let queryHitLayer: __esri.FeatureLayer | null = null;

    if (!g && queryGeometry && queryLayers.length) {
      for (const layer of queryLayers) {
        if (!this.isLayerEffectivelyVisible(layer, view)) continue;
        if (!this.isAgriculturalFieldLayer(layer)) continue;
        try {
          // NEVER query the live layer here: on a MapImage sublayer that
          // rehydrates it and clears the tuman definitionExpression, so the
          // map briefly exports/paints every district's fields while the
          // popup zoom runs. Use the detached off-map client instead and
          // mirror the live filter onto the query WHERE.
          const liveWhere = String(
            (layer as any).definitionExpression || "",
          ).trim();
          const detached = await this.getDetachedQueryLayer(layer);
          const queryTarget = detached || layer;
          const q = queryTarget.createQuery();
          q.geometry = queryGeometry;
          q.spatialRelationship = "intersects";
          q.outFields = ["*"];
          q.returnGeometry = true;
          q.num = 1;
          if (liveWhere && liveWhere !== "1=1") q.where = liveWhere;
          const res = await queryTarget.queryFeatures(q);
          if (!detached) {
            // Live-layer fallback (no URL) — repair any drift immediately.
            this.restoreDriftedDefinitionExpressions(definitionSnapshot);
          }
          if (res.features?.[0]) {
            g = res.features[0];
            // Keep the LIVE layer as the hit layer — downstream layer-key /
            // dsId / alias resolution must map back to the map's own layer.
            queryHitLayer = layer;
            break;
          }
        } catch {
          /* try next layer */
        }
      }
    }

    if (!g) return null;
    return { graphic: g, queryHitLayer };
  };

  /** Case-insensitive attribute lookup — the polygon layer's join field casing is not guaranteed. */
  private findAttributeValueCaseInsensitive(
    attributes: Record<string, any> | null | undefined,
    fieldName: string,
  ): any {
    if (!attributes) return null;
    const target = fieldName.toLowerCase();
    const key = Object.keys(attributes).find(
      (k) => k.toLowerCase() === target,
    );
    return key ? attributes[key] : null;
  }

  /**
   * Tells AgriGraff10 (via AgriLocalization, the central filter hub) which
   * polygon is currently inspected so its chart can switch to showing that
   * single polygon's vegetation-index series instead of the region-wide
   * timeseries. Mirrors the widgetSelectionChanged shape AgriGraffWidget
   * itself already dispatches on its own row-click selection.
   */
  private notifyGraffPolygonSelection = (
    uniqueid: string,
    polygonMode: boolean,
    clickedAt?: number,
  ): void => {
    try {
      document.dispatchEvent(
        new CustomEvent("widgetSelectionChanged", {
          detail: {
            source: "AgriPopup",
            polygonMode,
            uniqueid: polygonMode ? uniqueid : "",
            // Timestamp of the ORIGINAL map click (captured before this
            // widget's own async attribute-resolution chain), not of this
            // dispatch — lets downstream listeners (AgriGraff10) detect and
            // ignore a stale notification that resolves after a newer click
            // was already applied (see AgriGraff10's _lastAppliedPolygonClickedAt).
            clickedAt: clickedAt ?? Date.now(),
            timestamp: Date.now(),
          },
          bubbles: true,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  private broadcastPopupVisibility = (open: boolean): void => {
    const pinned = !!this.state.pinToCorner;
    try {
      document.dispatchEvent(
        new CustomEvent("agriMapPopupVisibility", {
          detail: {
            open: !!open,
            pinned,
            source: "AgriPopup",
            timestamp: Date.now(),
          },
          bubbles: true,
        }),
      );
    } catch {
      /* ignore */
    }
    if (open) {
      // Re-notify after paint so NDVI can measure the real popup box.
      requestAnimationFrame(() => {
        try {
          document.dispatchEvent(
            new CustomEvent("agriMapPopupVisibility", {
              detail: {
                open: true,
                pinned,
                layout: true,
                source: "AgriPopup",
                timestamp: Date.now(),
              },
              bubbles: true,
            }),
          );
        } catch {
          /* ignore */
        }
      });
    }
  };

  private static readonly VEG_INDEX_FIELDS = [
    "ndvi",
    "savi",
    "rvi",
    "ci",
    "evi",
    "ndwi",
  ];

  /**
   * Latest-day vegetation index values for the selected polygon, shown in
   * the popup. Reuses queryVegetationSeriesForUniqueId (queries the
   * agri_vegetation_indices ArcGIS table directly, same source AgriGraff10's
   * chart uses) rather than the api-agri export-image/available-dates REST
   * endpoints — those are for fetching a rendered raster for a specific
   * chosen date, which is unnecessary here; we only need the scalar index
   * values for whichever date is most recent, and the table already has
   * ndvi/savi/rvi/ci/evi/ndwi as plain fields per (uniqueid, raster_date).
   */
  private fetchLatestVegetationIndices = async (
    uniqueId: string,
  ): Promise<void> => {
    const id = String(uniqueId || "").trim();
    if (!id) {
      this.setState({
        loadingLatestIndices: false,
        latestIndexDate: null,
        latestIndexValues: null,
      });
      return;
    }

    const requestId = ++this._latestIndicesRequestId;
    evapoMapClickDebug("vegetation:request", {
      uniqueid: id,
      source: "agri_vegetation_indices/FeatureServer/1",
      requestId,
    });
    this.setState({
      loadingLatestIndices: true,
    });

    try {
      const rows = await queryVegetationSeriesForUniqueId(id);
      if (!this._isMounted || requestId !== this._latestIndicesRequestId) return;

      if (!rows.length) {
        this.setState({
          loadingLatestIndices: false,
          latestIndexDate: null,
          latestIndexValues: null,
        });
        return;
      }

      // Rows come back ordered by raster_date ASC — the last one is the
      // most recent processed date for this polygon.
      const latest = rows[rows.length - 1] as Record<string, any>;
      const date = formatArcgisDateToYmd(latest.raster_date);
      const values: Record<string, number> = {};
      for (const field of AgriPolygon.VEG_INDEX_FIELDS) {
        const v = Number(latest[field]);
        if (Number.isFinite(v)) values[field] = v;
      }
      evapoMapClickDebug("vegetation:response", {
        uniqueid: id,
        requestId,
        rowCount: rows.length,
        latestDate: date,
        values,
      });

      this.setState({
        loadingLatestIndices: false,
        latestIndexDate: date,
        latestIndexValues: Object.keys(values).length ? values : null,
      });
    } catch {
      if (!this._isMounted || requestId !== this._latestIndicesRequestId) return;
      this.setState({
        loadingLatestIndices: false,
        latestIndexDate: null,
        latestIndexValues: null,
      });
    }
  };

  /**
   * Agri_table_data is an external Table (no geometry) — the map click still
   * resolves the polygon feature for highlight/zoom, but the displayed
   * attributes come from Agri_table_data, joined by uniqueid.
   */
  private async resolveDisplayAttrs(
    polygonAttributes: Record<string, any> | null | undefined,
  ): Promise<Record<string, any>> {
    const joinValue = this.findAttributeValueCaseInsensitive(
      polygonAttributes,
      AGRI_TABLE_JOIN_FIELD,
    );
    if (joinValue == null || String(joinValue).trim() === "") {
      evapoMapClickWarn("agri-table-join:SKIP-no-uniqueid", {
        polygonAttributeKeys: Object.keys(polygonAttributes || {}),
      });
      return polygonAttributes || {};
    }
    try {
      evapoMapClickDebug("agri-table-join:request", {
        uniqueid: String(joinValue),
        source: "Agri_table_data/FeatureServer/2",
      });
      const agriRecord = await queryAgriRecordByUniqueId(String(joinValue));
      evapoMapClickDebug("agri-table-join:response", {
        uniqueid: String(joinValue),
        found: Boolean(agriRecord),
        attributeKeys: Object.keys(agriRecord || {}),
      });
      if (agriRecord) {
        // Keep polygon-only values (for example st_area(shape)) while allowing
        // the joined Agri table to provide/override the popup's business data.
        return { ...(polygonAttributes || {}), ...agriRecord };
      }
    } catch (e) {
      evapoMapClickWarn("Agri_table_data lookup failed", {
        uniqueId: joinValue,
        error: (e as any)?.message || String(e),
      });
    }
    return polygonAttributes || {};
  }

  private onViewClick = async (ev: __esri.ViewClickEvent) => {
    try {
      document.dispatchEvent(
        new CustomEvent("agriPolygonMapClickPhase", {
          detail: { phase: "click-start", timestamp: Date.now() },
        }),
      );
    } catch {
      /* best-effort filter guard */
    }
    // Captured BEFORE any awaits below — this widget's attribute-resolution
    // chain (resolveClickLayers/resolveClickFeatureAt/query/resolveDisplayAttrs)
    // can take noticeably longer than AgriGraff10's own, more direct map-click
    // handling of the same click. If the user clicks a second polygon before
    // this chain finishes, the stale result must not win — clickedAt lets
    // AgriGraff10 detect and drop it.
    const clickStartedAt = Date.now();
    const clickGeneration = ++this._clickGeneration;
    evapoMapClickDebug("click:received", {
      clickGeneration,
      x: ev.x,
      y: ev.y,
      mapPoint: ev.mapPoint
        ? {
            x: ev.mapPoint.x,
            y: ev.mapPoint.y,
            wkid: ev.mapPoint.spatialReference?.wkid || null,
          }
        : null,
    });
    const isStale = () =>
      !this._isMounted || clickGeneration !== this._clickGeneration;
    let popupOpenedForThisClick = false;
    const jmv = this.state.jimuMapView;
    const view = jmv?.view;
    if (!view || !jmv) {
      evapoMapClickWarn("onViewClick SKIP: no view/jmv");
      return;
    }

    const layers = await this.resolveClickLayers(view, jmv);
    if (isStale()) return;
    evapoMapClickDebug("onViewClick start", {
      screen: { x: ev.x, y: ev.y },
      layerCount: layers.length,
      layers: layers.map((l) => ({
        id: l.id,
        title: l.title,
        url: l.url,
      })),
    });


    const clickScreenPoint = { x: ev.x, y: ev.y };
    const hitResult = await this.resolveClickFeatureAt(ev, view, layers);
    if (isStale()) return;

    try {
      document.dispatchEvent(
        new CustomEvent("agriPolygonMapClickPhase", {
          detail: { phase: "after-hit-test", timestamp: Date.now() },
        }),
      );
    } catch {
      /* best-effort filter guard */
    }

    if (!hitResult) {
      // Empty map click while a field popup is open = deselect and return to
      // the district/region extent saved before the field zoom.
      if (this.state.showPopup || this.state.loading) {
        evapoMapClickDebug("onViewClick: click outside — close popup + restore extent");
        this.closePopup({ restoreExtent: true, notifyDeselect: true });
      } else {
        evapoMapClickDebug("onViewClick: click outside field polygons — ignored");
      }
      return;
    }

    const { graphic: g, queryHitLayer } = hitResult;

    try {
      this.setState({
        loading: true,
        error: null,
        clickScreenPoint,
        loadingAttachments: true,
        attachments: [],
        attachmentsExpanded: true,
      });

      evapoMapClickDebug("field polygon hit", {
        layerId: (g as any).layer?.id,
        geometry: g.geometry?.type || null,
        attrKeys: g.attributes
          ? Object.keys(g.attributes).slice(0, 8)
          : [],
      });

      // queryFeatures results have no graphic.layer — use the layer we queried
      const clickedLayer = (
        queryHitLayer
          ? this.toLiveMapLayer(queryHitLayer, view.map) || queryHitLayer
          : this.toLiveMapLayer(
              getQueryableLayer((g as any).layer) || (g as any).layer,
              view.map,
            )
      ) as __esri.FeatureLayer;
      if (!clickedLayer) {
        evapoMapClickWarn("no live layer for hit graphic");
        if (!isStale()) this.setState({ loading: false, showPopup: false });
        return;
      }
      const layerKey =
        getEvapoLayerMapKey(clickedLayer) ||
        String(clickedLayer?.url || clickedLayer?.id || "");
      const dsId = this.state.layerKeyToDsId?.[layerKey] || null;
      evapoMapClickDebug("layer:resolved", {
        title: clickedLayer.title,
        id: clickedLayer.id,
        url: clickedLayer.url || null,
        layerKey,
        dataSourceId: dsId,
        definitionExpression: (clickedLayer as any).definitionExpression || null,
      });

      const oidField =
        clickedLayer.objectIdField ||
        clickedLayer.fields?.find((f: any) => f.type === "oid")?.name ||
        null;

      if (!oidField) {
        if (!isStale()) {
          this.setState({
            loading: false,
            error: this.tr("error.objectIdFieldMissing"),
            showPopup: false,
            loadingAttachments: false,
            attachments: [],
          });
          this.clearHighlight();
        }
        return;
      }

      const oid = (g as any).attributes?.[oidField];
      if (oid == null) {
        if (!isStale()) {
          this.setState({
            loading: false,
            error: this.tr("error.objectIdMissing", { field: oidField }),
            showPopup: false,
            loadingAttachments: false,
            attachments: [],
          });
          this.clearHighlight();
        }
        return;
      }

      const outFields = this.getOutFields(clickedLayer as any, oidField);

      const f = await this.queryFeatureByObjectIdCached(
        clickedLayer,
        oidField,
        oid,
        outFields,
      );
      if (isStale()) return;
      if (!f) {
        this.setState({
          loading: false,
          error: this.tr("error.featureByObjectIdMissing"),
          showPopup: false,
          loadingAttachments: false,
          attachments: [],
        });
        this.clearHighlight();
        return;
      }

      if (f.geometry) this.highlightPolygon(f.geometry);

      const earlyUniqueId =
        this.findAttributeValueCaseInsensitive(
          f.attributes as Record<string, any>,
          AGRI_TABLE_JOIN_FIELD,
        ) ?? null;
      const earlyCleanKey = String(earlyUniqueId || "")
        .replace(/[{}]/g, "")
        .trim();
      const activeKey = String(this._activeInspectedUniqueid || "")
        .replace(/[{}]/g, "")
        .trim();
      /*
       * Same already-active field (incl. table selection) clicked on map →
       * deactivate without zooming in again. Graff restores the pre-select extent.
       * If the panel was only minimized, expand it instead of deselecting.
       */
      if (activeKey && earlyCleanKey && activeKey === earlyCleanKey) {
        if (this.state.popupMinimized) {
          evapoMapClickDebug("selection:expand-minimized-same-field", {
            uniqueid: earlyCleanKey,
          });
          this.expandPopup();
          return;
        }
        evapoMapClickDebug("selection:toggle-off-same-field", {
          uniqueid: earlyCleanKey,
        });
        this.clearHighlight();
        this._activeInspectedUniqueid = null;
        this.closePopup({ restoreExtent: true, notifyDeselect: true });
        return;
      }

      try {
        const loadStatus = String((clickedLayer as any).loadStatus || "").toLowerCase();
        const isLoaded = Boolean((clickedLayer as any).loaded) || loadStatus === "loaded";
        // Loading a live MapImage-owned sublayer rehydrates it and can clear
        // the runtime tuman definitionExpression (other-district flash). The
        // detached client from queryFeatureByObjectIdCached is already loaded
        // and provides the same field metadata.
        if (
          !isLoaded &&
          !isMapImageOwnedLayer(clickedLayer) &&
          typeof (clickedLayer as any).load === "function"
        ) {
          evapoMapClickDebug("layer:load-required", {
            title: clickedLayer.title,
            loadStatus: loadStatus || null,
            definitionExpression:
              (clickedLayer as any).definitionExpression || null,
          });
          await (clickedLayer as any).load();
        } else {
          evapoMapClickDebug("layer:load-skip-already-loaded", {
            title: clickedLayer.title,
            loadStatus: loadStatus || "loaded",
            definitionExpression:
              (clickedLayer as any).definitionExpression || null,
          });
        }
      } catch {
        /* fresh field aliases from live layer */
      }
      if (isStale()) return;

      const shouldPin = this.state.pinToCorner;
      const popupPosition = shouldPin
        ? this.calculatePinnedPosition(view)
        : this.calculatePopupPosition(clickScreenPoint, view);

      // Agri_table_data has no geometry — the polygon layer only drives
      // map-click/highlight/zoom; the fields the popup shows come from the
      // external table, joined by uniqueid.
      const displayAttrs = await this.resolveDisplayAttrs(f.attributes);
      if (isStale()) return;

      const configuredFields = this.props.config?.fieldsToShow || [];
      const actualFields = Object.keys(displayAttrs);
      const missingFields = configuredFields.filter(
        (field) => !actualFields.includes(field),
      );
      const fieldsWithData = configuredFields.filter(
        (name) =>
          displayAttrs.hasOwnProperty(name) &&
          displayAttrs[name] != null &&
          displayAttrs[name] !== "",
      );

      evapoMapClickDebug("popup OPEN", {
        oid,
        oidField,
        layerKey,
        attributeKeys: actualFields.slice(0, 12),
        popupPosition,
      });

      // Open the popup BEFORE goTo — awaiting zoom first left a long window
      // where a twin/shared click path could fail and wipe showPopup.
      this.setState({
        loading: false,

        // ✅ store which layer/ds was clicked (for alias resolving)
        lastClickedDsId: dsId,
        lastClickedLayerKey: layerKey,

        selectedAttrs: displayAttrs,
        selectedOID: Number(oid),
        objectIdField: oidField,

        showPopup: true,
        popupMinimized: false,
        chartExpanded: shouldPin,
        chartHoverIndex: null,
        popupPosition,
        error:
          missingFields.length > 0
            ? this.tr("error.configuredFieldMissing", {
                fields: missingFields.join(", "),
              })
            : fieldsWithData.length === 0 && configuredFields.length > 0
              ? this.tr("error.noDataForConfiguredFields")
              : null,
      });
      popupOpenedForThisClick = true;

      const clickedUniqueId =
        this.findAttributeValueCaseInsensitive(
          displayAttrs,
          AGRI_TABLE_JOIN_FIELD,
        ) ??
        this.findAttributeValueCaseInsensitive(
          f.attributes as Record<string, any>,
          AGRI_TABLE_JOIN_FIELD,
        );
      if (clickedUniqueId != null && String(clickedUniqueId).trim() !== "") {
        const cleanUniqueId = String(clickedUniqueId).trim();
        this._activeInspectedUniqueid = cleanUniqueId.replace(/[{}]/g, "").trim();
        evapoMapClickDebug("selection:broadcast", {
          uniqueid: cleanUniqueId,
          source: "AgriPopup",
          polygonMode: true,
          destinations: ["AgriLocalization", "AgriGraff10"],
        });
        this.notifyGraffPolygonSelection(cleanUniqueId, true, clickStartedAt);
        void this.fetchLatestVegetationIndices(cleanUniqueId);
      } else {
        this.setState({
          loadingLatestIndices: false,
          latestIndexDate: null,
          latestIndexValues: null,
        });
      }

      const zoomTo = this.props.config?.settings?.zoomToSelection !== false;
      if (zoomTo && f.geometry && !isStale()) {
        try {
          // Keep the first pre-selection extent so closing restores the
          // district/region view even if another field is clicked next.
          if (!this._extentBeforeSelection && view.extent?.clone) {
            this._extentBeforeSelection = view.extent.clone();
          }
          // Keep the whole field visible with only a small margin.
          const target =
            (f.geometry as any).extent?.expand?.(1.08) || f.geometry;
          evapoMapClickDebug("zoom:start", {
            uniqueid: clickedUniqueId == null ? null : String(clickedUniqueId),
            geometryType: f.geometry.type,
            durationMs: 650,
            targetExtent: (target as any)?.toJSON?.() || null,
          });
          void view.goTo(
            { target },
            { duration: 650, easing: "ease-in-out" as any },
          ).then(
            () => evapoMapClickDebug("zoom:complete", {
              uniqueid: clickedUniqueId == null ? null : String(clickedUniqueId),
              scale: (view as any).scale,
            }),
            (error: any) => evapoMapClickWarn("zoom:failed", {
              uniqueid: clickedUniqueId == null ? null : String(clickedUniqueId),
              error: error?.message || String(error),
            }),
          );
        } catch {
          /* ignore */
        }
      }

      // Attachments are best-effort — never let a media fetch wipe an open popup
      // (that was the "vegetation updates but popup only sticks on 2nd/3rd click"
      // failure: notifyGraff ran, then loadAttachments threw → catch closed UI
      // and restoreExtentBeforeSelection made the map look like other fields).
      if (this.props.config?.settings?.showAttachments !== false) {
        try {
          // Query attachments on the detached client too — queryAttachments
          // on a live MapImage sublayer can rehydrate it (same DE-clearing
          // path as queryFeatures) and it often lacks the API anyway.
          const clickedUrl = String((clickedLayer as any).url || "").trim();
          const attachmentLayer =
            (clickedUrl && this._queryOnlyLayers.get(clickedUrl)) ||
            clickedLayer;
          await this.loadAttachmentsForOid(attachmentLayer as any, Number(oid));
        } catch (attachErr: any) {
          evapoMapClickWarn("attachments failed (popup kept open)", {
            message: attachErr?.message || String(attachErr),
          });
          if (!isStale()) {
            this.setState({ loadingAttachments: false, attachments: [] });
          }
        }
      } else if (!isStale()) {
        this.setState({ loadingAttachments: false, attachments: [] });
      }
      if (isStale()) return;

      if (this.state.pinToCorner) {
        this.schedulePopupLayoutAfterContent();
      } else if (this.isDashboardEmbedded()) {
        this.schedulePopupLayoutAfterContent();
      }
    } catch (e: any) {
      // Never let a superseded twin/shared click clear a newer popup.
      if (isStale()) return;
      // If we already opened the popup for THIS click, keep it — surface error only.
      if (popupOpenedForThisClick) {
        this.setState({
          loading: false,
          error: this.tr("error.unexpected", {
            message: e?.message || "Unknown error",
          }),
          loadingAttachments: false,
        });
        return;
      }
      this.setState({
        loading: false,
        error: this.tr("error.unexpected", {
          message: e?.message || "Unknown error",
        }),
        showPopup: false,
        loadingAttachments: false,
        attachments: [],
      });
      this.clearHighlight();
      this.notifyGraffPolygonSelection("", false);
      this.restoreExtentBeforeSelection();
    }
  };

  /* ---------------- Attachments helpers ---------------- */

  private async fetchAttachmentPreview(url: string): Promise<Blob> {
    const resp = await esriRequest(url, {
      responseType: "blob",
      query: {},
    } as any);
    return resp?.data instanceof Blob ? resp.data : (resp as unknown as Blob);
  }

  private revokeAllAttachmentUrls() {
    try {
      const atts = this.state.attachments || [];
      atts.forEach((a) => {
        if (a.previewObjectUrl) URL.revokeObjectURL(a.previewObjectUrl);
      });
    } catch {}
  }

  private isImageContentType(ct?: string) {
    if (!ct) return false;
    return /^image\//i.test(ct);
  }

  private bytesToSize(n?: number): string {
    if (!n && n !== 0) return "";
    if (n === 0) return "0 B";
    const k = 1024,
      sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(n) / Math.log(k));
    return `${(n / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  private async loadAttachmentsForOid(layer: FeatureLayer, oid: number) {
    // ✅ If layer doesn’t support attachments -> silently show none (NO warning)
    if (!this.layerSupportsAttachments(layer)) {
      if (!this._isMounted) return;
      this.revokeAllAttachmentUrls();
      this.setState({
        loadingAttachments: false,
        attachments: [],
        attachmentsExpanded: true, // keep area visible if you want "No attachments"
      });
      return;
    }

    try {
      this.revokeAllAttachmentUrls();
      this.setState({ loadingAttachments: true, attachments: [] });

      const result = await layer.queryAttachments({ objectIds: [oid] });
      const list = (result?.[oid] || []) as any[];

      const items: AttachmentItem[] = list.map((att) => ({
        id: att.id,
        name: att.name,
        size: att.size,
        contentType: att.contentType,
        url: att.url,
      }));

      const withPreviews: AttachmentItem[] = [];
      for (const it of items) {
        if (it.url && this.isImageContentType(it.contentType)) {
          try {
            const blob = await this.fetchAttachmentPreview(it.url);
            it.previewObjectUrl = URL.createObjectURL(blob);
          } catch {
            // ignore preview failures
          }
        }
        withPreviews.push(it);
      }

      if (!this._isMounted) return;
      this.setState({
        attachments: withPreviews,
        loadingAttachments: false,
        attachmentsExpanded: true,
      });
    } catch (err: any) {
      // ✅ If server says attachments not supported/enabled -> SILENT (no red warning)
      const msg = String(err?.message || err || "").toLowerCase();
      const isNotSupported =
        msg.includes("doesn't support attachments") ||
        msg.includes("does not support attachments") ||
        msg.includes("attachments are not enabled") ||
        msg.includes("attachments disabled") ||
        (msg.includes("not supported") && msg.includes("attachment"));

      if (!this._isMounted) return;

      if (isNotSupported) {
        this.setState({
          loadingAttachments: false,
          attachments: [],
          attachmentsExpanded: true,
        });
        return;
      }

      this.setState({
        loadingAttachments: false,
        attachments: [],
        attachmentsExpanded: true,
      });
    }
  }

  /* ---------------- Field alias + formatting ---------------- */

  private isDateField(name: string): boolean {
    // Use the clicked layer if possible
    const clickedLayer = this.getClickedLayer();
    const fld = clickedLayer?.fields?.find((ff: any) => ff.name === name);
    const t = String((fld as any)?.type || "");
    return (
      t === "date" ||
      t === "timestamp-offset" ||
      t === "date-only" ||
      t === "time-only"
    );
  }

  private getClickedLayer(): __esri.FeatureLayer | null {
    const key = this.state.lastClickedLayerKey;
    if (!key) return null;
    return (
      this.state.featureLayers.find(
        (L) =>
          getEvapoLayerMapKey(L) === key ||
          String(L.url || L.id || "") === key,
      ) || null
    );
  }

  private resolveFieldName = (key: string): string | null => {
    // Prefer DS schema for the LAST clicked ds (best for alias/jimuName)
    const dsId = this.state.lastClickedDsId;
    const ds: any =
      dsId && this.state.dataSourcesById?.[dsId]
        ? this.state.dataSourcesById[dsId]
        : null;

    try {
      const schema = ds?.getSchema?.();
      const fieldsObj = schema?.fields || {};
      if (fieldsObj[key]?.name) return fieldsObj[key].name;
      for (const k of Object.keys(fieldsObj)) {
        const f = (fieldsObj as any)[k];
        if (f?.name === key || f?.jimuName === key || k === key)
          return f?.name || key;
      }
    } catch {}

    // fallback to clicked layer fields
    const clickedLayer = this.getClickedLayer();
    const lf = clickedLayer?.fields?.find(
      (ff: any) => ff.name === key || ff.alias === key,
    );
    return lf?.name || null;
  };

  private normalizeFieldAlias(field: any, fallbackName: string): string {
    const name = String(field?.name || fallbackName || "").trim();
    const alias = String(
      field?.alias || field?.displayName || field?.label || "",
    ).trim();
    if (!alias) return name;
    return alias;
  }

  private findFieldMetaOnLayer(
    layer: any,
    fieldName: string,
  ): __esri.Field | null {
    const target = fieldName.toLowerCase();
    const fields = Array.isArray(layer?.fields) ? layer.fields : [];
    return (
      (fields.find(
        (f: any) => String(f?.name || "").toLowerCase() === target,
      ) as __esri.Field | undefined) || null
    );
  }

  private resolveAliasFromLiveLayers(fieldName: string): string | null {
    const layers: __esri.FeatureLayer[] = [];
    const clicked = this.getClickedLayer();
    if (clicked) layers.push(clicked);
    for (const layer of this.state.featureLayers || []) {
      if (layer && !layers.includes(layer)) layers.push(layer);
    }

    for (const layer of layers) {
      const fld = this.findFieldMetaOnLayer(layer, fieldName);
      if (!fld) continue;
      const alias = this.normalizeFieldAlias(fld, fieldName);
      if (alias && alias.toLowerCase() !== fieldName.toLowerCase()) {
        return alias;
      }
    }
    return null;
  }

  private resolveAliasFromDataSourceSchema(
    fieldName: string,
    ds: any,
  ): string | null {
    if (!ds) return null;
    try {
      const fieldsObj = ds?.getSchema?.()?.fields || {};
      const target = fieldName.toLowerCase();
      for (const key of Object.keys(fieldsObj)) {
        const f = fieldsObj[key];
        const fname = String(f?.name || f?.jimuName || key || "");
        if (
          fname.toLowerCase() !== target &&
          key.toLowerCase() !== target &&
          String(f?.jimuName || "").toLowerCase() !== target
        ) {
          continue;
        }
        const alias = this.normalizeFieldAlias(f, fieldName);
        if (alias && alias.toLowerCase() !== fieldName.toLowerCase()) {
          return alias;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private getFieldAlias(name: string): string {
    const custom = this.props.config?.labels?.[name];
    if (custom) return custom;

    const realName = this.resolveFieldName(name) || name;

    // Live map layer first — reflects latest ArcGIS field display names
    const fromLayer = this.resolveAliasFromLiveLayers(realName);
    if (fromLayer) return fromLayer;

    const dsId = this.state.lastClickedDsId;
    const ds: any =
      dsId && this.state.dataSourcesById?.[dsId]
        ? this.state.dataSourcesById[dsId]
        : null;
    const fromDs = this.resolveAliasFromDataSourceSchema(realName, ds);
    if (fromDs) return fromDs;

    for (const layerDs of Object.values(this.state.dataSourcesById || {})) {
      const alias = this.resolveAliasFromDataSourceSchema(realName, layerDs);
      if (alias) return alias;
    }

    const clickedLayer = this.getClickedLayer();
    const layerFld = clickedLayer
      ? this.findFieldMetaOnLayer(clickedLayer, realName)
      : null;
    if (layerFld?.alias) return String(layerFld.alias);

    return realName;
  }

  private formatDateSmart(raw: any): string {
    if (raw instanceof Date) return raw.toLocaleString();

    if (typeof raw === "number" && isFinite(raw)) {
      const ms = raw < 1e12 ? raw * 1000 : raw;
      const d = new Date(ms);
      return isNaN(d.getTime())
        ? String(raw)
        : d.toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
    }

    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (/^\d{10,13}$/.test(trimmed))
        return this.formatDateSmart(Number(trimmed));
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }

    return String(raw);
  }

  private formatValue(name: string, raw: any): string {
    if (raw === null || raw === undefined || raw === "") return "—";

    if (this.isDateField(name)) return this.formatDateSmart(raw);
    if (
      (typeof raw === "number" && raw > 1e9 && raw < 1e14) ||
      (typeof raw === "string" && /^\d{10,13}$/.test(raw))
    ) {
      return this.formatDateSmart(raw);
    }

    if (typeof raw === "number" && isFinite(raw)) return raw.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ").replace(/,/g, ".");
    if (Array.isArray(raw)) return raw.join(", ");
    if (typeof raw === "object") return JSON.stringify(raw);
    return String(raw);
  }

  private getOutFields(layer: FeatureLayer, oidField: string): string[] {
    // keep your debugging behavior
    return ["*"];
  }

  /* ---------------- Popup positioning ---------------- */

  private calculatePopupPosition = (
    clickPoint: { x: number; y: number },
    view: __esri.MapView | __esri.SceneView,
  ): { x: number; y: number } => {
    const container = view.container as HTMLElement;
    const rect = container.getBoundingClientRect();

    const margin = this.POPUP_MARGIN;
    const popupW = this.getPopupWidth(view);
    const popupH = popupW;

    // ✅ EB builds differ:
    // - some give ev.x/ev.y relative to container (0..rect.width)
    // - others give viewport coords (same space as rect.left/top)
    const looksContainerRelative =
      clickPoint.x >= 0 &&
      clickPoint.y >= 0 &&
      clickPoint.x <= rect.width + 2 &&
      clickPoint.y <= rect.height + 2;

    // Convert click to VIEWPORT coords (because popup is position: fixed)
    const viewportClickX = looksContainerRelative
      ? rect.left + clickPoint.x
      : clickPoint.x;
    const viewportClickY = looksContainerRelative
      ? rect.top + clickPoint.y
      : clickPoint.y;

    // Map container boundaries in viewport coords
    const mapLeft = rect.left;
    const mapTop = rect.top;
    const mapRight = rect.right;
    const mapBottom = this.getEffectiveMapBottom(view, margin);

    // Prefer bottom-right of click
    let x = viewportClickX + margin;
    let y = viewportClickY + margin;

    // Flip left if overflowing right edge (CRITICAL!)
    // Check if popup would go outside map's right boundary
    if (x + popupW > mapRight - margin) {
      x = viewportClickX - popupW - margin;
    }

    // Flip up if overflowing bottom edge
    if (y + popupH > mapBottom - margin) {
      y = viewportClickY - popupH - margin;
    }

    // Final hard clamp to map container bounds
    // This is the critical part - ensure popup NEVER exceeds map bounds
    const minX = mapLeft + margin;
    const maxX = mapRight - popupW - margin;
    const minY = mapTop + margin;
    const maxY = mapBottom - popupH - margin;

    x = Math.max(minX, Math.min(x, maxX));
    y = Math.max(minY, Math.min(y, maxY));

    // FINAL SAFETY NET: Ensure x never exceeds right boundary
    if (x + popupW > mapRight - margin) {
      x = mapRight - popupW - margin;
    }
    // Also ensure x >= left boundary
    if (x < mapLeft + margin) {
      x = mapLeft + margin;
    }

    return { x, y };
  };

  componentDidUpdate(
    prevProps: Readonly<AllWidgetProps<Config>>,
    prevState: Readonly<State>,
  ) {
    const prevDs = getSelectedDsIds(prevProps.useDataSources).join("|");
    const nextDs = getSelectedDsIds(this.props.useDataSources).join("|");
    const dsChanged = prevDs !== nextDs;
    const prevMap = String(
      (prevProps.useMapWidgetIds as any)?.[0] ||
        (prevProps.useMapWidgetIds as any)?.get?.(0) ||
        "",
    );
    const nextMap = String(
      (this.props.useMapWidgetIds as any)?.[0] ||
        (this.props.useMapWidgetIds as any)?.get?.(0) ||
        "",
    );
    const mapChanged = prevMap !== nextMap;
    if ((dsChanged || mapChanged) && this.state.jimuMapView) {
      void this.initializeMapConnection(this.state.jimuMapView);
    } else if (mapChanged) {
      this.scheduleMapViewFallback();
    }

    if (
      prevState.showPopup !== this.state.showPopup ||
      prevState.popupMinimized !== this.state.popupMinimized
    ) {
      this.broadcastPopupVisibility(
        this.state.showPopup && !this.state.popupMinimized,
      );
    } else if (
      this.state.showPopup &&
      !this.state.popupMinimized &&
      prevState.pinToCorner !== this.state.pinToCorner
    ) {
      this.broadcastPopupVisibility(true);
    }

    if (!this.state.showPopup || this.state.popupMinimized) return;

    const openedNow =
      (this.state.showPopup && !prevState.showPopup) ||
      (prevState.popupMinimized && !this.state.popupMinimized);
    const attachmentsChanged =
      this.state.loadingAttachments !== prevState.loadingAttachments ||
      (this.state.attachments?.length || 0) !==
        (prevState.attachments?.length || 0);
    const loadingChanged = this.state.loading !== prevState.loading;
    const attrsChanged = this.state.selectedAttrs !== prevState.selectedAttrs;

    if (
      !openedNow &&
      !attachmentsChanged &&
      !loadingChanged &&
      !attrsChanged
    ) {
      return;
    }

    this.schedulePopupLayoutAfterContent();
  }

  private closePopup = (opts?: {
    restoreExtent?: boolean;
    notifyDeselect?: boolean;
  }) => {
    // Closing the panel alone must keep the polygon highlight + map extent.
    // Explicit callers (empty map click / geo reset) opt into restore/deselect.
    const restoreExtent = opts?.restoreExtent === true;
    const notifyDeselect = opts?.notifyDeselect === true;

    // Invalidate every pending hitTest/query/attachment request. Otherwise a
    // field click that was still loading could reopen its stale popup after
    // the user had already moved to another district or region.
    this._clickGeneration += 1;
    this._latestIndicesRequestId += 1;

    if (!this.state.showPopup) {
      if (notifyDeselect) {
        this.clearHighlight();
        this.notifyGraffPolygonSelection("", false);
      }
      if (!restoreExtent) this._extentBeforeSelection = null;
      this.setState({
        loading: false,
        error: null,
        selectedAttrs: null,
        selectedOID: null,
        objectIdField: null,
        lastClickedDsId: null,
        lastClickedLayerKey: null,
        popupPosition: null,
        clickScreenPoint: null,
        popupMinimized: false,
      });
      return;
    }

    if (notifyDeselect) {
      this.clearHighlight();
      this.notifyGraffPolygonSelection("", false);
    }
    this.revokeAllAttachmentUrls();
    this.setState({
      showPopup: false,
      popupMinimized: false,
      popupPosition: null,
      clickScreenPoint: null,
      loading: false,
      error: null,
      selectedAttrs: null,
      selectedOID: null,
      objectIdField: null,
      lastClickedDsId: null,
      lastClickedLayerKey: null,
      attachments: [],
      attachmentsExpanded: false,
      loadingAttachments: false,
      chartExpanded: false,
      chartHoverIndex: null,
      loadingLatestIndices: false,
      latestIndexDate: null,
      latestIndexValues: null,
    });
    if (restoreExtent) {
      this.restoreExtentBeforeSelection();
    } else {
      this._extentBeforeSelection = null;
    }
  };

  /** Header X — collapse the panel; keep polygon selection + loaded attrs. */
  private minimizePopup = (): void => {
    if (!this._isMounted || !this.state.showPopup || this.state.popupMinimized) {
      return;
    }
    this.setState({ popupMinimized: true });
  };

  /** Expand a previously minimized attribute panel. */
  private expandPopup = (): void => {
    if (!this._isMounted || !this.state.showPopup || !this.state.popupMinimized) {
      return;
    }
    this.setState({ popupMinimized: false });
  };

  /* ---------------- DS hook (instantiates DS) ---------------- */

  onDataSourceCreated = (ds: QueriableDataSource) => {
    if (!ds?.id) return;
    this.dataSourceEngine.onDsCreated(
      ds,
      getSelectedDsIds(this.props.useDataSources),
    );
    this.setState((prev) => ({
      dataSourcesById: { ...(prev.dataSourcesById || {}), [ds.id]: ds },
    }));
    if (this.state.jimuMapView) {
      void this.initializeMapConnection(this.state.jimuMapView);
    } else {
      this.scheduleMapViewFallback();
    }
  };

  /* ---------------- Chart rendering ---------------- */

  private toggleChartExpanded = (): void => {
    this.setState((prev) => ({ chartExpanded: !prev.chartExpanded }));
  };

  private renderChartIcon = (type: "bar" | "line" = "bar"): JSX.Element =>
    type === "line" ? (
      <LineChart className="agri3-chart-icon" strokeWidth={2} aria-hidden="true" />
    ) : (
      <BarChart3 className="agri3-chart-icon" strokeWidth={2} aria-hidden="true" />
    );

  private clearChartHover = (): void => {
    if (this.state.chartHoverIndex != null) {
      this.setState({ chartHoverIndex: null });
    }
  };

  private setChartHover = (index: number): void => {
    if (this.state.chartHoverIndex !== index) {
      this.setState({ chartHoverIndex: index });
    }
  };

  private niceChartMax(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const padded = value * 1.08;
    const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
    const normalized = padded / magnitude;
    let nice = 10;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 5) nice = 5;
    return nice * magnitude;
  }

  private formatChartTick(value: number): string {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value) >= 1000) return `${Math.round(value)}`;
    if (Math.abs(value) >= 100) return `${Math.round(value)}`;
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(1);
  }

  private formatChartTooltipValue(value: number): string {
    if (!Number.isFinite(value)) return "";
    if (Number.isInteger(value)) return value.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ");
    return value.toLocaleString("ru-RU", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).replace(/[\u00a0\u202f]/g, " ").replace(/,/g, ".");
  }

  private buildSmoothLinePath(
    points: Array<{ x: number; y: number }>,
  ): string {
    if (!points.length) return "";
    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y}`;
    }

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
  }

  private buildRoundedBarPath(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): string {
    const r = Math.min(radius, width / 2, height);
    const bottom = y + height;
    return [
      `M ${x} ${bottom}`,
      `L ${x} ${y + r}`,
      `Q ${x} ${y} ${x + r} ${y}`,
      `L ${x + width - r} ${y}`,
      `Q ${x + width} ${y} ${x + width} ${y + r}`,
      `L ${x + width} ${bottom}`,
      "Z",
    ].join(" ");
  }

  private renderLatestIndices = () => {
    const { loadingLatestIndices, latestIndexDate, latestIndexValues } =
      this.state;

    const hasValues = !!latestIndexValues;
    const showBlockingLoader = loadingLatestIndices && !hasValues;
    const showRefreshLoader = loadingLatestIndices && hasValues;

    return (
      <div className="agri3-field-list agri3-indices-list">
        <div className="agri3-field-row agri3-indices-header-row">
          <span className="agri3-field-label agri3-indices-title">
            <Sprout size={14} strokeWidth={2.2} aria-hidden="true" />
            {this.tr("indices.title")}
          </span>
          {latestIndexDate && !loadingLatestIndices && (
            <span className="agri3-field-value agri3-indices-date">
              <CalendarDays size={13} strokeWidth={2} aria-hidden="true" />
              {latestIndexDate}
            </span>
          )}
        </div>
        {showBlockingLoader ? (
          <div className="agri3-indices-loading-container">
            <AgriChartLoader label={this.tr("indices.loading")} />
          </div>
        ) : hasValues ? (
          <div
            className={`agri3-indices-body${
              showRefreshLoader ? " agri3-indices-body--loading" : ""
            }`}
          >
            {showRefreshLoader ? (
              <AgriChartLoader label={this.tr("indices.loading")} />
            ) : null}
            {AgriPolygon.VEG_INDEX_FIELDS.filter(
              (f) => latestIndexValues[f] != null,
            ).map((f) => (
              <div
                className={`agri3-field-row agri3-index-row agri3-index-row--${f}`}
                key={f}
              >
                <span
                  className={`agri3-field-label agri3-index-label agri3-index-label--${f}`}
                >
                  <span className="agri3-index-dot" aria-hidden="true" />
                  {f.toUpperCase()}
                </span>
                <span className="agri3-field-value">
                  {latestIndexValues[f].toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="agri3-status-indicator agri3-status-waiting">
            <Inbox className="agri3-status-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
            {this.tr("indices.none")}
          </div>
        )}
      </div>
    );
  };

  private renderChart = () => {
    const config = this.props.config;
    if (!config?.chartEnabled) return null;

    const chartFields = config.chartFields || [];
    const chartType = config.chartType || "bar";
    const chartTitle = config.chartTitle || "";
    const chartColor = config.chartColor || "#00a8e8";
    const attrs = this.state.selectedAttrs;
    const pinned = this.state.pinToCorner;
    const chartExpanded = pinned || this.state.chartExpanded;

    if (!attrs || chartFields.length === 0) return null;

    // Collect numeric data for chart
    const dataPoints: { label: string; value: number }[] = [];
    for (const fieldName of chartFields) {
      const raw = attrs[fieldName];
      const numVal = typeof raw === "number" ? raw : parseFloat(raw);
      if (!isNaN(numVal)) {
        dataPoints.push({
          label: this.getFieldAlias(fieldName),
          value: numVal,
        });
      }
    }

    if (dataPoints.length === 0) return null;

    const chartLabel = chartTitle || dataPoints[0]?.label || "Grafik";
    const hoverIndex = this.state.chartHoverIndex;

    const svgWidth = 340;
    const svgHeight = 168;
    const padding = { top: 12, right: 12, bottom: 8, left: 40 };
    const chartW = svgWidth - padding.left - padding.right;
    const chartH = svgHeight - padding.top - padding.bottom;

    const maxVal = Math.max(...dataPoints.map((d) => d.value), 0);
    const yMax = this.niceChartMax(maxVal);
    const scaleY = (v: number) => chartH - (v / yMax) * chartH;

    const isDark = this.state.isDarkTheme;
    const axisColor = isDark ? "rgba(255,255,255,0.55)" : "#94a3b8";
    const gridColor = isDark ? "rgba(255,255,255,0.14)" : "#dbeafe";
    const chartBodyBg = isDark ? "transparent" : "#ffffff";
    const highlightFill = isDark
      ? "rgba(0, 168, 232, 0.12)"
      : "rgba(0, 168, 232, 0.1)";

    const gridLines = 4;
    const gridStep = yMax / gridLines;

    const barLayout =
      chartType === "bar"
        ? (() => {
            const barGap = Math.max(6, Math.min(10, chartW / dataPoints.length / 4));
            const barW = Math.max(
              8,
              (chartW - (dataPoints.length - 1) * barGap) / dataPoints.length,
            );
            return dataPoints.map((d, i) => {
              const x = padding.left + i * (barW + barGap);
              const barH = Math.max(2, (d.value / yMax) * chartH);
              const y = padding.top + chartH - barH;
              return { ...d, i, x, y, barW, barH, centerX: x + barW / 2 };
            });
          })()
        : [];

    const linePoints =
      chartType === "line"
        ? (() => {
            const stepX =
              dataPoints.length > 1 ? chartW / (dataPoints.length - 1) : 0;
            return dataPoints.map((d, i) => ({
              ...d,
              i,
              x:
                padding.left +
                (dataPoints.length > 1 ? i * stepX : chartW / 2),
              y: padding.top + scaleY(d.value),
            }));
          })()
        : [];

    const hoverPoint =
      hoverIndex != null
        ? chartType === "bar"
          ? barLayout[hoverIndex]
          : linePoints[hoverIndex]
        : null;

    const tooltipLeftPct = hoverPoint
      ? Math.max(8, Math.min(82, (hoverPoint.x / svgWidth) * 100))
      : 0;
    const tooltipTopPct = hoverPoint
      ? Math.max(6, Math.min(58, (hoverPoint.y / svgHeight) * 100 - 18))
      : 0;

    const chartSvg = (
      <svg
        width="100%"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="agri3-chart-svg"
        style={{ background: chartBodyBg }}
      >
        <rect
          x={padding.left}
          y={padding.top}
          width={chartW}
          height={chartH}
          fill={isDark ? "rgba(255,255,255,0.02)" : "#ffffff"}
          rx={6}
        />

        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const val = gridStep * i;
          const y = padding.top + scaleY(val);
          return (
            <g key={`grid-${i}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={svgWidth - padding.right}
                y2={y}
                stroke={gridColor}
                strokeWidth={1}
                strokeDasharray="3 5"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                fill={axisColor}
                fontSize={10}
                textAnchor="end"
              >
                {this.formatChartTick(val)}
              </text>
            </g>
          );
        })}

        {chartType === "bar" &&
          barLayout.map((bar) => (
            <g key={`bar-${bar.i}`}>
              {hoverIndex === bar.i && (
                <rect
                  x={bar.x - 3}
                  y={padding.top}
                  width={bar.barW + 6}
                  height={chartH}
                  fill={highlightFill}
                  rx={5}
                />
              )}
              <path
                d={this.buildRoundedBarPath(bar.x, bar.y, bar.barW, bar.barH, 5)}
                fill={chartColor}
                opacity={hoverIndex == null || hoverIndex === bar.i ? 1 : 0.45}
                className="agri3-chart-bar"
                onMouseEnter={() => this.setChartHover(bar.i)}
              />
              <rect
                x={bar.x}
                y={padding.top}
                width={bar.barW}
                height={chartH}
                fill="transparent"
                onMouseEnter={() => this.setChartHover(bar.i)}
              />
            </g>
          ))}

        {chartType === "line" && (
          <g>
            {hoverIndex != null && linePoints[hoverIndex] && (
              <line
                x1={linePoints[hoverIndex].x}
                y1={padding.top}
                x2={linePoints[hoverIndex].x}
                y2={padding.top + chartH}
                stroke={chartColor}
                strokeWidth={1.5}
                opacity={0.35}
              />
            )}
            <path
              d={this.buildSmoothLinePath(linePoints)}
              fill="none"
              stroke={chartColor}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {linePoints.map((p) => (
              <g key={`pt-${p.i}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hoverIndex === p.i ? 5.5 : 4}
                  fill={isDark ? "#0b1a30" : "#ffffff"}
                  stroke={chartColor}
                  strokeWidth={hoverIndex === p.i ? 2.5 : 2}
                  className="agri3-chart-point"
                  onMouseEnter={() => this.setChartHover(p.i)}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={12}
                  fill="transparent"
                  onMouseEnter={() => this.setChartHover(p.i)}
                />
              </g>
            ))}
          </g>
        )}
      </svg>
    );

    const chartBody = (
      <div
        className="agri3-chart-body"
        onMouseLeave={this.clearChartHover}
      >
        {hoverPoint && (
          <div
            className="agri3-chart-tooltip"
            style={{
              left: `${tooltipLeftPct}%`,
              top: `${tooltipTopPct}%`,
            }}
          >
            <div className="agri3-chart-tooltip-label">{hoverPoint.label}</div>
            <div className="agri3-chart-tooltip-value">
              {this.formatChartTooltipValue(hoverPoint.value)}
            </div>
          </div>
        )}
        {chartSvg}
      </div>
    );

    if (!chartExpanded) {
      return (
        <button
          type="button"
          className="agri3-chart-trigger"
          onClick={this.toggleChartExpanded}
        >
          <span className="agri3-chart-trigger-icon">{this.renderChartIcon(chartType)}</span>
          <span className="agri3-chart-trigger-label">{chartLabel}</span>
          <span className="agri3-chart-trigger-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
      );
    }

    return (
      <div className="agri3-chart-panel">
        {!pinned ? (
          <button
            type="button"
            className="agri3-chart-panel-header"
            onClick={this.toggleChartExpanded}
          >
            <span className="agri3-chart-trigger-icon">{this.renderChartIcon(chartType)}</span>
            <span className="agri3-chart-trigger-label">{chartLabel}</span>
            <span
              className="agri3-chart-trigger-chevron is-open"
              aria-hidden="true"
            >
              ▴
            </span>
          </button>
        ) : (
          <div className="agri3-chart-panel-header agri3-chart-panel-header--static">
            <span className="agri3-chart-trigger-icon">{this.renderChartIcon(chartType)}</span>
            <span className="agri3-chart-trigger-label">{chartLabel}</span>
          </div>
        )}
        <div className="agri3-chart-container">{chartBody}</div>
      </div>
    );
  };

  /* ---------------- Popup UI ---------------- */

  private renderPopup = () => {
    const {
      selectedAttrs,
      selectedOID,
      loading,
      error,
      showPopup,
      popupMinimized,
      popupPosition,
      loadingAttachments,
      attachments,
      pinToCorner,
    } = this.state;

    if (!showPopup) return null;

    const fields = (this.props.config?.fieldsToShow || [])
      .map((n) => this.resolveFieldName(n) || n)
      .filter(Boolean);

    const title = this.tr("title.attributes");

    const view = this.state.jimuMapView?.view;
    const layoutPos = popupPosition;

    if (popupMinimized) {
      const viewForChip = view || this.state.jimuMapView?.view || null;
      const mapRect = viewForChip ? this.getMapAreaRect(viewForChip) : null;
      const chipStyle: React.CSSProperties = mapRect
        ? {
            position: "fixed",
            right: Math.max(
              8,
              (typeof window !== "undefined" ? window.innerWidth : mapRect.right) -
                mapRect.right +
                this.DASHBOARD_POPUP_VERTICAL_INSET,
            ),
            top: mapRect.top + this.DASHBOARD_POPUP_VERTICAL_INSET,
            left: "auto",
            bottom: "auto",
            transform: "none",
          }
        : {
            position: "fixed",
            right: this.DASHBOARD_POPUP_VERTICAL_INSET,
            top: this.DASHBOARD_POPUP_VERTICAL_INSET,
            left: "auto",
            bottom: "auto",
          };

      const stopMapHit = (e: React.SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };

      return (
        <div
          className={`agri3-popup-minimized ${
            pinToCorner ? "is-pinned" : "is-floating"
          }`}
          style={chipStyle}
          ref={this._popupRef}
          onMouseDown={stopMapHit}
          onPointerDown={stopMapHit}
          onClick={stopMapHit}
        >
          <button
            type="button"
            className="agri3-popup-minimized-btn"
            onMouseDown={stopMapHit}
            onPointerDown={stopMapHit}
            onClick={(e) => {
              stopMapHit(e);
              this.expandPopup();
            }}
            title={this.tr("action.expand")}
            aria-label={this.tr("action.expand")}
          >
            <span className="agri3-popup-minimized-accent" aria-hidden="true" />
            <span className="agri3-popup-minimized-title">{title}</span>
            <ChevronUp
              className="agri3-popup-minimized-icon"
              size={16}
              strokeWidth={2.4}
              aria-hidden="true"
            />
          </button>
        </div>
      );
    }

    const { width: popupWidth, height: popupHeight } = this.getPopupDimensions(
      view || null,
      pinToCorner,
      layoutPos,
    );

    const dimensionStyle: React.CSSProperties = {
      width: `${popupWidth}px`,
      minWidth: `${popupWidth}px`,
      maxWidth: `${popupWidth}px`,
      height: `${popupHeight}px`,
      maxHeight: `${popupHeight}px`,
    };

    const stylePinned: React.CSSProperties = layoutPos
      ? {
          left: layoutPos.x,
          top: layoutPos.y,
          transform: "none",
          ...dimensionStyle,
        }
      : { ...dimensionStyle };

    const styleFree: React.CSSProperties = {
      left: layoutPos?.x || "50%",
      top: layoutPos?.y || "50%",
      transform: !layoutPos ? "translate(-50%, -50%)" : "none",
      ...dimensionStyle,
    };

    const popupStyle = pinToCorner ? stylePinned : styleFree;

    const showAttachments =
      this.props.config?.settings?.showAttachments !== false;
    const hasAttachments = (attachments?.length || 0) > 0;

    return (
      <div
        className={`agri3-popup-direct ${pinToCorner ? "is-pinned" : "is-floating"}`}
        style={popupStyle}
        ref={this._popupRef}
      >
        <div className="agri3-popup-header" onMouseDown={this.onPopupHeaderMouseDown}>
          <button
            className={`agri3-popup-pin${pinToCorner ? " active" : ""}`}
            onClick={this.togglePinToCorner}
            title={
              pinToCorner ? this.tr("action.unpin") : this.tr("action.pin")
            }
            aria-pressed={pinToCorner}
            type="button"
          >
            {pinToCorner ? (
              <Pin size={15} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <MapPin size={15} strokeWidth={2.2} aria-hidden="true" />
            )}
          </button>

          <h2 className="agri3-popup-title">{title}</h2>

          <button
            type="button"
            className="agri3-popup-close"
            onClick={this.minimizePopup}
            aria-label={this.tr("action.minimize")}
            title={this.tr("action.minimize")}
          >
            <X size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>

        <div className="agri3-popup-content">
          {error && (
            <div className="agri3-error-container">
              <AlertTriangle className="agri3-error-icon" size={20} strokeWidth={2.2} aria-hidden="true" />
              <div className="agri3-error-title">
                {this.tr("status.warning")}
              </div>
              <div className="agri3-error-message">{error}</div>
            </div>
          )}

          {loading && (
            <div className="agri3-loading-container">
              <AgriChartLoader label={this.tr("status.loadingFeature")} />
            </div>
          )}

          {!loading && selectedAttrs && fields.length > 0 && (
            <div className="agri3-field-list">
              {fields
                .filter(
                  (name) => {
                    if (!selectedAttrs.hasOwnProperty(name)) return false;
                    const val = selectedAttrs[name];
                    if (val == null || val === "") return false;
                    if (typeof val === "string" && !val.trim()) return false;
                    return true;
                  },
                )
                .map((name) => (
                  <div className="agri3-field-row" key={name}>
                    <span className="agri3-field-label">
                      {this.getFieldAlias(name)}
                    </span>
                    <span className="agri3-field-value">
                      {this.formatValue(name, selectedAttrs[name])}
                    </span>
                  </div>
                ))}

              {fields.filter(
                (name) =>
                  selectedAttrs.hasOwnProperty(name) &&
                  selectedAttrs[name] != null &&
                  selectedAttrs[name] !== "",
              ).length === 0 && (
                <div className="agri3-status-indicator agri3-status-waiting">
                  <Inbox className="agri3-status-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
                  {this.tr("status.noConfiguredData")}
                </div>
              )}
            </div>
          )}

          {!loading && selectedAttrs && fields.length === 0 && (
            <div className="agri3-status-indicator agri3-status-waiting">
              <Settings2 className="agri3-status-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
              {this.tr("status.noFields")}
            </div>
          )}

          {/* Latest-day vegetation indices */}
          {!loading && selectedAttrs && this.renderLatestIndices()}

          {/* Chart */}
          {!loading && selectedAttrs && this.renderChart()}

          {showAttachments && (
            <div className="agri3-attachments">
              <div className="agri3-attachments-header">
                <div className="agri3-attachments-title">
                  <FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />
                  {this.tr("attachments.title")}{" "}
                  {hasAttachments ? `(${attachments.length})` : ""}
                </div>
              </div>

              {loadingAttachments && (
                <div
                  className="agri3-loading-container agri3-loading-container--compact"
                  style={{ marginTop: 8 }}
                >
                  <AgriChartLoader label={this.tr("status.loadingAttachments")} />
                </div>
              )}

              {!loadingAttachments && !hasAttachments && (
                <div
                  className="agri3-status-indicator agri3-status-waiting"
                  style={{ marginTop: 6 }}
                >
                  <FolderOpen className="agri3-status-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
                  {this.tr("status.noAttachments")}
                </div>
              )}

              {!loadingAttachments && hasAttachments && (
                <div className="agri3-attachments-body">
                  <div className="agri3-attachments-images agri3-grid">
                    {attachments
                      .filter((a) => a.previewObjectUrl)
                      .map((a) => (
                        <a
                          key={`img-${a.id}`}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="agri3-attachment-thumb agri3-card"
                          title={a.name || this.tr("attachment.imageFallback")}
                          download={a.name || undefined}
                        >
                          <img
                            src={a.previewObjectUrl!}
                            alt={a.name || this.tr("attachment.imageFallback")}
                          />
                          <div
                            className="agri3-thumb-caption"
                            title={a.name || ""}
                          >
                            {a.name || this.tr("attachment.imageFallback")}
                          </div>
                        </a>
                      ))}
                  </div>

                  <div className="agri3-attachments-files">
                    {attachments
                      .filter((a) => !a.previewObjectUrl)
                      .map((a) => (
                        <div
                          className="agri3-attachment-file agri3-card"
                          key={`file-${a.id}`}
                        >
                          <div className="agri3-attachment-file-top">
                            <div
                              className="agri3-attachment-file-name"
                              title={a.name || ""}
                            >
                              <Paperclip size={14} strokeWidth={2.2} aria-hidden="true" />
                              {a.name ||
                                this.tr("attachment.fileFallback", {
                                  id: a.id,
                                })}
                            </div>
                            <a
                              className="agri3-attachment-download"
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={a.name || undefined}
                            >
                              <Download size={13} strokeWidth={2.2} aria-hidden="true" />
                              {this.tr("attachment.download")}
                            </a>
                          </div>
                          <div className="agri3-attachment-file-meta">
                            {(a.contentType || "").split("/").pop() || ""}{" "}
                            {a.size ? `• ${this.bytesToSize(a.size)}` : ""}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && !selectedAttrs && !error && (
            <div className="agri3-status-indicator agri3-status-waiting">
              <MousePointerClick className="agri3-status-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
              {this.tr("status.clickPolygon")}
            </div>
          )}
        </div>
      </div>
    );
  };

  render() {
    const { useMapWidgetIds, useDataSources } = this.props;
    const themeClass = this.state.isDarkTheme
      ? "agri3-theme-dark"
      : "agri3-theme-light";

    return (
      <div className={`agri3-attr-card ${themeClass}`}>
        {this.renderPopup()}

        <EvapoHiddenConnectors
          useDataSources={useDataSources}
          useMapWidgetIds={useMapWidgetIds}
          onDataSourceCreated={this.onDataSourceCreated}
          onActiveViewChange={this.onActiveViewChange}
        />

        <div
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            width: "8px",
            height: "8px",
            background: this.state.featureLayers?.length
              ? "#10b981"
              : "#94a3b8",
            borderRadius: "50%",
            opacity: 0.6,
            transition: "all 0.3s ease",
            pointerEvents: "none",
          }}
          title={
            this.state.featureLayers?.length
              ? this.tr("status.ready")
              : this.tr("status.loading")
          }
        />
      </div>
    );
  }
}

interface IHandleLike {
  remove: () => void;
}

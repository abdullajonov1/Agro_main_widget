/** @jsx jsx */
import {
  AppMode,
  Immutable,
  jsx,
  React,
  ReactDOM,
  getAppStore,
  type AllWidgetProps,
} from "jimu-core";
import AgriLocalization from "../embedded/AgriLocalization/runtime/widget";
import AgriRegion10 from "../embedded/AgriRegion10/runtime/widget";
import AgriDateIndexIndicator from "../embedded/AgriDateIndexIndicator/runtime/widget";
import AgriPie10 from "../embedded/AgriPie10/runtime/widget";
import AgriGraff10 from "../embedded/AgriGraff10/runtime/widget";
import AgriBar10 from "../embedded/AgriBar10/runtime/widget";
import AgriPopup from "../embedded/AgriPopup/runtime/widget";
import AgriChartLoader from "../shared/AgriChartLoader";
import { agriNoDataLabel } from "../shared/agriNoDataLabel";
import { TriangleAlert } from "lucide-react";
import EmbeddedAgriMap from "./embedded-agri-map";
import AgriMapIndicatorDrawer, {
  type IndicatorAnimPhase,
} from "./AgriMapIndicatorDrawer";
import {
  type AgriPopupConfig,
  type IMConfig,
  type IndicatorChildConfig,
} from "../config";
import "./agri-dashboard.css";
import { setAccessConfig } from "../shared/agri-access-config";

type ChildSuffix =
  | "localization"
  | "region"
  | "indicator"
  | "indicator-yield"
  | "indicator-unused-land"
  | "indicator-reserve-land"
  | "date-index"
  | "pie"
  | "graff"
  | "bar"
  | "popup";

interface AgriDashboardState {
  indicatorsOpen: boolean;
  indicatorsAnimPhase: IndicatorAnimPhase;
  mapLoading: boolean;
  /** Crop renderer / region-layer prepare — show map spinner until colors ready. */
  mapSurfaceLoading: boolean;
  mapNoData: boolean;
  mapError: string;
  /** True while one of the embedded dashboard data widgets is pending. */
  dashboardLoading: boolean;
  mapPopupOpen: boolean;
  /** When true and popup is open, NDVI card docks left of the pinned popup. */
  mapPopupPinned: boolean;
}

export default class AgriDashboard extends React.PureComponent<
  AllWidgetProps<IMConfig>,
  AgriDashboardState
> {
  private dashboardRootRef = React.createRef<HTMLDivElement>();
  private mapSlotRef = React.createRef<HTMLElement>();
  private indicatorOverlayRef = React.createRef<HTMLDivElement>();
  private indicatorPanelRef = React.createRef<HTMLDivElement>();
  private dateIndexOverlayRef = React.createRef<HTMLDivElement>();
  private portalHost: HTMLElement | null = null;
  private portalReady = false;
  private dashboardResizeObserver: ResizeObserver | null = null;
  private mapLayoutRaf = 0;
  private layoutObserversReady = false;
  private resizeListenerAttached = false;
  private documentMutationObserver: MutationObserver | null = null;
  private documentMutationTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIndicatorToggleAt = 0;
  private indicatorAnimTimer: ReturnType<typeof setTimeout> | null = null;
  private mapIndicatorHost: HTMLElement | null = null;
  private indicatorChildPropsCache: {
    signature: string;
    indicator: AllWidgetProps<any>;
    yield: AllWidgetProps<any>;
    unused: AllWidgetProps<any>;
    reserve: AllWidgetProps<any>;
  } | null = null;
  private lastMapSlotLayoutAt = 0;
  private mapReadyWatchHandle: { remove?: () => void } | null = null;
  private mapUpdatingWatchHandle: { remove?: () => void } | null = null;
  private mapLoadingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private mapSurfaceLoadingSafetyTimer: ReturnType<typeof setTimeout> | null =
    null;
  private watchedMapView: unknown = null;
  private embeddedMapReady = false;

  state: AgriDashboardState = {
    indicatorsOpen: true,
    indicatorsAnimPhase: "expanded",
    mapLoading: true,
    mapSurfaceLoading: false,
    mapNoData: false,
    mapError: "",
    dashboardLoading: false,
    mapPopupOpen: false,
    mapPopupPinned: false,
  };

  private isBuilderDesignMode(): boolean {
    return getAppStore().getState().appRuntimeInfo?.appMode === AppMode.Design;
  }

  private getUiLanguage(): string {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      const fromStorage =
        localStorage.getItem("app_lang") ||
        localStorage.getItem("evapo_app_lang");
      return String(fromUrl || fromStorage || "uz_lat");
    } catch {
      return "uz_lat";
    }
  }

  componentDidMount(): void {
    // The Builder settings surface only needs the lightweight render preview.
    // Do not start map retries, document-wide observers or portal layout work.
    if (this.isBuilderDesignMode()) return;
    document.documentElement.classList.add("agri-dashboard-active");
    this.setupMapSlotObserver();
    this.setupDocumentObserver();
    this.scheduleMapSlotLayout();
    this.scheduleMapLoadingWatchers();
    this.updateDashboardLoadingState();
    document.addEventListener(
      "agriMapSurfaceLoading",
      this.handleMapSurfaceLoading as EventListener,
    );
    document.addEventListener(
      "agriMapNoData",
      this.handleMapNoData as EventListener,
    );
    document.addEventListener(
      "agriMapPopupVisibility",
      this.handleMapPopupVisibility as EventListener,
    );
    requestAnimationFrame(() => {
      this.ensurePortalHost();
      this.forceUpdate(() => {
        this.syncIndicatorOverlayLayout();
      });
    });
  }

  componentDidUpdate(
    prevProps: AllWidgetProps<IMConfig>,
    prevState: AgriDashboardState,
  ): void {
    if (this.isBuilderDesignMode()) return;
    this.ensurePortalHost();
    this.ensureLayoutObservers();
    this.scheduleMapSlotLayout();
    // Only re-bind map watchers when map id or loading-related state needs it —
    // calling every update with no view schedules a 300ms retry forever and
    // can cascade with portal Host DOM mutations.
    const prevMap = String(
      (prevProps.useMapWidgetIds as any)?.[0] ||
        (prevProps.useMapWidgetIds as any)?.get?.(0) ||
        "",
    );
    const nextMap = String(this.getActiveMapWidgetId() || "");
    if (
      prevMap !== nextMap ||
      prevState.mapLoading !== this.state.mapLoading
    ) {
      this.scheduleMapLoadingWatchers();
    }
    this.updateDashboardLoadingState();
    if (
      prevState.indicatorsOpen !== this.state.indicatorsOpen ||
      prevState.indicatorsAnimPhase !== this.state.indicatorsAnimPhase
    ) {
      return;
    }
    this.syncIndicatorOverlayLayout();
  }

  private toggleIndicatorsDrawer = (
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (now - this.lastIndicatorToggleAt < 750) return;
    this.lastIndicatorToggleAt = now;

    const opening = !this.state.indicatorsOpen;
    if (this.indicatorAnimTimer) {
      clearTimeout(this.indicatorAnimTimer);
      this.indicatorAnimTimer = null;
    }

    this.setState({
      indicatorsOpen: opening,
      indicatorsAnimPhase: opening ? "expanding" : "collapsing",
    });

    this.indicatorAnimTimer = setTimeout(
      () => {
        this.indicatorAnimTimer = null;
        if (!this.dashboardRootRef.current) return;
        this.setState({
          indicatorsAnimPhase: opening ? "expanded" : "collapsed",
        });
      },
      opening ? 780 : 720,
    );
  };

  componentWillUnmount(): void {
    if (this.indicatorAnimTimer) {
      clearTimeout(this.indicatorAnimTimer);
      this.indicatorAnimTimer = null;
    }
    document.documentElement.classList.remove("agri-dashboard-active");
    document.removeEventListener(
      "agriMapSurfaceLoading",
      this.handleMapSurfaceLoading as EventListener,
    );
    document.removeEventListener(
      "agriMapNoData",
      this.handleMapNoData as EventListener,
    );
    document.removeEventListener(
      "agriMapPopupVisibility",
      this.handleMapPopupVisibility as EventListener,
    );
    this.dashboardRootRef.current?.classList.remove("agri-popup-open");
    this.dashboardRootRef.current?.classList.remove("agri-popup-pinned");
    this.dashboardResizeObserver?.disconnect();
    this.dashboardResizeObserver = null;
    window.removeEventListener("resize", this.scheduleMapSlotLayout);
    if (this.mapLayoutRaf) cancelAnimationFrame(this.mapLayoutRaf);
    if (this.documentMutationTimer) clearTimeout(this.documentMutationTimer);
    if (this.mapSurfaceLoadingSafetyTimer) {
      clearTimeout(this.mapSurfaceLoadingSafetyTimer);
      this.mapSurfaceLoadingSafetyTimer = null;
    }
    this.documentMutationObserver?.disconnect();
    this.documentMutationObserver = null;
    this.detachMapLoadingWatchers();
    this.clearIndicatorOverlayLayout();
    this.removePortalHost();
  }

  private handleMapSurfaceLoading = (event: Event): void => {
    const detail = (event as CustomEvent)?.detail || {};
    const loading = !!detail.loading;
    if (this.mapSurfaceLoadingSafetyTimer) {
      clearTimeout(this.mapSurfaceLoadingSafetyTimer);
      this.mapSurfaceLoadingSafetyTimer = null;
    }
    if (loading) {
      // ArcGIS may occasionally omit the final redraw callback when a
      // polygon selection and a district-clear happen together. The map is
      // already usable at that point, so never leave the blocking overlay
      // mounted indefinitely.
      this.mapSurfaceLoadingSafetyTimer = setTimeout(() => {
        this.mapSurfaceLoadingSafetyTimer = null;
        if (this.state.mapSurfaceLoading) {
          this.setState({ mapSurfaceLoading: false });
        }
      }, 12000);
    }
    if (loading && this.state.mapNoData) {
      this.setState({ mapSurfaceLoading: true, mapNoData: false });
    } else if (this.state.mapSurfaceLoading !== loading) {
      this.setState({ mapSurfaceLoading: loading });
    }
  };

  private handleMapNoData = (event: Event): void => {
    const detail = (event as CustomEvent)?.detail || {};
    const mapNoData = !!detail.noData;
    if (this.state.mapNoData !== mapNoData) {
      this.setState({ mapNoData });
    }
  };

  private handleMapPopupVisibility = (event: Event): void => {
    const detail = (event as CustomEvent)?.detail || {};
    const open = !!detail.open;
    // Dock NDVI left of popup only when explicitly pinned.
    const nextPinned = open && detail.pinned === true;
    const openChanged = this.state.mapPopupOpen !== open;
    const pinChanged = this.state.mapPopupPinned !== nextPinned;

    if (!openChanged && !pinChanged) {
      if (open) this.syncIndicatorOverlayLayout();
      return;
    }

    // Popup open → auto-collapse indicator drawer so it doesn't cover the map/popup.
    const shouldCollapseIndicators =
      open &&
      openChanged &&
      (this.state.indicatorsOpen ||
        this.state.indicatorsAnimPhase === "expanded" ||
        this.state.indicatorsAnimPhase === "expanding");

    if (shouldCollapseIndicators && this.indicatorAnimTimer) {
      clearTimeout(this.indicatorAnimTimer);
      this.indicatorAnimTimer = null;
    }

    this.setState(
      ({
        mapPopupOpen: open,
        mapPopupPinned: nextPinned,
        ...(shouldCollapseIndicators
          ? {
              indicatorsOpen: false,
              indicatorsAnimPhase: "collapsing" as const,
            }
          : {}),
      } as any),
      () => {
        this.dashboardRootRef.current?.classList.toggle("agri-popup-open", open);
        this.dashboardRootRef.current?.classList.toggle(
          "agri-popup-pinned",
          nextPinned,
        );
        this.syncIndicatorOverlayLayout();
        if (open) {
          requestAnimationFrame(() => this.syncIndicatorOverlayLayout());
          window.setTimeout(() => this.syncIndicatorOverlayLayout(), 80);
        }
        if (shouldCollapseIndicators) {
          this.indicatorAnimTimer = setTimeout(() => {
            this.indicatorAnimTimer = null;
            if (!this.dashboardRootRef.current) return;
            this.setState({ indicatorsAnimPhase: "collapsed" });
          }, 720);
        }
      },
    );
  };

  private createPortalHost(): HTMLElement {
    const surface = this.findSharedLayoutSurface() || document.body;
    let host = surface.querySelector(
      ":scope > .agri-dashboard-portal-host",
    ) as HTMLElement | null;

    if (!host) {
      host = document.createElement("div");
      host.className = "agri-dashboard-portal-host";
      surface.appendChild(host);
    } else if (host.parentElement !== surface) {
      surface.appendChild(host);
    }

    if (surface !== document.body) {
      const surfaceStyle = getComputedStyle(surface);
      if (surfaceStyle.position === "static") {
        surface.style.setProperty("position", "relative");
      }
    }

    return host;
  }

  private ensurePortalHost(): HTMLElement {
    if (!this.portalHost || !this.portalHost.isConnected) {
      this.portalHost = this.createPortalHost();
      this.portalReady = true;
    }
    return this.portalHost;
  }

  private removePortalHost(): void {
    this.portalHost?.remove();
    this.portalHost = null;
    this.portalReady = false;
  }

  private bringPortalHostToFront(): void {
    const host = this.portalHost;
    const surface = this.findSharedLayoutSurface();
    if (host && surface && host.parentElement === surface) {
      surface.appendChild(host);
    }
  }

  private toPlainConfig(): Record<string, unknown> {
    const cfg = this.props.config;
    if (cfg && typeof (cfg as any).asMutable === "function") {
      return (cfg as any).asMutable({ deep: true });
    }
    return { ...(cfg as any) };
  }

  private toPlainPopup(value: unknown): AgriPopupConfig {
    if (!value) return {};
    if (typeof (value as any).asMutable === "function") {
      return (value as any).asMutable({ deep: true });
    }
    return { ...(value as AgriPopupConfig) };
  }

  private getIndicatorConfig(
    baseConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    const indicator = (baseConfig.indicator || {}) as IndicatorChildConfig;
    const endpoint = String(
      indicator.apiEndpoint || indicator.apiUrl || "",
    ).trim();
    const useApiDataSource =
      indicator.useApiDataSource === true && endpoint.length > 0;

    return {
      useApiDataSource,
      apiEndpoint: endpoint,
      responseField: indicator.responseField || "total",
      statOperation: indicator.statOperation || "sum",
      attributeField: indicator.attributeField || "maydon",
      label: indicator.label || "Ekin maydonlari",
      unitLabel: indicator.unitLabel || "ga",
      decimalPlaces: indicator.decimalPlaces ?? 0,
      excludeZeroValues: indicator.excludeZeroValues !== false,
      mapOverlayMode: true,
    };
  }

  private getPopupConfig(
    baseConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    const popup = this.toPlainPopup(baseConfig.agriPopup);
    return {
      fieldsToShow: popup.fieldsToShow || [],
      titleField: popup.titleField || "",
      labels: popup.labels || {},
      settings: {
        zoomToSelection: popup.settings?.zoomToSelection !== false,
        showMapPopup: !!popup.settings?.showMapPopup,
        showAttachments: popup.settings?.showAttachments !== false,
      },
      selectedFieldsMap: popup.selectedFieldsMap,
      chartEnabled: !!popup.chartEnabled,
      chartType: popup.chartType || "bar",
      chartTitle: popup.chartTitle || "",
      chartFields: popup.chartFields || [],
      chartColor: popup.chartColor || "#00a8e8",
    };
  }

  private childProps(
    suffix: ChildSuffix,
    config?: Record<string, unknown>,
  ): AllWidgetProps<any> {
    const mapWidgetId = this.getActiveMapWidgetId();
    const mapIds = Immutable.from([mapWidgetId]);
    const webMapDataSourceId = String(
      (this.toPlainConfig() as any).webMapDataSourceId || "",
    );
    const dataSources = (this.props.useDataSources as any)?.asMutable
      ? (this.props.useDataSources as any).asMutable({ deep: true })
      : Array.from((this.props.useDataSources as any) || []);
    const featureDataSources = dataSources.filter(
      (source: any) => source?.dataSourceId !== webMapDataSourceId,
    );

    return {
      ...this.props,
      id: `${this.props.id}-${suffix}`,
      config: config || this.toPlainConfig(),
      useMapWidgetIds: mapIds,
      useDataSources: Immutable.from(featureDataSources),
    };
  }

  private getStableIndicatorChildProps(
    indicatorConfig: Record<string, unknown>,
    baseConfig: Record<string, unknown>,
  ): {
    indicator: AllWidgetProps<any>;
    yield: AllWidgetProps<any>;
    unused: AllWidgetProps<any>;
    reserve: AllWidgetProps<any>;
  } {
    const mapWidgetId = this.getActiveMapWidgetId();
    const webMapDataSourceId = String(
      (baseConfig as any).webMapDataSourceId || "",
    );
    const dataSources = (this.props.useDataSources as any)?.asMutable
      ? (this.props.useDataSources as any).asMutable({ deep: true })
      : Array.from((this.props.useDataSources as any) || []);
    const featureIds = dataSources
      .filter((source: any) => source?.dataSourceId !== webMapDataSourceId)
      .map((source: any) => String(source?.dataSourceId || ""))
      .join(",");
    const signature = [
      this.props.id,
      mapWidgetId,
      webMapDataSourceId,
      featureIds,
      JSON.stringify(indicatorConfig || {}),
      JSON.stringify({
        useApiDataSource: (baseConfig as any)?.useApiDataSource,
        apiEndpoint: (baseConfig as any)?.apiEndpoint,
        apiUrl: (baseConfig as any)?.apiUrl,
      }),
    ].join("|");

    if (
      this.indicatorChildPropsCache &&
      this.indicatorChildPropsCache.signature === signature
    ) {
      return this.indicatorChildPropsCache;
    }

    const next = {
      signature,
      indicator: this.childProps("indicator", indicatorConfig),
      yield: this.childProps("indicator-yield", baseConfig),
      unused: this.childProps("indicator-unused-land", baseConfig),
      reserve: this.childProps("indicator-reserve-land", baseConfig),
    };
    this.indicatorChildPropsCache = next;
    return next;
  }

  private getLeftPanelWidth(): string {
    const raw = Number(this.props.config?.leftPanelWidthPercent ?? 25);
    const pct = Number.isFinite(raw) ? Math.min(45, Math.max(18, raw)) : 25;
    return `${pct}%`;
  }

  private getRowFrValues(): { top: number; bottom: number } {
    const raw = Number(this.props.config?.bottomRowFraction ?? 38);
    const bottom = Number.isFinite(raw)
      ? Math.min(55, Math.max(28, raw))
      : 38;
    return { top: 100 - bottom, bottom };
  }

  private getActiveMapWidgetId(): string {
    return `${this.props.id}-embedded-map`;
  }

  private getActiveJimuMapView(): any | null {
    const mapWidgetId = this.getActiveMapWidgetId();
    if (!mapWidgetId) return null;

    try {
      const { MapViewManager } = require("jimu-arcgis") as typeof import("jimu-arcgis");
      const group = MapViewManager.getInstance().getJimuMapViewGroup(mapWidgetId);
      const active = group?.getActiveJimuMapView?.();
      if (active?.view) return active;
      const all = group?.getAllJimuMapViews?.() || [];
      return all.find((jmv: any) => !!jmv?.view) || null;
    } catch {
      return null;
    }
  }

  private detachMapLoadingWatchers(): void {
    this.mapReadyWatchHandle?.remove?.();
    this.mapUpdatingWatchHandle?.remove?.();
    this.mapReadyWatchHandle = null;
    this.mapUpdatingWatchHandle = null;
    this.watchedMapView = null;
    if (this.mapLoadingRetryTimer) {
      clearTimeout(this.mapLoadingRetryTimer);
      this.mapLoadingRetryTimer = null;
    }
  }

  private setMapLoading(mapLoading: boolean): void {
    if (this.state.mapLoading !== mapLoading) {
      this.setState({ mapLoading });
    }
  }

  private getMapLoadingState(jimuMapView: any | null): boolean {
    if (!this.getActiveMapWidgetId()) return false;
    const view = jimuMapView?.view;
    if (!view) return !this.embeddedMapReady;
    // Initial boot only — ignore interactive zoom/pan redraws (`updating`).
    return view.ready !== true;
  }

  private updateMapLoadingState = (): void => {
    this.setMapLoading(this.getMapLoadingState(this.getActiveJimuMapView()));
  };

  private attachMapLoadingWatchers(): void {
    const mapWidgetId = this.getActiveMapWidgetId();
    if (!mapWidgetId) {
      this.detachMapLoadingWatchers();
      this.setMapLoading(false);
      return;
    }

    const jimuMapView = this.getActiveJimuMapView();
    const view = jimuMapView?.view as any;
    if (!view) {
      this.detachMapLoadingWatchers();
      this.setMapLoading(true);
      this.scheduleMapLoadingWatchers(300);
      return;
    }

    if (this.watchedMapView === view) {
      this.updateMapLoadingState();
      return;
    }

    this.detachMapLoadingWatchers();
    this.watchedMapView = view;
    const update = this.updateMapLoadingState;
    if (typeof view.watch === "function") {
      this.mapReadyWatchHandle = view.watch("ready", update);
      // Do not watch `updating` — manual zoom/pan would flash the map loader.
    }
    if (typeof view.when === "function") {
      void view.when(update, update);
    }
    update();
  }

  private scheduleMapLoadingWatchers = (delay = 0): void => {
    if (this.mapLoadingRetryTimer) clearTimeout(this.mapLoadingRetryTimer);
    this.mapLoadingRetryTimer = setTimeout(() => {
      this.mapLoadingRetryTimer = null;
      this.attachMapLoadingWatchers();
    }, delay);
  };

  private getDashboardLoadingState(): boolean {
    const root = this.dashboardRootRef.current;
    if (!root) return false;
    return !!root.querySelector(
      [
        ".agri-v11-regional-stats-loading-container",
        ".land-category-loading-container",
        ".land-category-chart-container--loading",
        ".kadastr-status-loading-container",
        ".vegetation-graph-container--loading",
        ".construction-years-loading-container",
        ".agri-status-root--loading",
        ".loading-indicator",
      ].join(","),
    );
  }

  private updateDashboardLoadingState(): void {
    const dashboardLoading = this.getDashboardLoadingState();
    if (this.state.dashboardLoading !== dashboardLoading) {
      this.setState({ dashboardLoading });
    }
  }

  private setupDocumentObserver(): void {
    if (typeof MutationObserver === "undefined") return;
    this.documentMutationObserver = new MutationObserver(
      this.handleDocumentMutation,
    );
    this.documentMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private handleDocumentMutation = (): void => {
    if (this.documentMutationTimer) clearTimeout(this.documentMutationTimer);
    this.documentMutationTimer = setTimeout(() => {
      this.documentMutationTimer = null;
      const now = Date.now();
      this.updateDashboardLoadingState();
      if (now - this.lastMapSlotLayoutAt < 400) return;
      this.lastMapSlotLayoutAt = now;
      this.scheduleMapSlotLayout();
    }, 300);
  };

  private ensureLayoutObservers(): void {
    if (!this.resizeListenerAttached) {
      window.addEventListener("resize", this.scheduleMapSlotLayout, {
        passive: true,
      });
      this.resizeListenerAttached = true;
    }
    if (this.layoutObserversReady || typeof ResizeObserver === "undefined") {
      return;
    }

    this.dashboardResizeObserver = new ResizeObserver(() => {
      this.scheduleMapSlotLayout();
    });

    const root = this.dashboardRootRef.current;
    const slot = this.mapSlotRef.current;
    if (root) this.dashboardResizeObserver.observe(root);
    if (slot) this.dashboardResizeObserver.observe(slot);
    if (root || slot) {
      this.layoutObserversReady = true;
    }
  }

  private setupMapSlotObserver(): void {
    this.ensureLayoutObservers();
  }

  private scheduleMapSlotLayout = (): void => {
    if (this.mapLayoutRaf) cancelAnimationFrame(this.mapLayoutRaf);
    this.mapLayoutRaf = requestAnimationFrame(() => {
      this.mapLayoutRaf = 0;
      const view = this.getActiveJimuMapView()?.view as { resize?: () => void } | undefined;
      view?.resize?.();
    });
  };

  private findSharedLayoutSurface(): HTMLElement | null {
    const dashboardRoot = this.dashboardRootRef.current;
    if (!dashboardRoot) return null;

    const dashboardItem = dashboardRoot.closest(
      ".layout-item, .builder-layout-item",
    ) as HTMLElement | null;
    return dashboardItem?.parentElement || null;
  }

  private readDashboardCssPx(variable: string, fallback: number): number {
    const root = this.dashboardRootRef.current;
    if (!root) return fallback;
    const raw = getComputedStyle(root).getPropertyValue(variable).trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  private applyIndicatorOverlayBounds(
    slotEl: HTMLElement,
    overlayEl: HTMLElement,
  ): void {
    const slotRect = slotEl.getBoundingClientRect();
    const surface = this.findSharedLayoutSurface();
    const host = overlayEl.parentElement;
    const onLayoutSurface =
      !!surface &&
      !!host &&
      (host === surface || host.parentElement === surface);

    const topOffset = this.readDashboardCssPx(
      "--agri-dashboard-indicator-top",
      10,
    );
    const leftOffset = this.readDashboardCssPx(
      "--agri-dashboard-indicator-left",
      10,
    );
    const height = this.readDashboardCssPx(
      "--agri-dashboard-indicator-height",
      58,
    );

    let top = slotRect.top + topOffset;
    let left = slotRect.left + leftOffset;
    let positionMode: "fixed" | "absolute" = "fixed";

    if (onLayoutSurface && surface) {
      const surfaceRect = surface.getBoundingClientRect();
      top = slotRect.top - surfaceRect.top + surface.scrollTop + topOffset;
      left = slotRect.left - surfaceRect.left + surface.scrollLeft + leftOffset;
      positionMode = "absolute";
    }

    const entries: Array<[string, string]> = [
      ["position", positionMode],
      ["top", `${top}px`],
      ["left", `${left}px`],
      ["height", `${height}px`],
      ["min-height", `${height}px`],
      ["max-height", `${height}px`],
      ["right", "auto"],
      ["bottom", "auto"],
      ["margin", "0"],
      ["padding", "0"],
      ["transform", "none"],
      ["z-index", "40"],
      ["box-sizing", "border-box"],
    ];

    entries.forEach(([key, value]) => {
      overlayEl.style.setProperty(key, value, "important");
    });
    overlayEl.style.removeProperty("width");
    overlayEl.style.removeProperty("min-width");
    overlayEl.style.removeProperty("max-width");
    overlayEl.style.removeProperty("overflow");
    overlayEl.style.removeProperty("pointer-events");
    overlayEl.classList.add("agri-dashboard-managed-indicator");
  }

  private applyDateIndexOverlayBounds(
    slotEl: HTMLElement,
    overlayEl: HTMLElement,
  ): void {
    const slotRect = slotEl.getBoundingClientRect();
    const bottomOffset = this.readDashboardCssPx(
      "--agri-dashboard-date-index-bottom",
      12,
    );
    const popupWidth = this.readDashboardCssPx(
      "--agri-dashboard-popup-width",
      340,
    );
    const popupInsetX = this.readDashboardCssPx(
      "--agri-dashboard-popup-inset-x",
      16,
    );
    const dateIndexGap = this.readDashboardCssPx(
      "--agri-dashboard-date-index-gap",
      8,
    );
    const cardWidth = this.readDashboardCssPx(
      "--agri-dashboard-date-index-width",
      168,
    );
    const navSize = this.readDashboardCssPx(
      "--agri-dashboard-date-index-nav-size",
      34,
    );
    const navGap = this.readDashboardCssPx(
      "--agri-dashboard-date-index-nav-gap",
      6,
    );
    const hasDayNav = !!overlayEl.querySelector(
      ".agri-date-index-shell.has-day-nav",
    );
    const width = hasDayNav
      ? cardWidth + 2 * (navSize + navGap)
      : cardWidth;
    const height = this.readDashboardCssPx(
      "--agri-dashboard-date-index-height",
      66,
    );

    // Always use fixed + high z-index so the card is never trapped under the
    // map-slot stacking context (popup lives in a higher portal layer).
    // Default: bottom-right of the map slot.
    let top = slotRect.bottom - height - bottomOffset;
    let left = slotRect.right - width - 10;
    let zIndex = "45";

    // Left of popup only when pinned; unpinned keeps bottom-right.
    // In pin mode also sit at the bottom edge of the popup (left of it).
    if (this.state.mapPopupOpen && this.state.mapPopupPinned) {
      const popupEl = document.querySelector(
        ".agri-dashboard-agri-host .agri3-popup-direct, .agri3-popup-direct.is-pinned, .agri3-popup-direct",
      ) as HTMLElement | null;
      if (popupEl) {
        const popupRect = popupEl.getBoundingClientRect();
        left = Math.max(8, popupRect.left - width - dateIndexGap);
        top = Math.max(8, popupRect.bottom - height);
      } else {
        left =
          slotRect.right - width - (popupWidth + popupInsetX + dateIndexGap);
        top = slotRect.bottom - height - bottomOffset;
      }
      zIndex = "10001";
    } else if (this.state.mapPopupOpen) {
      zIndex = "10001";
    }

    const entries: Array<[string, string]> = [
      ["position", "fixed"],
      ["top", `${Math.round(top)}px`],
      ["left", `${Math.round(left)}px`],
      ["width", `${width}px`],
      ["height", `${height}px`],
      ["max-width", `${width}px`],
      ["min-width", `${width}px`],
      ["min-height", `${height}px`],
      ["max-height", `${height}px`],
      ["right", "auto"],
      ["bottom", "auto"],
      ["margin", "0"],
      ["padding", "0"],
      ["transform", "none"],
      ["overflow", "hidden"],
      ["z-index", zIndex],
      ["pointer-events", "auto"],
      ["box-sizing", "border-box"],
    ];

    entries.forEach(([key, value]) => {
      overlayEl.style.setProperty(key, value, "important");
    });
    overlayEl.classList.add("agri-dashboard-managed-indicator");
  }

  private syncIndicatorOverlayLayout(): void {
    this.ensurePortalHost();
    this.bringPortalHostToFront();
    const slot = this.mapSlotRef.current;
    if (slot) this.mapIndicatorHost = slot;
    const overlay = this.indicatorOverlayRef.current;
    if (slot && overlay) {
      if (slot.contains(overlay)) {
        this.clearOverlayLayout(overlay);
      } else {
        this.applyIndicatorOverlayBounds(slot, overlay);
      }
    }
    const dateIndexOverlay = this.dateIndexOverlayRef.current;
    if (slot && dateIndexOverlay) {
      // Always position via JS so the NDVI card can sit left of the pinned
      // popup while it is open (CSS-only path was leaving it under the popup).
      this.applyDateIndexOverlayBounds(slot, dateIndexOverlay);
    }
  }

  private clearOverlayLayout(overlay: HTMLElement | null): void {
    if (!overlay) return;
    [
      "position",
      "top",
      "left",
      "right",
      "bottom",
      "width",
      "height",
      "max-width",
      "min-width",
      "min-height",
      "max-height",
      "z-index",
      "margin",
      "padding",
      "transform",
      "overflow",
      "box-sizing",
    ].forEach((key) => {
      overlay.style.removeProperty(key);
    });
    overlay.classList.remove("agri-dashboard-managed-indicator");
  }

  private clearIndicatorOverlayLayout(): void {
    this.clearOverlayLayout(this.indicatorOverlayRef.current);
    this.clearOverlayLayout(this.dateIndexOverlayRef.current);
  }

  render() {
    setAccessConfig(this.props.config?.accessConfig);
    const baseConfig = this.toPlainConfig();
    const indicatorConfig = this.getIndicatorConfig(baseConfig);
    const popupConfig = this.getPopupConfig(baseConfig);
    const activeMapId = this.getActiveMapWidgetId();
    const webMapDataSourceId = String((baseConfig as any).webMapDataSourceId || "");
    const allDataSources = (this.props.useDataSources as any)?.asMutable
      ? (this.props.useDataSources as any).asMutable({ deep: true })
      : Array.from((this.props.useDataSources as any) || []);
    const webMapUseDataSource = allDataSources.find(
      (source: any) => String(source?.dataSourceId || "") === webMapDataSourceId,
    );
    const featureUseDataSources = allDataSources.filter(
      (source: any) =>
        !!String(source?.dataSourceId || "") &&
        String(source.dataSourceId) !== webMapDataSourceId,
    );
    const isBuilderDesignPreview =
      getAppStore().getState().appRuntimeInfo?.appMode === AppMode.Design;

    // A newly dropped widget used to mount the map plus all ten embedded
    // widgets immediately, starting their ArcGIS/API queries while Builder
    // was still opening the settings panel. Keep that initial Builder state
    // lightweight throughout Design mode. Preview/published runtime mounts the
    // complete dashboard. This avoids resolving every configured map sublayer
    // while the settings panel is being opened or edited.
    if (isBuilderDesignPreview) {
      return (
        <div
          className="agri-dashboard-v3"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 240,
            padding: 24,
            background: "#1d2031",
            color: "#e8edf7",
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Agri-mainV18
            </div>
            <div style={{ fontSize: 13, opacity: 0.78 }}>
              {webMapDataSourceId || allDataSources.length > 0
                ? "Data source ulangan. Natijani Preview rejimida ko‘ring."
                : "Widget sozlamalaridan Web Map yoki data source ulang."}
            </div>
          </div>
        </div>
      );
    }
    const showMapLoader =
      !!activeMapId &&
      (this.state.mapLoading || this.state.mapSurfaceLoading);
    const portalTarget =
      this.portalReady && this.portalHost
        ? this.portalHost
        : typeof document !== "undefined"
          ? document.body
          : null;
    // Keep map indicators in the map coordinate system during resize.
    // Once attached to the map slot, never fall back to body (avoids remount).
    if (this.mapSlotRef.current) {
      this.mapIndicatorHost = this.mapSlotRef.current;
    }
    const mapIndicatorTarget = this.mapIndicatorHost || portalTarget;

    const indicatorChildProps = this.getStableIndicatorChildProps(
      indicatorConfig,
      baseConfig,
    );

    const indicatorPortal = mapIndicatorTarget
      ? ReactDOM.createPortal(
          <AgriMapIndicatorDrawer
            overlayRef={this.indicatorOverlayRef}
            panelRef={this.indicatorPanelRef}
            phase={this.state.indicatorsAnimPhase}
            onToggle={this.toggleIndicatorsDrawer}
            indicatorProps={indicatorChildProps.indicator}
            yieldProps={indicatorChildProps.yield}
            unusedLandProps={indicatorChildProps.unused}
            reserveLandProps={indicatorChildProps.reserve}
          />,
          mapIndicatorTarget,
        )
      : null;

    const dateIndexPortal = mapIndicatorTarget
      ? ReactDOM.createPortal(
          <div
            ref={this.dateIndexOverlayRef}
            className="agri-dashboard-date-index-overlay agri-dashboard-indicator-overlay--compact"
            aria-label="Selected date and index indicator"
          >
            <AgriDateIndexIndicator
              {...this.childProps("date-index", baseConfig)}
            />
          </div>,
          mapIndicatorTarget,
        )
      : null;

    const popupPortal = portalTarget
      ? ReactDOM.createPortal(
          <div
            className="agri-dashboard-agri-host"
            aria-label="Polygon attribute popup"
          >
            <AgriPopup {...this.childProps("popup", popupConfig)} />
          </div>,
          portalTarget,
        )
      : null;

    const rowFr = this.getRowFrValues();

    return (
      <div
        ref={this.dashboardRootRef}
        className={`agri-dashboard-v3${this.state.mapPopupOpen ? " agri-popup-open" : ""}${this.state.mapPopupPinned ? " agri-popup-pinned" : ""}`}
        style={
          {
            "--agri-dashboard-left-width": this.getLeftPanelWidth(),
            "--agri-dashboard-top-fr": String(rowFr.top),
            "--agri-dashboard-bottom-fr": String(rowFr.bottom),
          } as React.CSSProperties
        }
      >
        <section className="agri-dashboard-header" aria-label="Localization">
          <AgriLocalization {...this.childProps("localization", baseConfig)} />
        </section>

        <div
          className="agri-dashboard-body"
          style={{
            gridTemplateRows: `minmax(0, ${rowFr.top}fr) minmax(220px, ${rowFr.bottom}fr)`,
          }}
        >
          <div className="agri-dashboard-top-row">
            <aside
              className="agri-dashboard-left-panel"
              aria-label="Regional statistics"
            >
              <div className="agri-dashboard-widget-slot">
                <AgriRegion10 {...this.childProps("region", baseConfig)} />
              </div>
            </aside>

            <section
              ref={this.mapSlotRef}
              className={`agri-dashboard-map-slot ${activeMapId ? "has-map" : "is-empty"}${showMapLoader ? " is-loading" : ""}`}
              aria-label="Map area"
            >
              {false && (
                <div className="agri-dashboard-map-slot-placeholder">
                  <span
                    className="agri-dashboard-map-slot-icon"
                    aria-hidden="true"
                  >
                    🗺
                  </span>
                  <span className="agri-dashboard-map-slot-label">Xarita</span>
                  <span className="agri-dashboard-map-slot-hint">
                    Sahifaga Map widget qo&apos;shing — u avtomatik shu joyni
                    egallaydi
                  </span>
                </div>
              )}
              <EmbeddedAgriMap
                mapWidgetId={activeMapId}
                webMapDataSourceId={webMapDataSourceId}
                webMapUseDataSource={webMapUseDataSource}
                featureUseDataSources={featureUseDataSources}
                onViewReady={() => {
                  this.embeddedMapReady = true;
                  this.setMapLoading(false);
                  this.setState({ mapError: "" });
                  this.forceUpdate();
                }}
                onLoadingChange={(mapLoading) => {
                  if (!mapLoading) this.embeddedMapReady = true;
                  this.setMapLoading(mapLoading);
                }}
                onError={(mapError) => this.setState({ mapError })}
              />
              {!!this.state.mapError && (
                <div className="agri-dashboard-map-error" role="alert">
                  {this.state.mapError}
                </div>
              )}
              {showMapLoader && (
                <div
                  className="agri-dashboard-map-loading-overlay"
                  aria-live="polite"
                  aria-label="Map loading"
                >
                  <AgriChartLoader />
                </div>
              )}
              {!showMapLoader && this.state.mapNoData && (
                <div
                  className="agri-dashboard-map-no-data"
                  role="status"
                  aria-live="polite"
                >
                  <div className="agri-dashboard-map-no-data-card">
                    <TriangleAlert
                      className="agri-empty-state-icon"
                      strokeWidth={1.7}
                      aria-hidden="true"
                    />
                    <div className="agri-dashboard-map-no-data-title">
                      {agriNoDataLabel(this.getUiLanguage())}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="agri-dashboard-bottom-row" aria-label="Charts">
            <div className="agri-dashboard-widget-slot">
              <AgriPie10 {...this.childProps("pie", baseConfig)} />
            </div>
            <div className="agri-dashboard-widget-slot">
              <AgriGraff10 {...this.childProps("graff", baseConfig)} />
            </div>
            <div className="agri-dashboard-widget-slot">
              <AgriBar10 {...this.childProps("bar", baseConfig)} />
            </div>
          </div>
        </div>

        {indicatorPortal}
        {dateIndexPortal}
        {popupPortal}
      </div>
    );
  }
}

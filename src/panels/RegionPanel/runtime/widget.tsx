// AgriRegion - Pure UI widget that informs AgriFilter of region selections
// Does NOT filter map directly, only displays data and notifies AgriFilter

import { JimuMapView, JimuMapViewComponent } from "jimu-arcgis";
import {
  AllWidgetProps,
  DataSource,
  DataSourceComponent,
  DataSourceManager,
  QueriableDataSource,
  React,
} from "jimu-core";
import { Button } from "jimu-ui";
import { TriangleAlert, ChevronLeft } from "lucide-react";
import AgriChartLoader from "../../../shared/AgriChartLoader";
import { agriNoDataLabel } from "../../../shared/agriNoDataLabel";
import { AgriRegionBarChart } from "./AgriRegionBarChart";
import { SortAscIcon, SortDescIcon } from "./SortIcons";
import {
  getQueryableLayer,
} from "../../../gis/feature-layer-data";
import { agroV5Log } from "../../../gis/agri-debug-log";
import {
  getAgriTableDataLayer,
} from "../../../gis/agri-table-data-source";
import { translateAgriPlaceForDisplay } from "../../../shared/agri-place-display";
import { bindMasterFilter } from "../../../data/agri-filter-bus";
import { getRegionGroupFeaturesCached } from "../../../data/agri-stats-store";
import {
  accumulateRegionGroupFeaturesByCode,
  regionAccumulatorToSortedRows,
  regionOutStatName,
  type RegionGroupAccumulator,
} from "../../../data/agri-region-stats";
import { findAreaFieldNumeric } from "../../../data/agri-area-field";
import {
  detectIsDarkTheme,
  normalizeLanguage,
  resolveInitialLanguage,
} from "../../../shared/agri-language";
import { getDashboardPack, waitForDashboardPackReady } from "../../../store/agri-dashboard-store";
import { matchRegionDashboardPack } from "../../../data/agri-dashboard-pack-match";
import {
  applyRegionRowPercentages,
  mapRegionPackRows,
  resolveRegionAggregateView,
} from "../../../data/agri-dashboard-pack-apply";
import {
  buildRegionAggregatesWhere,
} from "../../../controller/agri-where-builder";
import "./AgriRegion.css";

type AgriDisplayLanguage = "uz_cyr" | "uz_lat" | "ru" | "en";

type WidgetSize = "xs" | "sm" | "md" | "lg";

function translateForDisplay(
  text: string,
  language: AgriDisplayLanguage,
  placeKind?: "region" | "district",
): string {
  return translateAgriPlaceForDisplay(text, language, placeKind ?? "region");
}

const REGION_DISPLAY_COUNT_OPTIONS = [10, 15, 20] as const;

interface RegionalDataItem {
  name: string;
  maydon: number;
  percentage?: number;
}

interface AgriRegionState {
  regionalLoading: boolean;
  regionalError: string | null;
  regionalData: {
    viloyatlar: RegionalDataItem[];
    tumanlar: RegionalDataItem[];
    totalArea: number;
  };
  // Scope from master (lock)
  lockedViloyat: string | null;
  isLocked: boolean;

  // Current filters from AgriFilter
  currentFilters: {
    yil: string;
    viloyat: string;
    tuman: string;
    turi: string;
    turlar: string[];
    vh: string;
    vhUniqueids: string[] | null;
    /** When VH was selected before ekin turi, charts stay VH-scoped. */
    filterPieByVh: boolean;
  };

  // Navigation
  currentView: "viloyat" | "tuman";
  selectedViloyatForDrillDown: string | null;
  selectedRegion: string | null;

  // UI
  displayCount: number;
  displayCountMenuOpen: boolean;
  /** Default is highest value first; icons cycle through the other sorts. */
  sortMode: "value_desc" | "value_asc";
  isDarkTheme: boolean;
  widgetSize: WidgetSize;
  containerWidth: number;
  chartAreaHeight: number;

  // Map/DS
  activeMapView?: JimuMapView;
  featureLayer?: __esri.FeatureLayer;
  featureLayers: __esri.FeatureLayer[];
  dataSource?: QueriableDataSource;

  areaField: string | null;
  statMode: "sum" | "count";

  connectionStatus: "idle" | "connecting" | "connected" | "failed";
  language: "uz_cyr" | "uz_lat" | "ru" | "en";

  cursorTooltip: {
    visible: boolean;
    data: (RegionalDataItem & { displayName?: string }) | null;
  };
}

export default class AgriRegion extends React.PureComponent<
  AllWidgetProps<any>,
  AgriRegionState
> {
  /** Tuman select debug — visible when __AGRO_V5_TUMAN_DEBUG !== false (default ON). */
  private static regionLog(
    phase: string,
    detail?: Record<string, unknown>,
  ): void {
    const topic =
      /barClicked|notifyAgriFilter|tuman|district/i.test(phase)
        ? ("tuman" as const)
        : ("all" as const);
    agroV5Log(phase, detail, topic);
  }

  _isMounted = false;
  private _unbindMasterFilter: (() => void) | null = null;
  private   _rootRef = React.createRef<HTMLDivElement>();
  private _countFilterRef = React.createRef<HTMLDivElement>();
  private _chartAreaRef = React.createRef<HTMLDivElement>();
  private _chartContainerRef = React.createRef<HTMLDivElement>();
  private _cursorTooltipRef = React.createRef<HTMLDivElement>();
  private _pointerTracking = false;
  private readonly TOOLTIP_PAD = 10;
  private readonly TOOLTIP_OFFSET_X = 16;
  private readonly TOOLTIP_OFFSET_Y = 14;
  private _resizeObserver: ResizeObserver | null = null;
  private _chartAreaObserved = false;
  private _themeObserver: MutationObserver | null = null;
  /**
   * When the user navigates back from a selected tuman, we want to show the VILOYAT list
   * with that viloyat highlighted, while still keeping the map filtered/zoomed to that viloyat.
   * Master filter echoes keep carrying viloyat=<name>; without a sticky highlight mode they
   * would immediately auto-drill back into the tuman list and "Back" would appear broken.
   */
  private _pendingBackToViloyatHighlight: string | null = null;
  /**
   * Bumps on every user-driven geography notify so a delayed async
   * callback (fetchRegionalDataDeduped → notifyAgriFilter) cannot
   * overwrite a newer viloyat/tuman selection.
   */
  private _selectionNotifyGeneration = 0;
  /** Latest regional aggregation request; prevents stale responses/UI states. */
  private _regionalRequestId = 0;

  REGIONAL_COLOR = "#00D2FF";

  constructor(props: AllWidgetProps<any>) {
    super(props);
    const initialLanguage = resolveInitialLanguage();

    this.state = {
      regionalLoading: false,
      regionalError: null,
      regionalData: { viloyatlar: [], tumanlar: [], totalArea: 0 },
      lockedViloyat: null,
      isLocked: false,

      currentFilters: {
        yil: "",
        viloyat: "",
        tuman: "",
        turi: "",
        turlar: [],
        vh: "",
        vhUniqueids: null,
        filterPieByVh: false,
      },

      currentView: "viloyat",
      selectedViloyatForDrillDown: null,
      selectedRegion: null,

      displayCount: 15,
      displayCountMenuOpen: false,
      sortMode: "value_desc",
      isDarkTheme: detectIsDarkTheme(),
      widgetSize: "lg",
      containerWidth: 0,
      chartAreaHeight: 0,

      activeMapView: undefined,
      featureLayer: undefined,
      featureLayers: [],
      dataSource: undefined,

      areaField: this.props.config?.areaField || null,
      statMode: this.props.config?.areaField ? "sum" : "count",

      connectionStatus: "idle",
      language: initialLanguage,

      cursorTooltip: {
        visible: false,
        data: null,
      },
    };
  }

  componentDidMount() {
    AgriRegion.regionLog("componentDidMount — this build IS running", {
      widgetId: (this.props as any)?.id,
      buildMarker: "agri-region10-2026-07-08-diagnostic",
    });
    this._isMounted = true;

    // Master filter — shared in-memory store (AgriLocalization is source of truth)
    this._unbindMasterFilter = bindMasterFilter(this.handleMasterFilterChange);
    document.addEventListener("mousedown", this.handleDocumentClickForCountFilter);
    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleAgriV10ThemeChanged as EventListener,
    );

    this.setupResizeObserver();
    this.syncThemeState();

    this.setState({ connectionStatus: "connecting" });
  }

  componentWillUnmount() {
    this._isMounted = false;
    this.unbindPointerTracking();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._unbindMasterFilter?.();
    this._unbindMasterFilter = null;
    document.removeEventListener(
      "mousedown",
      this.handleDocumentClickForCountFilter,
    );
    document.removeEventListener(
      "agriV11ThemeToggled",
      this.handleAgriV10ThemeChanged as EventListener,
    );
  }

  private handleDocumentClickForCountFilter = (event: MouseEvent): void => {
    if (!this.state.displayCountMenuOpen) return;
    const root = this._countFilterRef.current;
    if (root && event.target instanceof Node && root.contains(event.target)) {
      return;
    }
    this.setState({ displayCountMenuOpen: false });
  };

  private toggleDisplayCountMenu = (): void => {
    this.setState((prev) => ({
      displayCountMenuOpen: !prev.displayCountMenuOpen,
    }));
  };

  private getCurrentDataLength = (): number => {
    const { currentView, regionalData } = this.state;
    return currentView === "viloyat"
      ? regionalData.viloyatlar.length
      : regionalData.tumanlar.length;
  };

  private getEffectiveDisplayCount = (): number => {
    const dataLength = this.getCurrentDataLength();
    const { displayCount } = this.state;
    if (dataLength <= 0) return displayCount > 0 ? displayCount : 15;
    return Math.min(displayCount > 0 ? displayCount : 15, dataLength);
  };

  private getDisplayCountOptions = (): number[] => {
    const dataLength = this.getCurrentDataLength();
    const effectiveCount = this.getEffectiveDisplayCount();
    const max = Math.max(dataLength, effectiveCount, 1);
    const options = new Set<number>();

    for (const opt of [5, 10, 15, 20, 25, 30, 40, 50]) {
      if (opt <= max) options.add(opt);
    }
    if (dataLength > 0) options.add(dataLength);
    if (effectiveCount > 0) options.add(effectiveCount);

    return Array.from(options).sort((a, b) => a - b);
  };

  private resolveDisplayCountForData = (dataLength: number): number => {
    const { displayCount } = this.state;
    if (dataLength <= 0) return displayCount > 0 ? displayCount : 15;
    // Never show more rows than available — if default 15 but region has fewer, use max.
    return Math.min(displayCount > 0 ? displayCount : 15, dataLength);
  };

  private handleDisplayCountPillClick = (count: number): void => {
    if (this.state.displayCountMenuOpen) {
      this.applyDisplayCount(count);
      return;
    }

    if (count === this.getEffectiveDisplayCount()) {
      this.toggleDisplayCountMenu();
    }
  };

  private applyDisplayCount = (count: number): void => {
    this.setState({
      displayCount: count,
      displayCountMenuOpen: false,
    });
  };

  private cycleSortMode = (): void => {
    this.setState((prev) => ({
      sortMode: prev.sortMode === "value_desc" ? "value_asc" : "value_desc",
    }));
  };

  private syncThemeState = () => {
    if (!this._isMounted) return;
    const nextIsDark = detectIsDarkTheme();
    if (nextIsDark !== this.state.isDarkTheme) {
      this.setState({ isDarkTheme: nextIsDark });
    }
  };

  private handleAgriV10ThemeChanged = (event: Event): void => {
    if (!this._isMounted) return;
    const detail: any = (event as CustomEvent).detail || {};
    const nextIsDark =
      typeof detail.isDarkTheme === "boolean"
        ? detail.isDarkTheme
        : String(detail.theme || "").toLowerCase() === "dark";
    if (nextIsDark !== this.state.isDarkTheme) {
      this.setState({ isDarkTheme: nextIsDark });
    }
  };

  private resolveWidgetSize = (width: number): WidgetSize => {
    if (width < 360) return "xs";
    if (width < 520) return "sm";
    if (width < 760) return "md";
    return "lg";
  };

  private setupResizeObserver = () => {
    if (
      typeof window === "undefined" ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const updateSize = () => {
      const host = this._rootRef.current;
      if (!host || !this._isMounted) return;
      const nextSize = this.resolveWidgetSize(host.clientWidth || 0);
      const nextWidth = host.clientWidth || 0;
      const nextChartHeight = Math.floor(
        this._chartAreaRef.current?.clientHeight || 0,
      );
      if (
        nextSize !== this.state.widgetSize ||
        nextWidth !== this.state.containerWidth ||
        nextChartHeight !== this.state.chartAreaHeight
      ) {
        this.setState({
          widgetSize: nextSize,
          containerWidth: nextWidth,
          chartAreaHeight: nextChartHeight,
        });
      }
    };

    updateSize();
    this._resizeObserver = new ResizeObserver(() => updateSize());
    if (this._rootRef.current) {
      this._resizeObserver.observe(this._rootRef.current);
    }
    if (this._chartAreaRef.current) {
      this._resizeObserver.observe(this._chartAreaRef.current);
      this._chartAreaObserved = true;
    }
  };

  componentDidUpdate(): void {
    const chartArea = this._chartAreaRef.current;
    if (!chartArea || !this._resizeObserver || this._chartAreaObserved) return;

    this._resizeObserver.observe(chartArea);
    this._chartAreaObserved = true;
    const nextChartHeight = Math.floor(chartArea.clientHeight || 0);
    if (
      nextChartHeight > 0 &&
      nextChartHeight !== this.state.chartAreaHeight
    ) {
      this.setState({ chartAreaHeight: nextChartHeight });
    }
  }

  /* ---------------------- Master Filter Listener ---------------------- */

  private handleMasterFilterChange = (event: Event) => {
    if (!this._isMounted) return;

    const d: any = (event as CustomEvent).detail || {};
    if (!d.filters) return;

    const f = d.filters;

    const nextTurlar: string[] = Array.from(
      new Set<string>(
        (Array.isArray(f.turlar) ? f.turlar : f.turi ? [f.turi] : [])
          .map((value: unknown) => this.normalizeApos(String(value || "")))
          .filter(Boolean),
      ),
    );
    const nextVh = String(f.vh || "").trim();
    const nextFilterPieByVh = Boolean(f.filterPieByVh);
    const nextTuman = String(f.tuman || "").trim();
    // Prefer viloyat-wide chart ids from Localization. Map/Graff still get
    // district-scoped `vhUniqueids`; using those here collapsed "Tumanlar
    // kesimida" to the selected tuman after VH.
    const normalizeIdList = (raw: unknown): string[] | null => {
      if (!Array.isArray(raw)) return null;
      return Array.from(
        new Set<string>(
          raw
            .map((value: unknown) => String(value || "").trim())
            .filter(Boolean),
        ),
      );
    };
    const regionChartIds = normalizeIdList(d.vhRegionChartUniqueids);
    const nextVhUniqueids: string[] | null = !nextVh
      ? null
      : regionChartIds != null
        ? regionChartIds
        : !nextTuman
          ? normalizeIdList(d.vhUniqueids)
          : null;
    const next = {
      yil: f.yil || "",
      viloyat: f.viloyat || "",
      tuman: f.tuman || "",
      turi: f.turi || "",
      turlar: nextTurlar,
      vh: nextVh,
      vhUniqueids: nextVhUniqueids,
      filterPieByVh: nextFilterPieByVh,
    };

    const lockedViloyat = d?.scope?.lockedViloyat
      ? String(d.scope.lockedViloyat)
      : null;
    const isLocked = Boolean(d?.scope?.locked);
    const language = normalizeLanguage(
      (f.language as any) || this.state.language,
    );

    const prev = this.state.currentFilters;

    const languageChanged = language !== this.state.language;
    // VH and Pie (ekin turi) must not refetch Region — hudud bars ignore both.
    const meaningfulChanged =
      next.yil !== prev.yil ||
      next.viloyat !== prev.viloyat ||
      next.tuman !== prev.tuman ||
      lockedViloyat !== this.state.lockedViloyat ||
      isLocked !== this.state.isLocked;

    // If only language changed, update UI strings without re-fetching data.
    if (!meaningfulChanged && languageChanged) {
      this.setState({ language, regionalError: null }, () => {
        // UI re-renders automatically; no data refetch needed.
      });
      return;
    }

    if (!meaningfulChanged) return;

    const effectiveViloyat = lockedViloyat || next.viloyat || "";
    const nextViloyatKey = this.normalizeApos(String(effectiveViloyat || ""))
      .trim()
      .toLowerCase();
    const highlightKey = this.normalizeApos(
      String(this.state.selectedRegion || ""),
    )
      .trim()
      .toLowerCase();
    const pendingHighlight = (this._pendingBackToViloyatHighlight || "").trim();
    const pendingKey = this.normalizeApos(pendingHighlight).toLowerCase();

    // Back → viloyat list with highlight: master filter still has viloyat set.
    // Stay on the viloyat list for every echo while that highlight is active
    // (pending once, then selectedRegion === viloyat + currentView === viloyat).
    const stayOnViloyatListHighlight =
      !next.tuman &&
      !!nextViloyatKey &&
      ((pendingKey && pendingKey === nextViloyatKey) ||
        (this.state.currentView === "viloyat" &&
          !this.state.selectedViloyatForDrillDown &&
          !!highlightKey &&
          highlightKey === nextViloyatKey));

    if (stayOnViloyatListHighlight) {
      this._pendingBackToViloyatHighlight = null;
      const highlightName = pendingHighlight || this.state.selectedRegion;
      const prevLocked = this.state.lockedViloyat;
      const needsBarRefetch =
        next.yil !== prev.yil || lockedViloyat !== prevLocked;
      this.setState(
        {
          currentFilters: {
            ...this.state.currentFilters,
            yil: next.yil,
            // Keep UI at viloyat list: do NOT store viloyat filter here,
            // otherwise the next echo looks like a fresh drill-down.
            viloyat: "",
            tuman: "",
            turi: next.turi,
            turlar: next.turlar,
            vh: next.vh,
            vhUniqueids: next.vhUniqueids,
            filterPieByVh: next.filterPieByVh,
          },
          lockedViloyat,
          isLocked,
          language,
          regionalError: null,
          currentView: "viloyat",
          selectedViloyatForDrillDown: null,
          selectedRegion: highlightName,
        },
        () => {
          if (needsBarRefetch) this.fetchRegionalDataDeduped();
        },
      );
      return;
    }

    this.setState(
      {
        currentFilters: {
          ...this.state.currentFilters,
          yil: next.yil,
          viloyat: next.viloyat,
          tuman: next.tuman,
          turi: next.turi,
          turlar: next.turlar,
          vh: next.vh,
          vhUniqueids: next.vhUniqueids,
          filterPieByVh: next.filterPieByVh,
        },
        lockedViloyat,
        isLocked,
        language,
        regionalError: null,
      },
      () => {
        // ✅ If user is locked, "top" view should effectively be tumans of locked viloyat
        const eff = lockedViloyat || next.viloyat || "";

        if (next.tuman) {
          this.setState(
            {
              currentView: "tuman",
              selectedViloyatForDrillDown: eff,
              selectedRegion: next.tuman,
            },
            this.fetchRegionalDataDeduped,
          );
        } else if (eff) {
          // External / first-time viloyat selection → show that viloyat's tumans.
          this.setState(
            {
              currentView: "tuman",
              selectedViloyatForDrillDown: eff,
              selectedRegion: null,
            },
            this.fetchRegionalDataDeduped,
          );
        } else {
          this.setState(
            {
              currentView: "viloyat",
              selectedViloyatForDrillDown: null,
              selectedRegion: null,
            },
            this.fetchRegionalDataDeduped,
          );
        }
      },
    );
  };

  /* ---------------------- Notify AgriFilter ---------------------- */

  private notifyAgriFilter = (
    updates: Partial<AgriRegionState["currentFilters"]>,
    generation?: number,
  ) => {
    if (
      generation !== undefined &&
      generation !== this._selectionNotifyGeneration
    ) {
      AgriRegion.regionLog("notifyAgriFilter:SKIP-stale-generation", {
        generation,
        current: this._selectionNotifyGeneration,
        updates,
      });
      return;
    }

    const detail = {
      ...updates,
      source: "AgriRegion",
      timestamp: Date.now(),
    };

    AgriRegion.regionLog("notifyAgriFilter:dispatching", { detail });
    document.dispatchEvent(
      new CustomEvent("widgetSelectionChanged", {
        detail,
        bubbles: true,
      }),
    );
  };

  /** Capture a generation token before any await that later notifies filters. */
  private beginSelectionNotify = (): number => {
    this._selectionNotifyGeneration += 1;
    return this._selectionNotifyGeneration;
  };

  /* ---------------------- Map Connection ---------------------- */

  onActiveViewChange = async (jimuMapView: JimuMapView) => {
    if (!jimuMapView) return;

    try {
      // Agri_table_data is an external Table, not part of the map or a
      // builder-assigned Data Source — it is loaded directly by URL.
      const { layer: featureLayer } = await getAgriTableDataLayer();
      const featureLayers = [featureLayer];

      const area = this.detectAreaField(featureLayer);
      const statMode: "sum" | "count" = area ? "sum" : "count";

      this.setState({
        activeMapView: jimuMapView,
        featureLayer,
        featureLayers,
        connectionStatus: "connected",
        regionalError: null,
        areaField: area,
        statMode,
      });
    } catch (err: any) {
      this.setState({
        regionalError: `Connection error: ${err?.message || err}`,
        connectionStatus: "failed",
      });
    }
  };

  private resolveFeatureLayerFromUseDataSource = async (
    jimuMapView: JimuMapView,
  ): Promise<__esri.FeatureLayer | null> => {
    if (!jimuMapView?.view?.map) return null;

    const useDs = this.props.useDataSources?.[0];
    if (!useDs?.dataSourceId) return null;

    return this.resolveFeatureLayerFromOneUseDataSource(useDs, jimuMapView);
  };

  private resolveFeatureLayerFromOneUseDataSource = async (
    useDs: any,
    jimuMapView: JimuMapView,
  ): Promise<__esri.FeatureLayer | null> => {
    if (!jimuMapView?.view?.map || !useDs?.dataSourceId) return null;

    const dsId = useDs.dataSourceId;
    const rootId = (useDs as any).rootDataSourceId;

    const jlvList: any[] = jimuMapView.getAllJimuLayerViews?.() || [];
    const matchByDsId = (id: string) =>
      jlvList.find(
        (lv) => lv?.layerDataSourceId === id || lv?.dataSourceId === id,
      );
    let jlv = matchByDsId(dsId) || (rootId ? matchByDsId(rootId) : null);
    // getQueryableLayer handles both plain FeatureLayers and Map Image Layer
    // roots by drilling into .sublayers/.allSublayers for a queryable child —
    // the same shared helper agri/agri-main's widgets rely on.
    const jlvQueryable = getQueryableLayer(jlv?.layer);
    if (jlvQueryable) {
      return jlvQueryable as __esri.FeatureLayer;
    }

    try {
      const ds: any = DataSourceManager.getInstance().getDataSource(dsId);
      if (ds?.getLayer) {
        const lyr = await ds.getLayer();
        const queryableLyr = getQueryableLayer(lyr);
        if (queryableLyr) return queryableLyr as __esri.FeatureLayer;
      }
      const url: string | undefined = ds?.url || ds?.layer?.url;
      if (url) {
        const layers = jimuMapView.view.map.layers.toArray() as any[];
        const cand = layers.find((ly: any) => ly?.url === url);
        const queryableCand = getQueryableLayer(cand);
        if (queryableCand) return queryableCand as __esri.FeatureLayer;
      }
    } catch {
      /* ignore */
    }

    return null;
  };

  private splitLabelTwoLines = (label: string): [string, string?] => {
    // Single-line + CSS ellipsis (eco RegionStatsChart overflow: truncate).
    const safe = String(label || "").trim();
    return [safe || ""];
  };

  private calculateDynamicYAxisWidth = (): number => {
    // Fixed label column like eco-monitoring RegionStatsChart
    // (axisYLabelWidth ~88–104). Long names truncate with "…".
    const { widgetSize } = this.state;
    if (widgetSize === "xs") return 78;
    if (widgetSize === "sm") return 88;
    if (widgetSize === "md") return 96;
    return 104;
  };

  private resolveFeatureLayersFromUseDataSources = async (
    jimuMapView: JimuMapView,
  ): Promise<__esri.FeatureLayer[]> => {
    const raw =
      (this.props.useDataSources as any)?.asMutable?.() ??
      this.props.useDataSources ??
      [];
    const useDss = Array.isArray(raw) ? raw : [];
    const layers: __esri.FeatureLayer[] = [];
    for (const useDs of useDss) {
      const layer = await this.resolveFeatureLayerFromOneUseDataSource(
        useDs,
        jimuMapView,
      );
      if (layer) layers.push(layer);
    }
    return layers;
  };

  private detectAreaField = (layer: __esri.FeatureLayer): string | null =>
    findAreaFieldNumeric(layer, {
      configField: this.props.config?.areaField,
    });

  onDataSourceCreated = (ds: DataSource) => {
    this.setState({ dataSource: ds as QueriableDataSource });
  };

  /* ---------------------- Data Fetch ---------------------- */

  private normalizeApos = (s: string) =>
    (s ?? "")
      .normalize("NFKC")
      .replace(/['''ʻʼ`]/g, "'")
      .trim();

  private buildWhereForAggregates(
    viewOverride?: "viloyat" | "tuman",
    drillViloyatOverride?: string,
  ): string {
    const { currentFilters, lockedViloyat } = this.state;
    const view = viewOverride || this.state.currentView;

    const effectiveLock = lockedViloyat || "";
    const drillViloyat =
      drillViloyatOverride ||
      this.state.selectedViloyatForDrillDown ||
      effectiveLock ||
      currentFilters.viloyat ||
      "";

    return buildRegionAggregatesWhere({
      yil: currentFilters.yil || "",
      viloyat: currentFilters.viloyat || "",
      // Hudud ignores Pie crop — omit turi/turlar from the aggregate WHERE.
      turi: "",
      turlar: [],
      lockedViloyat: effectiveLock,
      view,
      drillViloyat,
    });
  }

  /**
   * Hudud (Region) is never scoped by Vegetatsiya Holati or ekin turi —
   * only yil / geography. Kept as a no-op wrapper so queryAggregates stays simple.
   */
  private buildVhScopedWheres = async (
    baseWhere: string,
  ): Promise<string[]> => {
    return [baseWhere];
  };

  private queryAggregates = async (
    groupField: string,
    whereOverride?: string,
    /** `region` / `district` — bars are identified by this code, not the name. */
    codeField?: string | null,
  ): Promise<RegionalDataItem[]> => {
    const { featureLayers, featureLayer, areaField, statMode } = this.state;
    const layers = featureLayers?.length
      ? featureLayers
      : featureLayer
        ? [featureLayer]
        : [];
    if (!layers.length) return [];

    const acc: RegionGroupAccumulator = {};
    const where = whereOverride || this.buildWhereForAggregates();
    const scopedWheres = await this.buildVhScopedWheres(where);
    const outName = regionOutStatName(statMode as "sum" | "count");

    for (const fl of layers) {
      // Reuse the already-loaded Agri_table_data singleton — do not
      // new FeatureLayer().load() per aggregate (extra FeatureServer?f=json).
      const layerForQuery = fl as __esri.FeatureLayer;
      if (!layerForQuery?.loaded && typeof (layerForQuery as any)?.load === "function") {
        try {
          await (layerForQuery as any).load();
        } catch {
          /* query may still succeed */
        }
      }

      const queryOne = async (scopedWhere: string): Promise<any[]> => {
        return getRegionGroupFeaturesCached({
          layer: layerForQuery,
          where: scopedWhere,
          groupField,
          codeField: codeField ?? null,
          statMode: statMode as any,
          areaField,
          objectIdField: layerForQuery.objectIdField || "OBJECTID",
        });
      };

      // Avoid both the old sequential waterfall and an unbounded request
      // burst. Four concurrent statistics queries keeps the server responsive.
      const concurrency = 4;
      for (let i = 0; i < scopedWheres.length; i += concurrency) {
        const batches = await Promise.all(
          scopedWheres.slice(i, i + concurrency).map(queryOne),
        );
        for (const feats of batches) {
          accumulateRegionGroupFeaturesByCode(
            feats,
            { groupField, codeField: codeField ?? null, outName },
            acc,
          );
        }
      }
    }

    return regionAccumulatorToSortedRows(acc) as RegionalDataItem[];
  };

  private fetchRegionalData = async () => {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;

    const requestId = ++this._regionalRequestId;
    const isCurrent = () =>
      this._isMounted && requestId === this._regionalRequestId;
    const { currentFilters, lockedViloyat } = this.state;

    // ✅ Only require YEAR
    if (!currentFilters.yil) {
      this.setState({
        regionalData: { viloyatlar: [], tumanlar: [], totalArea: 0 },
        regionalLoading: false,
        regionalError: null,
        currentView: "viloyat",
        selectedViloyatForDrillDown: null,
        selectedRegion: null,
      });
      return;
    }

    this.setState({
      // Every real query gets a visible pending state. Existing bars must not
      // remain interactive while they represent the previous filter.
      regionalLoading: true,
      regionalError: null,
    });

    try {
      const { effectiveViloyat, effectiveView, groupField, codeField } =
        resolveRegionAggregateView({
          lockedViloyat,
          selectedViloyatForDrillDown: this.state.selectedViloyatForDrillDown,
          filterViloyat: currentFilters.viloyat,
        });

      const where = this.buildWhereForAggregates(
        effectiveView,
        effectiveViloyat,
      );
      // Region ignores VH — never wait on vhUniqueids / flash empty under VH.

      // Shared DashboardPack hit — Region is never VH-scoped, so pack is OK
      // even while Pie/Indicator are deferred under an active VH status.
      let rows: RegionalDataItem[] | null = null;
      let packTotalArea: number | null = null;
      {
        await waitForDashboardPackReady(2500);
        if (!isCurrent()) return;
        const regionPack = matchRegionDashboardPack(getDashboardPack(), {
          view: effectiveView,
          groupField,
          where,
          hasVh: false,
        });
        if (regionPack) {
          rows = mapRegionPackRows(regionPack);
          packTotalArea = regionPack.totalArea;
        }
      }
      if (!rows) {
        rows = await this.queryAggregates(groupField, where, codeField);
      }
      if (!isCurrent()) return;

      const { totalArea, withPct } = applyRegionRowPercentages(
        rows,
        packTotalArea,
      );

      if (!isCurrent()) return;

      // ✅ Sync view state so UI matches the real effective view
      if (effectiveView === "tuman") {
        if (
          this.state.currentView !== "tuman" ||
          this.state.selectedViloyatForDrillDown !== effectiveViloyat
        ) {
          this.setState({
            currentView: "tuman",
            selectedViloyatForDrillDown: effectiveViloyat,
            selectedRegion: this.state.selectedRegion, // keep
          });
        }

        this.setState({
          regionalData: { viloyatlar: [], tumanlar: withPct, totalArea },
          displayCount: this.resolveDisplayCountForData(withPct.length),
          regionalLoading: false,
          regionalError: null,
        });
      } else {
        if (this.state.currentView !== "viloyat") {
          this.setState({
            currentView: "viloyat",
            selectedViloyatForDrillDown: null,
            selectedRegion: null,
          });
        }

        this.setState({
          regionalData: { viloyatlar: withPct, tumanlar: [], totalArea },
          regionalLoading: false,
          regionalError: null,
        });
      }
    } catch (e: any) {
      if (!isCurrent()) return;
      this.setState({
        regionalError: `Failed to load data: ${e?.message || e}`,
        regionalLoading: false,
      });
    }
  };

  private _lastRegionalFetchKey = "";

  private fetchRegionalDataDeduped = async () => {
    const {
      currentFilters,
      currentView,
      selectedViloyatForDrillDown,
      lockedViloyat,
    } = this.state;

    const key = JSON.stringify({
      yil: currentFilters.yil || "",
      view: currentView,
      drillViloyat: selectedViloyatForDrillDown || "",
      lockedViloyat: lockedViloyat || "",
    });

    if (key === this._lastRegionalFetchKey) {
      return;
    }

    this._lastRegionalFetchKey = key;
    await this.fetchRegionalData();
  };

  /* ---------------------- User Interactions ---------------------- */

  private handleRegionSelectionClick = (
    data: { name?: string; payload?: RegionalDataItem & { name?: string } },
    _index?: number,
    _e?: React.MouseEvent<SVGPathElement, MouseEvent>,
  ): void => {
    const item =
      (data as any)?.payload && typeof (data as any).payload === "object"
        ? ((data as any).payload as RegionalDataItem & { name?: string })
        : data;
    AgriRegion.regionLog("barClicked", {
      data: item,
      connectionStatus: this.state.connectionStatus,
      currentView: this.state.currentView,
      hasName: !!item?.name,
    });
    if (this.state.connectionStatus !== "connected" || !item?.name) {
      AgriRegion.regionLog("barClicked:SKIPPED", {
        reason:
          this.state.connectionStatus !== "connected"
            ? "not-connected"
            : "no-name-on-clicked-datum",
      });
      return;
    }

    const regionName = item.name;

    if (regionName === this.state.selectedRegion) {
      // Deselect (toggle off) — works in both views:
      //  • TUMAN view: clear the tuman, keep the drilled viloyat.
      //  • VILOYAT view: clear the viloyat entirely (back to whole country).
      const gen = this.beginSelectionNotify();
      this.setState({ selectedRegion: null }, () => {
        if (this.state.currentView === "tuman") {
          this.notifyAgriFilter(
            {
              tuman: "",
              viloyat: this.state.selectedViloyatForDrillDown || "",
            },
            gen,
          );
        } else {
          this.notifyAgriFilter({ viloyat: "", tuman: "" }, gen);
        }
        // ❌ no fetch here needed, master will trigger it (and dedupe protects anyway)
      });
      return;
    }

    if (this.state.currentView === "viloyat") {
      // Drill down to tuman — notify geography FIRST so Localization/Graff
      // see the new viloyat immediately; bar data can load after.
      const gen = this.beginSelectionNotify();
      this.notifyAgriFilter({ viloyat: regionName, tuman: "" }, gen);
      this.setState(
        {
          currentView: "tuman",
          selectedViloyatForDrillDown: regionName,
          selectedRegion: null,
        },
        () => {
          void this.fetchRegionalDataDeduped();
        },
      );
      return;
    }

    // Select tuman — notify immediately with both viloyat + tuman.
    const gen = this.beginSelectionNotify();
    this.notifyAgriFilter(
      {
        viloyat: this.state.selectedViloyatForDrillDown || "",
        tuman: regionName,
      },
      gen,
    );
    this.setState({ selectedRegion: regionName });
  };

  private navigateBack = () => {
    if (this.state.connectionStatus !== "connected") return;

    // ✅ If user is locked, "Back" should go to TUMAN list of locked viloyat
    if (this.state.lockedViloyat) {
      const lock = this.state.lockedViloyat;
      const gen = this.beginSelectionNotify();
      this.notifyAgriFilter(
        { tuman: "", polygonMode: false, uniqueid: "" } as any,
        gen,
      );

      this.setState(
        {
          currentView: "tuman",
          selectedViloyatForDrillDown: lock,
          selectedRegion: null,
        },
        () => {
          void this.fetchRegionalDataDeduped();
        },
      );
      return;
    }

    // ✅ Normal (unlocked) behavior:
    // Back from a drilled region (or any selection) clears the region selection
    // and returns to the republic-wide viloyat list.
    const drilledViloyat = (this.state.selectedViloyatForDrillDown || "").trim();
    const selectedTuman = (this.state.selectedRegion || "").trim();

    if (
      (this.state.currentView === "tuman" && drilledViloyat) ||
      selectedTuman
    ) {
      this._pendingBackToViloyatHighlight = null;
      const gen = this.beginSelectionNotify();
      this.notifyAgriFilter(
        {
          viloyat: "",
          tuman: "",
          polygonMode: false,
          uniqueid: "",
        } as any,
        gen,
      );
      this.setState(
        {
          currentView: "viloyat",
          selectedViloyatForDrillDown: null,
          selectedRegion: null,
          currentFilters: {
            ...this.state.currentFilters,
            viloyat: "",
            tuman: "",
          },
        },
        () => {
          void this.fetchRegionalDataDeduped();
        },
      );
      return;
    }

    const gen = this.beginSelectionNotify();
    // Full clear → republic-wide map + widgets.
    this.notifyAgriFilter(
      {
        viloyat: "",
        tuman: "",
        turi: "",
        vh: "",
        polygonMode: false,
        uniqueid: "",
      } as any,
      gen,
    );
    this.setState(
      {
        currentView: "viloyat",
        selectedViloyatForDrillDown: null,
        selectedRegion: null,
        currentFilters: {
          ...this.state.currentFilters,
          viloyat: "",
          tuman: "",
          turi: "",
          turlar: [],
          vh: "",
          vhUniqueids: null,
        },
      },
      () => {
        this.fetchRegionalDataDeduped();
      },
    );
  };

  /* ---------------------- Render ---------------------- */

  private formatNumber = (value: number | null | undefined, decimals = 0) => {
    if (value == null) return "-";
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return num.toLocaleString("ru-RU", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  private clampCursorPosition = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } => {
    const surface = this._rootRef.current;
    const tip = this._cursorTooltipRef.current;
    if (!surface) return { x: 0, y: 0 };

    const rect = surface.getBoundingClientRect();
    const pad = this.TOOLTIP_PAD;
    const tw = tip?.offsetWidth || 148;
    const th = tip?.offsetHeight || 58;

    let x = clientX - rect.left + this.TOOLTIP_OFFSET_X;
    let y = clientY - rect.top + this.TOOLTIP_OFFSET_Y;

    if (x + tw > surface.clientWidth - pad) {
      x = clientX - rect.left - tw - this.TOOLTIP_OFFSET_X;
    }
    if (y + th > surface.clientHeight - pad) {
      y = clientY - rect.top - th - this.TOOLTIP_OFFSET_Y;
    }

    x = Math.max(pad, Math.min(x, surface.clientWidth - tw - pad));
    y = Math.max(pad, Math.min(y, surface.clientHeight - th - pad));

    return { x: Math.round(x), y: Math.round(y) };
  };

  private getClientPoint = (
    ...args: Array<{ nativeEvent?: MouseEvent } & Partial<MouseEvent> | unknown>
  ): { x: number; y: number } => {
    for (const arg of args) {
      if (!arg || typeof arg !== "object") continue;
      const src: any = (arg as any).nativeEvent || arg;
      if (
        typeof src.clientX === "number" &&
        Number.isFinite(src.clientX) &&
        typeof src.clientY === "number" &&
        Number.isFinite(src.clientY)
      ) {
        return { x: src.clientX, y: src.clientY };
      }
    }
    return { x: 0, y: 0 };
  };

  private applyTooltipPosition = (x: number, y: number): void => {
    const node = this._cursorTooltipRef.current;
    if (!node) return;
    // Prefer left/top over transform — dashboard/Recharts CSS often forces
    // `transform: none`, which freezes a translate3d-based cursor tip.
    node.style.setProperty("left", `${x}px`, "important");
    node.style.setProperty("top", `${y}px`, "important");
    node.style.setProperty("right", "auto", "important");
    node.style.setProperty("bottom", "auto", "important");
    node.style.setProperty("transform", "none", "important");
    node.style.setProperty("transition", "none", "important");
  };

  private bindPointerTracking = (): void => {
    if (this._pointerTracking) return;
    this._pointerTracking = true;
    window.addEventListener("mousemove", this.handleGlobalPointerMove, {
      passive: true,
    });
  };

  private unbindPointerTracking = (): void => {
    if (!this._pointerTracking) return;
    this._pointerTracking = false;
    window.removeEventListener(
      "mousemove",
      this.handleGlobalPointerMove,
      // match addEventListener options so the listener actually detaches
      { passive: true } as EventListenerOptions,
    );
  };

  private handleGlobalPointerMove = (e: MouseEvent): void => {
    if (!this.state.cursorTooltip.visible) return;

    const surface = this._rootRef.current;
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;

    if (!inside) {
      this.hideCursorTooltip();
      return;
    }

    const pos = this.clampCursorPosition(e.clientX, e.clientY);
    this.applyTooltipPosition(pos.x, pos.y);
  };

  private hideCursorTooltip = (): void => {
    this.unbindPointerTracking();
    if (!this.state.cursorTooltip.visible) return;
    this.setState({
      cursorTooltip: { visible: false, data: null },
    });
  };

  private handleWidgetPointerLeave = (): void => {
    this.hideCursorTooltip();
  };

  private handleBarRowClick = (
    item: RegionalDataItem & { displayName?: string },
  ): void => {
    this.handleRegionSelectionClick({ payload: item });
  };

  private handleBarRowPointerEnter = (
    item: RegionalDataItem & { displayName?: string },
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    this.handleBarPointerEnter(item, 0, event as unknown as React.MouseEvent<SVGPathElement>);
  };

  private handleBarRowPointerMove = (
    _item: RegionalDataItem & { displayName?: string },
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    this.handleBarPointerMove(_item, 0, event as unknown as React.MouseEvent<SVGPathElement>);
  };

  private handleBarPointerEnter = (
    data: unknown,
    _index: number,
    e: React.MouseEvent<SVGPathElement, MouseEvent>,
  ): void => {
    const item = ((data as any)?.payload ?? data) as RegionalDataItem & {
      displayName?: string;
    };
    const { x: clientX, y: clientY } = this.getClientPoint(e, data);

    this.bindPointerTracking();

    const showTooltip = () => {
      const pos = this.clampCursorPosition(clientX, clientY);
      this.applyTooltipPosition(pos.x, pos.y);
    };

    this.setState(
      {
        cursorTooltip: {
          visible: true,
          data: item,
        },
      },
      showTooltip,
    );
  };

  private handleBarPointerMove = (
    data: unknown,
    _index: number,
    e: React.MouseEvent<SVGPathElement, MouseEvent>,
  ): void => {
    if (!this.state.cursorTooltip.visible) return;
    const { x: clientX, y: clientY } = this.getClientPoint(e, data);
    if (!clientX && !clientY) return;
    const pos = this.clampCursorPosition(clientX, clientY);
    this.applyTooltipPosition(pos.x, pos.y);
  };

  private handleChartSurfaceMove = (
    e: React.MouseEvent<HTMLDivElement>,
  ): void => {
    if (!this.state.cursorTooltip.visible) return;
    const { x: clientX, y: clientY } = this.getClientPoint(e.nativeEvent, e);
    if (!clientX && !clientY) return;
    const pos = this.clampCursorPosition(clientX, clientY);
    this.applyTooltipPosition(pos.x, pos.y);
  };

  private renderCursorTooltipContent = (
    d: RegionalDataItem & { displayName?: string },
  ): React.ReactNode => {
    const language = this.state.language;
    const tooltipValueLabel =
      language === "en"
        ? "Value:"
        : language === "ru"
        ? "Значение:"
        : language === "uz_lat"
          ? "Qiymat:"
          : "Қиймат:";
    const tooltipPercentLabel =
      language === "en"
        ? "Percentage:"
        : language === "ru"
        ? "Процент:"
        : language === "uz_lat"
          ? "Foiz:"
          : "Фоиз:";
    const areaUnit = language === "en" ? "ha" : language === "uz_lat" ? "ga" : "га";
    const tooltipTitle =
      d?.displayName ?? (d as any)?.displayNameTranslated ?? d?.name ?? "";

    return (
      <>
        <div className="agri-v11-regional-tooltip-title">{tooltipTitle}</div>
        <div className="agri-v11-regional-tooltip-content">
          <div className="agri-v11-regional-tooltip-row">
            <span className="agri-v11-regional-tooltip-label">{tooltipValueLabel}</span>
            <span className="agri-v11-regional-tooltip-value">
              {this.formatNumber(d.maydon)} {areaUnit}
            </span>
          </div>
          <div className="agri-v11-regional-tooltip-row">
            <span className="agri-v11-regional-tooltip-label">{tooltipPercentLabel}</span>
            <span className="agri-v11-regional-tooltip-value">
              {(d.percentage ?? 0).toFixed(1)}%
            </span>
          </div>
        </div>
      </>
    );
  };

  render() {
    const {
      regionalLoading,
      regionalError,
      regionalData,
      selectedRegion,
      displayCountMenuOpen,
      sortMode,
      connectionStatus,
      currentView,
      selectedViloyatForDrillDown,
      currentFilters,
      language,
      isDarkTheme,
      widgetSize,
      cursorTooltip,
    } = this.state;

    const labelColumnWidth = this.calculateDynamicYAxisWidth();
    const yAxisWidth = labelColumnWidth + 2;
    const chartTrackRightInset = 0;
    const chartBarGap = 6;

    const currentData =
      currentView === "viloyat"
        ? regionalData.viloyatlar
        : regionalData.tumanlar;

    // Build display names first so alpha sort is stable and matches UI language.
    const chartDataBase = [...currentData].map((r) => {
      const displayBase = r.name.replace(
        currentView === "viloyat" ? /\s*viloyat(?:i)?$/i : /\s*tumani$/i,
        "",
      );
      const displayName = translateForDisplay(displayBase, language, currentView === "viloyat" ? "region" : "district");
      return { ...r, displayName };
    });

    const sorted =
      sortMode === "value_asc"
        ? [...chartDataBase].sort((a, b) => a.maydon - b.maydon)
        : [...chartDataBase].sort((a, b) => b.maydon - a.maydon);

    const effectiveDisplayCount = this.getEffectiveDisplayCount();

    const limited =
      currentView === "viloyat"
        ? sorted
        : effectiveDisplayCount > 0
          ? sorted.slice(0, effectiveDisplayCount)
          : sorted;

    const chartData = limited.map((r, i) => ({
      ...r, // keep original `name` for selection notifications
      index: i + 1,
      displayName: (r as any).displayName,
    }));

    const rowCount = Math.max(chartData.length, 1);
    const measuredChartHeight = this.state.chartAreaHeight;
    const chartAreaHeight = Math.max(measuredChartHeight, rowCount * 20);

    const breadcrumb =
      currentView === "viloyat"
        ? language === "en"
          ? "By regions"
          : language === "ru"
            ? "Статистика по областям"
            : language === "uz_lat"
              ? "Viloyatlar kesimida"
              : "Вилоят кесимида"
        : `${translateForDisplay(
            (selectedViloyatForDrillDown ?? "").replace(
              /\s*viloyat(?:i)?$/i,
              "",
            ),
            language,
            "region",
          )} - ${
            language === "en"
              ? "by districts"
              : language === "ru"
              ? "по районам"
              : language === "uz_lat"
                ? "tumanlar kesimida"
                : "туманлар кесимида"
          }`;

    const unitLabel = language === "en" ? "ha" : language === "uz_lat" ? "ga" : "га";

    // Scale bars to the largest row: max maydon = 100% of the track.
    // (Previously axis was inflated for value-label reserve, leaving a large
    // empty gap after the top district.)
    const maxMaydon = chartData.reduce(
      (max, item) => Math.max(max, Number(item.maydon) || 0),
      0,
    );
    const chartAxisMax = maxMaydon > 0 ? maxMaydon : 1;

    const chartViewKey = `${currentView}:${selectedViloyatForDrillDown ?? ""}:${sortMode}:${effectiveDisplayCount}`;

    const countFilterLabel =
      language === "en"
        ? "Row count"
        : language === "ru"
        ? "Количество строк"
        : language === "uz_lat"
          ? "Qatorlar soni"
          : "Қаторлар сони";

    const sortTitle =
      sortMode === "value_asc"
        ? language === "en"
          ? "Ascending"
          : language === "ru"
          ? "По возрастанию"
          : language === "uz_lat"
            ? "O'sish"
            : "Ўсиш"
        : language === "en"
          ? "Descending"
          : language === "ru"
          ? "По убыванию"
          : language === "uz_lat"
            ? "Kamayish"
            : "Камайиш";

    const selectYearTitle =
      language === "en"
        ? "📅 Select a year"
        : language === "ru"
        ? "📅 Выберите год"
        : language === "uz_lat"
          ? "📅 Yilni tanlang"
          : "📅 Йилни танланг";

    const selectYearBody =
      language === "en"
        ? "Select a year first to view statistics"
        : language === "ru"
        ? "Чтобы просматривать статистику, сначала выберите год"
        : language === "uz_lat"
          ? "Statistikani ko‘rish uchun avval yilni tanlang"
          : "Статистикани кўриш учун аввал йилни танланг";

    const backButtonText =
      language === "en" ? "Back" : language === "ru" ? "Назад" : language === "uz_lat" ? "Orqaga" : "Орқага";

    const showBackButton =
      currentView === "tuman" || !!selectedRegion?.trim();

    const retryButtonText =
      language === "en"
        ? "Reload"
        : language === "ru"
        ? "Перезагрузить"
        : language === "uz_lat"
          ? "Qayta yuklash"
          : "Қайта юкла";

    const mapErrorFallback =
      language === "en"
        ? "Could not connect to the map."
        : language === "ru"
        ? "Не удалось подключиться к карте."
        : language === "uz_lat"
          ? "Xaritaga ulana olmadik."
          : "Харитага улана олмадик.";

    return (
      <div
        className={`agri-v11-regional-stats-card ${isDarkTheme ? "agri-v11-region-dark" : "agri-v11-region-light"}`}
        data-region-size={widgetSize}
        ref={this._rootRef}
        onMouseLeave={this.handleWidgetPointerLeave}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        >
          {this.props.useDataSources?.length > 0 && (
            <DataSourceComponent
              key={String(this.props.useDataSources[0]?.dataSourceId || "ds-0")}
              useDataSource={this.props.useDataSources[0]}
              onDataSourceCreated={this.onDataSourceCreated}
            />
          )}
          <JimuMapViewComponent
            useMapWidgetId={this.props.useMapWidgetIds?.[0]}
            onActiveViewChange={this.onActiveViewChange}
          />
        </div>

        <div className="agri-v11-regional-stats-content">
          <div className="agri-v11-regional-stats-header">
            <div className="agri-v11-regional-stats-header-left">
              <div className="agri-v11-regional-stats-navigation">
                {showBackButton && (
                  <button
                    className="agri-v11-regional-stats-back-button"
                    onClick={this.navigateBack}
                    title={backButtonText}
                    aria-label={backButtonText}
                  >
                    <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="agri-v11-regional-stats-header-title">{breadcrumb}</div>
            </div>
            <div className="agri-v11-regional-stats-header-controls">
              {currentView === "tuman" && (
                <div
                  ref={this._countFilterRef}
                  className={`agri-v11-regional-stats-count-filter ${displayCountMenuOpen ? "is-open" : ""}`}
                >
                  <div
                    className="agri-v11-regional-stats-count-menu"
                    role="listbox"
                    aria-label={countFilterLabel}
                    aria-expanded={displayCountMenuOpen}
                  >
                    {this.getDisplayCountOptions().reverse().map((count) => (
                      <button
                        key={count}
                        type="button"
                        role="option"
                        aria-selected={effectiveDisplayCount === count}
                        className={`agri-v11-regional-stats-count-pill ${effectiveDisplayCount === count ? "is-active" : ""} ${
                          !displayCountMenuOpen && effectiveDisplayCount !== count
                            ? "is-collapsed"
                            : ""
                        }`}
                        onClick={() => this.handleDisplayCountPillClick(count)}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="agri-v11-regional-stats-sort-buttons">
                <button
                  type="button"
                  className="agri-v11-regional-stats-sort-button active"
                  onClick={this.cycleSortMode}
                  onMouseDown={(e) => e.preventDefault()}
                  title={sortTitle}
                  aria-label={sortTitle}
                >
                  {sortMode === "value_desc" ? (
                    <SortDescIcon />
                  ) : (
                    <SortAscIcon />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div
            className="agri-v11-regional-stats-body"
            ref={this._chartAreaRef}
          >
          {connectionStatus === "connecting" ? (
            <div className="agri-v11-regional-stats-loading-container">
              <AgriChartLoader />
            </div>
          ) : connectionStatus === "failed" ? (
            <div className="agri-v11-regional-stats-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
              <p>{regionalError || mapErrorFallback}</p>
            </div>
          ) : !currentFilters.yil ? (
            <div className="agri-v11-regional-stats-loading-container">
              <AgriChartLoader />
            </div>
          ) : regionalLoading ? (
            <div className="agri-v11-regional-stats-loading-container">
              <AgriChartLoader />
            </div>
          ) : regionalError ? (
            <div className="agri-v11-regional-stats-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
              <p>{regionalError}</p>
              <Button onClick={this.fetchRegionalData} type="primary" size="sm">
                {retryButtonText}
              </Button>
            </div>
          ) : currentData.length === 0 ? (
            <div className="agri-v11-regional-stats-no-data">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
              <h3>{agriNoDataLabel(language)}</h3>
            </div>
          ) : (
            <div
              className="agri-v11-regional-stats-chart-scroll"
              ref={this._chartContainerRef}
              onMouseMove={this.handleChartSurfaceMove}
            >
              <AgriRegionBarChart
                data={chartData}
                chartAreaHeight={chartAreaHeight}
                chartBarGap={chartBarGap}
                chartTrackRightInset={chartTrackRightInset}
                nameColumnWidth={labelColumnWidth}
                chartAxisMax={chartAxisMax}
                unitLabel={unitLabel}
                selectedRegion={selectedRegion}
                viewKey={chartViewKey}
                formatNumber={(value) => this.formatNumber(value)}
                onRowClick={this.handleBarRowClick}
                onRowPointerEnter={this.handleBarRowPointerEnter}
                onRowPointerMove={this.handleBarRowPointerMove}
              />
            </div>
          )}
          </div>
        </div>

        {cursorTooltip.visible && cursorTooltip.data ? (
          <div
            ref={this._cursorTooltipRef}
            className="agri-v11-regional-tooltip agri-v11-regional-tooltip-cursor-follow"
          >
            {this.renderCursorTooltipContent(cursorTooltip.data)}
          </div>
        ) : null}
      </div>
    );
  }
}

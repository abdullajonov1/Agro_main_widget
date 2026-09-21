import * as echarts from "echarts";
import { JimuMapView, JimuMapViewComponent } from "jimu-arcgis";
import {
  AllWidgetProps,
  DataSource,
  DataSourceComponent,
  ImmutableArray,
  QueriableDataSource,
  React,
} from "jimu-core";
import { Button } from "jimu-ui";
import { TriangleAlert } from "lucide-react";
import AgriChartLoader from "../../../shared/AgriChartLoader";
import { agriNoDataLabel } from "../../../shared/agriNoDataLabel";
import { getAgriDashboardBootstrap } from "../../../data/agri-bootstrap";
import {
  buildSpatialJoinWhere,
  expandUniqueIdsForAgriTable,
  getAgriTableDataLayer,
  queryAgriRegionDistrictMappings,
  queryAgriTuriCropMappings,
} from "../../../gis/agri-table-data-source";
import { escapeArcGIS } from "../../../gis/feature-layer-data";
import {
  VH_CATEGORY_TO_NDVI_STATUS,
  queryVegetationCropBreakdownForStatus,
  queryVegetationCropStatsForStatus,
  type VegetationCropBreakdownRow,
} from "../../../gis/agri-vegetation-data-source";
import {
  getPieVhFilterUniqueIds,
  getPieVhFilterUniqueIdsSig,
} from "../../../gis/agri-chart-filter-order";
import { agroV5Log } from "../../../gis/agri-debug-log";
import { resolveInitialLanguage } from "../../../shared/agri-language";
import { bindMasterFilter } from "../../../data/agri-filter-bus";
import { getPieCategoryStatsCached } from "../../../data/agri-stats-store";
import {
  AREA_FIELD_PREFERRED_PIE,
  findAreaFieldByPreferredNames,
} from "../../../data/agri-area-field";
import { getDashboardPack, waitForDashboardPackReady } from "../../../store/agri-dashboard-store";
import { matchPieDashboardPack } from "../../../data/agri-dashboard-pack-match";
import {
  buildPieCategoriesFromMergedRows,
  buildPieCategoriesFromPackRows,
  syncPieSelectionAgainstCategories,
} from "../../../data/agri-dashboard-pack-apply";
import { buildPieStatsWhere } from "../../../controller/agri-where-builder";
import {
  MAP_CONNECTION_RETRY_MS,
  MAX_MAP_CONNECTION_ATTEMPTS,
} from "../../../shared/map-connection-service";
import {
  getCropColor,
  getCropDisplayName,
  getTuriCropLookupKey,
  normalizeCropName,
  type AgriCropLanguage,
} from "../../../shared/agri-crop-labels";

/* ---------- Types ---------- */

interface CategoryData {
  key: string;
  value: number;
  percentage?: number;
}

interface AgriPieProps extends AllWidgetProps<any> {
  externalFilters?: {
    viloyat?: string;
    tuman?: string;
    yil?: string;
    turi?: string;
  };
  useMapWidgetIds?: ImmutableArray<string>;
}

interface AgriPieState {
  loading: boolean;
  error: string | null;

  categoryData: {
    categories: CategoryData[];
    totalValue: number;
  };
  vh: string;
  /** NDVI raster date used by VH bar (from master filter). */
  ndviDate: string;
  /** Bar chart's current attribute (e.g. status_2025_06_12); use with barCategoryValue to filter like Graff */
  barCategoryField: string | null;
  barCategoryValue: string | null;

  // Filter hierarchy (incoming from other widgets)
  yil: string;
  viloyat: string;
  /** AgriFilter scope: viloyat qulflash (filters.viloyat bo‘sh bo‘lishi mumkin) */
  lockedViloyat: string;
  tuman: string;
  turi: string;
  turlar: string[];
  /** When true, pie is scoped by VH uniqueids (VH was selected first). */
  filterPieByVh: boolean;
  /** Signature of the uniqueid set used for VH→pie filtering. */
  pieVhUniqueIdsSig: string;
  /** Exact STIR from header search (master filter). */
  farmerInn: string;

  // UI state
  activeSlice: number | null;
  selectedCategory: string | null;
  selectedCategories: string[];
  hoveredSlice: number | null;

  // Map-related
  activeMapView?: JimuMapView;

  // Event tracking
  lastFilterEventTimestamp: number;
  isHandlingExternalEvent: boolean;

  // Connection status
  mapConnectionAttempts: number;
  mapLoadingStatus: "idle" | "loading" | "loaded" | "failed";
  connectionStatus: "idle" | "connecting" | "connected" | "failed";

  // Data source
  dataSource?: QueriableDataSource;

  // Resolved FeatureLayers for multi-DS routing by viloyat
  featureLayers?: __esri.FeatureLayer[];
  activeFeatureLayer?: __esri.FeatureLayer;

  // Debug
  debugInfo: string;
  language: "uz_cyr" | "uz_lat" | "ru" | "en";
  isDarkTheme: boolean;
}

/* ---------- Component ---------- */

export default class AgriPie extends React.PureComponent<
  AgriPieProps,
  AgriPieState
> {
  _isMounted = false;
  private _unbindMasterFilter: (() => void) | null = null;

  // Crop palette (matches AgriLocalization renderer)
  private static readonly CROP_COLOR_MAP: Record<string, string> = {
    "bug'doy": "#D9A300",
    bugdoy: "#D9A300",
    paxta: "#E8E1D1",
    makka: "#7CB342",
    sholi: "#26A69A",
    mosh: "#8E44AD",
    beda: "#43A047",
    ozuqa: "#8BC34A",
    loviya: "#6A5ACD",
    poliz: "#F26B38",
    tariq: "#C58F00",
    "bog'": "#1B5E20",
    bog: "#1B5E20",
    "yeryong'oq": "#8D6E63",
    yeryongoq: "#8D6E63",
    sabzi: "#E65100",
    kungaboqar: "#FDD835",
    baliqxovuz: "#0288D1",
    "baliq hovuz": "#0288D1",
    boshqa: "#78909C",
  };

  // Fallback palette (for unknown categories)
  /** Thin grey edge so light/white slices (e.g. paxta) stay visible on light UI */
  private static readonly PIE_SLICE_EDGE = {
    borderColor: "rgba(100, 116, 139, 0.55)",
    borderWidth: 1,
  };

  private static readonly FALLBACK_COLORS = [
    "#1E7AE6",
    "#202124",
    "#6C6FD5",
    "#56AEDA",
    "#F6A11A",
    "#FF4E46",
    "#8B95A7",
    "#7B61FF",
    "#2AA1FF",
    "#00C389",
    "#D97706",
    "#EF4444",
    "#0EA5E9",
    "#4F46E5",
    "#334155",
  ];

  private static adjustHexColor(hex: string, amount: number): string {
    const normalized = hex.replace("#", "").trim();
    if (!normalized) return hex;

    const expand =
      normalized.length === 3
        ? normalized
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : normalized;

    if (expand.length !== 6) return hex;

    const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
    const channels = [0, 2, 4].map((offset) =>
      clamp(parseInt(expand.slice(offset, offset + 2), 16) + amount),
    );

    return `#${channels
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;
  };

  private getSliceBorderColor = (): string =>
    this.state.isDarkTheme ? "#1f2030" : "#ffffff";

  private getSliceFillStyle = (
    baseColor: string,
  ): string | { type: "linear"; x: number; y: number; x2: number; y2: number; colorStops: Array<{ offset: number; color: string }> } => {
    const color = (baseColor || "#3b82f6").toLowerCase();
    if (color === "#E8E1D1" || color === "#fff") {
      return {
        type: "linear",
        x: 0,
        y: 0,
        x2: 1,
        y2: 1,
        colorStops: [
          { offset: 0, color: "#f8fafc" },
          { offset: 0.55, color: "#dbe4ee" },
          { offset: 1, color: "#94a3b8" },
        ],
      };
    }

    return {
      type: "linear",
      x: 0,
      y: 0,
      x2: 1,
      y2: 1,
      colorStops: [
        { offset: 0, color: AgriPie.adjustHexColor(baseColor, 34) },
        { offset: 0.48, color: baseColor },
        { offset: 1, color: AgriPie.adjustHexColor(baseColor, -30) },
      ],
    };
  };

  // Timing/connection — shared with dashboard / Localization / Indicator / Graff
  MAX_CONNECTION_ATTEMPTS = MAX_MAP_CONNECTION_ATTEMPTS;
  CONNECTION_TIMEOUT_MS = 15000;

  private static readonly APOSTROPHE_VARIANTS = ["'", "'", "'", "ʻ", "ʼ", "`"];
  private _latestKey = "";
  private _didInitOnce = false;

  // Viloyat normalized key -> index into `state.featureLayers`
  private _viloyatKeyToLayerIndex: Record<string, number> = {};
  private _featureLayersInitPromise: Promise<void> | null = null;

  // ✅ NEW: De-duplication for fetch
  private _fetchCounter = 0;
  private _lastFetchKey = "";
  /** Key of an in-flight VH pie wait (bridge pending) — must not clear loader. */
  private _pendingVhPieFetchKey = "";
  private _fetchDebounceTimer: any = null;
  private _pieChartRef = React.createRef<HTMLDivElement>();
  private _pieChart: echarts.ECharts | null = null;
  private _pieChartHostEl: HTMLDivElement | null = null;
  private _pieResizeObserver: ResizeObserver | null = null;
  private _pieObservedStage: Element | null = null;
  private _pieResizeRaf = 0;
  /** After first paint, subsequent option updates morph like Agrobank. */
  private _pieHasRendered = false;
  /** Stable slice key order so region changes morph arcs in place. */
  private _pieStableKeys: string[] = [];
  private _pieStableRawKeys: Record<string, string> = {};
  /** True only after at least one category fetch finished (success or empty). */
  private _hasCompletedFetch = false;
  /** crop_id → display turi (first spelling seen in Agri_table_data). */
  private _cropIdToTuri: Record<string, string> = {};
  /** Canonical turi key → crop_id for master-filter selection sync. */
  private _turiToCropId: Record<string, string> = {};
  private _cropMapsReady = false;

  constructor(props: AgriPieProps) {
    super(props);

    const initialLanguage = resolveInitialLanguage();

    let initialIsDarkTheme = true;
    try {
      const savedTheme = localStorage.getItem("agri_v11_app_theme");
      initialIsDarkTheme =
        savedTheme !== null ? savedTheme === "dark" : true;
    } catch {
      initialIsDarkTheme = true;
    }

    this.state = {
      loading: false,
      error: null,
      categoryData: { categories: [], totalValue: 0 },

      yil: "",
      viloyat: "",
      lockedViloyat: "",
      tuman: "",
      turi: "",
      turlar: [],
      filterPieByVh: false,
      pieVhUniqueIdsSig: "",
      farmerInn: "",
      vh: "",
      ndviDate: "",
      barCategoryField: null,
      barCategoryValue: null,

      activeSlice: null,
      selectedCategory: null,
      selectedCategories: [],
      hoveredSlice: null,

      activeMapView: undefined,

      lastFilterEventTimestamp: 0,
      isHandlingExternalEvent: false,

      mapConnectionAttempts: 0,
      mapLoadingStatus: "idle",
      connectionStatus: "idle",

      dataSource: undefined,

      featureLayers: [],
      activeFeatureLayer: undefined,

      debugInfo: "Widget initializing",
      language: initialLanguage,
      isDarkTheme: initialIsDarkTheme,
    };
  }

  private initializeTheme = () => {
    try {
      const savedTheme = localStorage.getItem("agri_v11_app_theme");
      const isDarkTheme =
        savedTheme !== null ? savedTheme === "dark" : true;
      this.setState({ isDarkTheme });
    } catch {
      this.setState({ isDarkTheme: true });
    }
  };

  private handleThemeToggled = (event: Event) => {
    const d: any = (event as CustomEvent)?.detail || {};
    if (typeof d.isDarkTheme === "boolean") {
      this.setState({ isDarkTheme: d.isDarkTheme });
      return;
    }

    if (d.theme === "dark" || d.theme === "light") {
      this.setState({ isDarkTheme: d.theme === "dark" });
      return;
    }

    try {
      const savedTheme = localStorage.getItem("agri_v11_app_theme");
      const isDarkTheme =
        savedTheme !== null ? savedTheme === "dark" : true;
      this.setState({ isDarkTheme });
    } catch {
      this.setState({ isDarkTheme: true });
    }
  };

  /* ---------- DS helpers ---------- */

  onDataSourceCreated = (ds: DataSource) => {
    const queriableDs = ds as QueriableDataSource;

    if (typeof (queriableDs as any).setListenSelection === "function") {
      (queriableDs as any).setListenSelection(false);
    }
    this.setState({ dataSource: queriableDs, error: null }, async () => {
      if (this.state.connectionStatus === "connected") {
        await this.fetchCategoryData();
      }
    });
  };

  onDataSourceInfoChange = (info: any) => {
    if (!this._isMounted) return;
    if (this.state.connectionStatus !== "connected") return;
    if (!info) return;

    const sawRecords = Array.isArray(info.records);
    if (!sawRecords) return;

    this.fetchCategoryData();
  };

  findFieldByPossibleNames(possibleNames: string[]): string | null {
    const { dataSource } = this.state;
    if (!dataSource) return null;

    const schema = dataSource.getSchema();
    if (!schema || !schema.fields) return null;

    const fieldNames = Object.keys(schema.fields).map((f) => f.toLowerCase());

    for (const name of possibleNames) {
      const exact = fieldNames.findIndex((f) => f === name.toLowerCase());
      if (exact !== -1) return Object.keys(schema.fields)[exact];
    }
    for (const name of possibleNames) {
      const partial = fieldNames.findIndex((f) =>
        f.includes(name.toLowerCase()),
      );
      if (partial !== -1) return Object.keys(schema.fields)[partial];
    }
    return null;
  }

  findCategoryField(flOverride?: __esri.FeatureLayer | null): string | null {
    // Prefer crop_id so spelling variants of the same crop stay one slice.
    const possible = ["crop_id", "turi", "ekin_turi", "crop_type"];

    const fl = flOverride ?? this.state.activeFeatureLayer;
    const fields = fl?.fields ?? [];
    if (fields.length) {
      const byLower = new Map(
        fields.map((f: any) => [String(f.name).toLowerCase(), f.name]),
      );
      for (const p of possible) {
        const exact = byLower.get(p.toLowerCase());
        if (exact) return exact;
      }
    }

    const fromDS = this.findFieldByPossibleNames(possible);
    if (fromDS) return fromDS;

    return "crop_id";
  }

  private buildWhereClauseForDS(
    opts: {
      includeCategory?: boolean;
      includeViloyat?: boolean;
      districtCode?: number | null;
    } = {},
  ): string {
    const includeCategory = opts.includeCategory !== false;
    const includeViloyat = opts.includeViloyat !== false;
    // Match Agro_widgetV1: scope by selected viloyat (not lockedViloyat)
    // when includeViloyat is on; layer routing handles region layers.
    const { yil, viloyat, tuman, turi, lockedViloyat, turlar, farmerInn } =
      this.state;
    // Pie selection keys are crop_id; SQL still filters the `turi` text field.
    const turiNames = this.cropIdsToTuriNames(
      Array.isArray(turlar) && turlar.length
        ? turlar
        : turi
          ? [turi]
          : [],
    );

    return buildPieStatsWhere(
      {
        yil: yil || "",
        viloyat: viloyat || "",
        tuman: tuman || "",
        turi: turiNames.length === 1 ? turiNames[0] : "",
        turlar: turiNames,
        lockedViloyat: lockedViloyat || "",
        districtCode: opts.districtCode ?? null,
        farmerInn: farmerInn || "",
      },
      { includeCategory, includeViloyat },
    );
  }

  /** WHERE fragments for VH→pie uniqueid filter (empty = no VH scope). */
  private buildPieVhWhereChunks(
    idsOverride?: string[] | null,
  ): string[] | null {
    if (!this.state.filterPieByVh) return null;
    const ids =
      idsOverride !== undefined ? idsOverride : getPieVhFilterUniqueIds();
    if (!ids) return null;
    if (!ids.length) return ["1=0"];
    const CHUNK = 800;
    const chunks: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      chunks.push(buildSpatialJoinWhere(ids.slice(i, i + CHUNK)));
    }
    return chunks;
  }

  /* ---------- Normalize / Escape ---------- */

  private normalizeName(s: string): string {
    return normalizeCropName(s);
  }

  private async ensureCropIdMaps(): Promise<void> {
    if (this._cropMapsReady) return;
    const rows = await queryAgriTuriCropMappings();
    const cropIdToTuri: Record<string, string> = {};
    const turiToCropId: Record<string, string> = {};
    for (const row of rows) {
      const id = String(row.cropId || "").trim();
      const turi = String(row.turi || "").trim();
      if (!id || !turi) continue;
      if (!cropIdToTuri[id]) cropIdToTuri[id] = turi;
      const turiKey = getTuriCropLookupKey(turi);
      if (turiKey && !turiToCropId[turiKey]) turiToCropId[turiKey] = id;
    }
    this._cropIdToTuri = cropIdToTuri;
    this._turiToCropId = turiToCropId;
    this._cropMapsReady = true;
  }

  private resolveCropIdToTuri(cropId: string): string {
    const id = String(cropId || "").trim();
    if (!id) return "";
    return this._cropIdToTuri[id] || id;
  }

  private resolveTuriToCropId(turi: string): string {
    const raw = String(turi || "").trim();
    if (!raw) return "";
    // Already a known crop_id.
    if (this._cropIdToTuri[raw]) return raw;
    const key = getTuriCropLookupKey(raw);
    if (key && this._turiToCropId[key]) return this._turiToCropId[key];
    return raw;
  }

  private cropIdsToTuriNames(ids: string[]): string[] {
    return Array.from(
      new Set(
        ids
          .map((id) => this.normalizeName(this.resolveCropIdToTuri(id)))
          .filter(Boolean),
      ),
    );
  }

  private turiNamesToCropIds(names: string[]): string[] {
    return Array.from(
      new Set(
        names
          .map((name) => String(this.resolveTuriToCropId(name) || "").trim())
          .filter(Boolean),
      ),
    );
  }

  private getCropColor(rawKey: string, index: number): string {
    const turi = this.resolveCropIdToTuri(rawKey);
    return getCropColor(turi, index);
  }

  private getCategoryDisplayName(
    rawKey: string,
    language: AgriCropLanguage,
  ): string {
    const turi = this.resolveCropIdToTuri(rawKey);
    return getCropDisplayName(turi, language);
  }

  private makeAposVariants(s: string): string[] {
    const base = this.normalizeName(s);
    if (!base) return [""];
    if (!base.includes("'")) return [base];

    const mask = base.replace(/'/g, "\uFFFF");
    const variants = AgriPie.APOSTROPHE_VARIANTS.map((ch) =>
      mask.split("\uFFFF").join(ch),
    );
    return Array.from(new Set(variants));
  }

  private eqAposSmart(field: string, raw: string): string {
    const variants = this.makeAposVariants(raw);
    const clauses = variants
      .filter((v) => v)
      .map((v) => `${field}='${escapeArcGIS(v)}'`);
    if (!clauses.length) return "";
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  }
  private makeViloyatKey(raw: string | null | undefined): string {
    if (raw == null) return "";
    return this.normalizeName(String(raw))
      .replace(/['ʻʼ`´]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  private isRepublicLayer = (layer?: __esri.FeatureLayer): boolean => {
    if (!layer) return false;
    const text =
      `${(layer as any)?.title || ""} ${(layer as any)?.id || ""} ${(layer as any)?.url || ""}`.toLowerCase();
    return /\brepublic\b|respublika/.test(text);
  };

  private getDefaultFeatureLayer = (
    layersOverride?: __esri.FeatureLayer[],
  ): __esri.FeatureLayer | undefined => {
    const layers =
      (layersOverride && layersOverride.length
        ? layersOverride
        : this.state.featureLayers) || [];
    if (!layers.length) return this.state.activeFeatureLayer;

    const republic = layers.find((l) => this.isRepublicLayer(l));
    if (republic) return republic;

    return layers[0] || this.state.activeFeatureLayer;
  };

  private getFeatureLayerForViloyat = (
    viloyat: string,
  ): __esri.FeatureLayer | undefined => {
    const layers = this.state.featureLayers ?? [];
    if (!layers.length) return undefined;
    const key = this.makeViloyatKey(viloyat);
    if (!key) return undefined;
    const idx = this._viloyatKeyToLayerIndex[key];
    if (typeof idx === "number" && layers[idx]) return layers[idx];
    return this.state.activeFeatureLayer || layers[0];
  };

  private resolveFeatureLayersFromUseDataSources = async (): Promise<
    __esri.FeatureLayer[]
  > => {
    // Agri_table_data is an external Table, not a builder-assigned Data
    // Source or a map layer — it is loaded directly by URL.
    try {
      const { layer } = await getAgriTableDataLayer();
      return [layer as __esri.FeatureLayer];
    } catch (e) {
      return [];
    }
  };

  // resolveFeatureLayersFromUseDataSources() always resolves exactly one
  // shared Agri_table_data layer, so every viloyat maps to index 0 anyway
  // (same as the layers[0] fallback in getFeatureLayerForViloyat) — no
  // distinct-viloyat scan is needed; use the already-shared/cached region
  // mapping only if multiple layers ever appear.
  private buildViloyatKeyToLayerIndex = async (
    layers: __esri.FeatureLayer[],
  ): Promise<void> => {
    this._viloyatKeyToLayerIndex = {};
    if (layers.length <= 1) return;

    try {
      const { regionDistrictRows } = await getAgriDashboardBootstrap();
      for (const row of regionDistrictRows) {
        const key = this.makeViloyatKey(row.viloyat);
        if (key && this._viloyatKeyToLayerIndex[key] === undefined) {
          this._viloyatKeyToLayerIndex[key] = 0;
        }
      }
    } catch (e) {}
  };

  private ensureFeatureLayersResolved = async (): Promise<
    __esri.FeatureLayer | undefined
  > => {
    // Already resolved: still need to re-route to the correct layer for current viloyat
    if ((this.state.featureLayers?.length ?? 0) > 0) {
      const nextActive = this.state.viloyat
        ? this.getFeatureLayerForViloyat(this.state.viloyat)
        : this.getDefaultFeatureLayer(this.state.featureLayers);

      if (nextActive && this.state.activeFeatureLayer?.id !== nextActive.id) {
        this.setState({ activeFeatureLayer: nextActive });
      }

      return nextActive;
    }

    if (!this._featureLayersInitPromise) {
      this._featureLayersInitPromise = (async () => {
        const layers = await this.resolveFeatureLayersFromUseDataSources();
        this.setState({ featureLayers: layers });

        await this.buildViloyatKeyToLayerIndex(layers);
      })();
    }

    await this._featureLayersInitPromise;

    const nextActive = this.state.viloyat
      ? this.getFeatureLayerForViloyat(this.state.viloyat)
      : this.getDefaultFeatureLayer(this.state.featureLayers);

    this.setState({ activeFeatureLayer: nextActive });
    return nextActive;
  };

  /* ---------- Map connection ---------- */

  waitForMapToLoad = (jimuMapView: JimuMapView): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!jimuMapView || !jimuMapView.view) {
        reject(new Error("Invalid map view provided"));
        return;
      }
      if (jimuMapView.view.ready) {
        resolve();
        return;
      }

      const timeout = setTimeout(
        () => reject(new Error("Map load timeout")),
        this.CONNECTION_TIMEOUT_MS,
      );
      const watchHandle = jimuMapView.view.watch("ready", (isReady) => {
        if (isReady) {
          clearTimeout(timeout);
          watchHandle.remove();
          resolve();
        }
      });
    });
  };

  // Minimal connection: we just store the view and mark as connected
  connectToMap = async (jimuMapView: JimuMapView): Promise<void> => {
    if (!jimuMapView?.view?.map)
      throw new Error("Map view has no map property");
    return new Promise((resolve) => {
      this.setState(
        {
          activeMapView: jimuMapView,
          connectionStatus: "connected",
          error: null,
          debugInfo: "Connected to map",
        },
        resolve,
      );
    });
  };

  private initializeAfterConnection = (): void => {
    if (this._didInitOnce) return;
    this._didInitOnce = true;

    if (
      !this.state.activeMapView ||
      this.state.connectionStatus !== "connected"
    )
      return;

    if (this.props.externalFilters) {
      const f = this.props.externalFilters;
      this.setState(
        {
          yil: f.yil || "",
          viloyat: f.viloyat || "",
          tuman: f.tuman || "",
          turi: f.turi || "",
          debugInfo: "External filters applied from props",
        },
        () => this.fetchCategoryData(),
      );
    } else {
      this.fetchCategoryData();
    }
  };

  onActiveViewChange = async (jimuMapView: JimuMapView) => {
    if (!jimuMapView) {
      // Treat as fallback: still allow data load (no map interaction needed)
      if (this.state.mapConnectionAttempts === 0) {
        this.setState({
          mapLoadingStatus: "failed",
          mapConnectionAttempts: 1,
          debugInfo: "No map view provided",
        });
      }
      this.setState(
        { connectionStatus: "connected", debugInfo: "Proceeding without map" },
        () => {
          this.fetchCategoryData();
        },
      );
      return;
    }

    this.setState({ mapLoadingStatus: "loading", error: null });

    try {
      const loadingTimeout = setTimeout(() => {
        if (this._isMounted && this.state.mapLoadingStatus === "loading") {
          this.setState(
            {
              connectionStatus: "connected",
              mapLoadingStatus: "loaded",
              debugInfo: "Timeout, proceeding",
            },
            () => {
              this.fetchCategoryData();
            },
          );
        }
      }, this.CONNECTION_TIMEOUT_MS);

      await this.waitForMapToLoad(jimuMapView);
      clearTimeout(loadingTimeout);

      this.setState({
        mapLoadingStatus: "loaded",
        connectionStatus: "connecting",
        debugInfo: "Map loaded, connecting",
      });

      await this.connectToMap(jimuMapView);
      this.initializeAfterConnection();
    } catch (err) {
      this.setState(
        {
          error: `Map initialization issue: ${(err as Error).message}`,
          mapLoadingStatus: (err as Error).message.includes("timeout")
            ? "failed"
            : this.state.mapLoadingStatus,
          connectionStatus: "connected",
          debugInfo: `Error: ${(err as Error).message}, continuing`,
        },
        () => this.fetchCategoryData(),
      );
    }
  };

  retryMapConnection = () => {
    this.setState({
      connectionStatus: "idle",
      mapLoadingStatus: "idle",
      mapConnectionAttempts: 0,
      error: null,
      debugInfo: "Manual retry initiated",
    });
  };

  /* ---------- Lifecycle ---------- */
  private handleMasterFilterChange = (event: Event) => {
    const d: any = (event as CustomEvent).detail || {};
    if (!d.filters) return;

    if (!this._cropMapsReady) {
      void this.ensureCropIdMaps().then(() => {
        if (this._isMounted) this.handleMasterFilterChange(event);
      });
      return;
    }

    const incoming = d.filters || {};
    const scopeLockedRaw =
      d.scope && Object.prototype.hasOwnProperty.call(d.scope, "lockedViloyat")
        ? d.scope.lockedViloyat
        : undefined;
    const nextLockedViloyat =
      scopeLockedRaw !== undefined
        ? scopeLockedRaw
          ? this.normalizeName(String(scopeLockedRaw))
          : ""
        : this.state.lockedViloyat;
    const hasField = (k: string) =>
      Object.prototype.hasOwnProperty.call(incoming, k);
    // Keep current values when upstream event doesn't include that field.
    const nextYil = hasField("yil") ? incoming.yil || "" : this.state.yil;
    const nextViloyatRaw = hasField("viloyat")
      ? incoming.viloyat || ""
      : this.state.viloyat;
    const nextTumanRaw = hasField("tuman")
      ? incoming.tuman || ""
      : this.state.tuman;
    const incomingTurlar = hasField("turlar") && Array.isArray(incoming.turlar)
      ? incoming.turlar
      : hasField("turi")
        ? incoming.turi
          ? [incoming.turi]
          : []
        : this.state.turlar;
    const nextTurlarNames: string[] = Array.from(
      new Set(
        (incomingTurlar as unknown[])
          .map((value: unknown) => this.normalizeName(String(value || "")))
          .filter(Boolean),
      ),
    );
    // Selection highlight keys are crop_id; master filter still sends turi names.
    const nextTurlar: string[] = this.turiNamesToCropIds(nextTurlarNames);
    const nextTuri: string = nextTurlar.length === 1 ? nextTurlar[0] : "";
    const nextVh = hasField("vh")
      ? String(incoming.vh || "")
      : this.state.vh;
    const nextNdviDate = hasField("ndviDate")
      ? String(incoming.ndviDate || "")
      : this.state.ndviDate;
    const nextFilterPieByVh = hasField("filterPieByVh")
      ? Boolean(incoming.filterPieByVh)
      : this.state.filterPieByVh;
    const nextPieVhUniqueIdsSig = nextFilterPieByVh
      ? getPieVhFilterUniqueIdsSig()
      : "";
    const nextFarmerInn = hasField("farmerInn")
      ? String(incoming.farmerInn || "").trim()
      : this.state.farmerInn;

    const nextBarField = hasField("barCategoryField")
      ? (incoming.barCategoryField ?? null)
      : this.state.barCategoryField;
    let nextBarValue = hasField("barCategoryValue")
      ? (incoming.barCategoryValue ?? null)
      : this.state.barCategoryValue;

    if (nextVh && !hasField("barCategoryValue")) nextBarValue = null;

    const nextLanguage: "uz_cyr" | "uz_lat" | "ru" | "en" = hasField("language")
      ? (incoming.language as any) || this.state.language || "ru"
      : this.state.language;

    const effectiveViloyat = this.normalizeName(nextViloyatRaw || "");
    const nextTuman = this.normalizeName(nextTumanRaw || "");

    const parentChanged =
      nextYil !== this.state.yil ||
      effectiveViloyat !== this.state.viloyat ||
      nextTuman !== this.state.tuman ||
      nextLockedViloyat !== this.state.lockedViloyat ||
      nextFarmerInn !== this.state.farmerInn;

    const barSelectionChanged =
      nextBarField !== this.state.barCategoryField ||
      nextBarValue !== this.state.barCategoryValue ||
      nextVh !== this.state.vh ||
      nextNdviDate !== this.state.ndviDate ||
      nextFilterPieByVh !== this.state.filterPieByVh ||
      nextPieVhUniqueIdsSig !== this.state.pieVhUniqueIdsSig;

    const languageChanged = nextLanguage !== this.state.language;
    const cropSelectionChanged =
      JSON.stringify(nextTurlar) !== JSON.stringify(this.state.turlar);

    if (
      !parentChanged &&
      !barSelectionChanged &&
      !languageChanged &&
      !cropSelectionChanged
    ) {
      return;
    }

    agroV5Log(
      "pie:master-filter",
      {
        parentChanged,
        barSelectionChanged,
        cropSelectionChanged,
        nextVh,
        nextFilterPieByVh,
        nextPieVhUniqueIdsSig,
        nextTurlar,
        chartDimOrder: incoming.chartDimOrder,
        viloyat: effectiveViloyat,
        tuman: nextTuman,
        yil: nextYil,
      },
      nextTuman || this.state.tuman ? "tuman" : "vh",
    );

    const nextSelectedCategories: string[] = parentChanged ? [] : nextTurlar;
    const nextActiveSlice = parentChanged
      ? null
      : this.state.categoryData.categories.findIndex((category) =>
            nextSelectedCategories.some(
              (selected) => this.normalizeName(category.key) === selected,
            ),
          );

    this.setState(
      {
        yil: String(nextYil || ""),
        viloyat: effectiveViloyat,
        lockedViloyat: nextLockedViloyat,
        tuman: nextTuman,
        turi: nextTuri,
        turlar: nextSelectedCategories,
        vh: nextVh,
        ndviDate: nextNdviDate,
        filterPieByVh: nextFilterPieByVh,
        pieVhUniqueIdsSig: nextPieVhUniqueIdsSig,
        farmerInn: nextFarmerInn,
        barCategoryField: nextBarField,
        barCategoryValue: nextBarValue,
        selectedCategory: nextTuri || null,
        selectedCategories: nextSelectedCategories,
        activeSlice: nextActiveSlice !== null && nextActiveSlice >= 0 ? nextActiveSlice : null,
        language: nextLanguage,
        activeFeatureLayer: effectiveViloyat
          ? this.getFeatureLayerForViloyat(effectiveViloyat)
          : this.getDefaultFeatureLayer(this.state.featureLayers),
      },
      () => {
        if (
          parentChanged ||
          barSelectionChanged ||
          languageChanged ||
          cropSelectionChanged
        ) {
          this.fetchCategoryData();
        }
      },
    );
  };

  componentDidMount() {
    this._isMounted = true;
    this.initializeTheme();
    void this.ensureCropIdMaps();

    this.setState({
      mapLoadingStatus: "idle",
      connectionStatus: "idle",
      debugInfo: "Widget mounted",
    });

    this._unbindMasterFilter = bindMasterFilter(this.handleMasterFilterChange);
    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleThemeToggled as EventListener,
    );

    window.addEventListener("resize", this.handleResize);

    // Force proceed if connection stalls
    setTimeout(() => {
      if (
        this._isMounted &&
        (this.state.mapLoadingStatus === "loading" ||
          this.state.connectionStatus === "connecting")
      ) {
        this.setState(
          {
            connectionStatus: "connected",
            mapLoadingStatus: "loaded",
            debugInfo: "Timeout reached, proceeding",
          },
          () => this.fetchCategoryData(),
        );
      }
    }, this.CONNECTION_TIMEOUT_MS);

    this.updatePieChart("data");
  }

  updateFiltersFromProps = (filters: {
    yil?: string;
    viloyat?: string;
    tuman?: string;
    turi?: string;
  }): void => {
    const next = {
      yil: filters?.yil ?? "",
      viloyat: filters?.viloyat ?? "",
      tuman: filters?.tuman ?? "",
      turi: filters?.turi ?? "",
    };

    const changed =
      this.state.yil !== next.yil ||
      this.state.viloyat !== next.viloyat ||
      this.state.tuman !== next.tuman ||
      this.state.turi !== next.turi;

    if (!changed) return;

    this.setState(
      {
        ...next,
        isHandlingExternalEvent: true,
        error: null,
        activeFeatureLayer: next.viloyat
          ? this.getFeatureLayerForViloyat(next.viloyat)
          : this.state.activeFeatureLayer,
        debugInfo: `Filters from props: y=${next.yil}, v=${next.viloyat}, t=${next.tuman}, turi=${next.turi}`,
      },
      () => {
        this.fetchCategoryData();
        setTimeout(
          () =>
            this._isMounted &&
            this.setState({ isHandlingExternalEvent: false }),
          300,
        );
      },
    );
  };
  private findAreaStatisticField(fl: __esri.FeatureLayer): string | null {
    const fromLayer = findAreaFieldByPreferredNames(
      fl,
      AREA_FIELD_PREFERRED_PIE,
      { finalMaydonFallback: false },
    );
    if (fromLayer) return fromLayer;
    return this.findFieldByPossibleNames([...AREA_FIELD_PREFERRED_PIE]);
  }

  private async queryCategoryStatsJSON(
    fl: __esri.FeatureLayer,
    where: string,
    categoryField: string,
  ): Promise<Array<{ key: string; value: number }>> {
    const areaField = this.findAreaStatisticField(fl);
    const oidField = (fl as any)?.objectIdField || "OBJECTID";
    return getPieCategoryStatsCached({
      layer: fl,
      where: where || "1=1",
      categoryField,
      areaField,
      objectIdField: oidField,
    });
  }

  componentDidUpdate(prevProps: AgriPieProps, prevState: AgriPieState) {
    if (
      this.props.externalFilters !== prevProps.externalFilters &&
      this.props.externalFilters
    ) {
      this.updateFiltersFromProps(this.props.externalFilters);
    }

    if (
      prevState.connectionStatus !== "connected" &&
      this.state.connectionStatus === "connected"
    ) {
      setTimeout(
        () => this._isMounted && this.initializeAfterConnection(),
        100,
      );
    }

    const { mapLoadingStatus, mapConnectionAttempts } = this.state;
    const { useMapWidgetIds } = this.props;

    if (
      (mapLoadingStatus === "failed" || mapLoadingStatus === "idle") &&
      useMapWidgetIds &&
      useMapWidgetIds.length > 0 &&
      !this.state.activeMapView &&
      mapConnectionAttempts !== prevState.mapConnectionAttempts
    ) {
      if (mapConnectionAttempts < this.MAX_CONNECTION_ATTEMPTS) {
        setTimeout(() => {
          if (this._isMounted) {
            this.setState((prev) => ({
              mapConnectionAttempts: prev.mapConnectionAttempts + 1,
              mapLoadingStatus: "idle",
              debugInfo: `Retry attempt ${prev.mapConnectionAttempts + 1}`,
            }));
          }
        }, MAP_CONNECTION_RETRY_MS);
      } else {
        this.setState(
          {
            mapLoadingStatus: "failed",
            connectionStatus: "connected",
            error: null,
            debugInfo: "Proceeding after multiple failed attempts",
          },
          () => this.fetchCategoryData(),
        );
      }
    }

    const shouldRefreshPieData =
      prevState.categoryData !== this.state.categoryData ||
      prevState.language !== this.state.language ||
      prevState.isDarkTheme !== this.state.isDarkTheme;

    const shouldRefreshPieSelection =
      !shouldRefreshPieData &&
      (prevState.activeSlice !== this.state.activeSlice ||
        prevState.selectedCategories !== this.state.selectedCategories);

    if (shouldRefreshPieData) {
      this.updatePieChart("data");
    } else if (shouldRefreshPieSelection) {
      this.updatePieChart("selection");
    }
  }

  componentWillUnmount() {
    this._isMounted = false;

    if (this._fetchDebounceTimer) {
      clearTimeout(this._fetchDebounceTimer);
    }

    document.removeEventListener(
      "agriV11ThemeToggled",
      this.handleThemeToggled as EventListener,
    );
    this._unbindMasterFilter?.();
    this._unbindMasterFilter = null;

    window.removeEventListener("resize", this.handleResize);
    this.detachPieResizeObserver();

    if (this._pieChart) {
      this._pieChart.dispose();
      this._pieChart = null;
      this._pieChartHostEl = null;
      this._pieHasRendered = false;
      this._pieStableKeys = [];
      this._pieStableRawKeys = {};
    }
  }

  /* ---------- Local UI helpers ---------- */

  private selectCategoryByName = (name: string | null) => {
    if (!name) {
      this.setState({
        turi: "",
        turlar: [],
        selectedCategory: null,
        selectedCategories: [],
        activeSlice: null,
      });
      return;
    }
    const idx = this.state.categoryData.categories.findIndex(
      (c) => this.normalizeName(c.key) === this.normalizeName(name),
    );
    this.setState({
      turi: name,
      turlar: [name],
      selectedCategory: name,
      selectedCategories: [name],
      activeSlice: idx >= 0 ? idx : null,
    });
  };

  private _lastIpadLayout: boolean | null = null;

  private schedulePieChartResize = (): void => {
    if (this._pieResizeRaf) cancelAnimationFrame(this._pieResizeRaf);
    this._pieResizeRaf = window.requestAnimationFrame(() => {
      this._pieResizeRaf = 0;
      this._pieChart?.resize();
    });
  };

  private attachPieResizeObserver = (host: HTMLDivElement): void => {
    if (typeof ResizeObserver === "undefined") return;

    const stage =
      host.closest(".land-category-echart-stage") ??
      host.parentElement ??
      host;

    if (this._pieResizeObserver && this._pieObservedStage === stage) {
      return;
    }

    this._pieResizeObserver?.disconnect();
    this._pieResizeObserver = new ResizeObserver(() => {
      this.schedulePieChartResize();
    });
    this._pieObservedStage = stage;
    this._pieResizeObserver.observe(stage);
  };

  private detachPieResizeObserver = (): void => {
    if (this._pieResizeRaf) {
      cancelAnimationFrame(this._pieResizeRaf);
      this._pieResizeRaf = 0;
    }
    this._pieResizeObserver?.disconnect();
    this._pieResizeObserver = null;
    this._pieObservedStage = null;
  };

  private handleResize = () => {
    this.schedulePieChartResize();
    const isIpad = this.isIpadLayout();
    if (this._lastIpadLayout === isIpad) return;
    this._lastIpadLayout = isIpad;
    this.forceUpdate();
    window.requestAnimationFrame(() => {
      this.updatePieChart("selection");
      this.schedulePieChartResize();
    });
  };

  private getChartDataForPie = () => {
    const { categoryData, language } = this.state;
    const sortedCategories = [...(categoryData?.categories ?? [])]
      .filter((category) => (Number(category.value) || 0) > 0)
      .sort((a, b) => b.value - a.value);

    // Only positive slices — zero placeholders from prior year/region leave
    // empty arcs when minAngle boosts them.
    this._pieStableKeys = sortedCategories
      .map((category) => String(category.key || "").trim())
      .filter(Boolean);
    this._pieStableRawKeys = {};

    return sortedCategories.map((category) => {
      const norm = String(category.key || "").trim();
      this._pieStableRawKeys[norm] = category.key;
      return {
        name: this.getCategoryDisplayName(category.key, language),
        rawKey: category.key,
        value: category.value,
        percentage: category.percentage,
      };
    });
  };

  private ensurePieChart = () => {
    const host = this._pieChartRef.current;
    if (!host) return null;

    if (
      this._pieChart &&
      this._pieChartHostEl &&
      this._pieChartHostEl !== host
    ) {
      this._pieChart.dispose();
      this._pieChart = null;
      this._pieChartHostEl = null;
      this._pieHasRendered = false;
      this._pieStableKeys = [];
      this._pieStableRawKeys = {};
    }

    if (!this._pieChart) {
      this._pieChart = echarts.init(host);
      this._pieChartHostEl = host;
      this._pieChart.on("click", (params: any) => {
        if (typeof params?.dataIndex !== "number") return;
        this.handleSliceClick(params.data || {}, params.dataIndex);
      });
    }

    this.attachPieResizeObserver(host);

    return this._pieChart;
  };

  private formatCenterArea = (value: number): string => {
    const { language } = this.state;
    const areaUnit = language === "en" ? "ha" : language === "uz_lat" ? "ga" : "га";
    const safe = Number.isFinite(value) ? value : 0;
    return `${safe.toLocaleString("ru-RU", {
      maximumFractionDigits: safe >= 100 ? 0 : 1,
    })}\u00A0${areaUnit}`;
  };

  private formatCenterPercent = (value: number): string => {
    if (!Number.isFinite(value)) return "0%";
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded)
      ? `${rounded.toFixed(0)}%`
      : `${rounded.toFixed(1)}%`;
  };

  private getCenterAllLabel = (): string => {
    const { language } = this.state;
    if (language === "en") return "All";
    if (language === "ru") return "Все";
    if (language === "uz_lat") return "Barchasi";
    return "Барчаси";
  };

  private isIpadLayout = (): boolean => {
    // Hide legend / expand pie on iPad Pro (~1366) and every smaller viewport.
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 1400;
  };

  private getPieCenterContent = (
    chartData: Array<{
      name: string;
      rawKey?: string;
      value: number;
      percentage?: number;
    }>,
  ): {
    showPercent: boolean;
    percent: number;
    area: number;
    label: string;
  } => {
    const { selectedCategories, categoryData } = this.state;
    const totalValue =
      Number(categoryData?.totalValue) ||
      chartData.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

    if (selectedCategories.length > 0) {
      const selectedKeys = new Set(
        selectedCategories.map((selected) => this.normalizeName(selected)),
      );
      const selectedItems = chartData.filter((item) =>
        selectedKeys.has(this.normalizeName(item.rawKey || item.name || "")),
      );
      if (selectedItems.length > 0) {
        const area = selectedItems.reduce(
          (sum, item) => sum + (Number(item.value) || 0),
          0,
        );
        return {
          showPercent: true,
          percent: totalValue > 0 ? (area / totalValue) * 100 : 0,
          area,
          label: selectedItems.map((item) => item.name).join(", "),
        };
      }
    }

    return {
      showPercent: true,
      percent: totalValue > 0 ? 100 : 0,
      area: totalValue,
      label: this.getCenterAllLabel(),
    };
  };

  private updatePieChart = (reason: "data" | "selection" = "data") => {
    const chart = this.ensurePieChart();
    if (!chart) return;

    const {
      selectedCategories,
      viloyat,
      lockedViloyat,
    } = this.state;
    const pieInteractive = !!(lockedViloyat || viloyat || "").trim();
    const chartData = this.getChartDataForPie();
    const normalizedSelections = selectedCategories.map((selected) =>
      this.normalizeName(selected),
    );
    const hasSelectedSlice = normalizedSelections.length > 0;
    const sliceBorder = this.getSliceBorderColor();
    const visibleSliceCount = chartData.filter(
      (item) => (Number(item.value) || 0) > 0,
    ).length;
    const isDataUpdate = this._pieHasRendered && reason === "data";
    const isSelectionUpdate = reason === "selection" && this._pieHasRendered;
    const isSingleSlice =
      isDataUpdate || isSelectionUpdate ? false : visibleSliceCount === 1;
    const segmentBorderWidth = isSingleSlice ? 0 : visibleSliceCount > 8 ? 1 : 2;
    const segmentBorderRadius = isSingleSlice
      ? 0
      : visibleSliceCount > 10
        ? 4
        : visibleSliceCount > 6
          ? 6
          : 10;

    const isIpad = this.isIpadLayout();
    const option: echarts.EChartsOption = {
      animation: !isSelectionUpdate,
      ...(isSelectionUpdate
        ? {
            animationDuration: 0,
            animationDurationUpdate: 0,
          }
        : isDataUpdate
          ? {
              animationDurationUpdate: 280,
              animationEasingUpdate: "cubicInOut",
            }
          : {
              animationDuration: 500,
              animationEasing: "cubicOut",
            }),
      color: AgriPie.FALLBACK_COLORS,
      tooltip: {
        trigger: "item",
        show: isIpad && pieInteractive,
        triggerOn: "click",
        confine: true,
        appendToBody: true,
        formatter: (params: any) => {
          const name = String(
            params?.name || params?.data?.name || "",
          ).trim();
          return name || "";
        },
        backgroundColor: this.state.isDarkTheme ? "#1f2030" : "#ffffff",
        borderColor: this.state.isDarkTheme
          ? "rgba(126, 214, 255, 0.22)"
          : "rgba(15, 23, 42, 0.12)",
        borderWidth: 1,
        padding: [8, 12],
        textStyle: {
          color: this.state.isDarkTheme ? "#e9f8ff" : "#0f172a",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif",
        },
        extraCssText:
          "border-radius:12px;box-shadow:0 8px 24px rgba(15,23,42,0.16);",
      },
      legend: {
        show: false,
      },
      title: { show: false },
      series: [
        {
          id: "agri-pie-donut",
          name: "Access From",
          type: "pie",
          silent: !pieInteractive,
          selectedMode: false,
          selectedOffset: hasSelectedSlice ? 6 : 0,
          startAngle: 90,
          padAngle: 0,
          radius: ["56%", "88%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          minAngle: 0,
          z: 2,
          ...(isSelectionUpdate
            ? {
                animationTypeUpdate: "transition",
                animationDurationUpdate: 0,
                animationDelayUpdate: 0,
              }
            : isDataUpdate
              ? {
                  animationTypeUpdate: "transition",
                  animationDurationUpdate: 280,
                  animationEasingUpdate: "cubicInOut",
                  animationDelayUpdate: 0,
                }
              : {
                  animationType: "scale",
                  animationDuration: 500,
                  animationEasing: "cubicOut",
                  animationDelay: (index: number) => index * 40,
                }),
          cursor: pieInteractive ? "pointer" : "default",
          itemStyle: {
            borderRadius: segmentBorderRadius,
            borderColor: sliceBorder,
            borderWidth: segmentBorderWidth,
          },
          label: {
            show: false,
          },
          emphasis: {
            scale: !hasSelectedSlice,
            scaleSize: 2,
            focus: "none",
            itemStyle: {
              borderColor: sliceBorder,
              borderWidth: segmentBorderWidth,
              shadowBlur: 0,
              shadowOffsetY: 0,
              shadowColor: "transparent",
            },
            label: {
              show: false,
            },
          },
          blur: {
            itemStyle: {
              opacity: 1,
            },
          },
          labelLine: {
            show: false,
          },
          data: chartData.map((item, index) => {
            const baseColor = this.getCropColor(item.rawKey || item.name, index);
            const itemKey = this.normalizeName(item.rawKey || item.name || "");
            const isSelected = normalizedSelections.includes(itemKey);
            const hasValue = (Number(item.value) || 0) > 0;
            const isDimmed = hasSelectedSlice && !isSelected;
            return {
              id: `crop-${itemKey || index}`,
              value: item.value,
              name: item.name,
              rawKey: item.rawKey,
              percentage: item.percentage,
              selected: isSelected && hasValue,
              itemStyle: {
                color: baseColor,
                opacity: !hasValue ? 0 : isDimmed ? 0.28 : 1,
                borderColor: sliceBorder,
                borderWidth: hasValue ? segmentBorderWidth : 0,
                borderRadius: segmentBorderRadius,
              },
            };
          }),
        },
      ],
    };

    chart.setOption(
      option,
      isSelectionUpdate
        ? { notMerge: false, lazyUpdate: false }
        : isDataUpdate
          ? { notMerge: false, replaceMerge: ["series"], lazyUpdate: false }
          : { notMerge: true, lazyUpdate: false },
    );
    if (chartData.some((item) => (Number(item.value) || 0) > 0)) {
      this._pieHasRendered = true;
    }
    this.schedulePieChartResize();
  };

  /* ---------- Interactions ---------- */

  handleSliceClick = (
    data: { rawKey?: string; name?: string },
    index: number,
  ): void => {
    const canSlice =
      !!(this.state.lockedViloyat || this.state.viloyat || "").trim();
    if (!canSlice) return;

    const selectedCategoryName = String(data.rawKey || data.name || "").trim();
    if (!selectedCategoryName) return;
    const selectedKey = this.normalizeName(selectedCategoryName);
    const isSelected = this.state.selectedCategories.some(
      (category) => this.normalizeName(category) === selectedKey,
    );
    const nextSelections = isSelected
      ? this.state.selectedCategories.filter(
          (category) => this.normalizeName(category) !== selectedKey,
        )
      : [...this.state.selectedCategories, selectedCategoryName];
    const singleSelection = nextSelections.length === 1 ? nextSelections[0] : "";
    const turiNames = this.cropIdsToTuriNames(nextSelections);
    const singleTuriName = turiNames.length === 1 ? turiNames[0] : "";

    this.setState(
      {
        activeSlice: isSelected ? null : index,
        selectedCategory: singleSelection || null,
        selectedCategories: nextSelections,
        turi: singleSelection,
        turlar: nextSelections,
      },
      () => {
        document.dispatchEvent(
          new CustomEvent("widgetSelectionChanged", {
            detail: {
              turi: singleTuriName,
              turlar: turiNames,
              polygonMode: false,
              source: "AgriPie",
              timestamp: Date.now(),
            },
            bubbles: true,
          }),
        );

        // iPad has no legend — keep the slice name visible via tooltip after click.
        if (this.isIpadLayout() && this._pieChart) {
          window.requestAnimationFrame(() => {
            this._pieChart?.dispatchAction({
              type: "showTip",
              seriesIndex: 0,
              dataIndex: index,
            });
          });
        }
      },
    );
  };
  applyCategoryFilter = async (): Promise<void> => {
    const { selectedCategories, yil, viloyat, tuman } = this.state;
    const turiNames = this.cropIdsToTuriNames(selectedCategories);

    document.dispatchEvent(
      new CustomEvent("categoryFilterChanged", {
        detail: {
          yil,
          viloyat,
          tuman,
          category: turiNames.length === 1 ? turiNames[0] : "",
          turi: turiNames.length === 1 ? turiNames[0] : "",
          turlar: turiNames,
          source: "AgriPie",
          timestamp: Date.now(),
        },
        bubbles: true,
      }),
    );
  };

  /* ---------- Data fetch ---------- */
  private resolveNdviDateForVhPie(): string {
    const explicit = String(this.state.ndviDate || "").trim();
    if (explicit) return explicit;
    const field = String(this.state.barCategoryField || "");
    const match = field.match(/status_(\d{4})_(\d{2})_(\d{2})/i);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    return "";
  }

  private async resolveRegionDistrictForPie(): Promise<{
    region?: number;
    district?: number;
  }> {
    const viloyat = this.normalizeName(
      this.state.viloyat || this.state.lockedViloyat || "",
    );
    const tuman = this.normalizeName(this.state.tuman || "");
    if (!viloyat) return {};

    const rows = await queryAgriRegionDistrictMappings();
    const vKey = this.makeViloyatKey(viloyat);
    const tKey = tuman ? this.makeViloyatKey(tuman) : "";
    let region: number | undefined;
    let regionVotes = 0;
    let district: number | undefined;
    let districtVotes = 0;
    for (const row of rows) {
      if (this.makeViloyatKey(row.viloyat) !== vKey) continue;
      const vote =
        row.count != null && Number.isFinite(row.count) && row.count > 0
          ? Number(row.count)
          : 1;
      if (region == null || vote > regionVotes) {
        region = row.region;
        regionVotes = vote;
      }
      if (tKey && this.makeViloyatKey(row.tuman) === tKey) {
        if (district == null || vote > districtVotes) {
          district = row.district;
          districtVotes = vote;
        }
      }
    }
    return { region, district: tuman ? district : undefined };
  }

  /**
   * VH-first Pie: crop mix from agri_vegetation_indices (same source as VH bar).
   * Agri_table_data uniqueid joins are incomplete for many polygons.
   */
  private async fetchPieCategoriesViaVegetation(
    fetchId: number,
  ): Promise<boolean> {
    const vhCategory = String(this.state.vh || "").trim();
    const ndviStatus = VH_CATEGORY_TO_NDVI_STATUS[vhCategory];
    const ndviDate = this.resolveNdviDateForVhPie();
    if (!ndviStatus || !ndviDate) {
      agroV5Log(
        "pie:vegetation-skip-missing-meta",
        { vhCategory, ndviStatus, ndviDate },
        "vh",
      );
      return false;
    }

    const { region, district } = await this.resolveRegionDistrictForPie();
    if (!this._isMounted || fetchId !== this._fetchCounter) return true;

    agroV5Log(
      "pie:fetch-vegetation-query",
      {
        vh: vhCategory,
        ndviStatus,
        ndviDate,
        region: region ?? null,
        district: district ?? null,
      },
      "vh",
    );

    // Grouped crop_id stats: one round-trip, and its totals partition the same
    // px_all sum the VH bar shows for this status. The exact per-uniqueid
    // breakdown stays as a fallback only for *narrow* scopes — at viloyat
    // scale it pages dozens of groupBy(uniqueid,crop_id) queries (Network
    // flood) while Agri_table + VH uniqueid join below already covers that case.
    let breakdown: VegetationCropBreakdownRow[];
    try {
      breakdown = await queryVegetationCropStatsForStatus({
        date: ndviDate,
        ndviStatus,
        region,
        district,
      });
    } catch (statsError: any) {
      agroV5Log(
        "pie:fetch-vegetation-stats-failed",
        {
          vh: vhCategory,
          error: String(statsError?.message || statsError),
          district: district ?? null,
          willTryBreakdown: district != null,
        },
        "vh",
      );
      if (district == null) {
        // Viloyat / republic: skip heavy uniqueid×crop paging → join path.
        return false;
      }
      breakdown = await queryVegetationCropBreakdownForStatus({
        date: ndviDate,
        ndviStatus,
        region,
        district,
      });
    }
    if (!this._isMounted || fetchId !== this._fetchCounter) return true;

    const mappings = await queryAgriTuriCropMappings();
    if (!this._isMounted || fetchId !== this._fetchCounter) return true;

    // Keep crop_id as the pie key; labels resolve via mapping.
    for (const row of mappings) {
      const id = String(row.cropId || "").trim();
      const turi = String(row.turi || "").trim();
      if (!id || !turi) continue;
      if (!this._cropIdToTuri[id]) this._cropIdToTuri[id] = turi;
      const turiKey = getTuriCropLookupKey(turi);
      if (turiKey && !this._turiToCropId[turiKey]) {
        this._turiToCropId[turiKey] = id;
      }
    }
    this._cropMapsReady = true;

    const merged = new Map<string, number>();
    for (const row of breakdown) {
      const cropId = String(row.cropId || "").trim();
      if (!cropId) continue;
      merged.set(cropId, (merged.get(cropId) || 0) + row.areaHa);
    }

    const rows = Array.from(merged.entries()).map(([key, value]) => ({
      key,
      value,
    }));
    const totalValueProbe = rows.reduce((sum, r) => sum + r.value, 0);

    // Vegetation rows exist for this status (the bar shows them), but the
    // crop mix came back empty — usually crop_id is not filled for this
    // scope. Report "not handled" so the caller can join crops from
    // Agri_table_data via the resolved VH uniqueids instead.
    if (!rows.length || totalValueProbe <= 0) {
      agroV5Log(
        "pie:fetch-vegetation-empty",
        {
          vh: vhCategory,
          ndviDate,
          region: region ?? null,
          district: district ?? null,
          breakdownRowCount: breakdown.length,
        },
        "vh",
      );
      return false;
    }
    const { categories, totalValue } = buildPieCategoriesFromMergedRows(rows);

    agroV5Log(
      "pie:fetch-vegetation-result",
      {
        vh: vhCategory,
        categoryCount: categories.length,
        totalValue,
        categories: categories.map((c) => ({
          key: c.key,
          value: Math.round(c.value),
          pct: Math.round(c.percentage),
        })),
      },
      "vh",
    );

    const {
      validSelectedCategories,
      activeSlice,
      singleSelection,
    } = syncPieSelectionAgainstCategories(
      this.state.selectedCategories,
      categories,
      (value) => this.normalizeName(value),
    );

    this._hasCompletedFetch = true;
    this.setState({
      categoryData: { categories, totalValue },
      loading: false,
      error: null,
      activeSlice,
      turi: singleSelection,
      turlar: validSelectedCategories,
      selectedCategory: singleSelection || null,
      selectedCategories: validSelectedCategories,
      debugInfo: `VH pie via vegetation (${categories.length} crops)`,
    });
    return true;
  }

  private makeQueryKey(
    yil: string,
    viloyat: string,
    tuman: string,
    vh: string,
    barField?: string | null,
    barValue?: string | null,
    filterPieByVh?: boolean,
    pieVhSig?: string,
    ndviDate?: string,
  ) {
    return [
      yil || "",
      viloyat || "",
      tuman || "",
      vh || "",
      barField ?? "",
      barValue ?? "",
      filterPieByVh ? "vhPie" : "",
      pieVhSig ?? "",
      ndviDate ?? "",
    ].join("|");
  }

  // ✅ Debounced fetch with de-duplication
  private fetchCategoryData = (): void => {
    // Clear any pending fetch
    if (this._fetchDebounceTimer) {
      clearTimeout(this._fetchDebounceTimer);
    }

    // Show loader immediately so UI never flashes "no data" during debounce.
    if (!this.state.loading) {
      this.setState({ loading: true, error: null });
    }

    // Short debounce so region changes feel immediate
    this._fetchDebounceTimer = setTimeout(() => {
      this._doFetchCategoryData();
    }, 16);
  };
  private async _doFetchCategoryData(): Promise<void> {
    // Match Agro_widgetV1 query key / routing: selected viloyat only
    // (lockedViloyat stays in state for UI/access, not in the stats key).
    const selectedViloyat = (this.state.viloyat || "").trim();
    const key = this.makeQueryKey(
      this.state.yil,
      selectedViloyat,
      this.state.tuman,
      this.state.vh,
      this.state.barCategoryField,
      this.state.barCategoryValue,
      this.state.filterPieByVh,
      this.state.pieVhUniqueIdsSig,
      this.state.ndviDate,
    );

    if (key === this._lastFetchKey) {
      // Completed fetch for this key — drop a leftover spinner only.
      if (this.state.loading) {
        this.setState({ loading: false });
      }
      return;
    }
    // Same VH scope still waiting on uniqueid bridge — keep loader, do not
    // restore the pre-VH pie (that painted Barchasi 9721 under A'lo).
    if (key === this._pendingVhPieFetchKey && this.state.loading) {
      return;
    }

    // Requires at least yil; viloyat optional (empty = republic-wide)
    if (!this.state.yil) {
      this._lastFetchKey = key;
      this._pendingVhPieFetchKey = "";
      this._hasCompletedFetch = false;
      this.setState({
        categoryData: { categories: [], totalValue: 0 },
        loading: false,
        error: null,
      });
      return;
    }

    if (this.state.connectionStatus !== "connected") {
      return;
    }

    this._fetchCounter++;
    const fetchId = this._fetchCounter;

    try {
      if (!this.state.loading) {
        this.setState({ loading: true, error: null });
      } else {
        this.setState({ error: null });
      }

      const { layer: tableLayer } = await getAgriTableDataLayer();
      await this.ensureCropIdMaps();
      if (!this._isMounted || fetchId !== this._fetchCounter) return;
      const categoryField =
        this.findCategoryField(tableLayer as __esri.FeatureLayer) || "crop_id";
      if (!categoryField) {
        this._hasCompletedFetch = true;
        this._lastFetchKey = key;
        this._pendingVhPieFetchKey = "";
        this.setState({
          loading: false,
          error: "No category field found. Please check your layer fields.",
        });
        return;
      }

      // includeCategory: false — this widget always shows the full crop
      // breakdown (every slice), regardless of which crop is currently
      // selected. The selected crop is only ever a visual highlight
      // (selectedCategory/activeSlice), never a self-filter on this query.

      // VH-first: query vegetation crop mix immediately (same source as VH bar).
      // Do NOT block on the uniqueid bridge — that left the pie stuck on the
      // unscoped region total until (or unless) a follow-up broadcast arrived.
      if (
        this.state.filterPieByVh &&
        String(this.state.vh || "").trim()
      ) {
        const handled = await this.fetchPieCategoriesViaVegetation(fetchId);
        if (!this._isMounted || fetchId !== this._fetchCounter) return;
        if (handled) {
          this._lastFetchKey = key;
          this._pendingVhPieFetchKey = "";
          return;
        }
        // Vegetation unavailable — join Agri_table via bridge uniqueids.
        if (getPieVhFilterUniqueIds() == null) {
          agroV5Log(
            "pie:fetch-wait-uniqueids-pending",
            { filterPieByVh: true, vh: this.state.vh },
            "vh",
          );
          this._pendingVhPieFetchKey = key;
          if (fetchId === this._fetchCounter && this._isMounted) {
            this.setState({ loading: true, error: null });
          }
          return;
        }
        agroV5Log(
          "pie:vegetation-empty-fallback-join",
          {
            vh: this.state.vh,
            vhIdsCount: getPieVhFilterUniqueIds()?.length ?? null,
          },
          "vh",
        );
      } else {
        this._pendingVhPieFetchKey = "";
      }

      const scopeViloyat = String(
        this.state.viloyat || this.state.lockedViloyat || "",
      ).trim();
      const vhIdsRaw = this.state.filterPieByVh
        ? getPieVhFilterUniqueIds()
        : null;
      // Vegetation ids are lower-case unbraced GUIDs; Agri_table_data may
      // store braced/upper-case ones (PostgreSQL equality is case-sensitive).
      // Expand to the table's detected style so the join cannot miss rows.
      let vhIds = vhIdsRaw;
      if (Array.isArray(vhIdsRaw) && vhIdsRaw.length) {
        try {
          vhIds = await expandUniqueIdsForAgriTable(vhIdsRaw);
        } catch {
          vhIds = vhIdsRaw;
        }
        if (!this._isMounted || fetchId !== this._fetchCounter) return;
        // Do not await getAgriTableUniqueIdSamples here — it always hit the
        // network even when __AGRO_V5_*_DEBUG is off (args evaluated first).
        agroV5Log(
          "pie:vh-join-ids",
          {
            rawCount: vhIdsRaw.length,
            expandedCount: vhIds?.length ?? null,
            vegIdSample: vhIdsRaw[0] ?? null,
          },
          "vh",
        );
      }
      const vhScoped =
        this.state.filterPieByVh &&
        Array.isArray(vhIds) &&
        vhIds.length > 0;
      const { district: pieDistrictCode } =
        await this.resolveRegionDistrictForPie();
      if (!this._isMounted || fetchId !== this._fetchCounter) return;
      const whereClause = this.buildWhereClauseForDS({
        includeCategory: false,
        // VH uniqueids are already region/district scoped in
        // agri_vegetation_indices — skip viloyat/tuman name predicates on
        // Agri_table_data (e.g. "Sirdaryo" vs "Sirdaryo viloyati").
        includeViloyat: !!scopeViloyat && !vhScoped,
        districtCode: pieDistrictCode ?? null,
      });

      // Shared DashboardPack hit (no VH) — skip duplicate ArcGIS groupBy.
      if (!this.state.filterPieByVh && !String(this.state.vh || "").trim()) {
        await waitForDashboardPackReady(2500);
        if (!this._isMounted || fetchId !== this._fetchCounter) return;
        const piePack = matchPieDashboardPack(getDashboardPack(), {
          where: whereClause,
          hasVh: Boolean(String(this.state.vh || "").trim()),
        });
        if (piePack) {
          const { categories, totalValue } = buildPieCategoriesFromPackRows(
            piePack.rows,
          );
          if (!this._isMounted || fetchId !== this._fetchCounter) return;
          const {
            validSelectedCategories,
            activeSlice,
            singleSelection,
          } = syncPieSelectionAgainstCategories(
            this.state.selectedCategories,
            categories,
            (value) => this.normalizeName(value),
          );

          this._hasCompletedFetch = true;
          this._lastFetchKey = key;
          this._pendingVhPieFetchKey = "";
          this.setState({
            categoryData: { categories, totalValue },
            loading: false,
            error: null,
            activeSlice,
            selectedCategories: validSelectedCategories,
            selectedCategory: singleSelection,
          });
          return;
        }
      }

      const layersForQuery: __esri.FeatureLayer[] = [
        tableLayer as __esri.FeatureLayer,
      ];

      const merged = new Map<string, { key: string; value: number }>();
      const vhChunks = this.buildPieVhWhereChunks(vhIds);
      const whereParts =
        vhChunks && vhChunks.length
          ? vhChunks.map((chunk) =>
              whereClause && whereClause !== "1=1"
                ? `(${whereClause}) AND (${chunk})`
                : chunk,
            )
          : [whereClause || "1=1"];

      agroV5Log(
        "pie:fetch-query",
        {
          filterPieByVh: this.state.filterPieByVh,
          vhScopedSkipGeography: vhScoped,
          vh: this.state.vh,
          vhIdsCount: vhIds?.length ?? null,
          vhIdsSig: getPieVhFilterUniqueIdsSig(),
          vhChunkCount: vhChunks?.length ?? 0,
          whereClause,
          wherePartCount: whereParts.length,
          turlar: this.state.turlar,
          turi: this.state.turi,
          viloyat: scopeViloyat,
          tuman: this.state.tuman,
          yil: this.state.yil,
        },
        this.state.tuman ? "tuman" : "vh",
      );

      for (const layer of layersForQuery) {
        const layerCategoryField = this.findCategoryField(layer);
        if (!layerCategoryField) continue;

        for (const partWhere of whereParts) {
          const part = await this.queryCategoryStatsJSON(
            layer,
            partWhere,
            layerCategoryField,
          );

          for (const r of part) {
            const cropId = String(r.key ?? "").trim();
            if (!cropId) continue;
            const prev = merged.get(cropId);
            if (prev) {
              prev.value += Number(r.value || 0);
            } else {
              merged.set(cropId, {
                key: cropId,
                value: Number(r.value || 0),
              });
            }
          }
        }
      }

      const rows = Array.from(merged.values());

      if (!this._isMounted || fetchId !== this._fetchCounter) return;

      const { categories, totalValue } = buildPieCategoriesFromMergedRows(rows);

      agroV5Log(
        "pie:fetch-result",
        {
          filterPieByVh: this.state.filterPieByVh,
          vh: this.state.vh,
          viloyat: this.state.viloyat,
          tuman: this.state.tuman,
          yil: this.state.yil,
          categoryCount: categories.length,
          totalValue,
          categories: categories.map((c) => ({
            key: c.key,
            value: Math.round(c.value),
            pct: Math.round(c.percentage),
          })),
          mergedRawCount: rows.length,
        },
        this.state.tuman ? "tuman" : "vh",
      );

      const {
        validSelectedCategories,
        activeSlice,
        singleSelection,
      } = syncPieSelectionAgainstCategories(
        this.state.selectedCategories,
        categories,
        (value) => this.normalizeName(value),
      );

      this._hasCompletedFetch = true;
      this._lastFetchKey = key;
      this._pendingVhPieFetchKey = "";
      this.setState({
        categoryData: { categories, totalValue },
        loading: false,
        error: null,
        activeSlice,
        turi: singleSelection,
        turlar: validSelectedCategories,
        selectedCategory: singleSelection || null,
        selectedCategories: validSelectedCategories,
        debugInfo: `Loaded ${categories.length} categories (WHERE: ${whereClause})`,
      });
    } catch (error: any) {
      if (!this._isMounted || fetchId !== this._fetchCounter) return;

      this._hasCompletedFetch = true;
      this._lastFetchKey = key;
      this._pendingVhPieFetchKey = "";
      this.setState({
        loading: false,
        error: error?.message || "Failed to load data from layer.",
      });
    }
  }

  /* ---------- Chart ---------- */

  private renderRadarPieChart = (
    _chartData: any[],
    _containerWidth: number = 300,
    _containerHeight: number = 300,
  ): JSX.Element => {
    return (
      <div
        ref={this._pieChartRef}
        className="land-category-echart"
      />
    );
  };

  /* ---------- Render ---------- */

  render() {
    const {
      loading,
      error,
      categoryData,
      activeSlice,
      selectedCategories,
      mapLoadingStatus,
      connectionStatus,
      debugInfo,
      yil,
      viloyat,
      lockedViloyat,
      language,
      isDarkTheme,
    } = this.state;

    const { categories } = categoryData;

    const sortedCategories = [...categories].sort((a, b) => b.value - a.value);
    // Display every crop type returned by the grouped service query. The
    // legend is scrollable, so a long list does not overflow the widget.
    const visibleCategories = sortedCategories;

    const themeClass = isDarkTheme ? "dark-theme" : "light-theme";
    const areaUnit = language === "en" ? "ha" : language === "uz_lat" ? "ga" : "га";

    const titleText =
      language === "en"
        ? "Crop Type"
        : language === "ru"
        ? "Тип культуры"
        : language === "uz_lat"
          ? "Ekin Turi"
          : "Экин Тури";

    const chartData = visibleCategories.map((category) => ({
      name: this.getCategoryDisplayName(category.key, language),
      rawKey: category.key,
      value: category.value,
      percentage: category.percentage,
    }));

    let statusIndicator:
      | "idle"
      | "loading"
      | "connecting"
      | "connected"
      | "failed" = "idle";
    if (mapLoadingStatus === "loading") statusIndicator = "loading";
    else if (mapLoadingStatus === "loaded" && connectionStatus === "connecting")
      statusIndicator = "connecting";
    else if (connectionStatus === "connected") statusIndicator = "connected";
    else if (mapLoadingStatus === "failed" || connectionStatus === "failed")
      statusIndicator = "failed";

    const showDebugInfo = false; // ✅ Disabled debug panel

    const formatAreaValue = (value: number) => {
      const safe = Number.isFinite(value) ? value : 0;
      const digits = safe >= 100 ? 0 : safe >= 10 ? 1 : 2;
      return safe.toLocaleString("ru-RU", {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0,
      }).replace(/,/g, ".");
    };

    const sliceInteractive = !!(lockedViloyat || viloyat || "").trim();
    const isIpadLayout = this.isIpadLayout();
    const hasChartData = categories.length > 0;
    const awaitingFirstData = !this._hasCompletedFetch;

    // Loader until first fetch finishes — never flash "no data" during connect/refresh.
    const showBlockingLoader =
      !yil ||
      mapLoadingStatus === "loading" ||
      connectionStatus === "idle" ||
      connectionStatus === "connecting" ||
      (connectionStatus === "connected" &&
        !hasChartData &&
        (loading || awaitingFirstData));

    // Overlay loader on any subsequent data change (region, year, filters…).
    const showRefreshLoader =
      connectionStatus === "connected" && loading && hasChartData;

    // Empty state only after a real fetch returned zero categories.
    const showNoData =
      !!yil &&
      connectionStatus === "connected" &&
      !loading &&
      this._hasCompletedFetch &&
      !hasChartData;

    return (
      <div
        className={`land-category-card ${themeClass}${
          isIpadLayout ? " land-category-card--ipad" : ""
        }`}
      >
        {showDebugInfo && (
          <div
            className="debug-info"
            style={{
              position: "absolute",
              top: "5px",
              right: "5px",
              fontSize: "10px",
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "2px 5px",
              borderRadius: "3px",
              maxWidth: "200px",
              zIndex: 1000,
            }}
          >
            <div>Status: {statusIndicator}</div>
            <div>Map: {mapLoadingStatus}</div>
            <div>Connection: {connectionStatus}</div>
            <div>Categories: {categories.length}</div>
            <div>Debug: {debugInfo}</div>
          </div>
        )}

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
              useDataSource={this.props.useDataSources[0]}
              onDataSourceCreated={this.onDataSourceCreated}
              onDataSourceInfoChange={this.onDataSourceInfoChange}
            />
          )}
          {this.props.useMapWidgetIds?.length > 0 && (
            <JimuMapViewComponent
              useMapWidgetId={this.props.useMapWidgetIds[0]}
              onActiveViewChange={this.onActiveViewChange}
            />
          )}
        </div>

        <div className="land-category-content">
          <div className="land-category-header">
            <div className="land-category-title-wrap">
              <div className="land-category-title">{titleText}</div>
            </div>
          </div>

          {mapLoadingStatus === "failed" && connectionStatus !== "connected" ? (
            <div className="land-category-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
              <p>
                {error || "Харитага уланишда хатолик. Қайта уриниб кўринг."}
              </p>
              <Button
                onClick={this.retryMapConnection}
                type="primary"
                size="sm"
              >
                Қайта уланиш
              </Button>
            </div>
          ) : error ? (
            <div className="land-category-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
              <p>{error}</p>
              <Button
                onClick={() => this.fetchCategoryData()}
                type="primary"
                size="sm"
              >
                Қайта уриниш
              </Button>
            </div>
          ) : showBlockingLoader ? (
            <div className="land-category-loading-container">
              <AgriChartLoader />
            </div>
          ) : showNoData ? (
            <div className="land-category-no-data">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
              <h3>{agriNoDataLabel(language)}</h3>
            </div>
          ) : (
            <div
              className={`land-category-main-content${
                isIpadLayout ? " land-category-main-content--no-legend" : ""
              }`}
            >
              {showRefreshLoader ? <AgriChartLoader /> : null}
              <div
                className={`land-category-chart-container${
                  showRefreshLoader ? " land-category-chart-container--loading" : ""
                }`}
              >
                <div className="land-category-echart-stage">
                {this.renderRadarPieChart(chartData, 400, 400)}
                {!showRefreshLoader ? (
                  (() => {
                    const center = this.getPieCenterContent(chartData);
                    const isMultiLabel =
                      selectedCategories.length > 1 &&
                      center.label !== this.getCenterAllLabel();
                    return (
                      <div className="land-category-pie-center" aria-hidden="true">
                        {center.showPercent ? (
                          <p className="land-category-pie-center-value">
                            {this.formatCenterPercent(center.percent)}
                          </p>
                        ) : null}
                        <p className="land-category-pie-center-area">
                          {this.formatCenterArea(center.area)}
                        </p>
                        <p
                          key={center.label}
                          title={center.label}
                          className={`land-category-pie-center-label land-category-pie-center-label--muted land-category-pie-center-line--enter${
                            isMultiLabel
                              ? " land-category-pie-center-label--multi"
                              : ""
                          }`}
                        >
                          {center.label}
                        </p>
                      </div>
                    );
                  })()
                ) : null}
                </div>
              </div>

              {isIpadLayout ? null : (
              <div
                className="category-legend"
                style={{
                  // Always allow scroll; only clicks are gated by sliceInteractive.
                  pointerEvents: showRefreshLoader ? "none" : "auto",
                  opacity: showRefreshLoader ? 0.35 : 1,
                }}
                aria-disabled={showRefreshLoader}
              >
                <div className="category-legend-inner">
                {chartData.map((entry, index) => {
                  const accentColor = this.getCropColor(
                    entry.rawKey || entry.name,
                    index,
                  );

                  return (
                    <button
                      type="button"
                      key={entry.rawKey || entry.name}
                      className={`legend-item ${selectedCategories.some((selected) => this.normalizeName(selected) === this.normalizeName(entry.rawKey || entry.name)) ? "legend-item-selected" : ""}`}
                      onClick={() =>
                        sliceInteractive &&
                        this.handleSliceClick(entry, index)
                      }
                      disabled={!sliceInteractive}
                      style={
                        {
                          cursor: sliceInteractive ? "pointer" : "default",
                          pointerEvents: sliceInteractive ? "auto" : "none",
                          ["--legend-accent" as any]: accentColor,
                        } as any
                      }
                    >
                      <div
                        className="legend-color"
                        style={{ backgroundColor: accentColor }}
                      />
                      <span className="legend-label" title={entry.name}>
                        {entry.name}
                      </span>
                      <span className="legend-value">
                        <span className="legend-area-value">
                          {`${formatAreaValue(Number(entry.value) || 0)} ${areaUnit}`}
                        </span>
                      </span>
                    </button>
                  );
                })}
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
}

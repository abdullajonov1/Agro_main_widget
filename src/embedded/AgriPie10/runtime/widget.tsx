import * as echarts from "echarts";
import esriRequest from "esri/request";
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
import {
  buildSpatialJoinWhere,
  getAgriTableDataLayer,
} from "../../shared/agri-table-data-source";
import { withEvapoAccessWhere } from "../../shared/feature-layer-data";
import {
  getPieVhFilterUniqueIds,
  getPieVhFilterUniqueIdsSig,
} from "../../shared/agri-chart-filter-order";
import "./AgriPie.css";

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

const AGRI3_LANG_PREF_KEY_V3 = "agri3_lang_initialized_uz_lat_v3";
const ensureAgri3UzLatLanguageDefault = (): void => {
  try {
    if (localStorage.getItem(AGRI3_LANG_PREF_KEY_V3) === "1") return;
    localStorage.setItem("app_lang", "uz_lat");
    localStorage.setItem("evapo_app_lang", "uz_lat");
    localStorage.setItem("agro_lang", "uz_lat");
    localStorage.setItem(AGRI3_LANG_PREF_KEY_V3, "1");
  } catch {
    // ignore storage errors
  }
};

const console = {
  log: (..._args: any[]) => {},
  warn: (..._args: any[]) => {},
  error: (..._args: any[]) => {},
  info: (..._args: any[]) => {},
  debug: (..._args: any[]) => {},
};

/* ---------- Component ---------- */

export default class AgriPie extends React.PureComponent<
  AgriPieProps,
  AgriPieState
> {
  _isMounted = false;

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

  // Timing/connection
  MAX_CONNECTION_ATTEMPTS = 3;
  CONNECTION_TIMEOUT_MS = 15000;

  private normalizeLanguage = (raw?: string | null): AgriPieState["language"] => {
    const v = String(raw || "")
      .trim()
      .toLowerCase();

    if (v === "en" || v === "english") return "en";
    if (v === "ru" || v === "rus" || v === "russian") return "ru";
    if (
      v === "uz_cyr" ||
      v === "uz-cyr" ||
      v === "uz_cyrl" ||
      v === "uz-cyrl" ||
      v === "uz_cyrillic" ||
      v === "uz-cyrillic"
    ) {
      return "uz_cyr";
    }
    if (
      v === "uz_lat" ||
      v === "uz-lat" ||
      v === "uz_latin" ||
      v === "uz-latin" ||
      v === "uz"
    ) {
      return "uz_lat";
    }

    return "uz_lat";
  };

  private resolveInitialLanguage = (): AgriPieState["language"] => {
    try {
      ensureAgri3UzLatLanguageDefault();
      const fromUrl =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("lang")
          : null;
      const fromStorage =
        typeof window !== "undefined"
          ? localStorage.getItem("app_lang") ||
            localStorage.getItem("evapo_app_lang") ||
            localStorage.getItem("agro_lang")
          : null;

      return this.normalizeLanguage(fromUrl || fromStorage);
    } catch {
      return "uz_lat";
    }
  };

  private static readonly APOSTROPHE_VARIANTS = ["'", "'", "'", "ʻ", "ʼ", "`"];
  private _latestKey = "";
  private _didInitOnce = false;

  // Viloyat normalized key -> index into `state.featureLayers`
  private _viloyatKeyToLayerIndex: Record<string, number> = {};
  private _featureLayersInitPromise: Promise<void> | null = null;

  // ✅ NEW: De-duplication for fetch
  private _fetchCounter = 0;
  private _lastFetchKey = "";
  private _fetchDebounceTimer: any = null;
  private _pieChartRef = React.createRef<HTMLDivElement>();
  private _pieChart: echarts.ECharts | null = null;
  private _pieChartHostEl: HTMLDivElement | null = null;
  /** After first paint, subsequent option updates morph like Agrobank. */
  private _pieHasRendered = false;
  /** Stable slice key order so region changes morph arcs in place. */
  private _pieStableKeys: string[] = [];
  private _pieStableRawKeys: Record<string, string> = {};
  /** True only after at least one category fetch finished (success or empty). */
  private _hasCompletedFetch = false;

  constructor(props: AgriPieProps) {
    super(props);

    const initialLanguage = this.resolveInitialLanguage();

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
      vh: "",
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

  private handleLanguageChange = (event: Event) => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent)?.detail || {};
    const raw = d.lang ?? d.language ?? d.code;
    const next = this.normalizeLanguage(raw);
    if (next === this.state.language) return;
    this.setState({ language: next });
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
    const possible = [
      // ✅ enforce turi first
      "turi",

      // legacy fallback (keep if some layer still has this)
      "tur",

      // other possible naming
      "toifa",
      "yer_toifa",
      "yertoifa",
      "land_category",
      "land_type",
      "category",
      "type",
      "class",
    ];

    // 1) Prefer DS schema (fast)
    const fromDS = this.findFieldByPossibleNames(possible);
    if (fromDS) return fromDS;

    // 2) Fallback to active feature layer fields
    const fl = flOverride ?? this.state.activeFeatureLayer;
    const fields = fl?.fields ?? [];
    if (!fields.length) return null;

    const byLower = new Map(
      fields.map((f: any) => [String(f.name).toLowerCase(), f.name]),
    );

    // exact match first
    for (const p of possible) {
      const exact = byLower.get(p.toLowerCase());
      if (exact) return exact;
    }

    // partial match
    const lowerNames = Array.from(byLower.keys());
    for (const p of possible) {
      const partialIdx = lowerNames.findIndex((n) =>
        n.includes(p.toLowerCase()),
      );
      if (partialIdx !== -1) return byLower.get(lowerNames[partialIdx]) ?? null;
    }

    return null;
  }

  private buildWhereClauseForDS(
    opts: { includeCategory?: boolean; includeViloyat?: boolean } = {},
  ): string {
    const includeCategory = opts.includeCategory !== false;
    const includeViloyat = opts.includeViloyat !== false;
    // Match Agro_widgetV1: scope by selected viloyat (not lockedViloyat)
    // when includeViloyat is on; layer routing handles region layers.
    const { yil, viloyat, tuman, turi } = this.state;
    const clauses: string[] = [];

    if (includeViloyat && viloyat)
      clauses.push(this.eqAposSmart("viloyat", viloyat));
    // In default republic mode (no viloyat), ignore stale tuman filter.
    if (tuman && (includeViloyat || !!viloyat))
      clauses.push(this.eqAposSmart("tuman", tuman));

    if (yil) {
      const yDigits =
        String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0] ??
        String(yil).replace(/[^\d]/g, "");

      clauses.push(
        yDigits
          ? `yil LIKE '${yDigits}%'`
          : `yil LIKE '%${this.escapeArcGIS(String(yil))}%'`,
      );
    }

    // ✅ FIX: always use "turi"
    if (includeCategory && turi) {
      clauses.push(this.eqAposSmart("turi", turi));
    }

    // VH uniqueids are applied as chunked queries in _doFetchCategoryData
    // (not inlined here — a single huge OR of IN(...) blows GET URL limits).

    return withEvapoAccessWhere(clauses.length ? clauses.join(" AND ") : "1=1");
  }

  /** WHERE fragments for VH→pie uniqueid filter (empty = no VH scope). */
  private buildPieVhWhereChunks(): string[] | null {
    if (!this.state.filterPieByVh) return null;
    const ids = getPieVhFilterUniqueIds();
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
    if (!s) return "";
    return s
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/['''ʻʼ`]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private getCropColor(rawKey: string, index: number): string {
    const k = this.normalizeName(rawKey).toLowerCase();
    const hit = AgriPie.CROP_COLOR_MAP[k];
    if (hit) return hit;
    return (
      AgriPie.FALLBACK_COLORS[index % AgriPie.FALLBACK_COLORS.length] ??
      "#1E7AE6"
    );
  }

  private getCategoryDisplayName(
    rawKey: string,
    language: "uz_cyr" | "uz_lat" | "ru" | "en",
  ): string {
    const key = this.normalizeName(rawKey).toLowerCase();

    const labels: Record<
      string,
      { uz_cyr: string; uz_lat: string; ru: string; en: string }
    > = {
      sholi: { uz_cyr: "Шоли", uz_lat: "Sholi", ru: "Рис", en: "Rice" },
      paxta: { uz_cyr: "Пахта", uz_lat: "Paxta", ru: "Хлопок", en: "Cotton" },
      makka: { uz_cyr: "Макка", uz_lat: "Makka", ru: "Кукуруза", en: "Corn" },
      "makkajo'xori": { uz_cyr: "Маккажўхори", uz_lat: "Makkajo'xori", ru: "Кукуруза", en: "Corn" },
      makkajoxori: { uz_cyr: "Маккажўхори", uz_lat: "Makkajo'xori", ru: "Кукуруза", en: "Corn" },
      "bug'doy": { uz_cyr: "Буғдой", uz_lat: "Bug'doy", ru: "Пшеница", en: "Wheat" },
      bugdoy: { uz_cyr: "Буғдой", uz_lat: "Bug'doy", ru: "Пшеница", en: "Wheat" },
      mosh: { uz_cyr: "Мош", uz_lat: "Mosh", ru: "Маш", en: "Mung bean" },
      beda: { uz_cyr: "Беда", uz_lat: "Beda", ru: "Люцерна", en: "Alfalfa" },
      ozuqa: { uz_cyr: "Озуқа", uz_lat: "Ozuqa", ru: "Кормовые", en: "Fodder" },
      loviya: { uz_cyr: "Ловия", uz_lat: "Loviya", ru: "Фасоль", en: "Beans" },
      poliz: { uz_cyr: "Полиз", uz_lat: "Poliz", ru: "Бахчевые", en: "Melons" },
      tariq: { uz_cyr: "Тариқ", uz_lat: "Tariq", ru: "Просо", en: "Millet" },
      "bog'": { uz_cyr: "Боғ", uz_lat: "Bog'", ru: "Сад", en: "Orchard" },
      bog: { uz_cyr: "Боғ", uz_lat: "Bog'", ru: "Сад", en: "Orchard" },
      bogi: { uz_cyr: "Боғ", uz_lat: "Bog'", ru: "Сад", en: "Orchard" },
      "bog'lar": { uz_cyr: "Боғлар", uz_lat: "Bog'lar", ru: "Сады", en: "Orchards" },
      "yeryong'oq": { uz_cyr: "Ерёнғоқ", uz_lat: "Yeryong'oq", ru: "Арахис", en: "Peanut" },
      yeryongoq: { uz_cyr: "Ерёнғоқ", uz_lat: "Yeryong'oq", ru: "Арахис", en: "Peanut" },
      "yer yong'oq": { uz_cyr: "Ерёнғоқ", uz_lat: "Yer yong'oq", ru: "Арахис", en: "Peanut" },
      sabzi: { uz_cyr: "Сабзи", uz_lat: "Sabzi", ru: "Морковь", en: "Carrot" },
      kungaboqar: { uz_cyr: "Кунгабоқар", uz_lat: "Kungaboqar", ru: "Подсолнечник", en: "Sunflower" },
      baliqxovuz: { uz_cyr: "Балиқҳовуз", uz_lat: "Baliqxovuz", ru: "Рыбный пруд", en: "Fish pond" },
      "baliq hovuz": { uz_cyr: "Балиқ ҳовуз", uz_lat: "Baliq hovuz", ru: "Рыбный пруд", en: "Fish pond" },
      boshqa: { uz_cyr: "Бошқа", uz_lat: "Boshqa", ru: "Другое", en: "Other" },
      issiqxona: { uz_cyr: "Иссиқхона", uz_lat: "Issiqxona", ru: "Теплица", en: "Greenhouse" },
    };

    const hit = labels[key];
    if (!hit) return rawKey;
    return hit[language] || rawKey;
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
      .map((v) => `${field}='${this.escapeArcGIS(v)}'`);
    if (!clauses.length) return "";
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  }

  private escapeArcGIS(value: string): string {
    return value ? value.replace(/'/g, "''") : "";
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

  private buildViloyatKeyToLayerIndex = async (
    layers: __esri.FeatureLayer[],
  ): Promise<void> => {
    this._viloyatKeyToLayerIndex = {};

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer) continue;
      try {
        if (!layer.loaded && (layer as any).load) {
          await layer.load();
        }

        const q = layer.createQuery();
        (q as any).where = "1=1";
        (q as any).outFields = ["viloyat"];
        (q as any).returnGeometry = false;
        (q as any).returnDistinctValues = true;
        // PostgreSQL DISTINCT requires ORDER BY fields to be selected too.
        (q as any).orderByFields = ["viloyat ASC"];
        (q as any).num = 50000;

        const res: any = await layer.queryFeatures(q);
        const feats: any[] = res?.features ?? [];
        for (const f of feats) {
          const v = f?.attributes?.viloyat;
          const key = this.makeViloyatKey(v);
          if (key && this._viloyatKeyToLayerIndex[key] === undefined) {
            this._viloyatKeyToLayerIndex[key] = i;
          }
        }
      } catch (e) {}
    }
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

  retryMapConnection() {
    this.setState({
      connectionStatus: "idle",
      mapLoadingStatus: "idle",
      mapConnectionAttempts: 0,
      error: null,
      debugInfo: "Manual retry initiated",
    });
  }

  /* ---------- Lifecycle ---------- */
  private handleMasterFilterChange = (event: Event) => {
    const d: any = (event as CustomEvent).detail || {};
    if (!d.filters) return;

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
    const nextTurlar: string[] = Array.from(
      new Set(
        (incomingTurlar as unknown[])
          .map((value: unknown) => this.normalizeName(String(value || "")))
          .filter(Boolean),
      ),
    );
    const nextTuri: string = nextTurlar.length === 1 ? nextTurlar[0] : "";
    const nextVh = hasField("vh")
      ? String(incoming.vh || "")
      : this.state.vh;
    const nextFilterPieByVh = hasField("filterPieByVh")
      ? Boolean(incoming.filterPieByVh)
      : this.state.filterPieByVh;
    const nextPieVhUniqueIdsSig = nextFilterPieByVh
      ? getPieVhFilterUniqueIdsSig()
      : "";

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
      nextLockedViloyat !== this.state.lockedViloyat;

    const barSelectionChanged =
      nextBarField !== this.state.barCategoryField ||
      nextBarValue !== this.state.barCategoryValue ||
      nextVh !== this.state.vh ||
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
        filterPieByVh: nextFilterPieByVh,
        pieVhUniqueIdsSig: nextPieVhUniqueIdsSig,
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
        if (parentChanged || barSelectionChanged || languageChanged) {
          this.fetchCategoryData();
        }
      },
    );
  };

  componentDidMount() {
    this._isMounted = true;
    this.initializeTheme();

    this.setState({
      mapLoadingStatus: "idle",
      connectionStatus: "idle",
      debugInfo: "Widget mounted",
    });

    // ✅ MUST LISTEN to real app events
    document.addEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChange as EventListener,
    );
    document.addEventListener(
      "yilChanged",
      this.handleYilChanged as EventListener,
    );
    document.addEventListener(
      "regionChanged",
      this.handleRegionChange as EventListener,
    );
    document.addEventListener(
      "kadastrFilterChanged",
      this.handleKadastrFilterChanged as EventListener,
    );
    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleThemeToggled as EventListener,
    );
    document.addEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
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
    const fields: any[] = (fl as any)?.fields || [];
    const names = fields.map((f) => String(f?.name || ""));
    const lower = names.map((n) => n.toLowerCase());
    const preferred = ["maydon", "area_ha", "area", "hectare", "hectares", "га"];
    for (const p of preferred) {
      const idx = lower.indexOf(p);
      if (idx !== -1) return names[idx];
    }
    for (const p of preferred) {
      const idx = lower.findIndex((n) => n.includes(p));
      if (idx !== -1) return names[idx];
    }
    return this.findFieldByPossibleNames(preferred);
  }

  private async queryCategoryStatsJSON(
    fl: __esri.FeatureLayer,
    where: string,
    categoryField: string,
  ): Promise<Array<{ key: string; value: number }>> {
    const queryUrl = this.getLayerQueryUrl(fl);

    // Prefer sum(maydon) — pie must show hectares, not field counts.
    const areaField = this.findAreaStatisticField(fl);
    const oidField = (fl as any)?.objectIdField || "OBJECTID";
    const outStats = areaField
      ? [
          {
            statisticType: "sum",
            onStatisticField: areaField,
            outStatisticFieldName: "agg",
          },
        ]
      : [
          {
            statisticType: "count",
            onStatisticField: oidField,
            outStatisticFieldName: "agg",
          },
        ];

    const resp = await esriRequest(queryUrl, {
      query: {
        f: "json",
        where: where || "1=1",
        groupByFieldsForStatistics: categoryField,
        outStatistics: JSON.stringify(outStats),
        outFields: categoryField,
        returnGeometry: false,
      },
      responseType: "json",
      withCredentials: true,
    });

    const feats = resp?.data?.features ?? [];

    return feats
      .map((f: any) => ({
        key: f?.attributes?.[categoryField],
        value: Number(f?.attributes?.agg ?? 0),
      }))
      .filter((r: { key: string; value: number }) => r.key && r.value > 0);
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
        }, 2000);
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
  private handleYilChanged = (event: Event) => {
    if (!this._isMounted) return;

    const d: any = (event as CustomEvent)?.detail || {};
    if (!d || d.source === "AgriPie") return;

    const raw = d.yil ?? d.year ?? d.constructionYear;
    if (raw == null) return;

    const yil = String(raw);
    if (yil === this.state.yil) return;

    this.setState(
      {
        yil,
        error: null,
        debugInfo: `Yil changed to ${yil}`,
      },
      () => this.fetchCategoryData(),
    );
  };

  componentWillUnmount() {
    this._isMounted = false;

    if (this._fetchDebounceTimer) {
      clearTimeout(this._fetchDebounceTimer);
    }

    document.removeEventListener(
      "yilChanged",
      this.handleYilChanged as EventListener,
    ); // ✅ FIX
    document.removeEventListener(
      "regionChanged",
      this.handleRegionChange as EventListener,
    );
    document.removeEventListener(
      "agriV11ThemeToggled",
      this.handleThemeToggled as EventListener,
    );
    document.removeEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
    );
    document.removeEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChange as EventListener,
    );

    // ✅ FIX: now it actually exists
    document.removeEventListener(
      "kadastrFilterChanged",
      this.handleKadastrFilterChanged as EventListener,
    );

    // Optional legacy support
    document.removeEventListener(
      "constructionYearChanged",
      this.handleConstructionYearChanged as EventListener,
    );

    window.removeEventListener("resize", this.handleResize);

    if (this._pieChart) {
      this._pieChart.dispose();
      this._pieChart = null;
      this._pieChartHostEl = null;
      this._pieHasRendered = false;
      this._pieStableKeys = [];
      this._pieStableRawKeys = {};
    }
  }

  /* ---------- External event handlers ---------- */

  private handleExternalCategory = (event: CustomEvent) => {
    if (!event?.detail) return;
    const { source } = event.detail || {};
    if (source === "AgriPie") return;

    const nextTuri = this.normalizeName(
      event.detail.turi || event.detail.category || "",
    );
    this.selectCategoryByName(nextTuri || null);

    this.setState(
      { turi: nextTuri, turlar: nextTuri ? [nextTuri] : [], selectedCategory: nextTuri || null, selectedCategories: nextTuri ? [nextTuri] : [] },
      () => {
        this.fetchCategoryData();
      },
    );
  };
  private handleKadastrFilterChanged = (event: CustomEvent) => {
    const d = event?.detail || {};
    if (d.source === "AgriPie") return;

    // ✅ Check what data is in the event
    const hasViloyat = d.viloyat || d.massivNom;
    const hasTuman = d.tuman || d.tumanNomi;
    const hasYear = d.yil != null || d.year != null;
    const hasTuri = d.turi || d.category;

    // Build next state - only update fields that are present in the event
    const nextState: Partial<AgriPieState> = {};

    if (hasViloyat) {
      nextState.viloyat = this.normalizeName(hasViloyat);
    }

    if (hasTuman) {
      nextState.tuman = this.normalizeName(hasTuman);
    }

    if (hasYear) {
      nextState.yil = String(d.yil ?? d.year);
    }

    if (hasTuri) {
      nextState.turi = this.normalizeName(hasTuri);
    }

    // If nothing changed, skip
    if (Object.keys(nextState).length === 0) {
      return;
    }

    this.setState(nextState as AgriPieState, () => this.fetchCategoryData());
  };

  private handleConstructionYearChanged = (event: Event) => {
    const d: any = (event as CustomEvent)?.detail || {};
    if (!d || d.source === "AgriPie") return;

    // support BOTH shapes
    const raw = d.year ?? d.yil;
    if (raw == null) return;

    const yil = String(raw);
    if (yil === this.state.yil) return;

    this.setState(
      {
        yil,
        error: null,
        debugInfo: `Year changed to ${yil}`,
      },
      () => this.fetchCategoryData(),
    );
  };

  private handleRegionChange = (event: CustomEvent) => {
    const d = event?.detail || {};
    if (!d || d.source === "AgriPie") return;

    const vil = this.normalizeName(d.viloyat || "");
    const tum = this.normalizeName(d.tuman || "");

    this.setState(
      {
        viloyat: vil || this.state.viloyat,
        tuman: tum || "",
        yil: this.state.yil,
        turi: "",
        turlar: [],
        selectedCategory: null,
        selectedCategories: [],
        activeSlice: null,
        error: null,
      },
      () => {
        this.fetchCategoryData();
      },
    );
  };

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

  private handleResize = () => {
    this._pieChart?.resize();
    const isIpad = this.isIpadLayout();
    if (this._lastIpadLayout === isIpad) return;
    this._lastIpadLayout = isIpad;
    this.forceUpdate();
    window.requestAnimationFrame(() => {
      this.updatePieChart("selection");
      this._pieChart?.resize();
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
      .map((category) => this.normalizeName(category.key))
      .filter(Boolean);
    this._pieStableRawKeys = {};

    return sortedCategories.map((category) => {
      const norm = this.normalizeName(category.key);
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
          radius: ["60%", "100%"],
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
    if (!isDataUpdate && !isSelectionUpdate) {
      chart.resize();
    }
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
              turi: singleSelection,
              turlar: nextSelections,
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

    document.dispatchEvent(
      new CustomEvent("categoryFilterChanged", {
        detail: {
          yil,
          viloyat,
          tuman,
          category: selectedCategories.length === 1 ? selectedCategories[0] : "",
          turi: selectedCategories.length === 1 ? selectedCategories[0] : "",
          turlar: selectedCategories,
          source: "AgriPie",
          timestamp: Date.now(),
        },
        bubbles: true,
      }),
    );
  };

  /* ---------- Data fetch ---------- */
  private makeQueryKey(
    yil: string,
    viloyat: string,
    tuman: string,
    vh: string,
    barField?: string | null,
    barValue?: string | null,
  ) {
    return [
      yil || "",
      viloyat || "",
      tuman || "",
      vh || "",
      barField ?? "",
      barValue ?? "",
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
  private getLayerQueryUrl(fl: __esri.FeatureLayer): string {
    let url = (fl as any)?.url || "";

    // remove trailing slash
    url = url.replace(/\/+$/, "");

    // If already ".../FeatureServer/0/query"
    if (/\/(FeatureServer|MapServer)\/\d+\/query$/i.test(url)) {
      return url;
    }

    // If already ".../FeatureServer/0"
    if (/\/(FeatureServer|MapServer)\/\d+$/i.test(url)) {
      return `${url}/query`;
    }

    // If it's root ".../FeatureServer"
    if (/\/(FeatureServer|MapServer)$/i.test(url)) {
      const layerId = (fl as any)?.layerId ?? 0; // ✅ use actual layerId if known
      return `${url}/${layerId}/query`;
    }

    // If some weird ".../FeatureServer/query"
    if (/\/(FeatureServer|MapServer)\/query$/i.test(url)) {
      const base = url.replace(/\/query$/i, "");
      const layerId = (fl as any)?.layerId ?? 0;
      return `${base}/${layerId}/query`;
    }

    // fallback
    return `${url}/query`;
  }
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
    );

    if (key === this._lastFetchKey) {
      if (this.state.loading) {
        this.setState({ loading: false });
      }
      return;
    }

    // Requires at least yil; viloyat optional (empty = republic-wide)
    if (!this.state.yil) {
      this._lastFetchKey = key;
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

    this._lastFetchKey = key;
    this._fetchCounter++;
    const fetchId = this._fetchCounter;

    try {
      if (!this.state.loading) {
        this.setState({ loading: true, error: null });
      } else {
        this.setState({ error: null });
      }

      const activeFl = await this.ensureFeatureLayersResolved();

      // Find category field on the active layer (fallback to DS schema if available)
      const categoryField = this.findCategoryField(activeFl ?? null);
      if (!categoryField) {
        this._hasCompletedFetch = true;
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
      if (this.state.filterPieByVh && getPieVhFilterUniqueIds() == null) {
        // Localization publishes uniqueids after map resolve; retry briefly.
        for (let i = 0; i < 20 && getPieVhFilterUniqueIds() == null; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (!this._isMounted || fetchId !== this._fetchCounter) return;
        }
        if (getPieVhFilterUniqueIds() == null) {
          // Still missing — show empty rather than an unscoped pie.
          if (fetchId === this._fetchCounter && this._isMounted) {
            this._hasCompletedFetch = true;
            this.setState({
              categoryData: { categories: [], totalValue: 0 },
              loading: false,
              error: null,
            });
          }
          return;
        }
        if (this._isMounted) {
          this.setState({ pieVhUniqueIdsSig: getPieVhFilterUniqueIdsSig() });
        }
      }

      const whereClause = this.buildWhereClauseForDS({
        includeCategory: false,
        // Agri_table_data is one canonical republic table. Routing can return
        // that same table for every region, so the viloyat predicate must stay.
        includeViloyat: true,
      });

      const allLayers = (this.state.featureLayers || []).filter(Boolean);
      let layersForQuery: __esri.FeatureLayer[] = [];

      if (selectedViloyat) {
        const routed = this.getFeatureLayerForViloyat(selectedViloyat);
        if (routed) layersForQuery = [routed];
      }

      if (!layersForQuery.length) {
        // Default (no viloyat) must show republic-wide totals, so use only the
        // canonical/republic layer instead of summing regional layers.
        const defaultLayer = this.getDefaultFeatureLayer(allLayers);
        layersForQuery = defaultLayer ? [defaultLayer] : activeFl ? [activeFl] : [];
      }

      if (!layersForQuery.length) {
        const dsAny = this.state.dataSource as any;
        const dsLayer: __esri.FeatureLayer | undefined =
          dsAny?.layer ?? dsAny?.getLayer?.();
        if (dsLayer) layersForQuery = [dsLayer];
      }

      if (!layersForQuery.length) {
        this._hasCompletedFetch = true;
        this.setState({
          loading: false,
          error: "FeatureLayer not available for this data source.",
        });
        return;
      }

      const merged = new Map<string, { key: string; value: number }>();
      const vhChunks = this.buildPieVhWhereChunks();
      const whereParts =
        vhChunks && vhChunks.length
          ? vhChunks.map((chunk) =>
              whereClause && whereClause !== "1=1"
                ? `(${whereClause}) AND (${chunk})`
                : chunk,
            )
          : [whereClause || "1=1"];

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
            const norm = this.normalizeName(r.key || "").toLowerCase();
            if (!norm) continue;
            const prev = merged.get(norm);
            if (prev) {
              prev.value += Number(r.value || 0);
            } else {
              merged.set(norm, {
                key: r.key,
                value: Number(r.value || 0),
              });
            }
          }
        }
      }

      const rows = Array.from(merged.values());

      if (!this._isMounted || fetchId !== this._fetchCounter) return;

      const totalValue = rows.reduce((sum, r) => sum + r.value, 0);
      const categories = rows
        .sort((a, b) => b.value - a.value)
        .map((r) => ({
          key: r.key,
          value: r.value,
          percentage: totalValue ? (r.value / totalValue) * 100 : 0,
        }));

      const validSelectedCategories = this.state.selectedCategories.filter(
        (selected) =>
          categories.some(
            (category) =>
              this.normalizeName(category.key) === this.normalizeName(selected),
          ),
      );
      const newActiveSlice = categories.findIndex((category) =>
        validSelectedCategories.some(
          (selected) =>
            this.normalizeName(category.key) === this.normalizeName(selected),
        ),
      );
      const singleSelection =
        validSelectedCategories.length === 1 ? validSelectedCategories[0] : "";

      this._hasCompletedFetch = true;
      this.setState({
        categoryData: { categories, totalValue },
        loading: false,
        error: null,
        activeSlice: newActiveSlice >= 0 ? newActiveSlice : null,
        turi: singleSelection,
        turlar: validSelectedCategories,
        selectedCategory: singleSelection || null,
        selectedCategories: validSelectedCategories,
        debugInfo: `Loaded ${categories.length} categories (WHERE: ${whereClause})`,
      });
    } catch (error: any) {
      if (!this._isMounted || fetchId !== this._fetchCounter) return;

      this._hasCompletedFetch = true;
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
                    <div
                      key={entry.rawKey || entry.name}
                      className={`legend-item ${selectedCategories.some((selected) => this.normalizeName(selected) === this.normalizeName(entry.rawKey || entry.name)) ? "legend-item-selected" : ""}`}
                      onClick={() =>
                        sliceInteractive &&
                        this.handleSliceClick(entry, index)
                      }
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
                    </div>
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

import esriRequest from "esri/request";
import { JimuMapView, JimuMapViewComponent } from "jimu-arcgis";
import {
  AllWidgetProps,
  DataSource,
  DataSourceComponent,
  DataSourceManager,
  QueriableDataSource,
  React,
  getAppStore,
  type IMState,
} from "jimu-core";
import ReactDOM from "react-dom";
import { Calendar, ChevronRight, FunctionSquare, Info, Sprout, X } from "lucide-react";
import logoImage from "../assets/uzcosmos logo white.svg";
import languageDarkIcon from "../assets/Frame.svg";
import languageLightIcon from "../assets/Frame-light.svg";
import languageActiveIcon from "../assets/Frame-1.svg";
import "./AgriFilter.css";
import {
  dispatchMapClick,
  dispatchMapViewReady,
} from "../../shared/evapo-data-layer-roles";
import {
  expandDistrictVariants,
  getDetachedQueryLayerFor,
  getQueryableLayer,
  isMapImageOwnedLayer,
  syncRegionYearLayerVisibility,
  withEvapoAccessWhere,
  type ShownRegionYearLayer,
} from "../../shared/feature-layer-data";
import {
  clearAgriAdminBoundaries,
  syncAgriAdminBoundaries,
} from "../../shared/agri-admin-boundary-layer";
import { logoutFromAccount } from "../../../shared/agri-logout";
import { getAccountDisplayInfo } from "../../../shared/getAccountDisplayInfo";
import {
  isAccessDenied,
  isAccessConfigured,
  lockedViloyat as accessLockedViloyat,
  resolveAllowedViloyatsForGroups,
} from "../../../shared/agri-access-config";
import {
  getAgriTableDataLayer,
  queryAgriUniqueIdsForWhere,
  queryAgriRegionDistrictMappings,
  queryAgriTuriCropMappings,
  buildSpatialJoinWhere,
} from "../../shared/agri-table-data-source";
import {
  getAgriVegetationIndicesLayer,
  queryVegetationAvailableDates,
  queryVegetationLatestDatesByRegion,
  queryVegetationStatusCounts,
  queryVegetationStatusCountsByStatus,
  queryVegetationStatusCountsByRegionScopes,
  queryVegetationUniqueIdsForStatus,
  REPUBLIC_VH_USE_STATUS_STATS,
} from "../../shared/agri-vegetation-data-source";
import {
  clearPieVhFilterUniqueIds,
  deriveChartFilterFlags,
  setPieVhFilterUniqueIds,
  upsertChartDimOrder,
  type ChartDim,
  type ChartFilterFlags,
} from "../../shared/agri-chart-filter-order";

const WIDGET_ID = "AgriLocalizationV20-Master";
const FORCED_PORTAL_URL = "https://sgm.uzspace.uz/portal";
const FAIL_OPEN_IF_NO_MATCH = false;

// Matches EvapoRegionV20/LocalizationWidgetV20 body background behavior (see AgriFilter.css)
const APP_BG_DARK_CLASS = "evapo-app-bg-dark";
const APP_BG_LIGHT_CLASS = "evapo-app-bg-light";

const applyAppBackgroundTheme = (theme: "dark" | "light"): void => {
  try {
    const root = document.documentElement;
    const body = document.body;
    const nextClass = theme === "dark" ? APP_BG_DARK_CLASS : APP_BG_LIGHT_CLASS;

    if (root.classList.contains(nextClass) && body.classList.contains(nextClass))
      return;

    root.classList.remove(APP_BG_DARK_CLASS, APP_BG_LIGHT_CLASS);
    body.classList.remove(APP_BG_DARK_CLASS, APP_BG_LIGHT_CLASS);

    root.classList.add(nextClass);
    body.classList.add(nextClass);
  } catch {
    // DOM might be unavailable in some environments
  }
};

/** VH category definitions for bar chart (must match AgriBar) */
const VH_CATEGORIES = [
  { value: "1-Juda yaxshi", label: "Жуда яхши", order: 1, color: "#16a34a" },
  { value: "2-Yaxshi", label: "Яхши", order: 2, color: "#4ade80" },
  { value: "3-O'rta", label: "Ўрта", order: 3, color: "#f97316" },
  { value: "4-Past", label: "Паст", order: 4, color: "#ef4444" },
];

/** Map precalculated ndvi_status table values to VH category value */
const NDVI_STATUS_TO_VH: Record<string, string> = {
  juda_yaxshi: "1-Juda yaxshi",
  yaxshi: "2-Yaxshi",
  orta: "3-O'rta",
  past: "4-Past",
};

/** Reverse: VH category value → ndvi_status table value (for table WHERE clause) */
const VH_TO_NDVI_STATUS: Record<string, string> = {
  "1-Juda yaxshi": "juda_yaxshi",
  "2-Yaxshi": "yaxshi",
  "3-O'rta": "orta",
  "4-Past": "past",
};

export interface VHBarDataItem {
  category: string;
  label: string;
  count: number;
  fieldCount: number;
  percentage: number;
  color: string;
  order: number;
}

export interface VHBarData {
  categories: VHBarDataItem[];
  totalCount: number;
}

type CropRendererMode = "off" | "on";

const CROP_RENDERER_ITEMS: Array<{ value: string; label: string; color: string }> =
  [
    { value: "bug'doy", label: "Bug'doy", color: "#D9A300" },
    { value: "bugdoy", label: "Bug'doy", color: "#D9A300" },
    { value: "paxta", label: "Paxta", color: "#E8E1D1" },
    { value: "makka", label: "Makka", color: "#7CB342" },
    { value: "makkajo'xori", label: "Makkajo'xori", color: "#7CB342" },
    { value: "makkajoxori", label: "Makkajo'xori", color: "#7CB342" },
    { value: "sholi", label: "Sholi", color: "#26A69A" },
    { value: "mosh", label: "Mosh", color: "#8E44AD" },
    { value: "beda", label: "Beda", color: "#43A047" },
    { value: "ozuqa", label: "Ozuqa", color: "#8BC34A" },
    { value: "loviya", label: "Loviya", color: "#6A5ACD" },
    { value: "poliz", label: "Poliz", color: "#F26B38" },
    { value: "tariq", label: "Tariq", color: "#C58F00" },
    { value: "bog'", label: "Bog'", color: "#1B5E20" },
    { value: "bog", label: "Bog'", color: "#1B5E20" },
    { value: "bogi", label: "Bogi", color: "#1B5E20" },
    { value: "bog'lar", label: "Bog'lar", color: "#1B5E20" },
    { value: "yeryong'oq", label: "Yeryong'oq", color: "#8D6E63" },
    { value: "yeryongoq", label: "Yeryong'oq", color: "#8D6E63" },
    { value: "yer yong'oq", label: "Yer yong'oq", color: "#8D6E63" },
    { value: "sabzi", label: "Sabzi", color: "#E65100" },
    { value: "kungaboqar", label: "Kungaboqar", color: "#FDD835" },
    { value: "baliqxovuz", label: "Baliqxovuz", color: "#0288D1" },
    { value: "baliq hovuz", label: "Baliqxovuz", color: "#0288D1" },
    { value: "boshqa", label: "Boshqa", color: "#78909C" },
  ];

function resolveCropRendererColor(raw: unknown): string {
  const key = normalizeCropKey(String(raw ?? ""));
  if (!key) return "#78909C";

  const exact = CROP_RENDERER_ITEMS.find(
    (item) => normalizeCropKey(item.value) === key,
  );
  if (exact) return exact.color;

  const collapsed = key.replace(/\s+/g, "");
  const collapsedMatch = CROP_RENDERER_ITEMS.find(
    (item) => normalizeCropKey(item.value).replace(/\s+/g, "") === collapsed,
  );
  if (collapsedMatch) return collapsedMatch.color;

  const partial = CROP_RENDERER_ITEMS.find((item) => {
    const itemKey = normalizeCropKey(item.value);
    return key.includes(itemKey) || itemKey.includes(key);
  });
  return partial?.color ?? "#78909C";
}
function hexToRgba(
  hex: string,
  alpha = 1,
): [number, number, number, number] {
  const h = (hex || "").replace("#", "");
  const r = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  return r
    ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16), alpha]
    : [170, 170, 170, alpha];
}

function createCropFillSymbol(color: string): any {
  return {
    type: "simple-fill",
    // 70% transparent = 30% visible fill; outline remains fully opaque.
    color: hexToRgba(color, 0.3),
    outline: {
      color: hexToRgba(color, 1),
      width: 1,
    },
  };
}

function normalizeCropKey(raw: string): string {
  return (raw ?? "")
    .toString()
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    .replace(/['''ʻʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const GROUP_ID_TO_VIEW: Record<
  string,
  { viewItemId: string; viloyat: string }
> = {
  // EXAMPLE - replace with your real group ids + viloyat names
  // "99e138d333434fe9a0fd426f6e873af0": { viewItemId: "xxxxxxxxxxxxxxxxxxxx", viloyat: "Andijon viloyati" },
};

interface RecordData {
  viloyat?: string;
  tuman?: string;
  yil?: string | number;
  tur?: string;
  vh?: string;
  [key: string]: any;
}

interface FilterState {
  yil: string;
  viloyat: string;
  tuman: string;
  turi: string;
  turlar: string[];
  vh: string;
  /** Selected NDVI date (YYYY-MM-DD or similar) */
  ndviDate?: string;
  /** UI/data language for all linked widgets */
  language: "uz_cyr" | "uz_lat" | "ru" | "en";
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

// Real console reference, resolved via `window` so it isn't captured by the
// local `console` shadow below (a bare `const nativeConsole = console` would
// hit the same shadowed binding due to TDZ, since `const console` shadows
// the identifier for this entire module scope). agriLog() needs this to
// actually print — otherwise its "always-on" trace is silently swallowed.
const nativeConsole: Console =
  typeof window !== "undefined" ? window.console : ({} as Console);

const console = {
  log: (..._args: any[]) => {},
  warn: (..._args: any[]) => {},
  error: (..._args: any[]) => {},
  info: (..._args: any[]) => {},
  debug: (..._args: any[]) => {},
};

/** Align with AgriBar/AgriRegion/AgriPopup localStorage; default first-run language = O'zbek (Lotin) */
function resolveStoredAgriLanguage(): FilterState["language"] {
  try {
    ensureAgri3UzLatLanguageDefault();
    const raw =
      localStorage.getItem("evapo_app_lang") ||
      localStorage.getItem("app_lang") ||
      localStorage.getItem("agro_lang") ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("lang")
        : null) ||
      "";
    const v = String(raw).trim().toLowerCase();
    if (v === "en" || v === "english") return "en";
    if (v === "ru" || v === "rus" || v === "russian") return "ru";
    if (
      v === "uz_lat" ||
      v === "uz-lat" ||
      v === "uzlatin" ||
      v === "uz-latin" ||
      v === "uz"
    ) {
      return "uz_lat";
    }
    if (
      v === "uz_cyr" ||
      v === "uz-cyr" ||
      v === "uz_cyrl" ||
      v === "uz-cyrl" ||
      v === "uz_cyrillic" ||
      v === "uz-cyrillic" ||
      v === "cyrillic"
    ) {
      return "uz_cyr";
    }
    return "uz_lat";
  } catch {
    return "uz_lat";
  }
}

interface GeoWidgetState extends FilterState {
  records: RecordData[];
  totalRecordCount: number;
  loading: boolean;
  error: string | null;
  activeMapView?: JimuMapView;
  userName: string | null;
  userGroupIds: string[];
  lockedViloyat: string | null;
  allowedViloyats: string[];

  yilOptions: string[];
  /** Distinct NDVI dates available for current filter (if table date field is known) */
  ndviDateOptions?: string[];
  /** True when ndviDate was explicitly chosen by the user (e.g. from Graff) */
  ndviDateLocked?: boolean;

  /** True when a specific polygon graph is active (selected in Graff) */
  polygonMode?: boolean;
  /** Selected polygon id from AgriGraff row; used to keep only one polygon visible. */
  selectedGraffUniqueid?: string;
  /**
   * Timestamp of the click/selection that produced selectedGraffUniqueid
   * (from the originating widget, e.g. AgriPopup's pre-await click time) —
   * forwarded so AgriGraff10 can drop a stale, late-arriving notification
   * that resolves after a newer polygon selection was already applied.
   */
  selectedGraffUniqueidClickedAt?: number;

  featureLayer?: __esri.FeatureLayer;
  /** All resolved feature layers (up to numberOfDataSources) */
  featureLayers: __esri.FeatureLayer[];
  /** Spatial polygon layer(s) rendered on the map — Agri_table_data has no geometry, so the
   *  master filter's visual map sync targets these (joined by uniqueid) instead of featureLayers. */
  spatialMapLayers: __esri.FeatureLayer[];
  loadingFilters: boolean;
  isDarkTheme: boolean;
  dataSource?: QueriableDataSource;

  mapConnectionAttempts: number;
  connectionStatus: "idle" | "connecting" | "connected" | "failed";
  initialPreselectionProcessed: boolean;
  openToolbarMenu: "yil" | "language" | "indexInfo" | null;
  /** Index (NDVI/SAVI/…) currently expanded to its full detail page within the indexInfo menu. */
  selectedIndexInfoKey: string | null;
  cropRendererMode: CropRendererMode;
  graffSearchText: string;
  graffSearchSuggestions: GraffSearchRecord[];
  graffSearchShowSuggestions: boolean;
  graffSearchLoading: boolean;
  showProfileMenu: boolean;
}

const DEFAULT_GRAFF_DISPLAY_FIELDS = [
  "uniqueid",
  "tuman",
  "f_name",
  "f_inn",
  "maydon",
  "turi",
  "vh",
];

type GraffSearchRecord = Record<string, string | number | undefined> & {
  uniqueid?: string;
  objectid?: number;
  f_name?: string;
  f_inn?: string;
};

const CalendarIcon = () => (
  <Calendar className="agri-toolbar-svg" strokeWidth={1.8} aria-hidden="true" />
);

const InfoIcon = () => (
  <Info className="agri-toolbar-svg" strokeWidth={1.8} aria-hidden="true" />
);

const LanguageIcon = (props: { active: boolean; isLight: boolean }) => (
  <span
    className={[
      "agri-language-toolbar-icon",
      props.isLight ? "theme-light" : "theme-dark",
      props.active ? "is-active" : "",
    ]
      .filter(Boolean)
      .join(" ")}
    aria-hidden="true"
  >
    <img
      className="agri-language-icon-layer agri-language-icon-dark"
      src={languageDarkIcon}
      alt=""
      decoding="async"
    />
    <img
      className="agri-language-icon-layer agri-language-icon-light"
      src={languageLightIcon}
      alt=""
      decoding="async"
    />
    <img
      className="agri-language-icon-layer agri-language-icon-accent"
      src={languageActiveIcon}
      alt=""
      decoding="async"
    />
  </span>
);

const SunIcon = ({
  className,
  size = 14,
}: {
  className?: string;
  size?: number;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    width={size}
    height={size}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const MoonIcon = ({
  className,
  size = 14,
}: {
  className?: string;
  size?: number;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    width={size}
    height={size}
    aria-hidden="true"
  >
    <path
      d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className="agri-search-svg"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M16 16 20 20"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const LogoutIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className="agri-toolbar-svg agri-logout-svg"
    aria-hidden="true"
  >
    <path
      d="M15 17l5-5-5-5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20 12H9"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type MapZoomMode = "none" | "selection" | "home";
type MapZoomReason =
  | "initialization"
  | "year"
  | "region"
  | "district"
  | "district-clear"
  | "crop"
  | "vegetation"
  | "ndvi"
  | "reset"
  | "other"
  | "polygon"
  | "polygon-exit";

interface MapZoomRequest {
  mode: MapZoomMode;
  reason: MapZoomReason;
}

export default class AgriLocalization extends React.PureComponent<
  AllWidgetProps<any>,
  GeoWidgetState
> {
  private _prevDefinitionExpression = "";
  /**
   * Previous polygonMode observed in applyMapFiltersOptimized. Used only to
   * skip a bare non-geography zoom pass that coincides with popup close
   * (AgriPopup restores the pre-field extent). Geography zooms (region /
   * district / Back) always run even when the same setState cleared
   * polygonMode.
   */
  private _prevPolygonModeForZoomGuard = false;
  private _mapUpdateScheduled = false;
  private _onReset: () => void;
  private initializationTimer: any;
  private _retryTimeout: any;
  private _graffSearchDebounceTimer: any = null;
  private _dataSourceInfoDebounceTimer: any = null;
  private _isMounted = false;
  private _mapClickHandle: __esri.Handle | null = null;
  private _mapInteractionHandle: __esri.Handle | null = null;
  /** Re-checks MapImage visibility/DE after popup identify + goTo settle. */
  private _polygonFilterGuardTimers: ReturnType<typeof setTimeout>[] = [];
  private _zoomRequestId = 0;
  private _districtZoomRequestId = 0;
  /** Only the newest filter-data request may finish the global loading state. */
  private _filterDataRequestId = 0;
  /**
   * Only the newest geography apply pipeline may finish map sync + broadcast.
   * Without this, a slow Quva apply can broadcast after Back already cleared
   * tuman, briefly re-scoping Indicators/Graff to the old district.
   */
  private _geographyApplyId = 0;
  private _readyFired = false;
  /** Coalesces map/data-source/fallback startup into one network pipeline. */
  private _initialDataLoadPromise: Promise<void> | null = null;
  /** Prevents MapView ready callbacks from resolving the same layers twice. */
  private _mapConnectionPromise: Promise<void> | null = null;
  /** Last fully emitted filter payload; identical broadcasts are skipped. */
  private _lastBroadcastDigest = '';
  /** Cached detail for late subscribers (indicators mount after first broadcast). */
  private _lastBroadcastDetail: any = null;
  /**
   * Invalidates in-flight computeVhBarData → masterFilterChanged sends.
   * A slow VH query for Dang'ara must not overwrite a newer Sirdaryo broadcast.
   */
  private _broadcastGeneration = 0;
  /** Newest geography selection timestamp from widgetSelectionChanged. */
  private _lastGeographySelectionTs = 0;
  private _homeExtent: __esri.Extent | null = null;
  // Prevent repeated "home" goTo calls during rapid filter clearing.
  private _lastHomeGoToAt = 0;
  // Set by syncRegionYearLayerVisibility() each time filters change — the
  // region+year layer(s) actually shown, with live sublayer refs, so the
  // zoom step can query their real (tuman-aware) extent instead of the
  // whole region's fullExtent.
  private _lastShownRegionYearLayers: ShownRegionYearLayer[] = [];
  private _graffSearchWrapRef = React.createRef<HTMLDivElement>();
  private _yilToolbarItemRef = React.createRef<HTMLDivElement>();
  private _languageToolbarItemRef = React.createRef<HTMLDivElement>();
  private _indexInfoToolbarItemRef = React.createRef<HTMLDivElement>();

  private _originalLayerRenderers = new Map<any, __esri.Renderer | null>();
  private _cropRenderedLayers = new Set<any>();
  private _cropRendererRequestId = 0;
  private _cropRendererAutoEnabled = false;
  /** Cache distinct crop values per layer URL+field+where — avoids re-querying
   * the same shown region/year sublayer on every filter tick. */
  private _cropDistinctValueCache = new Map<string, string[]>();

  /** Cache of NDVI bucket → polygon join IDs (uniqueid) for current yil/viloyat. */
  private _ndviBucketToIds: Record<string, string[]> = {};

  /**
   * Uniqueids for the current Vegetatsiya Holati (AgriBar) selection, resolved
   * from agri_vegetation_indices.ndvi_status. null = no VH filter active.
   */
  private _vhMapUniqueIds: string[] | null = null;
  /** Bumps on every VH resolve so stale async pages never write the map. */
  private _vhResolveGen = 0;
  /** True after VH-only path already resolved uniqueids for this apply. */
  private _vhUniqueIdsReadyForApply = false;
  /**
   * When true, applyFiltersPersistent skips await resolveVhMapUniqueIds so
   * crop/tuman map DE can apply immediately. Uniqueids are resolved after
   * map paint when a VH status is still active (see applyMapFiltersOptimized).
   */
  private _deferVhUniqueIdResolve = false;
  /**
   * While deferred VH uniqueids reload, never fall back to the polygon `vh`
   * attribute filter (it does not store bar categories like "4-Past" and
   * blanks the MapImage). Geography + turi stay visible until ids arrive.
   */
  private _suppressLegacyVhOnMap = false;
  /** Cache: status|date|region|district|crops → uniqueids */
  private _vhUniqueIdCache: Record<string, string[]> = {};
  /** Last successful VH bar payload — reused on VH-only selection toggles. */
  private _lastVhBarData: VHBarData | null = null;
  /**
   * Single-flight + memo for computeVhBarData. Identical year/geo/crop keys
   * share one in-flight promise so startup broadcast storms do not fan out
   * duplicate republic VH query batches.
   */
  private _vhBarComputeInFlight = new Map<string, Promise<VHBarData | null>>();
  private _vhBarComputeMemo = new Map<string, VHBarData>();
  private _lastVhBarComputeKey = "";
  /** Canonical uniqueid → maydon maps cached by yil/geography/crop WHERE. */
  private _polygonAreaQueryCache = new Map<
    string,
    Promise<Map<string, number>>
  >();
  /** Skip recomputing VH bar counts when only the selected category changes. */
  private _reuseVhBarDataOnNextBroadcast = false;
  /**
   * Order in which Pie (turi) vs VH (vh) were first selected. Drives which
   * widget chart is scoped by the other; map always applies both when set.
   */
  private _chartDimOrder: ChartDim[] = [];

  /** Mapping of logical NDVI date (e.g. '2025-06-12') → polygon status field name (e.g. 'status_2025_06_12'). */
  private _ndviDateFieldMap: Record<string, string> = {};

  /** Viloyat name → region number (from layer attribute `region`). Used to filter by code instead of name. */
  private _viloyatToRegion: Record<string, number> = {};
  /** Tuman name → district number (from layer attribute `district`). Used to filter by code instead of name. */
  private _tumanToDistrict: Record<string, number> = {};
  /**
   * Crop type name (turi) → crop_id. agri_vegetation_indices (the source
   * behind the VH "Vegetatsiya Holati" bar, computed in computeVhBarData())
   * has no human-readable turi field, only crop_id — Agri_table_data has
   * both, so this is resolved the same way region/district are.
   */
  private _turiToCropId: Record<string, string> = {};
  /**
   * NDVI date that computeVhBarData actually used (first date with rows).
   * resolveVhMapUniqueIds must reuse this — taking "latest available" alone
   * often yields 0 uniqueids while the VH chart still shows data.
   */
  private _vhBarUsedDate: string | null = null;
  /** Layer identity -> normalized viloyat keys found in that layer. */
  private _layerToViloyatKeys: Record<string, string[]> = {};
  /** Normalized viloyat key -> layer identities that contain that viloyat. */
  private _viloyatKeyToLayerKeys: Record<string, string[]> = {};

  // Canonicalize keys used for viloyat/tuman → region/district dictionaries
  private makeRegionDistrictKey(raw: string | null | undefined): string {
    if (raw == null) return "";
    const s = this.normalizeApos(String(raw)).trim().toLowerCase();
    return s;
  }

  private getLayerKey(layer: __esri.FeatureLayer): string {
    const id = ((layer as any)?.id || "").toString().trim();
    const url = ((layer as any)?.url || "").toString().trim();
    const title = ((layer as any)?.title || "").toString().trim();
    return id || url || title || "unknown_layer";
  }

  private getEffectiveViloyat(): string {
    return this.normalizeApos(
      (this.state.lockedViloyat || this.state.viloyat || "").toString(),
    );
  }

  private getAdminBoundarySelection(): {
    viloyat: string;
    tuman: string;
    regionCode?: number;
    districtCode?: number;
  } {
    const viloyat = this.getEffectiveViloyat();
    const tuman = this.normalizeApos(String(this.state.tuman || ""));
    const vKey = this.makeRegionDistrictKey(viloyat);
    const tKey = this.makeRegionDistrictKey(tuman);
    const regionCode =
      vKey && this._viloyatToRegion[vKey] != null
        ? this._viloyatToRegion[vKey]
        : undefined;
    const districtCode =
      tKey && this._tumanToDistrict[tKey] != null
        ? this._tumanToDistrict[tKey]
        : undefined;
    return { viloyat, tuman, regionCode, districtCode };
  }

  private findLayerFieldName(
    layer: __esri.FeatureLayer,
    name: string,
  ): string | null {
    try {
      const fields: any[] = (layer as any)?.fields || [];
      if (!Array.isArray(fields) || !fields.length) return null;
      const exact = fields.find((f) => String(f?.name || "") === name);
      if (exact?.name) return exact.name;
      const ci = fields.find(
        (f) => String(f?.name || "").toLowerCase() === name.toLowerCase(),
      );
      if (ci?.name) return ci.name;
      const partial = fields.find((f) => {
        const n = String(f?.name || "").toLowerCase();
        const q = name.toLowerCase();
        return n.includes(q) || q.includes(n);
      });
      return partial?.name ?? null;
    } catch {
      return null;
    }
  }

  private getCropRendererTargetLayers = (): any[] => {
    // Only paint layers RegionYear sync currently shows. Never fall back to
    // every map sublayer (that caused ~hundreds of groupBy requests).
    // Test agri leaves are FeatureLayer / MapImage Sublayer with no children —
    // include entry.layer itself when sublayers is empty.
    const candidates: any[] = [];
    for (const entry of this._lastShownRegionYearLayers || []) {
      const fromEntry = ((entry as any)?.sublayers || []).filter(Boolean);
      const loaded =
        (entry as any)?.layer?.allSublayers?.toArray?.() ||
        (entry as any)?.layer?.sublayers?.toArray?.() ||
        [];
      const fromLoaded: any[] = [];
      for (const sub of loaded) {
        if (sub?.visible !== false) fromLoaded.push(sub);
      }
      if (fromEntry.length || fromLoaded.length) {
        candidates.push(...fromEntry, ...fromLoaded);
      } else if ((entry as any)?.layer) {
        candidates.push((entry as any).layer);
      }
    }

    const seen = new Set<any>();
    return candidates.filter((layer) => {
      if (!layer || seen.has(layer)) return false;
      const where = String(layer?.definitionExpression || "1=1");
      if (layer?.visible === false || where === "1=0") return false;
      seen.add(layer);
      return true;
    });
  };

  private cropDistinctCacheKey = (
    layer: any,
    field: string,
    where: string,
  ): string => {
    const url =
      String(layer?.url || "") ||
      `${String(layer?.layer?.url || "")}/${String(layer?.id ?? "")}`;
    return `${url}|${field}|${where}`;
  };

  /**
   * Fetch DISTINCT crop attribute values actually present on the (shown)
   * layer. UniqueValueRenderer must use these exact attribute strings as
   * `value` — a fixed transliteration palette never matches DB casing /
   * Cyrillic / apostrophe variants, so every polygon falls through to
   * defaultSymbol (uniform blue-grey).
   */
  private queryDistinctCropValues = async (
    layer: any,
    field: string,
    where: string,
  ): Promise<string[]> => {
    const cacheKey = this.cropDistinctCacheKey(layer, field, where);
    if (this._cropDistinctValueCache.has(cacheKey)) {
      return this._cropDistinctValueCache.get(cacheKey) || [];
    }

    // createQuery/queryFeatures on the live MapImage sublayer rehydrates it
    // and can clear its runtime definitionExpression (district filter) —
    // the exact drift seen as definitionExpressionBefore:"" in the click
    // logs. Run the distinct-values query on the detached off-map client.
    const queryTarget: any = (await getDetachedQueryLayerFor(layer)) || layer;

    let distinctValues: string[] = [];
    try {
      const q: any = queryTarget.createQuery?.() ?? {};
      q.where = where || "1=1";
      q.returnGeometry = false;
      q.outFields = [field];
      q.groupByFieldsForStatistics = [field];
      q.outStatistics = [
        {
          statisticType: "count",
          onStatisticField: field,
          outStatisticFieldName: "cnt",
        },
      ];
      const res: any = await queryTarget.queryFeatures(q);
      distinctValues = (res?.features || [])
        .map((f: any) => f?.attributes?.[field])
        .filter(
          (v: any) => v !== null && v !== undefined && String(v).trim() !== "",
        )
        .map((v: any) => String(v));
    } catch {
      try {
        const q2: any = queryTarget.createQuery?.() ?? {};
        q2.where = where || "1=1";
        q2.returnGeometry = false;
        q2.outFields = [field];
        q2.returnDistinctValues = true;
        q2.num = 200;
        const res2: any = await queryTarget.queryFeatures(q2);
        distinctValues = (res2?.features || [])
          .map((f: any) => f?.attributes?.[field])
          .filter(
            (v: any) =>
              v !== null && v !== undefined && String(v).trim() !== "",
          )
          .map((v: any) => String(v));
      } catch {
        distinctValues = [];
      }
    }

    distinctValues = Array.from(new Set(distinctValues));
    this._cropDistinctValueCache.set(cacheKey, distinctValues);
    return distinctValues;
  };

  private buildCropUniqueValueInfosFromValues = (
    field: string,
    distinctValues: string[],
  ): any[] => {
    const fieldLower = String(field || "").toLowerCase();
    if (distinctValues.length > 0) {
      return distinctValues.map((value) => {
        const cropName =
          fieldLower === "crop_id"
            ? Object.entries(this._turiToCropId || {}).find(
                ([, cropId]) => String(cropId) === String(value),
              )?.[0] || String(value)
            : String(value);
        return {
          value,
          label: value,
          symbol: createCropFillSymbol(resolveCropRendererColor(cropName)),
        };
      });
    }
    // Last resort when the layer has no turi yet — still better than leaving
    // the service default alone? Prefer empty so we don't mis-paint.
    return [];
  };

  private refreshCropLayer = (layer: any): void => {
    try {
      layer.refresh?.();
    } catch {
      /* ignore */
    }
    // MapImage dynamic drawing is owned by the parent service layer.
    try {
      const parent = layer?.layer;
      if (parent && parent !== layer) parent.refresh?.();
    } catch {
      /* ignore */
    }
  };

  private resetCropRenderer = (): void => {
    this._cropRendererRequestId = (this._cropRendererRequestId || 0) + 1;
    this._cropDistinctValueCache.clear();
    const renderedLayers =
      this._cropRenderedLayers instanceof Set
        ? this._cropRenderedLayers
        : (this._cropRenderedLayers = new Set<any>());
    const layers = Array.from(
      new Set<any>([
        ...this.getCropRendererTargetLayers(),
        ...renderedLayers,
      ]),
    );
    for (const layer of layers) {
      try {
        if (this._originalLayerRenderers.has(layer)) {
          layer.renderer = this._originalLayerRenderers.get(layer);
        }
        this.refreshCropLayer(layer);
      } catch {}
    }
    this._cropRenderedLayers.clear();
  };

  private applyCropRenderer = async (requestId: number): Promise<void> => {
    const layers = this.getCropRendererTargetLayers();
    if (!layers.length) {
      AgriLocalization.agriLog("cropRenderer:SKIP-no-shown-layers", {
        shownEntries: (this._lastShownRegionYearLayers || []).length,
      });
      return;
    }

    const isCurrent = (): boolean =>
      this._isMounted &&
      this.state.cropRendererMode === "on" &&
      requestId === this._cropRendererRequestId;

    const selectedTurlar = this.getSelectedTurlar();
    const selectedTuriKey =
      selectedTurlar.length === 1 ? normalizeCropKey(selectedTurlar[0]) : "";

    AgriLocalization.agriLog("cropRenderer:start", {
      layerCount: layers.length,
      selectedTuriKey: selectedTuriKey || null,
      titles: layers.map(
        (l: any) => l?.title || l?.name || `sublayer-${l?.id}`,
      ),
    });

    for (const layer of layers) {
      if (!isCurrent()) return;
      try {
        // Do NOT load() the live MapImage sublayer for field discovery —
        // hydration can clear its runtime definitionExpression (district
        // filter) and flash other districts. Loading only happens for
        // non-MapImage layers; sublayer field names come from the detached
        // client or the known "turi" fallback below.
        if (
          !layer?.loaded &&
          !isMapImageOwnedLayer(layer) &&
          typeof layer?.load === "function"
        ) {
          try {
            await layer.load();
          } catch {}
        }
        if (!isCurrent()) return;

        const field =
          this.findLayerFieldName(layer, "turi") ||
          this.findLayerFieldName(layer, "crop") ||
          this.findLayerFieldName(layer, "ekin_turi") ||
          this.findLayerFieldName(layer, "crop_id") ||
          // MapImage sublayers sometimes expose fields late; turi is the
          // standard crop attribute on agri_* RegionYear services.
          (Array.isArray((layer as any)?.fields) &&
          (layer as any).fields.length > 0
            ? null
            : "turi");
        if (!field) {
          AgriLocalization.agriLog("cropRenderer:SKIP-no-field", {
            title: layer?.title || layer?.name,
            fieldCount: Array.isArray((layer as any)?.fields)
              ? (layer as any).fields.length
              : 0,
          });
          continue;
        }

        if (!this._originalLayerRenderers.has(layer)) {
          this._originalLayerRenderers.set(layer, layer.renderer ?? null);
        }

        if (selectedTuriKey) {
          if (!isCurrent()) return;
          layer.renderer = {
            type: "simple",
            symbol: createCropFillSymbol(
              resolveCropRendererColor(selectedTuriKey),
            ),
          } as unknown as __esri.Renderer;
          this._cropRenderedLayers.add(layer);
          this.refreshCropLayer(layer);
          continue;
        }

        const where = layer.definitionExpression || "1=1";
        const distinctValues = await this.queryDistinctCropValues(
          layer,
          field,
          where,
        );
        if (!isCurrent()) return;

        const uniqueValueInfos = this.buildCropUniqueValueInfosFromValues(
          field,
          distinctValues,
        );
        if (!uniqueValueInfos.length) {
          AgriLocalization.agriLog("cropRenderer:SKIP-no-distinct-values", {
            title: layer?.title || layer?.name,
            field,
            where,
          });
          continue;
        }

        layer.renderer = {
          type: "unique-value",
          field,
          defaultSymbol: createCropFillSymbol("#78909C"),
          uniqueValueInfos,
        } as unknown as __esri.Renderer;
        this._cropRenderedLayers.add(layer);
        this.refreshCropLayer(layer);

        AgriLocalization.agriLog("cropRenderer:applied", {
          title: layer?.title || layer?.name,
          field,
          distinctCount: distinctValues.length,
          sampleValues: distinctValues.slice(0, 8),
        });
      } catch (err: any) {
        AgriLocalization.agriLog("cropRenderer:FAILED", {
          title: layer?.title || layer?.name,
          error: String(err?.message || err),
        });
      }
    }
  };

  private syncCropRenderer = async (): Promise<void> => {
    // Crop colors are a permanent map style; every filter/layer change reapplies
    // them to the currently visible live sublayers.
    const requestId = ++this._cropRendererRequestId;
    await this.applyCropRenderer(requestId);
  };

  /**
   * Hide / show the just-revealed region-year MapImage layer(s) while the
   * crop UniqueValueRenderer is still loading.
   */
  private setShownRegionYearOpacity = (opacity: number): void => {
    for (const entry of this._lastShownRegionYearLayers || []) {
      const layer = (entry as any)?.layer;
      if (!layer) continue;
      try {
        // MapImage tiles paint from the parent service opacity; leaf Sublayer
        // opacity alone does not make fields visible.
        const type = String(layer?.type || "").toLowerCase();
        if (type === "sublayer") {
          let parent = layer.parent;
          while (parent) {
            if (String(parent?.type || "").toLowerCase() === "map-image") {
              parent.opacity = opacity;
              break;
            }
            parent = parent.parent;
          }
        }
        layer.opacity = opacity;
      } catch {
        /* ignore */
      }
    }
  };

  /** Monotonic token so a stale apply cannot clear a newer map overlay. */
  private _mapSurfaceLoadingToken = 0;

  private setMapSurfaceLoading = (loading: boolean, reason: string): void => {
    try {
      document.dispatchEvent(
        new CustomEvent("agriMapSurfaceLoading", {
          detail: { loading, reason, timestamp: Date.now() },
          bubbles: true,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  /** Tell the dashboard shell to show/hide the "no data found" map overlay. */
  private setMapNoData = (noData: boolean, reason: string): void => {
    try {
      document.dispatchEvent(
        new CustomEvent("agriMapNoData", {
          detail: { noData, reason, timestamp: Date.now() },
          bubbles: true,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  /**
   * Wait until MapImage has finished exporting with the new renderer.
   * `refresh=false` only waits for the in-flight export (e.g. after a
   * definitionExpression change) without forcing an extra server export.
   */
  private waitForShownRegionYearRedraw = async (
    refresh = true,
  ): Promise<void> => {
    const view = this.state.activeMapView?.view;
    if (!view) return;

    await Promise.all(
      (this._lastShownRegionYearLayers || []).map(async (entry) => {
        const layer = (entry as any)?.layer;
        if (!layer) return;
        if (refresh) {
          try {
            layer.refresh?.();
          } catch {
            /* ignore */
          }
        }
        try {
          const lv: any = await view.whenLayerView(layer);
          if (!lv) return;

          // Give the layerView a chance to flip into `updating=true` after
          // refresh — resolving immediately when updating is already false
          // revealed the previous (green) MapImage tile.
          await new Promise<void>((resolve) => {
            let settled = false;
            let sawUpdating = !!lv.updating;
            let handle: { remove?: () => void } | null = null;
            const done = () => {
              if (settled) return;
              settled = true;
              try {
                handle?.remove?.();
              } catch {
                /* ignore */
              }
              resolve();
            };
            handle = lv.watch?.("updating", (updating: boolean) => {
              if (updating) {
                sawUpdating = true;
                return;
              }
              if (sawUpdating) done();
            });
            // If updating never flips on, don't hang forever.
            setTimeout(done, sawUpdating ? 3000 : 900);
          });
        } catch {
          /* ignore */
        }
      }),
    );
  };

  private getLayerMatchStateForViloyat(
    layer: __esri.FeatureLayer,
    effectiveViloyat: string,
  ): "match" | "mismatch" | "unknown" {
    if (!effectiveViloyat) return "unknown";
    const vKey = this.makeRegionDistrictKey(effectiveViloyat);
    if (!vKey) return "unknown";
    const matchingLayerKeys = this._viloyatKeyToLayerKeys[vKey] || [];
    if (!matchingLayerKeys.length) return "unknown";
    const layerKey = this.getLayerKey(layer);
    return matchingLayerKeys.includes(layerKey) ? "match" : "mismatch";
  }

  private buildWhereForLayer(
    layer: __esri.FeatureLayer,
    includeVh = false,
    includeTuri = true,
    forStats = false,
  ): string {
    // Build base without viloyat so we can route per layer.
    let where = this.buildWhereClause(includeVh, includeTuri, false, layer);
    if (!where || where === "1=0") return "1=0";

    const effectiveViloyat = this.getEffectiveViloyat();
    if (!effectiveViloyat) {
      // For stats (VH bar data) allow republic-wide queries without viloyat filter.
      // For map polygon display keep hidden (1=0) until user picks a region.
      return forStats ? where : "1=0";
    }

    const layerMatch = this.getLayerMatchStateForViloyat(
      layer,
      effectiveViloyat,
    );
    if (layerMatch === "mismatch") return "1=0";

    // If layer<->viloyat mapping is unknown, keep fallback viloyat predicate for safety.
    if (layerMatch === "unknown") {
      const vilClause = this.buildViloyatRegionClause();
      if (!vilClause) return "1=0";
      where = `(${where}) AND (${vilClause})`;
    }

    return where;
  }

  private buildYearClauseForLayer(layer: __esri.FeatureLayer): string {
    const { yil } = this.state;
    if (!yil) return "1=0";

    const yDigits =
      String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0] ??
      String(yil).replace(/[^\d]/g, "");
    if (!yDigits) {
      return `yil LIKE '%${this.escapeArcGIS(String(yil))}%'`;
    }

    const fields: any[] = (layer as any)?.fields || [];
    const yilField = fields.find(
      (f) => String(f?.name || "").toLowerCase() === "yil",
    );
    const t = String(yilField?.type || "").toLowerCase();
    const isString = t === "string";
    const isNumeric =
      t === "small-integer" || t === "integer" || t === "single" || t === "double";

    if (isNumeric) {
      const n = Number(yDigits);
      return Number.isFinite(n) ? `yil = ${n}` : `yil LIKE '${this.escapeArcGIS(yDigits)}%'`;
    }

    // Default to string semantics (safe for string/unknown types).
    return isString
      ? `yil LIKE '${this.escapeArcGIS(yDigits)}%'`
      : `yil LIKE '${this.escapeArcGIS(yDigits)}%'`;
  }

  private _allowClearOnce = false;
  private _primaryDataSourceId: string | null = null;
  private _dsOnlyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private _dsOnlyRetryCount = 0;
  private static readonly MAX_DS_ONLY_RETRIES = 24;
  private _normId = (s?: string) =>
    (s ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  private static readonly APOSTROPHE_VARIANTS = ["'", "'", "'", "ʻ", "ʼ", "`"];

  private normalizeApos = (s: string) =>
    (s ?? "")
      .normalize("NFKC")
      .replace(/['''ʻʼ`]/g, "'")
      .trim();

  MAX_CONNECTION_ATTEMPTS = 3;

  constructor(props: AllWidgetProps<any>) {
    super(props);
    this.state = {
      records: [],
      totalRecordCount: 0,
      loading: false,
      error: null,
      allowedViloyats: [],

      yil: "",
      viloyat: "",
      tuman: "",
      turi: "",
      turlar: [],
      vh: "",
      ndviDate: "",
      language: resolveStoredAgriLanguage(),

      userName: null,
      userGroupIds: [],
      lockedViloyat: null,

      yilOptions: [],
      ndviDateOptions: [],
      ndviDateLocked: false,
      loadingFilters: false,
      isDarkTheme: false,
      featureLayers: [],
      spatialMapLayers: [],

      mapConnectionAttempts: 0,
      connectionStatus: "idle",
      initialPreselectionProcessed: false,
      polygonMode: false,
      selectedGraffUniqueid: "",
      openToolbarMenu: null,
      selectedIndexInfoKey: null,
      cropRendererMode: "on",
      graffSearchText: "",
      graffSearchSuggestions: [],
      graffSearchShowSuggestions: false,
      graffSearchLoading: false,
      showProfileMenu: false,
    };
  }

  /* ---------------------- Lifecycle ---------------------- */
  componentDidMount() {
    this._isMounted = true;

    this.setState({ connectionStatus: "connecting" });
    this.initializeTheme();
    document.addEventListener("mousedown", this.handleDocumentClick);

    // ✅ define handler BEFORE registering it
    this._onReset = () => {
      if (!this._isMounted) return;

      this.setState(
        {
          yil: "",
          viloyat: "",
          tuman: "",
          turi: "",
          turlar: [],
          vh: "",
          ndviDate: "",
          yilOptions: [],
          graffSearchText: "",
          graffSearchSuggestions: [],
          graffSearchShowSuggestions: false,
          graffSearchLoading: false,
          initialPreselectionProcessed: true,
          selectedGraffUniqueid: "",
          polygonMode: false,
        },
        async () => {
          this._allowClearOnce = true;

          if (this.state.connectionStatus === "connected") {
            try {
              await this.applyMapFiltersOptimized({ mode: "home", reason: "reset" });
              await this.fetchDataWithCurrentState();
              this.broadcastFilterState();
              this.emitGraffTableSearchClear();
            } catch {
              /* ignore */
            }
          }
        },
      );
    };

    // ONLY listen to widget selection events - no cross-widget events
    document.addEventListener(
      "widgetSelectionChanged",
      this.handleWidgetSelection as EventListener,
    );
    document.addEventListener(
      "agriPolygonMapClickPhase",
      this.handlePolygonMapClickPhase as EventListener,
    );
    document.addEventListener("resetAllFilters", this._onReset as any);
    document.addEventListener(
      "requestMasterFilterState",
      this.handleRequestMasterFilterState as EventListener,
    );

    this.initializationTimer = setTimeout(
      () => this.ensureInitialization(),
      3000,
    );
  }

  componentWillUnmount() {
    this._isMounted = false;
    document.removeEventListener(
      "widgetSelectionChanged",
      this.handleWidgetSelection as EventListener,
    );
    document.removeEventListener(
      "agriPolygonMapClickPhase",
      this.handlePolygonMapClickPhase as EventListener,
    );
    document.removeEventListener("resetAllFilters", this._onReset);
    document.removeEventListener(
      "requestMasterFilterState",
      this.handleRequestMasterFilterState as EventListener,
    );
    document.removeEventListener("mousedown", this.handleDocumentClick);

    if (this.initializationTimer) clearTimeout(this.initializationTimer);
    if (this._retryTimeout) clearTimeout(this._retryTimeout);
    if (this._dsOnlyRetryTimer) {
      clearTimeout(this._dsOnlyRetryTimer);
      this._dsOnlyRetryTimer = null;
    }
    if (this._graffSearchDebounceTimer) {
      clearTimeout(this._graffSearchDebounceTimer);
      this._graffSearchDebounceTimer = null;
    }
    if (this._dataSourceInfoDebounceTimer) {
      clearTimeout(this._dataSourceInfoDebounceTimer);
      this._dataSourceInfoDebounceTimer = null;
    }
    if (this._mapClickHandle) {
      try {
        this._mapClickHandle.remove();
      } catch {
        /* ignore */
      }
      this._mapClickHandle = null;
    }
    if (this._mapInteractionHandle) {
      try {
        this._mapInteractionHandle.remove();
      } catch {
        /* ignore */
      }
      this._mapInteractionHandle = null;
    }
    this._zoomRequestId += 1;
    this.clearPolygonFilterGuards();

    try {
      this.state.featureLayers?.forEach((fl) => {
        if (!isMapImageOwnedLayer(fl)) fl.definitionExpression = "";
      });
      if (
        this.state.featureLayer &&
        !isMapImageOwnedLayer(this.state.featureLayer)
      )
        this.state.featureLayer.definitionExpression = "";
    } catch {}
  }

  componentDidUpdate(
    prevProps: AllWidgetProps<any>,
    prevState: GeoWidgetState,
  ) {
    const { connectionStatus, mapConnectionAttempts } = this.state;

    const shouldRetry =
      connectionStatus === "connecting" &&
      this.props.useMapWidgetIds?.length > 0 &&
      !this.state.activeMapView &&
      mapConnectionAttempts !== prevState.mapConnectionAttempts &&
      mapConnectionAttempts < this.MAX_CONNECTION_ATTEMPTS;

    if (shouldRetry) {
      if (this._retryTimeout) clearTimeout(this._retryTimeout);
      this._retryTimeout = setTimeout(() => {
        if (!this._isMounted) return;
        this.setState((s) => ({
          mapConnectionAttempts: s.mapConnectionAttempts + 1,
        }));
      }, 2000);
    }
  }

  /* ---------------------- Widget Selection Handler (SINGLE ENTRY POINT) ---------------------- */

  private handleWidgetSelection = async (event: Event) => {
    if (!this._isMounted) return;

    const d: any = (event as CustomEvent).detail || {};
    AgriLocalization.agriLog("handleWidgetSelection:received", {
      detail: d,
      currentLockedViloyat: this.state.lockedViloyat,
      currentViloyat: this.state.viloyat,
    });

    // Drop out-of-order geography events (delayed Region/Graff notifies).
    const eventTs =
      typeof d.timestamp === "number" && Number.isFinite(d.timestamp)
        ? d.timestamp
        : 0;
    const isGeographyEvent =
      d.yil !== undefined ||
      d.viloyat !== undefined ||
      d.tuman !== undefined ||
      d.turi !== undefined ||
      d.turlar !== undefined;
    if (
      isGeographyEvent &&
      eventTs > 0 &&
      this._lastGeographySelectionTs > 0 &&
      eventTs < this._lastGeographySelectionTs
    ) {
      AgriLocalization.agriLog("handleWidgetSelection:SKIP-stale-timestamp", {
        eventTs,
        lastTs: this._lastGeographySelectionTs,
        source: d.source,
      });
      return;
    }

    const updates: Partial<FilterState> = {};

    if (d.yil !== undefined) updates.yil = String(d.yil || "");
    if (d.viloyat !== undefined)
      updates.viloyat = this.normalizeApos(d.viloyat || "");
    if (d.tuman !== undefined)
      updates.tuman = this.normalizeApos(d.tuman || "");
    if (d.turlar !== undefined || d.turi !== undefined) {
      const nextTurlar = this.normalizeTurlar(d.turlar, d.turi || "");
      updates.turlar = nextTurlar;
      updates.turi = nextTurlar.length === 1 ? nextTurlar[0] : "";
    }
    if (d.vh !== undefined) {
      // Only AgriBar may clear VH (toggle-off). Other widgets often echo
      // vh:"" and would wipe a live bar selection.
      const incomingVh = this.normalizeApos(d.vh || "");
      if (d.source === "AgriBar" || incomingVh) {
        updates.vh = incomingVh;
      }
    }
    if (d.uniqueid !== undefined) {
      (updates as any).selectedGraffUniqueid = String(d.uniqueid || "").trim();
      /*
       * Only keep a real map-click timestamp (AgriPopup / explicit clickedAt).
       * Inventing Date.now() for AgriGraff table selection made Graff treat the
       * echo as "click same polygon on map" and immediately deselect.
       */
      if (typeof d.clickedAt === "number") {
        (updates as any).selectedGraffUniqueidClickedAt = d.clickedAt;
      } else if (d.source === "AgriPopup") {
        (updates as any).selectedGraffUniqueidClickedAt = Date.now();
      }
    }
    if (d.language !== undefined) updates.language = d.language;
    const ndviDateChanged = d.ndviDate !== undefined;
    if (ndviDateChanged) {
      // When a polygon graph is active, ignore external NDVI date changes from Graff.
      if ((this.state as any).polygonMode && d.source === "AgriGraffWidget") {
      } else {
        updates.ndviDate = String(d.ndviDate || "");
        if (updates.ndviDate !== this.state.ndviDate)
          this._ndviBucketToIds = {};
      }
    }

    // Track whether a polygon chart is currently active in Graff
    if (d.polygonMode !== undefined) {
      (updates as any).polygonMode = Boolean(d.polygonMode);
      if (!Boolean(d.polygonMode)) {
        (updates as any).selectedGraffUniqueid = "";
        (updates as any).selectedGraffUniqueidClickedAt = undefined;
      }
    }

    // Search-selected field is active: a map click on a *different* field
    // (AgriPopup) keeps the new map selection/zoom and only clears search UI.
    const hadSearchSelection = Boolean(
      String(this.state.graffSearchText || "").trim(),
    );
    const incomingUniqueClean = String(
      (updates as any).selectedGraffUniqueid ??
        this.state.selectedGraffUniqueid ??
        "",
    )
      .replace(/[{}]/g, "")
      .trim();
    const currentUniqueClean = String(this.state.selectedGraffUniqueid || "")
      .replace(/[{}]/g, "")
      .trim();
    const mapPickedDifferentField =
      d.source === "AgriPopup" &&
      hadSearchSelection &&
      Boolean(d.polygonMode) &&
      !!incomingUniqueClean &&
      incomingUniqueClean !== currentUniqueClean;

    if (mapPickedDifferentField || (d.polygonMode === false && hadSearchSelection)) {
      (updates as any).graffSearchText = "";
      (updates as any).graffSearchSuggestions = [];
      (updates as any).graffSearchShowSuggestions = false;
      (updates as any).graffSearchLoading = false;
      if (this._graffSearchDebounceTimer) {
        clearTimeout(this._graffSearchDebounceTimer);
        this._graffSearchDebounceTimer = null;
      }
    }

    // Update global debug year flag for console filtering.
    try {
      if (updates.yil !== undefined) {
        const y = String(updates.yil || "");
        const w: any = typeof window !== "undefined" ? (window as any) : null;
        if (w) w.__AGRI3_DEBUG_YEAR__ = /\b2024\b/.test(y) ? "2024" : "";
      }
    } catch {
      /* ignore */
    }

    // ✅ IMPORTANT: if user is locked, never accept external viloyat overrides
    if (this.state.lockedViloyat) {
      if (
        updates.viloyat !== undefined &&
        updates.viloyat !== this.state.lockedViloyat
      ) {
        AgriLocalization.agriLog(
          "handleWidgetSelection:viloyat-STRIPPED — account is locked to one viloyat " +
            "(portal group scoping); the requested viloyat was silently dropped",
          {
            requestedViloyat: updates.viloyat,
            lockedViloyat: this.state.lockedViloyat,
          },
        );
      }
      delete (updates as any).viloyat;
    }

    // ✅ hierarchy clearing (prevents caching old selections)
    const yearChanged =
      updates.yil !== undefined && updates.yil !== this.state.yil;
    const viloyatChanged =
      updates.viloyat !== undefined && updates.viloyat !== this.state.viloyat;
    const tumanChanged =
      updates.tuman !== undefined && updates.tuman !== this.state.tuman;
    const turiChanged =
      updates.turi !== undefined &&
      (updates.turi !== this.state.turi ||
        JSON.stringify(updates.turlar || []) !== JSON.stringify(this.state.turlar || []));

    // ✅ Reset VH only when geographic scope changes (year/viloyat/tuman), not when only crop (turi) changes
    // so that bar selection + crop selection can both apply.
    // AgriBar's own event always wins for vh (set above).
    if (
      (yearChanged || viloyatChanged || tumanChanged) &&
      d.source !== "AgriBar"
    ) {
      updates.vh = "";
      // Field popup / Graff single-polygon focus is stale once geography moves.
      (updates as any).polygonMode = false;
      (updates as any).selectedGraffUniqueid = "";
      // Search modal + bottom-table search filter must not survive geo change.
      (updates as any).graffSearchText = "";
      (updates as any).graffSearchSuggestions = [];
      (updates as any).graffSearchShowSuggestions = false;
      (updates as any).graffSearchLoading = false;
      if (this._graffSearchDebounceTimer) {
        clearTimeout(this._graffSearchDebounceTimer);
        this._graffSearchDebounceTimer = null;
      }
    }

    // ✅ If year changes -> clear everything below
    if (yearChanged) {
      updates.viloyat = "";
      updates.tuman = "";
      updates.turi = "";
      updates.turlar = [];
      updates.vh = "";
      (updates as any).ndviDate = "";
      (updates as any).ndviDateOptions = [];
      this._ndviBucketToIds = {};
      this._vhUniqueIdCache = {};
      this._vhMapUniqueIds = null;
      this._vhBarUsedDate = null;
    }

    // ✅ If viloyat changes -> clear below, but keep an explicitly
    // provided tuman from the same event (Region sends both together).
    if (!yearChanged && viloyatChanged) {
      if (d.tuman === undefined) updates.tuman = "";
      if (d.turlar === undefined && d.turi === undefined) {
        updates.turi = "";
        updates.turlar = [];
      }
      if (d.vh === undefined) updates.vh = "";
      this._vhUniqueIdCache = {};
      if (d.vh === undefined) this._vhMapUniqueIds = null;
    }

    // ✅ If tuman changes -> clear turi and vh
    if (!yearChanged && !viloyatChanged && tumanChanged) {
      updates.turi = "";
      updates.turlar = [];
      updates.vh = "";
      this._vhUniqueIdCache = {};
      this._vhMapUniqueIds = null;
    }

    // ✅ When only turi (crop) changes: keep vh so map ANDs crop + status.
    // Cache keys already include cropIds — do not wipe the whole cache (that
    // forced a full uniqueid re-page and made VH+crop feel stuck).
    if (turiChanged) {
      this._vhUniqueIdsReadyForApply = false;
      this._reuseVhBarDataOnNextBroadcast = false;
    }

    // IMPORTANT:
    // Crop selection (turi) coming from AgriPie should FILTER polygons only.
    // Color renderer must stay strictly manual (toolbar button), so we do not
    // auto-enable/disable cropRendererMode on turi changes.

    const nextVhForOrder =
      updates.vh !== undefined ? String(updates.vh || "") : String(this.state.vh || "");
    const nextTurlarForOrder =
      updates.turlar !== undefined
        ? this.normalizeTurlar(updates.turlar, updates.turi || "")
        : this.getSelectedTurlar();
    this.syncChartDimOrder(
      nextVhForOrder,
      nextTurlarForOrder,
      yearChanged || viloyatChanged || tumanChanged,
    );

    const hasChanges = Object.keys(updates).some(
      (key) => (updates as any)[key] !== (this.state as any)[key],
    );

    if (!hasChanges) {
      AgriLocalization.agriLog(
        "handleWidgetSelection:NO-OP — updates matched current state exactly, " +
          "nothing will be applied",
        { updates, currentState: { viloyat: this.state.viloyat, tuman: this.state.tuman, yil: this.state.yil } },
      );
      return;
    }

    const isPolygonSelectionOnly =
      (d.uniqueid !== undefined || d.polygonMode !== undefined) &&
      d.yil === undefined &&
      d.viloyat === undefined &&
      d.tuman === undefined &&
      d.turi === undefined &&
      d.turlar === undefined &&
      d.vh === undefined;

    if (!isPolygonSelectionOnly) this.clearPolygonFilterGuards();

    let zoomRequest: MapZoomRequest = { mode: "none", reason: "other" };
    if (isPolygonSelectionOnly) {
      zoomRequest =
        (d.source === "AgriGraffWidget" || d.source === "AgriPopup") &&
        d.polygonMode === false
          ? { mode: "selection", reason: "polygon-exit" }
          : { mode: "none", reason: "polygon" };
    } else if (yearChanged) {
      zoomRequest = { mode: "home", reason: "year" };
    } else if (viloyatChanged) {
      zoomRequest = {
        mode: updates.viloyat || this.state.lockedViloyat ? "selection" : "home",
        reason: "region",
      };
    } else if (tumanChanged) {
      zoomRequest = {
        mode: "selection",
        reason: updates.tuman ? "district" : "district-clear",
      };
    } else if (turiChanged) {
      const hasSelectedCrops = Boolean(updates.turlar?.length);
      zoomRequest = {
        mode: "selection",
        reason: hasSelectedCrops ? "crop" : this.state.tuman ? "district" : "region",
      };
    } else if (d.vh !== undefined) {
      // VH filter rewrites MapImage DE with a large uniqueid IN (...).
      // Do not zoom/queryExtent — that duplicates a heavy server round-trip.
      zoomRequest = { mode: "none", reason: "vegetation" };
    } else if (ndviDateChanged) {
      zoomRequest = { mode: "selection", reason: "ndvi" };
    }

    AgriLocalization.agriLog("handleWidgetSelection:applying", {
      updates,
      zoomRequest,
      chartDimOrder: this._chartDimOrder.slice(),
      chartFlags: this.getChartFilterFlags(nextVhForOrder, nextTurlarForOrder),
    });

    if (isGeographyEvent && eventTs > 0) {
      this._lastGeographySelectionTs = eventTs;
    }

    const applyId = isPolygonSelectionOnly
      ? this._geographyApplyId
      : ++this._geographyApplyId;
    if (!isPolygonSelectionOnly) {
      // Drop any in-flight VH broadcast still holding the previous geography.
      this._broadcastGeneration += 1;
    }
    const isApplyCurrent = () =>
      this._isMounted && applyId === this._geographyApplyId;

    this.setState(
      {
        ...(updates as any),
        // Polygon pick must not flip the dashboard loading overlay — that
        // path used to re-enter map sync and flash whole-viloyat tiles.
        loading: isPolygonSelectionOnly ? this.state.loading : true,
        // Lock NDVI date only when explicitly set AND geography didn't change.
        // If yil/viloyat/tuman changed, return to auto mode for the new area.
        ndviDateLocked:
          ndviDateChanged && !(yearChanged || viloyatChanged || tumanChanged)
            ? Boolean(updates.ndviDate)
            : false,
      },
      async () => {
        // Polygon selection/deselection only needs uniqueid/polygonMode for
        // Graff (+ highlight owned by AgriPopup). Do NOT call
        // syncRegionYearLayerVisibility here — re-assigning MapImage
        // definitionExpression / visibility forces a fresh export that
        // briefly paints every district before the tuman DE sticks again.
        if (isPolygonSelectionOnly) {
          if (mapPickedDifferentField) {
            // New map field stays selected/zoomed; only drop search filter/UI.
            this.emitGraffTableSearchClear({ preserveSelection: true });
          } else if (
            d.source === "AgriPopup" &&
            d.polygonMode === false &&
            hadSearchSelection
          ) {
            this.emitGraffTableSearchClear();
          }
          this.broadcastFilterState();
          if (Boolean((updates as any).polygonMode ?? d.polygonMode)) {
            this.schedulePolygonFilterGuards();
          }
          return;
        }

        try {
          // VH-only: publish charts as soon as uniqueids resolve; map redraw
          // continues in the background so Pie/Graff/Bar don't wait on export.
          const vhOnly =
            d.source === "AgriBar" &&
            d.vh !== undefined &&
            !yearChanged &&
            !viloyatChanged &&
            !tumanChanged &&
            !turiChanged;

          // Geography/crop codes are already known on VH-only toggles —
          // skip the extra round-trips that dominate perceived lag.
          if (!vhOnly) {
            // Show Vegetatsiya Holati / Pie loaders immediately while crop_id
            // and region codes resolve — don't wait for the network round-trip.
            this._reuseVhBarDataOnNextBroadcast = false;
            this.broadcastFilterState({ pendingOnly: true });

            await this.ensureRegionDistrictForSelection();
            if (!isApplyCurrent()) {
              AgriLocalization.agriLog(
                "handleWidgetSelection:SKIP-stale-apply",
                { applyId, phase: "after-region-district" },
              );
              return;
            }

            // VH + ekin turi: crop_id MUST be ready before map/VH uniqueid
            // resolve. Otherwise deferred resolve runs with cropIds=[] (or a
            // stale empty set) and the map can stick on an empty DE.
            const vhActiveWithCrop =
              !!String(this.state.vh || "").trim() &&
              (turiChanged || this.getSelectedTurlar().length > 0);
            if (vhActiveWithCrop) {
              await this.ensureCropIdForSelection();
              if (!isApplyCurrent()) {
                AgriLocalization.agriLog(
                  "handleWidgetSelection:SKIP-stale-apply",
                  { applyId, phase: "after-crop-id-before-map" },
                );
                return;
              }
            }

            if (this._isMounted) {
              this.setState({ loading: false });
            }
            void (async () => {
              try {
                await this.applyMapFiltersOptimized(zoomRequest, isApplyCurrent);
                if (!isApplyCurrent()) {
                  AgriLocalization.agriLog(
                    "handleWidgetSelection:SKIP-stale-apply",
                    { applyId, phase: "after-map-filters" },
                  );
                  return;
                }
                await this.fetchDataWithCurrentState();
                if (!isApplyCurrent()) {
                  AgriLocalization.agriLog(
                    "handleWidgetSelection:SKIP-stale-apply",
                    { applyId, phase: "after-fetch-data" },
                  );
                }
              } catch (error: any) {
                AgriLocalization.agriLog(
                  "handleWidgetSelection:map-apply-FAILED",
                  { error: String(error?.message || error) },
                );
                if (this._isMounted && isApplyCurrent()) {
                  this.setState({
                    error: error?.message || String(error),
                    loading: false,
                  });
                }
              } finally {
                if (isApplyCurrent()) {
                  ++this._mapSurfaceLoadingToken;
                  this.setMapSurfaceLoading(false, "latest-filter-settled");
                }
              }
            })();

            // Non-VH paths still resolve crop_id after map start (map uses
            // turi text and does not need vegetation crop_id).
            if (!vhActiveWithCrop) {
              await this.ensureCropIdForSelection();
              if (!isApplyCurrent()) {
                AgriLocalization.agriLog(
                  "handleWidgetSelection:SKIP-stale-apply",
                  { applyId, phase: "after-crop-id" },
                );
                return;
              }
            }

            this.broadcastFilterState();
            return;
          }

          if (vhOnly) {
            this.setMapSurfaceLoading(true, "vegetation");
            await this.resolveVhMapUniqueIds(isApplyCurrent);
            this._vhUniqueIdsReadyForApply = true;
            if (!isApplyCurrent()) {
              this._vhUniqueIdsReadyForApply = false;
              ++this._mapSurfaceLoadingToken;
              this.setMapSurfaceLoading(false, "vegetation-stale");
              AgriLocalization.agriLog(
                "handleWidgetSelection:SKIP-stale-apply",
                { applyId, phase: "after-vh-uniqueids" },
              );
              return;
            }

            // Drop the selected field when it is not part of the new VH status.
            const vhActive = !!String(this.state.vh || "").trim();
            const selectedClean = String(this.state.selectedGraffUniqueid || "")
              .replace(/[{}]/g, "")
              .toLowerCase();
            const polygonActive =
              Boolean(this.state.polygonMode) && !!selectedClean;
            let releasedPolygon = false;
            if (vhActive && polygonActive) {
              const ids = Array.isArray(this._vhMapUniqueIds)
                ? this._vhMapUniqueIds
                : [];
              const inStatus = ids.some(
                (id) =>
                  String(id || "")
                    .replace(/[{}]/g, "")
                    .toLowerCase() === selectedClean,
              );
              if (!inStatus) {
                releasedPolygon = true;
                await new Promise<void>((resolve) => {
                  if (!this._isMounted) {
                    resolve();
                    return;
                  }
                  this.setState(
                    {
                      polygonMode: false,
                      selectedGraffUniqueid: "",
                      selectedGraffUniqueidClickedAt: undefined,
                      loading: false,
                    } as any,
                    () => resolve(),
                  );
                });
                if (!isApplyCurrent()) return;
                try {
                  document.dispatchEvent(
                    new CustomEvent("widgetSelectionChanged", {
                      detail: {
                        source: "AgriFilter",
                        polygonMode: false,
                        uniqueid: "",
                        timestamp: Date.now(),
                      },
                      bubbles: true,
                    }),
                  );
                } catch {
                  /* ignore */
                }
                AgriLocalization.agriLog(
                  "handleWidgetSelection:release-polygon-not-in-vh",
                  {
                    vh: this.state.vh,
                    uniqueid: selectedClean,
                    vhIdCount: ids.length,
                  },
                );
              }
            }

            if (this._isMounted && !releasedPolygon) {
              this.setState({ loading: false });
            }
            this._reuseVhBarDataOnNextBroadcast = true;
            this.broadcastFilterState();
            void this.applyMapFiltersOptimized(zoomRequest, isApplyCurrent)
              .catch((error: any) => {
                AgriLocalization.agriLog(
                  "handleWidgetSelection:vh-map-apply-FAILED",
                  { error: String(error?.message || error) },
                );
              })
              .finally(() => {
                if (isApplyCurrent()) {
                  ++this._mapSurfaceLoadingToken;
                  this.setMapSurfaceLoading(false, "latest-filter-settled");
                }
              });
            return;
          }
        } catch (e: any) {
          if (this._isMounted && isApplyCurrent()) {
            this.setState({ error: e.message, loading: false });
            // pendingOnly may already have spun AgriBar — clear it on failure.
            this.broadcastFilterState();
          }
        } finally {
          // Rapid crop multi-select/clear can make several map applies stale.
          // The newest completed apply is authoritative: invalidate any older
          // overlay owner and always release the blocking map surface loader.
          if (isApplyCurrent()) {
            ++this._mapSurfaceLoadingToken;
            this.setMapSurfaceLoading(false, "latest-filter-settled");
          }
        }
      },
    );
  };

  /* ---------------------- Broadcast Current State ---------------------- */

  /** Late-mounted indicators ask for the last filter payload after Localization already broadcast. */
  private handleRequestMasterFilterState = (): void => {
    if (!this._isMounted || !this._lastBroadcastDetail) return;
    document.dispatchEvent(
      new CustomEvent("masterFilterChanged", {
        detail: this._lastBroadcastDetail,
        bubbles: true,
      }),
    );
  };

  private broadcastFilterState = (opts?: { pendingOnly?: boolean }) => {
    if (!this._isMounted) return;
    if (this.state.connectionStatus !== "connected") return;

    const {
      yil,
      viloyat,
      tuman,
      turi,
      turlar,
      vh,
      yilOptions,
      ndviDate,
      lockedViloyat,
      records,
      totalRecordCount,
      selectedGraffUniqueid,
      selectedGraffUniqueidClickedAt,
      polygonMode,
    } = this.state;

    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];

    // Use explicitly selected ndviDate when present and locked; otherwise fall back to latest
    // available NDVI status date so all listeners (Graff, bar, indicator, pie)
    // automatically work with the freshest data for current yil/viloyat/tuman/turi.
    const explicitNdvi = (ndviDate || "").trim();
    const effectiveNdviDate =
      (this.state.ndviDateLocked && explicitNdvi) ||
      (primaryLayer ? this.getLatestNdviDateForBar(primaryLayer) || "" : "");

    const effectiveViloyat = lockedViloyat || viloyat;

    // We now filter polygons via uniqueid lists resolved locally.
    // Huge ID arrays are NOT put on the event — Pie reads them from the
    // agri-chart-filter-order bridge when filterPieByVh is true.
    const chartFlags = this.getChartFilterFlags();
    const vhUniqueids: string[] | null =
      vh && Array.isArray(this._vhMapUniqueIds)
        ? this._vhMapUniqueIds.slice()
        : null;

    // Bar chart uses status_YYYY_MM_DD field; broadcast that attribute + value so Pie/Indicator filter like Graff
    const cfg = (this.props.config || {}) as any;
    const prefix =
      (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";
    const ndviDateStr = effectiveNdviDate;
    const barCategoryField = ndviDateStr
      ? `${prefix}${ndviDateStr.replace(/-/g, "_")}`
      : null;
    const barCategoryValue =
      vh && VH_TO_NDVI_STATUS[vh] ? VH_TO_NDVI_STATUS[vh] : null;

    // Capture generation for this broadcast. computeVhBarData is async; a
    // newer geography selection must discard this payload when it resolves.
    const broadcastGeneration = ++this._broadcastGeneration;
    const geoSnapshot = {
      yil: String(yil || ""),
      viloyat: String(effectiveViloyat || ""),
      tuman: String(tuman || ""),
      turi: String(turi || ""),
      turlar: JSON.stringify(this.normalizeTurlar(turlar, turi)),
      polygonMode: Boolean(polygonMode),
      uniqueid: polygonMode ? String(selectedGraffUniqueid || "") : "",
      filterPieByVh: chartFlags.filterPieByVh,
      filterVhBarByCrop: chartFlags.filterVhBarByCrop,
      chartDimOrder: this._chartDimOrder.join(">"),
    };

    const baseDetail = {
      filters: {
        yil,
        viloyat: effectiveViloyat,
        tuman,
        turi,
        turlar: this.normalizeTurlar(turlar, turi),
        vh,
        ndviDate: effectiveNdviDate,
        // expose whether this ndviDate came from an explicit
        // user choice (Graff/date picker) so listeners like
        // AgriIndicator can distinguish it from the auto
        // "latest date" used only for bar charts.
        ndviDateLocked: Boolean(this.state.ndviDateLocked && explicitNdvi),
        barCategoryField: barCategoryField ?? undefined,
        barCategoryValue: barCategoryValue ?? undefined,
        language: this.state.language,
        // Single-polygon focus (e.g. from AgriPopup or AgriGraff10's own row
        // click) — lets AgriGraff10 switch its chart to that one polygon's
        // vegetation-index series instead of the region-wide timeseries.
        uniqueid: polygonMode ? selectedGraffUniqueid || "" : "",
        uniqueidClickedAt: polygonMode
          ? selectedGraffUniqueidClickedAt || undefined
          : undefined,
        polygonMode: Boolean(polygonMode),
        // First-selected chart scopes the other widget; second only maps.
        filterPieByVh: chartFlags.filterPieByVh,
        filterVhBarByCrop: chartFlags.filterVhBarByCrop,
        chartDimOrder: this._chartDimOrder.slice(),
      },
      vhUniqueids,
      options: {
        yil: yilOptions,
      },
      scope: {
        lockedViloyat,
        locked: Boolean(lockedViloyat),
      },
      meta: {
        recordCount: totalRecordCount ?? records?.length ?? 0,
        whereClause: this.buildWhereClause(),
        // Frozen at broadcast start so late VH completions cannot look "newer"
        // than a subsequent geography broadcast.
        timestamp: Date.now(),
        broadcastGeneration,
        language: this.state.language,
      },
      source: "AgriFilter",
    };

    const isBroadcastCurrent = (): boolean => {
      if (!this._isMounted) return false;
      if (broadcastGeneration !== this._broadcastGeneration) return false;
      const liveViloyat = String(this.state.lockedViloyat || this.state.viloyat || "");
      return (
        geoSnapshot.yil === String(this.state.yil || "") &&
        geoSnapshot.viloyat === liveViloyat &&
        geoSnapshot.tuman === String(this.state.tuman || "") &&
        geoSnapshot.turi === String(this.state.turi || "") &&
        geoSnapshot.turlar ===
          JSON.stringify(
            this.normalizeTurlar(this.state.turlar, this.state.turi),
          ) &&
        geoSnapshot.polygonMode === Boolean(this.state.polygonMode) &&
        geoSnapshot.uniqueid ===
          (this.state.polygonMode
            ? String(this.state.selectedGraffUniqueid || "")
            : "") &&
        geoSnapshot.filterPieByVh === this.getChartFilterFlags().filterPieByVh &&
        geoSnapshot.filterVhBarByCrop ===
          this.getChartFilterFlags().filterVhBarByCrop &&
        geoSnapshot.chartDimOrder === this._chartDimOrder.join(">")
      );
    };

    const send = (
      vhBarData: VHBarData | null,
      vhBarDataPending: boolean,
    ) => {
      if (!isBroadcastCurrent()) {
        AgriLocalization.agriLog("broadcastFilterState:SKIP-stale", {
          broadcastGeneration,
          currentGeneration: this._broadcastGeneration,
          snapshot: geoSnapshot,
          live: {
            yil: this.state.yil,
            viloyat: this.state.lockedViloyat || this.state.viloyat,
            tuman: this.state.tuman,
          },
        });
        return;
      }
      const detail = { ...baseDetail, vhBarData, vhBarDataPending };
      const digest = JSON.stringify({
        filters: detail.filters,
        options: detail.options,
        scope: detail.scope,
        vhUniqueids: detail.vhUniqueids,
        vhBarData,
        vhBarDataPending,
        recordCount: detail.meta.recordCount,
        whereClause: detail.meta.whereClause,
      });
      if (digest === this._lastBroadcastDigest) {
        AgriLocalization.agriLog('broadcastFilterState:SKIP-duplicate');
        return;
      }
      this._lastBroadcastDigest = digest;
      this._lastBroadcastDetail = detail;
      document.dispatchEvent(
        new CustomEvent("masterFilterChanged", {
          detail,
          bubbles: true,
        }),
      );
    };

    // Previously we required a separate NDVI table (2nd data source).
    // Now NDVI status is stored directly on the polygon layer as date-based fields.
    const hasNdviSource = !!(
      this.state.featureLayer || this.state.featureLayers?.[0]
    );

    // Publish geography immediately so Graff/Indicators do not wait on VH.
    // A follow-up send attaches vhBarData when ready (if still current).
    // VH-only toggles reuse the last bar payload — category counts do not change.
    if (this._reuseVhBarDataOnNextBroadcast && this._lastVhBarData) {
      this._reuseVhBarDataOnNextBroadcast = false;
      send(this._lastVhBarData, false);
      return;
    }
    this._reuseVhBarDataOnNextBroadcast = false;

    // Same geography/year/crop already computed — skip pending→recompute cycle.
    const vhComputeKey = this.makeVhBarComputeKey();
    const memoizedVh = this._vhBarComputeMemo.get(vhComputeKey);
    if (memoizedVh && hasNdviSource && !opts?.pendingOnly) {
      this._lastVhBarData = memoizedVh;
      send(memoizedVh, false);
      return;
    }

    send(null, hasNdviSource);

    // Charts show loader immediately; caller re-broadcasts after crop_id resolve.
    if (opts?.pendingOnly) return;

    if (hasNdviSource) {
      this.computeVhBarData()
        .then((vhBarData) => {
          if (vhBarData) this._lastVhBarData = vhBarData;
          send(vhBarData ?? null, false);
        })
        .catch((error: any) => {
          AgriLocalization.agriLog("broadcastFilterState:vh-data-failed", {
            error: String(error?.message || error),
          });
          // End the pending state even on failure. The consumer will show its
          // completed empty/error state instead of leaving a spinner forever.
          send(null, false);
        });
    }
  };

  /* ---------------------- Map / DataSource ---------------------- */

  private getPortalSelf = async (
    jimuMapView: JimuMapView,
  ): Promise<{
    username: string | null;
    groups: Array<{ id: string; title: string }>;
    portalUrl: string;
  }> => {
    try {
      const portalUrl =
        FORCED_PORTAL_URL ||
        (jimuMapView?.view?.map as any)?.portalItem?.portal?.url ||
        "https://www.arcgis.com";

      const resp = await esriRequest(
        `${portalUrl}/sharing/rest/community/self`,
        {
          query: { f: "json" },
          responseType: "json",
          withCredentials: true,
        },
      );

      const username = resp?.data?.username ?? null;
      const groups = Array.isArray(resp?.data?.groups)
        ? resp.data.groups.map((g: any) => ({ id: g.id, title: g.title }))
        : [];
      return { username, groups, portalUrl };
    } catch (e) {
      return { username: null, groups: [], portalUrl: "unknown" };
    }
  };

  private resolveGroupScope = (
    groups: Array<{ id: string; title: string }>,
  ): { viewItemId: string; viloyat: string } | null => {
    const userIds = groups.map((g) => this._normId(g.id)).filter(Boolean);
    const normIdToOriginal: Record<string, string> = {};
    for (const k of Object.keys(GROUP_ID_TO_VIEW))
      normIdToOriginal[this._normId(k)] = k;

    for (const gid of userIds) {
      const originalKey = normIdToOriginal[gid];
      if (originalKey) return GROUP_ID_TO_VIEW[originalKey];
    }
    return null;
  };

  private resolveAllowedViloyats = (
    groups: Array<{ id: string; title: string }>,
  ): string[] => {
    const normIdToOriginal: Record<string, string> = {};
    for (const k of Object.keys(GROUP_ID_TO_VIEW)) {
      normIdToOriginal[this._normId(k)] = k;
    }
    const set = new Set<string>();
    for (const g of groups) {
      const origKey = normIdToOriginal[this._normId(g.id)];
      if (origKey) {
        set.add(this.normalizeApos(GROUP_ID_TO_VIEW[origKey].viloyat));
      }
    }
    return Array.from(set);
  };

  /** Effective data sources to use. By default use all selected sources. */
  private getEffectiveUseDataSources(): any[] {
    const raw =
      (this.props.useDataSources as any)?.asMutable?.() ??
      this.props.useDataSources ??
      [];
    const arr = Array.isArray(raw) ? raw : [];
    const cfgN = Number((this.props.config as any)?.numberOfDataSources);
    const hasLimit = Number.isFinite(cfgN) && cfgN > 0;
    const n = hasLimit ? Math.min(arr.length, Math.floor(cfgN)) : arr.length;
    return arr.slice(0, n);
  }

  private getMapWidgetId(): string | null {
    const ids = this.props.useMapWidgetIds as any;
    const list = ids?.length
      ? ids.asMutable?.() || ids.toArray?.() || ids
      : [];
    const first = Array.isArray(list) ? list[0] : null;
    return first ? String(first) : null;
  }

  private attachMapClickDispatcher = (jimuMapView: JimuMapView): void => {
    const view = jimuMapView?.view;
    if (!view) return;

    if (this._mapInteractionHandle) {
      try {
        this._mapInteractionHandle.remove();
      } catch {}
      this._mapInteractionHandle = null;
    }
    this._mapInteractionHandle = view.watch("interacting", (interacting) => {
      if (interacting) this._zoomRequestId += 1;
    });

    if (this._mapClickHandle) {
      try {
        this._mapClickHandle.remove();
      } catch {
        /* ignore */
      }
      this._mapClickHandle = null;
    }

    const mapWidgetId = this.getMapWidgetId();
    if (mapWidgetId) {
      dispatchMapViewReady(mapWidgetId);
    }

    this._mapClickHandle = view.on("click", (ev: any) => {
      if (!mapWidgetId) return;
      dispatchMapClick({
        mapWidgetId,
        x: Number(ev?.x ?? 0),
        y: Number(ev?.y ?? 0),
        mapPoint: ev?.mapPoint
          ? {
              x: Number(ev.mapPoint.x),
              y: Number(ev.mapPoint.y),
              spatialReference: ev.mapPoint.spatialReference
                ? { wkid: ev.mapPoint.spatialReference.wkid }
                : undefined,
            }
          : undefined,
      });
    });
  };

  onActiveViewChange = (jimuMapView: JimuMapView) => {
    if (!jimuMapView) {
      this.setState({
        activeMapView: null,
        featureLayer: undefined,
        featureLayers: [],
        spatialMapLayers: [],
      });
      return;
    }
    this.setState({ activeMapView: jimuMapView }, () => {
      this.attachMapClickDispatcher(jimuMapView);
      const captureHomeExtent = (): void => {
        try {
          const ex: any = (jimuMapView.view as any)?.extent;
          this._homeExtent = ex?.clone ? ex.clone() : ex || null;
        } catch {
          this._homeExtent = null;
        }
      };
      if (jimuMapView.view?.ready) {
        // EmbeddedAgriMap frames Uzbekistan before ready — capture that as home.
        captureHomeExtent();
        this.initializeMapConnection(jimuMapView);
      } else {
        const h = jimuMapView.view.watch("ready", (isReady) => {
          if (isReady) {
            h.remove();
            captureHomeExtent();
            this.initializeMapConnection(jimuMapView);
          }
        });
      }
    });
  };

  /** Always-on connection-flow logger — not gated behind any flag. */
  private static agriLog(_phase: string, _detail?: Record<string, unknown>): void {
    /* no-op */
  }

  private initializeMapConnection = (jimuMapView: JimuMapView): Promise<void> => {
    if (!this._isMounted || this.state.connectionStatus === 'connected') {
      return Promise.resolve();
    }
    if (this._mapConnectionPromise) return this._mapConnectionPromise;

    const run = this.initializeMapConnectionOnce(jimuMapView).finally(() => {
      if (this._mapConnectionPromise === run) this._mapConnectionPromise = null;
    });
    this._mapConnectionPromise = run;
    return run;
  };

  /**
   * Portal MapImageLayer identify/goTo can finish after the polygon event and
   * restore a stale visible-sublayer snapshot. Re-assert the current
   * year/region/district filter after each async phase settles. The shared
   * sync helper does not reassign an identical definitionExpression, so the
   * normal path causes no extra export; it only repairs a layer that drifted.
   */
  private clearPolygonFilterGuards = (): void => {
    this._polygonFilterGuardTimers.forEach((timer) => clearTimeout(timer));
    this._polygonFilterGuardTimers = [];
  };

  private reassertPolygonGeographyFilter = (phase: string): void => {
    if (!this._isMounted || !this.state.polygonMode) return;
    const map = this.state.activeMapView?.view?.map;
    if (!map) return;
    const shown = this.syncShownRegionYearLayers(map);
    shown.forEach((entry) => {
      try {
        if (Number(entry.layer?.opacity ?? 1) <= 0.05) entry.layer.opacity = 1;
      } catch {
        /* best-effort */
      }
    });
    this._lastShownRegionYearLayers = shown;
    AgriLocalization.agriLog("polygonFilterGuard:checked", {
      phase,
      yil: this.state.yil,
      viloyat: this.getEffectiveViloyat(),
      tuman: this.state.tuman,
      shownLayerCount: shown.length,
    });
  };

  /**
   * Popup hit-testing can make an ArcGIS MapImage sublayer briefly lose its
   * runtime definitionExpression. Reapply the current geography synchronously
   * during the click chain, before the unfiltered export can be painted.
   */
  private handlePolygonMapClickPhase = (event: Event): void => {
    if (!this._isMounted) return;
    const phase = String((event as CustomEvent)?.detail?.phase || "click");
    const map = this.state.activeMapView?.view?.map;
    if (!map) return;
    const shown = this.syncShownRegionYearLayers(map);
    this._lastShownRegionYearLayers = shown;
    AgriLocalization.agriLog("polygonClickFilter:reasserted", {
      phase,
      tuman: this.state.tuman,
      shownLayerCount: shown.length,
    });
  };

  private schedulePolygonFilterGuards = (): void => {
    this.clearPolygonFilterGuards();
    [0, 300, 900].forEach((delay) => {
      this._polygonFilterGuardTimers.push(
        setTimeout(
          () => this.reassertPolygonGeographyFilter(`after-${delay}ms`),
          delay,
        ),
      );
    });
  };

  private initializeMapConnectionOnce = async (jimuMapView: JimuMapView) => {
    if (!this._isMounted) return;
    AgriLocalization.agriLog("initializeMapConnection:start", {
      hasMapView: !!jimuMapView,
      hasMap: !!jimuMapView?.view?.map,
      useDataSources: this.getEffectiveUseDataSources().map((d: any) => ({
        dataSourceId: d?.dataSourceId,
        rootDataSourceId: d?.rootDataSourceId,
      })),
    });

    const featureLayers =
      await this.resolveFeatureLayersFromUseDataSources(jimuMapView);
    AgriLocalization.agriLog("initializeMapConnection:resolved", {
      count: featureLayers?.length ?? 0,
      layers: (featureLayers || []).map((l: any) => l?.title || l?.url || l?.id),
    });

    // Best-effort — visual map filtering degrades gracefully (no-op) if this
    // comes back empty; it never blocks the Agri_table_data connection.
    try {
      const useDsRaw =
        (this.props.useDataSources as any)?.asMutable?.() ??
        this.props.useDataSources ??
        [];
      AgriLocalization.agriLog("spatialMapLayers:useDataSources-from-settings", {
        count: Array.isArray(useDsRaw) ? useDsRaw.length : 0,
        dataSourceIds: (Array.isArray(useDsRaw) ? useDsRaw : []).map(
          (d: any) => d?.dataSourceId,
        ),
      });
      // Spatial wrappers are optional: live MapImage sublayers are discovered
      // separately. Never let many non-queryable roots block dashboard startup.
      void this.resolveSpatialMapLayers(jimuMapView).then((spatialMapLayers) => {
        AgriLocalization.agriLog("spatialMapLayers:resolved", {
          requestedCount: Array.isArray(useDsRaw) ? useDsRaw.length : 0,
          resolvedCount: spatialMapLayers.length,
        });
        if (this._isMounted) this.setState({ spatialMapLayers });
      }).catch((e) => {
        AgriLocalization.agriLog("spatialMapLayers:resolve-FAILED", {
          error: String((e as any)?.message || e),
        });
      });
    } catch (e) {
      AgriLocalization.agriLog("spatialMapLayers:resolve-FAILED", {
        error: String((e as any)?.message || e),
      });
    }

    if (!featureLayers?.length) {
      // Map didn't have a matching operational layer — fall back to the
      // selected data source directly instead of failing outright.
      AgriLocalization.agriLog(
        "initializeMapConnection:no-map-match -> falling back to data-source-only",
      );
      await this.initializeDataSourceOnlyConnection(
        "Could not resolve the map layer(s) for the selected data source(s).",
      );
      return;
    }
    await this.finalizeConnection(featureLayers, jimuMapView);
  };

  /**
   * Connects using the selected DataSourceSelector layer(s) directly,
   * without requiring the layer to also exist on a linked Map widget.
   * Used when no Map widget is linked, or when map-layer matching fails.
   */
  private initializeDataSourceOnlyConnection = async (
    failureMessage = "Could not resolve a queryable layer for the selected data source(s).",
  ): Promise<void> => {
    AgriLocalization.agriLog("initializeDataSourceOnlyConnection:start", {
      isMounted: this._isMounted,
      connectionStatus: this.state?.connectionStatus,
      retryCount: this._dsOnlyRetryCount,
    });
    if (!this._isMounted || this.state.connectionStatus === "connected") return;

    const featureLayers = await this.resolveFeatureLayersFromUseDataSources(
      null as any,
    );
    AgriLocalization.agriLog("initializeDataSourceOnlyConnection:resolved", {
      count: featureLayers?.length ?? 0,
      layers: (featureLayers || []).map((l: any) => l?.title || l?.url || l?.id),
    });
    if (!featureLayers?.length) {
      // The data source may just not be fully loaded yet (e.g. right after
      // mount, or while the Map Image Layer sublayer is still resolving) —
      // retry with backoff instead of failing on the first empty attempt.
      if (this._dsOnlyRetryCount < AgriLocalization.MAX_DS_ONLY_RETRIES) {
        this._dsOnlyRetryCount += 1;
        AgriLocalization.agriLog(
          "initializeDataSourceOnlyConnection:retrying",
          { attempt: this._dsOnlyRetryCount },
        );
        if (this._dsOnlyRetryTimer) clearTimeout(this._dsOnlyRetryTimer);
        this._dsOnlyRetryTimer = setTimeout(() => {
          this._dsOnlyRetryTimer = null;
          void this.initializeDataSourceOnlyConnection(failureMessage);
        }, 300);
        return;
      }
      AgriLocalization.agriLog("initializeDataSourceOnlyConnection:failed", {
        failureMessage,
      });
      this.setState({ connectionStatus: "failed", error: failureMessage });
      return;
    }
    this._dsOnlyRetryCount = 0;
    await this.finalizeConnection(featureLayers, this.state.activeMapView);
  };

  /** Shared tail of both the map-matched and data-source-only connection paths. */
  private finalizeConnection = async (
    featureLayers: __esri.FeatureLayer[],
    jimuMapView: JimuMapView | null,
  ): Promise<void> => {
    if (!this._isMounted) return;
    const featureLayer = featureLayers[0];
    AgriLocalization.agriLog("finalizeConnection:start", {
      primaryLayer: (featureLayer as any)?.title || (featureLayer as any)?.url,
      layerCount: featureLayers.length,
      hasMapView: !!jimuMapView,
    });

    const { username, groups } = await this.getPortalSelf(jimuMapView as any);
    const accessGroups = Array.from(
      getAppStore().getState()?.user?.groups ?? [],
    ).map((group: any) => ({
      id: String(group.id),
      title: String(group.title || ""),
    }));
    let allowedViloyats: string[] = [];
    let lockedViloyat: string | null = null;

    if (isAccessConfigured()) {
      if (isAccessDenied()) {
        AgriLocalization.agriLog(
          "finalizeConnection:failed - access denied by portal groups",
        );
        this.setState({
          connectionStatus: "failed",
          error: "Доступ запрещён для вашей группы пользователей.",
        });
        return;
      }

      allowedViloyats = resolveAllowedViloyatsForGroups(accessGroups).map(
        (value) => this.normalizeApos(value),
      );
      if (accessLockedViloyat) {
        lockedViloyat = this.normalizeApos(accessLockedViloyat);
      } else if (allowedViloyats.length === 1) {
        lockedViloyat = allowedViloyats[0];
      }
    } else {
      allowedViloyats = this.resolveAllowedViloyats(groups);
      if (allowedViloyats.length === 1) {
        lockedViloyat = allowedViloyats[0];
      } else if (
        allowedViloyats.length === 0 &&
        typeof FAIL_OPEN_IF_NO_MATCH !== "undefined" &&
        FAIL_OPEN_IF_NO_MATCH
      ) {
        AgriLocalization.agriLog(
          "finalizeConnection:failed - no matching scoped group",
        );
        this.setState({
          connectionStatus: "failed",
          error: "No matching scoped group.",
        });
        return;
      }
    }

    AgriLocalization.agriLog("finalizeConnection:portal", {
      username,
      groupCount: groups.length,
      allowedViloyats,
    });

    AgriLocalization.agriLog("finalizeConnection:connected", {
      lockedViloyat,
    });
    this.setState(
      {
        featureLayer,
        featureLayers,
        connectionStatus: "connected",
        error: null,
        userName: username,
        userGroupIds: groups.map((g) => g.id),
        allowedViloyats,
        lockedViloyat,
      },
      async () => {
        try {
          // Start with everything hidden until user picks filters.
          featureLayers.forEach((fl) => {
            fl.definitionExpression = "1=0";
          });
        } catch {}
        this._allowClearOnce = true;
        // NDVI date discovery now happens lazily in computeVhBarData(),
        // scoped to the selected region/district via
        // queryVegetationAvailableDates() (agri_vegetation_indices) — no
        // eager per-layer field scan needed here anymore.
        await this.runInitialDataLoad();
      },
    );
  };

  private resolveFeatureLayerFromOneUseDataSource = async (
    useDs: any,
    jimuMapView: JimuMapView | null,
  ): Promise<__esri.FeatureLayer | null> => {
    if (!useDs?.dataSourceId) {
      AgriLocalization.agriLog("resolveOne:no-dataSourceId", { useDs });
      return null;
    }
    const dsId = useDs.dataSourceId;
    const rootDsId = useDs.rootDataSourceId;
    AgriLocalization.agriLog("resolveOne:start", {
      dsId,
      rootDsId,
      hasMap: !!jimuMapView?.view?.map,
    });

    const jlvList: any[] = jimuMapView?.view?.map
      ? jimuMapView.getAllJimuLayerViews?.() || []
      : [];
    const matchByDsId = (id: string) =>
      jlvList.find(
        (lv) => lv?.layerDataSourceId === id || lv?.dataSourceId === id,
      );

    let jlv = matchByDsId(dsId) || (rootDsId ? matchByDsId(rootDsId) : null);
    // MapImage sublayers often aren't queryable until the parent finishes loading.
    try {
      const rootLayer: any = jlv?.layer;
      if (rootLayer && typeof rootLayer.load === "function") {
        await rootLayer.load();
      }
      const allSubs =
        rootLayer?.allSublayers?.toArray?.() ||
        rootLayer?.sublayers?.toArray?.() ||
        [];
      for (const sub of allSubs) {
        try {
          if (typeof sub?.load === "function") await sub.load();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    // getQueryableLayer handles both plain FeatureLayers and Map Image Layer
    // roots by drilling into .sublayers/.allSublayers for a queryable child —
    // the same shared helper evapo/evapo-main's widgets rely on.
    const jlvQueryable = getQueryableLayer(jlv?.layer);
    AgriLocalization.agriLog("resolveOne:jlvMatch", {
      dsId,
      found: !!jlv,
      layerType: jlv?.layer?.type,
      layerTitle: jlv?.layer?.title || jlv?.layer?.url,
      queryable: !!jlvQueryable,
      sublayerCount:
        jlv?.layer?.allSublayers?.length ??
        jlv?.layer?.allSublayers?.toArray?.()?.length ??
        jlv?.layer?.sublayers?.length ??
        jlv?.layer?.sublayers?.toArray?.()?.length ??
        0,
    });
    if (jlvQueryable) {
      AgriLocalization.agriLog("resolveOne:resolved-via-jlv", { dsId });
      return jlvQueryable as __esri.FeatureLayer;
    }

    // MapImage parents are never queryable themselves. Prefer first leaf
    // sublayer with createQuery/queryFeatures after load (region-year layers).
    try {
      const rootLayer: any = jlv?.layer;
      const leafs =
        rootLayer?.allSublayers?.toArray?.() ||
        rootLayer?.sublayers?.toArray?.() ||
        [];
      for (const sub of leafs) {
        const nestedKids =
          sub?.sublayers?.toArray?.()?.length || sub?.sublayers?.length || 0;
        if (nestedKids > 0) continue;
        const leaf = getQueryableLayer(sub) || sub;
        if (
          leaf &&
          (typeof leaf.createQuery === "function" ||
            typeof leaf.queryFeatures === "function")
        ) {
          AgriLocalization.agriLog("resolveOne:resolved-via-mapimage-leaf", {
            dsId,
            title: leaf?.title || leaf?.id,
          });
          return leaf as __esri.FeatureLayer;
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const ds: any = DataSourceManager.getInstance().getDataSource(dsId);
      AgriLocalization.agriLog("resolveOne:dsManagerLookup", {
        dsId,
        found: !!ds,
        hasGetLayer: typeof ds?.getLayer === "function",
      });
      if (ds?.getLayer) {
        const lyr = await ds.getLayer();
        const queryableLyr = getQueryableLayer(lyr);
        AgriLocalization.agriLog("resolveOne:ds.getLayer result", {
          dsId,
          layerType: (lyr as any)?.type,
          queryable: !!queryableLyr,
        });
        if (queryableLyr) {
          AgriLocalization.agriLog("resolveOne:resolved-via-ds.getLayer", {
            dsId,
          });
          return queryableLyr as __esri.FeatureLayer;
        }
      }
      const url: string | undefined = ds?.url || ds?.layer?.url;
      if (url && jimuMapView?.view?.map) {
        const layers = jimuMapView.view.map.layers.toArray() as any[];
        const cand = layers.find((ly: any) => ly?.url === url);
        const queryableCand = getQueryableLayer(cand);
        AgriLocalization.agriLog("resolveOne:urlMatch", {
          dsId,
          url,
          found: !!cand,
          queryable: !!queryableCand,
        });
        if (queryableCand) return queryableCand as __esri.FeatureLayer;
      }
    } catch (e) {
      AgriLocalization.agriLog("resolveOne:error", {
        dsId,
        error: String((e as any)?.message || e),
      });
    }
    AgriLocalization.agriLog("resolveOne:unresolved", { dsId });
    return null;
  };

  /**
   * Resolves the actual spatial polygon layer(s) rendered on the map, via the
   * builder-assigned useDataSources — Agri_table_data itself has no geometry,
   * so visual map filtering must target these instead, joined by uniqueid.
   */
  private resolveSpatialMapLayers = async (
    jimuMapView: JimuMapView | null,
  ): Promise<__esri.FeatureLayer[]> => {
    const raw =
      (this.props.useDataSources as any)?.asMutable?.() ??
      this.props.useDataSources ??
      [];
    const useDss = Array.isArray(raw) ? raw : [];
    const results = await Promise.all(
      useDss.map((useDs) =>
        this.resolveFeatureLayerFromOneUseDataSource(useDs, jimuMapView),
      ),
    );
    return Array.from(new Set(results.filter(Boolean))) as __esri.FeatureLayer[];
  };

  private resolveFeatureLayersFromUseDataSources = async (
    jimuMapView: JimuMapView | null,
  ): Promise<__esri.FeatureLayer[]> => {
    // Agri_table_data is an external Table, not an operational layer on any
    // map and not required to be assigned via useDataSources — every filter
    // dropdown reads from this same singleton layer, loaded directly by URL.
    try {
      const { layer } = await getAgriTableDataLayer();
      AgriLocalization.agriLog("resolveAll:agri-table-data", {
        url: (layer as any)?.url,
      });
      return [layer as __esri.FeatureLayer];
    } catch (e) {
      AgriLocalization.agriLog("resolveAll:agri-table-data-failed", {
        error: String((e as any)?.message || e),
      });
      return [];
    }
  };

  private buildLayerViloyatIndex = async (): Promise<void> => {
    const layers = this.state.featureLayers?.length
      ? this.state.featureLayers
      : this.state.featureLayer
        ? [this.state.featureLayer]
        : [];
    const layerToViloyatKeys: Record<string, string[]> = {};
    const viloyatToLayerSet: Record<string, Set<string>> = {};

    for (const layer of layers) {
      const layerKey = this.getLayerKey(layer);
      const normalizedKeys = new Set<string>();
      try {
        const q = layer.createQuery();
        (q as any).where = "1=1";
        (q as any).outFields = ["viloyat"];
        (q as any).returnGeometry = false;
        (q as any).returnDistinctValues = true;
        // Override inherited OBJECTID ordering: PostgreSQL requires DISTINCT
        // queries to order only by a field present in the select list.
        (q as any).orderByFields = ["viloyat ASC"];
        (q as any).num = 200;
        const res = await layer.queryFeatures(q);
        const feats = res?.features ?? [];
        for (const f of feats) {
          const raw = (f.attributes as any)?.viloyat;
          const k = this.makeRegionDistrictKey(raw != null ? String(raw) : "");
          if (!k) continue;
          normalizedKeys.add(k);
          if (!viloyatToLayerSet[k]) viloyatToLayerSet[k] = new Set<string>();
          viloyatToLayerSet[k].add(layerKey);
        }
      } catch (e) {}
      layerToViloyatKeys[layerKey] = Array.from(normalizedKeys);
    }

    const viloyatKeyToLayerKeys: Record<string, string[]> = {};
    Object.keys(viloyatToLayerSet).forEach((k) => {
      viloyatKeyToLayerKeys[k] = Array.from(viloyatToLayerSet[k]);
    });

    this._layerToViloyatKeys = layerToViloyatKeys;
    this._viloyatKeyToLayerKeys = viloyatKeyToLayerKeys;
  };

  /**
   * Inspect the primary polygon layer fields and detect NDVI status fields that follow
   * a `status_YYYY_MM_DD` pattern (or a configurable prefix). Populates:
   *  - this._ndviDateFieldMap: date label → field name
   *  - this.state.ndviDateOptions: sorted list of date labels
   *  - this.state.ndviDate: keeps existing value when possible, otherwise latest date
   */
  private detectNdviStatusDateFieldsFromLayer = (): void => {
    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return;

    try {
      const cfg = (this.props.config || {}) as any;
      const prefix =
        (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";

      const fields: any[] = (primaryLayer as any).fields || [];
      const dateToField: Record<string, string> = {};
      const dateLabels: string[] = [];

      for (const f of fields) {
        const name = (f?.name || "").toString();
        if (!name) continue;
        if (!name.toLowerCase().startsWith(prefix.toLowerCase())) continue;

        const rawSuffix = name.slice(prefix.length); // e.g. "2025_06_12"
        const digitsOnly = rawSuffix.replace(/[^0-9]/g, "");

        let label: string;
        if (digitsOnly.length === 8) {
          const y = digitsOnly.slice(0, 4);
          const m = digitsOnly.slice(4, 6);
          const d = digitsOnly.slice(6, 8);
          label = `${y}-${m}-${d}`; // normalized to YYYY-MM-DD
        } else {
          // Fallback: just replace underscores with dashes.
          label = rawSuffix.replace(/_/g, "-");
        }

        if (!dateToField[label]) {
          dateToField[label] = name;
          dateLabels.push(label);
        }
      }

      if (!dateLabels.length) {
        this._ndviDateFieldMap = {};
        if (this._isMounted) {
          this.setState({ ndviDateOptions: [], ndviDate: "" });
        }
        return;
      }

      dateLabels.sort((a, b) => {
        const ta = Date.parse(a);
        const tb = Date.parse(b);
        if (Number.isNaN(ta) || Number.isNaN(tb)) return a.localeCompare(b);
        return ta - tb;
      });

      this._ndviDateFieldMap = dateToField;

      if (!this._isMounted) return;
      this.setState((prev) => {
        const current = (prev.ndviDate || "").trim();
        const locked = !!prev.ndviDateLocked;
        const latest = dateLabels[dateLabels.length - 1];
        const nextSelected =
          locked && current && dateLabels.includes(current)
            ? current
            : current && dateLabels.includes(current)
              ? current
              : latest;
        return {
          ndviDateOptions: dateLabels,
          ndviDate: nextSelected,
        };
      });
    } catch (e) {}
  };

  onDataSourceCreated = (ds: DataSource) => {
    const qds = ds as QueriableDataSource;
    const dsId = ((qds as any)?.id || "").toString();
    AgriLocalization.agriLog("onDataSourceCreated:fired", {
      dsId,
      primaryDataSourceId: this._primaryDataSourceId,
      connectionStatus: this.state?.connectionStatus,
      hasMapWidgetLinked: !!this.props.useMapWidgetIds?.length,
    });

    if (!this._primaryDataSourceId) {
      this._primaryDataSourceId = dsId || null;
    }

    // Ignore non-primary data source instances to avoid repeated init loops.
    if (
      this._primaryDataSourceId &&
      dsId &&
      dsId !== this._primaryDataSourceId
    ) {
      AgriLocalization.agriLog("onDataSourceCreated:ignored-non-primary", {
        dsId,
        primaryDataSourceId: this._primaryDataSourceId,
      });
      return;
    }

    if (typeof (qds as any).setListenSelection === "function") {
      (qds as any).setListenSelection(false);
    }
    this.setState({ dataSource: qds, error: null }, async () => {
      if (this.state.connectionStatus === "connected") {
        AgriLocalization.agriLog(
          "onDataSourceCreated:already-connected -> fetching",
        );
        await this.runInitialDataLoad();
      } else if (!this.props.useMapWidgetIds?.length) {
        // No Map widget linked — the map-based connection path never runs,
        // so connect directly using the selected data source instead.
        AgriLocalization.agriLog(
          "onDataSourceCreated:no-map-linked -> initializeDataSourceOnlyConnection",
        );
        await this.initializeDataSourceOnlyConnection();
      } else {
        AgriLocalization.agriLog(
          "onDataSourceCreated:waiting-on-map-connection",
          { connectionStatus: this.state?.connectionStatus },
        );
      }
    });
  };

  onDataSourceInfoChange = (info: any) => {
    if (!this._isMounted) return;
    if (this.state.connectionStatus !== "connected") return;
    if (!info) return;

    const sawRecords = Array.isArray(info.records);
    if (!sawRecords) return;

    if (this._dataSourceInfoDebounceTimer) {
      clearTimeout(this._dataSourceInfoDebounceTimer);
    }
    this._dataSourceInfoDebounceTimer = setTimeout(() => {
      if (!this._isMounted) return;
      this.fetchDataWithCurrentState();
    }, 300);
  };

  retryMapConnection = () => {
    this.setState({
      connectionStatus: "connecting",
      mapConnectionAttempts: 0,
      error: null,
    });
  };

  private runInitialDataLoad = (): Promise<void> => {
    if (!this._isMounted || this.state.connectionStatus !== 'connected') {
      return Promise.resolve();
    }
    if (this._readyFired) return Promise.resolve();
    if (this._initialDataLoadPromise) return this._initialDataLoadPromise;

    const run = (async () => {
      this.setState({ loading: true });
      this._allowClearOnce = true;
      // Warm vegetation FeatureLayer in parallel so the first ekin-turi VH
      // refresh does not pay layer-load latency.
      void getAgriVegetationIndicesLayer().catch(() => {
        /* best-effort warmup */
      });
      await Promise.all([
        this.buildLayerViloyatIndex(),
        this.fetchFilterOptions(),
        this.fetchAndStoreRegionDistrictMappings(),
      ]);
      if (!this._isMounted) return;
      await this.applyMapFiltersOptimized();
      await this.fetchDataWithCurrentState();
      if (!this._isMounted) return;

      if (this.initializationTimer) {
        clearTimeout(this.initializationTimer);
        this.initializationTimer = null;
      }
      if (!this._readyFired) {
        this._readyFired = true;
        this.broadcastFilterState();
      }
    })().finally(() => {
      if (this._initialDataLoadPromise === run) {
        this._initialDataLoadPromise = null;
      }
    });

    this._initialDataLoadPromise = run;
    return run;
  };

  ensureInitialization = async () => {
    if (!this._isMounted) return;
    const { dataSource, connectionStatus } = this.state;

    if (
      dataSource &&
      connectionStatus === "connected" &&
      this.state.yilOptions.length === 0
    ) {
      await this.runInitialDataLoad();
    } else if (connectionStatus === "failed") {
      this.retryMapConnection();
    }
  };

  /* ---------------------- Filter Options ---------------------- */

  private getUniqueValues = async (fieldName: string): Promise<string[]> => {
    const layers = this.state.featureLayers?.length
      ? this.state.featureLayers
      : this.state.featureLayer
        ? [this.state.featureLayer]
        : [];
    if (!layers.length) return [];

    const distinct = new Set<string>();
    for (const layer of layers) {
      const values = await this.flDistinctFromLayer(layer, fieldName, "1=1");
      values.forEach((v) => distinct.add(v));
    }

    const merged = Array.from(distinct);
    if (fieldName.toLowerCase() === "yil") {
      return merged.sort((a, b) => Number(a) - Number(b));
    }
    return merged.sort();
  };

  private fetchFilterOptions = async () => {
    if (!this._isMounted) return;
    if (this.state.connectionStatus !== "connected") return;

    try {
      this.setState({ loadingFilters: true });

      const yilValues = await this.getUniqueValues("yil");

      if (!this._isMounted) return;

      // Sort years so newest is last
      const sorted = yilValues.slice().sort((a, b) => {
        const ay = parseInt(String(a).replace(/[^\d]/g, ""), 10);
        const by = parseInt(String(b).replace(/[^\d]/g, ""), 10);
        if (isNaN(ay) || isNaN(by)) return String(a).localeCompare(String(b));
        return ay - by;
      });
      const latest = sorted.length ? sorted[sorted.length - 1] : "";
      const prevYil = this.state.yil;
      const prevStillValid =
        !!prevYil && sorted.some((v) => String(v) === String(prevYil));
      const nextYil = prevStillValid ? prevYil : latest;

      this.setState({
        yilOptions: sorted,
        yil: nextYil,
        loadingFilters: false,
        loading: false,
        error: null,
      });
    } catch (e: any) {
      if (!this._isMounted) return;
      this.setState({
        error: `Failed to fetch initial filters: ${e.message}`,
        loadingFilters: false,
      });
    }
  };

  private async flDistinctFromLayer(
    layer: __esri.FeatureLayer,
    fieldName: string,
    where: string,
  ): Promise<string[]> {
    try {
      const q = layer.createQuery();
      q.where = where || "1=1";
      q.outFields = [fieldName];
      q.returnDistinctValues = true;
      q.orderByFields = [`${fieldName} ASC`];
      q.returnGeometry = false;

      const res = await layer.queryFeatures(q);
      const vals = (res.features ?? [])
        .map((f) => f.attributes?.[fieldName])
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map((v) => String(v));

      if (fieldName.toLowerCase() === "yil") {
        return Array.from(new Set(vals)).sort((a, b) => Number(a) - Number(b));
      }
      return Array.from(new Set(vals)).sort();
    } catch (e) {

      return [];
    }
  }

  /**
   * Stores viloyat→region / tuman→district / turi→crop_id from Agri_table_data
   * via grouped DISTINCT queries (not a 50k-row attribute dump).
   */
  private fetchAndStoreRegionDistrictMappings = async (): Promise<void> => {
    const viloyatToRegion: Record<string, number> = {};
    const tumanToDistrict: Record<string, number> = {};
    const turiToCropId: Record<string, string> = {};

    try {
      const [regionDistrictRows, turiCropRows] = await Promise.all([
        queryAgriRegionDistrictMappings(),
        queryAgriTuriCropMappings(),
      ]);

      for (const row of regionDistrictRows) {
        const vilKey = this.makeRegionDistrictKey(row.viloyat);
        const tumanKey = this.makeRegionDistrictKey(row.tuman);
        if (vilKey && Number.isFinite(row.region)) {
          viloyatToRegion[vilKey] = row.region;
        }
        if (tumanKey && Number.isFinite(row.district)) {
          tumanToDistrict[tumanKey] = row.district;
        }
      }

      for (const row of turiCropRows) {
        const key = this.makeRegionDistrictKey(row.turi);
        if (key && row.cropId) turiToCropId[key] = row.cropId;
      }

      this._viloyatToRegion = viloyatToRegion;
      this._tumanToDistrict = tumanToDistrict;
      this._turiToCropId = turiToCropId;
    } catch (e) {
      AgriLocalization.agriLog("regionDistrictMap:FAILED", {
        error: String((e as any)?.message || e),
      });
    }
  };

  /**
   * Ensure we have region/district codes for the currently selected viloyat/tuman by
   * querying the polygon layer first. This runs when the user changes viloyat/tuman so
   * converter functions always have up-to-date codes.
   */
  private ensureRegionDistrictForSelection = async (): Promise<void> => {
    const layers = this.state.featureLayers?.length
      ? this.state.featureLayers
      : this.state.featureLayer
        ? [this.state.featureLayer]
        : [];
    if (!layers.length) return;

    const vRaw = (
      this.state.viloyat ||
      this.state.lockedViloyat ||
      ""
    ).toString();
    const tRaw = (this.state.tuman || "").toString();
    const vKey = this.makeRegionDistrictKey(vRaw);
    const tKey = this.makeRegionDistrictKey(tRaw);

    const needsViloyat = !!vKey && this._viloyatToRegion[vKey] == null;
    const needsTuman = !!tKey && this._tumanToDistrict[tKey] == null;
    if (!needsViloyat && !needsTuman) return;

    const vilClause = needsViloyat ? this.eqAposSmart("viloyat", vRaw) : "";
    const tumanClause = needsTuman ? this.eqAposSmart("tuman", tRaw) : "";
    const whereParts: string[] = [];
    if (vilClause) whereParts.push(`(${vilClause})`);
    if (tumanClause) whereParts.push(`(${tumanClause})`);
    if (!whereParts.length) return;

    try {
      const where = whereParts.join(" OR ");
      let featureCount = 0;
      for (const layer of layers) {
        const q = layer.createQuery();
        (q as any).where = where;
        (q as any).outFields = ["viloyat", "region", "tuman", "district"];
        (q as any).returnGeometry = false;
        (q as any).num = 100;

        const res = await layer.queryFeatures(q);
        const features = res?.features ?? [];
        featureCount += features.length;

        for (const f of features) {
          const a = (f.attributes || {}) as Record<string, unknown>;
          const v = this.makeRegionDistrictKey(
            a?.viloyat != null && a.viloyat !== "" ? String(a.viloyat) : null,
          );
          const r =
            a?.region != null && a.region !== "" ? Number(a.region) : NaN;
          const t = this.makeRegionDistrictKey(
            a?.tuman != null && a.tuman !== "" ? String(a.tuman) : null,
          );
          const d =
            a?.district != null && a.district !== "" ? Number(a.district) : NaN;

          if (v && Number.isFinite(r)) {
            this._viloyatToRegion[v] = r;
          }
          if (t && Number.isFinite(d)) {
            this._tumanToDistrict[t] = d;
          }
        }
      }
    } catch (e) {}
  };

  /**
   * Ensure we have a crop_id for the currently selected turi (crop type) by
   * querying the polygon layer if it wasn't already found in the initial
   * broad scan (fetchAndStoreRegionDistrictMappings, which only samples
   * whatever's in this.state.featureLayers at connect time — a crop that
   * only appears in a viloyat/tuman outside that initial sample would
   * otherwise never resolve). Mirrors ensureRegionDistrictForSelection().
   */
  private ensureCropIdForSelection = async (): Promise<void> => {
    const layers = this.state.featureLayers?.length
      ? this.state.featureLayers
      : this.state.featureLayer
        ? [this.state.featureLayer]
        : [];
    if (!layers.length) return;

    const missingTurlar = this.getSelectedTurlar().filter((turi) => {
      const key = this.makeRegionDistrictKey(turi);
      return key && this._turiToCropId[key] == null;
    });
    if (!missingTurlar.length) return;

    try {
      const where = this.buildTurlarClause("turi", missingTurlar);
      if (!where) return;

      for (const layer of layers) {
        const q = layer.createQuery();
        (q as any).where = where;
        (q as any).outFields = ["turi", "crop_id"];
        (q as any).returnGeometry = false;
        (q as any).num = Math.max(20, missingTurlar.length * 4);

        const res = await layer.queryFeatures(q);
        for (const feature of res?.features ?? []) {
          const attributes = (feature.attributes || {}) as Record<string, unknown>;
          const key = this.makeRegionDistrictKey(
            attributes?.turi != null && attributes.turi !== ""
              ? String(attributes.turi)
              : null,
          );
          const cropId =
            attributes?.crop_id != null && attributes.crop_id !== ""
              ? String(attributes.crop_id)
              : "";
          if (key && cropId) this._turiToCropId[key] = cropId;
        }

        const unresolved = missingTurlar.some((turi) => {
          const key = this.makeRegionDistrictKey(turi);
          return key && this._turiToCropId[key] == null;
        });
        if (!unresolved) break;
      }
    } catch (e) {}
  };

  /* ---------------------- UI Handlers ---------------------- */

  private resolveThemeState = (): boolean => {
    try {
      const savedTheme = localStorage.getItem("agri_v11_app_theme");
      if (savedTheme === "dark" || savedTheme === "light") {
        return savedTheme === "dark";
      }
    } catch {
      // ignore storage read errors
    }

    const root = document.documentElement;
    const body = document.body;
    const attr = String(root.getAttribute("data-theme") || "")
      .trim()
      .toLowerCase();
    if (attr === "dark") return true;
    if (attr === "light") return false;

    const rootClass = (root.className || "").toLowerCase();
    const bodyClass = (body.className || "").toLowerCase();
    if (
      /\bdark-theme\b|\btheme-dark\b|\bdark\b/.test(rootClass) ||
      /\bdark-theme\b|\btheme-dark\b|\bdark\b/.test(bodyClass)
    ) {
      return true;
    }
    if (
      /\blight-theme\b|\btheme-light\b|\blight\b/.test(rootClass) ||
      /\blight-theme\b|\btheme-light\b|\blight\b/.test(bodyClass)
    ) {
      return false;
    }

    return true;
  };

  private initializeTheme = () => {
    const isDarkTheme = this.resolveThemeState();
    this.setState({ isDarkTheme });
    try {
      localStorage.setItem(
        "agri_v11_app_theme",
        isDarkTheme ? "dark" : "light",
      );
    } catch {
      // ignore storage access errors
    }
    this.applyThemeToDom(isDarkTheme);
    document.dispatchEvent(
      new CustomEvent("agriV11ThemeToggled", {
        detail: { isDarkTheme, theme: isDarkTheme ? "dark" : "light" },
        bubbles: true,
      }),
    );
  };

  private applyThemeToDom = (isDarkTheme: boolean): void => {
    const root = document.documentElement;
    const body = document.body;
    const theme = isDarkTheme ? "dark" : "light";

    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark-theme", isDarkTheme);
    body.classList.toggle("dark-theme", isDarkTheme);
    root.classList.toggle("light-theme", !isDarkTheme);
    body.classList.toggle("light-theme", !isDarkTheme);

    // Keep page background in sync with theme (same as LocalizationWidgetV20)
    applyAppBackgroundTheme(theme);
  };

  private handleThemeChange = (event: any) => {
    if (!this._isMounted) return;
    const value = String(event?.target?.value || "light");
    const isDarkTheme = value === "dark";

    this.setState({ isDarkTheme }, () => {
      try {
        localStorage.setItem("agri_v11_app_theme", isDarkTheme ? "dark" : "light");
      } catch {
        // ignore storage errors
      }

      this.applyThemeToDom(isDarkTheme);

      document.dispatchEvent(
        new CustomEvent("agriV11ThemeToggled", {
          detail: { isDarkTheme, theme: isDarkTheme ? "dark" : "light" },
          bubbles: true,
        }),
      );
    });
  };

  private handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const inToolbar =
      !!target.closest(".agri-v20-toolbar-group") ||
      !!target.closest(".agri-v20-floating-overlay");
    const inSearch =
      !!target.closest(".agri-v20-graff-search-wrap") ||
      !!target.closest(".agri-v20-graff-search-dropdown-floating");

    if (!inToolbar && this.state.openToolbarMenu) {
      this.setState({ openToolbarMenu: null, selectedIndexInfoKey: null });
    }

    if (!inSearch && this.state.graffSearchShowSuggestions) {
      this.setState({ graffSearchShowSuggestions: false });
    }

    const inProfile =
      !!target.closest(".agri-v20-profile-wrapper") ||
      !!target.closest(".agri-v20-profile-dropdown");
    if (!inProfile && this.state.showProfileMenu) {
      this.setState({ showProfileMenu: false });
    }
  };

  private toggleToolbarMenu = (
    menu: "yil" | "language" | "indexInfo",
  ): void => {
    this.setState((prev) => ({
      openToolbarMenu: prev.openToolbarMenu === menu ? null : menu,
      // Always return to the index list (not a stale detail page) whenever
      // the indexInfo menu is (re)opened or closed.
      selectedIndexInfoKey: null as string | null,
    }));
  };

  private openIndexInfoDetail = (key: string): void => {
    this.setState({ selectedIndexInfoKey: key });
  };

  /** "×" / backdrop click — dismiss the indexInfo popover entirely. */
  private closeIndexInfoMenu = (): void => {
    this.setState({ openToolbarMenu: null, selectedIndexInfoKey: null });
  };

  private toggleProfileMenu = (): void => {
    this.setState((prev) => ({ showProfileMenu: !prev.showProfileMenu }));
  };

  private handleLogout = (): void => {
    this.setState({ showProfileMenu: false });
    void logoutFromAccount();
  };

  private handleYilChange = (event: any) => {
    if (!this._isMounted) return;

    const selectedYil = this.normalizeApos(event?.target?.value ?? "");

    // Auto‑select latest NDVI date so bar/Graff use fresh data without manual date pick
    const { ndviDateOptions } = this.state;
    const autoNdviDate =
      Array.isArray(ndviDateOptions) && ndviDateOptions.length
        ? ndviDateOptions[ndviDateOptions.length - 1]
        : "";

    this.setState(
      {
        yil: selectedYil,

        // reset full hierarchy when year changes
        viloyat: "",
        tuman: "",
        turi: "",
        turlar: [],
        vh: "",
        ndviDate: autoNdviDate,

        loading: true,
      },
      async () => {
        try {
          const w: any = typeof window !== "undefined" ? (window as any) : null;
          if (w)
            w.__AGRI3_DEBUG_YEAR__ = /\b2024\b/.test(selectedYil)
              ? "2024"
              : "";
        } catch {
          /* ignore */
        }
        try {
          await this.applyMapFiltersOptimized({ mode: "home", reason: "year" });
          await this.fetchDataWithCurrentState();
          this.broadcastFilterState();
        } catch (e: any) {
          if (this._isMounted)
            this.setState({ error: e.message, loading: false });
        }
      },
    );
  };

  private applyLanguage = (lang: FilterState["language"]) => {
    if (!this._isMounted) return;
    if (!lang || lang === this.state.language) return;

    this.setState({ language: lang, openToolbarMenu: null }, () => {
      try {
        localStorage.setItem("app_lang", lang);
        localStorage.setItem("evapo_app_lang", lang);
      } catch {
        /* ignore storage errors */
      }

      document.dispatchEvent(
        new CustomEvent("languageChanged", {
          detail: {
            lang,
            language: lang,
            code: lang,
            source: "AgriLocalization",
            timestamp: Date.now(),
          },
          bubbles: true,
        }),
      );

      this.broadcastFilterState();
    });
  };

  private applyYil = (selectedYil: string) => {
    if (!this._isMounted) return;

    const nextYil = this.normalizeApos(selectedYil ?? "");
    if (!nextYil || nextYil === this.state.yil) {
      this.setState({ openToolbarMenu: null });
      return;
    }

    const { ndviDateOptions } = this.state;
    const autoNdviDate =
      Array.isArray(ndviDateOptions) && ndviDateOptions.length
        ? ndviDateOptions[ndviDateOptions.length - 1]
        : "";

    this.setState(
      {
        yil: nextYil,
        viloyat: "",
        tuman: "",
        turi: "",
        turlar: [],
        vh: "",
        ndviDate: autoNdviDate,
        loading: true,
        openToolbarMenu: null,
      },
      async () => {
        try {
          await this.applyMapFiltersOptimized({ mode: "home", reason: "year" });
          await this.fetchDataWithCurrentState();
          this.broadcastFilterState();
        } catch (e: any) {
          if (this._isMounted)
            this.setState({ error: e.message, loading: false });
        }
      },
    );
  };

  private applyThemeByValue = (value: "light" | "dark") => {
    if (!this._isMounted) return;
    const isDarkTheme = value === "dark";

    this.setState({ isDarkTheme, openToolbarMenu: null }, () => {
      try {
        localStorage.setItem("agri_v11_app_theme", isDarkTheme ? "dark" : "light");
      } catch {
        // ignore storage errors
      }

      this.applyThemeToDom(isDarkTheme);

      document.dispatchEvent(
        new CustomEvent("agriV11ThemeToggled", {
          detail: { isDarkTheme, theme: isDarkTheme ? "dark" : "light" },
          bubbles: true,
        }),
      );
    });
  };

  private emitGraffTableSearchChanged = (
    query: string,
    options?: { preserveSelection?: boolean },
  ) => {
    document.dispatchEvent(
      new CustomEvent("agriGraff4TableSearchChanged", {
        detail: {
          source: "AgriLocalization",
          query: String(query || "").trim(),
          isFullSelection: false,
          preserveSelection: Boolean(options?.preserveSelection),
          timestamp: Date.now(),
        },
        bubbles: true,
      }),
    );
  };

  private emitGraffTableSearchClear = (options?: {
    preserveSelection?: boolean;
  }) => {
    this.emitGraffTableSearchChanged("", options);
  };

  private emitGraffTableRowSelected = (record: GraffSearchRecord) => {
    document.dispatchEvent(
      new CustomEvent("agriGraff4TableRowSelected", {
        detail: {
          source: "AgriLocalization",
          record,
          timestamp: Date.now(),
        },
        bubbles: true,
      }),
    );
  };

  private getGraffDisplayFields = (): string[] => {
    // Search modal: INN (STIR) + fermer name
    return ["f_inn", "f_name"];
  };

  private buildGraffSearchTextWhere = (
    raw: string,
    layer?: __esri.FeatureLayer,
  ): string => {
    const term = (raw || "").trim();
    if (!term) return "1=0";

    const fl = layer ?? this.state.featureLayer;
    const innField = fl
      ? this.findLayerFieldName(fl, "f_inn") || "f_inn"
      : "f_inn";
    const farmerField = fl
      ? this.findLayerFieldName(fl, "f_name") || "f_name"
      : "f_name";
    const escaped = this.escapeArcGIS(term);

    const innLike = `UPPER(${innField}) LIKE UPPER('%${escaped}%')`;
    const farmerLike = `UPPER(${farmerField}) LIKE UPPER('%${escaped}%')`;

    return `(${innLike} OR ${farmerLike})`;
  };

  /**
   * Graff search modal must work only after viloyat is selected.
   * Scope is yil + viloyat (+ tuman when set) — no VH/crop/polygon filters.
   */
  private buildGraffSearchScopeWhere = (): string => {
    const { yil, tuman } = this.state;
    if (!yil) return "1=0";

    const clauses: string[] = [];
    const yDigits =
      String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0] ??
      String(yil).replace(/[^\d]/g, "");
    clauses.push(
      yDigits
        ? `yil LIKE '${this.escapeArcGIS(yDigits)}%'`
        : `yil LIKE '%${this.escapeArcGIS(String(yil))}%'`,
    );

    const viloyatClause = this.buildViloyatRegionClause();
    if (!viloyatClause) return "1=0";
    clauses.push(viloyatClause);

    if (tuman) {
      const tumanClause = this.buildTumanDistrictClause();
      if (tumanClause) clauses.push(tumanClause);
    }

    return clauses.join(" AND ");
  };

  private getGraffSearchFieldLabel = (
    fieldName: string,
    language: FilterState["language"],
  ): string => {
    const lower = fieldName.toLowerCase();
    if (lower === "f_inn")
      return language === "en"
        ? "TIN"
        : language === "ru"
          ? "ИНН"
          : language === "uz_lat"
            ? "STIR"
            : "СТИР";
    if (lower === "uniqueid")
      return language === "en"
        ? "TIN"
        : language === "ru"
          ? "ИНН"
          : language === "uz_lat"
            ? "STIR"
            : "СТИР";
    if (lower === "tuman")
      return language === "en" ? "District" : language === "ru" ? "Район" : language === "uz_lat" ? "Tuman" : "Туман";
    if (lower === "f_name")
      return language === "en"
        ? "Farmer name"
        : language === "ru"
        ? "Название фермера"
        : language === "uz_lat"
          ? "Fermer nomi"
          : "Фермер номи";
    if (lower === "maydon")
      return language === "en"
        ? "Area"
        : language === "ru"
        ? "Площадь"
        : language === "uz_lat"
          ? "Maydon"
          : "Майдон";
    if (lower === "turi" || lower === "uzspace")
      return language === "en"
        ? "Crop type"
        : language === "ru"
        ? "Тип посева"
        : language === "uz_lat"
          ? "Ekin turi"
          : "Экин тури";
    if (lower === "vh") return language === "en" ? "VS" : language === "uz_lat" ? "VH" : "ВХ";
    return fieldName;
  };

  private formatGraffSearchCellValue = (
    fieldName: string,
    rawValue: unknown,
  ): string => {
    if (rawValue == null || rawValue === "") return "—";
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return fieldName.toLowerCase() === "maydon"
        ? rawValue.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[\u00a0\u202f]/g, " ").replace(/,/g, ".")
        : String(rawValue);
    }
    return String(rawValue);
  };

  private runGraffAutoComplete = async (term: string) => {
    if (!this._isMounted) return;

    const trimmed = term.trim();
    if (!trimmed) {
      this.setState({
        graffSearchSuggestions: [],
        graffSearchShowSuggestions: false,
        graffSearchLoading: false,
      });
      return;
    }

    let fl = this.state.featureLayer;
    if (!fl) {
      try {
        const { layer } = await getAgriTableDataLayer();
        fl = layer;
      } catch (err) {
        AgriLocalization.agriLog("graffSearch:layer-unavailable", {
          error: String((err as any)?.message || err),
        });
        this.setState({
          graffSearchSuggestions: [],
          graffSearchShowSuggestions: true,
          graffSearchLoading: false,
        });
        return;
      }
    }

    try {
      const displayFields = this.getGraffDisplayFields();
      const scopeWhere = this.buildGraffSearchScopeWhere();
      const searchWhere = this.buildGraffSearchTextWhere(trimmed, fl);
      const q = fl.createQuery();
      const uidField =
        this.findLayerFieldName(fl, "uniqueid") || "uniqueid";
      const innField = this.findLayerFieldName(fl, "f_inn") || "f_inn";
      const farmerField = this.findLayerFieldName(fl, "f_name") || "f_name";
      const viloyatField =
        this.findLayerFieldName(fl, "viloyat") || "viloyat";
      const tumanField = this.findLayerFieldName(fl, "tuman") || "tuman";
      q.outFields = Array.from(
        new Set([
          ...displayFields,
          "objectid",
          uidField,
          innField,
          farmerField,
          viloyatField,
          tumanField,
        ]),
      );
      q.returnGeometry = false;
      q.num = 50;
      q.orderByFields = [`${innField} ASC`, `${farmerField} ASC`];
      q.where =
        scopeWhere && scopeWhere !== "1=1"
          ? `(${scopeWhere}) AND (${searchWhere})`
          : searchWhere;

      AgriLocalization.agriLog("graffSearch:query", {
        term: trimmed,
        where: q.where,
      });

      const fs = await fl.queryFeatures(q);
      const results: GraffSearchRecord[] = (fs?.features || [])
        .slice(0, 50)
        .map((feat) => {
          const attrs = { ...(feat.attributes || {}) } as GraffSearchRecord;
          if (!attrs.uniqueid && attrs[uidField] != null) {
            attrs.uniqueid = String(attrs[uidField]);
          }
          if (!attrs.f_inn && attrs[innField] != null) {
            attrs.f_inn = String(attrs[innField]);
          }
          if (!attrs.f_name && attrs[farmerField] != null) {
            attrs.f_name = String(attrs[farmerField]);
          }
          return attrs;
        })
        .filter((record) => record.f_inn || record.f_name);

      AgriLocalization.agriLog("graffSearch:results", {
        count: results.length,
      });

      if (this._isMounted) {
        this.setState({
          graffSearchSuggestions: results,
          graffSearchShowSuggestions: true,
          graffSearchLoading: false,
        });
      }
    } catch (err) {
      AgriLocalization.agriLog("graffSearch:failed", {
        error: String((err as any)?.message || err),
      });
      if (this._isMounted) {
        this.setState({
          graffSearchSuggestions: [],
          graffSearchShowSuggestions: true,
          graffSearchLoading: false,
        });
      }
    }
  };

  private handleGraffSearchInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const nextValue = String(event?.target?.value ?? "");
    const trimmed = nextValue.trim();

    this.setState({ graffSearchText: nextValue });

    if (this._graffSearchDebounceTimer) {
      clearTimeout(this._graffSearchDebounceTimer);
    }

    if (!trimmed) {
      this.setState({
        graffSearchSuggestions: [],
        graffSearchShowSuggestions: false,
        graffSearchLoading: false,
      });
      this.emitGraffTableSearchClear();
      return;
    }

    // Don't run search (and don't open modal) until viloyat is selected.
    const effectiveViloyat = this.getEffectiveViloyat();
    if (!effectiveViloyat) {
      this.setState({
        graffSearchSuggestions: [],
        graffSearchShowSuggestions: false,
        graffSearchLoading: false,
      });
      return;
    }

    this.setState({
      graffSearchShowSuggestions: true,
      graffSearchLoading: true,
    });

    this._graffSearchDebounceTimer = setTimeout(() => {
      this.emitGraffTableSearchChanged(trimmed);
      this.runGraffAutoComplete(trimmed);
    }, 300);
  };

  private handleGraffSearchClear = () => {
    if (this._graffSearchDebounceTimer) {
      clearTimeout(this._graffSearchDebounceTimer);
      this._graffSearchDebounceTimer = null;
    }

    this.setState({
      graffSearchText: "",
      graffSearchSuggestions: [],
      graffSearchShowSuggestions: false,
      graffSearchLoading: false,
    });
    this.emitGraffTableSearchClear();
  };

  private handleGraffSearchRowClick = (record: GraffSearchRecord) => {
    const label =
      String(record.f_inn || record.f_name || "").trim();

    this.setState({
      graffSearchText: label,
      graffSearchSuggestions: [],
      graffSearchShowSuggestions: false,
      graffSearchLoading: false,
    });

    this.emitGraffTableRowSelected(record);
  };

  private renderGraffSearchDropdownFloating = () => {
    const {
      graffSearchShowSuggestions,
      graffSearchSuggestions,
      graffSearchLoading,
      graffSearchText,
      language,
    } = this.state;

    if (!graffSearchShowSuggestions || !String(graffSearchText || "").trim()) {
      return null;
    }

    const anchor = this._graffSearchWrapRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const noDataLabel =
      language === "en"
        ? "No data found"
        : language === "ru"
        ? "Данные не найдены"
        : language === "uz_lat"
          ? "Ma'lumot topilmadi"
          : "Маълумот топилмади";
    const loadingLabel =
      language === "en"
        ? "Searching..."
        : language === "ru"
        ? "Поиск..."
        : language === "uz_lat"
          ? "Qidirilmoqda..."
          : "Қидирилмоқда...";

    // Never wider than the search field itself.
    const dropW = Math.max(0, Math.round(rect.width));
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - dropW - 8),
    );

    return ReactDOM.createPortal(
      <ul
        className="agri-v20-graff-search-dropdown agri-v20-graff-search-dropdown-floating agri-v20-floating-overlay agri-v20-graff-search-suggestions"
        role="listbox"
        style={{
          position: "fixed",
          top: rect.bottom + 8,
          left,
          width: dropW,
          maxWidth: dropW,
          zIndex: 2147483000,
        }}
      >
        {graffSearchLoading ? (
          <li
            className="agri-v20-graff-search-suggestion agri-v20-graff-search-suggestion--status"
            role="presentation"
          >
            {loadingLabel}
          </li>
        ) : graffSearchSuggestions.length === 0 ? (
          <li
            className="agri-v20-graff-search-suggestion agri-v20-graff-search-suggestion--status"
            role="presentation"
          >
            {noDataLabel}
          </li>
        ) : (
          graffSearchSuggestions.map((record, idx) => {
            const inn = String(record.f_inn || "").trim();
            const name = String(record.f_name || "").trim();
            const primaryLabel = inn || name || "—";
            const secondaryName =
              inn && name && name !== inn ? name : null;
            const regionParts = [
              String(record.viloyat || record.region || "").trim(),
              String(record.tuman || record.district || "").trim(),
            ].filter(Boolean);
            const geoLabel = regionParts.join(" · ");
            const rowKey = String(
              record.f_inn || record.uniqueid || record.objectid || idx,
            );
            const selectLabel =
              language === "en"
                ? "Select row"
                : language === "ru"
                ? "Выбрать строку"
                : language === "uz_lat"
                  ? "Qatorni tanlash"
                  : "Қаторни танлаш";

            return (
              <li key={rowKey} role="presentation">
                <button
                  type="button"
                  role="option"
                  className="agri-v20-graff-search-suggestion"
                  title={selectLabel}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => this.handleGraffSearchRowClick(record)}
                >
                  <span className="agri-v20-graff-search-suggestion-main">
                    <span className="agri-v20-graff-search-suggestion-inn">
                      {primaryLabel}
                    </span>
                    {secondaryName ? (
                      <span className="agri-v20-graff-search-suggestion-name">
                        {secondaryName}
                      </span>
                    ) : null}
                  </span>
                  {geoLabel ? (
                    <span className="agri-v20-graff-search-suggestion-region">
                      {geoLabel}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>,
      document.body,
    );
  };

  private renderLanguageMenuFloating = () => {
    if (this.state.openToolbarMenu !== "language") return null;

    const anchor = this._languageToolbarItemRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const { language } = this.state;

    const options: Array<{
      value: FilterState["language"];
      shortLabel: string;
      fullLabel: string;
    }> = [
      { value: "uz_lat", shortLabel: "O'zbek", fullLabel: "O'zbek" },
      { value: "uz_cyr", shortLabel: "Ўзбек", fullLabel: "Ўзбек" },
      { value: "ru", shortLabel: "Русский", fullLabel: "Русский" },
      { value: "en", shortLabel: "English", fullLabel: "English" },
    ];

    return ReactDOM.createPortal(
      <div
        className="agri-v20-toolbar-popover agri-v20-toolbar-popover-floating agri-v20-floating-overlay agri-v20-compact-popover"
        style={{
          position: "fixed",
          top: rect.bottom + 10,
          right: Math.max(12, window.innerWidth - rect.right),
          minWidth: 168,
          zIndex: 2147483001,
        }}
      >
        <div className="agri-v20-language-menu agri-v20-option-menu agri-v20-compact-option-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`agri-v20-language-option agri-v20-compact-option-item ${language === opt.value ? "is-active" : ""}`}
              onClick={() => this.applyLanguage(opt.value)}
              title={opt.fullLabel}
            >
              {opt.shortLabel}
            </button>
          ))}
        </div>
      </div>,
      document.body,
    );
  };

  private static readonly INDEX_INFO: Array<{
    key: string;
    color: string;
    ru: string;
    uz_lat: string;
    uz_cyr: string;
    en?: string;
    formula: string;
    range: { ru: string; uz_lat: string; uz_cyr: string; en?: string };
    details: { ru: string; uz_lat: string; uz_cyr: string; en?: string };
  }> = [
    {
      key: "NDVI",
      color: "#00d084",
      en: "Vegetation index showing plant density and health.",
      ru: "Индекс вегетации — показывает густоту и здоровье растительности.",
      uz_lat: "Vegetatsiya indeksi — o‘simliklarning zichligi va sog‘lig‘ini ko‘rsatadi.",
      uz_cyr: "Вegetatsiya индекси — ўсимликларнинг зичлиги ва соғлигини кўрсатади.",
      formula: "NDVI = (NIR − Red) / (NIR + Red)",
      range: {
        en: "From -1 to 1. Bare soil: 0-0.2; sparse vegetation: 0.2-0.4; healthy dense crops: 0.4-0.9.",
        ru: "От −1 до 1. Голая почва: 0–0.2. Разреженная растительность: 0.2–0.4. Здоровые густые посевы: 0.4–0.9. Вода и облака чаще всего дают отрицательные значения.",
        uz_lat: "−1 dan 1 gacha. Ochiq tuproq: 0–0.2. Siyrak o‘simlik: 0.2–0.4. Sog‘lom, zich ekin: 0.4–0.9. Suv va bulutlar odatda manfiy qiymat beradi.",
        uz_cyr: "−1 дан 1 гача. Очиқ тупроқ: 0–0.2. Сийрак ўсимлик: 0.2–0.4. Соғлом, зич экин: 0.4–0.9. Сув ва булутлар одатда манфий қиймат беради.",
      },
      details: {
        en: "Measures near-infrared reflection and red-light absorption to monitor crop health, biomass, drought, and plant stress. It can saturate in very dense vegetation and is sensitive to exposed soil early in the season.",
        ru: "Показывает контраст между сильным отражением здоровой листвы в ближнем инфракрасном (NIR) диапазоне и поглощением хлорофиллом в красном (Red) диапазоне. Применяется для мониторинга состояния посевов, оценки биомассы, раннего выявления засухи и стресса растений, а также для сравнения полей по сезонам. Ограничение: индекс насыщается (перестаёт расти) при очень густом растительном покрове и чувствителен к цвету и влажности открытой почвы на ранних стадиях роста.",
        uz_lat: "Sog‘lom bargning yaqin infraqizil (NIR) diapazonda kuchli qaytarilishi va xlorofillning qizil (Red) diapazonda yutilishi orasidagi farqni ko‘rsatadi. Ekinlar holatini kuzatish, biomassani baholash, qurg‘oqchilik va o‘simlik stressini erta aniqlash, shuningdek dalalarni mavsumlar bo‘yicha solishtirish uchun qo‘llaniladi. Cheklovi: juda zich o‘simlik qoplamida indeks to‘yinadi (o‘sishdan to‘xtaydi) va o‘sish boshida ochiq tuproq rangi hamda namligiga sezgir bo‘ladi.",
        uz_cyr: "Соғлом баргнинг яқин инфрақизил (NIR) диапазонда кучли қайтарилиши ва хлорофиллнинг қизил (Red) диапазонда ютилиши орасидаги фарқни кўрсатади. Экинлар ҳолатини кузатиш, биомассани баҳолаш, қурғоқчилик ва ўсимлик стрессини эрта аниқлаш, шунингдек далаларни мавсумлар бўйича солиштириш учун қўлланилади. Чекловi: жуда зич ўсимлик қопламида индекс тўйинади (ўсишдан тўхтайди) ва ўсиш бошида очиқ тупроқ ранги ҳамда намлигига сезгир бўлади.",
      },
    },
    {
      key: "SAVI",
      color: "#7aa5ff",
      en: "Soil-adjusted NDVI that is more accurate for sparse vegetation.",
      ru: "NDVI с поправкой на яркость почвы — точнее при редкой растительности.",
      uz_lat: "Tuproq yorqinligiga tuzatilgan NDVI — siyrak o‘simlikda aniqroq.",
      uz_cyr: "Тупроқ ёрқинлигига тузатилган NDVI — сийрак ўсимликда аниқроқ.",
      formula: "SAVI = [(NIR − Red) / (NIR + Red + L)] × (1 + L), L ≈ 0.5",
      range: {
        en: "Close to -1 to 1 and most useful when vegetation cover is below 40%.",
        ru: "Диапазон близок к NDVI (−1…1), но значения обычно немного ниже за счёт поправочного коэффициента L. Наиболее полезен при покрытии растительностью менее 40%.",
        uz_lat: "Diapazon NDVI ga yaqin (−1…1), lekin L koeffitsiyenti tufayli qiymatlar odatda biroz past bo‘ladi. O‘simlik qoplami 40% dan kam bo‘lganda eng foydali.",
        uz_cyr: "Диапазон NDVI га яқин (−1…1), лекин L коэффициенти туфайли қийматлар одатда бироз паст бўлади. Ўсимлик қоплами 40% дан кам бўлганда энг фойдали.",
      },
      details: {
        en: "Reduces the effect of exposed-soil brightness in sparsely covered fields. The L factor controls the correction and improves early-season crop assessment when soil is visible between rows.",
        ru: "Устраняет влияние яркости открытой почвы, которое искажает NDVI на полях с редким растительным покровом — например, сразу после посева или в засушливых и полузасушливых регионах. Коэффициент L (обычно 0.5) регулирует степень поправки в зависимости от плотности покрова. Особенно полезен на ранних фазах развития хлопчатника, пшеницы и других культур, когда между рядами хорошо видна почва, и позволяет получить более достоверную оценку состояния именно растений, а не фона.",
        uz_lat: "Siyrak o‘simlik qoplamli dalalarda — masalan ekishdan keyin darhol yoki qurg‘oqchil va yarim qurg‘oqchil hududlarda — NDVI ni buzadigan ochiq tuproq yorqinligining ta’sirini kamaytiradi. L koeffitsiyenti (odatda 0.5) qoplam zichligiga qarab tuzatish darajasini boshqaradi. Ayniqsa paxta, bug‘doy va boshqa ekinlarning erta o‘sish fazalarida, qatorlar orasida tuproq yaxshi ko‘rinib turganda foydali bo‘lib, fon emas, aynan o‘simlik holatini aniqroq baholashga yordam beradi.",
        uz_cyr: "Сийрак ўсимлик қопламли далаларда — масалан экишдан кейин дарҳол ёки қурғоқчил ва ярим қурғоқчил ҳудудларда — NDVI ни бузадиган очиқ тупроқ ёрқинлигининг таъсирини камайтиради. L коэффициенти (одатда 0.5) қоплам зичлигига қараб тузатиш даражасини бошқаради. Айниқса пахта, буғдой ва бошқа экинларнинг эрта ўсиш фазаларида, қаторлар орасида тупроқ яхши кўриниб турганда фойдали бўлиб, фон эмас, айнан ўсимлик ҳолатини аниқроқ баҳолашга ёрдам беради.",
      },
    },
    {
      key: "RVI",
      color: "#ffb347",
      en: "Near-infrared to red-band ratio that is sensitive to biomass.",
      ru: "Отношение ближнего ИК к красному каналу — чувствителен к биомассе.",
      uz_lat: "Yaqin infraqizil va qizil kanal nisbati — biomassaga sezgir.",
      uz_cyr: "Яқин инфрақизил ва қизил канал нисбати — биомассага сезгир.",
      formula: "RVI (SR) = NIR / Red",
      range: {
        en: "From 0 upward. Bare soil is near 1; dense healthy vegetation is often above 5-8.",
        ru: "От 0 до бесконечности. Голая почва: около 1. Разреженная растительность: 1–3. Густая здоровая растительность: часто выше 5–8.",
        uz_lat: "0 dan cheksizlikkacha. Ochiq tuproq: taxminan 1. Siyrak o‘simlik: 1–3. Zich sog‘lom o‘simlik: ko‘pincha 5–8 dan yuqori.",
        uz_cyr: "0 дан чексизликкача. Очиқ тупроқ: тахминан 1. Сийрак ўсимлик: 1–3. Зич соғлом ўсимлик: кўпинча 5–8 дан юқори.",
      },
      details: {
        en: "Also known as Simple Ratio. It responds strongly to biomass changes where NDVI may saturate, but is more sensitive to atmospheric effects and soil noise.",
        ru: "Также известен как Simple Ratio (SR). Из-за нелинейной (не нормализованной) формулы сильнее реагирует на изменения биомассы и листового индекса (LAI) в посевах с высокой плотностью растительности, где NDVI уже насыщен — например, в развитом хлопчатнике, кукурузе или садах. Недостаток: сильнее подвержен влиянию атмосферных искажений и шума открытой почвы, чем нормализованные индексы, поэтому чаще используется как дополнение к NDVI, а не замена ему.",
        uz_lat: "Shuningdek Simple Ratio (SR) nomi bilan ham tanilgan. Chiziqli bo‘lmagan (normallashtirilmagan) formulasi tufayli, NDVI allaqachon to‘yingan yuqori zichlikdagi ekinlarda — masalan, rivojlangan paxta, makkajo‘xori yoki bog‘larda — biomassa va bargu indeksi (LAI) o‘zgarishlariga kuchliroq javob beradi. Kamchiligi: normallashtirilgan indekslarga qaraganda atmosfera buzilishlari va ochiq tuproq shovqiniga ko‘proq ta’sirlanadi, shuning uchun ko‘pincha NDVI ni almashtiruvchi emas, unga qo‘shimcha sifatida ishlatiladi.",
        uz_cyr: "Шунингдек Simple Ratio (SR) номи билан ҳам танилган. Чизиқли бўлмаган (нормаллаштирилмаган) формуласи туфайли, NDVI аллақачон тўйинган юқори зичликдаги экинларда — масалан, ривожланган пахта, маккажўхори ёки боғларда — биомасса ва баргу индекси (LAI) ўзгаришларига кучлироқ жавоб беради. Камчилиги: нормаллаштирилган индексларга қараганда атмосфера бузилишлари ва очиқ тупроқ шовқинига кўпроқ таъсирланади, шунинг учун кўпинча NDVI ни алмаштирувчи эмас, унга қўшимча сифатида ишлатилади.",
      },
    },
    {
      key: "CI",
      color: "#c78bff",
      en: "Chlorophyll index used to estimate leaf chlorophyll and nitrogen content.",
      ru: "Индекс хлорофилла — оценивает содержание хлорофилла/азота в листьях.",
      uz_lat: "Xlorofill indeksi — bargdagi xlorofill/azot miqdorini baholaydi.",
      uz_cyr: "Хлорофилл индекси — баргдаги хлорофилл/азот миқдорини баҳолайди.",
      formula: "CIgreen = (NIR / Green) − 1",
      range: {
        en: "Usually 0 to 15+. Low values can indicate weak vegetation or nitrogen deficiency.",
        ru: "Обычно от 0 до 15+. Низкие значения (0–2) указывают на слабую вегетацию или дефицит азота. Значения выше 4–5 характерны для хорошо удобренных, богатых хлорофиллом посевов.",
        uz_lat: "Odatda 0 dan 15+ gacha. Past qiymatlar (0–2) zaif vegetatsiya yoki azot yetishmovchiligini bildiradi. 4–5 dan yuqori qiymatlar yaxshi o‘g‘itlangan, xlorofillga boy ekinlarga xos.",
        uz_cyr: "Одатда 0 дан 15+ гача. Паст қийматлар (0–2) заиф вегетация ёки азот етишмовчилигини билдиради. 4–5 дан юқори қийматлар яхши ўғитланган, хлорофиллга бой экинларга хос.",
      },
      details: {
        en: "Estimates chlorophyll and indirectly nitrogen status. It can reveal nutrient deficiency and stress early, supporting timely fertilization. Green and Red Edge variants use different spectral bands.",
        ru: "В отличие от NDVI, напрямую нацелен на оценку концентрации хлорофилла и, косвенно, азота в листьях — важнейшего показателя питания растений. Это делает его ценным инструментом для точного земледелия: индекс способен выявлять дефицит азота и другие признаки стресса ещё до того, как они станут заметны визуально или отразятся на NDVI, что позволяет своевременно скорректировать программу подкормки. Используется как в «зелёной» (Green), так и в «красный край» (Red Edge) версиях, отличающихся спектральным каналом сравнения с NIR.",
        uz_lat: "NDVI dan farqli o‘laroq, to‘g‘ridan-to‘g‘ri bargdagi xlorofill konsentratsiyasini va bilvosita azotni — o‘simlik ozuqasining eng muhim ko‘rsatkichini — baholashga qaratilgan. Bu uni aniq dehqonchilik uchun qimmatli qurolga aylantiradi: indeks azot yetishmovchiligi va boshqa stress belgilarini ular ko‘zga tashlanishidan yoki NDVI da aks etishidan oldinroq aniqlay oladi, bu esa oziqlantirish dasturini o‘z vaqtida to‘g‘rilash imkonini beradi. «Yashil» (Green) va «qizil chekka» (Red Edge) versiyalarida qo‘llaniladi, ular NIR bilan solishtiriladigan spektral kanali bilan farqlanadi.",
        uz_cyr: "NDVI дан фарқли ўлароқ, тўғридан-тўғри баргдаги хлорофилл концентрациясини ва билвосита азотни — ўсимлик озуқасининг энг муҳим кўрсаткичини — баҳолашга қаратилган. Бу уни аниқ деҳқончилик учун қимматли қуролга айлантиради: индекс азот етишмовчилиги ва бошқа стресс белгиларини улар кўзга ташланишидан ёки NDVI да акс этишидан олдинроқ аниқлай олади, бу эса озиқлантириш дастурини ўз вақтида тўғрилаш имконини беради. «Яшил» (Green) ва «қизил чекка» (Red Edge) версияларида қўлланилади, улар NIR билан солиштириладиган спектрал канали билан фарқланади.",
      },
    },
    {
      key: "EVI",
      color: "#ff4d8d",
      en: "Enhanced vegetation index that performs better in dense vegetation.",
      ru: "Улучшенный индекс вегетации — точнее при густой растительности.",
      uz_lat: "Takomillashtirilgan vegetatsiya indeksi — zich o‘simlikda aniqroq.",
      uz_cyr: "Такомиллаштирилган вегетатsiya индекси — зич ўсимликда аниқроқ.",
      formula: "EVI = 2.5 × (NIR − Red) / (NIR + 6×Red − 7.5×Blue + 1)",
      range: {
        en: "From -1 to 1; values above 0.5-0.6 indicate very dense, productive vegetation.",
        ru: "От −1 до 1 (практически рабочий диапазон 0–1). Значения выше 0.5–0.6 указывают на очень плотную, высокопродуктивную растительность (сады, зрелый хлопчатник, лес).",
        uz_lat: "−1 dan 1 gacha (amalda ish diapazoni 0–1). 0.5–0.6 dan yuqori qiymatlar juda zich, yuqori mahsuldor o‘simlikni bildiradi (bog‘lar, yetilgan paxta, o‘rmon).",
        uz_cyr: "−1 дан 1 гача (амалда иш диапазони 0–1). 0.5–0.6 дан юқори қийматлар жуда зич, юқори маҳсулдор ўсимликни билдиради (боғлар, етилган пахта, ўрмон).",
      },
      details: {
        en: "Uses the blue band and correction coefficients to reduce atmospheric and soil effects. It saturates less quickly than NDVI in dense vegetation but requires well-corrected imagery.",
        ru: "Включает синий (Blue) канал для коррекции атмосферного рассеяния и влияния аэрозолей, а также использует коэффициенты (обычно G=2.5, C1=6, C2=7.5, L=1) для снижения влияния фона почвы. Главное преимущество — индекс не «насыщается» так быстро, как NDVI, в зонах с очень плотным растительным покровом (садах, зрелых посевах хлопчатника или кукурузы), сохраняя чувствительность к изменениям биомассы там, где NDVI уже перестаёт информативно расти. Требует более качественных, атмосферно скорректированных снимков из-за использования синего канала.",
        uz_lat: "Atmosfera sochilishi va aerozollar ta’sirini tuzatish uchun ko‘k (Blue) kanalni o‘z ichiga oladi, shuningdek tuproq foni ta’sirini kamaytirish uchun koeffitsiyentlardan (odatda G=2.5, C1=6, C2=7.5, L=1) foydalanadi. Asosiy afzalligi — juda zich o‘simlik qoplamli hududlarda (bog‘lar, yetilgan paxta yoki makkajo‘xori ekinlari) NDVI kabi tezda «to‘yinib qolmaydi», NDVI informativ o‘sishdan to‘xtagan joyda ham biomassa o‘zgarishlariga sezgirligini saqlaydi. Ko‘k kanaldan foydalanish tufayli sifatliroq, atmosfera bo‘yicha tuzatilgan tasvirlarni talab qiladi.",
        uz_cyr: "Атмосфера сочилиши ва аэрозоллар таъсирини тузатиш учун кўк (Blue) канални ўз ичига олади, шунингдек тупроқ фони таъсирини камайтириш учун коэффициентлардан (одатда G=2.5, C1=6, C2=7.5, L=1) фойдаланади. Асосий афзаллиги — жуда зич ўсимлик қопламли ҳудудларда (боғлар, етилган пахта ёки маккажўхори экинлари) NDVI каби тезда «тўйиниб қолмайди», NDVI информатив ўсишдан тўхтаган жойда ҳам биомасса ўзгаришларига сезгирлигини сақлайди. Кўк каналдан фойдаланиш туфайли сифатлироқ, атмосфера бўйича тузатилган тасвирларни талаб қилади.",
      },
    },
    {
      key: "NDWI",
      color: "#2ec4f1",
      en: "Moisture index showing water content in plants or soil.",
      ru: "Индекс влажности — показывает содержание влаги в растениях/почве.",
      uz_lat: "Namlik indeksi — o‘simlik/tuproqdagi namlik miqdorini ko‘rsatadi.",
      uz_cyr: "Намлик индекси — ўсимлик/тупроқдаги намлик миқдорини кўрсатади.",
      formula: "NDWI = (NIR − SWIR) / (NIR + SWIR)",
      range: {
        en: "From -1 to 1. Negative or near-zero values indicate dryness; values above 0.2-0.3 indicate good moisture.",
        ru: "От −1 до 1. Отрицательные и близкие к нулю значения — сухие растения/почва и признаки водного стресса. Значения выше 0.2–0.3 указывают на хорошее увлажнение тканей растения.",
        uz_lat: "−1 dan 1 gacha. Manfiy va nolga yaqin qiymatlar — quruq o‘simlik/tuproq va suv stressi belgilarini bildiradi. 0.2–0.3 dan yuqori qiymatlar o‘simlik to‘qimalarining yaxshi namlanganligini ko‘rsatadi.",
        uz_cyr: "−1 дан 1 гача. Манфий ва нолга яқин қийматлар — қуруқ ўсимлик/тупроқ ва сув стресси белгиларини билдиради. 0.2–0.3 дан юқори қийматлар ўсимлик тўқималарининг яхши намланганлигини кўрсатади.",
      },
      details: {
        en: "Green-NIR variants identify surface water, while NIR-SWIR variants estimate plant moisture. In agriculture it supports irrigation planning, drought detection, and irrigation-efficiency assessment.",
        ru: "Существуют две версии: на основе зелёного (Green) и NIR каналов — для выделения водных поверхностей на снимках, и на основе NIR и коротковолнового инфракрасного (SWIR) каналов — для оценки влагосодержания в тканях растений. В сельском хозяйстве чаще используется вторая версия — она чувствительна к дефициту воды в листьях ещё до появления видимых признаков увядания, что делает её полезной для планирования полива, раннего выявления засухи и оценки эффективности ирригационных систем на конкретных полях.",
        uz_lat: "Ikkita versiyasi mavjud: suv sathlarini tasvirlarda ajratib ko‘rsatish uchun yashil (Green) va NIR kanallariga asoslangan, va o‘simlik to‘qimalaridagi namlik miqdorini baholash uchun NIR va qisqa to‘lqinli infraqizil (SWIR) kanallariga asoslangan. Qishloq xo‘jaligida ko‘pincha ikkinchi versiya qo‘llaniladi — u barglarda suv tanqisligini ko‘zga ko‘rinadigan so‘lish belgilaridan oldinroq aniqlay oladi, bu esa uni sug‘orishni rejalashtirish, qurg‘oqchilikni erta aniqlash va aniq dalalarda irrigatsiya tizimlari samaradorligini baholash uchun foydali qiladi.",
        uz_cyr: "Иккита версияси мавжуд: сув сатҳларини тасвирларда ажратиб кўрсатиш учун яшил (Green) ва NIR канaлларига асосланган, ва ўсимлик тўқималаридаги намлик миқдорини баҳолаш учун NIR ва қисқа тўлқинли инфрақизил (SWIR) канaлларига асосланган. Қишлоқ хўжалигида кўпинча иккинчи версия қўлланилади — у баргларда сув танқислигини кўзга кўринадиган сўлиш белгиларидан олдинроқ аниқлай олади, бу эса уни суғоришни режалаштириш, қурғоқчиликни эрта аниқлаш ва аниқ далаларда ирригация тизимлари самарадорлигини баҳолаш учун фойдали қилади.",
      },
    },
  ];

  /** Full detail page for a single selected index — centered overlay, list hidden while open. */
  private renderIndexInfoDetailFloating = () => {
    const { selectedIndexInfoKey, language } = this.state;
    if (this.state.openToolbarMenu !== "indexInfo" || !selectedIndexInfoKey)
      return null;

    const item = AgriLocalization.INDEX_INFO.find(
      (i) => i.key === selectedIndexInfoKey,
    );
    if (!item) return null;

    const formulaLabel =
      language === "en" ? "Formula" : language === "ru" ? "Формула" : language === "uz_lat" ? "Formula" : "Формула";

    return ReactDOM.createPortal(
      <div
        className="agri-v20-index-info-backdrop agri-v20-floating-overlay"
        style={{ zIndex: 2147483002 }}
        onClick={this.closeIndexInfoMenu}
      >
        <div
          className="agri-v20-index-info-detail-card"
          role="dialog"
          aria-label={item.key}
          style={{ ["--index-accent" as any]: item.color }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="agri-v20-index-info-detail-header">
            <div className="agri-v20-index-info-detail-title-row">
              <span
                className="agri-v20-index-info-detail-icon"
                style={{ color: item.color }}
                aria-hidden="true"
              >
                <Sprout size={20} strokeWidth={2.2} />
              </span>
              <h2 className="agri-v20-index-info-detail-title">{item.key}</h2>
            </div>
            <button
              type="button"
              className="agri-v20-index-info-detail-close-btn"
              onClick={this.closeIndexInfoMenu}
              aria-label="Close"
            >
              <X size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>

          <p className="agri-v20-index-info-detail-summary">
            {language === "en" ? item.en || item.uz_lat : item[language]}
          </p>

          <div className="agri-v20-index-info-detail-block">
            <div className="agri-v20-index-info-detail-block-label">
              <FunctionSquare size={13} strokeWidth={2.2} aria-hidden="true" />
              {formulaLabel}
            </div>
            <code className="agri-v20-index-info-detail-formula">
              {item.formula}
            </code>
          </div>

          <div className="agri-v20-index-info-detail-block agri-v20-index-info-detail-block--last">
            <p className="agri-v20-index-info-detail-text">
              {language === "en" ? item.details.en || item.details.uz_lat : item.details[language]}
            </p>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  private renderIndexInfoMenuFloating = () => {
    if (this.state.openToolbarMenu !== "indexInfo") return null;
    if (this.state.selectedIndexInfoKey) {
      return this.renderIndexInfoDetailFloating();
    }

    const anchor = this._indexInfoToolbarItemRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const { language } = this.state;

    const headerLabel =
      language === "en"
        ? "About indices"
        : language === "ru"
          ? "Инфо про индексы"
        : language === "uz_lat"
          ? "Indekslar haqida"
          : "Индекслар ҳақида";

    return ReactDOM.createPortal(
      <div
        className="agri-v20-toolbar-popover agri-v20-toolbar-popover-floating agri-v20-floating-overlay agri-v20-index-info-popover"
        style={{
          position: "fixed",
          top: rect.bottom + 10,
          left: Math.max(12, rect.left),
          width: 300,
          maxWidth: "calc(100vw - 24px)",
          zIndex: 2147483001,
        }}
      >
        <div
          className="agri-v20-index-info-menu"
          role="menu"
          aria-label={headerLabel}
        >
          <div className="agri-v20-index-info-header">{headerLabel}</div>
          {AgriLocalization.INDEX_INFO.map((item) => (
            <div
              className={`agri-v20-index-info-row agri-v20-index-info-row--clickable agri-v20-index-info-row--${item.key.toLowerCase()}`}
              key={item.key}
              role="button"
              tabIndex={0}
              style={{ ["--index-accent" as any]: item.color }}
              onClick={() => this.openIndexInfoDetail(item.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  this.openIndexInfoDetail(item.key);
                }
              }}
            >
              <span
                className="agri-v20-index-info-dot"
                style={{ background: item.color }}
                aria-hidden="true"
              />
              <div className="agri-v20-index-info-text">
                <div className="agri-v20-index-info-name">{item.key}</div>
                <div className="agri-v20-index-info-desc">
                  {language === "en" ? item.en || item.uz_lat : item[language]}
                </div>
              </div>
              <span className="agri-v20-index-info-chevron" aria-hidden="true">
                <ChevronRight size={16} strokeWidth={2.2} />
              </span>
            </div>
          ))}
        </div>
      </div>,
      document.body,
    );
  };

  private renderYilMenuFloating = () => {
    if (this.state.openToolbarMenu !== "yil") return null;

    const anchor = this._yilToolbarItemRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const { yilOptions, yil, language } = this.state;

    const headerLabel =
      language === "en" ? "Year" : language === "ru" ? "Год" : language === "uz_lat" ? "Yil" : "Йил";

    return ReactDOM.createPortal(
      <div
        className="agri-v20-toolbar-popover agri-v20-toolbar-popover-floating agri-v20-floating-overlay agri-v20-yil-popover"
        style={{
          position: "fixed",
          top: rect.bottom + 10,
          left: Math.max(12, rect.left),
          minWidth: 156,
          zIndex: 2147483001,
        }}
      >
        <div
          className="agri-v20-option-menu agri-v20-yil-option-menu"
          role="menu"
          aria-label={headerLabel}
        >
          {yilOptions
            .map((opt) => String(opt).trim())
            .filter((value) => value.length > 0)
            .map((value) => {
              return (
                <button
                  key={value}
                  type="button"
                  className={`agri-v20-option-item agri-v20-yil-option-item ${yil === value ? "is-active" : ""}`}
                  onClick={() => this.applyYil(value)}
                >
                  {value}
                </button>
              );
            })}
        </div>
      </div>,
      document.body,
    );
  };

  private handleNdviDateChange = (event: any) => {
    if (!this._isMounted) return;

    const raw = event?.target?.value ?? "";
    const ndviDate = String(raw).trim();

    // When a polygon graph is active in Graff, ignore manual NDVI date changes.
    if ((this.state as any).polygonMode) {
      return;
    }

    this._ndviBucketToIds = {};
    this.setState(
      {
        ndviDate,
        vh: "",
        loading: true,
      },
      async () => {
        try {
          await this.applyMapFiltersOptimized({ mode: "selection", reason: "ndvi" });
          await this.fetchDataWithCurrentState();
          this.broadcastFilterState();
        } catch (e: any) {
          if (this._isMounted)
            this.setState({ error: e.message, loading: false });
        }
      },
    );
  };

  /* ---------------------- WHERE Clause Builder ---------------------- */

  private escapeArcGIS = (v: string) => v.replace(/'/g, "''");

  private formatLocalDateYmd = (dt: Date): string => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  private eqAposSmart(field: string, raw: string): string {
    if (!raw) return "";
    const s = this.normalizeApos(String(raw).trim());
    if (!/'/.test(s)) return `${field}='${this.escapeArcGIS(s)}'`;
    const base = s.replace(/'/g, "\uFFFF");
    const parts = AgriLocalization.APOSTROPHE_VARIANTS.map((ch) => {
      const candidate = base.split("\uFFFF").join(ch);
      return `${field}='${this.escapeArcGIS(candidate)}'`;
    });
    return `(${parts.join(" OR ")})`;
  }

  private normalizeTurlar = (raw: unknown, fallback = ""): string[] => {
    const source = Array.isArray(raw) ? raw : raw ? [raw] : fallback ? [fallback] : [];
    return Array.from(
      new Set(
        source
          .map((value) => this.normalizeApos(String(value || "")))
          .filter(Boolean),
      ),
    );
  };

  private getSelectedTurlar = (): string[] =>
    this.normalizeTurlar(this.state.turlar, this.state.turi || "");

  private getChartFilterFlags = (
    vh = String(this.state.vh || "").trim(),
    turlar = this.getSelectedTurlar(),
  ): ChartFilterFlags =>
    deriveChartFilterFlags(
      this._chartDimOrder,
      Boolean(vh),
      turlar.length > 0,
    );

  /** Keep first-selected-wins order for Pie ↔ VH chart scoping. */
  private syncChartDimOrder = (
    nextVh: string,
    nextTurlar: string[],
    resetGeography: boolean,
  ): void => {
    if (resetGeography) {
      this._chartDimOrder = [];
      clearPieVhFilterUniqueIds();
      return;
    }
    this._chartDimOrder = upsertChartDimOrder(
      this._chartDimOrder,
      "vh",
      Boolean(String(nextVh || "").trim()),
    );
    this._chartDimOrder = upsertChartDimOrder(
      this._chartDimOrder,
      "turi",
      nextTurlar.length > 0,
    );
  };

  private buildTurlarClause = (
    field = "turi",
    values: string[] = this.getSelectedTurlar(),
  ): string => {
    const clauses = values.map((value) => this.eqAposSmart(field, value)).filter(Boolean);
    if (!clauses.length) return "";
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  };

  private buildUniqueIdClause(raw: string, layer?: __esri.FeatureLayer): string {
    const id = String(raw || "").trim();
    if (!id) return "";
    const field = layer
      ? this.findLayerFieldName(layer, "uniqueid") || "uniqueid"
      : "uniqueid";
    const core = id.replace(/[{}]/g, "");
    const variants = Array.from(new Set([id, core, `{${core}}`])).filter(
      Boolean,
    );
    const clauses = variants.map(
      (v) => `${field}='${this.escapeArcGIS(String(v))}'`,
    );
    return clauses.length > 1 ? `(${clauses.join(" OR ")})` : clauses[0] || "";
  }

  /**
   * Build viloyat filter clause using stored viloyat → region mapping.
   * Supports: viloyat name (looks up region number from _viloyatToRegion) or raw region number.
   */
  private buildViloyatRegionClause(): string {
    const { viloyat, lockedViloyat } = this.state;

    const rawViloyat = (lockedViloyat ?? viloyat ?? "").toString();
    const effectiveViloyat = this.normalizeApos(rawViloyat);
    if (!effectiveViloyat) return "";

    // If value is a numeric code, filter on `region` directly (quoted for string-type fields).
    if (/^\d+$/.test(effectiveViloyat)) {
      return `region = '${Number(effectiveViloyat)}'`;
    }

    // Look up region number from stored mapping (populated by fetchAndStoreRegionDistrictMappings).
    const key = this.makeRegionDistrictKey(rawViloyat);
    const regionNum = key ? this._viloyatToRegion[key] : undefined;
    if (regionNum !== undefined && Number.isFinite(regionNum)) {
      return `region = '${regionNum}'`;
    }

    return this.eqAposSmart("viloyat", effectiveViloyat);
  }

  /**
   * Build tuman filter clause using stored tuman → district mapping.
   * Supports: tuman name (looks up district number from _tumanToDistrict) or raw district number.
   */
  private buildTumanDistrictClause(): string {
    const { tuman } = this.state;
    const rawTuman = (tuman ?? "").toString();
    const effectiveTuman = this.normalizeApos(rawTuman);
    if (!effectiveTuman) return "";

    if (/^\d+$/.test(effectiveTuman)) {
      return `district = '${Number(effectiveTuman)}'`;
    }

    const key = this.makeRegionDistrictKey(rawTuman);
    const districtNum = key ? this._tumanToDistrict[key] : undefined;
    if (districtNum !== undefined && Number.isFinite(districtNum)) {
      return `district = '${districtNum}'`;
    }

    return this.eqAposSmart("tuman", effectiveTuman);
  }

  /**
   * Build spatial WHERE clause (yil + viloyat + tuman [+ optional turi]).
   * When includeTuri is false, bar/chart logic can ignore crop (turi) and
   * show vegetation for the whole region; when true, it is included.
   */
  private buildNdviSpatialWhere(includeTuri = true): string {
    const where = this.buildWhereClause(false, includeTuri);
    return where;
  }

  /**
   * Build NDVI status filter clause for the currently selected VH bucket and ndviDate.
   * Example: status_2025_09_01 = 'yaxshi'
   */
  private buildNdviStatusClauseForCurrentVh(): string {
    const ndviDate = (this.state.ndviDate || "").trim();
    const vhCategory = (this.state.vh || "").trim();
    if (!ndviDate || !vhCategory) return "";

    const statusTableValue = VH_TO_NDVI_STATUS[vhCategory];
    if (!statusTableValue) return "";

    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return "";

    const cfg = (this.props.config || {}) as any;
    const prefix =
      (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";

    let statusField = this._ndviDateFieldMap[ndviDate];
    if (!statusField) {
      const suffix = ndviDate.replace(/-/g, "_");
      statusField = `${prefix}${suffix}`;
    }

    const fields: any[] = (primaryLayer as any).fields || [];
    const hasStatusField = fields.some(
      (f) =>
        (f?.name || "").toString().toLowerCase() === statusField.toLowerCase(),
    );
    if (!hasStatusField) return "";

    return `${statusField} = '${this.escapeArcGIS(statusTableValue)}'`;
  }

  /**
   * Build NDVI date-only clause (no VH bucket) for the current ndviDate.
   * Example: status_2025_09_18 IS NOT NULL
   */
  private buildNdviDateClauseWithoutVh(): string {
    const ndviDate = (this.state.ndviDate || "").trim();
    if (!ndviDate) return "";

    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return "";

    const cfg = (this.props.config || {}) as any;
    const prefix =
      (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";

    let statusField = this._ndviDateFieldMap[ndviDate];
    if (!statusField) {
      const suffix = ndviDate.replace(/-/g, "_");
      statusField = `${prefix}${suffix}`;
    }

    const fields: any[] = (primaryLayer as any).fields || [];
    const hasStatusField = fields.some(
      (f) =>
        (f?.name || "").toString().toLowerCase() === statusField.toLowerCase(),
    );
    if (!hasStatusField) return "";

    return `${statusField} IS NOT NULL`;
  }

  private buildWhereClause(
    includeVh = true,
    includeTuri = true,
    includeViloyat = true,
    layer?: __esri.FeatureLayer,
  ): string {
    const { yil, viloyat, tuman, turi, lockedViloyat } = this.state;
    const clauses: string[] = [];

    // Require year first
    if (!yil) return "1=0";

    // Year filter
    if (layer) {
      const yearClause = this.buildYearClauseForLayer(layer);
      if (!yearClause || yearClause === "1=0") return "1=0";
      clauses.push(yearClause);
    } else {
      const yDigits =
        String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0] ??
        String(yil).replace(/[^\d]/g, "");
      clauses.push(
        yDigits
          ? `yil LIKE '${this.escapeArcGIS(yDigits)}%'`
          : `yil LIKE '%${this.escapeArcGIS(String(yil))}%'`,
      );
    }

    if (includeViloyat) {
      // Require viloyat (or lockedViloyat) as well before showing any polygons
      const viloyatClause = this.buildViloyatRegionClause();
      if (!viloyatClause) {
        // No effective viloyat/region yet → hide polygons until user selects it
        return "1=0";
      }
      clauses.push(viloyatClause);
    }

    // Tuman → district number from stored mapping.
    // In default republic mode (no effective viloyat), ignore stale tuman so
    // VH bar reflects full-country totals for the selected year.
    const hasEffectiveViloyat = !!this.normalizeApos(
      (lockedViloyat || viloyat || "").toString(),
    );
    if (tuman && (includeViloyat || hasEffectiveViloyat)) {
      const tumanClause = this.buildTumanDistrictClause();
      if (tumanClause) clauses.push(tumanClause);
    }

    // Crop (turi): include only when includeTuri true — bar chart does not filter by crop
    if (includeTuri) {
      const cropClause = this.buildTurlarClause("turi");
      if (cropClause) clauses.push(cropClause);
    }

    // Vegetation Holati (AgriBar): prefer uniqueid list from vegetation
    // indices; fall back to vh attribute OR ndvi_status token.
    if (includeVh) {
      if (this._vhMapUniqueIds) {
        clauses.push(buildSpatialJoinWhere(this._vhMapUniqueIds));
      } else {
        const vhCategory = this.normalizeApos(String(this.state.vh || "")).trim();
        if (vhCategory) {
          const status = VH_TO_NDVI_STATUS[vhCategory] || "";
          const variants = Array.from(
            new Set([vhCategory, status].filter(Boolean)),
          );
          const vhClauses = variants.map(
            (v) => `vh='${this.escapeArcGIS(String(v))}'`,
          );
          clauses.push(
            vhClauses.length === 1
              ? vhClauses[0]
              : `(${vhClauses.join(" OR ")})`,
          );
        }
      }
    }

    // Row selection in AgriGraff should leave only the selected polygon on map.
    if (this.state.polygonMode && this.state.selectedGraffUniqueid) {
      const uniqueClause = this.buildUniqueIdClause(
        this.state.selectedGraffUniqueid,
        layer,
      );
      if (uniqueClause) clauses.push(uniqueClause);
    }

    const result = clauses.length ? clauses.join(" AND ") : "1=0";
    return withEvapoAccessWhere(result);
  }

  /** Get latest available NDVI date for bar (selected date, or latest from options/map, or from layer fields). */
  private getLatestNdviDateForBar(
    primaryLayer?: __esri.FeatureLayer,
  ): string | null {
    const current = (this.state.ndviDate || "").trim();
    if (current) return current;
    const opts = this.state.ndviDateOptions;
    if (opts?.length) return opts[opts.length - 1];
    const keys = Object.keys(this._ndviDateFieldMap);
    if (keys.length) {
      const sorted = keys.slice().sort((a, b) => {
        const ta = Date.parse(a);
        const tb = Date.parse(b);
        if (Number.isNaN(ta) || Number.isNaN(tb)) return a.localeCompare(b);
        return ta - tb;
      });
      return sorted[sorted.length - 1];
    }
    if (primaryLayer?.fields?.length) {
      const cfg = (this.props.config || {}) as any;
      const prefix =
        (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";
      const dateLabels: string[] = [];
      for (const f of primaryLayer.fields) {
        const name = (f as any).name || "";
        if (!String(name).toLowerCase().startsWith(prefix.toLowerCase()))
          continue;
        const rawSuffix = String(name).slice(prefix.length);
        const digitsOnly = rawSuffix.replace(/[^0-9]/g, "");
        const label =
          digitsOnly.length >= 8
            ? `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4, 6)}-${digitsOnly.slice(6, 8)}`
            : rawSuffix.replace(/_/g, "-");
        dateLabels.push(label);
      }
      if (dateLabels.length) {
        dateLabels.sort((a, b) => {
          const ta = Date.parse(a);
          const tb = Date.parse(b);
          if (Number.isNaN(ta) || Number.isNaN(tb)) return a.localeCompare(b);
          return ta - tb;
        });
        return dateLabels[dateLabels.length - 1];
      }
    }
    return null;
  }

  /**
   * Compute VH bar data from agri_vegetation_indices' ndvi_status field —
   * grouped counts per status, for the current viloyat/tuman + an NDVI
   * date (explicit selection, or newest-with-data via queryVegetationAvailableDates).
   *
   * Previously this scanned the polygon layer for wide `status_YYYY_MM_DD`
   * columns — a schema that only ever existed on a different (Evapo) layer.
   * `featureLayers` here is Agri_table_data, which never had those columns,
   * so this always returned the all-zero fallback. agri_vegetation_indices
   * has a real per-date `ndvi_status` field, no schema guessing needed.
   */
  private aggregateVhRowsByPolygonArea = (
    rows: Array<{
      ndvi_status: string;
      count: number;
      areaHa: number;
      uniqueIds?: string[];
    }>,
    polygonAreas: Map<string, number>,
  ): VHBarData => {
    const categoryAreaMap = new Map<string, number>();
    const categoryFieldCountMap = new Map<string, number>();
    const countedUniqueIds = new Set<string>();

    for (const row of rows) {
      const status = String(row.ndvi_status || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
      const category = NDVI_STATUS_TO_VH[status];
      if (!category) continue;

      for (const rawId of row.uniqueIds || []) {
        const uniqueId = String(rawId || "").trim().toLowerCase();
        if (!uniqueId || countedUniqueIds.has(uniqueId)) continue;
        const area = polygonAreas.get(uniqueId);
        if (area === undefined || !Number.isFinite(area) || area <= 0) continue;
        countedUniqueIds.add(uniqueId);
        categoryAreaMap.set(
          category,
          (categoryAreaMap.get(category) || 0) + area,
        );
        categoryFieldCountMap.set(
          category,
          (categoryFieldCountMap.get(category) || 0) + 1,
        );
      }
    }

    let totalCount = 0;
    const categories: VHBarDataItem[] = VH_CATEGORIES.map((definition) => {
      const area = categoryAreaMap.get(definition.value) || 0;
      totalCount += area;
      return {
        category: definition.value,
        label: definition.label,
        order: definition.order,
        color: definition.color,
        count: area,
        fieldCount: categoryFieldCountMap.get(definition.value) || 0,
        percentage: 0,
      };
    });
    categories.forEach((category) => {
      category.percentage =
        totalCount > 0 ? (category.count * 100) / totalCount : 0;
    });
    return { categories, totalCount };
  };

  /**
   * V18-compatible aggregation for vegetation service rows. The shared data
   * source has already assigned every uniqueid to exactly one status and uses
   * the maximum px_all vote once for that id, so summing these compact rows
   * does not double-count a polygon. Unlike the canonical table join, this is
   * available immediately on republic startup and cannot fail because the
   * Agri_table_data layer is still resolving.
   */
  private aggregateVhServiceRows = (
    rows: Array<{
      ndvi_status: string;
      count: number;
      areaHa: number;
    }>,
  ): VHBarData => {
    const categoryAreaMap = new Map<string, number>();
    const categoryFieldCountMap = new Map<string, number>();
    for (const row of rows) {
      const status = String(row.ndvi_status || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
      const category = NDVI_STATUS_TO_VH[status];
      const area = Number(row.areaHa) || 0;
      const fieldCount = Number(row.count) || 0;
      if (!category || fieldCount <= 0 || area < 0) continue;
      categoryAreaMap.set(category, (categoryAreaMap.get(category) || 0) + area);
      categoryFieldCountMap.set(
        category,
        (categoryFieldCountMap.get(category) || 0) + fieldCount,
      );
    }

    let totalCount = 0;
    const categories: VHBarDataItem[] = VH_CATEGORIES.map((definition) => {
      const count = categoryAreaMap.get(definition.value) || 0;
      totalCount += count;
      return {
        category: definition.value,
        label: definition.label,
        order: definition.order,
        color: definition.color,
        count,
        fieldCount: categoryFieldCountMap.get(definition.value) || 0,
        percentage: 0,
      };
    });
    categories.forEach((category) => {
      category.percentage =
        totalCount > 0 ? (category.count * 100) / totalCount : 0;
    });
    return { categories, totalCount };
  };

  private computeVhBarData = async (): Promise<VHBarData | null> => {
    const key = this.makeVhBarComputeKey();
    const memoized = this._vhBarComputeMemo.get(key);
    if (memoized) return memoized;
    const inflight = this._vhBarComputeInFlight.get(key);
    if (inflight) return inflight;

    const promise = this.executeComputeVhBarData()
      .then((result) => {
        if (result) {
          this._vhBarComputeMemo.set(key, result);
          while (this._vhBarComputeMemo.size > 8) {
            const oldestKey = this._vhBarComputeMemo.keys().next().value;
            if (!oldestKey) break;
            this._vhBarComputeMemo.delete(oldestKey);
          }
        }
        return result;
      })
      .finally(() => {
        this._vhBarComputeInFlight.delete(key);
      });
    this._vhBarComputeInFlight.set(key, promise);
    this._lastVhBarComputeKey = key;
    return promise;
  };

  private makeVhBarComputeKey = (): string => {
    const {
      viloyat,
      lockedViloyat,
      tuman,
      yil,
      ndviDate,
      ndviDateLocked,
      polygonMode,
      selectedGraffUniqueid,
    } = this.state;
    const effectiveViloyat = lockedViloyat || viloyat;
    const chartFlags = this.getChartFilterFlags();
    const selectedTurlar = chartFlags.filterVhBarByCrop
      ? this.getSelectedTurlar()
      : [];
    return JSON.stringify({
      yil: String(yil || ""),
      viloyat: String(effectiveViloyat || ""),
      tuman: String(effectiveViloyat ? tuman || "" : ""),
      turlar: selectedTurlar,
      ndviDate: ndviDateLocked ? String(ndviDate || "").trim() : "",
      ndviDateLocked: Boolean(ndviDateLocked && String(ndviDate || "").trim()),
      polygonMode: Boolean(polygonMode),
      uniqueid: polygonMode ? String(selectedGraffUniqueid || "") : "",
      filterVhBarByCrop: chartFlags.filterVhBarByCrop,
    });
  };

  private executeComputeVhBarData = async (): Promise<VHBarData | null> => {
    const zeroResult: VHBarData = {
      categories: VH_CATEGORIES.map((c) => ({
        category: c.value,
        label: c.label,
        order: c.order,
        color: c.color,
        count: 0,
        fieldCount: 0,
        percentage: 0,
      })),
      totalCount: 0,
    };

    const { viloyat, lockedViloyat, tuman, yil } = this.state;
    const rawViloyat = (lockedViloyat ?? viloyat ?? "").toString();
    const effectiveViloyat = this.normalizeApos(rawViloyat);
    const regionKey = this.makeRegionDistrictKey(rawViloyat);
    const regionNum = effectiveViloyat
      ? /^\d+$/.test(effectiveViloyat)
        ? Number(effectiveViloyat)
        : regionKey
          ? this._viloyatToRegion[regionKey]
          : undefined
      : undefined;
    // A named/selected viloyat must resolve to its numeric region code.
    // With no viloyat selected, leaving region undefined intentionally makes
    // the vegetation-index query aggregate every region that has data.
    if (
      effectiveViloyat &&
      (regionNum === undefined || !Number.isFinite(regionNum))
    ) {
      return zeroResult;
    }

    const rawTuman = (tuman ?? "").toString();
    // A district cannot be a valid scope without its parent viloyat. Ignore
    // any stale district value while the dashboard is in republic mode.
    const effectiveTuman = effectiveViloyat
      ? this.normalizeApos(rawTuman)
      : "";
    let districtNum: number | undefined;
    if (effectiveTuman) {
      const districtKey = this.makeRegionDistrictKey(rawTuman);
      districtNum = /^\d+$/.test(effectiveTuman)
        ? Number(effectiveTuman)
        : districtKey
          ? this._tumanToDistrict[districtKey]
          : undefined;
      if (!Number.isFinite(districtNum as number)) districtNum = undefined;
    }
    // Never widen a selected district to its whole region when the mapping is
    // missing. An unresolved filter is an empty result, not an open query.
    if (effectiveTuman && districtNum === undefined) return zeroResult;

    // Resolve every selected crop type to the crop_id values used by the
    // vegetation-index service whenever a crop is active (keeps VH bar in
    // sync with Ekin Turi even if a VH status was selected first).
    const chartFlags = this.getChartFilterFlags();
    const selectedTurlar = chartFlags.filterVhBarByCrop
      ? this.getSelectedTurlar()
      : [];
    const cropIds = chartFlags.filterVhBarByCrop
      ? Array.from(
          new Set(
            selectedTurlar
              .map((turi) => {
                const key = this.makeRegionDistrictKey(turi);
                return key ? this._turiToCropId[key] : undefined;
              })
              .filter((value): value is string => Boolean(value)),
          ),
        )
      : [];
    // A selected crop that cannot be mapped to vegetation.crop_id must not
    // silently fall back to all crops (the main cause of oversized VH totals).
    if (selectedTurlar.length > 0 && cropIds.length !== selectedTurlar.length) {
      return zeroResult;
    }

    // Republic mode must not use one global latest date. Satellite coverage
    // arrives on different dates per region; collect each region's own latest
    // available date in the selected year, then sum all regional VH buckets.
    if (!effectiveViloyat && !this.state.ndviDateLocked) {
      const selectedYear =
        String(yil || "").match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
      // Same year-gate as Index graff — never scan all-time vegetation.
      if (!selectedYear) return zeroResult;
      try {
        const regionScopes = await queryVegetationLatestDatesByRegion({
          year: selectedYear,
        });
        if (!this._isMounted) return null;
        if (!regionScopes.length) return zeroResult;

        const cropFilter = cropIds.length ? cropIds : undefined;
        let rows: Awaited<ReturnType<typeof queryVegetationStatusCounts>> = [];
        let usedOverview = false;

        if (REPUBLIC_VH_USE_STATUS_STATS) {
          try {
            // Batch regions that share a latest date → typically 1–3 queries.
            rows = await queryVegetationStatusCountsByRegionScopes(
              regionScopes,
              cropFilter,
            );
            usedOverview = true;
          } catch (overviewError: any) {
            AgriLocalization.agriLog(
              "computeVhBarData:republic-overview-failed-fallback",
              {
                error: String(overviewError?.message || overviewError),
                year: selectedYear || null,
                regionCount: regionScopes.length,
              },
            );
            // Fallback: bounded concurrency, still no uniqueid pager.
            const mapPool = async <T, R>(
              items: T[],
              concurrency: number,
              worker: (item: T) => Promise<R>,
            ): Promise<R[]> => {
              const results: R[] = new Array(items.length);
              let next = 0;
              const run = async () => {
                while (next < items.length) {
                  if (!this._isMounted) return;
                  const index = next++;
                  results[index] = await worker(items[index]);
                }
              };
              const pool = Math.max(1, Math.min(concurrency, items.length));
              await Promise.all(Array.from({ length: pool }, () => run()));
              return results;
            };
            const groups = await mapPool(regionScopes, 3, (scope) =>
              queryVegetationStatusCountsByStatus({
                region: scope.region,
                date: scope.date,
                cropIds: cropFilter,
              }),
            );
            rows = groups.flat();
            usedOverview = false;
          }
        } else {
          const groups = await Promise.all(
            regionScopes.map((scope) =>
              queryVegetationStatusCounts({
                region: scope.region,
                date: scope.date,
                cropIds: cropFilter,
              }),
            ),
          );
          rows = groups.flat();
        }

        if (!this._isMounted) return null;

        const result = this.aggregateVhServiceRows(rows);
        const { categories, totalCount } = result;

        AgriLocalization.agriLog("computeVhBarData:republic-result", {
          year: selectedYear || null,
          regionCount: regionScopes.length,
          regionScopes,
          usedOverview,
          totalAreaHa: totalCount,
          totalFieldCount: categories.reduce(
            (sum, category) => sum + category.fieldCount,
            0,
          ),
          categories: categories.map((category) => ({
            category: category.category,
            areaHa: category.count,
            fieldCount: category.fieldCount,
          })),
        });

        return result;
      } catch (error: any) {
        AgriLocalization.agriLog("computeVhBarData:republic-failed", {
          error: String(error?.message || error),
        });
        return null;
      }
    }
    // Build candidate date list:
    // - if user explicitly picked ndviDate, use ONLY that date (no fallback)
    // - otherwise, discover available dates for this region/district and
    //   try newest to oldest until one has data.
    let candidates: string[];
    const forcedNdvi = (this.state.ndviDate || "").trim();
    if (this.state.ndviDateLocked && forcedNdvi) {
      candidates = [forcedNdvi];
    } else {
      // Date availability is geography-dependent. Always refresh it for the
      // current scope so a previous region's cached dates cannot limit the
      // republic aggregate (or a newly selected region).
      let knownDates: string[] = [];
      try {
        knownDates = await queryVegetationAvailableDates({
          region: regionNum,
          district: districtNum,
        });
        if (this._isMounted) this.setState({ ndviDateOptions: knownDates });
      } catch {
        knownDates = [];
      }
      const selectedYear = String(yil || "").match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
      if (selectedYear) {
        knownDates = knownDates.filter((date) => String(date).startsWith(`${selectedYear}-`));
      }
      if (!knownDates.length) return zeroResult;
      // queryVegetationAvailableDates returns ascending — try newest first.
      // Prefer the last successful VH date for this session when it is still
      // in the candidate list so crop/tuman refreshes skip empty newer dates.
      candidates = knownDates.slice().reverse();
      const preferredDate = String(this._vhBarUsedDate || "").trim();
      if (preferredDate && candidates.includes(preferredDate)) {
        candidates = [
          preferredDate,
          ...candidates.filter((date) => date !== preferredDate),
        ];
      }
    }

    let bestResult: VHBarData | null = null;
    let usedDate: string | null = null;
    /** True when the accepted date used status-stats overview (no uniqueid paging). */
    let usedOverviewForBest = false;

    const loadOverviewRows = async (
      ndviDate: string,
    ): Promise<{
      rows: Array<{
        ndvi_status: string;
        count: number;
        areaHa: number;
        uniqueIds: string[];
      }>;
      usedOverview: boolean;
      overviewSucceeded: boolean;
    }> => {
      if (REPUBLIC_VH_USE_STATUS_STATS) {
        try {
          const rows = await queryVegetationStatusCountsByStatus({
            region: regionNum,
            district: districtNum,
            date: ndviDate,
            cropIds: cropIds.length ? cropIds : undefined,
          });
          return { rows, usedOverview: true, overviewSucceeded: true };
        } catch (overviewError: any) {
          AgriLocalization.agriLog("computeVhBarData:region-overview-failed", {
            date: ndviDate,
            region: regionNum,
            district: districtNum,
            error: String(overviewError?.message || overviewError),
          });
        }
      }

      if (!REPUBLIC_VH_USE_STATUS_STATS) {
        try {
          const rows = await queryVegetationStatusCounts({
            region: regionNum,
            district: districtNum,
            date: ndviDate,
            cropIds: cropIds.length ? cropIds : undefined,
          });
          return { rows, usedOverview: false, overviewSucceeded: false };
        } catch {
          return { rows: [], usedOverview: false, overviewSucceeded: false };
        }
      }

      // Overview threw — one exact attempt for this date only.
      try {
        AgriLocalization.agriLog("computeVhBarData:region-exact-fallback", {
          date: ndviDate,
          region: regionNum,
          district: districtNum ?? null,
        });
        const rows = await queryVegetationStatusCounts({
          region: regionNum,
          district: districtNum,
          date: ndviDate,
          cropIds: cropIds.length ? cropIds : undefined,
        });
        return { rows, usedOverview: false, overviewSucceeded: false };
      } catch {
        return { rows: [], usedOverview: false, overviewSucceeded: false };
      }
    };

    try {
      // First ekin-turi click is slow because the viloyat-wide preferred date
      // often has no rows for that crop, and walking dates one-by-one waits
      // on many empty overview round-trips. Probe a small newest batch in
      // parallel; later clicks stay fast via _vhBarUsedDate + caches.
      const probeParallel = cropIds.length > 0 && candidates.length > 1;
      const PROBE_BATCH = 8;
      let candidateOffset = 0;

      while (candidateOffset < candidates.length && !bestResult) {
        const batch = probeParallel
          ? candidates.slice(candidateOffset, candidateOffset + PROBE_BATCH)
          : [candidates[candidateOffset]];
        candidateOffset += batch.length;

        const batchResults = probeParallel
          ? await Promise.all(
              batch.map(async (ndviDate) => {
                const loaded = await loadOverviewRows(ndviDate);
                return { ndviDate, ...loaded };
              }),
            )
          : [
              {
                ndviDate: batch[0],
                ...(await loadOverviewRows(batch[0])),
              },
            ];
        if (!this._isMounted) return null;

        for (const item of batchResults) {
          const aggregated = this.aggregateVhServiceRows(item.rows);
          if (aggregated.totalCount <= 0) continue;
          bestResult = aggregated;
          usedDate = item.ndviDate;
          usedOverviewForBest = item.usedOverview;
          AgriLocalization.agriLog("computeVhBarData:region-result", {
            date: item.ndviDate,
            region: regionNum,
            district: districtNum ?? null,
            usedOverview: item.usedOverview,
            cropIds: cropIds.length ? cropIds : null,
            probeParallel,
            totalAreaHa: aggregated.totalCount,
          });
          break;
        }
      }

      if (!bestResult) {
        this._vhBarUsedDate = null;
        return zeroResult;
      }

      if (usedDate) {
        this._vhBarUsedDate = usedDate;
        // Exact path already warms uniqueid cache — prefetch helps VH clicks.
        // Overview path skips prefetch so crop/tuman bar refresh stays fast;
        // resolveVhMapUniqueIds still loads ids when a VH bucket is clicked.
        if (!usedOverviewForBest) {
          this.prefetchVhStatusUniqueIds(usedDate);
        }
      }

      if (
        usedDate &&
        this._isMounted &&
        !this.state.ndviDateLocked &&
        this.state.ndviDate !== usedDate
      ) {
        this.setState({ ndviDate: usedDate });
      }
      return bestResult;
    } catch (e) {
      return null;
    }
  };

  /** Build table WHERE for date field matching selected ndviDate (YYYY-MM-DD or string). */
  private buildTableDateWhere(
    dateField: string,
    ndviDate: string,
  ): string | null {
    if (!dateField || !ndviDate) return null;
    const escaped = this.escapeArcGIS(ndviDate);
    return `${dateField} = '${escaped}'`;
  }

  /**
   * Canonical hectare value for every filtered polygon. Vegetation rows only
   * determine the status; displayed area must come from Agri_table_data so
   * VH categories partition the same total used by Indicator/Pie/Region.
   */
  private getPolygonAreasWithCurrentFilter = async (): Promise<
    Map<string, number>
  > => {
    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return new Map();

    const hasRegion = !!this.normalizeApos(
      (this.state.lockedViloyat || this.state.viloyat || "").toString(),
    );
    const where = this.buildWhereClause(false, true, hasRegion, primaryLayer);
    if (!where || where === "1=0") return new Map();
    const layerKey = String((primaryLayer as any).url || primaryLayer.id || "");
    const cacheKey = `${layerKey}|${where}`;
    const cached = this._polygonAreaQueryCache.get(cacheKey);
    if (cached) return cached;

    const cfg = (this.props.config || {}) as any;
    const requestedJoinField =
      (cfg.polygonJoinField || "uniqueid").trim() || "uniqueid";
    const polygonJoinField =
      this.findLayerFieldName(primaryLayer, requestedJoinField) ||
      requestedJoinField;
    const requestedAreaField =
      String(cfg?.indicator?.attributeField || "maydon").trim() || "maydon";
    const areaField =
      this.findLayerFieldName(primaryLayer, requestedAreaField) ||
      this.findLayerFieldName(primaryLayer, "maydon") ||
      requestedAreaField;
    const oidField = String(primaryLayer.objectIdField || "objectid");
    const pageSize = 2000;
    const request = (async (): Promise<Map<string, number>> => {
      const areas = new Map<string, number>();
      let lastOid = -1;
      let completed = false;
      for (let page = 0; page < 250 && this._isMounted; page++) {
        const q = primaryLayer.createQuery();
        (q as any).where =
          lastOid < 0 ? where : `(${where}) AND ${oidField} > ${lastOid}`;
        (q as any).outFields = [oidField, polygonJoinField, areaField];
        (q as any).returnGeometry = false;
        (q as any).orderByFields = [`${oidField} ASC`];
        (q as any).num = pageSize;
        (q as any).resultRecordCount = pageSize;

        const res = await primaryLayer.queryFeatures(q);
        const features = res?.features ?? [];
        if (!features.length) {
          completed = true;
          break;
        }
        let pageMaxOid = lastOid;
        for (const f of features) {
          const attrs = (f.attributes || {}) as Record<string, unknown>;
          const oid = Number(
            attrs[oidField] ?? attrs[oidField.toLowerCase()] ?? attrs.OBJECTID,
          );
          if (Number.isFinite(oid) && oid > pageMaxOid) pageMaxOid = oid;
          const rawId =
            attrs[polygonJoinField] ?? attrs[polygonJoinField.toLowerCase()];
          const area = Number(
            attrs[areaField] ?? attrs[areaField.toLowerCase()] ?? 0,
          );
          if (rawId == null || String(rawId).trim() === "") continue;
          if (!Number.isFinite(area) || area < 0) continue;
          const key = String(rawId).trim().toLowerCase();
          areas.set(key, Math.max(areas.get(key) ?? 0, area));
        }
        if (features.length < pageSize) {
          completed = true;
          break;
        }
        if (!(pageMaxOid > lastOid)) {
          throw new Error("Polygon area pagination did not advance.");
        }
        lastOid = pageMaxOid;
      }
      if (!completed) {
        throw new Error("Polygon area query exceeded the safe page limit.");
      }
      return areas;
    })();

    this._polygonAreaQueryCache.set(cacheKey, request);
    while (this._polygonAreaQueryCache.size > 6) {
      const oldestKey = this._polygonAreaQueryCache.keys().next().value;
      if (!oldestKey) break;
      this._polygonAreaQueryCache.delete(oldestKey);
    }
    try {
      return await request;
    } catch (error) {
      this._polygonAreaQueryCache.delete(cacheKey);
      throw error;
    }
  };

  /**
   * Build NDVI table WHERE: selected date + yil + region (from viloyat) + district (from tuman) + turi.
   * User selects yil → viloyat, tuman; we use their region/district data for the server query.
   * Prefers numeric region/district when the table has those fields (same mapping as polygon layer).
   */
  private buildTableWhereWithRegion(
    dateField: string,
    ndviDate: string,
    tableFieldNames: string[],
  ): string | null {
    const dateWhere = this.buildTableDateWhere(dateField, ndviDate);
    if (!dateWhere) return null;
    const parts: string[] = [dateWhere];

    const { yil, viloyat, tuman, turi, lockedViloyat } = this.state;
    const hasField = (name: string) =>
      tableFieldNames.some((f) => f.toLowerCase() === name.toLowerCase());

    if (yil && hasField("yil")) {
      const yDigits =
        String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0] ??
        String(yil).replace(/[^\d]/g, "");
      if (yDigits) parts.push(`yil LIKE '${this.escapeArcGIS(yDigits)}%'`);
    }

    const effectiveViloyat = this.normalizeApos(
      (viloyat || lockedViloyat || "").toString(),
    );
    if (effectiveViloyat) {
      if (hasField("region")) {
        const regionNum = /^\d+$/.test(effectiveViloyat)
          ? Number(effectiveViloyat)
          : this._viloyatToRegion[effectiveViloyat];
        if (regionNum !== undefined && Number.isFinite(regionNum)) {
          parts.push(`region = '${regionNum}'`);
        } else if (hasField("viloyat")) {
          parts.push(`viloyat = '${this.escapeArcGIS(effectiveViloyat)}'`);
        }
      } else if (hasField("viloyat")) {
        parts.push(`viloyat = '${this.escapeArcGIS(effectiveViloyat)}'`);
      }
    }

    if (tuman) {
      const effectiveTuman = this.normalizeApos(tuman.toString());
      if (effectiveTuman) {
        if (hasField("district")) {
          const districtNum = /^\d+$/.test(effectiveTuman)
            ? Number(effectiveTuman)
            : this._tumanToDistrict[effectiveTuman];
          if (districtNum !== undefined && Number.isFinite(districtNum)) {
            parts.push(`district = '${districtNum}'`);
          } else if (hasField("tuman")) {
            parts.push(`tuman = '${this.escapeArcGIS(effectiveTuman)}'`);
          }
        } else if (hasField("tuman")) {
          parts.push(`tuman = '${this.escapeArcGIS(effectiveTuman)}'`);
        }
      }
    }

    if (hasField("turi")) {
      const cropClause = this.buildTurlarClause("turi");
      if (cropClause) parts.push(cropClause);
    }
    return parts.join(" AND ");
  }

  /**
   * Warm the uniqueid cache for every VH status on the chart's working date.
   * Status clicks then hit cache instead of paging the vegetation table again.
   */
  private prefetchVhStatusUniqueIds = (ndviDate: string): void => {
    const date = String(ndviDate || "").trim();
    if (!date || !this._isMounted) return;

    const rawViloyat = (this.state.lockedViloyat || this.state.viloyat || "").toString();
    const effectiveViloyat = this.normalizeApos(rawViloyat);
    const regionKey = this.makeRegionDistrictKey(rawViloyat);
    const regionNum = /^\d+$/.test(effectiveViloyat)
      ? Number(effectiveViloyat)
      : regionKey
        ? this._viloyatToRegion[regionKey]
        : undefined;
    if (regionNum === undefined || !Number.isFinite(regionNum)) return;

    const rawTuman = (this.state.tuman || "").toString();
    const effectiveTuman = this.normalizeApos(rawTuman);
    let districtNum: number | undefined;
    if (effectiveTuman) {
      const districtKey = this.makeRegionDistrictKey(rawTuman);
      districtNum = /^\d+$/.test(effectiveTuman)
        ? Number(effectiveTuman)
        : districtKey
          ? this._tumanToDistrict[districtKey]
          : undefined;
      if (!Number.isFinite(districtNum as number)) districtNum = undefined;
    }

    const cropIds = Array.from(
      new Set(
        this.getSelectedTurlar()
          .map((turi) => {
            const key = this.makeRegionDistrictKey(turi);
            return key ? this._turiToCropId[key] : undefined;
          })
          .filter((value): value is string => Boolean(value)),
      ),
    );
    for (const status of Object.values(VH_TO_NDVI_STATUS)) {
      const cacheKey = [
        status,
        date,
        regionNum,
        districtNum ?? "",
        cropIds.slice().sort().join(","),
      ].join("|");
      if (this._vhUniqueIdCache[cacheKey]) continue;
      void queryVegetationUniqueIdsForStatus({
        region: regionNum,
        district: districtNum,
        date,
        ndviStatus: status,
        cropIds: cropIds.length ? cropIds : undefined,
      })
        .then((ids) => {
          if (!this._isMounted) return;
          this._vhUniqueIdCache[cacheKey] = ids;
        })
        .catch(() => {
          /* prefetch is best-effort */
        });
    }
  };

  /**
   * Resolve polygon uniqueids for the current Vegetatsiya Holati selection.
   * Bar chart categories come from agri_vegetation_indices.ndvi_status for a
   * specific NDVI date — NOT from the polygon layer's static `vh` attribute.
   */
  private resolveVhMapUniqueIds = async (
    isCurrent?: () => boolean,
  ): Promise<string[] | null> => {
    const gen = ++this._vhResolveGen;
    const stillOk = () =>
      this._isMounted &&
      gen === this._vhResolveGen &&
      (!isCurrent || isCurrent());

    const vhCategory = this.normalizeApos(String(this.state.vh || "")).trim();
    if (!vhCategory) {
      this._vhMapUniqueIds = null;
      clearPieVhFilterUniqueIds();
      return null;
    }

    const status = VH_TO_NDVI_STATUS[vhCategory];
    if (!status) {
      this._vhMapUniqueIds = [];
      clearPieVhFilterUniqueIds();
      return [];
    }

    const rawViloyat = (this.state.lockedViloyat || this.state.viloyat || "").toString();
    const effectiveViloyat = this.normalizeApos(rawViloyat);
    const regionKey = this.makeRegionDistrictKey(rawViloyat);
    const regionNum = /^\d+$/.test(effectiveViloyat)
      ? Number(effectiveViloyat)
      : regionKey
        ? this._viloyatToRegion[regionKey]
        : undefined;
    if (regionNum === undefined || !Number.isFinite(regionNum)) {
      this._vhMapUniqueIds = [];
      clearPieVhFilterUniqueIds();
      return [];
    }

    const rawTuman = (this.state.tuman || "").toString();
    const effectiveTuman = this.normalizeApos(rawTuman);
    let districtNum: number | undefined;
    if (effectiveTuman) {
      const districtKey = this.makeRegionDistrictKey(rawTuman);
      districtNum = /^\d+$/.test(effectiveTuman)
        ? Number(effectiveTuman)
        : districtKey
          ? this._tumanToDistrict[districtKey]
          : undefined;
      if (!Number.isFinite(districtNum as number)) districtNum = undefined;
    }

    const cropIds = Array.from(
      new Set(
        this.getSelectedTurlar()
          .map((turi) => {
            const key = this.makeRegionDistrictKey(turi);
            return key ? this._turiToCropId[key] : undefined;
          })
          .filter((value): value is string => Boolean(value)),
      ),
    );

    // Prefer the single date the VH chart already proved has rows — walking
    // every NDVI date on each status click is the main latency source.
    let dateCandidates: string[] = [];
    const forcedNdvi = (this.state.ndviDate || "").trim();
    const barDate = (this._vhBarUsedDate || "").trim();
    if (this.state.ndviDateLocked && forcedNdvi) {
      dateCandidates = [forcedNdvi];
    } else if (barDate) {
      dateCandidates = [barDate];
    } else if (forcedNdvi) {
      dateCandidates = [forcedNdvi];
    } else {
      try {
        let knownDates = this.state.ndviDateOptions || [];
        if (!knownDates.length) {
          knownDates = await queryVegetationAvailableDates({
            region: regionNum,
            district: districtNum,
          });
          if (!stillOk()) return this._vhMapUniqueIds;
          if (this._isMounted && knownDates.length) {
            this.setState({ ndviDateOptions: knownDates });
          }
        }
        const selectedYear =
          String(this.state.yil || "").match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
        if (selectedYear) {
          knownDates = knownDates.filter((d) =>
            String(d).startsWith(`${selectedYear}-`),
          );
        }
        // Ascending from service → newest first; stop at first hit below.
        dateCandidates = knownDates.slice().reverse();
      } catch {
        dateCandidates = [];
      }
    }

    if (!dateCandidates.length) {
      this._vhMapUniqueIds = [];
      clearPieVhFilterUniqueIds();
      return [];
    }

    const fetchIdsForCrops = async (
      forCropIds: string[],
      forDate: string,
    ): Promise<string[]> => {
      const cacheKey = [
        status,
        forDate,
        regionNum,
        districtNum ?? "",
        forCropIds.slice().sort().join(","),
      ].join("|");
      const cached = this._vhUniqueIdCache[cacheKey];
      if (cached) return cached;
      const ids = await queryVegetationUniqueIdsForStatus({
        region: regionNum,
        district: districtNum,
        date: forDate,
        ndviStatus: status,
        cropIds: forCropIds.length ? forCropIds : undefined,
      });
      this._vhUniqueIdCache[cacheKey] = ids;
      return ids;
    };

    try {
      // Map always ANDs crop + VH when both are set (crop-scoped ids).
      let ids: string[] = [];
      let ndviDate = dateCandidates[0];
      for (const candidate of dateCandidates) {
        ids = await fetchIdsForCrops(cropIds, candidate);
        if (!stillOk()) {
          AgriLocalization.agriLog("vhMapUniqueIds:SKIP-stale", {
            vhCategory,
            gen,
          });
          return this._vhMapUniqueIds;
        }
        // Strict filters: do not fall back to "all crops" when crop is selected.
        if (ids.length) {
          ndviDate = candidate;
          break;
        }
      }

      // Preferred date(s) empty → walk other available dates (same as chart).
      if (!ids.length && (barDate || forcedNdvi)) {
        try {
          let knownDates = this.state.ndviDateOptions || [];
          if (!knownDates.length) {
            knownDates = await queryVegetationAvailableDates({
              region: regionNum,
              district: districtNum,
            });
            if (!stillOk()) return this._vhMapUniqueIds;
          }
          const selectedYear =
            String(this.state.yil || "").match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
          if (selectedYear) {
            knownDates = knownDates.filter((d) =>
              String(d).startsWith(`${selectedYear}-`),
            );
          }
          const fallback = knownDates
            .slice()
            .reverse()
            .filter((d) => !dateCandidates.includes(d));
          for (const candidate of fallback) {
            ids = await fetchIdsForCrops(cropIds, candidate);
            if (!stillOk()) return this._vhMapUniqueIds;
            if (ids.length) {
              ndviDate = candidate;
              break;
            }
          }
        } catch {
          /* keep ids as-is */
        }
      }

      this._vhMapUniqueIds = ids;
      AgriLocalization.agriLog("vhMapUniqueIds:resolved", {
        vhCategory,
        status,
        ndviDate,
        regionNum,
        districtNum: districtNum ?? null,
        cropCount: cropIds.length,
        count: ids.length,
        triedDates: dateCandidates.length,
      });

      // Pie needs VH-only uniqueids (no crop) when VH was selected first.
      const flags = this.getChartFilterFlags();
      if (flags.filterPieByVh) {
        const pieIds =
          cropIds.length === 0
            ? ids
            : await fetchIdsForCrops([], ndviDate);
        if (!stillOk()) return this._vhMapUniqueIds;
        setPieVhFilterUniqueIds(pieIds);
        AgriLocalization.agriLog("vhPieUniqueIds:published", {
          count: pieIds.length,
          unscopedByCrop: cropIds.length > 0,
        });
      } else {
        clearPieVhFilterUniqueIds();
      }

      return ids;
    } catch (e: any) {
      if (!stillOk()) return this._vhMapUniqueIds;
      AgriLocalization.agriLog("vhMapUniqueIds:FAILED", {
        vhCategory,
        error: String(e?.message || e),
      });
      this._vhMapUniqueIds = [];
      clearPieVhFilterUniqueIds();
      return [];
    }
  };

  private syncShownRegionYearLayers = (map: any): ShownRegionYearLayer[] => {
    // Strict: null = no VH uniqueid filter; [] = VH active but zero matches (1=0);
    // non-empty = uniqueid IN (...). Never treat [] as null (that showed all polygons).
    // Deferred first paint: ignore previous uniqueids on the map (turi-only) but
    // keep them in _vhMapUniqueIds so Region/Pie broadcasts do not go empty.
    const deferredMapPaint = this._suppressLegacyVhOnMap;
    const suppressLegacyVh =
      deferredMapPaint || this._vhMapUniqueIds != null;
    return syncRegionYearLayerVisibility(map, {
      yil: this.state.yil,
      viloyat: this.getEffectiveViloyat(),
      tuman: this.state.tuman,
      turi: this.state.turi,
      turlar: this.getSelectedTurlar(),
      vh: suppressLegacyVh ? "" : this.state.vh,
      uniqueIds: deferredMapPaint ? null : this._vhMapUniqueIds,
    });
  };
  private loadNdviBucketIds = async (vhCategory: string): Promise<void> => {
    const ndviDate = (this.state.ndviDate || "").trim();
    if (!ndviDate) return;

    const cfg = (this.props.config || {}) as any;
    const polygonJoinField =
      (cfg.polygonJoinField || "uniqueid").toString().trim() || "uniqueid";

    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return;

    const statusTableValue = VH_TO_NDVI_STATUS[vhCategory];
    if (!statusTableValue) return;

    const ids = new Set<string>();

    const prefix =
      (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";

    let statusField = this._ndviDateFieldMap[ndviDate];
    if (!statusField) {
      const suffix = ndviDate.replace(/-/g, "_");
      statusField = `${prefix}${suffix}`;
    }

    const fields: any[] = (primaryLayer as any).fields || [];
    const hasStatusField = fields.some(
      (f) =>
        (f?.name || "").toString().toLowerCase() === statusField.toLowerCase(),
    );
    if (!hasStatusField) {
      return;
    }

    // Same rule as VH bar: spatial filters only, no yil restriction.
    const baseWhere = this.buildNdviSpatialWhere();
    const whereParts: string[] = [];
    if (baseWhere && baseWhere !== "1=0") whereParts.push(`(${baseWhere})`);
    whereParts.push(
      `${statusField} = '${this.escapeArcGIS(statusTableValue)}'`,
    );
    const where = whereParts.join(" AND ");

    // Page through polygons to collect join IDs.
    const pageSize = 2000;
    let offset = 0;
    let lastSize = 0;
    let safetyCounter = 0;

    while (this._isMounted) {
      const q = primaryLayer.createQuery();
      (q as any).where = where;
      (q as any).outFields = [polygonJoinField];
      (q as any).returnGeometry = false;
      (q as any).resultOffset = offset;
      (q as any).resultRecordCount = pageSize;

      const res = await primaryLayer.queryFeatures(q);
      const features = res?.features ?? [];
      for (const f of features) {
        const v = (f.attributes as any)?.[polygonJoinField];
        if (v != null && v !== "") ids.add(String(v));
      }

      const newSize = ids.size;
      if (features.length < pageSize) break;

      if (newSize === lastSize) {
        break;
      }
      lastSize = newSize;

      safetyCounter++;
      if (safetyCounter > 100) {
        break;
      }
      offset += pageSize;
    }

    this._ndviBucketToIds[vhCategory] = Array.from(ids);
  };

  /* ---------------------- Map Filter Application ---------------------- */

  private async applyFiltersPersistent(
    isCurrent?: () => boolean,
  ): Promise<void> {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;

    // Resolve VH → uniqueids before touching MapImage definitionExpression.
    // VH-only path already resolved once — skip the duplicate table walk.
    // Crop/tuman refreshes defer uniqueids so the map is not blocked by VH
    // paging; AgriBar clicks never set _deferVhUniqueIdResolve.
    if (this._vhUniqueIdsReadyForApply) {
      this._vhUniqueIdsReadyForApply = false;
      this._suppressLegacyVhOnMap = false;
    } else if (this._deferVhUniqueIdResolve) {
      // First paint: map uses geography + turi only (see syncShownRegionYearLayers).
      // Keep previous _vhMapUniqueIds for chart broadcast — nulling them made
      // AgriRegion buildVhScopedWheres return 1=0 ("Ma'lumot topilmadi") until
      // a rebroadcast that never came. NEVER fall back to polygon `vh`.
      this._suppressLegacyVhOnMap = true;
    } else {
      this._suppressLegacyVhOnMap = false;
      await this.resolveVhMapUniqueIds(isCurrent);
      if (isCurrent && !isCurrent()) return;
    }

    const { featureLayers, spatialMapLayers } = this.state;
    let primaryWhere: string | null = null;

    if (featureLayers?.length) {
      featureLayers.forEach((fl) => {
        // includeVh=true attaches uniqueid IN (...) when AgriBar is active.
        let where = this.buildWhereForLayer(fl, true);
        const statusClause = this.buildNdviStatusClauseForCurrentVh();
        if (statusClause && where && where !== "1=0") {
          where = `(${where}) AND (${statusClause})`;
        } else if (this.state.ndviDateLocked && where && where !== "1=0") {
          const dateClause = this.buildNdviDateClauseWithoutVh();
          if (dateClause) {
            where = `(${where}) AND (${dateClause})`;
          }
        }
        if (fl.definitionExpression !== where) fl.definitionExpression = where;
        if (where && where !== "1=0") {
          primaryWhere = where;
        } else if (primaryWhere == null) {
          primaryWhere = where;
        }
      });

      // Agri_table_data has no geometry — mirror the same filter onto
      // FeatureLayer polygon layers, joined by uniqueid.
      // NEVER overwrite MapImage / sublayer definitionExpression here:
      // region-year MapImages are owned by syncRegionYearLayerVisibility
      // (tuman/turi text clauses). A uniqueid-IN rewrite flashes every
      // other district and races the first field click / popup.
      if (spatialMapLayers?.length && primaryWhere != null) {
        try {
          const spatialWhere =
            primaryWhere === "" || primaryWhere === "1=1"
              ? "1=1"
              : primaryWhere === "1=0"
                ? "1=0"
                : buildSpatialJoinWhere(
                    await queryAgriUniqueIdsForWhere(primaryWhere),
                  );
          spatialMapLayers.forEach((sl) => {
            if (isMapImageOwnedLayer(sl)) return;
            if (sl.definitionExpression !== spatialWhere) {
              sl.definitionExpression = spatialWhere;
            }
          });
        } catch {
          /* map visual sync is best-effort; data-side filtering is unaffected */
        }
      }

      // The map's spatial layers are organized one-per-region-per-year (e.g.
      // "agri andijan 2026 year"), not a single filterable polygon layer —
      // Agri_table_data can't represent that, so "filter the map" here means
      // show the one region+year layer matching the current selection,
      // narrowed to the selected tuman and/or crop type (turi) when set —
      // turi comes from AgriPie's widgetSelectionChanged broadcast, same
      // path as viloyat/tuman from AgriRegion.
      try {
        const map = this.state.activeMapView?.view?.map;
        if (map) {
          this._lastShownRegionYearLayers = this.syncShownRegionYearLayers(map);
        }
      } catch {
        /* best-effort; attribute-level data queries are unaffected */
      }

      const effectiveViloyat = this.getEffectiveViloyat();
      const layerDebug = featureLayers.map((fl) => {
        const key = this.getLayerKey(fl);
        const title = ((fl as any)?.title || (fl as any)?.id || key).toString();
        const matchState = this.getLayerMatchStateForViloyat(
          fl,
          effectiveViloyat,
        );
        return {
          title,
          matchState,
          definitionExpression: fl.definitionExpression || "1=0",
          visible: (fl as any)?.visible,
          minScale: (fl as any)?.minScale,
          maxScale: (fl as any)?.maxScale,
          effectiveScale: (this.state.activeMapView?.view as any)?.scale,
        };
      });
      const activeLayerTitles = layerDebug
        .filter((l) => l.definitionExpression !== "1=0")
        .map((l) => l.title);
    }
    this._prevDefinitionExpression = (featureLayers || [])
      .map((fl) => fl.definitionExpression || "1=0")
      .join(" || ");
  }

  private zoomToSelectedDistrict = async (view: any): Promise<boolean> => {
    const district = String(this.state.tuman || "").trim();
    if (!district || !view) return false;

    const districtRequestId = ++this._districtZoomRequestId;
    const entries = [...this._lastShownRegionYearLayers];
    const isCurrent = (): boolean =>
      this._isMounted && districtRequestId === this._districtZoomRequestId;
    const isEmptyExtent = (extent: any): boolean =>
      !extent ||
      (typeof extent.isEmpty === "function"
        ? extent.isEmpty()
        : !extent.width && !extent.height);

    AgriLocalization.agriLog("zoom:district:start", {
      district,
      shownLayerCount: entries.length,
    });

    let mergedExtent: any = null;
    let queriedSublayerCount = 0;

    try {
      for (const entry of entries) {
        if (!isCurrent()) return false;

        const liveSublayers: any[] =
          (entry.layer as any)?.allSublayers?.toArray?.() || [];
        const childSublayers = Array.from(
          new Set<any>([...(entry.sublayers || []), ...liveSublayers]),
        );
        // Leaf FeatureLayer / MapImage Sublayer: DE lives on entry.layer itself.
        const queryTargets =
          childSublayers.length > 0
            ? childSublayers
            : entry.layer
              ? [entry.layer]
              : [];

        AgriLocalization.agriLog("zoom:district:layer", {
          district,
          layer: String((entry.layer as any)?.title || (entry.layer as any)?.id || ""),
          sublayerCount: queryTargets.length,
        });

        for (const sublayer of queryTargets) {
          if (!isCurrent()) return false;

          try {
            // NEVER load/createQuery/queryExtent the live MapImage sublayer —
            // that rehydrates it and can clear its runtime
            // definitionExpression (district filter), so the map exports and
            // flashes every district's fields. Read the live WHERE, then run
            // the extent query on the detached off-map client.
            const where = String(
              (sublayer as any)?.definitionExpression || "1=1",
            ).trim();
            if (!where || where === "1=0") continue;

            const detached = await getDetachedQueryLayerFor(sublayer);
            if (!detached) continue;
            if (!isCurrent()) return false;
            queriedSublayerCount += 1;

            let extent: any = null;
            try {
              const query = detached.createQuery();
              query.where = where;
              query.returnGeometry = true;
              extent = (await detached.queryExtent(query))?.extent;
            } catch (error: any) {
              AgriLocalization.agriLog("zoom:district:query-extent-failed", {
                district,
                sublayer: String((sublayer as any)?.title || (sublayer as any)?.id || ""),
                message: String(error?.message || error),
              });
            }

            // Some services do not support queryExtent — derive the extent
            // from returned shapes instead (still on the detached client).
            if (isEmptyExtent(extent)) {
              const query = detached.createQuery();
              query.where = where;
              query.returnGeometry = true;
              const objectIdField = String(
                (detached as any)?.objectIdField || "OBJECTID",
              );
              query.outFields = [objectIdField];
              const result = await detached.queryFeatures(query);
              for (const feature of result?.features || []) {
                const featureExtent = feature?.geometry?.extent;
                if (isEmptyExtent(featureExtent)) continue;
                extent = extent
                  ? extent.union(featureExtent)
                  : featureExtent.clone?.() || featureExtent;
              }
            }

            if (isEmptyExtent(extent)) continue;
            mergedExtent = mergedExtent
              ? mergedExtent.union(extent)
              : extent.clone?.() || extent;
          } catch (error: any) {
            AgriLocalization.agriLog("zoom:district:sublayer-failed", {
              district,
              sublayer: String((sublayer as any)?.title || (sublayer as any)?.id || ""),
              message: String(error?.message || error),
            });
          }
        }
      }

      if (isEmptyExtent(mergedExtent) || !isCurrent()) {
        AgriLocalization.agriLog("zoom:district:no-extent", {
          district,
          queriedSublayerCount,
        });
        return false;
      }

      AgriLocalization.agriLog("zoom:district:extent", {
        district,
        queriedSublayerCount,
        xmin: mergedExtent.xmin,
        ymin: mergedExtent.ymin,
        xmax: mergedExtent.xmax,
        ymax: mergedExtent.ymax,
      });

      try {
        const animation = view?.animation;
        if (animation?.state === "running" && typeof animation.stop === "function") {
          animation.stop();
        }
      } catch {}
      if (!isCurrent()) return false;

      await view.goTo(mergedExtent.expand(1.03), {
        duration: 700,
        easing: "ease-in-out" as any,
      });
      if (!isCurrent()) return false;

      AgriLocalization.agriLog("zoom:district:goTo", { district });
      return true;
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        AgriLocalization.agriLog("zoom:district:failed", {
          district,
          message: String(error?.message || error),
        });
      }
      return false;
    }
  };
  private applyMapFiltersOptimized = async (
    zoomRequest: MapZoomRequest = { mode: "none", reason: "other" },
    isApplyCurrent?: () => boolean,
  ): Promise<void> => {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;

    const requestId = ++this._zoomRequestId;
    const { featureLayer, featureLayers, activeMapView } = this.state;
    const primaryLayer = featureLayer ?? featureLayers?.[0];
    if (!primaryLayer) return;

    const stillCurrent = () =>
      this._isMounted &&
      requestId === this._zoomRequestId &&
      (!isApplyCurrent || isApplyCurrent());

    // Cover the map only when a region layer is about to be revealed from
    // scratch (opacity 0 / new year-region). Re-filtering tuman/turi on an
    // already-visible opaque layer must stay clickable — otherwise the
    // overlay eats the first polygon click and makes VH bar lag feel like
    // it is blocking the map.
    const expectRegionLayer = !!String(this.getEffectiveViloyat() || "").trim();
    const alreadyOpaqueRegion =
      expectRegionLayer &&
      (this._lastShownRegionYearLayers || []).some(
        (entry) =>
          !!entry?.layer?.visible &&
          Number((entry.layer as any)?.opacity ?? 1) > 0.05,
      );
    const coverForCropReveal =
      expectRegionLayer &&
      (!alreadyOpaqueRegion ||
        zoomRequest.reason === "region" ||
        zoomRequest.reason === "year");
    // VH-only changes: light overlay only when uniqueids are not cached yet.
    // Cached toggles apply DE immediately without blocking the map.
    const vhOnly = zoomRequest.reason === "vegetation";
    const vhCacheWarm =
      vhOnly &&
      !!String(this.state.vh || "").trim() &&
      Array.isArray(this._vhMapUniqueIds);
    // Full-cover reasons that reveal/replace layers. crop/district on an
    // already-opaque region must NOT cover — DE updates are fast there.
    const heavyCoverReasons: MapZoomReason[] = [
      "region",
      "year",
      "ndvi",
      "reset",
    ];
    const coverMap =
      coverForCropReveal ||
      (vhOnly && !vhCacheWarm) ||
      heavyCoverReasons.includes(zoomRequest.reason);
    const coverReason = vhOnly
      ? "vegetation"
      : coverForCropReveal
        ? "crop-renderer"
        : "filter";
    let loadingToken = 0;
    if (coverMap) {
      loadingToken = ++this._mapSurfaceLoadingToken;
      this.setMapSurfaceLoading(true, coverReason);
      // Wait for the dashboard overlay to paint before toggling layers.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }

    const prevExpr = this._prevDefinitionExpression;
    let revealAfterCrop = false;
    const deferVhIds =
      !vhOnly &&
      !!String(this.state.vh || "").trim() &&
      (zoomRequest.reason === "crop" ||
        zoomRequest.reason === "district" ||
        zoomRequest.reason === "district-clear");
    this._deferVhUniqueIdResolve = deferVhIds;
    try {
      await this.applyFiltersPersistent(stillCurrent);
      if (!stillCurrent()) return;

      // Crop/tuman first paint done — resolve VH uniqueids in background and
      // re-apply DE without covering the map again.
      if (deferVhIds && stillCurrent()) {
        this._deferVhUniqueIdResolve = false;
        void (async () => {
          try {
            await this.resolveVhMapUniqueIds(stillCurrent);
            if (!stillCurrent()) {
              // Do not leave the map stuck on turi-only after a superseded
              // apply — the newer apply owns the next uniqueid resolve.
              return;
            }
            this._suppressLegacyVhOnMap = false;
            this._vhUniqueIdsReadyForApply = true;
            await this.applyFiltersPersistent(stillCurrent);
            // Region/Pie/Indicator listen to masterFilterChanged — without
            // this rebroadcast they keep 1=0 / stale ids after VH→crop.
            if (stillCurrent()) {
              this.broadcastFilterState();
            }
          } catch (error: any) {
            AgriLocalization.agriLog(
              "applyMapFiltersOptimized:deferred-vh-FAILED",
              { error: String(error?.message || error) },
            );
            // Keep turi-only paint (suppressLegacy) rather than writing legacy vh.
            if (stillCurrent()) {
              this._suppressLegacyVhOnMap = true;
              this.broadcastFilterState();
            }
          }
        })();
      }

      // Opacity stays at 1 now (leaf/Sublayer paint fix), so revealAfterCrop
      // is often false — still wait for MapImage redraw after region/year
      // crop-renderer so the first paint isn't default symbology.
      revealAfterCrop = (this._lastShownRegionYearLayers || []).some(
        (entry) =>
          !!entry?.layer && Number((entry.layer as any)?.opacity ?? 1) <= 0.05,
      );
      const awaitRedrawAfterCrop =
        revealAfterCrop ||
        zoomRequest.reason === "region" ||
        zoomRequest.reason === "year";
      // Skip crop re-query while VH uniqueid filter is active (or loading):
      // distinct-turi over a huge `uniqueid IN (...)` WHERE is very slow and
      // raced with deferred VH resolve when ekin turi was picked after VH.
      const vhFilterActive = !!String(this.state.vh || "").trim();
      if (
        !vhOnly &&
        !vhFilterActive &&
        this.state.cropRendererMode === "on" &&
        (this._lastShownRegionYearLayers || []).length > 0
      ) {
        await this.syncCropRenderer();
        if (!stillCurrent()) return;
        if (awaitRedrawAfterCrop) await this.waitForShownRegionYearRedraw();
      }
      if (vhOnly) {
        // Apply DE immediately; don't block the UI on a full MapImage export
        // (that was the main perceived lag when switching VH statuses).
        void this.waitForShownRegionYearRedraw(false);
      }
      if (revealAfterCrop) {
        this.setShownRegionYearOpacity(1);
        // One more paint under the spinner so the colored export is on screen
        // before the overlay lifts (avoids a green flash at dismiss).
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }
    } finally {
      this._deferVhUniqueIdResolve = false;
      if (revealAfterCrop) this.setShownRegionYearOpacity(1);
      // Always clear if this call still owns the overlay — including when the
      // apply went stale. Previously we only cleared when stillCurrent, which
      // left the spinner stuck after SKIP-stale-apply races.
      if (coverMap && loadingToken === this._mapSurfaceLoadingToken) {
        this.setMapSurfaceLoading(false, coverReason);
      }
      // Strict: VH selection with zero matching uniqueids → no-data overlay.
      const vhSelected = !!String(this.state.vh || "").trim();
      const vhNoData =
        vhSelected &&
        Array.isArray(this._vhMapUniqueIds) &&
        this._vhMapUniqueIds.length === 0;
      if (stillCurrent()) {
        this.setMapNoData(vhNoData, "vegetation");
      }
    }

    // Admin boundary outlines (Hosted/regions + Hosted/district) for the
    // selected viloyat/tuman. Prefer their extent when zooming.
    let adminBoundaryExtent: any = null;
    let adminBoundaryLevel: "district" | "region" | "none" = "none";
    if (stillCurrent() && activeMapView?.view) {
      try {
        const selection = this.getAdminBoundarySelection();
        if (!selection.viloyat && !selection.tuman) {
          await clearAgriAdminBoundaries(activeMapView.view);
        } else {
          const synced = await syncAgriAdminBoundaries(
            activeMapView.view,
            selection,
          );
          adminBoundaryExtent = synced.extent;
          adminBoundaryLevel = synced.level;
          AgriLocalization.agriLog("zoom:admin-boundary", {
            level: adminBoundaryLevel,
            hasExtent: !!adminBoundaryExtent,
            viloyat: selection.viloyat,
            tuman: selection.tuman,
            regionCode: selection.regionCode ?? null,
            districtCode: selection.districtCode ?? null,
          });
        }
      } catch (error: any) {
        AgriLocalization.agriLog("zoom:admin-boundary:failed", {
          message: String(error?.message || error),
        });
      }
    }

    const expressionDigest = (featureLayers || [])
      .map((layer) => layer.definitionExpression || "1=0")
      .join(" || ");
    const expressionChanged = expressionDigest !== prevExpr;

    const wasPolygonMode = this._prevPolygonModeForZoomGuard;
    this._prevPolygonModeForZoomGuard = this.state.polygonMode;
    const justExitedPolygonMode = wasPolygonMode && !this.state.polygonMode;

    // Geography zooms must run even when the same setState also cleared
    // polygonMode (field → new tuman / Back to viloyat). The old
    // justExitedPolygonMode guard blocked those and left the map stuck on
    // the field extent. Only skip a bare "other" pass that coincides with
    // popup close — AgriPopup restores the pre-field extent itself.
    const geographyZoomReasons: MapZoomReason[] = [
      "region",
      "district",
      "district-clear",
      "year",
      "crop",
      "vegetation",
      "ndvi",
      "reset",
      "polygon-exit",
    ];
    const isGeographyZoom = geographyZoomReasons.includes(zoomRequest.reason);

    const zoomEnabled = this.props.config?.settings?.zoomToSelection !== false;
    const shouldNavigate =
      zoomEnabled &&
      zoomRequest.mode !== "none" &&
      Boolean(activeMapView) &&
      (isGeographyZoom ||
        (!this.state.polygonMode && !justExitedPolygonMode));

    if (!shouldNavigate || !activeMapView) {
      AgriLocalization.agriLog("zoom:SKIP", {
        reason: zoomRequest.reason,
        mode: zoomRequest.mode,
        zoomEnabled,
        polygonMode: this.state.polygonMode,
        justExitedPolygonMode,
        isGeographyZoom,
      });
      this._prevDefinitionExpression = expressionDigest;
      this._allowClearOnce = false;
      return;
    }

    const view = activeMapView.view;
    const isStale = (): boolean =>
      !this._isMounted || requestId !== this._zoomRequestId;
    const isEmptyExtent = (extent: any): boolean =>
      !extent ||
      (typeof extent.isEmpty === "function"
        ? extent.isEmpty()
        : !extent.width && !extent.height);

    const navigate = async (target: any, duration: number): Promise<void> => {
      if (!target || isStale()) return;
      try {
        const animation = (view as any)?.animation;
        if (animation?.state === "running" && typeof animation.stop === "function") {
          animation.stop();
        }
      } catch {}
      if (isStale()) return;
      // view.goTo() can occasionally never settle (interrupted animation, view
      // mid-update) — and this navigate() is awaited inside the
      // handleWidgetSelection apply chain, so a hung goTo would leave `loading`
      // (the map spinner) stuck forever. This bit users when deselecting a
      // viloyat (mode:"home"). Race goTo against a timeout and swallow the
      // expected AbortError so the chain always continues and loading clears.
      try {
        await Promise.race([
          view.goTo(target, {
            duration,
            easing: "ease-in-out" as any,
          }),
          new Promise<void>((resolve) => setTimeout(resolve, duration + 1200)),
        ]);
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          AgriLocalization.agriLog("zoom:navigate:failed", {
            message: String(error?.message || error),
          });
        }
      }
    };

    /**
     * Extent of the currently shown region-year MapImage layer(s), using the
     * live definitionExpression (tuman/turi when set, else whole viloyat).
     * Never unions every spatialMapLayers entry — those are MapImage leaves
     * for ALL regions and would zoom to the entire republic.
     */
    const queryShownRegionYearExtent = async (): Promise<any | null> => {
      let merged: any = null;
      let queried = 0;
      for (const entry of this._lastShownRegionYearLayers) {
        if (isStale()) return null;
        const liveSublayers: any[] =
          (entry.layer as any)?.allSublayers?.toArray?.() || [];
        const childSublayers = Array.from(
          new Set<any>([...(entry.sublayers || []), ...liveSublayers]),
        );
        // Leaf FeatureLayer / MapImage Sublayer: query the leaf itself.
        const queryTargets =
          childSublayers.length > 0
            ? childSublayers
            : entry.layer
              ? [entry.layer]
              : [];
        for (const sublayer of queryTargets) {
          if (isStale()) return null;
          try {
            const where = String(
              (sublayer as any)?.definitionExpression || "1=1",
            ).trim();
            if (!where || where === "1=0") continue;
            const detached = await getDetachedQueryLayerFor(sublayer);
            if (!detached) continue;
            if (isStale()) return null;
            queried += 1;
            const query = detached.createQuery();
            query.where = where;
            query.returnGeometry = true;
            const extent = (await detached.queryExtent(query))?.extent;
            if (isEmptyExtent(extent)) continue;
            merged = merged ? merged.union(extent) : extent.clone?.() || extent;
          } catch {
            /* try next sublayer */
          }
        }
        if (isEmptyExtent(merged)) {
          const full = (entry.layer as any)?.fullExtent;
          if (!isEmptyExtent(full)) {
            merged = merged ? merged.union(full) : full.clone?.() || full;
          }
        }
      }
      AgriLocalization.agriLog("zoom:shown-region-extent", {
        reason: zoomRequest.reason,
        queriedSublayerCount: queried,
        hasExtent: !isEmptyExtent(merged),
        xmin: merged?.xmin,
        ymin: merged?.ymin,
        xmax: merged?.xmax,
        ymax: merged?.ymax,
      });
      return isEmptyExtent(merged) ? null : merged;
    };

    try {
      AgriLocalization.agriLog("zoom:navigate-start", {
        reason: zoomRequest.reason,
        mode: zoomRequest.mode,
        viloyat: this.getEffectiveViloyat(),
        tuman: this.state.tuman,
        shownLayerCount: (this._lastShownRegionYearLayers || []).length,
        adminBoundaryLevel,
      });

      if (zoomRequest.reason === "district" && this.state.tuman) {
        if (!isEmptyExtent(adminBoundaryExtent) && !isStale()) {
          AgriLocalization.agriLog("zoom:district:admin-boundary", {
            district: this.state.tuman,
          });
          await navigate(adminBoundaryExtent.expand(1.08), 700);
          return;
        }
        const districtZoomed = await this.zoomToSelectedDistrict(view);
        if (districtZoomed) {
          AgriLocalization.agriLog("zoom:district:done", {
            district: this.state.tuman,
          });
        } else {
          // Fall through to shown-region extent if district query failed.
          const fallback = await queryShownRegionYearExtent();
          if (!isEmptyExtent(fallback) && !isStale()) {
            AgriLocalization.agriLog("zoom:district:fallback-region", {});
            await navigate(fallback.expand(1.03), 700);
          }
        }
        return;
      }

      if (zoomRequest.mode === "home") {
        const now = Date.now();
        if (now - this._lastHomeGoToAt < 450 || isStale()) return;

        try {
          await clearAgriAdminBoundaries(view);
        } catch {
          /* ignore */
        }

        let home: any = this._homeExtent;
        if (!home) home = (view.map as any)?.fullExtent || primaryLayer.fullExtent;
        if (!home && (primaryLayer as any)?.geometryType) {
          try {
            home = (
              await primaryLayer.queryExtent(primaryLayer.createQuery())
            )?.extent;
          } catch {}
        }

        if (!isEmptyExtent(home) && !isStale()) {
          this._lastHomeGoToAt = now;
          AgriLocalization.agriLog("zoom:home:goTo", {});
          await navigate(home, 800);
        }
        return;
      }

      // Region / back-from-district / polygon-exit: only the shown
      // region-year layer. Do NOT query every spatialMapLayers MapImage
      // leaf (that unions Andijan+Tashkent+… and zooms to the whole map).
      const preferShownRegionExtent =
        zoomRequest.reason === "region" ||
        zoomRequest.reason === "district-clear" ||
        zoomRequest.reason === "polygon-exit";

      let mergedExtent: __esri.Extent | null = null;

      if (
        preferShownRegionExtent &&
        !isEmptyExtent(adminBoundaryExtent) &&
        adminBoundaryLevel === "region"
      ) {
        mergedExtent = adminBoundaryExtent;
        AgriLocalization.agriLog("zoom:region:admin-boundary", {
          reason: zoomRequest.reason,
        });
      }

      if (preferShownRegionExtent && isEmptyExtent(mergedExtent)) {
        mergedExtent = await queryShownRegionYearExtent();
      } else if (!preferShownRegionExtent) {
        // Crop / NDVI / vegetation: prefer non-MapImage spatial FeatureLayers
        // that carry the uniqueid mirror; skip MapImage-owned leaves.
        for (const spatialLayer of this.state.spatialMapLayers || []) {
          if (isStale()) return;
          if (isMapImageOwnedLayer(spatialLayer)) continue;
          try {
            if (typeof (spatialLayer as any)?.load === "function") {
              await (spatialLayer as any).load();
            }
            if (!(spatialLayer as any)?.geometryType) continue;
            const where = (spatialLayer as any)?.definitionExpression || "1=1";
            if (where === "1=0") continue;
            const query = (spatialLayer as any)?.createQuery
              ? (spatialLayer as any).createQuery()
              : {};
            query.where = where;
            const result = await (spatialLayer as any).queryExtent(query);
            if (isStale()) return;
            const extent = result?.extent;
            if (isEmptyExtent(extent)) continue;
            mergedExtent = mergedExtent
              ? mergedExtent.union(extent)
              : extent.clone();
          } catch {
            /* continue */
          }
        }

        if (!mergedExtent) {
          mergedExtent = await queryShownRegionYearExtent();
        } else if (this.state.tuman || this.getSelectedTurlar().length) {
          // Narrow FeatureLayer union further using shown MapImage DE when
          // crop/NDVI zoom needs the live tuman/turi clause.
          const shown = await queryShownRegionYearExtent();
          if (!isEmptyExtent(shown)) mergedExtent = shown;
        }
      }

      if (!isEmptyExtent(mergedExtent) && !isStale()) {
        const expandFactor =
          zoomRequest.reason === "district" ||
          zoomRequest.reason === "polygon-exit"
            ? 1.03
            : zoomRequest.reason === "crop" ||
                zoomRequest.reason === "vegetation" ||
                zoomRequest.reason === "ndvi"
              ? 1.12
              : 1.18;
        AgriLocalization.agriLog("zoom:goTo", {
          reason: zoomRequest.reason,
          expandFactor,
        });
        await navigate(mergedExtent!.expand(expandFactor), 700);
      } else if (!this.getEffectiveViloyat() && !isStale()) {
        const home = this._homeExtent || (view.map as any)?.fullExtent;
        if (!isEmptyExtent(home)) {
          AgriLocalization.agriLog("zoom:goTo-home-fallback", {});
          await navigate(home, 800);
        }
      } else {
        AgriLocalization.agriLog("zoom:no-extent", {
          reason: zoomRequest.reason,
          shownLayerCount: (this._lastShownRegionYearLayers || []).length,
        });
      }
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        AgriLocalization.agriLog("zoom:navigation-failed", {
          reason: zoomRequest.reason,
          message: String(error?.message || error),
        });
      }
    } finally {
      this._allowClearOnce = false;
      this._prevDefinitionExpression = expressionDigest;
    }
  };

  private fetchDataWithCurrentState = async () => {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;
    const requestId = ++this._filterDataRequestId;
    const isCurrent = () => this._isMounted && requestId === this._filterDataRequestId;
    try {
      this.setState({ loading: true, error: null });

      const { featureLayers } = this.state;
      const layers = featureLayers?.length
        ? featureLayers
        : this.state.featureLayer
          ? [this.state.featureLayer]
          : [];
      if (!layers.length) {
        this.setState({ loading: false, error: "No feature layer available" });
        return;
      }

      // Also ask the service for the true total count with this WHERE, independent of page limits.
      let totalCountFromService = 0;

      for (const featureLayer of layers) {
        let whereClause = this.buildWhereForLayer(featureLayer, false);
        const statusClause = this.buildNdviStatusClauseForCurrentVh();
        if (statusClause && whereClause && whereClause !== "1=0") {
          whereClause = `(${whereClause}) AND (${statusClause})`;
        }
        if (!whereClause || whereClause === "1=0") continue;

        try {
          if ((featureLayer as any)?.queryFeatureCount) {
            totalCountFromService += await (
              featureLayer as any
            ).queryFeatureCount({ where: whereClause });
          } else {
            const countResult = await featureLayer.queryFeatures({
              where: whereClause,
              returnGeometry: false,
              outFields: ["objectid"],
              returnCountOnly: true,
            } as any);
            const oneCount =
              typeof (countResult as any)?.count === "number"
                ? (countResult as any).count
                : ((countResult as any)?.totalCount ?? 0);
            totalCountFromService += Number(oneCount || 0);
          }
        } catch {
          // keep going with remaining layers
        }

        if (!isCurrent()) return;
      }

      if (!isCurrent()) return;

      // DEBUG: log polygon counts for current yil / viloyat / tuman / turi selection
      const { yil, viloyat, tuman, turi } = this.state;
      const activeLayers = layers
        .filter((fl) => (fl.definitionExpression || "1=0") !== "1=0")
        .map((fl) =>
          ((fl as any)?.title || (fl as any)?.id || "layer").toString(),
        );

      AgriLocalization.agriLog("fetchDataWithCurrentState:count-complete", {
        requestId,
        totalCount: totalCountFromService,
        yil,
        viloyat,
        tuman,
      });
      const hasScopedFilter =
        !!String(this.getEffectiveViloyat() || "").trim() ||
        !!String(tuman || "").trim() ||
        !!String(turi || "").trim() ||
        this.getSelectedTurlar().length > 0 ||
        !!String(this.state.vh || "").trim();
      const vhSelected = !!String(this.state.vh || "").trim();
      if (vhSelected) {
        const vhMapEmpty =
          Array.isArray(this._vhMapUniqueIds) &&
          this._vhMapUniqueIds.length === 0;
        this.setMapNoData(vhMapEmpty, "vegetation");
      } else {
        this.setMapNoData(
          hasScopedFilter && totalCountFromService === 0,
          "data",
        );
      }
      this.setState({
        records: [],
        totalRecordCount: totalCountFromService,
        loading: false,
        error: null,
      });
    } catch (e: any) {
      if (!isCurrent()) return;
      this.setState({
        error: e?.message || "Unexpected error",
        loading: false,
      });
    }
  };

  /* ---------------------- Render ---------------------- */

  render() {
    const {
      loading,
      error,
      yilOptions,
      yil,
      viloyat,
      lockedViloyat,
      connectionStatus,
      ndviDate,
      ndviDateOptions,
      isDarkTheme,
      graffSearchText,
      openToolbarMenu,
    } = this.state;

    const { language } = this.state as any;

    const yilLabel =
      language === "en" ? "Year" : language === "ru" ? "Год" : language === "uz_lat" ? "Yil" : "Йил";

    const indexInfoLabel =
      language === "en"
        ? "About indices"
        : language === "ru"
          ? "Инфо про индексы"
        : language === "uz_lat"
          ? "Indekslar haqida"
          : "Индекслар ҳақида";

    const langLabel =
      language === "en" ? "Language" : language === "ru" ? "Язык" : language === "uz_lat" ? "Til" : "Тил";

    const themeLabel =
      language === "en" ? "Theme" : language === "ru" ? "Тема" : language === "uz_lat" ? "Tema" : "Тема";

    const logoutLabel =
      language === "en" ? "Log out" : language === "ru" ? "Выйти" : language === "uz_lat" ? "Chiqish" : "Чиқиш";

    const graffSearchPlaceholder =
      language === "en"
        ? "TIN or farmer name"
        : language === "ru"
          ? "ИНН или название фермера"
        : language === "uz_lat"
          ? "STIR yoki fermer nomi"
          : "СТИР ёки фермер номи";

    return (
      <div
        className={`evapo-region-card agri-v20-root ${isDarkTheme ? "dark-theme" : "light-theme"}`}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
            pointerEvents: "none",
            opacity: 0,
          }}
        >
          {!this.props.useMapWidgetIds?.length &&
            this.getEffectiveUseDataSources().length > 0 &&
            this.getEffectiveUseDataSources()
              .slice(0, 1)
              .map((uds: any) => (
                <DataSourceComponent
                  key={uds?.dataSourceId ?? uds?.id ?? Math.random()}
                  useDataSource={uds}
                  onDataSourceCreated={this.onDataSourceCreated}
                  onDataSourceInfoChange={this.onDataSourceInfoChange}
                />
              ))}
          {this.props.useMapWidgetIds?.length > 0 && (
            <JimuMapViewComponent
              useMapWidgetId={this.props.useMapWidgetIds[0]}
              onActiveViewChange={this.onActiveViewChange}
            />
          )}
        </div>

        <div className="evapo-region-content">
          {connectionStatus === "connecting" && (
            <div
              className="evapo-region-loading-container"
              style={{ minHeight: 80 }}
            />
          )}

          {connectionStatus === "failed" && (
            <div className="evapo-region-error">
              <p>{error || "Failed to connect. Please retry."}</p>
              <button
                onClick={this.retryMapConnection}
                className="evapo-region-retry-button"
              >
                Retry
              </button>
            </div>
          )}

          {connectionStatus === "connected" && (
            <>
              {error && !loading && (
                <div
                  className="evapo-region-error"
                  style={{ height: "auto", padding: 0, marginBottom: 6 }}
                >
                  <p style={{ margin: 0 }}>{error}</p>
                </div>
              )}

              <div className="agri-v20-main-layout">
                <div className="agri-v20-header-row">
                  <div className="agri-v20-brand">
                    <img
                      src={logoImage}
                      alt="UZCOSMOS"
                      className="agri-v20-brand-logo"
                    />
                    <div className="agri-v20-brand-text">
                      <h1 className="agri-v20-brand-title">Space Agro Monitoring</h1>
                    </div>
                  </div>

                  <div
                    className="agri-v20-graff-search-wrap"
                    ref={this._graffSearchWrapRef}
                  >
                    <span className="agri-v20-graff-search-icon">
                      <SearchIcon />
                    </span>
                    <input
                      className="agri-v20-graff-search-input"
                      type="text"
                      value={graffSearchText}
                      onChange={this.handleGraffSearchInputChange}
                      placeholder={graffSearchPlaceholder}
                      autoComplete="off"
                    />
                    {graffSearchText ? (
                      <button
                        type="button"
                        className="agri-v20-graff-search-clear"
                        onClick={this.handleGraffSearchClear}
                        aria-label={
                          language === "en"
                            ? "Clear"
                            : language === "ru"
                            ? "Очистить"
                            : language === "uz_lat"
                              ? "Tozalash"
                              : "Тозалаш"
                        }
                        title={
                          language === "en"
                            ? "Clear"
                            : language === "ru"
                            ? "Очистить"
                            : language === "uz_lat"
                              ? "Tozalash"
                              : "Тозалаш"
                        }
                      >
                        ×
                      </button>
                    ) : null}
                  </div>

                  <div className="agri-v20-toolbar-group">
                    <div
                      className="agri-v20-toolbar-item"
                      ref={this._indexInfoToolbarItemRef}
                    >
                      <button
                        type="button"
                        className={`agri-v20-toolbar-btn ${openToolbarMenu === "indexInfo" ? "is-active" : ""}`}
                        onClick={() => this.toggleToolbarMenu("indexInfo")}
                        title={indexInfoLabel}
                        aria-label={indexInfoLabel}
                        aria-pressed={openToolbarMenu === "indexInfo"}
                      >
                        <InfoIcon />
                      </button>
                    </div>

                    <div
                      className="agri-v20-toolbar-item"
                      ref={this._yilToolbarItemRef}
                    >
                      <button
                        type="button"
                        className={`agri-v20-toolbar-btn ${openToolbarMenu === "yil" ? "is-active" : ""}`}
                        onClick={() => this.toggleToolbarMenu("yil")}
                        title={yilLabel}
                        aria-pressed={openToolbarMenu === "yil"}
                      >
                        <CalendarIcon />
                      </button>
                    </div>

                    <div
                      className="agri-v20-toolbar-item"
                      ref={this._languageToolbarItemRef}
                    >
                      <button
                        type="button"
                        className={`agri-v20-toolbar-btn agri-v20-language-btn ${openToolbarMenu === "language" ? "is-active" : ""}`}
                        onClick={() => this.toggleToolbarMenu("language")}
                        title={langLabel}
                        aria-pressed={openToolbarMenu === "language"}
                      >
                        <LanguageIcon
                          active={openToolbarMenu === "language"}
                          isLight={!isDarkTheme}
                        />
                      </button>
                    </div>

                    <div className="agri-v20-toolbar-item">
                      <button
                        type="button"
                        className={`agri-v20-theme-toggle ${isDarkTheme ? "agri-v20-theme-toggle--dark" : ""}`}
                        role="switch"
                        aria-label={themeLabel}
                        aria-checked={isDarkTheme}
                        onClick={() =>
                          this.applyThemeByValue(isDarkTheme ? "light" : "dark")
                        }
                      >
                        <SunIcon className="agri-v20-theme-toggle__icon agri-v20-theme-toggle__icon--sun" />
                        <MoonIcon className="agri-v20-theme-toggle__icon agri-v20-theme-toggle__icon--moon" />
                        <span
                          className="agri-v20-theme-toggle__thumb"
                          aria-hidden="true"
                        >
                          {isDarkTheme ? (
                            <MoonIcon size={13} />
                          ) : (
                            <SunIcon size={13} />
                          )}
                        </span>
                      </button>
                    </div>

                    <div className="agri-v20-toolbar-item agri-v20-profile-wrapper">
                      <button
                        type="button"
                        className={`agri-v20-toolbar-btn agri-v20-logout-btn${this.state.showProfileMenu ? " agri-v20-profile-open" : ""}`}
                        onClick={this.toggleProfileMenu}
                        disabled={connectionStatus !== "connected"}
                        title={logoutLabel}
                        aria-label={logoutLabel}
                        aria-haspopup="menu"
                        aria-expanded={this.state.showProfileMenu}
                      >
                        {getAccountDisplayInfo().initial}
                      </button>
                      {this.state.showProfileMenu &&
                        ReactDOM.createPortal(
                          <div className={`agri-v20-root ${isDarkTheme ? "dark-theme" : "light-theme"}`}>
                            <div
                              className="agri-v20-profile-backdrop"
                              onClick={() => this.setState({ showProfileMenu: false })}
                            />
                            <div className="agri-v20-profile-dropdown" role="menu">
                              <div className="agri-v20-profile-header">
                                <div className="agri-v20-profile-name">
                                  {getAccountDisplayInfo().displayName || logoutLabel}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="agri-v20-profile-logout-item"
                                role="menuitem"
                                onClick={this.handleLogout}
                              >
                                <LogoutIcon />
                                <span>{logoutLabel}</span>
                              </button>
                            </div>
                          </div>,
                          document.body,
                        )}
                    </div>
                  </div>
                </div>

                {/* Footer: Display current yil and viloyat selection */}
                {/* <div className="agri-v20-footer">
                  <div className="agri-v20-footer-content">
                    <span className="agri-v20-footer-item">
                      <span className="agri-v20-footer-label">yil:</span>
                      <span className="agri-v20-footer-value">{yil}</span>
                    </span>
                    <span className="agri-v20-footer-separator">•</span>
                    <span className="agri-v20-footer-item">
                      <span className="agri-v20-footer-label">vil:</span>
                      <span className="agri-v20-footer-value">
                        {lockedViloyat || viloyat}
                      </span>
                    </span>
                  </div>
                </div> */}
              </div>

              {this.renderGraffSearchDropdownFloating()}
              {this.renderYilMenuFloating()}
              {this.renderLanguageMenuFloating()}
              {this.renderIndexInfoMenuFloating()}
            </>
          )}
        </div>
      </div>
    );
  }
}

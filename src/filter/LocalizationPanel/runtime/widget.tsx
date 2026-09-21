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
import { Bell, Calendar, ChevronDown, ChevronRight, FunctionSquare, Info, Sprout, X } from "lucide-react";
import logoImage from "../assets/uzcosmos logo white.svg";
import languageDarkIcon from "../assets/Frame.svg";
import languageLightIcon from "../assets/Frame-light.svg";
import languageActiveIcon from "../assets/Frame-1.svg";
import "./AgriFilter.css";
import {
  dispatchMapClick,
  dispatchMapViewReady,
} from "../../../gis/agri-data-layer-roles";
import {
  getDetachedQueryLayerFor,
  getMapImageParentLayer,
  getQueryableLayer,
  isMapImageGroupSublayer,
  isMapImageOwnedLayer,
  ensureRegionYearMapImagesReady,
  preloadRegionYearMapImages,
  refreshRegionYearMapExports,
  unlockShownRegionYearFieldScales,
  safeLoadMapImageTree,
  safeLoadMapLayer,
  syncRegionYearLayerVisibility,
  withAgriAccessWhere,
  regionSoatoToDisplayName,
  type ShownRegionYearLayer,
} from "../../../gis/feature-layer-data";
import {
  clearAgriAdminBoundaries,
  queryAgriAdminBoundaryExtentOnly,
  syncAgriAdminBoundaries,
} from "../../../gis/agri-admin-boundary-layer";
import { logoutFromAccount } from "../../../shared/agri-logout";
import { getAccountDisplayInfo } from "../../../shared/getAccountDisplayInfo";
import {
  buildTurlarSqlClause,
  getTuriCropLookupKey,
} from "../../../shared/agri-crop-labels";
import {
  isAccessDenied,
  isAccessConfigured,
  lockedViloyat as accessLockedViloyat,
  resolveAllowedViloyatsForGroups,
} from "../../../shared/agri-access-config";
import {
  getAgriTableDataLayer,
  getAgriTableDataUrl,
  queryAgriUniqueIdsForWhere,
  queryAgriUniqueIdsForFarmerInn,
  buildSpatialJoinWhere,
} from "../../../gis/agri-table-data-source";
import { getAgriServiceUrls } from "../../../shared/agri-service-urls";
import {
  DS_ONLY_RETRY_DELAY_MS,
  MAP_CONNECTION_RETRY_MS,
  MAX_DS_ONLY_RETRIES,
  MAX_MAP_CONNECTION_ATTEMPTS,
} from "../../../shared/map-connection-service";
import {
  getAgriVegetationIndicesLayer,
  queryVegetationAvailableDates,
  queryVegetationRecentDayRegionCounts,
  queryVegetationUniqueIdsForStatus,
  type VegetationRecentDayGroup,
} from "../../../gis/agri-vegetation-data-source";
import {
  clearPieVhFilterUniqueIds,
  deriveChartFilterFlags,
  getPieVhFilterUniqueIdsSig,
  setPieVhFilterUniqueIds,
  upsertChartDimOrder,
  type ChartDim,
  type ChartFilterFlags,
} from "../../../gis/agri-chart-filter-order";
import { agroV5Log } from "../../../gis/agri-debug-log";
import { getAgriDashboardBootstrap } from "../../../data/agri-bootstrap";
import { translateAgriPlaceForDisplay } from "../../../shared/agri-place-display";
import {
  getMasterFilterSnapshot,
  syncMasterFilterSnapshot,
} from "../../../data/agri-filter-store";
import {
  dedupedQueryFeatureCount,
  dedupedQueryFeatures,
} from "../../../data/agri-query-gateway";
import {
  escapeArcGIS,
  escapeLikeLiteral,
  eqAposSmart as eqAposSmartShared,
  buildTumanEqualsSql,
} from "../../../data/agri-sql";
import { normalizeUniqueidKey } from "../../../data/agri-uniqueid-sql";
import {
  buildYearLikeClause,
} from "../../../controller/agri-where-builder";

import { applyAppBackgroundTheme } from "../../localization/app-theme";
import {
  buildCropUniqueValueInfosFromValues as buildCropUniqueValueInfosShared,
  CROP_RENDERER_ITEMS,
  createCropFillSymbol,
  normalizeCropKey,
  resolveCropRendererColor,
  type CropRendererMode,
} from "../../localization/crop-renderer";
import { resolveStoredAgriLanguage } from "../../localization/lang";
import {
  VH_TO_NDVI_STATUS,
  type VHBarData,
  type VHBarDataItem,
} from "../../localization/vh-constants";

import {
  buildVhBarComputeKey,
} from "../../localization/vh-bar-aggregate";
import { executeVhBarCompute } from "../../localization/vh-bar-compute";
import {
  makeRegionDistrictKey as makeRegionDistrictKeyShared,
  normalizeLocalizationApos,
} from "../../localization/geo-keys";
import {
  buildBarCategoryBroadcast,
  buildBroadcastGeoSnapshot,
  isBroadcastGeoCurrent,
  normalizeTurlarList,
  resolveVhUniqueidSlices,
} from "../../localization/broadcast-detail";
import {
  assembleLocalizationWhere,
  buildNdviDateNotNullSqlClause,
  buildNdviStatusEqualsSqlClause,
  buildNdviTableWhereWithRegion,
  buildTableDateEqualsWhere,
  buildUniqueIdSqlClause,
  buildViloyatRegionSqlClause,
  buildYearClauseForLayerFields,
} from "../../localization/map-where-clauses";
import {
  buildCropDistinctCacheKey,
  findLayerFieldName as findLayerFieldNameShared,
  getFeatureLayerKey,
  getLayerMatchStateForViloyat as getLayerMatchStateForViloyatShared,
} from "../../localization/layer-utils";
import {
  buildDefinitionExpressionDigest,
  decideMapSurfaceCover,
  isEmptyMapExtent,
  isGeographyZoomReason,
  shouldDeferCropForFastReveal,
  shouldDeferVhUniqueIdResolve,
  shouldNavigateMapZoom,
  type MapZoomMode,
  type MapZoomReason,
  type MapZoomRequest,
} from "../../localization/map-zoom-policy";
import {
  augmentWhereWithNdviClauses,
  decideVhUniqueIdApplyPhase,
  isAgriTableDataUrl,
  isShownRegionYearLayerOpaque,
  pickPrimaryWhereForSpatialJoin,
  shouldForceRegionYearMapExportRefresh,
  spatialWhereFromPrimarySync,
} from "../../localization/map-filter-apply";
import {
  districtAdminExpandFactor,
  districtFallbackRegionExpandFactor,
  homeGoToDurationMs,
  isDistrictZoomPath,
  pickHomeExtentCandidate,
  planCropNdviExtentSource,
  preferShownRegionYearExtent,
  raceRegionExtentPick,
  shouldSkipHomeGoTo,
  zoomExpandFactorForReason,
  zoomGoToDurationMsForReason,
} from "../../localization/map-zoom-target";
import {
  appendSpatialFeatureExtent,
  canQuerySpatialFeatureExtent,
  collectShownRegionYearQueryTargets,
  readQueryableDefinitionExpression,
  readSpatialFeatureExtentWhere,
  unionMapExtents,
  unionShownRegionYearFullExtents,
} from "../../localization/map-shown-extent";
import {
  buildVhUniqueIdCacheKey,
  hasDistrictMappingForSelection,
  listDistrictsForViloyat,
  resolveDistrictNumberFromMaps,
  resolveRegionNumberFromMaps,
  storeScopedRegionDistrictMapping,
} from "../../localization/resolve-geo-codes";
import { normalizeConnectionId } from "../../localization/connection-ids";

export type { VHBarData, VHBarDataItem };

const WIDGET_ID = "AgriLocalizationV20-Master";
const FAIL_OPEN_IF_NO_MATCH = false;

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
   * Exact STIR (`f_inn`) from header search — scopes pie / VH / map to that
   * farmer's parcels (not a single uniqueid).
   */
  selectedFarmerInn?: string;
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
  openToolbarMenu: "yil" | "language" | "indexInfo" | "notifications" | null;
  /** Index (NDVI/SAVI/…) currently expanded to its full detail page within the indexInfo menu. */
  selectedIndexInfoKey: string | null;
  notificationDays: VegetationRecentDayGroup[];
  notificationLoading: boolean;
  notificationError: string | null;
  notificationCanScrollDown: boolean;
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

const BellIcon = () => (
  <Bell className="agri-toolbar-svg" strokeWidth={1.8} aria-hidden="true" />
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
  /**
   * After geography goTo, MapImage export is often aborted mid-flight — fields
   * stay blank until a manual zoom. These timers reassert DE + refresh once
   * the view has settled.
   */
  private _regionYearSettleRepaintTimers: ReturnType<typeof setTimeout>[] = [];
  private _zoomRequestId = 0;
  private _districtZoomRequestId = 0;
  /** Only the newest filter-data request may finish the global loading state. */
  private _filterDataRequestId = 0;
  /** Only the newest graff autocomplete query may apply results. */
  private _graffAutoCompleteRequestId = 0;
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
  private _notificationsToolbarItemRef = React.createRef<HTMLDivElement>();
  private _notificationBodyRef = React.createRef<HTMLDivElement>();
  private _notificationLoadToken = 0;

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
   * Scoped to the selected tuman when one is set — used for map DE only.
   */
  private _vhMapUniqueIds: string[] | null = null;
  /**
   * Same VH(+crop) uniqueids at viloyat/region scope (no district). Used by
   * AgriRegion "Tumanlar kesimida" so selecting a tuman + VH still shows every
   * district's bar, not only the focused tuman.
   */
  private _vhRegionChartUniqueIds: string[] | null = null;
  /**
   * Uniqueids for the header STIR (`selectedFarmerInn`) selection — scopes
   * MapImage + VH bar the same way VH uniqueids do.
   */
  private _farmerMapUniqueIds: string[] | null = null;
  /** True while applying a header STIR selection (skip geo-echo search clear). */
  private _farmerSearchApplying = false;
  /**
   * Geography before a committed STIR selection — restored when search is
   * cleared (X) so republic / viloyat / tuman return to the prior scope.
   */
  private _preFarmerSearchGeo: { viloyat: string; tuman: string } | null = null;
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
  /**
   * Cache: status|date|region|district|crops → uniqueids.
   * The key carries the full query scope, so entries stay valid across
   * viloyat/tuman switches — going back to a previous geography must not
   * re-page the whole uniqueid list. Bounded instead of cleared.
   */
  private _vhUniqueIdCache: Record<string, string[]> = {};
  /** Max entries kept in `_vhUniqueIdCache` (oldest inserted dropped first). */
  private static readonly VH_UNIQUEID_CACHE_MAX = 96;
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
  /**
   * True when `_vhMapUniqueIds` were resolved with vegetation `crop_id`
   * (crop selected before VH). False when VH-first / crop_id fallback — map
   * must AND MapImage `turi` text with the status-wide uniqueids.
   */
  private _vhUniqueIdsCropScoped = false;

  /** Mapping of logical NDVI date (e.g. '2025-06-12') → polygon status field name (e.g. 'status_2025_06_12'). */
  private _ndviDateFieldMap: Record<string, string> = {};

  /** Viloyat name → region number (from layer attribute `region`). Used to filter by code instead of name. */
  private _viloyatToRegion: Record<string, number> = {};
  /** Region number → viloyat display name (from Agri_table_data). Used by notifications. */
  private _regionToViloyat: Record<string, string> = {};
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
  /**
   * Geography (`viloyat|tuman`) the bar date above was proved on. Available
   * NDVI dates differ per viloyat, so the date may only be trusted as-is for
   * the same scope; elsewhere it is just the first candidate to probe.
   */
  private _vhBarUsedDateGeo: string | null = null;
  /** Layer identity -> normalized viloyat keys found in that layer. */
  private _layerToViloyatKeys: Record<string, string[]> = {};
  /** Normalized viloyat key -> layer identities that contain that viloyat. */
  private _viloyatKeyToLayerKeys: Record<string, string[]> = {};

  // Canonicalize keys used for viloyat/tuman → region/district dictionaries
  private makeRegionDistrictKey(raw: string | null | undefined): string {
    return makeRegionDistrictKeyShared(raw);
  }

  private resolveCropIdForTuri = (turi: string): string | undefined => {
    const key = getTuriCropLookupKey(turi);
    return key ? this._turiToCropId[key] : undefined;
  };

  private getLayerKey(layer: __esri.FeatureLayer): string {
    return getFeatureLayerKey(layer);
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
    districtNames?: string[];
    districtCodes?: number[];
  } {
    const viloyat = this.getEffectiveViloyat();
    const tuman = this.normalizeApos(String(this.state.tuman || ""));
    const helpers = this.getGeoCodeHelpers();
    const regionCode = resolveRegionNumberFromMaps(
      viloyat,
      this._viloyatToRegion,
      helpers,
    );
    // Admin borders (Tuman_chegara) filter by SOATO. Pass the mapped district
    // code for named tumans so a single-district outline can use soato=, not
    // fragile name matching (Yakkabog' apostrophe variants often miss).
    // Map/table WHERE still prefers tuman text — see buildTumanDistrictClause.
    const districtCode = resolveDistrictNumberFromMaps(
      tuman,
      this._tumanToDistrict,
      helpers,
      {
        rawViloyat: viloyat,
        viloyatToRegion: this._viloyatToRegion,
      },
    );
    const listed = listDistrictsForViloyat(
      viloyat,
      this._tumanToDistrict,
      this._viloyatToRegion,
      helpers,
    );
    return {
      viloyat,
      tuman,
      regionCode,
      districtCode,
      districtNames: listed.names,
      districtCodes: listed.codes,
    };
  }

  private findLayerFieldName(
    layer: __esri.FeatureLayer,
    name: string,
  ): string | null {
    return findLayerFieldNameShared(layer, name);
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
        if (sub?.visible !== false && !isMapImageGroupSublayer(sub)) {
          fromLoaded.push(sub);
        }
      }
      if (fromEntry.length || fromLoaded.length) {
        candidates.push(...fromEntry, ...fromLoaded);
      } else if ((entry as any)?.layer) {
        candidates.push((entry as any).layer);
      }
    }

    const seen = new Set<any>();
    return candidates.filter((layer) => {
      if (!layer || seen.has(layer) || isMapImageGroupSublayer(layer)) {
        return false;
      }
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
  ): string => buildCropDistinctCacheKey(layer, field, where);

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
  ): any[] =>
    buildCropUniqueValueInfosShared(
      field,
      distinctValues,
      this._turiToCropId || {},
    );

  private refreshCropLayer = (layer: any): void => {
    // MapImage dynamic drawing is owned by the parent service layer —
    // refreshing both leaf + parent aborts the first export (canceled
    // MapServer `export` / sublayer id rows in DevTools).
    try {
      if (isMapImageOwnedLayer(layer)) {
        const parent =
          getMapImageParentLayer(layer) || layer?.layer || layer;
        parent?.refresh?.();
        return;
      }
      layer.refresh?.();
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
      } catch (err) {
        AgriLocalization.debugCatch("cropRenderer:restore-failed", err);
      }
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
          !isMapImageGroupSublayer(layer)
        ) {
          try {
            await safeLoadMapLayer(layer);
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
   * Paint a best-effort crop palette on shown layers WITHOUT refresh.
   * Lets the first MapImage export (from visibility) already use crop colors
   * instead of waiting for distinct-turi query + a second export.
   */
  private applyInstantCropPaletteNoRefresh = (): void => {
    if (this.state.cropRendererMode !== "on") return;
    if (String(this.state.vh || "").trim()) return;
    const layers = this.getCropRendererTargetLayers();
    if (!layers.length) return;

    const seenLabels = new Set<string>();
    const uniqueValueInfos = CROP_RENDERER_ITEMS.filter((item) => {
      const label = String(item.label || item.value || "").trim();
      if (!label || seenLabels.has(label)) return false;
      seenLabels.add(label);
      return true;
    }).map((item) => ({
      value: item.label || item.value,
      label: item.label || item.value,
      symbol: createCropFillSymbol(item.color),
    }));
    if (!uniqueValueInfos.length) return;

    for (const layer of layers) {
      try {
        const field =
          this.findLayerFieldName(layer, "turi") ||
          this.findLayerFieldName(layer, "crop") ||
          "turi";
        if (!this._originalLayerRenderers.has(layer)) {
          this._originalLayerRenderers.set(layer, layer.renderer ?? null);
        }
        layer.renderer = {
          type: "unique-value",
          field,
          defaultSymbol: createCropFillSymbol("#78909C"),
          uniqueValueInfos,
        } as unknown as __esri.Renderer;
        this._cropRenderedLayers.add(layer);
      } catch {
        /* ignore */
      }
    }
  };

  /** Background-warm the selected region's MapImage for the active year. */
  private warmYearRegionMapImages = (): void => {
    const map = this.state.activeMapView?.view?.map;
    const yil = String(this.state.yil || "").trim();
    if (!map || !yil) return;
    // Only warm the region actually in view — warming every viloyat here
    // used to fire a load() at every region+year MapImage service
    // (including ones deleted/renamed on the server) on every mount/year
    // change, even before the user picked a region.
    const viloyat = this.getEffectiveViloyat();
    if (!viloyat) return;
    void preloadRegionYearMapImages(map, yil, viloyat).then((count) => {
      if (!count) return;
      AgriLocalization.agriLog("map:warm-year-region-layers", {
        yil,
        viloyat,
        loaded: count,
      });
    });
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
  private clearRegionYearSettleRepaintTimers = (): void => {
    this._regionYearSettleRepaintTimers.forEach((timer) => clearTimeout(timer));
    this._regionYearSettleRepaintTimers = [];
  };

  /**
   * Re-apply region-year visibility/DE and force MapImage export at the
   * *current* view scale (no second zoom). Unlocks minScale again in case
   * layer.load() restored service scale gates after the first sync.
   */
  private repaintShownRegionYearLayers = (phase: string): void => {
    if (!this._isMounted) return;
    const map = this.state.activeMapView?.view?.map;
    const viloyat = this.getEffectiveViloyat();
    if (!map || !this.state.yil || !viloyat) return;
    try {
      const shown = this.syncShownRegionYearLayers(map);
      this._lastShownRegionYearLayers = shown;
      unlockShownRegionYearFieldScales(shown);
      for (const entry of shown) {
        try {
          if (Number(entry.layer?.opacity ?? 1) <= 0.05) {
            entry.layer.opacity = 1;
          }
        } catch {
          /* best-effort */
        }
      }
      refreshRegionYearMapExports(shown);
      AgriLocalization.agriLog("map:settle-repaint", {
        phase,
        shownLayerCount: shown.length,
        yil: this.state.yil,
        viloyat,
        tuman: this.state.tuman || "",
        viewScale: Number(this.state.activeMapView?.view?.scale || 0) || null,
      });
    } catch (error: any) {
      AgriLocalization.agriLog("map:settle-repaint:FAILED", {
        phase,
        error: String(error?.message || error),
      });
    }
  };

  /**
   * Schedule 1–2 settle repaints after geography zoom. First after goTo
   * duration; second shortly after in case the settle refresh was also aborted.
   */
  private scheduleShownRegionYearSettleRepaint = (
    requestId: number,
    delayMs: number,
    phase: string,
  ): void => {
    this.clearRegionYearSettleRepaintTimers();
    const run = (label: string) => {
      if (!this._isMounted || requestId !== this._zoomRequestId) return;
      this.repaintShownRegionYearLayers(label);
    };
    this._regionYearSettleRepaintTimers.push(
      setTimeout(() => run(phase), Math.max(0, delayMs)),
    );
    this._regionYearSettleRepaintTimers.push(
      setTimeout(() => run(`${phase}:retry`), Math.max(0, delayMs) + 400),
    );
  };

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
    return getLayerMatchStateForViloyatShared({
      effectiveViloyat,
      layer,
      viloyatKeyToLayerKeys: this._viloyatKeyToLayerKeys,
      makeRegionDistrictKey: (raw) => this.makeRegionDistrictKey(raw),
      getLayerKey: (l) => this.getLayerKey(l),
    });
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
    return buildYearClauseForLayerFields(
      this.state.yil || "",
      (layer as any)?.fields || [],
    );
  }

  private _allowClearOnce = false;
  private _primaryDataSourceId: string | null = null;
  private _dsOnlyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private _dsOnlyRetryCount = 0;
  private _normId = (s?: string) => normalizeConnectionId(s);

  private normalizeApos = (s: string) => normalizeLocalizationApos(s);

  MAX_CONNECTION_ATTEMPTS = MAX_MAP_CONNECTION_ATTEMPTS;

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
      selectedFarmerInn: "",
      openToolbarMenu: null,
      selectedIndexInfoKey: null,
      notificationDays: [],
      notificationLoading: false,
      notificationError: null,
      notificationCanScrollDown: false,
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
          selectedFarmerInn: "",
        },
        async () => {
          this._allowClearOnce = true;
          this._farmerMapUniqueIds = null;
          this._preFarmerSearchGeo = null;

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
    this.clearRegionYearSettleRepaintTimers();

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
      }, MAP_CONNECTION_RETRY_MS);
    }

    if (
      this.state.openToolbarMenu === "notifications" &&
      (prevState.openToolbarMenu !== "notifications" ||
        prevState.notificationDays !== this.state.notificationDays ||
        prevState.notificationLoading !== this.state.notificationLoading)
    ) {
      requestAnimationFrame(() => this.updateNotificationScrollHint());
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
      // Do not clear ekin turi on VH pick — chartDimOrder keeps
      // first-selected-wins (crop-first: VH bar stays crop-scoped, Pie
      // unfiltered by VH; VH-first: Pie scoped by VH, VH bar not by crop).
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
    if (tumanChanged || updates.tuman !== undefined) {
      AgriLocalization.agriLog("localization:tuman-update", {
        source: d.source || null,
        prevTuman: this.state.tuman || "",
        nextTuman: updates.tuman !== undefined ? updates.tuman : this.state.tuman,
        viloyat: updates.viloyat ?? this.state.viloyat ?? "",
        yil: updates.yil ?? this.state.yil ?? "",
        tumanChanged,
        uniqueid: d.uniqueid ?? null,
        polygonMode: d.polygonMode ?? null,
      });
    }
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
      // While locking geo from a STIR row, keep farmer search / text.
      if (!this._farmerSearchApplying) {
        (updates as any).selectedFarmerInn = "";
        this._farmerMapUniqueIds = null;
        this._preFarmerSearchGeo = null;
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
      this._vhRegionChartUniqueIds = null;
      this._vhUniqueIdsCropScoped = false;
      this._vhBarUsedDate = null;
      this._vhBarUsedDateGeo = null;
    }

    // ✅ If viloyat changes -> clear below, but keep an explicitly
    // provided tuman from the same event (Region sends both together).
    // `_vhUniqueIdCache` / `_vhBarUsedDate` survive on purpose: cache keys
    // carry region+district, and the bar date is scope-tagged, so switching
    // back to a viloyat stays instant instead of re-paging every uniqueid.
    if (!yearChanged && viloyatChanged) {
      if (d.tuman === undefined) updates.tuman = "";
      if (d.turlar === undefined && d.turi === undefined) {
        updates.turi = "";
        updates.turlar = [];
      }
      if (d.vh === undefined) updates.vh = "";
      if (d.vh === undefined) {
        this._vhMapUniqueIds = null;
        this._vhRegionChartUniqueIds = null;
        this._vhUniqueIdsCropScoped = false;
      }
    }

    // ✅ If tuman changes -> clear turi and vh
    if (!yearChanged && !viloyatChanged && tumanChanged) {
      updates.turi = "";
      updates.turlar = [];
      updates.vh = "";
      this._vhMapUniqueIds = null;
      this._vhRegionChartUniqueIds = null;
      this._vhUniqueIdsCropScoped = false;
    }

    // ✅ When only turi (crop) changes: keep vh so map ANDs crop + status.
    // Cache keys already include cropIds — do not wipe the whole cache (that
    // forced a full uniqueid re-page and made VH+crop feel stuck).
    // Flag reuse / uniqueid-ready is decided AFTER syncChartDimOrder below.
    if (turiChanged) {
      const nextTurlarEmpty = !(updates.turlar && updates.turlar.length);
      const prevHadCrop =
        (this.state.turlar || []).length > 0 ||
        Boolean(String(this.state.turi || "").trim());
      // Crop cleared while VH stays: drop crop-scoped uniqueids so Pie/map
      // do not keep the previous crop until all-crop ids resolve.
      if (nextTurlarEmpty && prevHadCrop) {
        this._vhMapUniqueIds = null;
        this._vhRegionChartUniqueIds = null;
        this._vhUniqueIdsCropScoped = false;
        clearPieVhFilterUniqueIds();
      }
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
    // Capture before syncChartDimOrder drops "turi" from the order on clear.
    const prevChartFlags = this.getChartFilterFlags();
    this.syncChartDimOrder(
      nextVhForOrder,
      nextTurlarForOrder,
      yearChanged || viloyatChanged || tumanChanged,
    );

    if (turiChanged) {
      const chartFlags = this.getChartFilterFlags(
        nextVhForOrder,
        nextTurlarForOrder,
      );
      const nextTurlarEmpty = nextTurlarForOrder.length === 0;
      const prevHadCrop =
        (this.state.turlar || []).length > 0 ||
        Boolean(String(this.state.turi || "").trim());
      const vhActive = Boolean(String(nextVhForOrder || "").trim());
      if (chartFlags.filterVhBarByCrop) {
        // Crop-first: VH bar + uniqueids are crop-scoped — must recompute.
        this._vhUniqueIdsReadyForApply = false;
        this._reuseVhBarDataOnNextBroadcast = false;
      } else if (prevChartFlags.filterVhBarByCrop && nextTurlarEmpty) {
        // Crop-first cleared: last VH bar is still crop-scoped — recompute all crops.
        this._vhUniqueIdsReadyForApply = false;
        this._reuseVhBarDataOnNextBroadcast = false;
        this._lastVhBarData = null;
      } else if (vhActive && nextTurlarEmpty && prevHadCrop) {
        // Crop cleared under VH-first: re-resolve all-crop uniqueids; bar OK.
        this._vhUniqueIdsReadyForApply = false;
        this._reuseVhBarDataOnNextBroadcast = true;
      } else {
        // Crop-second (or crop without VH scoping): keep all-crop VH bar and
        // existing status uniqueids — map only ANDs turi.
        this._reuseVhBarDataOnNextBroadcast = true;
      }
    }

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
      // Crop toggle only ANDs/removes turi on DE. Re-zooming district/region
      // (queryExtent + goTo) made VH crop filter/clear feel multi-second slow.
      zoomRequest = { mode: "none", reason: "crop" };
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
          const turiClearedWithVh =
            turiChanged &&
            !(updates.turlar && updates.turlar.length) &&
            Boolean(String((updates.vh ?? this.state.vh) || "").trim());
          const vhOnly =
            d.source === "AgriBar" &&
            d.vh !== undefined &&
            !yearChanged &&
            !viloyatChanged &&
            !tumanChanged &&
            (!turiChanged || turiClearedWithVh);

          // Geography/crop codes are already known on VH-only toggles —
          // skip the extra round-trips that dominate perceived lag.
          if (!vhOnly) {
            const turiOnly =
              turiChanged &&
              !yearChanged &&
              !viloyatChanged &&
              !tumanChanged;
            const cropCleared =
              turiOnly && this.getSelectedTurlar().length === 0;

            // Show Vegetatsiya Holati / Pie loaders immediately while crop_id
            // and region codes resolve — don't wait for the network round-trip.
            // Crop-second keeps all-crop VH bar: skip pending spinner + reuse.
            // Crop-first clear: restore all-crop VH from memo immediately
            // (pending spinner + region await made deselect feel stuck).
            if (!this._reuseVhBarDataOnNextBroadcast) {
              if (cropCleared) {
                this.broadcastFilterState();
              } else {
                this.broadcastFilterState({ pendingOnly: true });
              }
            }

            // First viloyat/tuman open: region-year MapImage matching uses the
            // viloyat *name*, and admin borders have a name→parent_cod map.
            // Do not block layer reveal on Agri_table region-code lookup.
            const geographyRevealWithoutCodes =
              (viloyatChanged || yearChanged || tumanChanged) &&
              !turiChanged &&
              !String(this.state.vh || "").trim();
            const ensureRegionPromise = this.ensureRegionDistrictForSelection();
            // turi-only: region/district codes are already cached from the
            // geography click — don't block VH bar on another lookup.
            if (!geographyRevealWithoutCodes && !turiOnly) {
              await ensureRegionPromise;
              if (!isApplyCurrent()) {
                AgriLocalization.agriLog(
                  "handleWidgetSelection:SKIP-stale-apply",
                  { applyId, phase: "after-region-district" },
                );
                return;
              }
            } else {
              void ensureRegionPromise;
            }

            // Ekin turi: resolve crop_id before map + charts (Pie sends
            // canonical keys like "bugdoy", not DB spellings).
            if (this.getSelectedTurlar().length > 0) {
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
            // Start MapImage metadata load immediately so it overlaps the
            // region-code race + apply path (cold load used to start only
            // inside ensureRegionYearMapImagesReady, delaying first export).
            const mapForPreload = this.state.activeMapView?.view?.map;
            const preloadViloyat = this.getEffectiveViloyat();
            if (
              mapForPreload &&
              this.state.yil &&
              preloadViloyat &&
              (viloyatChanged || yearChanged || tumanChanged)
            ) {
              void preloadRegionYearMapImages(
                mapForPreload,
                this.state.yil,
                preloadViloyat,
              );
            }
            void (async () => {
              try {
                // Let region-code lookup finish (or race) before zoom so
                // admin boundaries can prefer numeric parent_cod when ready.
                // Skip the 120ms wait when codes are already cached.
                if (geographyRevealWithoutCodes) {
                  const vKey = this.makeRegionDistrictKey(preloadViloyat);
                  const tKey = this.makeRegionDistrictKey(
                    this.state.tuman || "",
                  );
                  const codesReady =
                    (!vKey || this._viloyatToRegion[vKey] != null) &&
                    (!tKey ||
                      hasDistrictMappingForSelection(
                        preloadViloyat,
                        this.state.tuman || "",
                        this._tumanToDistrict,
                        this._viloyatToRegion,
                        this.getGeoCodeHelpers(),
                      ));
                  if (!codesReady) {
                    await Promise.race([
                      ensureRegionPromise,
                      new Promise<void>((resolve) =>
                        setTimeout(resolve, 120),
                      ),
                    ]);
                  }
                }
                await this.applyMapFiltersOptimized(zoomRequest, isApplyCurrent);
                if (!isApplyCurrent()) {
                  AgriLocalization.agriLog(
                    "handleWidgetSelection:SKIP-stale-apply",
                    { applyId, phase: "after-map-filters" },
                  );
                  return;
                }
                if (geographyRevealWithoutCodes) {
                  await ensureRegionPromise;
                  if (!isApplyCurrent()) return;
                }
                void this.fetchDataWithCurrentState();
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

            this.broadcastFilterState();
            return;
          }

          if (vhOnly) {
            // Cold + narrow (tuman and/or ekin): paint geography/turi DE first,
            // resolve uniqueids in background (same pattern as crop+VH defer).
            // Cold + wide (viloyat/republic only): keep overlay until ids ready
            // so the map never flashes every polygon in the region.
            const narrowScope =
              !!String(this.state.tuman || "").trim() ||
              this.getSelectedTurlar().length > 0;
            const cacheWarm = this.isVhMapUniqueIdCacheWarm();
            const deferColdVh = !cacheWarm && narrowScope;

            AgriLocalization.agriLog("handleWidgetSelection:vh-only", {
              applyId,
              cacheWarm,
              narrowScope,
              deferColdVh,
              vh: this.state.vh,
            });

            this.setMapSurfaceLoading(true, "vegetation");

            if (deferColdVh) {
              // Drop stale status ids so charts stay pending (null) and the
              // map uses turi/tuman only until the new status ids arrive.
              // Clear Pie bridge too — filterPieByVh must not reuse the
              // previous status's district-scoped ids while we wait.
              this._vhMapUniqueIds = null;
              this._vhRegionChartUniqueIds = null;
              this._vhUniqueIdsCropScoped = false;
              clearPieVhFilterUniqueIds();
              this._vhUniqueIdsReadyForApply = false;
              this._deferVhUniqueIdResolve = true;
              this._suppressLegacyVhOnMap = true;
              if (this._isMounted) {
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
              .then(async () => {
                if (isApplyCurrent()) {
                  await this.fetchDataWithCurrentState();
                }
              })
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
    if (!this._isMounted) return;
    const detail = getMasterFilterSnapshot() ?? this._lastBroadcastDetail;
    if (!detail) return;
    document.dispatchEvent(
      new CustomEvent("masterFilterChanged", {
        detail,
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
      selectedFarmerInn,
    } = this.state;

    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];

    // Prefer the date the VH bar already proved has rows — Pie vegetation
    // crop mix must use the same NDVI date as A'lo/Yaxshi totals.
    const explicitNdvi = (ndviDate || "").trim();
    const barUsedNdvi = this.getGeoScopedVhBarUsedDate();
    const effectiveNdviDate =
      (this.state.ndviDateLocked && explicitNdvi) ||
      barUsedNdvi ||
      explicitNdvi ||
      (primaryLayer ? this.getLatestNdviDateForBar(primaryLayer) || "" : "");

    const effectiveViloyat = lockedViloyat || viloyat;

    // We now filter polygons via uniqueid lists resolved locally.
    // Huge ID arrays are NOT put on the event — Pie reads them from the
    // agri-chart-filter-order bridge when filterPieByVh is true.
    const chartFlags = this.getChartFilterFlags();
    // Map / Graff: district-scoped when a tuman is selected.
    // AgriRegion "Tumanlar kesimida": viloyat-wide VH(+crop) ids (no district).
    // While those are still resolving with a tuman selected, broadcast null so
    // Region keeps its loader instead of AND-ing district-scoped map ids.
    const { vhUniqueids, vhRegionChartUniqueids } = resolveVhUniqueidSlices({
      vh,
      tuman,
      vhMapUniqueIds: this._vhMapUniqueIds,
      vhRegionChartUniqueIds: this._vhRegionChartUniqueIds,
    });

    // Bar chart uses status_YYYY_MM_DD field; broadcast that attribute + value so Pie/Indicator filter like Graff
    const cfg = (this.props.config || {}) as any;
    const { barCategoryField, barCategoryValue } = buildBarCategoryBroadcast({
      polygonStatusPrefix: cfg.polygonStatusPrefix,
      effectiveNdviDate,
      vh,
    });

    // Capture generation for this broadcast. computeVhBarData is async; a
    // newer geography selection must discard this payload when it resolves.
    const broadcastGeneration = ++this._broadcastGeneration;
    const geoSnapshot = buildBroadcastGeoSnapshot({
      yil: String(yil || ""),
      effectiveViloyat: String(effectiveViloyat || ""),
      tuman: String(tuman || ""),
      turi: String(turi || ""),
      turlar,
      polygonMode: Boolean(polygonMode),
      selectedGraffUniqueid,
      chartFlags,
      chartDimOrder: this._chartDimOrder,
    });

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
        farmerInn: String(selectedFarmerInn || "").trim(),
        // First-selected chart scopes the other widget; second only maps.
        filterPieByVh: chartFlags.filterPieByVh,
        filterVhBarByCrop: chartFlags.filterVhBarByCrop,
        chartDimOrder: this._chartDimOrder.slice(),
      },
      vhUniqueids,
      vhRegionChartUniqueids,
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
      return isBroadcastGeoCurrent(geoSnapshot, {
        yil: this.state.yil,
        viloyat: liveViloyat,
        tuman: this.state.tuman,
        turi: this.state.turi,
        turlar: this.state.turlar,
        polygonMode: Boolean(this.state.polygonMode),
        selectedGraffUniqueid: this.state.selectedGraffUniqueid,
        chartFlags: this.getChartFilterFlags(),
        chartDimOrder: this._chartDimOrder,
      });
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
        vhRegionChartUniqueids: (detail as any).vhRegionChartUniqueids,
        pieVhUniqueIdsSig: getPieVhFilterUniqueIdsSig(),
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
      AgriLocalization.agriLog("broadcastFilterState:send", {
        vh: detail.filters.vh || "",
        filterPieByVh: detail.filters.filterPieByVh,
        filterVhBarByCrop: detail.filters.filterVhBarByCrop,
        chartDimOrder: detail.filters.chartDimOrder,
        vhUniqueidsCount: Array.isArray(detail.vhUniqueids)
          ? detail.vhUniqueids.length
          : detail.vhUniqueids,
        vhRegionChartUniqueidsCount: Array.isArray(
          (detail as any).vhRegionChartUniqueids,
        )
          ? (detail as any).vhRegionChartUniqueids.length
          : (detail as any).vhRegionChartUniqueids,
        turlar: detail.filters.turlar,
        viloyat: detail.filters.viloyat,
        tuman: detail.filters.tuman,
        whereClauseSample: String(detail.meta?.whereClause || "").slice(0, 280),
        vhBarDataPending,
        pendingOnly: opts?.pendingOnly ?? false,
      });
      syncMasterFilterSnapshot(detail);
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
      const vhKeyAtStart = this.makeVhBarComputeKey();
      this.computeVhBarData()
        .then((vhBarData) => {
          // Superseded by a newer geography/filter — do not clear or overwrite.
          if (!isBroadcastCurrent()) return;
          if (this.makeVhBarComputeKey() !== vhKeyAtStart) return;
          if (vhBarData) {
            this._lastVhBarData = vhBarData;
            send(vhBarData, false);
            return;
          }
          // Empty final result (not abort): clear pending with zeros.
          send(null, false);
        })
        .catch((error: any) => {
          AgriLocalization.agriLog("broadcastFilterState:vh-data-failed", {
            error: String(error?.message || error),
          });
          if (!isBroadcastCurrent()) return;
          if (this.makeVhBarComputeKey() !== vhKeyAtStart) return;
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
        getAgriServiceUrls().portalUrl ||
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
      } catch (err) {
        AgriLocalization.debugCatch("mapInteraction:remove-failed", err);
      }
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

  /** Opt-in via window.__AGRO_V5_DEBUG / __AGRO_V5_VH_DEBUG / __AGRO_V5_TUMAN_DEBUG */
  private static agriLog(
    phase: string,
    detail?: Record<string, unknown>,
  ): void {
    const topic =
      /tuman|district|zoom:district|buildTuman|admin-boundary|jadval|tableRow|broadcastFilterState/i.test(
        phase,
      )
        ? ("tuman" as const)
        : /vh|pie|bar|vegetation|chartDim/i.test(phase)
          ? ("vh" as const)
          : ("all" as const);
    agroV5Log(phase, detail, topic);
  }

  private static debugCatch(phase: string, err: unknown): void {
    agroV5Log(phase, { error: String((err as any)?.message || err) });
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
      if (this._dsOnlyRetryCount < MAX_DS_ONLY_RETRIES) {
        this._dsOnlyRetryCount += 1;
        AgriLocalization.agriLog(
          "initializeDataSourceOnlyConnection:retrying",
          { attempt: this._dsOnlyRetryCount },
        );
        if (this._dsOnlyRetryTimer) clearTimeout(this._dsOnlyRetryTimer);
        this._dsOnlyRetryTimer = setTimeout(() => {
          this._dsOnlyRetryTimer = null;
          void this.initializeDataSourceOnlyConnection(failureMessage);
        }, DS_ONLY_RETRY_DELAY_MS);
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
      await safeLoadMapImageTree(jlv?.layer);
    } catch {
      /* ignore */
    }
    // getQueryableLayer handles both plain FeatureLayers and Map Image Layer
    // roots by drilling into .sublayers/.allSublayers for a queryable child —
    // the same shared helper agri/agri-main's widgets rely on.
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

    // Layers are independent — query concurrently, merge sequentially for stable keys.
    const perLayer = await Promise.all(
      layers.map(async (layer) => {
        const layerKey = this.getLayerKey(layer);
        const normalizedKeys = new Set<string>();
        try {
          const res = await dedupedQueryFeatures(layer, {
            where: "1=1",
            outFields: ["viloyat"],
            returnDistinctValues: true,
            orderByFields: ["viloyat ASC"],
            returnGeometry: false,
            num: 200,
          });
          for (const f of res?.features ?? []) {
            const raw = (f.attributes as any)?.viloyat;
            const k = this.makeRegionDistrictKey(raw != null ? String(raw) : "");
            if (k) normalizedKeys.add(k);
          }
        } catch (e) {
          AgriLocalization.agriLog("buildLayerViloyatIndex:error", {
            error: String((e as any)?.message || e),
          });
        }
        return { layerKey, normalizedKeys };
      }),
    );

    for (const { layerKey, normalizedKeys } of perLayer) {
      for (const k of normalizedKeys) {
        if (!viloyatToLayerSet[k]) viloyatToLayerSet[k] = new Set<string>();
        viloyatToLayerSet[k].add(layerKey);
      }
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
    } catch (e) {
      AgriLocalization.agriLog("detectNdviStatusDateFieldsFromLayer:error", {
        error: String((e as any)?.message || e),
      });
    }
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
      // Warm all region MapImages for the default year so the first viloyat
      // click does not pay cold layer.load() latency.
      this.warmYearRegionMapImages();
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

    const perLayer = await Promise.all(
      layers.map((layer) => this.flDistinctFromLayer(layer, fieldName, "1=1")),
    );

    const distinct = new Set<string>();
    for (const values of perLayer) {
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
      // Refresh always opens default republic scope (latest year only).
      // Prior viloyat/tuman/crop filters stay in DashboardPack / stats cache
      // for 1h — re-selecting them reuses data without UI restore.
      const nextYil = prevStillValid ? prevYil : latest;

      this.setState({
        yilOptions: sorted,
        yil: nextYil,
        viloyat: "",
        tuman: "",
        turi: "",
        turlar: [],
        lockedViloyat: null,
        vh: "",
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
      const res = await dedupedQueryFeatures(layer, {
        where: where || "1=1",
        outFields: [fieldName],
        returnDistinctValues: true,
        orderByFields: [`${fieldName} ASC`],
        returnGeometry: false,
      });
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
    const regionToViloyat: Record<string, string> = {};
    const tumanToDistrict: Record<string, number> = {};
    const tumanToDistrictVotes: Record<string, number> = {};
    const turiToCropId: Record<string, string> = {};
    const helpers = this.getGeoCodeHelpers();

    try {
      const { regionDistrictRows, turiCropRows } =
        await getAgriDashboardBootstrap();

      for (const row of regionDistrictRows) {
        storeScopedRegionDistrictMapping(
          row.viloyat,
          row.region,
          row.tuman,
          row.district,
          viloyatToRegion,
          tumanToDistrict,
          helpers,
          {
            count: row.count,
            tumanToDistrictVotes,
          },
        );
        const code = String(row.region);
        const name = String(row.viloyat || "").trim();
        if (
          name &&
          Number.isFinite(row.region) &&
          (!regionToViloyat[code] || name.length > regionToViloyat[code].length)
        ) {
          regionToViloyat[code] = name;
        }
      }

      for (const row of turiCropRows) {
        const key = getTuriCropLookupKey(row.turi);
        if (key && row.cropId) turiToCropId[key] = row.cropId;
      }

      this._viloyatToRegion = viloyatToRegion;
      this._regionToViloyat = regionToViloyat;
      this._tumanToDistrict = tumanToDistrict;
      this._turiToCropId = turiToCropId;
      AgriLocalization.agriLog("regionDistrictMap:stored", {
        viloyatKeys: Object.keys(viloyatToRegion).length,
        districtKeys: Object.keys(tumanToDistrict).length,
        note: "district keys are viloyat/region-scoped",
      });
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
    const helpers = this.getGeoCodeHelpers();

    const needsViloyat = !!vKey && this._viloyatToRegion[vKey] == null;
    const needsTuman =
      !!tKey &&
      !hasDistrictMappingForSelection(
        vRaw,
        tRaw,
        this._tumanToDistrict,
        this._viloyatToRegion,
        helpers,
      );
    if (!needsViloyat && !needsTuman) return;

    const vilClause = needsViloyat ? this.eqAposSmart("viloyat", vRaw) : "";
    // Prefer AND when both are known so we don't pull every district in the viloyat.
    const tumanClause = needsTuman ? this.eqAposSmart("tuman", tRaw) : "";
    const whereParts: string[] = [];
    if (vilClause && tumanClause) {
      whereParts.push(`(${vilClause}) AND (${tumanClause})`);
    } else if (vilClause) {
      whereParts.push(`(${vilClause})`);
    } else if (tumanClause) {
      whereParts.push(`(${tumanClause})`);
    }
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
          storeScopedRegionDistrictMapping(
            a?.viloyat != null && a.viloyat !== "" ? String(a.viloyat) : null,
            a?.region,
            a?.tuman != null && a.tuman !== "" ? String(a.tuman) : null,
            a?.district,
            this._viloyatToRegion,
            this._tumanToDistrict,
            helpers,
          );
          const r =
            a?.region != null && a.region !== "" ? Number(a.region) : NaN;
          const name =
            a?.viloyat != null && a.viloyat !== ""
              ? String(a.viloyat).trim()
              : "";
          if (name && Number.isFinite(r)) {
            const code = String(r);
            if (
              !this._regionToViloyat[code] ||
              name.length > this._regionToViloyat[code].length
            ) {
              this._regionToViloyat[code] = name;
            }
          }
        }
      }
      AgriLocalization.agriLog("ensureRegionDistrictForSelection:done", {
        featureCount,
        viloyat: vRaw,
        tuman: tRaw,
        district: resolveDistrictNumberFromMaps(
          tRaw,
          this._tumanToDistrict,
          helpers,
          {
            rawViloyat: vRaw,
            viloyatToRegion: this._viloyatToRegion,
          },
        ),
      });
    } catch (e) {
      AgriLocalization.agriLog("ensureRegionDistrictForSelection:error", {
        error: String((e as any)?.message || e),
      });
    }
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

    const missingTurlar = this.getSelectedTurlar().filter(
      (turi) => !this.resolveCropIdForTuri(turi),
    );
    if (!missingTurlar.length) return;

    try {
      const whereParts: string[] = [];
      const vilClause = this.buildViloyatRegionClause();
      if (vilClause) whereParts.push(`(${vilClause})`);
      const turiClause = this.buildTurlarClause("turi", missingTurlar);
      if (turiClause) whereParts.push(`(${turiClause})`);
      const where = whereParts.join(" AND ");
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
          const key = getTuriCropLookupKey(
            attributes?.turi != null && attributes.turi !== ""
              ? String(attributes.turi)
              : "",
          );
          const cropId =
            attributes?.crop_id != null && attributes.crop_id !== ""
              ? String(attributes.crop_id)
              : "";
          if (key && cropId) this._turiToCropId[key] = cropId;
        }

        const unresolved = missingTurlar.some(
          (turi) => !this.resolveCropIdForTuri(turi),
        );
        if (!unresolved) break;
      }
    } catch (e) {
      AgriLocalization.agriLog("ensureCropIdForSelection:error", {
        error: String((e as any)?.message || e),
      });
    }
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

    // Keep page background in sync with theme (same as AgriLocalization)
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
    menu: "yil" | "language" | "indexInfo" | "notifications",
  ): void => {
    this.setState(
      (prev) => ({
        openToolbarMenu: prev.openToolbarMenu === menu ? null : menu,
        // Always return to the index list (not a stale detail page) whenever
        // the indexInfo menu is (re)opened or closed.
        selectedIndexInfoKey: null as string | null,
      }),
      () => {
        if (this.state.openToolbarMenu === "notifications") {
          void this.loadNotificationFeed();
        }
      },
    );
  };

  private loadNotificationFeed = async (): Promise<void> => {
    const token = ++this._notificationLoadToken;
    if (!this._isMounted) return;
    this.setState({ notificationLoading: true, notificationError: null });
    try {
      // Drop stale notification aggregates from older logic (row-count / skip-empty window).
      try {
        const prefix = "agri_v5_pc:veg-recent-days:";
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (
            key &&
            key.startsWith(prefix) &&
            !key.includes("v8-processed_at-calendar-window")
          ) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        /* ignore */
      }
      // Warm portal token + region id → viloyat names from Agri_table_data.
      await Promise.all([
        getAgriVegetationIndicesLayer(),
        Object.keys(this._regionToViloyat).length
          ? Promise.resolve()
          : this.fetchAndStoreRegionDistrictMappings(),
      ]);
      const days = await queryVegetationRecentDayRegionCounts(5);
      if (!this._isMounted || token !== this._notificationLoadToken) return;
      try {
        // eslint-disable-next-line no-console
        console.log("[AgriNotify] UI received days", days);
      } catch {
        /* ignore */
      }
      this.setState({
        notificationDays: days,
        notificationLoading: false,
        notificationError: null,
      });
    } catch (err: any) {
      if (!this._isMounted || token !== this._notificationLoadToken) return;
      this.setState({
        notificationLoading: false,
        notificationError: String(err?.message || err || "Failed to load"),
      });
    }
  };

  private formatNotificationDate = (ymd: string): string => {
    const parts = String(ymd || "").split("-");
    if (parts.length !== 3) return ymd;
    const [y, m, d] = parts;
    if (this.state.language === "en") return `${m}/${d}/${y}`;
    return `${d}.${m}.${y}`;
  };

  private resolveRegionNotificationName = (regionCode: string): string => {
    const code = String(regionCode || "").trim();
    // Prefer live Agri_table_data mapping (region → viloyat); static map is fallback only.
    const rawName =
      this._regionToViloyat[code] ||
      regionSoatoToDisplayName(code) ||
      code;
    return translateAgriPlaceForDisplay(
      rawName,
      this.state.language,
      "region",
    );
  };

  private formatFieldCount = (value: number): string => {
    const lang = this.state.language;
    const locale =
      lang === "en" ? "en-US" : lang === "ru" ? "ru-RU" : "uz-UZ";
    try {
      return Number(value || 0).toLocaleString(locale);
    } catch {
      return String(value || 0);
    }
  };

  private updateNotificationScrollHint = (): void => {
    if (!this._isMounted) return;
    const el = this._notificationBodyRef.current;
    const canScroll = !!(
      el &&
      el.scrollHeight - el.scrollTop - el.clientHeight > 10
    );
    if (canScroll !== this.state.notificationCanScrollDown) {
      this.setState({ notificationCanScrollDown: canScroll });
    }
  };

  private onNotificationBodyScroll = (): void => {
    this.updateNotificationScrollHint();
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
          this.warmYearRegionMapImages();
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
        localStorage.setItem("agri_app_lang", lang);
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
          this.warmYearRegionMapImages();
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
    const escaped = escapeLikeLiteral(term);

    const innLike = `UPPER(${innField}) LIKE UPPER('%${escaped}%')`;
    const farmerLike = `UPPER(${farmerField}) LIKE UPPER('%${escaped}%')`;

    return `(${innLike} OR ${farmerLike})`;
  };

  /**
   * Graff search modal: year is required. When a viloyat (or tuman) is
   * selected, STIR search is scoped to the whole viloyat — not the active
   * district — so other tumans in that region still appear in the list.
   */
  private buildGraffSearchScopeWhere = (): string => {
    const { yil } = this.state;
    if (!yil) return "1=0";

    const clauses: string[] = [];
    const yearClause = buildYearLikeClause(yil);
    if (yearClause) clauses.push(yearClause);

    const viloyatClause = this.buildViloyatRegionClause();
    if (viloyatClause) clauses.push(viloyatClause);

    return clauses.length ? clauses.join(" AND ") : "1=0";
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

    const requestId = ++this._graffAutoCompleteRequestId;
    const isCurrent = () =>
      this._isMounted && requestId === this._graffAutoCompleteRequestId;

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
          if (!attrs.viloyat && attrs[viloyatField] != null) {
            attrs.viloyat = String(attrs[viloyatField]);
          }
          if (!attrs.tuman && attrs[tumanField] != null) {
            attrs.tuman = String(attrs[tumanField]);
          }
          return attrs;
        })
        .filter((record) => record.f_inn || record.f_name);

      // One row per STIR + viloyat + tuman (avoid repeating every parcel).
      const seenGeo = new Set<string>();
      const deduped: GraffSearchRecord[] = [];
      for (const record of results) {
        const key = [
          String(record.f_inn || "").trim().toLowerCase(),
          String(record.viloyat || record.region || "")
            .trim()
            .toLowerCase(),
          String(record.tuman || record.district || "")
            .trim()
            .toLowerCase(),
        ].join("|");
        if (seenGeo.has(key)) continue;
        seenGeo.add(key);
        deduped.push(record);
      }

      AgriLocalization.agriLog("graffSearch:results", {
        count: deduped.length,
        rawCount: results.length,
      });

      if (isCurrent()) {
        this.setState({
          graffSearchSuggestions: deduped,
          graffSearchShowSuggestions: true,
          graffSearchLoading: false,
        });
      }
    } catch (err) {
      AgriLocalization.agriLog("graffSearch:failed", {
        error: String((err as any)?.message || err),
      });
      if (isCurrent()) {
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
    const selectedInn = String(this.state.selectedFarmerInn || "").trim();
    const leavingCommittedSelection =
      !!selectedInn && trimmed !== selectedInn;

    if (leavingCommittedSelection) {
      // Editing away from a committed STIR restores prior geography first.
      const restore = this._preFarmerSearchGeo;
      this._preFarmerSearchGeo = null;
      this._farmerMapUniqueIds = null;
      this.setState(
        {
          graffSearchText: nextValue,
          selectedFarmerInn: "",
          ...(restore != null
            ? {
                viloyat: String(restore.viloyat || ""),
                tuman: String(restore.tuman || ""),
              }
            : {}),
        },
        () => {
          this.emitGraffTableSearchClear();
          if (this.state.connectionStatus === "connected") {
            const v = String(this.state.viloyat || "");
            const t = String(this.state.tuman || "");
            const zoomRequest = !v
              ? ({ mode: "home", reason: "reset" } as const)
              : t
                ? ({ mode: "selection", reason: "district" } as const)
                : ({ mode: "selection", reason: "region" } as const);
            this.broadcastFilterState();
            void this.applyMapFiltersOptimized(zoomRequest);
          }
        },
      );
    } else {
      this.setState({ graffSearchText: nextValue });
    }

    if (this._graffSearchDebounceTimer) {
      clearTimeout(this._graffSearchDebounceTimer);
    }

    if (!trimmed) {
      // Emptying the input after a committed STIR selection restores prior geo.
      // (Already handled above when leavingCommittedSelection cleared farmer.)
      if (!leavingCommittedSelection && this._preFarmerSearchGeo) {
        this.clearFarmerSearchAndRestoreGeo();
      } else {
        this.setState({
          graffSearchSuggestions: [],
          graffSearchShowSuggestions: false,
          graffSearchLoading: false,
        });
      }
      return;
    }

    // Year is enough — republic-wide STIR search is allowed without viloyat.
    if (!this.state.yil) {
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

    // Typing only drives the dropdown suggestions — do NOT filter Jadval /
    // zoom the map until the user picks a row from that list.
    this._graffSearchDebounceTimer = setTimeout(() => {
      this.runGraffAutoComplete(trimmed);
    }, 300);
  };

  private handleGraffSearchFocus = (): void => {
    const trimmed = String(this.state.graffSearchText || "").trim();
    if (!trimmed || !this.state.yil) return;

    // Click-away only hides the list; keep suggestions and reopen on focus.
    if (this.state.graffSearchSuggestions.length > 0) {
      this.setState({ graffSearchShowSuggestions: true });
      return;
    }

    this.setState({
      graffSearchShowSuggestions: true,
      graffSearchLoading: true,
    });
    void this.runGraffAutoComplete(trimmed);
  };

  /**
   * Clear STIR selection and restore the geography that was active before
   * the farmer search row was chosen (republic / viloyat / tuman).
   */
  private clearFarmerSearchAndRestoreGeo = (): void => {
    if (this._graffSearchDebounceTimer) {
      clearTimeout(this._graffSearchDebounceTimer);
      this._graffSearchDebounceTimer = null;
    }

    const hadFarmer = !!String(this.state.selectedFarmerInn || "").trim();
    const restore = this._preFarmerSearchGeo;
    this._preFarmerSearchGeo = null;
    this._farmerMapUniqueIds = null;

    const nextViloyat =
      restore != null ? String(restore.viloyat || "") : this.state.viloyat;
    const nextTuman =
      restore != null ? String(restore.tuman || "") : this.state.tuman;
    const geoChanged =
      hadFarmer &&
      restore != null &&
      (String(this.state.viloyat || "") !== nextViloyat ||
        String(this.state.tuman || "") !== nextTuman);

    this._farmerSearchApplying = true;
    this.setState(
      {
        graffSearchText: "",
        graffSearchSuggestions: [],
        graffSearchShowSuggestions: false,
        graffSearchLoading: false,
        selectedFarmerInn: "",
        polygonMode: false,
        selectedGraffUniqueid: "",
        selectedGraffUniqueidClickedAt: undefined,
        ...(restore != null
          ? { viloyat: nextViloyat, tuman: nextTuman }
          : {}),
      },
      () => {
        this.emitGraffTableSearchClear();
        if (this.state.connectionStatus !== "connected") {
          this._farmerSearchApplying = false;
          return;
        }
        if (!hadFarmer && !geoChanged) {
          this._farmerSearchApplying = false;
          return;
        }

        const zoomRequest =
          !nextViloyat
            ? ({ mode: "home", reason: "reset" } as const)
            : nextTuman
              ? ({ mode: "selection", reason: "district" } as const)
              : ({ mode: "selection", reason: "region" } as const);

        this.broadcastFilterState();
        void this.applyMapFiltersOptimized(zoomRequest).finally(() => {
          this._farmerSearchApplying = false;
        });
        void this.fetchDataWithCurrentState();
      },
    );
  };

  private handleGraffSearchClear = () => {
    this.clearFarmerSearchAndRestoreGeo();
  };

  private handleGraffSearchRowClick = (record: GraffSearchRecord) => {
    const inn = String(record.f_inn || "").trim();
    const name = String(record.f_name || "").trim();
    const label = inn || name;
    if (!label) return;

    const recordViloyat = String(record.viloyat || record.region || "").trim();
    const recordTuman = String(record.tuman || record.district || "").trim();
    const hadViloyat = !!this.getEffectiveViloyat();

    // Remember prior geography once per STIR session so X restores it.
    if (!this._preFarmerSearchGeo) {
      this._preFarmerSearchGeo = {
        viloyat: String(this.state.viloyat || ""),
        tuman: String(this.state.tuman || ""),
      };
    }

    // Prefer exact STIR; name-only rows still filter via search text on Graff.
    const updates: Partial<GeoWidgetState> = {
      graffSearchText: label,
      graffSearchSuggestions: [],
      graffSearchShowSuggestions: false,
      graffSearchLoading: false,
      selectedFarmerInn: inn,
      polygonMode: false,
      selectedGraffUniqueid: "",
      selectedGraffUniqueidClickedAt: undefined,
    };

    // Republic search: lock geography to the row so MapImage + VH can load.
    // Tuman-scoped UI still searches viloyat-wide — move to the row's district
    // when the user picks a result from another tuman.
    if (!hadViloyat && recordViloyat) {
      updates.viloyat = recordViloyat;
      if (recordTuman) updates.tuman = recordTuman;
    } else if (hadViloyat && recordTuman) {
      updates.tuman = recordTuman;
    }

    this._farmerSearchApplying = true;
    this.setState(updates as any, () => {
      this.emitGraffTableSearchChanged(inn || name);
      if (inn) {
        void this.applyFarmerSearchSelection(inn);
      } else {
        this._farmerMapUniqueIds = null;
        this._farmerSearchApplying = false;
        this.broadcastFilterState();
        void this.applyMapFiltersOptimized({
          mode: "selection",
          reason: "ndvi",
        });
      }
    });
  };

  /**
   * Resolve STIR → uniqueids, then refresh pie / VH / map zoom to those fields.
   */
  private applyFarmerSearchSelection = async (inn: string): Promise<void> => {
    if (!this._isMounted) return;
    const cleanInn = String(inn || "").trim();
    if (!cleanInn) {
      this._farmerMapUniqueIds = null;
      return;
    }

    this._farmerSearchApplying = true;
    try {
      const scopeParts: string[] = [];
      const yearClause = buildYearLikeClause(this.state.yil);
      if (yearClause) scopeParts.push(yearClause);
      const vilClause = this.buildViloyatRegionClause();
      if (vilClause) scopeParts.push(vilClause);
      if (this.state.tuman) {
        const tumanClause = this.buildTumanDistrictClause();
        if (tumanClause) scopeParts.push(tumanClause);
      }
      const scopeWhere = scopeParts.join(" AND ");
      const ids = await queryAgriUniqueIdsForFarmerInn(cleanInn, scopeWhere);
      if (!this._isMounted) return;
      if (String(this.state.selectedFarmerInn || "").trim() !== cleanInn) return;
      this._farmerMapUniqueIds = ids;

      AgriLocalization.agriLog("farmerSearch:applied", {
        inn: cleanInn,
        uniqueidCount: ids.length,
        viloyat: this.getEffectiveViloyat(),
        tuman: this.state.tuman,
      });

      this.broadcastFilterState();
      await this.applyMapFiltersOptimized({
        mode: "selection",
        reason: "ndvi",
      });
      await this.fetchDataWithCurrentState();
    } catch (error: any) {
      AgriLocalization.agriLog("farmerSearch:FAILED", {
        inn: cleanInn,
        error: String(error?.message || error),
      });
      this._farmerMapUniqueIds = [];
      this.broadcastFilterState();
    } finally {
      this._farmerSearchApplying = false;
    }
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
            const regionParts = [
              String(record.viloyat || record.region || "").trim() ||
                String(this.getEffectiveViloyat() || "").trim(),
              String(record.tuman || record.district || "").trim(),
            ].filter(Boolean);
            const geoLabel = regionParts.join(" · ");
            const rowKey = [
              String(record.f_inn || "").trim(),
              String(record.viloyat || "").trim(),
              String(record.tuman || "").trim(),
              String(idx),
            ].join("|");
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

  private renderNotificationsMenuFloating = () => {
    if (this.state.openToolbarMenu !== "notifications") return null;

    const anchor = this._notificationsToolbarItemRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const { language, notificationDays, notificationLoading, notificationError, notificationCanScrollDown } =
      this.state;

    const headerLabel =
      language === "en"
        ? "New fields (last 5 days)"
        : language === "ru"
          ? "Новые поля (последние 5 дней)"
          : language === "uz_lat"
            ? "Yangi maydonlar (oxirgi 5 kun)"
            : "Янги майдонлар (охирги 5 кун)";

    const emptyLabel =
      language === "en"
        ? "No recent data"
        : language === "ru"
          ? "Нет новых данных"
          : language === "uz_lat"
            ? "Yangi ma'lumot yo'q"
            : "Янги маълумот йўқ";

    const loadingLabel =
      language === "en"
        ? "Loading…"
        : language === "ru"
          ? "Загрузка…"
          : language === "uz_lat"
            ? "Yuklanmoqda…"
            : "Юкланмоқда…";

    const fieldsLabel =
      language === "en"
        ? "fields"
        : language === "ru"
          ? "полей"
          : language === "uz_lat"
            ? "maydon"
            : "майдон";

    return ReactDOM.createPortal(
      <div
        className="agri-v20-toolbar-popover agri-v20-toolbar-popover-floating agri-v20-floating-overlay agri-v20-notifications-popover"
        style={{
          position: "fixed",
          top: rect.bottom + 10,
          left: Math.min(
            Math.max(12, rect.left),
            Math.max(12, window.innerWidth - 372),
          ),
          width: 360,
          maxWidth: "calc(100vw - 24px)",
          zIndex: 2147483001,
        }}
      >
        <div
          className="agri-v20-notifications-menu"
          role="dialog"
          aria-label={headerLabel}
        >
          <div className="agri-v20-notifications-header">
            <span>{headerLabel}</span>
            <button
              type="button"
              className="agri-v20-notifications-close"
              onClick={() =>
                this.setState({ openToolbarMenu: null, selectedIndexInfoKey: null })
              }
              aria-label="Close"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {notificationLoading ? (
            <div className="agri-v20-notifications-status">{loadingLabel}</div>
          ) : notificationError ? (
            <div className="agri-v20-notifications-status agri-v20-notifications-status--error">
              {notificationError}
            </div>
          ) : !notificationDays.length ? (
            <div className="agri-v20-notifications-status">{emptyLabel}</div>
          ) : (
            <div className="agri-v20-notifications-body-wrap">
              <div
                className="agri-v20-notifications-body"
                ref={this._notificationBodyRef}
                onScroll={this.onNotificationBodyScroll}
              >
                {notificationDays.map((day) => (
                  <section
                    className="agri-v20-notifications-day"
                    key={day.date}
                  >
                    <div className="agri-v20-notifications-day-title">
                      <span>{this.formatNotificationDate(day.date)}</span>
                      <span className="agri-v20-notifications-day-total">
                        {this.formatFieldCount(day.totalFields)} {fieldsLabel}
                      </span>
                    </div>
                    <ul className="agri-v20-notifications-region-list">
                      {day.regions.map((row) => (
                        <li
                          className="agri-v20-notifications-region-row"
                          key={`${day.date}-${row.regionCode}`}
                        >
                          <span className="agri-v20-notifications-region-name">
                            {this.resolveRegionNotificationName(row.regionCode)}
                          </span>
                          <span className="agri-v20-notifications-region-count">
                            {this.formatFieldCount(row.fieldCount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {notificationCanScrollDown ? (
                <div
                  className="agri-v20-notifications-scroll-cue"
                  aria-hidden="true"
                >
                  <ChevronDown size={20} strokeWidth={2.5} />
                </div>
              ) : null}
            </div>
          )}
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

  private eqAposSmart(field: string, raw: string): string {
    if (!raw) return "";
    // Localization normalize trims; agri-sql eqAposSmart also trims — keep both.
    return eqAposSmartShared(field, this.normalizeApos(String(raw)));
  }

  private getAposHelpers = () => ({
    normalizeApos: (s: string) => this.normalizeApos(s),
    makeRegionDistrictKey: (raw: string | null | undefined) =>
      this.makeRegionDistrictKey(raw),
    eqAposSmart: (field: string, value: string) =>
      this.eqAposSmart(field, value),
  });

  private normalizeTurlar = (raw: unknown, fallback = ""): string[] =>
    normalizeTurlarList(raw, fallback);

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

  /**
   * Crop ids that scope VH uniqueid queries — only when crop was selected
   * before VH (filterVhBarByCrop). VH-first keeps [] so cache keys match
   * resolveVhMapUniqueIds / map AND-turi behavior.
   */
  private getCropIdsForVhUniqueIdScope = (): string[] => {
    if (!this.getChartFilterFlags().filterVhBarByCrop) return [];
    return Array.from(
      new Set(
        this.getSelectedTurlar()
          .map((turi) => this.resolveCropIdForTuri(turi))
          .filter((value): value is string => Boolean(value)),
      ),
    );
  };

  /** Keep first-selected-wins order for Pie ↔ VH chart scoping. */
  private syncChartDimOrder = (
    nextVh: string,
    nextTurlar: string[],
    resetGeography: boolean,
  ): void => {
    if (resetGeography) {
      this._chartDimOrder = [];
      clearPieVhFilterUniqueIds();
      AgriLocalization.agriLog("chartDimOrder:reset", { reason: "geography" });
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
    AgriLocalization.agriLog("chartDimOrder:sync", {
      nextVh: String(nextVh || "").trim() || null,
      nextTurlar,
      order: this._chartDimOrder.slice(),
      flags: this.getChartFilterFlags(
        String(nextVh || "").trim(),
        nextTurlar,
      ),
    });
  };

  private buildTurlarClause = (
    field = "turi",
    values: string[] = this.getSelectedTurlar(),
  ): string => buildTurlarSqlClause(field, values);

  private buildUniqueIdClause(raw: string, layer?: __esri.FeatureLayer): string {
    const field = layer
      ? this.findLayerFieldName(layer, "uniqueid") || "uniqueid"
      : "uniqueid";
    return buildUniqueIdSqlClause(raw, field);
  }

  /**
   * Build viloyat filter clause using stored viloyat → region mapping.
   * Supports: viloyat name (looks up region number from _viloyatToRegion) or raw region number.
   */
  private buildViloyatRegionClause(): string {
    const { viloyat, lockedViloyat } = this.state;
    const rawViloyat = (lockedViloyat ?? viloyat ?? "").toString();
    return buildViloyatRegionSqlClause(
      rawViloyat,
      this._viloyatToRegion,
      this.getAposHelpers(),
    );
  }

  /**
   * Build tuman filter for Agri_table / Jadval / map definitionExpression.
   *
   * Prefer numeric `district` SOATO (same id used for Tuman_chegara borders
   * and VH). Name→code comes from majority-voted Agri_table mappings so rare
   * poison rows (Qamashi tagged with Yakkabog' code) cannot win. Fall back to
   * tuman text only when no code is known yet.
   */
  private buildTumanDistrictClause(): string {
    const { tuman, viloyat, lockedViloyat } = this.state;
    const rawViloyat = (lockedViloyat ?? viloyat ?? "").toString();
    const rawTuman = (tuman ?? "").toString();
    const effectiveTuman = this.normalizeApos(rawTuman);
    if (!effectiveTuman) return "";

    const districtCode = resolveDistrictNumberFromMaps(
      rawTuman,
      this._tumanToDistrict,
      this.getGeoCodeHelpers(),
      {
        rawViloyat,
        viloyatToRegion: this._viloyatToRegion,
      },
    );

    let clause: string;
    let mode: string;
    if (/^\d+$/.test(effectiveTuman)) {
      clause = `district = '${Number(effectiveTuman)}'`;
      mode = "tuman-numeric";
    } else if (districtCode != null && Number.isFinite(districtCode)) {
      clause = `district = '${districtCode}'`;
      mode = "district-id";
    } else {
      clause = buildTumanEqualsSql("tuman", effectiveTuman);
      mode = "tuman-text";
    }

    AgriLocalization.agriLog("buildTumanDistrictClause", {
      viloyat: rawViloyat,
      tuman: effectiveTuman,
      districtCode: districtCode ?? null,
      clause,
      mode,
    });
    return clause;
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
    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return "";

    const cfg = (this.props.config || {}) as any;
    const prefix =
      (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";

    return buildNdviStatusEqualsSqlClause({
      ndviDate: this.state.ndviDate || "",
      vhCategory: this.state.vh || "",
      prefix,
      dateFieldMap: this._ndviDateFieldMap,
      layerFields: (primaryLayer as any).fields || [],
    });
  }

  /**
   * Build NDVI date-only clause (no VH bucket) for the current ndviDate.
   * Example: status_2025_09_18 IS NOT NULL
   */
  private buildNdviDateClauseWithoutVh(): string {
    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return "";

    const cfg = (this.props.config || {}) as any;
    const prefix =
      (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";

    return buildNdviDateNotNullSqlClause({
      ndviDate: this.state.ndviDate || "",
      prefix,
      dateFieldMap: this._ndviDateFieldMap,
      layerFields: (primaryLayer as any).fields || [],
    });
  }

  private buildWhereClause(
    includeVh = true,
    includeTuri = true,
    includeViloyat = true,
    layer?: __esri.FeatureLayer,
  ): string {
    const { yil, viloyat, tuman, lockedViloyat } = this.state;

    // Require year first
    if (!yil) return "1=0";

    let yearClause: string;
    if (layer) {
      yearClause = this.buildYearClauseForLayer(layer);
    } else {
      yearClause = buildYearLikeClause(yil);
      if (!yearClause) return "1=0";
    }

    // In default republic mode (no effective viloyat), ignore stale tuman so
    // VH bar reflects full-country totals for the selected year.
    const hasEffectiveViloyat = !!this.normalizeApos(
      (lockedViloyat || viloyat || "").toString(),
    );
    const vhCategory = this.normalizeApos(String(this.state.vh || "")).trim();

    let uniqueIdClause = "";
    if (this.state.polygonMode && this.state.selectedGraffUniqueid) {
      uniqueIdClause =
        this.buildUniqueIdClause(this.state.selectedGraffUniqueid, layer) || "";
    }

    const farmerInn = String(this.state.selectedFarmerInn || "").trim();
    const farmerInnClause = farmerInn
      ? `UPPER(f_inn)=UPPER('${escapeArcGIS(farmerInn)}')`
      : "";

    return assembleLocalizationWhere({
      yearClause,
      includeViloyat,
      viloyatClause: this.buildViloyatRegionClause(),
      includeTuman: !!(tuman && (includeViloyat || hasEffectiveViloyat)),
      tumanClause: this.buildTumanDistrictClause(),
      includeTuri,
      cropClause: this.buildTurlarClause("turi"),
      includeVh,
      vhCategory,
      vhUniqueIds: this._vhMapUniqueIds,
      uniqueIdClause,
      farmerInnClause,
      buildSpatialJoinWhere,
      withAccessWhere: withAgriAccessWhere,
    });
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
   * columns — a schema that only ever existed on a different (Agri) layer.
   * `featureLayers` here is Agri_table_data, which never had those columns,
   * so this always returned the all-zero fallback. agri_vegetation_indices
   * has a real per-date `ndvi_status` field, no schema guessing needed.
   */
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
    } = this.state;
    const effectiveViloyat = lockedViloyat || viloyat;
    const chartFlags = this.getChartFilterFlags();
    const selectedTurlar = chartFlags.filterVhBarByCrop
      ? this.getSelectedTurlar()
      : [];
    return buildVhBarComputeKey({
      yil: String(yil || ""),
      viloyat: String(effectiveViloyat || ""),
      tuman: String(effectiveViloyat ? tuman || "" : ""),
      turlar: selectedTurlar,
      ndviDate: String(ndviDate || "").trim(),
      ndviDateLocked: Boolean(ndviDateLocked),
      polygonMode: false,
      uniqueid: "",
      filterVhBarByCrop: chartFlags.filterVhBarByCrop,
      farmerInn: String(this.state.selectedFarmerInn || "").trim(),
    });
  };

  private executeComputeVhBarData = async (): Promise<VHBarData | null> => {
    // Tag the resulting bar date with the geography this compute reads below;
    // by the time it resolves the user may already be on another viloyat.
    const geoKeyAtStart = this.makeVhBarDateGeoKey();
    return executeVhBarCompute({
      state: {
        viloyat: this.state.viloyat,
        lockedViloyat: this.state.lockedViloyat,
        tuman: this.state.tuman,
        yil: this.state.yil,
        ndviDate: this.state.ndviDate,
        ndviDateLocked: this.state.ndviDateLocked,
      },
      isMounted: () => this._isMounted,
      viloyatToRegion: this._viloyatToRegion,
      tumanToDistrict: this._tumanToDistrict,
      normalizeApos: this.normalizeApos,
      makeRegionDistrictKey: (raw) => this.makeRegionDistrictKey(raw),
      getChartFilterFlags: () => this.getChartFilterFlags(),
      getSelectedTurlar: () => this.getSelectedTurlar(),
      resolveCropIdForTuri: (turi) => this.resolveCropIdForTuri(turi),
      getVhBarUsedDate: () => this._vhBarUsedDate,
      setVhBarUsedDate: (date) => {
        this._vhBarUsedDate = date;
        this._vhBarUsedDateGeo = date ? geoKeyAtStart : null;
      },
      setState: (patch) => this.setState(patch as any),
      prefetchVhStatusUniqueIds: (date) => this.prefetchVhStatusUniqueIds(date),
      log: (phase, detail) => AgriLocalization.agriLog(phase, detail),
      farmerUniqueIds: String(this.state.selectedFarmerInn || "").trim()
        ? this._farmerMapUniqueIds
        : null,
    });
  };

  /**
   * Progressive republic totals while spinner stays on (pending=true).
   * Avoids the old bug where pending=false made incomplete totals look final.
   */
  private publishVhBarPartial = (vhBarData: VHBarData): void => {
    if (!this._isMounted || !this._lastBroadcastDetail) return;
    const computeKey = this.makeVhBarComputeKey();
    if (
      this._lastVhBarComputeKey &&
      computeKey !== this._lastVhBarComputeKey
    ) {
      return;
    }
    const detail = {
      ...this._lastBroadcastDetail,
      vhBarData,
      vhBarDataPending: true,
    };
    this._lastBroadcastDetail = detail;
    this._lastBroadcastDigest = "";
    syncMasterFilterSnapshot(detail);
    document.dispatchEvent(
      new CustomEvent("masterFilterChanged", {
        detail,
        bubbles: true,
      }),
    );
  };

  /** Build table WHERE for date field matching selected ndviDate (YYYY-MM-DD or string). */
  private buildTableDateWhere(
    dateField: string,
    ndviDate: string,
  ): string | null {
    return buildTableDateEqualsWhere(dateField, ndviDate);
  }

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
    const { yil, viloyat, tuman, lockedViloyat } = this.state;
    return buildNdviTableWhereWithRegion({
      dateField,
      ndviDate,
      tableFieldNames,
      yil: yil || "",
      viloyat: viloyat || "",
      tuman: tuman || "",
      lockedViloyat,
      viloyatToRegion: this._viloyatToRegion,
      tumanToDistrict: this._tumanToDistrict,
      normalizeApos: (s) => this.normalizeApos(s),
      cropClause: this.buildTurlarClause("turi"),
    });
  }

  /**
   * Canonical hectare value for every filtered polygon. Vegetation rows only
   * determine the status; displayed area must come from Agri_table_data so
   * VH categories partition the same total used by Indicator/Pie/Region.
   */
  private getPolygonAreasWithCurrentFilter = async (opts?: {
    includeTuri?: boolean;
  }): Promise<Map<string, number>> => {
    const primaryLayer =
      this.state.featureLayer ?? this.state.featureLayers?.[0];
    if (!primaryLayer) return new Map();

    const hasRegion = !!this.normalizeApos(
      (this.state.lockedViloyat || this.state.viloyat || "").toString(),
    );
    // Match VH bar crop scoping: only AND turi when crop was selected first.
    const includeTuri = opts?.includeTuri === true;
    const where = this.buildWhereClause(
      false,
      includeTuri,
      hasRegion,
      primaryLayer,
    );
    if (!where || where === "1=0") return new Map();
    const layerKey = String((primaryLayer as any).url || primaryLayer.id || "");
    const cacheKey = `${layerKey}|turi=${includeTuri ? 1 : 0}|${where}`;
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
          const key = normalizeUniqueidKey(String(rawId));
          if (!key) continue;
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

  private getGeoCodeHelpers = () => ({
    normalizeApos: (s: string) => this.normalizeApos(s),
    makeRegionDistrictKey: (raw: string | null | undefined) =>
      this.makeRegionDistrictKey(raw),
  });

  /** Scope tag for `_vhBarUsedDate`: which viloyat/tuman proved that date. */
  private makeVhBarDateGeoKey = (): string =>
    [
      this.makeRegionDistrictKey(this.state.lockedViloyat || this.state.viloyat),
      this.makeRegionDistrictKey(this.state.tuman),
    ].join("|");

  /**
   * VH bar date, but only when it was proved on the current viloyat/tuman.
   * Callers that need a date for the *current* scope (cache keys, Pie) must
   * not reuse another region's date; date probing may still try it first.
   */
  private getGeoScopedVhBarUsedDate = (): string => {
    const date = String(this._vhBarUsedDate || "").trim();
    if (!date) return "";
    return this._vhBarUsedDateGeo === this.makeVhBarDateGeoKey() ? date : "";
  };

  /** Write a uniqueid list, dropping the oldest entries past the cap. */
  private setVhUniqueIdCacheEntry = (key: string, ids: string[]): void => {
    if (!key) return;
    this._vhUniqueIdCache[key] = ids;
    const keys = Object.keys(this._vhUniqueIdCache);
    const overflow = keys.length - AgriLocalization.VH_UNIQUEID_CACHE_MAX;
    for (let i = 0; i < overflow; i += 1) {
      if (keys[i] === key) continue;
      delete this._vhUniqueIdCache[keys[i]];
    }
  };

  /**
   * Build the cache key used by resolve/prefetch for map-scoped VH uniqueids.
   * Returns null when region/status/date cannot be resolved yet.
   */
  private buildVhMapUniqueIdCacheKey = (): string | null => {
    const vhCategory = this.normalizeApos(String(this.state.vh || "")).trim();
    const status = vhCategory ? VH_TO_NDVI_STATUS[vhCategory] : undefined;
    if (!status) return null;

    const ndviDate =
      (this.state.ndviDateLocked && (this.state.ndviDate || "").trim()) ||
      this.getGeoScopedVhBarUsedDate() ||
      (this.state.ndviDate || "").trim();
    if (!ndviDate) return null;

    const rawViloyat = (
      this.state.lockedViloyat ||
      this.state.viloyat ||
      ""
    ).toString();
    const regionNum = resolveRegionNumberFromMaps(
      rawViloyat,
      this._viloyatToRegion,
      this.getGeoCodeHelpers(),
    );
    if (regionNum === undefined) return null;

    const rawTuman = (this.state.tuman || "").toString();
    const districtNum = rawTuman
      ? resolveDistrictNumberFromMaps(
          rawTuman,
          this._tumanToDistrict,
          this.getGeoCodeHelpers(),
          {
            rawViloyat,
            viloyatToRegion: this._viloyatToRegion,
          },
        )
      : undefined;

    const cropIds = this.getCropIdsForVhUniqueIdScope();

    return buildVhUniqueIdCacheKey({
      status,
      ndviDate,
      regionNum,
      districtNum,
      cropIds,
    });
  };


  /** True when the current VH map-scope uniqueid list is already cached. */
  private isVhMapUniqueIdCacheWarm = (): boolean => {
    const key = this.buildVhMapUniqueIdCacheKey();
    return !!key && Array.isArray(this._vhUniqueIdCache[key]);
  };

  /**
   * Warm the uniqueid cache for every VH status on the chart's working date.
   * Prefetches map scope (optional district) AND viloyat-wide (no district) so
   * AgriRegion's background resolve is usually a cache hit on VH click.
   *
   * Only runs while a VH bucket is already selected — geography-only viloyat
   * select must not page 4× status uniqueid chains in the background (~dozens
   * of PBF queries that never get used until the user clicks VH).
   */
  private prefetchVhStatusUniqueIds = (ndviDate: string): void => {
    const date = String(ndviDate || "").trim();
    if (!date || !this._isMounted) return;
    if (!String(this.state.vh || "").trim()) return;

    const rawViloyat = (
      this.state.lockedViloyat ||
      this.state.viloyat ||
      ""
    ).toString();
    const regionNum = resolveRegionNumberFromMaps(
      rawViloyat,
      this._viloyatToRegion,
      this.getGeoCodeHelpers(),
    );
    if (regionNum === undefined) return;

    const rawTuman = (this.state.tuman || "").toString();
    const districtNum = rawTuman
      ? resolveDistrictNumberFromMaps(
          rawTuman,
          this._tumanToDistrict,
          this.getGeoCodeHelpers(),
          {
            rawViloyat,
            viloyatToRegion: this._viloyatToRegion,
          },
        )
      : undefined;

    const cropIds = this.getCropIdsForVhUniqueIdScope();
    // Map scope (+ district when set) and always viloyat-wide for Region bars.
    const districtScopes: Array<number | undefined> =
      districtNum != null && Number.isFinite(districtNum)
        ? [districtNum, undefined]
        : [undefined];

    for (const status of Object.values(VH_TO_NDVI_STATUS)) {
      for (const districtScope of districtScopes) {
        const cacheKey = buildVhUniqueIdCacheKey({
          status,
          ndviDate: date,
          regionNum,
          districtNum: districtScope,
          cropIds,
        });
        if (this._vhUniqueIdCache[cacheKey]) continue;
        void queryVegetationUniqueIdsForStatus({
          region: regionNum,
          district: districtScope,
          date,
          ndviStatus: status,
          cropIds: cropIds.length ? cropIds : undefined,
        })
          .then((ids) => {
            if (!this._isMounted) return;
            this.setVhUniqueIdCacheEntry(cacheKey, ids);
          })
          .catch(() => {
            /* prefetch is best-effort */
          });
      }
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
      this._vhRegionChartUniqueIds = null;
      this._vhUniqueIdsCropScoped = false;
      clearPieVhFilterUniqueIds();
      return null;
    }

    const status = VH_TO_NDVI_STATUS[vhCategory];
    if (!status) {
      this._vhMapUniqueIds = [];
      this._vhRegionChartUniqueIds = [];
      this._vhUniqueIdsCropScoped = false;
      clearPieVhFilterUniqueIds();
      return [];
    }

    const rawViloyat = (this.state.lockedViloyat || this.state.viloyat || "").toString();
    const regionNum = resolveRegionNumberFromMaps(
      rawViloyat,
      this._viloyatToRegion,
      this.getGeoCodeHelpers(),
    );
    if (regionNum === undefined) {
      this._vhMapUniqueIds = [];
      this._vhRegionChartUniqueIds = [];
      this._vhUniqueIdsCropScoped = false;
      clearPieVhFilterUniqueIds();
      return [];
    }

    const rawTuman = (this.state.tuman || "").toString();
    const districtNum = rawTuman
      ? resolveDistrictNumberFromMaps(
          rawTuman,
          this._tumanToDistrict,
          this.getGeoCodeHelpers(),
          {
            rawViloyat,
            viloyatToRegion: this._viloyatToRegion,
          },
        )
      : undefined;

    const cropIdsForUniqueIds = this.getCropIdsForVhUniqueIdScope();
    // Chart-order rule: crop scopes vegetation uniqueids only when crop was
    // selected *before* VH (filterVhBarByCrop). When VH was first, uniqueids
    // stay status-wide and MapImage/Agri_table `turi` ANDs the crop.
    const chartFlags = this.getChartFilterFlags();
    const cropIds = Array.from(
      new Set(
        this.getSelectedTurlar()
          .map((turi) => this.resolveCropIdForTuri(turi))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    // Prefer the single date the VH chart already proved has rows — walking
    // every NDVI date on each status click is the main latency source.
    let dateCandidates: string[] = [];
    const forcedNdvi = (this.state.ndviDate || "").trim();
    const barDate = this.getGeoScopedVhBarUsedDate();
    // Ascending from service → probe newest first, stop at first hit below.
    // Cap walk length — probing an entire year of empty dates floods Network
    // with uniqueid PBF pages when VH is on and no date is known yet.
    const MAX_VH_DATE_WALK = 8;
    const buildWalk = (knownDates: string[], limit: number): string[] => {
      const selectedYear =
        String(this.state.yil || "").match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
      const scoped = selectedYear
        ? knownDates.filter((d) => String(d).startsWith(`${selectedYear}-`))
        : knownDates;
      return scoped.slice().reverse().slice(0, limit);
    };

    if (this.state.ndviDateLocked && forcedNdvi) {
      dateCandidates = [forcedNdvi];
    } else if (barDate) {
      dateCandidates = [barDate];
    } else {
      // Dates known from another viloyat/tuman are the cheapest first guess
      // (NDVI composites usually share dates across regions), but they may be
      // empty here — keep already-known dates behind them as fallbacks so a
      // scope change cannot end in a false "no data".
      const preferred = Array.from(
        new Set(
          [String(this._vhBarUsedDate || "").trim(), forcedNdvi].filter(Boolean),
        ),
      );
      let knownDates = this.state.ndviDateOptions || [];
      if (!knownDates.length && !preferred.length) {
        try {
          knownDates = await queryVegetationAvailableDates({
            region: regionNum,
            district: districtNum,
          });
          if (!stillOk()) return this._vhMapUniqueIds;
          if (this._isMounted && knownDates.length) {
            this.setState({ ndviDateOptions: knownDates });
          }
        } catch {
          knownDates = [];
        }
      }
      // Keep the fallback tail short when a likely date is already at hand —
      // a genuinely empty VH status must not turn into eight page-throughs.
      const walk = buildWalk(
        knownDates,
        preferred.length ? 3 : MAX_VH_DATE_WALK,
      );
      dateCandidates = [
        ...preferred,
        ...walk.filter((d) => !preferred.includes(d)),
      ];
    }

    if (!dateCandidates.length) {
      this._vhMapUniqueIds = [];
      this._vhRegionChartUniqueIds = [];
      this._vhUniqueIdsCropScoped = false;
      clearPieVhFilterUniqueIds();
      return [];
    }

    const fetchIdsForCrops = async (
      forCropIds: string[],
      forDate: string,
      /** Omit district for AgriRegion viloyat-wide bars. */
      forDistrict?: number,
    ): Promise<string[]> => {
      const cacheKey = buildVhUniqueIdCacheKey({
        status,
        ndviDate: forDate,
        regionNum,
        districtNum: forDistrict,
        cropIds: forCropIds,
      });
      const cached = this._vhUniqueIdCache[cacheKey];
      if (cached) return cached;
      const ids = await queryVegetationUniqueIdsForStatus({
        region: regionNum,
        district: forDistrict,
        date: forDate,
        ndviStatus: status,
        cropIds: forCropIds.length ? forCropIds : undefined,
      });
      this.setVhUniqueIdCacheEntry(cacheKey, ids);
      return ids;
    };

    try {
      // Map always ANDs crop + VH when both are set (crop-scoped ids).
      let ids: string[] = [];
      let ndviDate = dateCandidates[0];

      // Start viloyat-wide Region fetch in parallel with the map-scoped query
      // (same first candidate date). Map path never awaits this — if it finishes
      // first, the cache is warm and the first broadcast already has Region ids.
      let parallelRegionPromise: Promise<string[]> | null = null;
      if (districtNum != null && Number.isFinite(districtNum)) {
        parallelRegionPromise = fetchIdsForCrops(
          cropIdsForUniqueIds,
          dateCandidates[0],
          undefined,
        );
        // The branches below may never await this promise (cache hit / date
        // mismatch). Attach a no-op handler so a failed viloyat-wide fetch
        // cannot surface as an unhandled rejection.
        parallelRegionPromise.catch((): void => undefined);
      }

      for (const candidate of dateCandidates) {
        ids = await fetchIdsForCrops(cropIdsForUniqueIds, candidate, districtNum);
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
            ids = await fetchIdsForCrops(
              cropIdsForUniqueIds,
              candidate,
              districtNum,
            );
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

      // Crop-first but vegetation crop_id empty for this scope → fall back to
      // status-wide ids; map/Region/Indicator still AND `turi` text.
      let usedCropScopedIds = cropIdsForUniqueIds.length > 0 && ids.length > 0;
      if (
        !ids.length &&
        cropIdsForUniqueIds.length > 0 &&
        chartFlags.filterVhBarByCrop
      ) {
        AgriLocalization.agriLog("vhMapUniqueIds:crop-id-empty-fallback", {
          vhCategory,
          cropIds: cropIdsForUniqueIds,
          ndviDate: dateCandidates[0],
        });
        for (const candidate of dateCandidates) {
          ids = await fetchIdsForCrops([], candidate, districtNum);
          if (!stillOk()) return this._vhMapUniqueIds;
          if (ids.length) {
            ndviDate = candidate;
            usedCropScopedIds = false;
            break;
          }
        }
      }

      // Terminal staleness check: the loops above can await between the last
      // stillOk() and this write, so a superseded resolve must not publish its
      // ids over a newer selection's.
      if (!stillOk()) {
        AgriLocalization.agriLog("vhMapUniqueIds:SKIP-stale-write", {
          vhCategory,
          gen,
          count: ids.length,
        });
        return this._vhMapUniqueIds;
      }

      this._vhMapUniqueIds = ids;
      this._vhUniqueIdsCropScoped = usedCropScopedIds;

      // Region chart: same VH(+crop)/date, but never district-scoped.
      // When a tuman is selected, do NOT block map paint on the viloyat-wide
      // fetch — use cache / parallel result if ready, otherwise finish in
      // background and rebroadcast (AgriRegion keeps loader while ids are null).
      const regionCropIds = usedCropScopedIds ? cropIdsForUniqueIds : [];
      let regionChartIds: string[] | null = ids;
      let regionChartPending = false;
      if (districtNum != null && Number.isFinite(districtNum)) {
        const regionCacheKey = buildVhUniqueIdCacheKey({
          status,
          ndviDate,
          regionNum,
          districtNum: undefined,
          cropIds: regionCropIds,
        });
        const cachedRegion = this._vhUniqueIdCache[regionCacheKey];
        const parallelMatchesDate =
          ndviDate === dateCandidates[0] &&
          usedCropScopedIds === cropIdsForUniqueIds.length > 0;
        if (cachedRegion) {
          regionChartIds = cachedRegion;
          this._vhRegionChartUniqueIds = cachedRegion;
        } else if (parallelRegionPromise && parallelMatchesDate) {
          regionChartIds = null;
          regionChartPending = true;
          this._vhRegionChartUniqueIds = null;
          void parallelRegionPromise
            .then((regionIds) => {
              if (
                !this._isMounted ||
                gen !== this._vhResolveGen ||
                (isCurrent && !isCurrent()) ||
                !String(this.state.vh || "").trim()
              ) {
                return;
              }
              this.setVhUniqueIdCacheEntry(regionCacheKey, regionIds);
              this._vhRegionChartUniqueIds = regionIds;
              AgriLocalization.agriLog(
                "vhRegionChartUniqueIds:parallel-resolved",
                {
                  vhCategory,
                  status,
                  ndviDate,
                  regionNum,
                  cropCount: regionCropIds.length,
                  count: regionIds.length,
                },
              );
              this._reuseVhBarDataOnNextBroadcast = true;
              this.broadcastFilterState();
            })
            .catch((e: any) => {
              if (
                !this._isMounted ||
                gen !== this._vhResolveGen ||
                (isCurrent && !isCurrent())
              ) {
                return;
              }
              AgriLocalization.agriLog(
                "vhRegionChartUniqueIds:parallel-FAILED",
                {
                  vhCategory,
                  error: String(e?.message || e),
                },
              );
              this._vhRegionChartUniqueIds = [];
              this._reuseVhBarDataOnNextBroadcast = true;
              this.broadcastFilterState();
            });
        } else {
          regionChartIds = null;
          regionChartPending = true;
          this._vhRegionChartUniqueIds = null;
          void this.resolveVhRegionChartUniqueIdsBackground(
            gen,
            {
              status,
              regionNum,
              cropIds: regionCropIds,
              ndviDate,
              vhCategory,
            },
            isCurrent,
          );
        }
      } else {
        this._vhRegionChartUniqueIds = ids;
      }

      AgriLocalization.agriLog("vhMapUniqueIds:resolved", {
        vhCategory,
        status,
        ndviDate,
        regionNum,
        districtNum: districtNum ?? null,
        cropIds,
        cropIdsForUniqueIds,
        cropScoped: usedCropScopedIds,
        cropCount: cropIds.length,
        filterPieByVh: chartFlags.filterPieByVh,
        filterVhBarByCrop: chartFlags.filterVhBarByCrop,
        chartDimOrder: this._chartDimOrder.slice(),
        count: ids.length,
        regionChartCount: Array.isArray(regionChartIds)
          ? regionChartIds.length
          : null,
        regionChartPending,
        triedDates: dateCandidates.length,
        sampleMapIds: ids.slice(0, 3),
      });

      // Pie needs VH-only uniqueids (no crop) when VH was selected first.
      // Keep Pie at map geography (incl. district) — crop unscoped only.
      // Do not block map/Region broadcast on a second vegetation-table page
      // when crops are also selected; Pie refetches on the follow-up broadcast.
      if (chartFlags.filterPieByVh) {
        if (cropIds.length === 0 || !usedCropScopedIds) {
          setPieVhFilterUniqueIds(ids);
          AgriLocalization.agriLog("vhPieUniqueIds:published", {
            count: ids.length,
            unscopedByCrop: false,
          });
        } else {
          // Drop stale crop-scoped / previous-geo ids immediately so Pie keeps
          // its loader until the unscoped Pie fetch + follow-up broadcast.
          clearPieVhFilterUniqueIds();
          void fetchIdsForCrops([], ndviDate, districtNum)
            .then((pieIds) => {
              if (!stillOk()) return;
              setPieVhFilterUniqueIds(pieIds);
              AgriLocalization.agriLog("vhPieUniqueIds:published", {
                count: pieIds.length,
                unscopedByCrop: true,
                deferred: true,
              });
              this._reuseVhBarDataOnNextBroadcast = true;
              this.broadcastFilterState();
            })
            .catch(() => {
              if (!stillOk()) return;
              clearPieVhFilterUniqueIds();
            });
        }
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
      this._vhRegionChartUniqueIds = [];
      this._vhUniqueIdsCropScoped = false;
      clearPieVhFilterUniqueIds();
      return [];
    }
  };

  /**
   * After map-scoped VH ids are ready, finish viloyat-wide ids for AgriRegion
   * without holding up map filter / first broadcast.
   */
  private resolveVhRegionChartUniqueIdsBackground = async (
    resolveGen: number,
    params: {
      status: string;
      regionNum: number;
      cropIds: string[];
      ndviDate: string;
      vhCategory: string;
    },
    isCurrent?: () => boolean,
  ): Promise<void> => {
    const stillOk = () =>
      this._isMounted &&
      resolveGen === this._vhResolveGen &&
      (!isCurrent || isCurrent()) &&
      !!String(this.state.vh || "").trim();

    const cacheKey = buildVhUniqueIdCacheKey({
      status: params.status,
      ndviDate: params.ndviDate,
      regionNum: params.regionNum,
      districtNum: undefined,
      cropIds: params.cropIds,
    });

    try {
      let ids = this._vhUniqueIdCache[cacheKey];
      const fromCache = Boolean(ids);
      if (!ids) {
        ids = await queryVegetationUniqueIdsForStatus({
          region: params.regionNum,
          district: undefined,
          date: params.ndviDate,
          ndviStatus: params.status,
          cropIds: params.cropIds.length ? params.cropIds : undefined,
        });
        if (!stillOk()) return;
        this.setVhUniqueIdCacheEntry(cacheKey, ids);
      }
      if (!stillOk()) return;

      this._vhRegionChartUniqueIds = ids;
      AgriLocalization.agriLog("vhRegionChartUniqueIds:background-resolved", {
        vhCategory: params.vhCategory,
        status: params.status,
        ndviDate: params.ndviDate,
        regionNum: params.regionNum,
        cropCount: params.cropIds.length,
        count: ids.length,
        fromCache,
      });
      this._reuseVhBarDataOnNextBroadcast = true;
      this.broadcastFilterState();
    } catch (e: any) {
      if (!stillOk()) return;
      AgriLocalization.agriLog("vhRegionChartUniqueIds:background-FAILED", {
        vhCategory: params.vhCategory,
        error: String(e?.message || e),
      });
      this._vhRegionChartUniqueIds = [];
      this._reuseVhBarDataOnNextBroadcast = true;
      this.broadcastFilterState();
    }
  };

  private syncShownRegionYearLayers = (map: any): ShownRegionYearLayer[] => {
    // Strict: null = no VH uniqueid filter; [] = VH active but zero matches (1=0);
    // non-empty = uniqueid IN (...). Never treat [] as null (that showed all polygons).
    // Deferred first paint: ignore previous uniqueids on the map (turi-only) but
    // keep them in _vhMapUniqueIds so Region/Pie broadcasts do not go empty.
    const deferredMapPaint = this._suppressLegacyVhOnMap;
    const vhActive = !!String(this.state.vh || "").trim();
    const farmerActive = !!String(this.state.selectedFarmerInn || "").trim();
    const farmerIds =
      farmerActive && Array.isArray(this._farmerMapUniqueIds)
        ? this._farmerMapUniqueIds
        : null;
    const vhIds = deferredMapPaint
      ? null
      : vhActive && this._vhMapUniqueIds != null
        ? this._vhMapUniqueIds
        : null;
    // Prefer STIR uniqueids; when both VH + STIR are active, intersect.
    let uniqueIds: string[] | null = farmerIds;
    if (farmerIds && vhIds) {
      const vhSet = new Set(
        vhIds.map((id) => String(id || "").replace(/[{}]/g, "").toLowerCase()),
      );
      uniqueIds = farmerIds.filter((id) =>
        vhSet.has(String(id || "").replace(/[{}]/g, "").toLowerCase()),
      );
    } else if (!farmerIds) {
      uniqueIds = vhIds;
    }
    const mapVh =
      vhActive && uniqueIds == null && !deferredMapPaint && !farmerActive
        ? String(this.state.vh || "")
        : "";
    const selectedTurlar = this.getSelectedTurlar();
    // VH-first (or crop_id fallback): uniqueids are status-wide — AND turi on
    // the MapImage so the second-selected crop actually narrows the map.
    const andTuriWithUniqueIds =
      Array.isArray(uniqueIds) &&
      uniqueIds.length > 0 &&
      selectedTurlar.length > 0 &&
      !this._vhUniqueIdsCropScoped;
    const { districtCode } = this.getAdminBoundarySelection();
    return syncRegionYearLayerVisibility(map, {
      yil: this.state.yil,
      viloyat: this.getEffectiveViloyat(),
      tuman: this.state.tuman,
      districtCode: districtCode ?? null,
      turi: this.state.turi,
      turlar: selectedTurlar,
      vh: mapVh,
      uniqueIds,
      andTuriWithUniqueIds,
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
      `${statusField} = '${escapeArcGIS(statusTableValue)}'`,
    );
    const where = whereParts.join(" AND ");

    // Page through polygons to collect join IDs (hard page cap — same as area query).
    const pageSize = 2000;
    let offset = 0;
    let lastSize = 0;

    for (let page = 0; page < 250 && this._isMounted; page++) {
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
      offset += pageSize;
    }

    this._ndviBucketToIds[vhCategory] = Array.from(ids);
  };

  /* ---------------------- Map Filter Application ---------------------- */

  private async applyFiltersPersistent(
    isCurrent?: () => boolean,
    opts?: { vhDeferredSecondPass?: boolean },
  ): Promise<void> {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;

    const forceMapExportRefresh = shouldForceRegionYearMapExportRefresh({
      vhDeferredSecondPass: !!opts?.vhDeferredSecondPass,
    });

    // Resolve VH → uniqueids before touching MapImage definitionExpression.
    // VH-only path may already have resolved once — skip the duplicate walk.
    // Crop/tuman refreshes and VH-only cold+narrow clicks defer uniqueids so
    // geography/turi DE can paint before vegetation-table paging finishes.
    const vhApplyPhase = decideVhUniqueIdApplyPhase({
      uniqueIdsReadyForApply: this._vhUniqueIdsReadyForApply,
      deferVhUniqueIdResolve: this._deferVhUniqueIdResolve,
    });
    if (vhApplyPhase === "ready-clear") {
      this._vhUniqueIdsReadyForApply = false;
      this._suppressLegacyVhOnMap = false;
    } else if (vhApplyPhase === "defer-suppress") {
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

    // Reveal region-year MapImage layers before chart/table DE work so the
    // first export starts while Agri_table filters are still updating.
    try {
      const map = this.state.activeMapView?.view?.map;
      if (map) {
        const effectiveViloyat = this.getEffectiveViloyat();
        if (this.state.yil && effectiveViloyat) {
          // MapImage layerDefs only stick after metadata load — but never
          // block forever (race with maxWaitMs). Early preload overlaps this
          // wait. Geography uses ~1.5s so cold load usually finishes before
          // first DE (700ms left fields blank until a manual zoom).
          const hasVh = !!String(this.state.vh || "").trim();
          const ensureResult = await ensureRegionYearMapImagesReady(
            map,
            this.state.yil,
            effectiveViloyat,
            hasVh ? 2000 : 1500,
          );
          if (isCurrent && !isCurrent()) return;
          this._lastShownRegionYearLayers = this.syncShownRegionYearLayers(map);
          unlockShownRegionYearFieldScales(this._lastShownRegionYearLayers);
          this.applyInstantCropPaletteNoRefresh();
          if (forceMapExportRefresh) {
            refreshRegionYearMapExports(this._lastShownRegionYearLayers);
            // Timed-out ensure: metadata was not ready — re-sync DE after
            // load (layerDefs often don't stick before load), then refresh.
            if (ensureResult.timedOut) {
              void ensureResult.preload.then(() => {
                if (isCurrent && !isCurrent()) return;
                const mapReady = this.state.activeMapView?.view?.map;
                if (mapReady && this.state.yil && this.getEffectiveViloyat()) {
                  this._lastShownRegionYearLayers =
                    this.syncShownRegionYearLayers(mapReady);
                }
                unlockShownRegionYearFieldScales(
                  this._lastShownRegionYearLayers,
                );
                refreshRegionYearMapExports(this._lastShownRegionYearLayers);
              });
            }
          }
        } else {
          this._lastShownRegionYearLayers = this.syncShownRegionYearLayers(map);
          this.applyInstantCropPaletteNoRefresh();
          if (forceMapExportRefresh) {
            refreshRegionYearMapExports(this._lastShownRegionYearLayers);
          }
        }
      }
    } catch {
      /* best-effort; attribute-level data queries are unaffected */
    }

    const { featureLayers, spatialMapLayers } = this.state;
    let primaryWhere: string | null = null;
    const effectiveViloyatForTable = this.getEffectiveViloyat();

    if (featureLayers?.length) {
      featureLayers.forEach((fl) => {
        const isAgriTable = isAgriTableDataUrl(
          (fl as any)?.url || getAgriTableDataUrl(),
        );
        // Charts query Agri_table_data in republic mode (year only).
        // Map polygons still stay hidden until a viloyat is selected.
        let where = this.buildWhereForLayer(
          fl,
          true,
          true,
          isAgriTable,
        );
        where = augmentWhereWithNdviClauses({
          where,
          statusClause: this.buildNdviStatusClauseForCurrentVh(),
          dateClause: this.buildNdviDateClauseWithoutVh(),
          ndviDateLocked: !!this.state.ndviDateLocked,
        });
        if (fl.definitionExpression !== where) fl.definitionExpression = where;
        primaryWhere = pickPrimaryWhereForSpatialJoin(primaryWhere, where, {
          isAgriTable,
          hasEffectiveViloyat: !!effectiveViloyatForTable,
        });
      });

      // Agri_table_data has no geometry — mirror the same filter onto
      // FeatureLayer polygon layers, joined by uniqueid.
      // NEVER overwrite MapImage / sublayer definitionExpression here:
      // region-year MapImages are owned by syncRegionYearLayerVisibility
      // (tuman/turi text clauses). A uniqueid-IN rewrite flashes every
      // other district and races the first field click / popup.
      if (spatialMapLayers?.length && primaryWhere != null) {
        try {
          let spatialWhere = spatialWhereFromPrimarySync(primaryWhere);
          if (spatialWhere == null) {
            try {
              spatialWhere = buildSpatialJoinWhere(
                await queryAgriUniqueIdsForWhere(primaryWhere),
              );
            } catch {
              // queryAgriUniqueIdsForWhere is currently disabled
              // (AGRI_UNIQUEID_QUERY_ENABLED=false) and always throws here —
              // hide rather than leave the layer stuck at its last "1=1"
              // (every parcel in the country, not just the selection).
              spatialWhere = "1=0";
            }
          }
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

      const effectiveViloyat = effectiveViloyatForTable;
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
    this._prevDefinitionExpression = buildDefinitionExpressionDigest(
      featureLayers || [],
    );
  }

  private zoomToSelectedDistrict = async (view: any): Promise<boolean> => {
    const district = String(this.state.tuman || "").trim();
    if (!district || !view) return false;

    const districtRequestId = ++this._districtZoomRequestId;
    const entries = [...this._lastShownRegionYearLayers];
    const isCurrent = (): boolean =>
      this._isMounted && districtRequestId === this._districtZoomRequestId;
    const isEmptyExtent = isEmptyMapExtent;

    AgriLocalization.agriLog("zoom:district:start", {
      district,
      shownLayerCount: entries.length,
    });

    let mergedExtent: any = null;
    let queriedSublayerCount = 0;

    const extentTasks: Promise<any | null>[] = [];

    try {
      for (const entry of entries) {
        if (!isCurrent()) return false;

        const queryTargets = collectShownRegionYearQueryTargets(entry);

        AgriLocalization.agriLog("zoom:district:layer", {
          district,
          layer: String((entry.layer as any)?.title || (entry.layer as any)?.id || ""),
          sublayerCount: queryTargets.length,
        });

        for (const sublayer of queryTargets) {
          extentTasks.push(
            (async (): Promise<any | null> => {
              if (!isCurrent()) return null;
              try {
                const where = readQueryableDefinitionExpression(sublayer);
                if (!where) return null;

                const detached = await getDetachedQueryLayerFor(sublayer);
                if (!detached || !isCurrent()) return null;
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
                    sublayer: String(
                      (sublayer as any)?.title || (sublayer as any)?.id || "",
                    ),
                    message: String(error?.message || error),
                  });
                }

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

                return isEmptyExtent(extent) ? null : extent;
              } catch (error: any) {
                AgriLocalization.agriLog("zoom:district:sublayer-failed", {
                  district,
                  sublayer: String(
                    (sublayer as any)?.title || (sublayer as any)?.id || "",
                  ),
                  message: String(error?.message || error),
                });
                return null;
              }
            })(),
          );
        }
      }

      const extents = await Promise.all(extentTasks);
      mergedExtent = unionMapExtents(extents);

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
      (this._lastShownRegionYearLayers || []).some((entry) =>
        isShownRegionYearLayerOpaque(entry),
      );
    const {
      coverMap,
      coverReason,
      vhOnly,
    } = decideMapSurfaceCover({
      expectRegionLayer,
      alreadyOpaqueRegion,
      zoomReason: zoomRequest.reason,
      vhSelected: !!String(this.state.vh || "").trim(),
      vhUniqueIdsReady: Array.isArray(this._vhMapUniqueIds),
    });
    let loadingToken = 0;
    let mapOverlayDismissed = false;
    const dismissMapOverlay = (): void => {
      if (
        !mapOverlayDismissed &&
        coverMap &&
        loadingToken === this._mapSurfaceLoadingToken
      ) {
        mapOverlayDismissed = true;
        this.setMapSurfaceLoading(false, coverReason);
      }
    };
    if (coverMap) {
      loadingToken = ++this._mapSurfaceLoadingToken;
      this.setMapSurfaceLoading(true, coverReason);
      // One frame is enough for the overlay to paint; double-rAF added
      // ~32ms of pure wait before every region/year reveal.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }

    const prevExpr = this._prevDefinitionExpression;
    let revealAfterCrop = false;
    // First viloyat/year reveal: do NOT block zoom/overlay on crop distinct
    // query + forced MapImage redraw (often 1–3s). Layer visibility already
    // starts the export; crop colors catch up in the background.
    const deferCropForFastReveal = shouldDeferCropForFastReveal(
      zoomRequest.reason,
    );
    // Preserve a defer requested by VH-only cold+narrow click; otherwise
    // defer only for crop/tuman refreshes while a VH status stays active.
    const deferVhIds = shouldDeferVhUniqueIdResolve({
      priorDefer: this._deferVhUniqueIdResolve,
      vhOnly,
      vhSelected: !!String(this.state.vh || "").trim(),
      zoomReason: zoomRequest.reason,
      cropScopesVhUniqueIds: this.getChartFilterFlags().filterVhBarByCrop,
    });
    this._deferVhUniqueIdResolve = deferVhIds;
    try {
      await this.applyFiltersPersistent(stillCurrent);
      if (!stillCurrent()) return;

      // Region/year: layers are visible and exporting — lift the spinner now
      // instead of waiting for admin-boundary sync + zoom animation.
      if (deferCropForFastReveal) {
        dismissMapOverlay();
      }

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
            await this.applyFiltersPersistent(stillCurrent, {
              vhDeferredSecondPass: true,
            });
            // Region/Pie/Indicator listen to masterFilterChanged — without
            // this rebroadcast they keep 1=0 / stale ids after VH→crop.
            if (stillCurrent()) {
              this.broadcastFilterState();
              await this.fetchDataWithCurrentState();
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
      const shouldSyncCrop =
        !vhOnly &&
        !vhFilterActive &&
        this.state.cropRendererMode === "on" &&
        (this._lastShownRegionYearLayers || []).length > 0;
      if (shouldSyncCrop && deferCropForFastReveal) {
        AgriLocalization.agriLog("applyMapFiltersOptimized:defer-crop", {
          reason: zoomRequest.reason,
        });
        // CRITICAL: do NOT refresh/crop while the first visibility export is
        // in flight — that aborts the MapImage request and fields stay blank
        // until a second export finishes. Wait for the first paint, then colorize.
        void (async () => {
          try {
            await this.waitForShownRegionYearRedraw(false);
            if (!stillCurrent()) return;
            await this.syncCropRenderer();
          } catch (error: any) {
            AgriLocalization.agriLog(
              "applyMapFiltersOptimized:deferred-crop-FAILED",
              { error: String(error?.message || error) },
            );
          }
        })();
      } else if (shouldSyncCrop) {
        await this.syncCropRenderer();
        if (!stillCurrent()) return;
        // Crop refresh already kicked parent MapImage — wait for that export
        // instead of forcing another (canceled duplicate rows).
        if (awaitRedrawAfterCrop) await this.waitForShownRegionYearRedraw(false);
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
          requestAnimationFrame(() => resolve());
        });
      }
    } finally {
      this._deferVhUniqueIdResolve = false;
      if (revealAfterCrop) this.setShownRegionYearOpacity(1);
      // Always clear if this call still owns the overlay — including when the
      // apply went stale. Previously we only cleared when stillCurrent, which
      // left the spinner stuck after SKIP-stale-apply races.
      if (!mapOverlayDismissed && coverMap && loadingToken === this._mapSurfaceLoadingToken) {
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

    // Admin boundary outlines — await so district names paint on view.graphics
    // above MapImage (fire-and-forget used to lose the race / look unchanged).
    const adminBoundary: {
      extent: any;
      level: "district" | "region" | "none";
    } = { extent: null, level: "none" };
    if (stillCurrent() && activeMapView?.view) {
      try {
        const selection = this.getAdminBoundarySelection();
        AgriLocalization.agriLog("zoom:admin-boundary:sync-start", {
          viloyat: selection.viloyat,
          tuman: selection.tuman,
          regionCode: selection.regionCode ?? null,
          nameCount: selection.districtNames?.length ?? 0,
          codeCount: selection.districtCodes?.length ?? 0,
          nameSample: (selection.districtNames || []).slice(0, 5),
        });
        if (!selection.viloyat && !selection.tuman) {
          await clearAgriAdminBoundaries(activeMapView.view);
        } else {
          const synced = await syncAgriAdminBoundaries(
            activeMapView.view,
            selection,
          );
          adminBoundary.extent = synced.extent;
          adminBoundary.level = synced.level;
        }
      } catch (error: any) {
        AgriLocalization.agriLog("zoom:admin-boundary:failed", {
          message: String(error?.message || error),
        });
      }
    }

    const expressionDigest = buildDefinitionExpressionDigest(
      featureLayers || [],
    );
    const expressionChanged = expressionDigest !== prevExpr;

    const wasPolygonMode = this._prevPolygonModeForZoomGuard;
    this._prevPolygonModeForZoomGuard = this.state.polygonMode;
    const justExitedPolygonMode = wasPolygonMode && !this.state.polygonMode;

    // Geography zooms must run even when the same setState also cleared
    // polygonMode (field → new tuman / Back to viloyat). The old
    // justExitedPolygonMode guard blocked those and left the map stuck on
    // the field extent. Only skip a bare "other" pass that coincides with
    // popup close — AgriPopup restores the pre-field extent itself.
    const isGeographyZoom = isGeographyZoomReason(zoomRequest.reason);

    const zoomEnabled = this.props.config?.settings?.zoomToSelection !== false;
    const shouldNavigate = shouldNavigateMapZoom({
      zoomEnabled,
      zoomMode: zoomRequest.mode,
      hasActiveMapView: Boolean(activeMapView),
      zoomReason: zoomRequest.reason,
      polygonMode: this.state.polygonMode,
      justExitedPolygonMode,
    });

    // goTo aborts in-flight MapImage export — fields stay blank until the
    // user zooms by hand. Reassert DE + refresh after the animation settles.
    if (
      stillCurrent() &&
      expectRegionLayer &&
      isGeographyZoom
    ) {
      // One goTo already lands at field-visible scale — settle after that.
      const settleDelay = shouldNavigate
        ? zoomGoToDurationMsForReason(zoomRequest.reason) + 120
        : 150;
      this.scheduleShownRegionYearSettleRepaint(
        requestId,
        settleDelay,
        `after-${zoomRequest.reason}`,
      );
    }

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
    const isEmptyExtent = isEmptyMapExtent;

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
      const extentTasks: Promise<any | null>[] = [];
      for (const entry of this._lastShownRegionYearLayers) {
        if (isStale()) return null;
        const queryTargets = collectShownRegionYearQueryTargets(entry);
        for (const sublayer of queryTargets) {
          extentTasks.push(
            (async (): Promise<any | null> => {
              if (isStale()) return null;
              try {
                const where = readQueryableDefinitionExpression(sublayer);
                if (!where) return null;
                const detached = await getDetachedQueryLayerFor(sublayer);
                if (!detached || isStale()) return null;
                const query = detached.createQuery();
                query.where = where;
                query.returnGeometry = true;
                const extent = (await detached.queryExtent(query))?.extent;
                return isEmptyExtent(extent) ? null : extent;
              } catch {
                return null;
              }
            })(),
          );
        }
      }

      const results = await Promise.all(extentTasks);
      let queried = 0;
      for (const extent of results) {
        if (!isEmptyExtent(extent)) queried += 1;
      }
      let merged = unionMapExtents(results);

      if (isEmptyExtent(merged)) {
        merged = unionShownRegionYearFullExtents(
          this._lastShownRegionYearLayers,
        );
      }

      AgriLocalization.agriLog("zoom:shown-region-extent", {
        reason: zoomRequest.reason,
        queriedSublayerCount: queried,
        parallelTasks: extentTasks.length,
        hasExtent: !isEmptyExtent(merged),
        xmin: merged?.xmin,
        ymin: merged?.ymin,
        xmax: merged?.xmax,
        ymax: merged?.ymax,
      });
      return isEmptyExtent(merged) ? null : merged;
    };

    const resolveAdminBoundaryExtent = async (): Promise<void> => {
      if (!activeMapView?.view || isStale()) return;
      const selection = this.getAdminBoundarySelection();
      if (!selection.viloyat && !selection.tuman) return;
      try {
        const synced = await queryAgriAdminBoundaryExtentOnly(selection);
        if (isStale()) return;
        adminBoundary.extent = synced.extent;
        adminBoundary.level = synced.level;
        AgriLocalization.agriLog("zoom:admin-boundary", {
          level: adminBoundary.level,
          hasExtent: !!adminBoundary.extent,
          viloyat: selection.viloyat,
          tuman: selection.tuman,
          regionCode: selection.regionCode ?? null,
          districtCode: selection.districtCode ?? null,
        });
      } catch (error: any) {
        AgriLocalization.agriLog("zoom:admin-boundary:extent-failed", {
          message: String(error?.message || error),
        });
      }
    };

    try {
      AgriLocalization.agriLog("zoom:navigate-start", {
        reason: zoomRequest.reason,
        mode: zoomRequest.mode,
        viloyat: this.getEffectiveViloyat(),
        tuman: this.state.tuman,
        shownLayerCount: (this._lastShownRegionYearLayers || []).length,
        adminBoundaryLevel: adminBoundary.level,
      });

      if (isDistrictZoomPath(zoomRequest.reason, this.state.tuman || "")) {
        // Start field extent in parallel so admin miss → fallback is warm.
        const fieldFallbackPromise = queryShownRegionYearExtent();
        await resolveAdminBoundaryExtent();
        if (!isEmptyExtent(adminBoundary.extent) && !isStale()) {
          AgriLocalization.agriLog("zoom:district:admin-boundary", {
            district: this.state.tuman,
          });
          await navigate(
            adminBoundary.extent.expand(districtAdminExpandFactor()),
            700,
          );
          return;
        }
        const districtZoomed = await this.zoomToSelectedDistrict(view);
        if (districtZoomed) {
          AgriLocalization.agriLog("zoom:district:done", {
            district: this.state.tuman,
          });
        } else {
          const [fallback] = await Promise.all([
            fieldFallbackPromise,
            resolveAdminBoundaryExtent(),
          ]);
          if (!isEmptyExtent(fallback) && !isStale()) {
            AgriLocalization.agriLog("zoom:district:fallback-region", {});
            await navigate(
              fallback.expand(districtFallbackRegionExpandFactor()),
              700,
            );
          } else if (!isEmptyExtent(adminBoundary.extent) && !isStale()) {
            await navigate(
              adminBoundary.extent.expand(districtAdminExpandFactor()),
              700,
            );
          }
        }
        return;
      }

      if (zoomRequest.mode === "home") {
        const now = Date.now();
        if (
          shouldSkipHomeGoTo({
            now,
            lastHomeGoToAt: this._lastHomeGoToAt,
          }) ||
          isStale()
        ) {
          return;
        }

        try {
          await clearAgriAdminBoundaries(view);
        } catch {
          /* ignore */
        }

        let home: any = pickHomeExtentCandidate({
          storedHome: this._homeExtent,
          mapFullExtent: (view.map as any)?.fullExtent,
          layerFullExtent: primaryLayer.fullExtent,
        });
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
          await navigate(home, homeGoToDurationMs());
        }
        return;
      }

      // Region / back-from-district / polygon-exit: only the shown
      // region-year layer. Do NOT query every spatialMapLayers MapImage
      // leaf (that unions Andijan+Tashkent+… and zooms to the whole map).
      const useShownRegionExtent = preferShownRegionYearExtent(
        zoomRequest.reason,
      );

      let mergedExtent: __esri.Extent | null = null;

      if (useShownRegionExtent) {
        // Race field queryExtent vs admin outline — don't wait for the slow
        // detached MapImage extent when admin region is already ready.
        const fieldPromise = queryShownRegionYearExtent();
        const adminPromise = resolveAdminBoundaryExtent();
        const raced = await raceRegionExtentPick({
          fieldPromise,
          adminPromise,
          getAdminExtent: () => adminBoundary.extent,
          getAdminLevel: () => adminBoundary.level,
          isEmptyExtent,
        });
        if (raced.source === "field") {
          mergedExtent = raced.extent;
          AgriLocalization.agriLog("zoom:region:field-extent", {
            reason: zoomRequest.reason,
          });
        } else if (raced.source === "admin-region") {
          mergedExtent = raced.extent;
          AgriLocalization.agriLog("zoom:region:admin-boundary", {
            reason: zoomRequest.reason,
          });
        }
      } else {
        // Crop / NDVI / vegetation: prefer non-MapImage spatial FeatureLayers
        // that carry the uniqueid mirror; skip MapImage-owned leaves.
        for (const spatialLayer of this.state.spatialMapLayers || []) {
          if (isStale()) return;
          if (isMapImageOwnedLayer(spatialLayer)) continue;
          try {
            if (typeof (spatialLayer as any)?.load === "function") {
              await safeLoadMapLayer(spatialLayer);
            }
            if (!canQuerySpatialFeatureExtent(spatialLayer)) continue;
            const where = readSpatialFeatureExtentWhere(spatialLayer);
            if (!where) continue;
            const query = (spatialLayer as any)?.createQuery
              ? (spatialLayer as any).createQuery()
              : {};
            query.where = where;
            const result = await (spatialLayer as any).queryExtent(query);
            if (isStale()) return;
            mergedExtent = appendSpatialFeatureExtent(
              mergedExtent,
              result?.extent,
            );
          } catch {
            /* continue */
          }
        }

        const cropPlan = planCropNdviExtentSource({
          hasMergedSpatialExtent: !!mergedExtent,
          hasTuman: !!this.state.tuman,
          selectedTurlarCount: this.getSelectedTurlar().length,
        });
        if (cropPlan === "fallback-shown") {
          mergedExtent = await queryShownRegionYearExtent();
        } else if (cropPlan === "narrow-shown") {
          // Narrow FeatureLayer union further using shown MapImage DE when
          // crop/NDVI zoom needs the live tuman/turi clause.
          const shown = await queryShownRegionYearExtent();
          if (!isEmptyExtent(shown)) mergedExtent = shown;
        }
      }

      if (!isEmptyExtent(mergedExtent) && !isStale()) {
        const expandFactor = zoomExpandFactorForReason(zoomRequest.reason);
        const goToMs = zoomGoToDurationMsForReason(zoomRequest.reason);
        AgriLocalization.agriLog("zoom:goTo", {
          reason: zoomRequest.reason,
          expandFactor,
          goToMs,
        });
        // Full viloyat/tuman framing (no forced closer scale). Fields open via
        // unlocked minScale + settle repaint at this same view scale.
        await navigate(mergedExtent!.expand(expandFactor), goToMs);
      } else if (!this.getEffectiveViloyat() && !isStale()) {
        const home =
          this._homeExtent || (view.map as any)?.fullExtent;
        if (!isEmptyExtent(home)) {
          AgriLocalization.agriLog("zoom:goTo-home-fallback", {});
          await navigate(home, homeGoToDurationMs());
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
      // Re-paint district strokes/labels on view.graphics after goTo / MapImage
      // export — first sync can finish before the view is stable.
      if (stillCurrent() && activeMapView?.view) {
        const selection = this.getAdminBoundarySelection();
        if (selection.viloyat || selection.tuman) {
          void syncAgriAdminBoundaries(activeMapView.view, selection).catch(
            (): void => undefined,
          );
        }
      }
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

      const vhSelected = !!String(this.state.vh || "").trim();
      if (vhSelected && !Array.isArray(this._vhMapUniqueIds)) {
        if (isCurrent()) {
          this.setState({ loading: false });
        }
        return;
      }

      // Also ask the service for the true total count with this WHERE, independent of page limits.
      const includeVh = vhSelected && Array.isArray(this._vhMapUniqueIds);
      const perLayerCounts = await Promise.all(
        layers.map(async (featureLayer) => {
          const whereClause = this.buildWhereForLayer(featureLayer, includeVh);
          if (!whereClause || whereClause === "1=0") return 0;
          try {
            return await dedupedQueryFeatureCount(featureLayer, whereClause);
          } catch (err) {
            AgriLocalization.debugCatch("fetchData:count-failed", err);
            return 0;
          }
        }),
      );

      if (!isCurrent()) return;

      let totalCountFromService = perLayerCounts.reduce(
        (sum, value) => sum + value,
        0,
      );

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
        className={`agri-region-card agri-v20-root ${isDarkTheme ? "dark-theme" : "light-theme"}`}
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

        <div className="agri-region-content">
          {connectionStatus === "connecting" && (
            <div
              className="agri-region-loading-container"
              style={{ minHeight: 80 }}
            />
          )}

          {connectionStatus === "failed" && (
            <div className="agri-region-error">
              <p>{error || "Failed to connect. Please retry."}</p>
              <button
                onClick={this.retryMapConnection}
                className="agri-region-retry-button"
              >
                Retry
              </button>
            </div>
          )}

          {connectionStatus === "connected" && (
            <>
              {error && !loading && (
                <div
                  className="agri-region-error"
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
                      onFocus={this.handleGraffSearchFocus}
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
                      ref={this._notificationsToolbarItemRef}
                    >
                      <button
                        type="button"
                        className={`agri-v20-toolbar-btn ${openToolbarMenu === "notifications" ? "is-active" : ""}`}
                        onClick={() => this.toggleToolbarMenu("notifications")}
                        data-tooltip={
                          language === "en"
                            ? "Notifications"
                            : language === "ru"
                              ? "Уведомления"
                              : language === "uz_lat"
                                ? "Bildirishnomalar"
                                : "Билдиришномалар"
                        }
                        aria-label={
                          language === "en"
                            ? "Notifications"
                            : language === "ru"
                              ? "Уведомления"
                              : language === "uz_lat"
                                ? "Bildirishnomalar"
                                : "Билдиришномалар"
                        }
                        aria-pressed={openToolbarMenu === "notifications"}
                      >
                        <BellIcon />
                      </button>
                    </div>

                    <div
                      className="agri-v20-toolbar-item"
                      ref={this._indexInfoToolbarItemRef}
                    >
                      <button
                        type="button"
                        className={`agri-v20-toolbar-btn ${openToolbarMenu === "indexInfo" ? "is-active" : ""}`}
                        onClick={() => this.toggleToolbarMenu("indexInfo")}
                        data-tooltip={indexInfoLabel}
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
                        data-tooltip={yilLabel}
                        aria-label={yilLabel}
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
                        data-tooltip={langLabel}
                        aria-label={langLabel}
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
                        data-tooltip={themeLabel}
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
                        data-tooltip={logoutLabel}
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
              {this.renderNotificationsMenuFloating()}
            </>
          )}
        </div>
      </div>
    );
  }
}

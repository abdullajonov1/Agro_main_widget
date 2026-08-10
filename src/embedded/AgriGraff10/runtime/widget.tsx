// Enhanced Kadastr Status Widget - Fixed Regional Filtering + Graph View

import Color from "esri/Color";
import SimpleFillSymbol from "esri/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "esri/symbols/SimpleLineSymbol";
import SimpleMarkerSymbol from "esri/symbols/SimpleMarkerSymbol";
import MediaLayer from "esri/layers/MediaLayer";
import FeatureLayer from "esri/layers/FeatureLayer";
import ImageElement from "esri/layers/support/ImageElement";
import ExtentAndRotationGeoreference from "esri/layers/support/ExtentAndRotationGeoreference";
import Extent from "esri/geometry/Extent";
import SpatialReference from "esri/geometry/SpatialReference";
import * as projection from "esri/geometry/projection";
import { JimuMapView, JimuMapViewComponent } from "jimu-arcgis";
import {
  AllWidgetProps,
  DataSource,
  DataSourceManager,
  QueriableDataSource,
  React,
} from "jimu-core";
import ReactDOM from "react-dom";
import debounce from "lodash/debounce";
import throttle from "lodash/throttle";
import {
  TriangleAlert,
  Table,
  ChartLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import AgriDashboardSpinner from "../../../shared/AgriDashboardSpinner";
import AgriChartLoader from "../../../shared/AgriChartLoader";
import { agriNoDataLabel } from "../../../shared/agriNoDataLabel";
import { translateUzbekPlaceToEnglish, type EnglishPlaceKind } from "../../shared/english-place-names";
import {
  getQueryableLayer,
  getDetachedQueryLayerFor,
  getMapImageParentLayer,
  isMapImageOwnedLayer,
  withEvapoAccessWhere,
} from "../../shared/feature-layer-data";
import {
  getAgriTableDataLayer,
  queryAgriRegionDistrictMappings,
  queryAgriTuriCropMappings,
  queryAgriUniqueIdsForWhere,
  buildSpatialJoinWhere,
} from "../../shared/agri-table-data-source";
import {
  getAgriVegetationIndicesLayer,
  queryVegetationSeriesForUniqueId,
  queryVegetationRegionalTimeseries,
  formatArcgisDateToYmd,
} from "../../shared/agri-vegetation-data-source";
import {
  fetchPolygonAvailableDates,
  fetchPolygonExportImageTiff,
  warmPolygonApiConnection,
  type VegetationIndiceType,
} from "../../shared/agri-polygon-api-source";
import "./AgriGraff.css";

const WIDGET_ID = "AgriGraffWidget";

// Required fields for the widget to function
const REQUIRED_FIELDS = [
  "uniqueid",
  "tuman",
  "f_name",
  "f_inn",
  "maydon",
  "turi",
  "vh",
  "viloyat",
  "yil",
];

interface ConfiguredFilters {
  [fieldName: string]: string;
}

interface RecordData {
  uniqueid?: string;
  tuman?: string;
  f_name?: string;
  f_inn?: string;
  maydon?: string | number;
  turi?: string;
  vh?: string;
  status?: string;
  objectid?: number;
  [key: string]: any;
}

interface VegetationIndex {
  uniqueid: string;
  raster_date: string;
  objectid: number;
  ndvi: number;
  ndvi_min: number;
  ndvi_max: number;
  savi: number;
  savi_min: number;
  savi_max: number;
  rvi: number;
  rvi_min: number;
  rvi_max: number;
  ci: number;
  ci_min: number;
  ci_max: number;
  evi: number;
  ndwi: number;
  ndwi_min: number;
  ndwi_max: number;
  pixel_count: number;
  mean_red: number;
  mean_nir: number;
  mean_green: number;
  id: number;
  raster_id: number;
  processed_at: string;
}

/** Regional timeseries API response item (GET /api/v1/vegetation/regional/timeseries) */
interface RegionalTimeseriesRow {
  date: string;
  ndvi: number;
  ndvi_min: number;
  ndvi_max: number;
  savi: number;
  savi_min: number;
  savi_max: number;
  rvi: number;
  rvi_min: number;
  rvi_max: number;
  ci: number;
  ci_min: number;
  ci_max: number;
  evi: number;
  ndwi: number;
  ndwi_min: number;
  ndwi_max: number;
  polygon_count: number;
}

/** Chart accepts polygon data (raster_date) or regional data normalized to same shape */
type ChartVegetationRow =
  | VegetationIndex
  | (RegionalTimeseriesRow & { raster_date: string });

const REPUBLIC_TIMESERIES_INDEX_FIELDS = [
  "ndvi",
  "savi",
  "evi",
  "rvi",
  "ci",
  "ndwi",
] as const;

type RepublicTimeseriesIndexField =
  (typeof REPUBLIC_TIMESERIES_INDEX_FIELDS)[number];

const isRepublicTimeseriesIndexField = (
  value: string,
): value is RepublicTimeseriesIndexField =>
  (REPUBLIC_TIMESERIES_INDEX_FIELDS as readonly string[]).includes(value);

/** Normalize regional/chart row date to YYYY-MM-DD for merge keys. */
const regionalTimeseriesRowToYmd = (row: {
  date?: unknown;
  raster_date?: unknown;
}): string | null => {
  const rawValue: unknown = row.raster_date ?? row.date;
  const rawDate = String(rawValue ?? "").trim();
  if (!rawDate) return null;
  let parsedDate: Date;
  if (typeof rawValue === "number" || /^\d{10,13}$/.test(rawDate)) {
    const epoch = Number(rawValue);
    parsedDate = new Date(rawDate.length === 10 ? epoch * 1000 : epoch);
  } else {
    parsedDate = new Date(rawDate);
  }
  if (Number.isNaN(parsedDate.getTime())) return null;
  return parsedDate.toISOString().slice(0, 10);
};

/**
 * Merge newly fetched index columns into an existing regional chart series
 * by date. Never overwrites a finite existing value with null/NaN from a
 * partial (single-index) republic query.
 */
const mergeRegionalTimeseriesFieldsIntoChart = (
  existing: ChartVegetationRow[],
  incoming: RegionalTimeseriesRow[],
  fields: readonly string[],
): ChartVegetationRow[] => {
  const byDate = new Map<string, Record<string, any>>();
  for (const row of existing) {
    const ymd = regionalTimeseriesRowToYmd(row as any);
    if (!ymd) continue;
    byDate.set(ymd, {
      ...(row as any),
      date: ymd,
      raster_date: ymd,
    });
  }
  for (const row of incoming) {
    const ymd = regionalTimeseriesRowToYmd(row);
    if (!ymd) continue;
    const prev = byDate.get(ymd) || {
      date: ymd,
      raster_date: ymd,
      polygon_count: 0,
    };
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
      const nextValue = (row as any)[field];
      const nextNum = nextValue == null ? Number.NaN : Number(nextValue);
      const prevNum =
        prev[field] == null ? Number.NaN : Number(prev[field]);
      // Partial queries leave other indices null — keep prior finite values.
      if (!Number.isFinite(nextNum) && Number.isFinite(prevNum)) continue;
      prev[field] = nextValue;
    }
    if (row.polygon_count != null) {
      prev.polygon_count = row.polygon_count;
    }
    prev.date = ymd;
    prev.raster_date = ymd;
    byDate.set(ymd, prev);
  }
  return Array.from(byDate.values())
    .sort(
      (a, b) =>
        new Date(String(a.date)).getTime() - new Date(String(b.date)).getTime(),
    ) as ChartVegetationRow[];
};

const mergeRegionalTimeseriesGroups = (
  groups: RegionalTimeseriesRow[][],
): RegionalTimeseriesRow[] => {
  const averageFields = ["ndvi", "savi", "rvi", "ci", "evi", "ndwi"] as const;
  const rangeFields = ["ndvi", "savi", "rvi", "ci", "ndwi"] as const;
  const buckets = new Map<string, any>();

  for (const row of groups.flat()) {
    const rawValue: unknown = row.date;
    const rawDate = String(rawValue ?? "").trim();
    let parsedDate: Date;
    if (
      typeof rawValue === "number" ||
      /^\d{10,13}$/.test(rawDate)
    ) {
      const epoch = Number(rawValue);
      parsedDate = new Date(rawDate.length === 10 ? epoch * 1000 : epoch);
    } else {
      parsedDate = new Date(rawDate);
    }
    if (Number.isNaN(parsedDate.getTime())) continue;
    const date = parsedDate.toISOString().slice(0, 10);
    if (!date) continue;
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = {
        ...row,
        date,
        polygon_count: 0,
        __fieldWeights: {} as Record<string, number>,
      };
      averageFields.forEach((field) => {
        bucket[field] = 0;
        bucket.__fieldWeights[field] = 0;
      });
      rangeFields.forEach((field) => {
        bucket[`${field}_min`] = Number.POSITIVE_INFINITY;
        bucket[`${field}_max`] = Number.NEGATIVE_INFINITY;
      });
      buckets.set(date, bucket);
    }

    const polygonCount = Math.max(0, Number(row.polygon_count) || 0);
    const weight = polygonCount || 1;
    bucket.polygon_count += polygonCount;
    averageFields.forEach((field) => {
      const raw = row[field];
      const value = raw == null ? Number.NaN : Number(raw);
      if (!Number.isFinite(value)) return;
      bucket[field] += value * weight;
      bucket.__fieldWeights[field] += weight;
    });
    rangeFields.forEach((field) => {
      const minRaw = row[`${field}_min`];
      const maxRaw = row[`${field}_max`];
      const minValue = minRaw == null ? Number.NaN : Number(minRaw);
      const maxValue = maxRaw == null ? Number.NaN : Number(maxRaw);
      if (Number.isFinite(minValue)) {
      bucket[`${field}_min`] = Math.min(
        bucket[`${field}_min`],
          minValue,
      );
      }
      if (Number.isFinite(maxValue)) {
      bucket[`${field}_max`] = Math.max(
        bucket[`${field}_max`],
          maxValue,
      );
      }
    });
  }

  return Array.from(buckets.values()).map((bucket) => {
    averageFields.forEach((field) => {
      const fieldWeight = Number(bucket.__fieldWeights[field]) || 0;
      bucket[field] = fieldWeight ? bucket[field] / fieldWeight : null;
    });
    rangeFields.forEach((field) => {
      if (!Number.isFinite(bucket[`${field}_min`])) bucket[`${field}_min`] = 0;
      if (!Number.isFinite(bucket[`${field}_max`])) bucket[`${field}_max`] = 0;
    });
    delete bucket.__fieldWeights;
    return bucket as RegionalTimeseriesRow;
  });
};

/** Map precalculated ndvi_status values on the polygon layer to VH category labels (must match AgriFilter/AgriBar). */
const NDVI_STATUS_TO_VH: Record<string, string> = {
  juda_yaxshi: "1-Juda yaxshi",
  yaxshi: "2-Yaxshi",
  orta: "3-O'rta",
  past: "4-Past",
};

/** Reverse mapping: VH category label → ndvi_status table value (for WHERE clause). */
const VH_TO_NDVI_STATUS: Record<string, string> = {
  "1-Juda yaxshi": "juda_yaxshi",
  "2-Yaxshi": "yaxshi",
  "3-O'rta": "orta",
  "4-Past": "past",
};

type AgriGraffDisplayLanguage = "uz_cyr" | "uz_lat" | "ru" | "en";

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
// local `console` shadow below (a bare `const nativeConsole = console`
// would hit the same shadowed binding due to TDZ, since `const console`
// shadows the identifier for this entire module scope). graffLog() needs
// this to actually print; otherwise its trace is silently swallowed.
const nativeConsole: Console =
  typeof window !== "undefined" ? window.console : ({} as Console);

const console = {
  log: (..._args: any[]) => {},
  warn: (..._args: any[]) => {},
  error: (..._args: any[]) => {},
  info: (..._args: any[]) => {},
  debug: (..._args: any[]) => {},
};

function resolveInitialAgri3Language(): AgriGraffDisplayLanguage {
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
      v === "uz_latin" ||
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

const UZ_CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A",
  а: "a",
  Б: "B",
  б: "b",
  В: "V",
  в: "v",
  Г: "G",
  г: "g",
  Д: "D",
  д: "d",
  Е: "E",
  е: "e",
  Ё: "Yo",
  ё: "yo",
  Ж: "J",
  ж: "j",
  З: "Z",
  з: "z",
  И: "I",
  и: "i",
  Й: "Y",
  й: "y",
  К: "K",
  к: "k",
  Л: "L",
  л: "l",
  М: "M",
  м: "m",
  Н: "N",
  н: "n",
  О: "O",
  о: "o",
  П: "P",
  п: "p",
  Р: "R",
  р: "r",
  С: "S",
  с: "s",
  Т: "T",
  т: "t",
  У: "U",
  у: "u",
  Ф: "F",
  ф: "f",
  Х: "X",
  х: "x",
  Ц: "Ts",
  ц: "ts",
  Ч: "Ch",
  ч: "ch",
  Ш: "Sh",
  ш: "sh",
  Щ: "Shch",
  щ: "shch",
  Ъ: "'",
  ъ: "'",
  Ы: "I",
  ы: "i",
  Ь: "'",
  ь: "'",
  Э: "E",
  э: "e",
  Ю: "Yu",
  ю: "yu",
  Я: "Ya",
  я: "ya",
  Ғ: "Gʻ",
  ғ: "gʻ",
  Қ: "Q",
  қ: "q",
  Ў: "Oʻ",
  ў: "oʻ",
  Ҳ: "H",
  ҳ: "h",
  Ң: "Ng",
  ң: "ng",
};

const UZ_LATIN_TO_CYRILLIC: Record<string, string> = {
  A: "А",
  a: "а",
  B: "Б",
  b: "б",
  C: "Ц",
  c: "ц",
  D: "Д",
  d: "д",
  E: "Е",
  e: "е",
  F: "Ф",
  f: "ф",
  G: "Г",
  g: "г",
  H: "Ҳ",
  h: "ҳ",
  I: "И",
  i: "и",
  J: "Ж",
  j: "ж",
  K: "К",
  k: "к",
  L: "Л",
  l: "л",
  M: "М",
  m: "м",
  N: "Н",
  n: "н",
  O: "О",
  o: "о",
  P: "П",
  p: "п",
  Q: "Қ",
  q: "қ",
  R: "Р",
  r: "р",
  S: "С",
  s: "с",
  T: "Т",
  t: "т",
  U: "У",
  u: "у",
  V: "В",
  v: "в",
  X: "Х",
  x: "х",
  Y: "Й",
  y: "й",
  Z: "З",
  z: "з",
  Gʻ: "Ғ",
  gʻ: "ғ",
  "G'": "Ғ",
  "g'": "ғ",
  Oʻ: "Ў",
  oʻ: "ў",
  "O'": "Ў",
  "o'": "ў",
  Sh: "Ш",
  sh: "ш",
  Ch: "Ч",
  ch: "ч",
  Ng: "Ң",
  ng: "ң",
  Yo: "Ё",
  yo: "ё",
  Yu: "Ю",
  yu: "ю",
  Ya: "Я",
  ya: "я",
  Ts: "Ц",
  ts: "ц",
  Shch: "Щ",
  shch: "щ",
};

function isPredominantlyCyrillic(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  const cyrillic = (str.match(/[\u0400-\u04FF]/g) || []).length;
  const latin = (str.match(/[a-zA-Z]/g) || []).length;
  return cyrillic >= latin;
}

function uzCyrillicToLatin(text: string): string {
  if (!text || typeof text !== "string") return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += UZ_CYRILLIC_TO_LATIN[text[i]] ?? text[i];
  }
  return out;
}

function uzLatinToCyrillic(text: string): string {
  if (!text || typeof text !== "string") return text;
  const lower = text.toLowerCase();
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const twoLower = lower.slice(i, i + 2);
    const mappedTwo =
      UZ_LATIN_TO_CYRILLIC[two] ?? UZ_LATIN_TO_CYRILLIC[twoLower];
    if (two.length === 2 && mappedTwo) {
      out += mappedTwo;
      i += 2;
      continue;
    }
    const c = text[i];
    const cLower = lower[i];
    out += UZ_LATIN_TO_CYRILLIC[c] ?? UZ_LATIN_TO_CYRILLIC[cLower] ?? c;
    i++;
  }
  return out;
}

function translateForDisplay(text: string, language: AgriGraffDisplayLanguage, placeKind?: EnglishPlaceKind) {
  const str = String(text ?? "").trim();
  if (!str) return str;
  const latin = uzCyrillicToLatin(str);
  if (language === "uz_lat") return latin;
  if (language === "uz_cyr") return uzLatinToCyrillic(str);
  if (language === "en") {
    return translateUzbekPlaceToEnglish(latin, placeKind);
  }
  const regionNames: Record<string, string> = {
    andijon: "Андижан", buxoro: "Бухара", fargona: "Фергана", jizzax: "Джизак",
    namangan: "Наманган", navoiy: "Навои", qashqadaryo: "Кашкадарья",
    qoraqalpogiston: "Каракалпакстан", samarqand: "Самарканд", sirdaryo: "Сырдарья",
    surxondaryo: "Сурхандарья", toshkent: "Ташкент", xorazm: "Хорезм",
    boyovut: "Баяут", "bo'evut": "Баяут", boevut: "Баяут"
  };
  const normalized = latin.toLowerCase().replace(/[ʻʼ`’]/g, "'").trim();
  const baseKey = normalized.replace(/\s+viloyat(?:i)?$/i, "").replace(/\s+tumani$/i, "");
  const cyr = regionNames[baseKey] || uzLatinToCyrillic(latin.replace(/\s+viloyat(?:i)?$/i, "").replace(/\s+tumani$/i, ""));
  if (/\s+viloyat(?:i)?$/i.test(latin)) return `${cyr}ская область`;
  if (/\s+tumani$/i.test(latin)) return `${cyr} район`;
  return cyr;
}

const getLocalizedVhCategoryLabel = (
  category: string,
  language: AgriGraffDisplayLanguage,
): string => {
  const base = category.trim();
  if (base === "1-Juda yaxshi") {
    if (language === "en") return "Excellent";
    if (language === "ru") return "Очень хороший";
    if (language === "uz_lat") return "Juda yaxshi";
    return "Жуда яхши";
  }
  if (base === "2-Yaxshi") {
    if (language === "en") return "Good";
    if (language === "ru") return "Хороший";
    if (language === "uz_lat") return "Yaxshi";
    return "Яхши";
  }
  if (base === "3-O'rta") {
    if (language === "en") return "Moderate";
    if (language === "ru") return "Средний";
    if (language === "uz_lat") return "O'rta";
    return "Ўрта";
  }
  if (base === "4-Past") {
    if (language === "en") return "Poor";
    if (language === "ru") return "Низкий";
    if (language === "uz_lat") return "Past";
    return "Паст";
  }
  return category;
};

interface AgriGraffWidgetState {
  records: RecordData[];
  loading: boolean;
  error: string | null;
  activeMapView?: JimuMapView;

  // View mode: 'table' or 'graph'
  viewMode: "table" | "graph";

  // 🔎 search UI state
  searchText?: string;
  searchLoading?: boolean;
  searchError?: string | null;
  searchResultCount?: number | null;
  isSearchActive?: boolean;  // Track if search suggestion was selected (applies WHERE filter)

  // Only configured fields from settings
  configuredFields: string[];
  externalFilters: ConfiguredFilters;
  localFilters: ConfiguredFilters;

  // ✅ Regional filters - include VH + category (uzspace bucket)
  regionalFilters: {
    viloyat: string;
    tuman: string;
    yil: string;
    uzspace: string; // category (turi)
    turlar?: string[];
    vh: string; // selected vh
  };

  /** Numeric region code resolved from AgriFilter WHERE clause (e.g. 1733 for Xorazm viloyati). */
  regionalRegionCode: number | null;
  /** Numeric district code resolved from AgriFilter WHERE clause when available. */
  regionalDistrictCode: number | null;

  /** When set: filter polygons by these uniqueids (from NDVI table ndvi_status), not by polygon layer vh attribute */
  vhUniqueids: string[] | null;

  filterOptions: {
    [key: string]: string[];
  };

  featureLayer?: __esri.FeatureLayer;
  featureLayers: __esri.FeatureLayer[];
  /** Spatial polygon layer(s) used only for map-click hitTest/highlight — Agri_table_data has no geometry. */
  spatialClickLayers: __esri.FeatureLayer[];
  loadingFilters: boolean;
  isDarkTheme: boolean;

  dataSource?: QueriableDataSource;

  mapConnectionAttempts: number;
  connectionStatus: "idle" | "connecting" | "connected" | "failed";

  initialDataLoaded: boolean;
  selecteduniqueid?: string;

  // Pagination (Agrobank ContoursTable style — 1-based page)
  currentPage: number;
  totalRecordCount: number;
  loadingMore: boolean;
  /** Server-side table sort (Maydon), Agrobank ContoursTable cycle. */
  tableSort: { column: "maydon"; order: "asc" | "desc" } | null;

  lastUpdateTimestamp: number;
  isProcessingExternalUpdate: boolean;

  // Graph view states (chart can show polygon data or regional timeseries when no polygon selected)
  vegetationData: ChartVegetationRow[];
  loadingVegetation: boolean;
  vegetationError: string | null;
  /** Remount SVG series to replay draw animation after data morph (Agrobank-style). */
  chartAnimKey: number;
  selectedIndices: VegetationIndiceType[];
  chartTooltip: {
    indexKey: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi";
    point: {
      date: Date;
      value: number;
      min?: number;
      max?: number;
      /** Must match xScale(date, sourceIndex) so crosshair aligns with rendered dots */
      sourceIndex?: number;
    };
  } | null;
  selectedNdviDate?: string | null;
  selectedChartIndexKey?: VegetationIndiceType | null;

  /** Dates available for the selected polygon, from api-agri's /available-dates. */
  polygonAvailableDates: string[];
  /** True while fetching/decoding the export-image raster for the selected polygon+date. */
  polygonImageLoading: boolean;
  polygonImageError: string | null;

  selectedMonth: number | null;
  isMonthPickerOpen: boolean;
  monthPickerPlacement: "up" | "down";
  dateRangeStartIndex: number | null;
  dateRangeEndIndex: number | null;
  graphViewportWidth: number;
  graphViewportHeight: number;
  language: "uz_cyr" | "uz_lat" | "ru" | "en";
}

export default class AgriGraffWidget extends React.PureComponent<
  AllWidgetProps<any>,
  AgriGraffWidgetState
> {
  private _barCategoryField = "";
  private _barCategoryValue = "";
  /** Logger disabled — keep call sites without console noise. */
  private static graffLog(
    _phase: string,
    _detail?: Record<string, unknown>,
  ): void {
    /* no-op */
  }

  private _prevDefinitionExpression = "";
  private _mapUpdateScheduled = false;
  private _onReset: () => void;
  private initializationTimer: any;
  private _retryTimeout: any;
  private _isMounted: boolean = false;
  /** MapView and fallback startup share one filter-options request batch. */
  private _filterOptionsPromise: Promise<void> | null = null;
  /** MediaLayer showing the export-image raster for the selected polygon+date; removed on deselect/change. */
  private _vegetationImageLayer: __esri.MediaLayer | null = null;
  /** Guards against a stale export-image response landing after a newer selection. */
  private _vegetationImageRequestId = 0;
  /** Export rasters confirmed missing by the API; prevents repeated 404 requests. */
  private _missingVegetationRasterKeys = new Set<string>();
  /** Pixel values + georef for the active vegetation overlay (map hover tooltip). */
  private _vegetationRasterSample: {
    values: Float32Array;
    width: number;
    height: number;
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference: __esri.SpatialReference;
  } | null = null;
  private _vegetationHoverHandle: __esri.Handle | null = null;
  private _vegetationHoverLeaveHandle: __esri.Handle | null = null;
  private _vegetationHoverTooltipEl: HTMLDivElement | null = null;
  /**
   * Guards against a stale fetchVegetationData() response (chart series +
   * available-dates) landing after the user has already switched to a
   * different polygon — this function has two awaited network calls and
   * nothing previously stopped an older, slower call's response from
   * overwriting a newer polygon's already-loaded chart, which then fed a
   * date click for the wrong polygon's raster_date list.
   */
  private _vegetationDataRequestId = 0;
  /**
   * Invalidates in-flight fetchRegionalTimeseries results. Without this, a
   * regional fetch started on filter change (or before a polygon click)
   * can finish AFTER fetchVegetationData and overwrite the polygon chart
   * with aggregate dates that are not in /available-dates — clicks then
   * hit SKIP-unavailable-date and show nothing on the field.
   */
  private _regionalTimeseriesRequestId = 0;
  /** Last regional query signature, used to collapse duplicate mount/filter broadcasts. */
  private _regionalTimeseriesRequestKey = "";
  /** Signature of the regional series currently shown in vegetationData. */
  private _regionalTimeseriesAppliedKey = "";
  /**
   * Index fields already loaded for `_regionalTimeseriesAppliedKey` (republic
   * incremental fetch). Cleared on scope change, polygon mode, or failed fetch.
   * Viloyat/tuman full queries mark every CORE field as loaded.
   */
  private _regionalTimeseriesLoadedAvgFields = new Set<string>();
  /** True after a graph fetch finishes (success/empty/error) — prevents no-data flash. */
  private _hasCompletedGraphFetch = false;
  /** True after a table fetch finishes (success/empty/error) — prevents no-data flash. */
  private _hasCompletedTableFetch = false;
  /** Invalidates in-flight table page fetches when leaving table view mid-load. */
  private _tableDataRequestId = 0;
  /**
   * Wall-clock time of the most recently APPLIED polygon selection, from
   * whichever source won the race — this widget's own handleMapClick, or an
   * external relay (AgriPopup, via AgriLocalization's masterFilterChanged).
   * Both sources hit-test the same map click independently and can resolve
   * out of order (AgriPopup's chain does extra attribute lookups and is
   * often slower); a later-arriving notification carrying an OLDER click
   * timestamp than what's already applied must be dropped, or it silently
   * reverts the selected polygon back to a stale one.
   */
  private _lastAppliedPolygonClickedAt = 0;
  /** Scroll/center this uniqueid in the jadval after the matching page loads. */
  private _pendingScrollUniqueid: string | null = null;
  private _selectionPageResolveToken = 0;
  /**
   * Drops late masterFilterChanged payloads whose meta.timestamp /
   * broadcastGeneration is older than what we already applied — prevents a
   * slow VH-bar broadcast for the previous viloyat/tuman from overwriting
   * the chart after the user already moved on.
   */
  private _lastMasterFilterTs = 0;
  private _lastMasterFilterBroadcastGeneration = 0;
  /** View extent before a table-row polygon is selected; restored on toggle-off. */
  private _extentBeforeTableSelection: __esri.Extent | null = null;
  /**
   * Where the current polygon selection came from.
   * Table selection can also be deactivated by clicking the same polygon on the map.
   */
  private _polygonSelectionOrigin: "table" | "map" | null = null;
  /** Wall time when selection was committed — ignores echo "same-id" deselects. */
  private _selectionCommittedAt = 0;
  /** Detached query layers prevent MapImage sublayer queries from clearing its live district filter. */
  private _detachedSpatialQueryLayers = new Map<string, __esri.FeatureLayer>();
  private tableContainerRef: React.RefObject<HTMLDivElement>;
  private graphContainerRef: React.RefObject<HTMLDivElement>;
  private graphSvgWrapRef: React.RefObject<HTMLDivElement>;
  private monthPickerRef: React.RefObject<HTMLDivElement>;
  private graphResizeObserver: ResizeObserver | null = null;
  private _graphViewportRaf: number | null = null;
  private _clickHandle: any = null;

  // Single coalesced refresh: push WHERE to DS/layer, then fetch
  private scheduleRefresh = debounce(async () => {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;
    // Show loader immediately so UI never flashes "no data" during map-filter await.
    if (!this.state.loading) {
      this.setState({ loading: true, error: null });
    }
    await this.applyMapFilters();
    await this.fetchData();
  }, 250);

  private _allowClearOnce = false;

  /** Viloyat name → region number (from layer attribute `region`). Used in WHERE and API as region/district. */
  private _viloyatToRegion: Record<string, number> = {};
  /** Region/viloyat + tuman → district number (from layer attribute `district`). */
  private _tumanToDistrict: Record<string, number> = {};
  /**
   * Crop type name (turi) → crop_id. agri_vegetation_indices doesn't carry
   * the human-readable `turi` name, only `crop_id`, so the regional
   * vegetation timeseries needs this resolved from Agri_table_data (which
   * has both) the same way viloyat/tuman get resolved to region/district.
   */
  private _turiToCropId: Record<string, string> = {};

  /** Viloyat normalized key → resolved feature layer index. */
  private _viloyatKeyToLayerIndex: Record<string, number> = {};

  // Debounce timer for external updates
  private _updateDebounceTimer: any = null;
  private _debounceTimer: any = null;
  private _searchDebounceTimer: any = null;
  private _activeController: AbortController | null = null;

  // Handle apostrophe variants for consistent text filtering
  private static readonly APOSTROPHE_VARIANTS = ["'", "'", "'", "ʻ", "ʼ", "`"];
  private normalizeApos(s: string): string {
    return (s ?? "").normalize("NFKC").replace(/['''ʻʼ`]/g, "'");
  }

  // Canonicalize keys used for viloyat/tuman → region/district dictionaries
  private makeRegionDistrictKey(raw: string | null | undefined): string {
    if (raw == null) return "";
    const s = this.normalizeApos(String(raw)).trim().toLowerCase();
    return s;
  }

  /**
   * Resolve a district inside its parent region. Tuman names are not
   * guaranteed to be unique across Uzbekistan, so a name-only dictionary
   * can silently select another viloyat's district.
   */
  private resolveDistrictNumber(
    viloyat: string,
    tuman: string,
    regionHint?: number,
  ): number | undefined {
    const effectiveTuman = this.normalizeApos(tuman);
    if (/^\d+$/.test(effectiveTuman)) return Number(effectiveTuman);

    const tumanKey = this.makeRegionDistrictKey(effectiveTuman);
    if (!tumanKey) return undefined;

    const effectiveViloyat = this.normalizeApos(viloyat);
    const viloyatKey = this.makeRegionDistrictKey(effectiveViloyat);
    const mappedRegion =
      regionHint !== undefined && Number.isFinite(regionHint)
        ? regionHint
        : /^\d+$/.test(effectiveViloyat)
          ? Number(effectiveViloyat)
          : viloyatKey
            ? this._viloyatToRegion[viloyatKey]
            : undefined;

    const lookupKeys: string[] = [];
    if (mappedRegion !== undefined && Number.isFinite(mappedRegion)) {
      lookupKeys.push(`region:${mappedRegion}|${tumanKey}`);
    }
    if (viloyatKey) lookupKeys.push(`viloyat:${viloyatKey}|${tumanKey}`);

    for (const key of lookupKeys) {
      const district = this._tumanToDistrict[key];
      if (district !== undefined && Number.isFinite(district)) return district;
    }
    return undefined;
  }

  private storeRegionDistrictMappingRow = (
    viloyatRaw: string | null | undefined,
    regionRaw: unknown,
    tumanRaw: string | null | undefined,
    districtRaw: unknown,
  ): void => {
    const viloyatKey = this.makeRegionDistrictKey(
      viloyatRaw != null && viloyatRaw !== "" ? String(viloyatRaw) : null,
    );
    const region =
      regionRaw != null && regionRaw !== "" ? Number(regionRaw) : NaN;
    const tumanKey = this.makeRegionDistrictKey(
      tumanRaw != null && tumanRaw !== "" ? String(tumanRaw) : null,
    );
    const district =
      districtRaw != null && districtRaw !== "" ? Number(districtRaw) : NaN;

    if (viloyatKey && Number.isFinite(region)) {
      this._viloyatToRegion[viloyatKey] = region;
    }
    if (tumanKey && Number.isFinite(district)) {
      if (Number.isFinite(region)) {
        this._tumanToDistrict[`region:${region}|${tumanKey}`] = district;
      }
      if (viloyatKey) {
        this._tumanToDistrict[`viloyat:${viloyatKey}|${tumanKey}`] = district;
      }
    }
  };

  /**
   * When the initial grouped scan missed a selection (new year, spelling
   * variant, etc.), look up the exact viloyat/tuman pair in Agri_table_data.
   */
  private ensureRegionDistrictForSelection = async (): Promise<void> => {
    const { viloyat, tuman } = this.state.regionalFilters;
    const effectiveViloyat = this.normalizeApos(viloyat);
    const effectiveTuman = this.normalizeApos(tuman);
    const vilKey = this.makeRegionDistrictKey(effectiveViloyat);
    const tumanKey = this.makeRegionDistrictKey(effectiveTuman);

    const storedRegionCode =
      this.state.regionalRegionCode != null &&
      Number.isFinite(this.state.regionalRegionCode)
        ? this.state.regionalRegionCode
        : undefined;
    const regionHint =
      storedRegionCode ??
      (vilKey ? this._viloyatToRegion[vilKey] : undefined);

    const districtResolved =
      !effectiveTuman ||
      (this.state.regionalDistrictCode != null &&
        Number.isFinite(this.state.regionalDistrictCode)) ||
      this.resolveDistrictNumber(effectiveViloyat, effectiveTuman, regionHint) !==
        undefined;
    const regionResolved =
      !effectiveViloyat ||
      storedRegionCode !== undefined ||
      (vilKey ? this._viloyatToRegion[vilKey] : undefined) !== undefined;

    if (districtResolved && regionResolved) return;

    const whereParts: string[] = [];
    if (effectiveViloyat) whereParts.push(this.eqAposSmart("viloyat", viloyat));
    if (effectiveTuman) whereParts.push(this.eqAposSmart("tuman", tuman));
    if (!whereParts.length) return;

    try {
      const { layer } = await getAgriTableDataLayer();
      const query = layer.createQuery();
      query.where = whereParts.join(" AND ");
      query.outFields = ["viloyat", "region", "tuman", "district"];
      query.returnGeometry = false;
      query.num = 25;

      const result = await layer.queryFeatures(query);
      for (const feature of result?.features ?? []) {
        const attrs = (feature as any)?.attributes || {};
        this.storeRegionDistrictMappingRow(
          attrs.viloyat,
          attrs.region,
          attrs.tuman,
          attrs.district,
        );
      }
      AgriGraffWidget.graffLog("regionDistrictMap:on-demand", {
        viloyat,
        tuman,
        matchCount: result?.features?.length ?? 0,
        resolvedRegionNum: vilKey ? this._viloyatToRegion[vilKey] : null,
        resolvedDistrictNum: effectiveTuman
          ? this.resolveDistrictNumber(
              effectiveViloyat,
              effectiveTuman,
              regionHint,
            )
          : null,
      });
    } catch (err: any) {
      AgriGraffWidget.graffLog("regionDistrictMap:on-demand-FAILED", {
        viloyat,
        tuman,
        error: String(err?.message || err),
      });
    }
  };

  private eqAposSmart(field: string, raw: string): string {
    if (!raw) return "";
    const s = this.normalizeApos(String(raw).trim());
    if (!/'/.test(s)) return `${field}='${this.escapeArcGIS(s)}'`;

    const base = s.replace(/'/g, "\uFFFF");
    const parts = AgriGraffWidget.APOSTROPHE_VARIANTS.map((ch) => {
      const candidate = base.split("\uFFFF").join(ch);
      return `${field}='${this.escapeArcGIS(candidate)}'`;
    });
    return `(${parts.join(" OR ")})`;
  }

  /**
   * Vegetation /available-dates and export-image speak plain "YYYY-MM-DD"
   * (calendar day in the pipeline). Always derive that via UTC so chart
   * clicks, ArcGIS date filtering, and the API stay on the same string —
   * local getFullYear/getMonth/getDate shifts the day in non-UTC browser
   * timezones and silently skipped rasters (SKIP-unavailable-date).
   */
  private formatLocalDateYmd = (dt: Date): string => {
    return formatArcgisDateToYmd(dt) || "";
  };

  /**
   * Map a raw ArcGIS date (or Date) onto an advertised available-dates YMD.
   * Tries UTC day first, then local day, then nearest advertised day within
   * 2 days — covers timezone skew between agri_vegetation_indices and
   * api-agri without inventing distant dates.
   */
  private resolveAgainstAvailableDates = (
    rawDate: any,
    availableDates: string[],
  ): string | null => {
    if (!availableDates.length) {
      return formatArcgisDateToYmd(rawDate);
    }
    const available = new Set(availableDates);
    const utc = formatArcgisDateToYmd(rawDate);
    if (utc && available.has(utc)) return utc;

    const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (!Number.isNaN(d.getTime())) {
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (available.has(local)) return local;
    }

    const targetMs = utc
      ? Date.parse(`${utc}T00:00:00Z`)
      : !Number.isNaN(d.getTime())
        ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
        : NaN;
    if (!Number.isFinite(targetMs)) return null;

    let best: string | null = null;
    let bestDist = Infinity;
    for (const candidate of availableDates) {
      const t = Date.parse(`${candidate}T00:00:00Z`);
      if (!Number.isFinite(t)) continue;
      const dist = Math.abs(t - targetMs);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    if (best != null && bestDist <= 2 * 24 * 60 * 60 * 1000) return best;
    return null;
  };

  MAX_CONNECTION_ATTEMPTS = 3;
  /** Same page size as Agrobank ContoursTable. */
  RECORDS_PER_PAGE = 50;

  private throttledFetchData: any;

  constructor(props: AllWidgetProps<any>) {
    super(props);

    let initialIsDarkTheme = true;
    try {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage?.getItem("agri_v11_app_theme")
          : null;
      const domTheme =
        typeof document !== "undefined"
          ? document.documentElement.getAttribute("data-theme")
          : null;
      if (saved !== null && saved !== undefined) {
        initialIsDarkTheme = saved === "dark";
      } else if (domTheme === "light" || domTheme === "dark") {
        initialIsDarkTheme = domTheme === "dark";
      }
    } catch {
      initialIsDarkTheme = true;
    }

    this.state = {
      records: [],
      loading: false,
      error: null,

      // Default to graph: regional/polygon vegetation chart on first load.
      // Table remains available via the view-mode toggle.
      viewMode: "graph",

      searchText: "",
      searchLoading: false,
      searchError: null,
      searchResultCount: null,
      isSearchActive: false,

      configuredFields: [],
      externalFilters: {},
      localFilters: {},

      // ✅ include vh here
      // Default to graph; when no polygon is selected the graph uses
      // regional/republic timeseries API data.
      regionalFilters: {
        viloyat: "",
        tuman: "",
        yil: "",
        uzspace: "",
        vh: "",
      },

      regionalRegionCode: null,
      regionalDistrictCode: null,

      vhUniqueids: null,

      filterOptions: {},

      featureLayers: [],
      spatialClickLayers: [],

      loadingFilters: false,
      isDarkTheme: initialIsDarkTheme,

      mapConnectionAttempts: 0,
      connectionStatus: "idle",

      initialDataLoaded: false,

      currentPage: 1,
      totalRecordCount: 0,
      loadingMore: false,
      tableSort: null,

      lastUpdateTimestamp: 0,
      isProcessingExternalUpdate: false,

      vegetationData: [],
      loadingVegetation: false,
      vegetationError: null,
      chartAnimKey: 0,
      selectedIndices: ["ndvi"],
      chartTooltip: null,
      selectedNdviDate: null,
      selectedChartIndexKey: null,

      polygonAvailableDates: [],
      polygonImageLoading: false,
      polygonImageError: null,

      selectedMonth: null,
      isMonthPickerOpen: false,
      monthPickerPlacement: "down",
      dateRangeStartIndex: null,
      dateRangeEndIndex: null,
      graphViewportWidth: 860,
      graphViewportHeight: 360,
      language: resolveInitialAgri3Language(),
    };

    this.tableContainerRef = React.createRef();
    this.graphContainerRef = React.createRef();
    this.graphSvgWrapRef = React.createRef();
    this.monthPickerRef = React.createRef();

    this.throttledFetchData = throttle(this.fetchData, 500, {
      leading: false,
      trailing: true,
    });

    this.handleFilterChange = this.handleFilterChange.bind(this);
    this.handleResetFilters = this.handleResetFilters.bind(this);
    this.fetchData = this.fetchData.bind(this);
    this.fetchFilterOptions = this.fetchFilterOptions.bind(this);
    this.onDataSourceCreated = this.onDataSourceCreated.bind(this);
    this.onDataSourceInfoChange = this.onDataSourceInfoChange.bind(this);
    this.retryMapConnection = this.retryMapConnection.bind(this);
    this.onActiveViewChange = this.onActiveViewChange.bind(this);
    this.initializeMapConnection = this.initializeMapConnection.bind(this);
    this.ensureInitialization = this.ensureInitialization.bind(this);
    this.handleThemeChange = this.handleThemeChange.bind(this);

    // Enhanced external filter handlers
    this.handleConstructionYearChange =
      this.handleConstructionYearChange.bind(this);
    this.handleLandCategoryChange = this.handleLandCategoryChange.bind(this);
    this.handleRegionalChange = this.handleRegionalChange.bind(this);
    this.handleGeneralFilterChange = this.handleGeneralFilterChange.bind(this);
    this.processExternalFilterUpdate =
      this.processExternalFilterUpdate.bind(this);
    this.applyExternalFilterUpdate = this.applyExternalFilterUpdate.bind(this);

    // Graph functions
    this.switchToGraph = this.switchToGraph.bind(this);
    this.switchToTable = this.switchToTable.bind(this);
    this.fetchVegetationData = this.fetchVegetationData.bind(this);
    this.toggleMonthPicker = this.toggleMonthPicker.bind(this);
    this.handleMonthOptionClick = this.handleMonthOptionClick.bind(this);
  }

  private updateGraphViewportSize = () => {
    const wrap = this.graphSvgWrapRef.current;
    if (!wrap) return;

    const rect = wrap.getBoundingClientRect();
    const nextWidth = Math.max(120, Math.floor(rect.width));
    const nextHeight = Math.max(120, Math.floor(rect.height));

    this.setState((prev) => {
      if (
        Math.abs(prev.graphViewportWidth - nextWidth) < 2 &&
        Math.abs(prev.graphViewportHeight - nextHeight) < 2
      ) {
        return null;
      }
      return {
        graphViewportWidth: nextWidth,
        graphViewportHeight: nextHeight,
      };
    });
  };

  private scheduleGraphViewportRefresh = () => {
    if (typeof window === "undefined") return;

    if (this._graphViewportRaf != null) {
      window.cancelAnimationFrame(this._graphViewportRaf);
      this._graphViewportRaf = null;
    }

    this._graphViewportRaf = window.requestAnimationFrame(() => {
      this._graphViewportRaf = window.requestAnimationFrame(() => {
        this._graphViewportRaf = null;
        this.updateGraphViewportSize();
      });
    });
  };

  private observeGraphViewport = () => {
    this.graphResizeObserver?.disconnect();
    this.graphResizeObserver = null;

    const wrap = this.graphSvgWrapRef.current;
    if (!wrap) return;
    const container = this.graphContainerRef.current;

    if (typeof ResizeObserver !== "undefined") {
      this.graphResizeObserver = new ResizeObserver(() => {
        this.scheduleGraphViewportRefresh();
      });
      this.graphResizeObserver.observe(wrap);
      if (container && container !== wrap) {
        this.graphResizeObserver.observe(container);
      }
    }

    this.scheduleGraphViewportRefresh();
  };

  private handleDocumentMouseDown = (event: MouseEvent) => {
    if (!this.state.isMonthPickerOpen) return;

    const pickerRoot = this.monthPickerRef.current;
    const targetNode = event.target as Node | null;

    if (!pickerRoot || !targetNode) return;
    if (pickerRoot.contains(targetNode)) return;

    this.setState({ isMonthPickerOpen: false });
  };

  // Keep braces/no-braces variants and normalize case safely
  private builduniqueidWhere = (raw: string, field: string = "uniqueid") => {
    const escapeArcGIS = (v: string) => v.replace(/'/g, "''");
    const term = (raw || "").trim();
    if (!term) return "1=0";

    const hasBraces = /^[{].*[}]$/.test(term);
    const core = term.replace(/[{}]/g, "");
    const withBraces = `{${core}}`;
    const noBraces = core;

    const variants = Array.from(new Set([term, withBraces, noBraces]));
    const pieces = variants.map(
      (v) => `UPPER(${field})=UPPER('${escapeArcGIS(v)}')`,
    );
    return `(${pieces.join(" OR ")})`;
  };

  private copyUniqueIdToClipboard = async (raw: string): Promise<boolean> => {
    const value = String(raw || "").trim();
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  /** Resolve actual cased field name on the layer or null if missing */
  private resolveFieldCaseInsensitive = (name: string): string | null => {
    const fl = this.state.featureLayer;
    if (!fl?.fields) return null;
    const lower = name.toLowerCase();
    const f = fl.fields.find((ff) => ff.name.toLowerCase() === lower);
    return f?.name ?? null;
  };

  /** Viloyat (yoki qulflash) tanlanguncha jadval/grafik faqat ko‘rinadi — bosishlar ishlamaydi. */
  private isRegionalInteractionEnabled = (): boolean =>
    !!String(this.state.regionalFilters?.viloyat || "").trim();

  /**
   * Enters/exits "single polygon" chart mode in response to a polygon
   * selection made outside this widget (currently: AgriPopup's map-click
   * inspector). Mirrors what handleRowClick already does for a polygon
   * picked from this widget's own table, minus the map highlight/zoom/
   * definitionExpression narrowing — the widget that owns the selection
   * (AgriPopup) already handles that on its own layer.
   */
  private syncExternalPolygonSelection = (
    uniqueid: string,
    polygonMode: boolean,
    regionIdHint?: number | null,
    clickedAt?: number,
  ): void => {
    const current = (this.state.selecteduniqueid || "").replace(/[{}]/g, "");
    const incoming = uniqueid.replace(/[{}]/g, "");

    // Drop a notification that's older than whatever selection (from this
    // widget's own map click or a previous external relay) has already been
    // applied — see _lastAppliedPolygonClickedAt for why this races.
    if (
      typeof clickedAt === "number" &&
      clickedAt < this._lastAppliedPolygonClickedAt
    ) {
      AgriGraffWidget.graffLog("syncExternalPolygonSelection:SKIP-stale", {
        uniqueid,
        polygonMode,
        clickedAt,
        lastApplied: this._lastAppliedPolygonClickedAt,
      });
      return;
    }
    if (typeof clickedAt === "number") {
      this._lastAppliedPolygonClickedAt = clickedAt;
    }

    if (polygonMode && incoming && incoming !== current) {
      this._polygonSelectionOrigin = "map";
      this._selectionCommittedAt = Date.now();
      this.cancelVegetationImageOverlay();
      // Session-scoped 404 cache is keyed by uniqueid|region|date|index —
      // clear when the polygon changes so a transient miss on one field
      // cannot permanently block the same date/index on the next field.
      this._missingVegetationRasterKeys.clear();
      // Clear any stale highlight graphic left over from a previous
      // this-widget-driven row selection — otherwise it stays stuck on the
      // old polygon when the selection instead changes via the map
      // (AgriPopup), since that path never touches our view.graphics.
      try {
        this.state.activeMapView?.view?.graphics?.removeAll?.();
      } catch {
        /* ignore */
      }
      const clearSearch =
        Boolean(this.state.isSearchActive) ||
        Boolean(String(this.state.searchText || "").trim());
      this.setState(
        {
          selecteduniqueid: uniqueid,
          // Show jadval so the selected row can be highlighted + scrolled into view.
          viewMode: "table",
          error: null,
          vegetationError: null,
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          polygonAvailableDates: [],
          polygonImageError: null,
          isMonthPickerOpen: false,
          loading: true,
          regionalRegionCode:
            regionIdHint != null && Number.isFinite(regionIdHint)
              ? regionIdHint
              : this.state.regionalRegionCode,
          ...(clearSearch
            ? {
                searchText: "",
                searchError: null,
                searchResultCount: null,
                isSearchActive: false,
              }
            : {}),
        },
        () => {
          this._pendingScrollUniqueid = uniqueid;
          this.fetchVegetationData();
          if (this.state.connectionStatus === "connected") {
            void this.fetchData();
          }
        },
      );
      return;
    }

    /*
     * Same polygon clicked on the map while selected → deactivate
     * (same as clicking the row again). Require a real later map clickAt so
     * table-selection echoes do not immediately clear the row.
     */
    if (
      polygonMode &&
      incoming &&
      incoming === current &&
      typeof clickedAt === "number" &&
      clickedAt > this._selectionCommittedAt
    ) {
      this.clearPolygonSelectionFromMapClick();
      return;
    }

    if (!polygonMode && !incoming && current) {
      this._polygonSelectionOrigin = null;
      this._selectionCommittedAt = 0;
      this.cancelVegetationImageOverlay();
      this.clearMapSelectionGraphics(this.state.activeMapView?.view);
      const restoreExtent = this._extentBeforeTableSelection;
      this._extentBeforeTableSelection = null;
      const view = this.state.activeMapView?.view;
      if (restoreExtent && view) {
        try {
          void view.goTo(restoreExtent, {
            duration: 700,
            easing: "ease-in-out" as any,
          });
        } catch {
          /* ignore */
        }
      }
      this.setState(
        {
          selecteduniqueid: "",
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          polygonAvailableDates: [],
          polygonImageError: null,
          vegetationError: null,
          searchText: "",
          searchError: null,
          searchResultCount: null,
          isSearchActive: false,
        },
        () => {
          try {
            const baseWhere = this.buildWhereClause();
            const featureLayer = this.state.featureLayer;
            if (featureLayer && !isMapImageOwnedLayer(featureLayer)) {
              (featureLayer as any).definitionExpression = baseWhere || "1=0";
            }
            (this.state.dataSource as any)?.setDefinitionExpression?.(
              baseWhere || "1=0",
            );
          } catch {
            /* ignore */
          }
          if (this.state.viewMode === "graph") {
            this.fetchRegionalTimeseries();
          }
          if (this.state.connectionStatus === "connected") {
            void this.fetchData();
          }
        },
      );
    }
  };

  /** Clear selection when the user clicks the same active polygon on the map. */
  private clearPolygonSelectionFromMapClick = (): void => {
    this._polygonSelectionOrigin = null;
    this._selectionCommittedAt = 0;
    this._pendingScrollUniqueid = null;
    this._selectionPageResolveToken += 1;
    this.cancelVegetationImageOverlay();
    this.clearMapSelectionGraphics(this.state.activeMapView?.view);
    const restoreExtent = this._extentBeforeTableSelection;
    this._extentBeforeTableSelection = null;
    const view = this.state.activeMapView?.view;
    if (restoreExtent && view) {
      try {
        void view.goTo(restoreExtent, {
          duration: 700,
          easing: "ease-in-out" as any,
        });
      } catch {
        /* ignore */
      }
    }
    const featureLayer = this.state.featureLayer;
    this.setState(
      {
        selecteduniqueid: "",
        selectedNdviDate: null,
        selectedChartIndexKey: null,
        polygonAvailableDates: [],
        polygonImageError: null,
        vegetationError: null,
      },
      () => {
        try {
          const baseWhere = this.buildWhereClause();
          if (featureLayer && !isMapImageOwnedLayer(featureLayer)) {
            (featureLayer as any).definitionExpression = baseWhere || "1=0";
          }
          (this.state.dataSource as any)?.setDefinitionExpression?.(
            baseWhere || "1=0",
          );
        } catch {
          /* ignore */
        }
        try {
          document.dispatchEvent(
            new CustomEvent("widgetSelectionChanged", {
              detail: {
                source: "AgriGraffWidget",
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
        if (this.state.viewMode === "graph") {
          this.fetchRegionalTimeseries();
        }
        if (this.state.connectionStatus === "connected") {
          void this.fetchData();
        }
      },
    );
  };

  /**
   * ✅ MAIN INPUT: Master filter state from AgriFilter
   * - reacts to yil + viloyat + tuman + turi + vh
   */
  private handleMasterFilterChanged = (event: Event) => {
    if (!this._isMounted) return;

    const d: any = (event as CustomEvent).detail || {};
    if (!d?.filters) return;

    if (d.source === "AgriGraffWidget") return;

    const eventTs =
      typeof d?.meta?.timestamp === "number" && Number.isFinite(d.meta.timestamp)
        ? d.meta.timestamp
        : 0;
    const eventGen =
      typeof d?.meta?.broadcastGeneration === "number" &&
      Number.isFinite(d.meta.broadcastGeneration)
        ? d.meta.broadcastGeneration
        : 0;
    if (
      eventGen > 0 &&
      this._lastMasterFilterBroadcastGeneration > 0 &&
      eventGen < this._lastMasterFilterBroadcastGeneration
    ) {
      AgriGraffWidget.graffLog("handleMasterFilterChanged:SKIP-stale-generation", {
        eventGen,
        lastGen: this._lastMasterFilterBroadcastGeneration,
        viloyat: d.filters?.viloyat,
        tuman: d.filters?.tuman,
      });
      return;
    }
    if (
      eventTs > 0 &&
      this._lastMasterFilterTs > 0 &&
      eventTs < this._lastMasterFilterTs
    ) {
      AgriGraffWidget.graffLog("handleMasterFilterChanged:SKIP-stale-timestamp", {
        eventTs,
        lastTs: this._lastMasterFilterTs,
        viloyat: d.filters?.viloyat,
        tuman: d.filters?.tuman,
      });
      return;
    }
    if (eventGen > 0) this._lastMasterFilterBroadcastGeneration = eventGen;
    if (eventTs > 0) this._lastMasterFilterTs = eventTs;

    const f = d.filters || {};
    this._barCategoryField = String(f.barCategoryField || "").trim();
    this._barCategoryValue = String(f.barCategoryValue || "").trim();

    const nextLanguage: "uz_cyr" | "uz_lat" | "ru" | "en" =
      (f.language as any) || this.state.language || "ru";

    // AgriFilter may provide the active "locked viloyat" via scope.
    // In that case, f.viloyat can be empty, so we still need to route queries to the locked layer.
    const lockedViloyat = d?.scope?.lockedViloyat
      ? this.normalizeApos(String(d.scope.lockedViloyat))
      : "";

    // Try to capture numeric region code from AgriFilter WHERE clause, if available
    let regionalRegionCode: number | null =
      this.state.regionalRegionCode ?? null;
    let regionCodeCameFromEvent = false;
    let regionalDistrictCode: number | null = null;
    let districtCodeCameFromEvent = false;
    const whereClause: string | undefined = d?.meta?.whereClause;
    if (typeof whereClause === "string") {
      const match = whereClause.match(/region\s*=\s*'?(\d+)'?/i);
      if (match && match[1]) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed)) {
          regionalRegionCode = parsed;
          regionCodeCameFromEvent = true;
        }
      }
      const districtMatch = whereClause.match(/district\s*=\s*'?(\d+)'?/i);
      if (districtMatch && districtMatch[1]) {
        const parsed = Number(districtMatch[1]);
        if (Number.isFinite(parsed)) {
          regionalDistrictCode = parsed;
          districtCodeCameFromEvent = true;
        }
      }
    }

    // A polygon was selected/deselected elsewhere (e.g. AgriPopup's map
    // click inspector) — sync our own chart to it. Only when geography is
    // unchanged: a Back/region change must exit single-field mode even if a
    // stale broadcast still carries uniqueid/polygonMode.
    const effectiveViloyatEarly =
      lockedViloyat || (f.viloyat ? this.normalizeApos(String(f.viloyat)) : "");
    const effectiveTumanForSync = f.tuman
      ? this.normalizeApos(String(f.tuman))
      : "";
    const geographyChangingForSync =
      effectiveViloyatEarly !== this.state.regionalFilters.viloyat ||
      effectiveTumanForSync !== this.state.regionalFilters.tuman ||
      String(f.yil || "") !== this.state.regionalFilters.yil;

    if (geographyChangingForSync) {
      this.syncExternalPolygonSelection("", false, regionalRegionCode);
    } else {
      this.syncExternalPolygonSelection(
        f.uniqueid ? String(f.uniqueid).trim() : "",
        Boolean(f.polygonMode),
        regionalRegionCode,
        typeof f.uniqueidClickedAt === "number" ? f.uniqueidClickedAt : undefined,
      );
    }

    const effectiveViloyat = effectiveViloyatEarly;

    // Never retain a code belonging to the previous viloyat. If this event
    // does not carry a fresh numeric code, the name→region mapping below is
    // safer than reusing stale state.
    const viloyatChanged =
      effectiveViloyat !== this.state.regionalFilters.viloyat;
    if (!effectiveViloyat || (viloyatChanged && !regionCodeCameFromEvent)) {
      regionalRegionCode = null;
    }

    const effectiveTumanEarly = f.tuman ? this.normalizeApos(String(f.tuman)) : "";
    const tumanChanged =
      effectiveTumanEarly !== this.state.regionalFilters.tuman;
    if (!effectiveTumanEarly || (tumanChanged && !districtCodeCameFromEvent)) {
      regionalDistrictCode = null;
    }

    if (
      regionalDistrictCode != null &&
      Number.isFinite(regionalDistrictCode) &&
      effectiveTumanEarly &&
      effectiveViloyat
    ) {
      this.storeRegionDistrictMappingRow(
        effectiveViloyat,
        regionalRegionCode,
        effectiveTumanEarly,
        regionalDistrictCode,
      );
    }

    const next: {
      viloyat: string;
      tuman: string;
      yil: string;
      uzspace: string;
      turlar: string[];
      vh: string;
    } = {
      viloyat: effectiveViloyat,
      tuman: f.tuman ? this.normalizeApos(String(f.tuman)) : "",
      yil: f.yil ? String(f.yil) : "",
      uzspace:
        Array.isArray(f.turlar) && f.turlar.length === 1
          ? this.normalizeApos(String(f.turlar[0]))
          : f.turi
            ? this.normalizeApos(String(f.turi))
            : "",
      turlar: Array.isArray(f.turlar)
        ? Array.from(
            new Set(
              (f.turlar as unknown[])
                .map((value: unknown) =>
                  this.normalizeApos(String(value || "")),
                )
                .filter(Boolean),
            ),
          )
        : f.turi
          ? [this.normalizeApos(String(f.turi))]
          : [],
      vh: f.vh ? this.normalizeApos(String(f.vh)) : "", // ✅ vh
    };

    // We now filter directly on layer fields (including per-date status fields)
    // instead of receiving giant uniqueid IN (...) lists from AgriFilter.
    const vhUniqueids: string[] | null = Array.isArray(d.vhUniqueids)
      ? Array.from(
          new Set(
            (d.vhUniqueids as unknown[])
              .map((id) => String(id || "").trim())
              .filter(Boolean),
          ),
        )
      : null;

    // ✅ Defensive: if parent changed and vh not included properly, clear it
    const parentChanged =
      next.yil !== this.state.regionalFilters.yil ||
      next.viloyat !== this.state.regionalFilters.viloyat ||
      next.tuman !== this.state.regionalFilters.tuman ||
      next.uzspace !== this.state.regionalFilters.uzspace ||
      JSON.stringify(next.turlar || []) !==
        JSON.stringify(this.state.regionalFilters.turlar || []);

    if (parentChanged && next.vh && next.vh === this.state.regionalFilters.vh) {
      // keep
    } else if (parentChanged && !f.vh) {
      next.vh = "";
    }

    const ndviDate = f.ndviDate ? String(f.ndviDate) : "";
    const geographyUnchanged = !this.filtersChanged(
      this.state.regionalFilters,
      next,
    );
    // Keys are present on EVERY masterFilterChanged broadcast — check values.
    const polygonOnlyEvent =
      f.polygonMode === true ||
      (typeof f.uniqueid === "string" && String(f.uniqueid).trim() !== "") ||
      f.polygonMode === false;

    // Polygon pick/clear does not change geography. syncExternal already
    // cleared selectedNdviDate, so comparing against the hub's effective
    // ndviDate would falsely fall through into scheduleRefresh /
    // applyMapFilters — rewriting MapImage definitionExpression and racing
    // the popup click path.
    if (geographyUnchanged && polygonOnlyEvent) {
      if (nextLanguage !== this.state.language) {
        this.setState({ language: nextLanguage });
      }
      return;
    }

    if (geographyUnchanged && ndviDate === (this.state.selectedNdviDate || "")) {
      // Language-only change: update UI state, but don't refetch data.
      if (nextLanguage !== this.state.language) {
        this.setState({ language: nextLanguage });
      }
      return;
    }

    

    const targetLayer = effectiveViloyat
      ? this.getFeatureLayerForViloyat(effectiveViloyat) ||
        this.state.featureLayer
      : this.state.featureLayer;

    // If parent geography/time changed, polygon selection becomes stale.
    // Also release the field when a VH status is active and the polygon is
    // not in that status's uniqueid list — then show regional VH chart.
    const selectedId = String(this.state.selecteduniqueid || "").trim();
    const selectedClean = selectedId.replace(/[{}]/g, "").toLowerCase();
    const vhActive = !!String(next.vh || "").trim();
    const polygonNotInVhStatus =
      !!selectedClean &&
      vhActive &&
      Array.isArray(vhUniqueids) &&
      !vhUniqueids.some(
        (id) =>
          String(id || "")
            .replace(/[{}]/g, "")
            .toLowerCase() === selectedClean,
      );
    const shouldClearPolygonSelection =
      !!selectedId &&
      (next.viloyat !== this.state.regionalFilters.viloyat ||
        next.tuman !== this.state.regionalFilters.tuman ||
        next.yil !== this.state.regionalFilters.yil ||
        polygonNotInVhStatus);

    // Search filter is scoped to the previous geography — clear on yil/viloyat/tuman.
    const shouldClearSearch =
      next.viloyat !== this.state.regionalFilters.viloyat ||
      next.tuman !== this.state.regionalFilters.tuman ||
      next.yil !== this.state.regionalFilters.yil;

    if (shouldClearPolygonSelection || shouldClearSearch) {
      // Prevent restoring a pre-selection extent from a previous geography.
      this._extentBeforeTableSelection = null;
    }

    const vhChanged = next.vh !== this.state.regionalFilters.vh;
    const willHavePolygon =
      !!selectedId && !shouldClearPolygonSelection;
    const shouldRefreshGraph =
      this.state.viewMode === "graph" &&
      (shouldClearPolygonSelection || !willHavePolygon || vhChanged);

    this.setState(
      {
        regionalFilters: next,
        featureLayer: targetLayer,
        regionalRegionCode,
        regionalDistrictCode,
        vhUniqueids,
        selectedNdviDate: ndviDate || null,
        selectedChartIndexKey: null,
        selectedMonth: parentChanged ? null : this.state.selectedMonth,
        isMonthPickerOpen: false,
        chartTooltip: parentChanged ? null : this.state.chartTooltip,
        selecteduniqueid: shouldClearPolygonSelection
          ? ""
          : this.state.selecteduniqueid,
        // Keep previous graph series while the next filter result loads (Agrobank morph).
        vegetationData: this.state.vegetationData,
        vegetationError: null,
        loadingVegetation: shouldRefreshGraph
          ? true
          : this.state.loadingVegetation,
        searchText: shouldClearSearch ? "" : this.state.searchText,
        searchError: shouldClearSearch ? null : this.state.searchError,
        searchResultCount: shouldClearSearch
          ? null
          : this.state.searchResultCount,
        isSearchActive: shouldClearSearch ? false : this.state.isSearchActive,
        records: [],
        currentPage: 1,
        loading: true,
        language: nextLanguage,
      },
        () => {
          if (shouldClearPolygonSelection) {
            this.cancelVegetationImageOverlay();
            this.clearMapSelectionGraphics(this.state.activeMapView?.view);
            try {
              document.dispatchEvent(
                new CustomEvent("widgetSelectionChanged", {
                  detail: {
                    source: "AgriGraffWidget",
                    polygonMode: false,
                    uniqueid: "",
                    timestamp: Date.now(),
                  },
                  bubbles: true,
                }),
              );
            } catch {}
          }
          this.scheduleRefresh();
          if (this.state.viewMode === "graph" && !this.state.selecteduniqueid) {
            this.fetchRegionalTimeseries();
          } else if (
            this.state.viewMode === "graph" &&
            this.state.selecteduniqueid &&
            vhChanged
          ) {
            // Polygon still in VH status — keep field chart, but refresh series.
            this.fetchVegetationData();
          }
        },
    );
  };

  /** Read setting: 'uniqueid' | 'gidv' (defaults to 'uniqueid') */
  private getSearchField = (): "uniqueid" | "gidv" => {
    const cfg: any = this.props?.config;
    const val = cfg?.get ? cfg.get("searchField") : cfg?.searchField;
    return val === "gidv" ? "gidv" : "uniqueid";
  };

  /** Build WHERE for GIDV smart search (accepts plain GUID, {GUID}, or the SU{GUID} style) */
  private buildGidvWhere = (raw: string, field: string = "gidv") => {
    const escapeArcGIS = (v: string) => v.replace(/'/g, "''");
    const term = (raw || "").trim();
    if (!term) return "1=0";

    const core = term.replace(/[{}]/g, "");
    const GUID =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const pieces = new Set<string>();

    pieces.add(`UPPER(${field})=UPPER('${escapeArcGIS(term)}')`);
    if (core.length >= 8)
      pieces.add(`UPPER(${field}) LIKE UPPER('%${escapeArcGIS(core)}%')`);

    if (GUID.test(core)) {
      pieces.add(`UPPER(${field})=UPPER('{${escapeArcGIS(core)}}')`);
      ["SU", "NV", "FR", "BH", "GZ", "TV", "HR"].forEach((p) =>
        pieces.add(`UPPER(${field})=UPPER('${p}{${escapeArcGIS(core)}}')`),
      );
    }

    const m = term.match(/^[A-Za-z]{2}\{(.+)\}$/);
    if (m && m[1]) {
      pieces.add(`UPPER(${field})=UPPER('{${escapeArcGIS(m[1])}}')`);
    }

    return `(${Array.from(pieces).join(" OR ")})`;
  };

  /** Build WHERE for search text: INN (STIR) like OR farmer name like */
  private buildSearchWhere = (raw: string): string => {
    const term = (raw || "").trim();
    if (!term) return "1=0";

    const escapeArcGIS = (v: string) => v.replace(/'/g, "''");
    const farmerField = this.resolveFieldCaseInsensitive("f_name") || "f_name";
    const innField = this.resolveFieldCaseInsensitive("f_inn") || "f_inn";
    const escaped = escapeArcGIS(term);

    const farmerLikeClause = `UPPER(${farmerField}) LIKE UPPER('%${escaped}%')`;
    const innLikeClause = `UPPER(${innField}) LIKE UPPER('%${escaped}%')`;

    return `(${innLikeClause} OR ${farmerLikeClause})`;
  };

  /** Agri_table_data has no geometry — look up the matching spatial feature (for highlight/zoom) by uniqueid. */
  private findSpatialFeatureByUniqueId = async (
    uniqueId: string,
  ): Promise<__esri.Graphic | null> => {
    const id = String(uniqueId || "").trim();
    if (!id) return null;
    const variants = [id, id.replace(/[{}]/g, ""), `{${id.replace(/[{}]/g, "")}}`];
    for (const spatialLayer of this.state.spatialClickLayers || []) {
      // Query a detached client, never the live MapImage sublayer — a live
      // query rehydrates it and can clear the district definitionExpression,
      // flashing other districts' fields on the map.
      const url = String((spatialLayer as any)?.url || "").trim();
      let queryLayer: __esri.FeatureLayer = spatialLayer;
      if (url) {
        let detached = this._detachedSpatialQueryLayers.get(url);
        if (!detached) {
          try {
            detached = await getDetachedQueryLayerFor(spatialLayer);
            if (detached) this._detachedSpatialQueryLayers.set(url, detached);
          } catch {
            detached = null as any;
          }
        }
        if (detached) queryLayer = detached;
      }
      const q = queryLayer.createQuery();
      q.outFields = ["*"];
      q.returnGeometry = true;
      for (const v of variants) {
        q.where = `uniqueid='${this.escapeArcGIS(v)}'`;
        try {
          const res = await queryLayer.queryFeatures(q);
          if (res?.features?.length) return res.features[0];
        } catch {}
      }
    }
    return null;
  };

  /**
   * Builder data-source resolution may expose only a subset of regional map
   * services. Include queryable sublayers from the live map itself so a row
   * selected for any viloyat (and optionally tuman) can always resolve its
   * polygon geometry. Currently-visible/year-matching layers are tried first.
   */
  private isAgriSpatialLayerUrl = (url: string): boolean => {
    if (!url) return false;
    const lower = url.toLowerCase();
    // Accept only internal agri services; exclude World Imagery / basemap layers
    const knownExternal = [
      "arcgisonline.com",
      "basemaps.arcgis.com",
      "tiles.arcgis.com",
    ];
    if (knownExternal.some((h) => lower.includes(h))) return false;
    // Must contain "agri" in the path (agri_sirdarya, Agri_table_data, etc.)
    return lower.includes("agri");
  };

  private getTableSpatialQueryCandidates = (): __esri.FeatureLayer[] => {
    const candidates: __esri.FeatureLayer[] = [];
    const seen = new Set<string>();
    const add = (layer: any) => {
      if (!layer || typeof layer.createQuery !== "function" || typeof layer.queryFeatures !== "function") return;
      const rawUrl = String(layer.url || "").trim();
      const key = (rawUrl || String(layer.id || "")).toLowerCase();
      if (!key || seen.has(key)) return;
      // Skip basemap / World Imagery and any non-agri external services
      if (rawUrl && !this.isAgriSpatialLayerUrl(rawUrl)) return;
      const fields = (layer.fields || []).map((field: any) => String(field?.name || "").toLowerCase());
      if (fields.length && !fields.includes("uniqueid")) return;
      seen.add(key);
      candidates.push(layer as __esri.FeatureLayer);
    };

    (this.state.spatialClickLayers || []).forEach(add);
    const map: any = this.state.activeMapView?.view?.map;
    // allLayers is essential here: map.layers only contains top-level
    // GroupLayers in this portal, while the regional MapImageLayers live
    // below database-YYYY groups.
    const roots: any[] = map?.allLayers?.toArray?.() || map?.layers?.toArray?.() || [];
    const visitedNodes = new Set<any>();
    const visit = (node: any) => {
      if (!node || visitedNodes.has(node)) return;
      visitedNodes.add(node);
      const sublayers: any[] = node?.allSublayers?.toArray?.() || node?.sublayers?.toArray?.() || [];
      sublayers.forEach(visit);
      const children: any[] = node?.layers?.toArray?.() || [];
      children.forEach(visit);
      add(getQueryableLayer(node));
      add(node);
    };
    roots.forEach(visit);

    const selectedYear = String(this.state.regionalFilters?.yil || "").trim().toLowerCase();
    return candidates.sort((a: any, b: any) => {
      const score = (layer: any) => {
        const parent = getMapImageParentLayer(layer) as any;
        const title = `${parent?.title || ""} ${layer?.title || ""}`.toLowerCase();
        let value = parent?.visible !== false && layer?.visible !== false ? 100 : 0;
        if (selectedYear && title.includes(selectedYear)) value += 20;
        return value;
      };
      return score(b) - score(a);
    });
  };

  private runAutoSearch = async (termRaw: string) => {
    if (!this._isMounted) return;
    const { featureLayer, activeMapView } = this.state;

    const term = (termRaw || "").trim();

    
    if (!term) {
      this.setState({ searchLoading: false, searchError: null, searchResultCount: null });
      return;
    }

    if (!featureLayer || !activeMapView) {
      this.setState({ searchError: "Харита ёки қатлам ҳали уланмаган." });
      return;
    }

    try {
      this.setState({ searchLoading: true, searchError: null, searchResultCount: null });

      const q = featureLayer.createQuery();
      q.outFields = ["*"];
      q.returnGeometry = true;
      
      // ✅ Combine search WHERE with regional filters (viloyat/tuman/yil/uzspace)
      const searchWhere = this.buildSearchWhere(term);
      const { viloyat, tuman, yil, uzspace } = this.state.regionalFilters;
      const clauses: string[] = [searchWhere];
      
      const layerFields =
        featureLayer?.fields?.map((f) => f.name.toLowerCase()) ?? [];
      const hasRegion = layerFields.includes("region");
      const hasDistrict = layerFields.includes("district");
      const regionField = featureLayer?.fields?.find(
        (ff) => ff?.name?.toLowerCase() === "region",
      );
      const districtField = featureLayer?.fields?.find(
        (ff) => ff?.name?.toLowerCase() === "district",
      );
      const isRegionString = (regionField?.type || "")
        .toLowerCase()
        .includes("string");
      const isDistrictString = (districtField?.type || "")
        .toLowerCase()
        .includes("string");
      
      // Add viloyat regional filter
      if (viloyat) {
        const effectiveViloyat = this.normalizeApos(viloyat);
        const vilKey = this.makeRegionDistrictKey(effectiveViloyat);
        if (hasRegion && /^\d+$/.test(effectiveViloyat)) {
          clauses.push(
            isRegionString
              ? `region = '${this.escapeArcGIS(effectiveViloyat)}'`
              : `region = ${Number(effectiveViloyat)}`,
          );
        } else if (hasRegion && vilKey && this._viloyatToRegion[vilKey] !== undefined) {
          const regionNum = this._viloyatToRegion[vilKey];
          clauses.push(
            isRegionString
              ? `region = '${this.escapeArcGIS(String(regionNum))}'`
              : `region = ${regionNum}`,
          );
        } else {
          clauses.push(this.eqAposSmart("viloyat", viloyat));
        }
      }
      
      // Add tuman district filter
      if (tuman) {
        const effectiveTuman = this.normalizeApos(tuman);
        const districtNum = this.resolveDistrictNumber(viloyat, effectiveTuman);
        if (hasDistrict && /^\d+$/.test(effectiveTuman)) {
          clauses.push(
            isDistrictString
              ? `district = '${this.escapeArcGIS(effectiveTuman)}'`
              : `district = ${Number(effectiveTuman)}`,
          );
        } else if (hasDistrict && districtNum !== undefined) {
          clauses.push(
            isDistrictString
              ? `district = '${this.escapeArcGIS(String(districtNum))}'`
              : `district = ${districtNum}`,
          );
        } else {
          clauses.push(this.eqAposSmart("tuman", tuman));
        }
      }
      
      // Add year filter
      if (yil) {
        const four = String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0];
        clauses.push(
          four
            ? `yil LIKE '${four}%'`
            : `yil LIKE '%${this.escapeArcGIS(String(yil))}%'`,
        );
      }
      
      // Add category filter
      if (uzspace) {
        const catField = this.getCategoryFieldName();
        if (catField) clauses.push(this.eqAposSmart(catField, uzspace));
      }
      
      q.where = clauses.join(" AND ");

      const fs = await featureLayer.queryFeatures(q);
      const found = fs?.features?.length ?? 0;
      this.setState({ searchResultCount: found });

      if (!found) {
        this.setState({ searchError: "Излаш бўйича объект топилмади." });
        return;
      }

      const feat = fs.features[0];
      const gid = (feat.attributes?.uniqueid || "").toString();

      // Agri_table_data itself has no geometry — resolve the matching
      // spatial polygon feature (by uniqueid) for highlight/zoom.
      const spatialFeat = gid
        ? await this.findSpatialFeatureByUniqueId(gid)
        : null;

      if (spatialFeat?.geometry) {
        try {
          this.clearMapSelectionGraphics(activeMapView.view);
          this.addSelectionGlow(activeMapView.view, spatialFeat);
        } catch {}

        try {
          await activeMapView.view.goTo(
            spatialFeat.geometry?.extent?.expand(1.35) || spatialFeat.geometry,
            { duration: 700, easing: "ease-in-out" as any },
          );
        } catch {}
      }

      if (gid) {
        this.cancelVegetationImageOverlay();

        this.setState({
          selecteduniqueid: gid,
          searchText: term,
          isSearchActive: true,  // Enable search WHERE filter
          records: [],
          currentPage: 1,
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          polygonAvailableDates: [],
          polygonImageError: null,
        }, () => {
          // Fetch table data filtered by search term
          this.fetchData();
        });
      }
    } catch (err: any) {
      this.setState({ searchError: err?.message || "Излаш амалга ошмади." });
    } finally {
      this.setState({ searchLoading: false });
    }
  };

  private clearSelectionAfterSearchClear = async () => {
    const { featureLayer, activeMapView, selecteduniqueid } = this.state;
    if (!selecteduniqueid) return;

    this.clearMapSelectionGraphics(activeMapView?.view);
    this.cancelVegetationImageOverlay();

    const restoreExtent = this._extentBeforeTableSelection;
    this._extentBeforeTableSelection = null;
    if (restoreExtent && activeMapView?.view) {
      try {
        await activeMapView.view.goTo(restoreExtent, {
          duration: 700,
          easing: "ease-in-out" as any,
        });
      } catch {
        /* navigation interruption is harmless */
      }
    }

    this.setState(
      {
        selecteduniqueid: "",
        selectedNdviDate: null,
        selectedChartIndexKey: null,
        polygonAvailableDates: [],
        polygonImageError: null,
        vegetationError: null,
      },
      () => {
        try {
          const baseWhere = this.buildWhereClause();
          if (featureLayer && !isMapImageOwnedLayer(featureLayer)) {
            (featureLayer as any).definitionExpression = baseWhere || "1=0";
          }
          (this.state.dataSource as any)?.setDefinitionExpression?.(
            baseWhere || "1=0",
          );
        } catch {}
        try {
          document.dispatchEvent(
            new CustomEvent("widgetSelectionChanged", {
              detail: {
                source: "AgriGraffWidget",
                polygonMode: false,
                timestamp: Date.now(),
              },
              bubbles: true,
            }),
          );
        } catch {}
        if (this.state.viewMode === "graph") {
          this.fetchRegionalTimeseries();
        }
      },
    );
  };

  private handleExternalTableSearchChanged = (event: Event) => {
    if (!this._isMounted) return;

    const detail: any = (event as CustomEvent).detail || {};
    const nextQuery = String(detail?.query ?? "").trim();
    const preserveSelection = Boolean(detail?.preserveSelection);

    if (!nextQuery) {
      this.setState(
        {
          searchText: "",
          searchError: null,
          searchResultCount: null,
          isSearchActive: false,
        },
        () => {
          if (!preserveSelection) {
            void this.clearSelectionAfterSearchClear();
          }
          if (this.state.connectionStatus === "connected") {
            void this.fetchData();
          }
        },
      );
      return;
    }

    this.setState(
      {
        searchText: nextQuery,
        searchError: null,
        isSearchActive: true,
      },
      () => {
        if (this.state.connectionStatus === "connected") {
          void this.fetchData();
        }
      },
    );
  };

  private handleExternalTableRowSelected = async (event: Event) => {
    if (!this._isMounted) return;

    const detail: any = (event as CustomEvent).detail || {};
    if (detail?.source === "AgriGraffWidget") return;

    const record = detail?.record as RecordData | undefined;
    if (!record || !record.uniqueid) return;

    const selectedId = String(record.uniqueid).replace(/[{}]/g, "");

    // If the record is already in the table, just trigger handleRowClick
    const exists = this.state.records.some((row) => {
      return String(row.uniqueid || "").replace(/[{}]/g, "") === selectedId;
    });

    if (exists) {
      await this.handleRowClick(record);
      return;
    }

    // Prepend record so handleRowClick can find it, then select it
    await new Promise<void>((resolve) =>
      this.setState(
        (prev) => {
          const alreadyIn = prev.records.some(
            (r) => String(r.uniqueid || "").replace(/[{}]/g, "") === selectedId,
          );
          if (alreadyIn) return null;
          return { records: [record, ...prev.records] };
        },
        resolve,
      ),
    );

    await this.handleRowClick(record);
  };

  /**
   * ✅ WHERE builder: viloyat/tuman become region/district (numeric) when layer has those fields.
   * Includes: region (or viloyat), district (or tuman), yil, turi (uzspace), vh.
   */
  private buildWhereClause(): string {
    const { viloyat, tuman, yil, uzspace } = this.state.regionalFilters;
    const { searchText, isSearchActive } = this.state;
    const hasActiveSearch = isSearchActive && Boolean(searchText?.trim());

    // Default mode: require only yil. Empty viloyat means republic-wide.
    // Exception: an active farmer/ИНН search should be able to match
    // records across all years, not just the currently selected one.
    if (!yil && !hasActiveSearch) {
      return "1=0";
    }

    const clauses: string[] = [];
    const layerFields =
      this.state.featureLayer?.fields?.map((f) => f.name.toLowerCase()) ?? [];
    const hasRegion = layerFields.includes("region");
    const hasDistrict = layerFields.includes("district");
    const regionField = this.state.featureLayer?.fields?.find(
      (ff) => ff?.name?.toLowerCase() === "region",
    );
    const districtField = this.state.featureLayer?.fields?.find(
      (ff) => ff?.name?.toLowerCase() === "district",
    );
    const isRegionString = (regionField?.type || "")
      .toLowerCase()
      .includes("string");
    const isDistrictString = (districtField?.type || "")
      .toLowerCase()
      .includes("string");

    if (viloyat) {
      const effectiveViloyat = this.normalizeApos(viloyat);
      const vilKey = this.makeRegionDistrictKey(effectiveViloyat);
      if (hasRegion && /^\d+$/.test(effectiveViloyat)) {
        clauses.push(
          isRegionString
            ? `region = '${this.escapeArcGIS(effectiveViloyat)}'`
            : `region = ${Number(effectiveViloyat)}`,
        );
      } else if (
        hasRegion &&
        vilKey &&
        this._viloyatToRegion[vilKey] !== undefined &&
        Number.isFinite(this._viloyatToRegion[vilKey])
      ) {
        const regionNum = this._viloyatToRegion[vilKey];
        clauses.push(
          isRegionString
            ? `region = '${this.escapeArcGIS(String(regionNum))}'`
            : `region = ${regionNum}`,
        );
      } else {
        clauses.push(this.eqAposSmart("viloyat", viloyat));
      }
    }
    if (tuman) {
      const effectiveTuman = this.normalizeApos(tuman);
      const districtNum = this.resolveDistrictNumber(viloyat, effectiveTuman);
      if (hasDistrict && /^\d+$/.test(effectiveTuman)) {
        clauses.push(
          isDistrictString
            ? `district = '${this.escapeArcGIS(effectiveTuman)}'`
            : `district = ${Number(effectiveTuman)}`,
        );
      } else if (
        hasDistrict &&
        districtNum !== undefined
      ) {
        clauses.push(
          isDistrictString
            ? `district = '${this.escapeArcGIS(String(districtNum))}'`
            : `district = ${districtNum}`,
        );
      } else {
        clauses.push(this.eqAposSmart("tuman", tuman));
      }
    }

    if (yil) {
      const four = String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0];
      clauses.push(
        four
          ? `yil LIKE '${four}%'`
          : `yil LIKE '%${this.escapeArcGIS(String(yil))}%'`,
      );
    }

    // ✅ Category (turi) stored in uzspace bucket
    if (uzspace) {
      const catField = this.getCategoryFieldName();
      if (catField) clauses.push(this.eqAposSmart(catField, uzspace));
    }

    // VH comes from the vegetation table; filter Agri_table_data by joined uniqueids.
    const vhIdsClause = this.buildVhUniqueIdsClause();
    if (vhIdsClause) {
      clauses.push(vhIdsClause);
    } else {
      const statusClause = this.buildNdviStatusClauseForCurrentVh();
      if (statusClause) clauses.push(statusClause);
    }

    // ✅ Search term filter - include ONLY if search suggestion was selected
    if (isSearchActive && searchText?.trim()) {
      const searchClause = this.buildSearchWhere(searchText);
      if (searchClause && searchClause !== "1=0") {

        clauses.push(`(${searchClause})`);
      }
    }

    const result = clauses.length ? clauses.join(" AND ") : "1=1";

    return withEvapoAccessWhere(result);
  }

  /**
   * Loads viloyat→region and tuman→district mappings from the full
   * Agri_table_data table (grouped DISTINCT query), not from a 50k-row
   * sample that may only cover a couple of viloyats.
   */
  private fetchAndStoreRegionDistrictMappings = async (): Promise<void> => {
    const rawSamples: Array<Record<string, unknown>> = [];

    try {
      const [regionDistrictRows, turiCropRows] = await Promise.all([
        queryAgriRegionDistrictMappings(),
        queryAgriTuriCropMappings(),
      ]);

      this._viloyatToRegion = {};
      this._tumanToDistrict = {};
      this._turiToCropId = {};

      for (const row of regionDistrictRows) {
        if (rawSamples.length < 10) {
          rawSamples.push({
            viloyat: row.viloyat,
            region: row.region,
            tuman: row.tuman,
            district: row.district,
          });
        }
        this.storeRegionDistrictMappingRow(
          row.viloyat,
          row.region,
          row.tuman,
          row.district,
        );
      }

      for (const row of turiCropRows) {
        const turiKey = this.makeRegionDistrictKey(row.turi);
        if (turiKey && row.cropId && !(turiKey in this._turiToCropId)) {
          this._turiToCropId[turiKey] = row.cropId;
        }
      }

      AgriGraffWidget.graffLog("regionDistrictMap:built", {
        rawSamples,
        regionDistrictRowCount: regionDistrictRows.length,
        turiCropRowCount: turiCropRows.length,
        viloyatToRegionKeys: Object.keys(this._viloyatToRegion).length,
        tumanToDistrictKeys: Object.keys(this._tumanToDistrict).length,
        turiToCropIdKeys: Object.keys(this._turiToCropId).length,
      });
    } catch (err: any) {
      AgriGraffWidget.graffLog("regionDistrictMap:FAILED", {
        error: String(err?.message || err),
      });
    }
  };

  /* ---------------------- ENHANCED EVENT HANDLERS FOR ALL 4 WIDGETS ---------------------- */

  // 🗓️ Year change: map to regional.yil + reset vh
  private handleConstructionYearChange = (event: CustomEvent) => {
    if (!this._isMounted) return;
    const { detail } = event || {};
    if (!detail || detail.source === "AgriGraffWidget") return;

    const yil = detail.year || detail.yil || detail.constructionYear || "";
    const next = {
      ...this.state.regionalFilters,
      yil: yil ? String(yil) : "",
      vh: "",
    };

    if (!this.filtersChanged(this.state.regionalFilters, next)) return;

    this.setState(
      {
        regionalFilters: next,
        vhUniqueids: null,
        loading: true,
        records: [],
        currentPage: 1,
      },
      () => {
        this.scheduleRefresh();

        // Broadcast updated filters so AgriFilter/AgriBar react automatically
        document.dispatchEvent(
          new CustomEvent("widgetSelectionChanged", {
            detail: {
              source: "AgriGraffWidget",
              yil: next.yil,
              viloyat: next.viloyat,
              tuman: next.tuman,
              turi: next.uzspace,
              vh: next.vh,
              timestamp: Date.now(),
            },
            bubbles: true,
          }),
        );
      },
    );
  };

  /** Get configured display fields from settings */
  private getDisplayFields(): string[] {
    const cfg: any = this.props?.config;
    const displayFields = cfg?.get
      ? cfg.get("displayFields")
      : cfg?.displayFields;

    if (!displayFields || displayFields.length === 0) {
      return ["uniqueid", "tuman", "f_name", "f_inn", "maydon", "turi", "vh"];
    }

    return displayFields;
  }

  /** Resolve the area/Maydon attribute used for table sorting. */
  private getMaydonSortFieldName(): string | null {
    const fields = this.getDisplayFields();
    const exact = fields.find((name) => name.toLowerCase() === "maydon");
    if (exact) return exact;
    const fuzzy = fields.find((name) => {
      const lower = name.toLowerCase();
      return lower.includes("maydon") || lower.includes("area");
    });
    return fuzzy || null;
  }

  private getTableOrderByFields = (): string[] => {
    const oidField = this.state.featureLayer?.objectIdField || "objectid";
    const { tableSort } = this.state;
    if (tableSort?.column === "maydon") {
      const maydonField = this.getMaydonSortFieldName();
      if (maydonField) {
        return [`${maydonField} ${tableSort.order.toUpperCase()}`];
      }
    }
    return [oidField];
  };

  private toggleMaydonSort = (): void => {
    const maydonField = this.getMaydonSortFieldName();
    if (!maydonField) return;

    this.setState(
      (prev) => {
        const prevSort = prev.tableSort;
        let next: AgriGraffWidgetState["tableSort"] = null;
        if (prevSort?.column !== "maydon") {
          next = { column: "maydon", order: "desc" };
        } else if (prevSort.order === "desc") {
          next = { column: "maydon", order: "asc" };
        } else {
          next = null;
        }
        return { tableSort: next };
      },
      () => {
        if (this.state.viewMode === "table") {
          void this.fetchData();
        }
      },
    );
  };

  /** Build a server-side table predicate from VH-matched polygon IDs. */
  private buildVhUniqueIdsClause(): string {
    const ids = this.state.vhUniqueids;
    if (!Array.isArray(ids)) return "";
    if (!ids.length) return "1=0";
    const chunks: string[] = [];
    for (let offset = 0; offset < ids.length; offset += 400) {
      const values = ids
        .slice(offset, offset + 400)
        .map((id) => `'${this.escapeArcGIS(String(id))}'`)
        .join(",");
      if (values) chunks.push(`uniqueid IN (${values})`);
    }
    return chunks.length === 1 ? chunks[0] : `(${chunks.join(" OR ")})`;
  }
  /** Resolve polygon NDVI status field for the currently selected NDVI date (e.g. status_2025_06_12). */
  private getStatusFieldNameForCurrentDate(): string | null {
    const fl = this.state.featureLayer;
    const ndviDate = (this.state.selectedNdviDate || "").trim();
    if (!fl || !fl.fields) return null;
    if (this._barCategoryField) {
      const broadcastMatch = fl.fields.find((f) => String(f.name || "").toLowerCase() === this._barCategoryField.toLowerCase());
      if (broadcastMatch) return broadcastMatch.name;
    }
    if (!ndviDate) return null;

    const cfg = (this.props.config || {}) as any;
    const prefix =
      (cfg.polygonStatusPrefix || "status_").toString().trim() || "status_";
    const suffix = ndviDate.replace(/-/g, "_");
    const desired = `${prefix}${suffix}`.toLowerCase();

    const match = fl.fields.find(
      (f) => (f.name || "").toString().toLowerCase() === desired,
    );
    return match ? match.name : null;
  }

  /** Build NDVI status WHERE clause for the current VH selection and NDVI date. */
  private buildNdviStatusClauseForCurrentVh(): string {
    const ndviDate = (this.state.selectedNdviDate || "").trim();
    const vhCategory = (this.state.regionalFilters?.vh || "").trim();
    if (!vhCategory) return "";
    if (!ndviDate && !this._barCategoryField) return "";

    const statusTableValue = this._barCategoryValue || VH_TO_NDVI_STATUS[vhCategory];
    if (!statusTableValue) return "";

    const statusField = this.getStatusFieldNameForCurrentDate();
    if (!statusField) return "";

    return `${statusField} = '${this.escapeArcGIS(statusTableValue)}'`;
  }

  /** Get display name for a field (alias or field name) */
  private getFieldDisplayName(fieldName: string): string {
    const { featureLayer } = this.state;

    if (!featureLayer?.fields) return fieldName;

    const field = featureLayer.fields.find(
      (f) => f.name.toLowerCase() === fieldName.toLowerCase(),
    );
    return field?.alias || fieldName;
  }

  // 🔗 Handles categoryFilterChanged from GeoPie
  private handleLandCategoryChange = (event: CustomEvent) => {
    if (!this._isMounted) return;
    const { detail } = event || {};
    if (!detail || detail.source === "AgriGraffWidget") return;

    const selected = (
      detail.category ??
      detail.turi ??
      detail.tur ??
      detail.uzspace ??
      ""
    )
      .toString()
      .trim();

    const v = detail.viloyat
      ? this.normalizeApos(detail.viloyat)
      : this.state.regionalFilters.viloyat;
    const t = detail.tuman
      ? this.normalizeApos(detail.tuman)
      : this.state.regionalFilters.tuman;
    const y =
      detail.yil != null
        ? String(detail.yil)
        : detail.year != null
          ? String(detail.year)
          : this.state.regionalFilters.yil;

    // ✅ Keep current bar selection (vh) when only category changes so bar + crop filters apply together
    const nextRegional = {
      viloyat: v || "",
      tuman: t || "",
      yil: y || "",
      uzspace: selected ? this.normalizeApos(selected) : "",
      vh: this.state.regionalFilters.vh || "",
    };

    if (!this.filtersChanged(this.state.regionalFilters, nextRegional)) return;

    this.cancelVegetationImageOverlay();

    this.setState(
      {
        regionalFilters: nextRegional,
        vhUniqueids: null,
        selecteduniqueid: "",
        selectedNdviDate: null,
        selectedChartIndexKey: null,
        polygonAvailableDates: [],
        polygonImageError: null,
        vegetationError: null,
        records: [],
        currentPage: 1,
        loading: true,
      },
      () => {
        try {
          this.state.activeMapView?.view?.graphics?.removeAll?.();
        } catch {}

        this.applyMapFilters();
        this.throttledFetchData();

        // Keep graph view alive when crop changes without polygon selection.
        // Otherwise vegetationData stays empty and UI shows "Viloyat ma'lumoti yo'q".
        if (this.state.viewMode === "graph" && !this.state.selecteduniqueid) {
          this.fetchRegionalTimeseries();
        }

        try {
          document.dispatchEvent(
            new CustomEvent("widgetSelectionChanged", {
              detail: {
                source: "AgriGraffWidget",
                polygonMode: false,
                timestamp: Date.now(),
              },
              bubbles: true,
            }),
          );
        } catch {}
      },
    );
  };

  // 🌍 Region change: update + reset vh
  private handleRegionalChange = (event: CustomEvent) => {
    if (!this._isMounted) return;
    const { detail } = event || {};
    if (!detail || detail.source === "AgriGraffWidget") return;

    const next = {
      viloyat: detail.viloyat ? this.normalizeApos(detail.viloyat) : "",
      tuman: detail.tuman ? this.normalizeApos(detail.tuman) : "",
      yil: detail.yil ? String(detail.yil) : "",
      uzspace: detail.uzspace ? this.normalizeApos(detail.uzspace) : "",
      vh: "", // ✅ reset vh when region changes
    };

    if (!this.filtersChanged(this.state.regionalFilters, next)) return;

    this.setState(
      {
        regionalFilters: next,
        vhUniqueids: null,
        loading: true,
        records: [],
        currentPage: 1,
      },
      () => {
        this.scheduleRefresh();

        document.dispatchEvent(
          new CustomEvent("widgetSelectionChanged", {
            detail: {
              source: "AgriGraffWidget",
              yil: next.yil,
              viloyat: next.viloyat,
              tuman: next.tuman,
              turi: next.uzspace,
              vh: next.vh,
              timestamp: Date.now(),
            },
            bubbles: true,
          }),
        );
      },
    );
  };

  // 🧩 General filter: supports vh + turi
  private handleGeneralFilterChange = (event: CustomEvent) => {
    if (!this._isMounted) return;
    const { detail } = event || {};
    if (!detail || detail.source === "AgriGraffWidget") return;

    const next = { ...this.state.regionalFilters };
    let parentChanged = false;

    if (detail.viloyat || detail.massivNom || detail.region) {
      const v = this.normalizeApos(
        detail.viloyat || detail.massivNom || detail.region,
      );
      if (v !== next.viloyat) parentChanged = true;
      next.viloyat = v;
    }
    if (detail.tuman || detail.tumanNomi || detail.district) {
      const t = this.normalizeApos(
        detail.tuman || detail.tumanNomi || detail.district,
      );
      if (t !== next.tuman) parentChanged = true;
      next.tuman = t;
    }
    if (detail.yil || detail.year || detail.constructionYear) {
      const y = String(detail.yil || detail.year || detail.constructionYear);
      if (y !== next.yil) parentChanged = true;
      next.yil = y;
    }

    // ✅ Category (turi)
    if (
      detail.turi ||
      detail.tur ||
      detail.uzspace ||
      detail.yerToifas ||
      detail.category
    ) {
      const cat = this.normalizeApos(
        detail.turi ||
          detail.tur ||
          detail.uzspace ||
          detail.yerToifas ||
          detail.category,
      );
      if (cat !== next.uzspace) parentChanged = true;
      next.uzspace = cat;
    }

    // ✅ VH
    if (detail.vh !== undefined) {
      next.vh = this.normalizeApos(detail.vh || "");
    }

    // ✅ parent changed => clear vh unless explicitly set
    if (parentChanged && detail.vh === undefined) {
      next.vh = "";
    }

    if (!this.filtersChanged(this.state.regionalFilters, next)) return;

    this.setState(
      {
        regionalFilters: next,
        loading: true,
        records: [],
        currentPage: 1,
      },
      () => {
        this.scheduleRefresh();

        document.dispatchEvent(
          new CustomEvent("widgetSelectionChanged", {
            detail: {
              source: "AgriGraffWidget",
              yil: next.yil,
              viloyat: next.viloyat,
              tuman: next.tuman,
              turi: next.uzspace,
              vh: next.vh,
              timestamp: Date.now(),
            },
            bubbles: true,
          }),
        );
      },
    );
  };

  // Central external filter update processor
  private processExternalFilterUpdate = (
    sourceWidget: string,
    updates: ConfiguredFilters,
  ) => {
    const now = Date.now();

    if (
      this.state.isProcessingExternalUpdate ||
      now - this.state.lastUpdateTimestamp < 300
    )
      return;
    if (Object.keys(updates).length === 0) return;

    const changed = Object.entries(updates).some(
      ([k, v]) => this.state.externalFilters[k] !== v,
    );
    if (!changed) return;

    clearTimeout(this._updateDebounceTimer);
    this._updateDebounceTimer = setTimeout(() => {
      this.applyExternalFilterUpdate(sourceWidget, updates);
    }, 200);
  };

  private applyExternalFilterUpdate = async (
    sourceWidget: string,
    updates: ConfiguredFilters,
  ) => {
    if (!this._isMounted) return;

    

    if (this.state.connectionStatus !== "connected") {
      this.setState({
        externalFilters: { ...this.state.externalFilters, ...updates },
        lastUpdateTimestamp: Date.now(),
      });
      return;
    }

    this.setState(
      {
        isProcessingExternalUpdate: true,
        lastUpdateTimestamp: Date.now(),
        externalFilters: { ...this.state.externalFilters, ...updates },
        records: [],
        currentPage: 1,
        loading: true,
      },
      () => {

        this.scheduleRefresh();
      },
    );

    setTimeout(() => {
      if (this._isMounted) this.setState({ isProcessingExternalUpdate: false });
    }, 100);
  };

  /* ---------------------- Table pagination (Agrobank ContoursTable) ---------------------- */

  private normalizeUniqueidKey = (value: string | null | undefined): string =>
    String(value || "").replace(/[{}]/g, "").trim().toLowerCase();

  private recordMatchesUniqueid = (
    record: RecordData,
    uniqueid: string,
  ): boolean => {
    const target = this.normalizeUniqueidKey(uniqueid);
    if (!target) return false;
    const recordId = this.normalizeUniqueidKey(
      String(record.uniqueid || record.objectid || ""),
    );
    return !!recordId && recordId === target;
  };

  private scrollSelectedRowIntoCenter = (): void => {
    const container = this.tableContainerRef.current;
    if (!container) return;
    const selectedId = this.normalizeUniqueidKey(
      this._pendingScrollUniqueid || this.state.selecteduniqueid || "",
    );
    let row = container.querySelector(
      "tr.kadastr-table-row.selected-row",
    ) as HTMLElement | null;
    if (!row && selectedId) {
      const rows = Array.from(
        container.querySelectorAll("tr.kadastr-table-row[data-uniqueid]"),
      ) as HTMLElement[];
      row =
        rows.find(
          (el) =>
            this.normalizeUniqueidKey(el.getAttribute("data-uniqueid") || "") ===
            selectedId,
        ) || null;
    }
    if (!row) return;
    try {
      row.scrollIntoView({
        block: "center",
        behavior: "smooth",
        inline: "nearest",
      });
    } catch {
      const rowTop = row.offsetTop;
      const nextTop = Math.max(
        0,
        rowTop + row.offsetHeight / 2 - container.clientHeight / 2,
      );
      container.scrollTo({ top: nextTop, behavior: "smooth" });
    }
  };

  private scheduleScrollSelectedRowIntoCenter = (): void => {
    if (typeof window === "undefined") return;
    const run = () => {
      if (!this._isMounted) return;
      this.scrollSelectedRowIntoCenter();
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    // Table may still be painting after page swap / loader hide.
    window.setTimeout(run, 80);
    window.setTimeout(run, 220);
  };

  private buildUniqueidWhere = (uniqueid: string): string => {
    const clean = this.normalizeUniqueidKey(uniqueid);
    if (!clean) return "1=0";
    const escaped = this.escapeArcGIS(clean);
    const braced = this.escapeArcGIS(`{${clean}}`);
    return `(uniqueid = '${escaped}' OR uniqueid = '${braced}')`;
  };

  /** Count rows that sort before the selected feature (same order as the table). */
  private async resolveTablePageForUniqueid(
    uniqueid: string,
  ): Promise<number | null> {
    const layer = this.state.featureLayer;
    if (!layer || !uniqueid) return null;

    const whereClause = this.buildWhereClause();
    const oidField = layer.objectIdField || "objectid";
    const idWhere = this.buildUniqueidWhere(uniqueid);

    try {
      if (typeof layer.load === "function") {
        try {
          await layer.load();
        } catch {
          /* continue */
        }
      }

      const findQ = layer.createQuery();
      findQ.where = `(${whereClause}) AND (${idWhere})`;
      findQ.outFields = [oidField, "uniqueid"];
      const maydonField = this.getMaydonSortFieldName();
      if (maydonField && this.state.tableSort?.column === "maydon") {
        findQ.outFields = [...(findQ.outFields as string[]), maydonField];
      }
      findQ.returnGeometry = false;
      findQ.num = 1;
      let found = (await layer.queryFeatures(findQ))?.features?.[0];

      // Fallback: id exists but outside current filters — still try unfiltered
      // lookup only to confirm the id; page resolve needs filtered set.
      if (!found) {
        findQ.where = idWhere;
        found = (await layer.queryFeatures(findQ))?.features?.[0];
        if (!found) return null;
        // Re-check inside filtered where by objectid.
        const oidProbe = Number(
          found.attributes?.[oidField] ?? found.attributes?.objectid,
        );
        if (!Number.isFinite(oidProbe)) return null;
        const inFilterQ = layer.createQuery();
        inFilterQ.where = `(${whereClause}) AND (${oidField} = ${oidProbe})`;
        inFilterQ.returnGeometry = false;
        inFilterQ.num = 1;
        const inFilter = (await layer.queryFeatures(inFilterQ))?.features?.[0];
        if (!inFilter) return null;
        found = inFilter;
      }

      const attrs = found.attributes || {};
      const oid = Number(attrs[oidField] ?? attrs.objectid);
      if (!Number.isFinite(oid)) return null;

      let beforeWhere = `(${whereClause}) AND (${oidField} < ${oid})`;
      if (this.state.tableSort?.column === "maydon" && maydonField) {
        const maydonNum = Number(attrs[maydonField]);
        if (Number.isFinite(maydonNum)) {
          const cmp = this.state.tableSort.order === "desc" ? ">" : "<";
          beforeWhere =
            `(${whereClause}) AND (` +
            `${maydonField} ${cmp} ${maydonNum} OR (` +
            `${maydonField} = ${maydonNum} AND ${oidField} < ${oid}))`;
        }
      }

      const beforeCount = await layer.queryFeatureCount({
        where: beforeWhere,
      } as any);
      if (beforeCount == null || !Number.isFinite(Number(beforeCount))) {
        return null;
      }
      return Math.floor(Number(beforeCount) / this.RECORDS_PER_PAGE) + 1;
    } catch {
      return null;
    }
  }

  /**
   * Ensure the selected polygon's row is on the current page and scrolled
   * into the middle of the table viewport (map pick or table pick).
   */
  private ensureSelectedRowVisible = async (
    uniqueid?: string | null,
  ): Promise<void> => {
    const id = String(uniqueid || this.state.selecteduniqueid || "").trim();
    if (!id) return;
    this._pendingScrollUniqueid = id;

    if (this.state.viewMode !== "table") {
      return;
    }

    const token = ++this._selectionPageResolveToken;

    const onCurrentPage = this.state.records.some((record) =>
      this.recordMatchesUniqueid(record, id),
    );
    if (onCurrentPage) {
      this.scheduleScrollSelectedRowIntoCenter();
      this._pendingScrollUniqueid = null;
      return;
    }

    // Wait out an in-flight table fetch before resolving the page.
    if (this.state.loading) return;

    const targetPage = await this.resolveTablePageForUniqueid(id);
    if (!this._isMounted || token !== this._selectionPageResolveToken) return;
    if (targetPage == null) {
      // Still try to scroll if the row somehow rendered.
      this.scheduleScrollSelectedRowIntoCenter();
      return;
    }

    if (targetPage === this.state.currentPage) {
      this.scheduleScrollSelectedRowIntoCenter();
      this._pendingScrollUniqueid = null;
      return;
    }

    this.setState({ currentPage: targetPage, loading: true }, () => {
      void this.fetchData({ preservePage: true });
    });
  };

  private goToTablePage = (page: number): void => {
    const totalPages = Math.max(
      1,
      Math.ceil(this.state.totalRecordCount / this.RECORDS_PER_PAGE),
    );
    const next = Math.min(Math.max(1, page), totalPages);
    if (next === this.state.currentPage && this.state.records.length) return;
    /* User-driven paging: cancel any "snap to selected row" in flight. */
    this._pendingScrollUniqueid = null;
    this._selectionPageResolveToken += 1;
    this.setState({ currentPage: next, loading: true }, () => {
      void this.fetchData({ preservePage: true });
    });
  };

  retryMapConnection() {

    this.setState({
      connectionStatus: "connecting",
      mapConnectionAttempts: 0,
      error: null,
    });
  }

  onActiveViewChange = (jimuMapView: JimuMapView) => {

    if (!jimuMapView) {
      
      this.setState({
        activeMapView: null,
        featureLayer: null,
      });
      return;
    }

    this.setState(
      {
        activeMapView: jimuMapView,
      },
      () => {
        if (jimuMapView.view && jimuMapView.view.ready) {
          
          this.initializeMapConnection(jimuMapView);
        } else {
          
          const readyWatch = jimuMapView.view.watch("ready", (isReady) => {
            if (isReady) {

              readyWatch.remove();
              this.initializeMapConnection(jimuMapView);
            }
          });
        }
      },
    );
  };

  /** Format a field value for display */
  private formatFieldValue(fieldName: string, value: any): string {
    if (value === null || value === undefined || value === "") {
      return "N/A";
    }

    const lowerFieldName = fieldName.toLowerCase();

    if (lowerFieldName.includes("maydon") || lowerFieldName.includes("area")) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
      }
    }

    if (lowerFieldName.includes("date") || lowerFieldName.includes("sana")) {
      try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
        }
      } catch {}
    }

    // Translate display-only region/district names; selection notifications must use original values.
    if (lowerFieldName.includes("viloyat")) {
      return translateForDisplay(String(value), this.state.language, "region");
    }
    if (lowerFieldName.includes("tuman")) {
      return translateForDisplay(String(value), this.state.language, "district");
    }

    return String(value);
  }

  /** Get CSS class for field column */
  private getColumnClass(fieldName: string): string {
    const lowerFieldName = fieldName.toLowerCase();

    if (lowerFieldName.includes("inn") || lowerFieldName.includes("id")) {
      return "number-column";
    }
    if (lowerFieldName.includes("name") || lowerFieldName.includes("nom")) {
      return "name-column wide-column";
    }
    if (lowerFieldName.includes("maydon") || lowerFieldName.includes("area")) {
      return "number-column";
    }

    return "default-column";
  }

  /** Get human-friendly NDVI status label for the record at the currently selected NDVI date. */
  private getStatusValueForRecord(record: RecordData): string {
    const statusField = this.getStatusFieldNameForCurrentDate();
    if (!statusField) return "N/A";

    const raw = (record as any)[statusField];
    if (raw === null || raw === undefined || raw === "") return "N/A";

    const key = String(raw).trim().toLowerCase().replace(/\s+/g, "_");
    const vhCategory = NDVI_STATUS_TO_VH[key];
    if (vhCategory)
      return getLocalizedVhCategoryLabel(vhCategory, this.state.language);

    return this.formatFieldValue(statusField, raw);
  }

  // AgriGraffWidget
  private initializeMapConnection = async (jimuMapView: JimuMapView) => {
    if (!this._isMounted) return;

    // Agri_table_data is an external Table, not part of the map — it is
    // loaded directly by URL instead of resolved from useDataSources/map layers.
    let featureLayers: __esri.FeatureLayer[] = [];
    try {
      const { layer } = await getAgriTableDataLayer();
      featureLayers = [layer];
    } catch {
      featureLayers = [];
    }
    const featureLayer = featureLayers?.[0] ?? null;

    if (!featureLayer) {
      this.setState({
        connectionStatus: "failed",
        error: "Agri_table_data external layer failed to load.",
      });
      return;
    }

    if (
      !featureLayer.loaded ||
      !featureLayer.fields ||
      featureLayer.fields.length === 0
    ) {
      
      try {
        await featureLayer.load();

        
        
      } catch (err: any) {
        
        this.setState({
          connectionStatus: "failed",
          error: `Error loading the configured feature layer: ${err.message || err}`,
        });
        return;
      }
    }

    if (!featureLayer.fields || featureLayer.fields.length === 0) {
      
      this.setState({
        connectionStatus: "failed",
        error:
          "Созланган қатламда ишлатиладиган майдонлар йўқ. Қатлам созламасини текшеринг.",
      });
      return;
    }

    

    const configuredFields = this.getConfiguredFilterFields();
    

    if (configuredFields.length === 0) {
      
      this.setState({
        connectionStatus: "failed",
        error:
          "Майдонлар танланмаган. Виджет созламаларида майдонларни танланг.",
      });
      return;
    }

    const layerFields = featureLayer.fields.map((f) => f.name.toLowerCase());
    const missingFields = REQUIRED_FIELDS.filter(
      (field) => !layerFields.includes(field.toLowerCase()),
    );

    if (missingFields.length > 0) {
      
      

      this.setState({
        connectionStatus: "failed",
        error: `The layer "${featureLayer.title}" is missing required fields: ${missingFields.join(", ")}. Please select a different layer that contains these fields: ${REQUIRED_FIELDS.join(", ")}`,
      });
      return;
    }

    

    this.setState(
      {
        featureLayers,
        featureLayer,
        configuredFields,
        connectionStatus: "connected",
        error: null,
        activeMapView: jimuMapView,
      },
      async () => {
        // Agri_table_data has no geometry — map-click hitTest/highlight
        // still needs the builder-assigned spatial polygon layer(s).
        try {
          const spatialClickLayers =
            await this.resolveFeatureLayersFromUseDataSources(jimuMapView);
          this.setState({ spatialClickLayers });
        } catch {
          /* map click will simply no-op without a spatial layer */
        }
        // NOT calling this.attachMapClick(jimuMapView) here anymore.
        //
        // AgriPopup already owns map-click -> polygon-inspection (it has its
        // own view.on("click", ...) listener, resolves the clicked feature,
        // and relays the result to this widget via
        // widgetSelectionChanged -> AgriLocalization -> masterFilterChanged
        // -> syncExternalPolygonSelection()). Graff's OWN handleMapClick was
        // a second, fully independent listener on the SAME view.on("click")
        // event, doing its own separate hitTest/query and setting
        // selecteduniqueid directly. Two independent async pipelines
        // resolving the same click at different speeds is a race by
        // construction: whichever finishes first "wins" the visible
        // selection, and a slow finisher landing after the user has already
        // moved on to a different polygon can silently revert/re-apply a
        // stale polygon+image — this was the actual root cause behind
        // repeated "old polygon's image still shows" reports, not something
        // patchable by timestamp-guarding each path individually.
        // Removing this second listener makes AgriPopup's relay the SOLE
        // source of truth for which polygon Graff's chart/image reflects,
        // which is guaranteed consistent with what the popup itself shows.
        await this.fetchAndStoreRegionDistrictMappings();
        await this.buildViloyatKeyToLayerIndex();

        // No builder-assigned Data Source is required — Agri_table_data is
        // loaded directly by URL above, independent of useDataSources.
        this.setState({ loading: true });
        this.fetchFilterOptions();
      },
    );
  };
  // Attach map click handler
  private attachMapClick = (jimuMapView: JimuMapView) => {
    this.detachMapClick();
    if (jimuMapView?.view) {
      this._clickHandle = jimuMapView.view.on("click", this.handleMapClick);
    }
  };

  // Detach map click handler
  private detachMapClick = () => {
    if (this._clickHandle?.remove) {
      this._clickHandle.remove();
      this._clickHandle = null;
    }
  };
  /** Case-insensitive lookup for a "uniqueid"-named attribute key. */
  private static findUniqueIdKey(
    attrs: Record<string, any> | null | undefined,
  ): string | undefined {
    if (!attrs) return undefined;
    return Object.keys(attrs).find((k) => k.toLowerCase() === "uniqueid");
  }

  private handleMapClick = async (event: any) => {
    // Captured before any awaits — see _lastAppliedPolygonClickedAt.
    const clickedAt = Date.now();
    const { spatialClickLayers, activeMapView } = this.state;

    if (!activeMapView?.view) {
      AgriGraffWidget.graffLog("handleMapClick:SKIP-no-view");
      return;
    }

    try {
      // Restrict hitTest to the known polygon layers so stray graphics on
      // other layers — e.g. a leftover hand-drawn shape on the built-in
      // Sketch (MapNotesLayer) layer — can never shadow the real polygon
      // underneath just for sitting on top in draw order.
      //
      // hitTest's `include` only recognizes top-level Layer instances (it
      // uses them to decide which MapImageLayer to run identify() against)
      // — passing the individual Sublayer objects directly (what
      // spatialClickLayers actually holds) matches nothing, so the parent
      // MapImageLayer must be included instead.
      const includeLayers = spatialClickLayers?.length
        ? Array.from(
            new Set(
              spatialClickLayers.map(
                (sl: any) => getMapImageParentLayer(sl) || sl,
              ),
            ),
          )
        : [];
      const hitTestOptions = includeLayers.length
        ? { include: includeLayers as any }
        : undefined;
      const response = await activeMapView.view.hitTest(event, hitTestOptions);
      const results = (response?.results as any[] | undefined) || [];

      if (!results.length) {
        AgriGraffWidget.graffLog("handleMapClick:no-hitTest-results", {
          restrictedToKnownLayers: !!hitTestOptions,
          includeLayerCount: includeLayers.length,
          includeLayerTitles: includeLayers.map((l: any) => l?.title),
        });
        return;
      }

      const graphicHits = results.filter(
        (r) =>
          r && typeof r === "object" && "graphic" in r && (r as any).graphic,
      );

      if (!graphicHits.length) {
        AgriGraffWidget.graffLog("handleMapClick:no-graphic-hits", {
          resultCount: results.length,
        });
        return;
      }

      // For MapImageLayer sublayers, hitTest puts the queryable Sublayer on
      // graphic.sourceLayer (graphic.layer is the parent, .identify()-only).
      const hitLayerOf = (h: any): any =>
        h?.graphic?.sourceLayer || h?.graphic?.layer;

      // Path 1 (preferred): some polygon sources on this map — e.g. Sketch/
      // MapNotes-based "Polygons", which are in-memory and have no REST
      // endpoint to re-query by objectid — already carry the full uniqueid
      // attribute directly on the hitTest graphic. Use it straight away
      // whenever present, regardless of which layer produced the hit.
      let fullFeature: any = null;
      let uniqueid: string | null = null;

      const directHit = graphicHits.find((h: any) => {
        const key = AgriGraffWidget.findUniqueIdKey(h.graphic?.attributes);
        return key && String(h.graphic.attributes[key] ?? "").trim() !== "";
      }) as any;

      if (directHit) {
        const key = AgriGraffWidget.findUniqueIdKey(
          directHit.graphic.attributes,
        )!;
        fullFeature = directHit.graphic;
        uniqueid = String(directHit.graphic.attributes[key]);
        AgriGraffWidget.graffLog("handleMapClick:resolved-uniqueid-direct", {
          uniqueid,
          layerTitle: hitLayerOf(directHit)?.title,
          declaredClass: hitLayerOf(directHit)?.declaredClass,
        });
      } else {
        // Path 2 (fallback): server-backed layers can return partial
        // hitTest attributes (e.g. just objectid) — match against the
        // pre-resolved spatialClickLayers (or any queryable hit layer) and
        // re-query the full feature by objectid to get uniqueid.
        let matchedLayer: __esri.FeatureLayer | null = null;
        let match: any = graphicHits.find((h) => {
          const lyr: any = hitLayerOf(h);
          const found = (spatialClickLayers || []).find(
            (sl) =>
              lyr === sl ||
              (sl.url && lyr?.url === sl.url) ||
              (sl.id && lyr?.id === sl.id),
          );
          if (found) matchedLayer = found;
          return !!found;
        });

        if (!match || !matchedLayer) {
          const fallback = graphicHits.find((h: any) => {
            const lyr = hitLayerOf(h);
            return lyr && typeof lyr.queryFeatures === "function";
          });
          if (fallback) {
            matchedLayer = hitLayerOf(fallback) as __esri.FeatureLayer;
            match = fallback;
          }
        }

        if (!match || !matchedLayer) {
          AgriGraffWidget.graffLog("handleMapClick:no-layer-match-ATTRS-DUMP", {
            hits: graphicHits.map((h: any) => ({
              layerTitle: hitLayerOf(h)?.title,
              declaredClass: hitLayerOf(h)?.declaredClass,
              attributes: h.graphic?.attributes,
              geometryType: h.graphic?.geometry?.type,
            })),
          });
          return;
        }

        const featureLayer = matchedLayer as __esri.FeatureLayer;
        const hitGraphic = (match as any).graphic;
        const oidField = featureLayer.objectIdField || "objectid";
        const oid = hitGraphic?.attributes?.[oidField];

        if (oid == null) {
          AgriGraffWidget.graffLog("handleMapClick:no-objectid-on-hit-graphic", {
            oidField,
            attributeKeys: Object.keys(hitGraphic?.attributes || {}),
          });
          return;
        }

        const query = featureLayer.createQuery();
        query.where = `${oidField} = ${oid}`;
        query.outFields = ["*"];
        query.returnGeometry = true;

        const queryResult = await featureLayer.queryFeatures(query);
        if (!queryResult?.features?.length) {
          AgriGraffWidget.graffLog("handleMapClick:full-feature-query-empty", {
            oidField,
            oid,
          });
          return;
        }

        fullFeature = queryResult.features[0];
        const key = AgriGraffWidget.findUniqueIdKey(fullFeature.attributes);
        uniqueid = key ? String(fullFeature.attributes[key]) : null;

        if (!uniqueid) {
          AgriGraffWidget.graffLog("handleMapClick:no-uniqueid-on-full-feature", {
            attributeKeys: Object.keys(fullFeature.attributes || {}),
          });
          return;
        }

        AgriGraffWidget.graffLog("handleMapClick:resolved-uniqueid-via-query", {
          uniqueid,
          viewMode: this.state.viewMode,
        });
      }

      // A newer click (this widget's own, or a faster-resolving external
      // relay via AgriPopup/AgriLocalization) has already been applied while
      // this one's async hit-test/query work was in flight — drop this
      // stale result instead of reverting the selection backwards.
      if (clickedAt < this._lastAppliedPolygonClickedAt) {
        AgriGraffWidget.graffLog("handleMapClick:SKIP-stale", {
          uniqueid,
          clickedAt,
          lastApplied: this._lastAppliedPolygonClickedAt,
        });
        return;
      }
      this._lastAppliedPolygonClickedAt = clickedAt;

      const currentClean = String(this.state.selecteduniqueid || "")
        .replace(/[{}]/g, "")
        .trim();
      const nextClean = String(uniqueid || "")
        .replace(/[{}]/g, "")
        .trim();
      /* Click same selected polygon on map → deactivate (like row toggle). */
      if (currentClean && nextClean && currentClean === nextClean) {
        if (clickedAt <= this._selectionCommittedAt) return;
        this.clearPolygonSelectionFromMapClick();
        return;
      }

      // Search was active: clear search UI/filter, but keep selecting the
      // newly clicked map field (AgriPopup also zooms to it).
      const hadSearchSelection =
        Boolean(this.state.isSearchActive) ||
        Boolean(String(this.state.searchText || "").trim());
      if (hadSearchSelection) {
        this.setState({
          searchText: "",
          searchError: null,
          searchResultCount: null,
          isSearchActive: false,
        });
        try {
          document.dispatchEvent(
            new CustomEvent("agriGraff4TableSearchChanged", {
              detail: {
                source: "AgriGraffWidget",
                query: "",
                preserveSelection: true,
                isFullSelection: false,
                timestamp: Date.now(),
              },
              bubbles: true,
            }),
          );
        } catch {
          /* ignore */
        }
      }

      // Highlight
      try {
        this.clearMapSelectionGraphics(activeMapView.view);
        this.addSelectionGlow(activeMapView.view, fullFeature);
      } catch (e) {
        AgriGraffWidget.graffLog("handleMapClick:highlight-FAILED", {
          error: String((e as any)?.message || e),
        });
      }

      // A different polygon is now selected — any raster overlay/date
      // selection from the previous one no longer applies.
      this.cancelVegetationImageOverlay();

      this._polygonSelectionOrigin = "map";
      this._selectionCommittedAt = Date.now();
      // Set state
      this.setState(
        {
          selecteduniqueid: String(uniqueid),
          // Show jadval so the selected row can be highlighted + scrolled into view.
          viewMode: "table",
          error: null,
          vegetationError: null,
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          polygonAvailableDates: [],
          polygonImageError: null,
          loading: true,
        },
        () => {
          this._pendingScrollUniqueid = String(uniqueid);
          this.fetchVegetationData();
          if (this.state.connectionStatus === "connected") {
            void this.fetchData();
          }
        },
      );
    } catch (error) {
      AgriGraffWidget.graffLog("handleMapClick:FAILED", {
        error: String((error as any)?.message || error),
      });
    }
  };

  // ✅ Helper method to highlight feature (extract this logic)
  /** Clear Graff view.graphics and AgriPopup's highlight layer so both selection paths stay in sync. */
  private clearMapSelectionGraphics = (
    view?: __esri.MapView | __esri.SceneView | null,
  ) => {
    try {
      view?.graphics?.removeAll?.();
    } catch {
      /* ignore */
    }
    try {
      const layer = view?.map?.findLayerById?.(
        "agri-polygon-highlight",
      ) as __esri.GraphicsLayer | null | undefined;
      layer?.removeAll?.();
    } catch {
      /* ignore */
    }
  };

  /** Bright cyan core with a wider translucent halo for selection visibility. */
  private buildSelectionSymbol = (
    geomType: string | undefined,
    halo = false,
  ) => {
    if (geomType === "polygon") {
      return new SimpleFillSymbol({
        color: new Color([0, 0, 0, 0]),
        outline: new SimpleLineSymbol({
          color: new Color(
            halo ? [0, 229, 255, 0.32] : [128, 245, 255, 1],
          ),
          width: halo ? 9 : 3,
          style: "solid",
        }),
      });
    }
    if (geomType === "polyline") {
      return new SimpleLineSymbol({
        color: new Color(
          halo ? [0, 229, 255, 0.32] : [128, 245, 255, 1],
        ),
        width: halo ? 10 : 4,
      });
    }
    return new SimpleMarkerSymbol({
      color: new Color(
        halo ? [0, 229, 255, 0.22] : [0, 229, 255, 0.95],
      ),
      size: halo ? 22 : 14,
      outline: new SimpleLineSymbol({
        color: new Color([255, 255, 255, halo ? 0.3 : 1]),
        width: halo ? 5 : 2,
      }),
    });
  };

  private addSelectionGlow = (
    view: __esri.MapView | __esri.SceneView,
    feature: __esri.Graphic,
  ) => {
    const geometryType = feature?.geometry?.type;
    const halo = feature.clone() as any;
    halo.symbol = this.buildSelectionSymbol(geometryType, true);
    const core = feature.clone() as any;
    core.symbol = this.buildSelectionSymbol(geometryType);
    view.graphics.addMany([halo, core]);
  };

  private highlightFeature = async (
    feature: __esri.Graphic,
    activeMapView: JimuMapView,
  ) => {
    try {
      const view = activeMapView.view;
      this.clearMapSelectionGraphics(view);

      this.addSelectionGlow(view, feature);

      try {
        await view.goTo(
          feature.geometry?.extent?.expand(1.35) || feature.geometry,
          {
          duration: 700,
          easing: "ease-in-out" as any,
        });
      } catch (goToErr) {
        /* ignore */
      }
    } catch (hErr) {
      /* ignore */
    }
  };

  // SIMPLIFIED: Only return fields explicitly configured in settings
  private getConfiguredFilterFields(): string[] {
    const cfg = this.props?.config?.filterFields;
    if (!cfg) {
      
      return REQUIRED_FIELDS;
    }

    const dsId =
      (this.state.dataSource as any)?.id ||
      this.props.useDataSources?.[0]?.dataSourceId;

    let filterMap: Record<string, string[]>;
    if (typeof (cfg as any).asMutable === "function") {
      filterMap = (cfg as any).asMutable({ deep: true });
    } else {
      filterMap = cfg as any;
    }

    const configuredFields = dsId && filterMap[dsId] ? filterMap[dsId] : [];

    
    return configuredFields;
  }

  private refreshFiltersFromConfig() {
    const fields = this.getConfiguredFilterFields();

    if (fields.length === 0) {
      
      this.setState({
        configuredFields: [],
        filterOptions: {},
        localFilters: {},
      });
      return;
    }

    const makeMap = (def: any) =>
      fields.reduce(
        (acc, f) => {
          acc[f] = def;
          return acc;
        },
        {} as Record<string, any>,
      );

    this.setState({
      configuredFields: fields,
      filterOptions: makeMap([]),
      localFilters: makeMap(""),
    });

    
  }

  private normalizeUrl(u?: string): string {
    if (!u) return "";
    try {
      const url = new URL(u);
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return u.replace(/\/+$/, "");
    }
  }

  private resolveFeatureLayerFromDataSource = async (
    jimuMapView: JimuMapView,
    useDsOverride?: any,
  ): Promise<__esri.FeatureLayer | null> => {
    

    if (!jimuMapView?.view?.map) {
      
      return null;
    }

    const useDs = useDsOverride ?? this.props.useDataSources?.[0];
    
    

    if (!useDs?.dataSourceId) {
      
      return null;
    }

    const dsId = useDs.dataSourceId;
    const rootDsId = (useDs as any).rootDataSourceId;

    const jlvList: any[] = jimuMapView.getAllJimuLayerViews?.() || [];
    

    jlvList.forEach((lv, idx) => {
      
    });

    const matchByDsId = (id: string) =>
      jlvList.find(
        (lv) =>
          lv?.layerDataSourceId === id ||
          lv?.dataSourceId === id ||
          lv?.layer?.dataSourceId === id,
      );

    let jlv = matchByDsId(dsId) || (rootDsId ? matchByDsId(rootDsId) : null);

    // getQueryableLayer handles both plain FeatureLayers and Map Image Layer
    // roots by drilling into .sublayers/.allSublayers for a queryable child —
    // the same shared helper evapo/evapo-main's widgets rely on.
    const jlvQueryable = getQueryableLayer(jlv?.layer);
    if (jlvQueryable) {
      return jlvQueryable as __esri.FeatureLayer;
    }

    try {
      const dsManager = DataSourceManager.getInstance();
      const ds: any = dsManager.getDataSource(dsId);

      if (ds?.getLayer) {
        const layer = await ds.getLayer();
        const queryableLayer = getQueryableLayer(layer);

        if (queryableLayer) {
          return queryableLayer as __esri.FeatureLayer;
        }
      }

      const queryableDsLayer = getQueryableLayer(ds?.layer);
      if (queryableDsLayer) {
        return queryableDsLayer as __esri.FeatureLayer;
      }

      const url: string | undefined = ds?.url || ds?.layer?.url;

      if (url) {
        const layers = jimuMapView.view.map.layers.toArray() as any[];

        const matchedLayer = layers
          .filter((ly: any) => ly?.url === url)
          .map((ly: any) => getQueryableLayer(ly))
          .find((ly: any) => !!ly);
        if (matchedLayer) {
          return matchedLayer as __esri.FeatureLayer;
        }
      }
    } catch (e) {

    }

    
    
    return null;
  };

  private resolveFeatureLayersFromUseDataSources = async (
    jimuMapView: JimuMapView,
  ): Promise<__esri.FeatureLayer[]> => {
    const raw =
      (this.props.useDataSources as any)?.asMutable?.() ??
      this.props.useDataSources ??
      [];
    const useDss = Array.isArray(raw) ? raw : [];

    const resolved: __esri.FeatureLayer[] = [];
    for (const useDs of useDss) {
      const fl = await this.resolveFeatureLayerFromDataSource(
        jimuMapView,
        useDs,
      );
      if (fl) resolved.push(fl);
    }
    return resolved;
  };

  private buildViloyatKeyToLayerIndex = async (): Promise<void> => {
    const layers = this.state.featureLayers?.length
      ? this.state.featureLayers
      : this.state.featureLayer
        ? [this.state.featureLayer]
        : [];

    const idx: Record<string, number> = {};

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      try {
        if (!layer?.fields || layer.fields.length === 0) {
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

        const res = await layer.queryFeatures(q);
        const features = res?.features ?? [];
        for (const f of features) {
          const a: any = f.attributes || {};
          const v = a?.viloyat;
          const key = this.makeRegionDistrictKey(v != null ? String(v) : null);
          if (key && idx[key] === undefined) idx[key] = i;
        }
      } catch (e) {
        
      }
    }

    this._viloyatKeyToLayerIndex = idx;
    
  };

  private getFeatureLayerForViloyat = (
    viloyat: string,
  ): __esri.FeatureLayer | undefined => {
    const layers = this.state.featureLayers?.length
      ? this.state.featureLayers
      : this.state.featureLayer
        ? [this.state.featureLayer]
        : [];
    if (!layers.length) return undefined;
    const key = this.makeRegionDistrictKey(viloyat);
    const idx = key ? this._viloyatKeyToLayerIndex[key] : undefined;
    return typeof idx === "number" ? layers[idx] : this.state.featureLayer;
  };

  ensureInitialization = () => {
    if (!this._isMounted) {

      return;
    }

    const { featureLayer, connectionStatus, mapConnectionAttempts } = this.state;

    

    if (
      featureLayer &&
      connectionStatus === "connected" &&
      !this.state.initialDataLoaded
    ) {
      
      this.setState({ loading: true });
      this.fetchFilterOptions();
    } else if (
      connectionStatus === "failed" &&
      mapConnectionAttempts === this.MAX_CONNECTION_ATTEMPTS
    ) {
      
      this.retryMapConnection();
    }
  };

  componentDidMount() {
    this._isMounted = true;
    this.setState({ connectionStatus: "connecting" });
    this.initializeTheme();
    this.refreshFiltersFromConfig();

    // Warm cold paths so the first field's index raster is not paying
    // TLS + FeatureLayer + projection engine startup on click.
    try {
      warmPolygonApiConnection();
      void getAgriVegetationIndicesLayer().catch(() => {
        /* best-effort */
      });
      void projection.load().catch(() => {
        /* best-effort */
      });
    } catch {
      /* ignore */
    }

    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.addEventListener(
      "languageChanged",
      this.handleAppLanguageChanged as EventListener,
    );

    // ✅ Listen to AgriFilter state
    document.addEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChanged as EventListener,
    );
    document.addEventListener(
      "agriGraff4TableSearchChanged",
      this.handleExternalTableSearchChanged as EventListener,
    );
    document.addEventListener(
      "agriGraff4TableRowSelected",
      this.handleExternalTableRowSelected as EventListener,
    );

    // Existing listeners
    document.addEventListener(
      "categoryFilterChanged",
      this.handleLandCategoryChange as EventListener,
    );
    document.addEventListener("mousedown", this.handleDocumentMouseDown);
    document.addEventListener(
      "kadastrFilterChanged",
      this.handleGeoFilterChanged as EventListener,
    );
    document.addEventListener(
      "resetAllFilters",
      this.handleResetAll as EventListener,
    );
    document.addEventListener(
      "graffDateIndexNavigate",
      this.handleDateIndexNavigate as EventListener,
    );

    this._onReset = () => {
      if (!this._isMounted) return;

      const fields = this.getConfiguredFilterFields();
      const blankLocal = fields.reduce(
        (acc, f) => {
          acc[f] = "";
          return acc;
        },
        {} as Record<string, string>,
      );
      const blankExternal = fields.reduce(
        (acc, f) => {
          acc[f] = "";
          return acc;
        },
        {} as Record<string, string>,
      );

      // ✅ include vh
      const blankRegional = {
        viloyat: "",
        tuman: "",
        yil: "",
        uzspace: "",
        vh: "",
      };

      this._allowClearOnce = true;

      this.setState(
        {
          localFilters: blankLocal,
          externalFilters: blankExternal,
          regionalFilters: blankRegional,
          vhUniqueids: null,
          records: [],
          currentPage: 1,
          loading: true,
          lastUpdateTimestamp: Date.now(),
          isProcessingExternalUpdate: false,
        },
        () => {
          if (this.state.connectionStatus === "connected") {
            this.applyMapFilters();
            this.fetchData();
          }
        },
      );
    };

    if (
      this.state.featureLayer &&
      !isMapImageOwnedLayer(this.state.featureLayer)
    ) {
      this.state.featureLayer.definitionExpression = "";
    }
    if (this.state.dataSource) {
      (this.state.dataSource as any).setDefinitionExpression?.("");
    }

    this.initializationTimer = setTimeout(() => {
      this.ensureInitialization();
    }, 3000);

    window.addEventListener("resize", this.updateGraphViewportSize);
    if (this.state.viewMode === "graph") {
      this.observeGraphViewport();
    }
  }

  componentDidUpdate(
    prevProps: AllWidgetProps<any>,
    prevState: AgriGraffWidgetState,
  ) {
    const { connectionStatus, mapConnectionAttempts } = this.state;
    const { useMapWidgetIds } = this.props;

    const shouldRetryConnection =
      connectionStatus === "connecting" &&
      useMapWidgetIds &&
      useMapWidgetIds.length > 0 &&
      !this.state.activeMapView &&
      mapConnectionAttempts !== prevState.mapConnectionAttempts &&
      mapConnectionAttempts < this.MAX_CONNECTION_ATTEMPTS;

    if (shouldRetryConnection) {
      if (this._retryTimeout) {
        clearTimeout(this._retryTimeout);
      }

      this._retryTimeout = setTimeout(() => {
        if (!this._isMounted) return;

        
        this.setState((prevState) => ({
          mapConnectionAttempts: prevState.mapConnectionAttempts + 1,
        }));
      }, 2000);
    } else if (
      connectionStatus === "connecting" &&
      mapConnectionAttempts >= this.MAX_CONNECTION_ATTEMPTS &&
      prevState.mapConnectionAttempts !== mapConnectionAttempts
    ) {

      this.setState({
        connectionStatus: "failed",
      });
    }

    if (this.props.config !== prevProps.config) {
      this.refreshFiltersFromConfig();
    }

    if (this.state.viewMode === "graph" && prevState.viewMode !== "graph") {
      this.observeGraphViewport();
    }

    const graphLayoutChanged =
      this.state.viewMode === "graph" &&
      (prevState.selectedIndices !== this.state.selectedIndices ||
        prevState.language !== this.state.language ||
        prevState.loadingVegetation !== this.state.loadingVegetation ||
        prevState.vegetationData !== this.state.vegetationData);

    if (
      this.state.viewMode === "graph" &&
      this.state.selectedMonth != null &&
      prevState.vegetationData !== this.state.vegetationData
    ) {
      const hasSelectedMonthData = (this.state.vegetationData || []).some(
        (row) =>
          new Date((row as any).raster_date).getMonth() ===
          this.state.selectedMonth,
      );
      if (!hasSelectedMonthData) {
        this.setState({
          selectedMonth: null,
          isMonthPickerOpen: false,
          chartTooltip: null,
          selectedNdviDate: null,
        });
      }
    }

    if (graphLayoutChanged) {
      this.scheduleGraphViewportRefresh();
    }

    if (
      this.state.viewMode === "graph" &&
      (prevState.graphViewportWidth !== this.state.graphViewportWidth ||
        prevState.graphViewportHeight !== this.state.graphViewportHeight)
    ) {
      this.scheduleGraphViewportRefresh();
    }

    if (
      prevState.viewMode !== "table" &&
      this.state.viewMode === "table" &&
      (this.state.searchText || "").trim()
    ) {
      this.runAutoSearch((this.state.searchText || "").trim());
    }

    // Regional timeseries refetch is owned by handleMasterFilterChanged /
    // switchToGraph — avoid a second overlapping fetch in componentDidUpdate.

    // Centralized here (instead of at every setState call site that can
    // change selectedNdviDate/selectedChartIndexKey — chart click, polygon
    // switch, deselect, filter change, etc.) so the bottom-left map
    // indicator always reflects whichever one actually won, regardless of
    // which code path caused it.
    if (
      prevState.selectedNdviDate !== this.state.selectedNdviDate ||
      prevState.selectedChartIndexKey !== this.state.selectedChartIndexKey ||
      prevState.vegetationData !== this.state.vegetationData ||
      prevState.selecteduniqueid !== this.state.selecteduniqueid ||
      prevState.polygonAvailableDates !== this.state.polygonAvailableDates
    ) {
      this.broadcastDateIndexSelection();
    }
  }

  componentWillUnmount() {
    this._isMounted = false;

    this.cancelVegetationImageOverlay();
    // Clear the bottom-left date/index indicator so it doesn't keep
    // showing stale info once this chart is gone.
    try {
      document.dispatchEvent(
        new CustomEvent("graffDateIndexSelectionChanged", {
          detail: {
            date: null,
            indexKey: null,
            value: null,
            availableDates: [],
            navigable: false,
          },
          bubbles: true,
        }),
      );
    } catch {
      /* ignore */
    }

    // Detach map click handler
    this.detachMapClick();

    document.removeEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.removeEventListener(
      "languageChanged",
      this.handleAppLanguageChanged as EventListener,
    );

    document.removeEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChanged as EventListener,
    );
    document.removeEventListener(
      "agriGraff4TableSearchChanged",
      this.handleExternalTableSearchChanged as EventListener,
    );
    document.removeEventListener(
      "agriGraff4TableRowSelected",
      this.handleExternalTableRowSelected as EventListener,
    );

    if (this._updateDebounceTimer) {
      clearTimeout(this._updateDebounceTimer);
      this._updateDebounceTimer = null;
    }

    document.removeEventListener(
      "kadastrFilterChanged",
      this.handleGeoFilterChanged as EventListener,
    );
    document.removeEventListener(
      "resetAllFilters",
      this.handleResetAll as EventListener,
    );
    document.removeEventListener(
      "graffDateIndexNavigate",
      this.handleDateIndexNavigate as EventListener,
    );
    document.removeEventListener(
      "categoryFilterChanged",
      this.handleLandCategoryChange as EventListener,
    );
    document.removeEventListener("mousedown", this.handleDocumentMouseDown);

    try {
      this._activeController?.abort();
    } catch {}
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);

    if (this.throttledFetchData && this.throttledFetchData.cancel) {
      this.throttledFetchData.cancel();
    }

    if (this.initializationTimer) {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = null;
    }

    if (this._retryTimeout) {
      clearTimeout(this._retryTimeout);
      this._retryTimeout = null;
    }

    window.removeEventListener("resize", this.updateGraphViewportSize);
    this.graphResizeObserver?.disconnect();
    this.graphResizeObserver = null;
    if (this._graphViewportRaf != null) {
      window.cancelAnimationFrame(this._graphViewportRaf);
      this._graphViewportRaf = null;
    }

    if (
      this.state.featureLayer &&
      !isMapImageOwnedLayer(this.state.featureLayer)
    ) {
      try {
        this.state.featureLayer.definitionExpression = "";
      } catch {}
    }
  }

  private initializeTheme = (): void => {
    const savedTheme =
      typeof window !== "undefined"
        ? window.localStorage?.getItem("agri_v11_app_theme")
        : null;
    const domTheme =
      typeof document !== "undefined"
        ? document.documentElement.getAttribute("data-theme")
        : null;

    let isDarkTheme = true;
    if (savedTheme !== null && savedTheme !== undefined) {
      isDarkTheme = savedTheme === "dark";
    } else if (domTheme === "light" || domTheme === "dark") {
      isDarkTheme = domTheme === "dark";
    }

    this.setState({ isDarkTheme });
  };

  private handleAppLanguageChanged = (event: Event): void => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent)?.detail || {};
    const raw = d.lang ?? d.language ?? d.code;
    const v = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!v) return;

    let next: AgriGraffDisplayLanguage = "ru";
    if (v === "ru" || v === "rus" || v === "russian") next = "ru";
    else if (
      v === "uz_lat" ||
      v === "uz-lat" ||
      v === "uz_latin" ||
      v === "uz-latin" ||
      v === "uz"
    )
      next = "uz_lat";
    else if (
      v === "uz_cyr" ||
      v === "uz-cyr" ||
      v === "uz_cyrl" ||
      v === "uz-cyrl" ||
      v === "uz_cyrillic" ||
      v === "uz-cyrillic" ||
      v === "cyrillic"
    )
      next = "uz_cyr";
    else return;

    if (next === this.state.language) return;
    this.setState({ language: next });
  };

  handleThemeChange = (event: CustomEvent<{ isDarkTheme?: boolean }> | Event): void => {
    if (!this._isMounted) return;

    const detail = (event as CustomEvent<{ isDarkTheme?: boolean }>)?.detail;
    if (detail && typeof detail.isDarkTheme === "boolean") {
      const { isDarkTheme } = detail;
      this.setState({ isDarkTheme });
      return;
    }

    // Fallback when event detail is absent/incomplete.
    this.initializeTheme();
  };

  onDataSourceCreated = (ds: DataSource) => {
    const qds = ds as QueriableDataSource;
    if (typeof qds.setListenSelection === "function") {
      qds.setListenSelection(false);
      
    }

    this.setState({ dataSource: qds, error: null }, () => {
      this.refreshFiltersFromConfig();
      if (this.state.connectionStatus === "connected") {
        this.setState({ loading: true });
        this.fetchFilterOptions();
      }
    });
  };

  // 📥 Centralized: DS change => single fetch
  onDataSourceInfoChange = (info: any) => {
    if (!this._isMounted) return;
    if (this.state.connectionStatus !== "connected") return;
    if (!info) return;

    if (!Array.isArray(info.records)) return;

    
    this.setState(
      {
        records: [],
        currentPage: 1,
        loading: true,
        error: null,
      },
      () => {
        this.fetchData();
      },
    );
  };

  fetchFilterOptions = (): Promise<void> => {
    if (this._filterOptionsPromise) return this._filterOptionsPromise;
    const run = this.fetchFilterOptionsOnce().finally(() => {
      if (this._filterOptionsPromise === run) this._filterOptionsPromise = null;
    });
    this._filterOptionsPromise = run;
    return run;
  };

  private fetchFilterOptionsOnce = async (): Promise<void> => {
    if (!this._isMounted) return;
    if (this.state.connectionStatus !== "connected") {

      return;
    }

    const configuredFields = this.getConfiguredFilterFields();
    if (configuredFields.length === 0) {
      this.setState({
        error:
          "Майдонлар танланмаган. Виджет созламаларида майдонларни танланг.",
        loading: false,
      });
      return;
    }

    // The default dashboard opens in graph mode. Table filter DISTINCT
    // values (one server query per configured field) and the first table
    // page are not used until the user opens "Jadval". Deferring them removes
    // the largest avoidable startup burst without changing map/chart data.
    if (this.state.viewMode === "graph") {
      this.setState({
        loadingFilters: false,
        loading: false,
        error: null,
        initialDataLoaded: true,
        loadingVegetation: !this.state.selecteduniqueid
          ? true
          : this.state.loadingVegetation,
      });
      if (this.initializationTimer) {
        clearTimeout(this.initializationTimer);
        this.initializationTimer = null;
      }
      if (!this.state.selecteduniqueid) this.fetchRegionalTimeseries();
      return;
    }

    try {
      this.setState({ loadingFilters: true });

      const { featureLayer } = this.state;
      if (!featureLayer) {
        this.setState({
          loadingFilters: false,
          error: "Маълумот манбаи мавжуд эмас",
        });
        return;
      }

      const results = await Promise.all(
        configuredFields.map((f) => this.getUniqueValues(f)),
      );

      if (!this._isMounted) return;

      const filterOptions = configuredFields.reduce(
        (acc, f, i) => {
          acc[f] = results[i] || [];
          return acc;
        },
        {} as Record<string, string[]>,
      );

      this.setState({
        filterOptions,
        loadingFilters: false,
        loading: false,
        error: null,
        initialDataLoaded: true,
      });

      if (this.initializationTimer) {
        clearTimeout(this.initializationTimer);
        this.initializationTimer = null;
      }

      this.fetchData();
      // The awaits above allow the user to switch from table to graph while
      // these requests are running. Widen the state again because TypeScript
      // still remembers the pre-await "table" narrowing from the early return.
      const currentState = this.state as AgriGraffWidgetState;
      if (currentState.viewMode === "graph" && !currentState.selecteduniqueid) {
        this.fetchRegionalTimeseries();
      }
    } catch (error: any) {
      if (!this._isMounted) return;

      this.setState({
        error: `Бошланғич маълумот юклана олмади: ${error.message || error}`,
        loadingFilters: false,
      });
    }
  };

  getUniqueValues = async (fieldName: string): Promise<string[]> => {
    const featureLayer = this.state.featureLayer;
    if (featureLayer) {
      try {
        const query = featureLayer.createQuery();
        query.where = '1=1';
        query.outFields = [fieldName];
        query.returnGeometry = false;
        query.returnDistinctValues = true;
        query.orderByFields = [fieldName];
        query.num = 1000;
        const result = await featureLayer.queryFeatures(query);
        const values = (result?.features || [])
          .map((feature) => feature.attributes?.[fieldName])
          .filter((value) => value != null && value !== '');
        return [...new Set(values)].sort();
      } catch {
        return [];
      }
    }
    const { dataSource } = this.state;

    if (!dataSource) return [];

    try {
      const q = {
        where: "1=1",
        outFields: [fieldName],
        // Keep DISTINCT and ORDER BY on the same field. The jimu DataSource
        // can otherwise merge its default object-id ordering, which is invalid
        // for PostgreSQL/SDE DISTINCT queries.
        orderByFields: [fieldName],
        pageSize: 1000,
        returnDistinctValues: true,
      };

      const queryResult = await dataSource.query(q);

      if (!queryResult || !queryResult.records) {
        return [];
      }

      const values = queryResult.records
        .map((record) => record.getData()?.[fieldName])
        .filter((value) => value != null && value !== "");

      return [...new Set(values)].sort();
    } catch (error) {

      return [];
    }
  };

  fetchData = async (opts?: { preservePage?: boolean }) => {
    if (!this._isMounted) return;
    if (this.state.connectionStatus !== "connected") {
      this._hasCompletedTableFetch = true;
      if (this.state.loading) this.setState({ loading: false });
      return;
    }
    // Table fetches only apply while the table view is active.
    if (this.state.viewMode !== "table") {
      if (this.state.loading) this.setState({ loading: false });
      return;
    }

    const preservePage = !!opts?.preservePage;
    const requestId = ++this._tableDataRequestId;
    const isStale = () =>
      !this._isMounted ||
      requestId !== this._tableDataRequestId ||
      this.state.viewMode !== "table";

    const configuredFields = this.getConfiguredFilterFields();
    if (configuredFields.length === 0) {
      this._hasCompletedTableFetch = true;
      this.setState({
        error:
          "Майдонлар танланмаган. Виджет созламаларида майдонларни танланг.",
        loading: false,
      });
      return;
    }

    // Default mode: do not fetch only when yil is missing — unless an active
    // farmer/ИНН search is driving the query, in which case results should
    // be found across all years so the list can show matching variants
    // before the user has narrowed anything down by year.
    const { yil } = this.state.regionalFilters;
    const { searchText: activeSearchText, isSearchActive: hasSearchActive } =
      this.state;
    const hasActiveSearch =
      hasSearchActive && Boolean(activeSearchText?.trim());
    if (!yil && !hasActiveSearch) {
      this._hasCompletedTableFetch = false;
      await this.applyMapFilters();
      if (isStale()) return;

      this.setState({
        loading: false,
        error: null,
        records: [],
        currentPage: 1,
        totalRecordCount: 0,
      });

      return;
    }

    const page = preservePage
      ? Math.max(1, Number(this.state.currentPage) || 1)
      : 1;

    // Show loader immediately so UI never flashes "no data" during query.
    this._hasCompletedTableFetch = false;
    this.setState({
      loading: true,
      error: null,
      records: [],
      currentPage: page,
    });

    try {
      const { featureLayer } = this.state;
      if (!featureLayer) {
        if (isStale()) return;
        this._hasCompletedTableFetch = true;
        this.setState({
          loading: false,
          error: "Қатлам мавжуд эмас (AgriGraff4 featureLayer).",
        });
        return;
      }

      const whereClause = this.buildWhereClause();

      const displayFields = this.getDisplayFields();
      const statusField = this.getStatusFieldNameForCurrentDate();
      const oidField = featureLayer.objectIdField || "objectid";
      const outFields = Array.from(
        new Set([
          ...configuredFields,
          ...displayFields,
          oidField,
          ...(statusField ? [statusField] : []),
        ]),
      );

      let totalCount = 0;
      try {
        const countQuery = featureLayer.createQuery();
        countQuery.where = whereClause;
        totalCount = Number(await featureLayer.queryFeatureCount(countQuery)) || 0;
      } catch {
        totalCount = 0;
      }
      if (isStale()) return;

      const totalPages = Math.max(1, Math.ceil(totalCount / this.RECORDS_PER_PAGE) || 1);
      const safePage = Math.min(page, totalPages);

      const q = featureLayer.createQuery();
      q.where = whereClause;
      q.outFields = outFields;
      q.returnGeometry = false;
      q.orderByFields = this.getTableOrderByFields();
      q.num = this.RECORDS_PER_PAGE;
      q.start = (safePage - 1) * this.RECORDS_PER_PAGE;

      const queryResult = await featureLayer.queryFeatures(q);
      if (isStale()) return;

      const features = queryResult?.features ?? [];
      const records: RecordData[] = features.map((ft) => {
        const a: any = ft.attributes || {};
        // Keep compatibility with existing code expecting `record.objectid`.
        return { ...a, objectid: a?.[oidField] ?? a?.objectid };
      });

      this._hasCompletedTableFetch = true;
      this.setState(
        {
          records,
          loading: false,
          error: null,
          currentPage: safePage,
          totalRecordCount: totalCount,
        },
        () => {
          /* Only pending scroll (map/search/initial pick) may jump pages.
             Lasting selecteduniqueid must NOT force page back — otherwise
             pagination after table selection always snaps to the selected row. */
          const pending = String(this._pendingScrollUniqueid || "").trim();
          if (!pending) return;
          if (
            this.state.records.some((record) =>
              this.recordMatchesUniqueid(record, pending),
            )
          ) {
            this.scheduleScrollSelectedRowIntoCenter();
            this._pendingScrollUniqueid = null;
            return;
          }
          void this.ensureSelectedRowVisible(pending);
        },
      );
    } catch (error: any) {
      if (isStale()) return;

      this._hasCompletedTableFetch = true;
      this.setState({
        error: error.message || "Күтүлмаган хатолик юз берди",
        loading: false,
      });
    }
  };

  private escapeArcGIS(value: string): string {
    return value.replace(/'/g, "''");
  }

  // ✅ Apply WHERE to both FeatureLayer and DataSource
  private async applyMapFilters(): Promise<void> {
    const { featureLayer, dataSource, spatialClickLayers } = this.state;
    if (!featureLayer && !dataSource) return;

    const where = this.buildWhereClause();

    try {
      // Keep layer definitionExpression consistent with the resolved (selected) viloyat layer.
      // NEVER for MapImage-owned sublayers: their tuman/turi definitionExpression is
      // owned by AgriLocalization's syncRegionYearLayerVisibility — overwriting it
      // forces a fresh export that briefly paints every district's fields.
      if (featureLayer && !isMapImageOwnedLayer(featureLayer)) {
        (featureLayer as any).definitionExpression = where;
      }

      (dataSource as any)?.setDefinitionExpression?.(where);
    } catch (e) {
      // non-fatal
    }

    // Agri_table_data has no geometry — mirror the same filter onto the
    // spatial polygon layer(s) actually rendered on the map, joined by uniqueid.
    //
    // Republic-wide (no viloyat picked yet) is excluded here on purpose:
    // queryAgriUniqueIdsForWhere pages through every matching row (up to 200
    // pages of 2000) to build the mirror IN-clause, and a bare "yil LIKE ..."
    // WHERE with no region scope can match the entire dataset for that year —
    // hundreds of sequential requests fired the moment the widget mounts,
    // which is exactly what was locking up the page on load. Matches the
    // same guard AgriLocalization already applies via buildWhereForLayer().
    if (spatialClickLayers?.length && this.state.regionalFilters.viloyat) {
      try {
        const spatialWhere =
          where === "" || where === "1=1"
            ? "1=1"
            : where === "1=0"
              ? "1=0"
              : buildSpatialJoinWhere(await queryAgriUniqueIdsForWhere(where));
        spatialClickLayers.forEach((sl) => {
          // Region-year MapImage sublayers are owned by AgriLocalization's
          // syncRegionYearLayerVisibility (tuman/turi text DE). A uniqueid
          // IN (...) rewrite blows past MapServer layerDefs length and
          // shows every district again on the next export / field click.
          if (isMapImageOwnedLayer(sl)) return;
          if (sl.definitionExpression !== spatialWhere) {
            sl.definitionExpression = spatialWhere;
          }
        });
      } catch {
        /* map visual sync is best-effort; data-side filtering is unaffected */
      }
    }
  }

  handleFilterChange = async (field: string, value: string) => {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;

    this.setState(
      (prevState) => ({
        localFilters: {
          ...prevState.localFilters,
          [field]: value,
        },
        loading: true,
      }),
      () => {
        this.throttledFetchData();
      },
    );
  };

  handleResetFilters = async () => {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;

    const fields = this.getConfiguredFilterFields();
    const blank = fields.reduce(
      (acc, f) => {
        acc[f] = "";
        return acc;
      },
      {} as Record<string, string>,
    );

    // ✅ include vh
    const blankRegional = {
      viloyat: "",
      tuman: "",
      yil: "",
      uzspace: "",
      vh: "",
    };

    this._allowClearOnce = true;

    this.setState(
      {
        localFilters: blank,
        externalFilters: blank,
        regionalFilters: blankRegional,
        vhUniqueids: null,
        loading: true,
        records: [],
        currentPage: 1,
        isProcessingExternalUpdate: false,
      },
      () => {
        this.applyMapFilters();
        this.throttledFetchData();
      },
    );
  };

  private handleRowClick = async (record: RecordData) => {
    AgriGraffWidget.graffLog("tableRow:click", {
      uniqueid: record?.uniqueid || null,
      objectid: record?.objectid ?? null,
      viloyat: this.state.regionalFilters?.viloyat || "",
      tuman: this.state.regionalFilters?.tuman || "",
      interactionEnabled: this.isRegionalInteractionEnabled(),
    });
    if (!this.isRegionalInteractionEnabled()) return;

    const { featureLayer, activeMapView, selecteduniqueid } = this.state;

    if (record?.uniqueid) {
      void this.copyUniqueIdToClipboard(String(record.uniqueid));
    }

    if (!record || !featureLayer || !activeMapView) {

      return;
    }

    // Extract uniqueid first
    const uniqueid = record.uniqueid || record.objectid?.toString();
    

    // 🔁 Toggle behavior: if the same polygon is already selected, clear selection instead.
    const currentClean = (selecteduniqueid || "").replace(/[{}]/g, "");
    const nextClean = (uniqueid || "").toString().replace(/[{}]/g, "");
    if (currentClean && nextClean && currentClean === nextClean) {
      

      // Clear highlight graphics only
      this.clearMapSelectionGraphics(activeMapView.view);

      const restoreExtent = this._extentBeforeTableSelection;
      this._extentBeforeTableSelection = null;
      if (restoreExtent) {
        try {
          await activeMapView.view.goTo(restoreExtent, {
            duration: 700,
            easing: "ease-in-out" as any,
          });
        } catch {
          /* navigation interruption is harmless */
        }
      }

      // AgriLocalization owns the spatial zoom-out after the polygonMode=false
      // event below. The Graff data source can be a non-spatial table, so it
      // must not attempt queryExtent here.

      // Only clear the row selection / graph data – keep regional filters intact
      this.cancelVegetationImageOverlay();
      this._polygonSelectionOrigin = null;
      this._selectionCommittedAt = 0;
      this.setState(
        {
          selecteduniqueid: "",
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          polygonAvailableDates: [],
          polygonImageError: null,
          vegetationError: null,
        },
        () => {
          // Restore normal regional filter when row selection is cleared.
          // MapImage-owned sublayers keep AgriLocalization's tuman/turi DE.
          try {
            const baseWhere = this.buildWhereClause();
            if (featureLayer && !isMapImageOwnedLayer(featureLayer)) {
              (featureLayer as any).definitionExpression = baseWhere || "1=0";
            }
            (this.state.dataSource as any)?.setDefinitionExpression?.(
              baseWhere || "1=0",
            );
          } catch {}
          try {
            document.dispatchEvent(
              new CustomEvent("widgetSelectionChanged", {
                detail: {
                  source: "AgriGraffWidget",
                  polygonMode: false,
                  timestamp: Date.now(),
                },
                bubbles: true,
              }),
            );
          } catch {}
          if (this.state.viewMode === "graph") {
            this.fetchRegionalTimeseries();
          }
        },
      );
      return;
    }

    try {
      this.setState({ loading: true }); // ❌ DON'T set selecteduniqueid here yet

      // Agri_table_data has no geometry — highlight/zoom must query the
      // spatial polygon layer(s), joined by uniqueid, not the external table.
      let results: __esri.FeatureSet | null = null;
      const spatialLayersForHighlight = this.getTableSpatialQueryCandidates();
      AgriGraffWidget.graffLog("tableRow:spatial-candidates", {
        count: spatialLayersForHighlight.length,
        layers: spatialLayersForHighlight.map((layer: any) => ({
          title: layer?.title || null,
          url: layer?.url || null,
          visible: layer?.visible !== false,
        })),
      });

      for (const spatialLayer of spatialLayersForHighlight) {
        const url = String((spatialLayer as any)?.url || "").trim();
        let queryLayer: __esri.FeatureLayer = spatialLayer;
        if (url) {
          let detached = this._detachedSpatialQueryLayers.get(url);
          if (!detached) {
            try {
              detached = await getDetachedQueryLayerFor(spatialLayer);
              if (detached) this._detachedSpatialQueryLayers.set(url, detached);
            } catch {
              detached = null as any;
            }
          }
          if (detached) queryLayer = detached;
        }
        const q = queryLayer.createQuery();
        q.outFields = ["*"];
        q.returnGeometry = true;

        if (record.uniqueid) {
          const variants = [
            record.uniqueid,
            record.uniqueid.replace(/[{}]/g, ""),
            `{${record.uniqueid.replace(/[{}]/g, "")}}`,
          ];
          for (const v of variants) {
            q.where = `uniqueid='${this.escapeArcGIS(v)}'`;
            try {
              results = await queryLayer.queryFeatures(q);
              if (results?.features?.length) break;
            } catch {}
          }
        }

        if (!results?.features?.length && record.objectid != null) {
          const oidField = queryLayer.objectIdField || "objectid";
          q.where = `${oidField}=${record.objectid}`;
          try {
            results = await queryLayer.queryFeatures(q);
          } catch {}
        }

        if (results?.features?.length) {
          AgriGraffWidget.graffLog("tableRow:geometry-found", {
            uniqueid: uniqueid || null,
            layer: (queryLayer as any)?.title || null,
            url: (queryLayer as any)?.url || null,
          });
          break;
        }
      }

      if (results?.features?.length) {
        const feature = results.features[0];
        if (!this._extentBeforeTableSelection && activeMapView.view.extent?.clone) {
          this._extentBeforeTableSelection = activeMapView.view.extent.clone();
        }
        // Same cyan outline-only highlight + zoom as AgriPopup map-click.
        await this.highlightFeature(feature, activeMapView);
      } else {
        AgriGraffWidget.graffLog("tableRow:geometry-NOT-found", {
          uniqueid: uniqueid || null,
          candidateCount: spatialLayersForHighlight.length,
        });
      }

      // ✅✅✅ KEY FIX: Set selecteduniqueid AFTER successful query
      // A different polygon is now selected — any raster overlay/date
      // selection from the previous one no longer applies.
      this.cancelVegetationImageOverlay();
      // Row-click selection is authoritative "now" — mark it so a
      // late-arriving stale external (AgriPopup) notification for an
      // earlier map click can't silently override it afterwards.
      this._lastAppliedPolygonClickedAt = Date.now();

      this._polygonSelectionOrigin = "table";
      this._selectionCommittedAt = Date.now();
      this.setState(
        {
          loading: false,
          selecteduniqueid: uniqueid,
          // Stay on the table when the user picks a row here; map highlight/
          // zoom still run above. Chart opens only via the Graph toggle
          // (or via AgriPopup map-click → syncExternalPolygonSelection).
          error: null,
          vegetationError: null,
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          polygonAvailableDates: [],
          polygonImageError: null,
        },
        () => {


          // Keep only the selected row polygon visible on the map layer.
          // MapImage-owned sublayers keep AgriLocalization's tuman/turi DE —
          // rewriting them forces an export that flashes other districts.
          try {
            const baseWhere = this.buildWhereClause();
            const uniqueClause = this.builduniqueidWhere(
              String(uniqueid || ""),
              "uniqueid",
            );
            const selectedWhere =
              baseWhere && baseWhere !== "1=0"
                ? `(${baseWhere}) AND ${uniqueClause}`
                : uniqueClause;
            if (featureLayer && !isMapImageOwnedLayer(featureLayer)) {
              (featureLayer as any).definitionExpression = selectedWhere || "1=0";
            }
            (this.state.dataSource as any)?.setDefinitionExpression?.(
              selectedWhere || "1=0",
            );
          } catch {}

          try {
            document.dispatchEvent(
              new CustomEvent("widgetSelectionChanged", {
                detail: {
                  source: "AgriGraffWidget",
                  polygonMode: true,
                  uniqueid: uniqueid || "",
                  timestamp: Date.now(),
                },
                bubbles: true,
              }),
            );
          } catch {}

          // Prefetch chart series + auto-select the latest date/raster for the
          // polygon (same default as map-click), even while staying on table.
          this.fetchVegetationData();
          void this.ensureSelectedRowVisible(uniqueid);
        },
      );
    } catch (err) {

      this.setState({
        loading: false,
        error: "Объектни танлаш амалга ошмади",
      });
    }
  };
  private filtersChanged(
    a: typeof this.state.regionalFilters,
    b: typeof this.state.regionalFilters,
  ) {
    return (
      a.viloyat !== b.viloyat ||
      a.tuman !== b.tuman ||
      a.yil !== b.yil ||
      a.uzspace !== b.uzspace ||
      JSON.stringify(a.turlar || []) !== JSON.stringify(b.turlar || []) ||
      a.vh !== b.vh
    ); // ✅ include vh
  }

  private handleGeoFilterChanged = (event: CustomEvent) => {
    if (!this._isMounted) return;
    const d = event?.detail || {};
    if (d.source !== "GeoFilter") return;

    const next = {
      viloyat: this.normalizeApos(d.viloyat ?? d.massivNom ?? ""),
      tuman: this.normalizeApos(d.tuman ?? d.tumanNomi ?? ""),
      yil: d.yil != null ? String(d.yil) : d.year != null ? String(d.year) : "",
      uzspace: this.normalizeApos(d.uzspace ?? d.category ?? ""),
      vh: this.normalizeApos(d.vh ?? ""), // ✅ accept vh if provided
    };

    if (this.filtersChanged(this.state.regionalFilters, next)) {
      this.setState(
        {
          regionalFilters: next,
          vhUniqueids: null, // GeoFilter does not send ndvi-status uniqueids; fallback to vh field in WHERE
          records: [],
          currentPage: 1,
          loading: true,
        },
        () => {
          this.throttledFetchData();
        },
      );
    }
  };

  private handleResetAll = () => {
    const cleared = { viloyat: "", tuman: "", yil: "", uzspace: "", vh: "" };
    if (this.filtersChanged(this.state.regionalFilters, cleared)) {
      this.setState(
        { regionalFilters: cleared, vhUniqueids: null },
        this.refetchDebounced,
      );
    }
  };

  private refetchDebounced = () => {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.refetchNow(), 150);
  };

  private refetchNow = () => {
    if (!this._isMounted || this.state.connectionStatus !== "connected") return;
    this.setState({ loading: true }, () => {
      this.fetchData();
    });
  };

  private buildApiUrlWithFilters(baseUrl: string): string {
    const p = new URLSearchParams();
    const { regionalFilters } = this.state;

    if (regionalFilters.viloyat) p.set("viloyat", regionalFilters.viloyat);
    if (regionalFilters.tuman) p.set("tuman", regionalFilters.tuman);
    if (regionalFilters.yil) p.set("yil", regionalFilters.yil);
    if (regionalFilters.uzspace) p.set("uzspace", regionalFilters.uzspace);
    if (regionalFilters.vh) p.set("vh", regionalFilters.vh); // ✅

    const qs = p.toString();
    return qs ? `${baseUrl}?${qs}` : baseUrl;
  }

  /** ✅ Category field resolver (prefer "turi" first) */
  private getCategoryFieldName(): string | null {
    const fl = this.state.featureLayer;
    if (!fl || !fl.fields) return null;

    const candidates = [
      "turi", // ✅ prefer this
      "tur",
      "toifa",
      "yer_toifa",
      "yertoifa",
      "uzspace",
      "land_category",
      "land_type",
      "category",
      "type",
      "class",
    ];

    const lower = fl.fields.map((f) => f.name.toLowerCase());
    for (const c of candidates) {
      const i = lower.indexOf(c.toLowerCase());
      if (i !== -1) return fl.fields[i].name;
    }
    return null;
  }

  /** ✅ VH field resolver */
  private getVhFieldName(): string | null {
    const fl = this.state.featureLayer;
    if (!fl || !fl.fields) return null;

    const candidates = ["vh", "VH", "Vh"];

    const lower = fl.fields.map((f) => f.name.toLowerCase());
    for (const c of candidates) {
      const i = lower.indexOf(c.toLowerCase());
      if (i !== -1) return fl.fields[i].name;
    }
    return null;
  }

  /** Polygon join field for VH uniqueid IN (...) clause (e.g. uniqueid); must match AgriFilter polygonJoinField */
  private getPolygonJoinFieldName(): string {
    const fl = this.state.featureLayer;
    if (!fl?.fields?.length) return "uniqueid";
    const lower = fl.fields.map((f) => f.name.toLowerCase());
    const idx = lower.indexOf("uniqueid");
    return idx !== -1 ? fl.fields[idx].name : "uniqueid";
  }

  /* ==================== GRAPH VIEW FUNCTIONS ==================== */

  /** Like Agrobank IndexDynamicsChart: keep previous series while refetching. */
  private beginGraphFetch = (): void => {
    const hadData = (this.state.vegetationData?.length || 0) > 0;
    if (!hadData) this._hasCompletedGraphFetch = false;
    if (!this.state.loadingVegetation) {
      this.setState({ loadingVegetation: true, vegetationError: null });
    } else {
      this.setState({ vegetationError: null });
    }
  };

  private applyGraphData = (
    nextData: ChartVegetationRow[],
    extra?: Partial<AgriGraffWidgetState>,
    options?: { animate?: boolean },
  ): void => {
    this._hasCompletedGraphFetch = true;
    const animate = options?.animate !== false;
    this.setState({
      vegetationData: nextData,
      loadingVegetation: false,
      vegetationError: null,
      ...(animate
        ? { chartAnimKey: (this.state.chartAnimKey || 0) + 1 }
        : {}),
      ...(extra || {}),
    } as any);
  };

  /** Fetch regional timeseries when no polygon is selected (uses viloyat, optional tuman, optional yil for date range). */
  private fetchRegionalTimeseries = async () => {
    // Polygon mode owns vegetationData — never start (or apply) a regional
    // overwrite while a uniqueid is selected. Do NOT touch
    // loadingVegetation / _hasCompletedGraphFetch here: that used to mark the
    // graph "complete + empty" while fetchVegetationData was still in flight,
    // flashing "Ma'lumot topilmadi" even though the popup already had indices.
    if (this.state.selecteduniqueid) {
      AgriGraffWidget.graffLog("fetchRegionalTimeseries:SKIP-polygon-selected", {
        uniqueid: this.state.selecteduniqueid,
      });
      return;
    }

    if (this.state.viewMode !== "graph") return;

    // Show loader only when there is no previous series (Agrobank morph style).
    this.beginGraphFetch();

    const { regionalFilters } = this.state;
    const filterSnapshot = {
      viloyat: String(regionalFilters?.viloyat || ""),
      tuman: String(regionalFilters?.tuman || ""),
      yil: String(regionalFilters?.yil || ""),
      turi: String(regionalFilters?.uzspace || ""),
      turlar: JSON.stringify(regionalFilters?.turlar || []),
      vh: String(regionalFilters?.vh || ""),
    };
    // Own this fetch immediately so overlapping calls invalidate each other
    // before the async region/district resolve — otherwise a later call can
    // be skipped as a "duplicate" of a request that then becomes stale and
    // leaves loadingVegetation stuck true.
    const requestId = ++this._regionalTimeseriesRequestId;
    this._regionalTimeseriesRequestKey = "";
    let requestKey = "";
    const isStale = () => {
      if (!this._isMounted) return true;
      if (this.state.viewMode !== "graph") return true;
      if (requestId !== this._regionalTimeseriesRequestId) {
        return true;
      }
      if (this.state.selecteduniqueid) return true;
      const current = this.state.regionalFilters;
      return (
        String(current?.viloyat || "") !== filterSnapshot.viloyat ||
        String(current?.tuman || "") !== filterSnapshot.tuman ||
        String(current?.yil || "") !== filterSnapshot.yil ||
        String(current?.uzspace || "") !== filterSnapshot.turi ||
        JSON.stringify(current?.turlar || []) !== filterSnapshot.turlar ||
        String(current?.vh || "") !== filterSnapshot.vh
      );
    };

    // Never hit vegetation with an open date window — that used to become
    // `1=1` + 16 AVGs and saturate the FeatureServer on cold start.
    const yearToken =
      String(filterSnapshot.yil).match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
    if (!yearToken) {
      AgriGraffWidget.graffLog("fetchRegionalTimeseries:SKIP-no-year", {
        yil: filterSnapshot.yil,
        requestId,
      });
      // Keep spinner until Localization broadcasts a year — do not flash empty.
      this.setState({
        loadingVegetation: true,
        vegetationError: null,
      });
      return;
    }

    try {
      await this.ensureRegionDistrictForSelection();
      if (isStale()) {
        AgriGraffWidget.graffLog("fetchRegionalTimeseries:SKIP-stale-after-ensure", {
          filterSnapshot,
          current: this.state.regionalFilters,
          requestId,
        });
        return;
      }

      // Re-read after the await — filters may have moved; prefer live state
      // only when it still matches the snapshot we started with.
      const effectiveViloyat = this.normalizeApos(filterSnapshot.viloyat);
      const vilKey = this.makeRegionDistrictKey(effectiveViloyat);
      const effectiveTuman = filterSnapshot.tuman
        ? this.normalizeApos(filterSnapshot.tuman)
        : "";
      const storedRegionCode =
        this.state.regionalRegionCode != null &&
        Number.isFinite(this.state.regionalRegionCode)
          ? this.state.regionalRegionCode
          : null;

      const mappedRegionFromName =
        /^\d+$/.test(effectiveViloyat) && effectiveViloyat
          ? Number(effectiveViloyat)
          : vilKey
            ? this._viloyatToRegion[vilKey]
            : undefined;
      // Prefer name→region mapping over cached regionalRegionCode — the
      // cache can briefly belong to the previous viloyat during rapid clicks.
      const regionNum =
        mappedRegionFromName !== undefined &&
        Number.isFinite(mappedRegionFromName)
          ? mappedRegionFromName
          : storedRegionCode ?? undefined;
      const districtNum = effectiveTuman
        ? this.state.regionalDistrictCode != null &&
          Number.isFinite(this.state.regionalDistrictCode)
          ? this.state.regionalDistrictCode
          : this.resolveDistrictNumber(
              effectiveViloyat,
              effectiveTuman,
              regionNum,
            )
        : undefined;
      const effectiveDistrictNum =
        filterSnapshot.tuman &&
        districtNum !== undefined &&
        Number.isFinite(districtNum)
          ? districtNum
          : undefined;

      // Fail closed. Silently omitting an unresolved geographic code would
      // display a republic/viloyat average under a narrower selection.
      const unresolvedScope =
        effectiveViloyat &&
        (regionNum === undefined || !Number.isFinite(regionNum))
          ? "region"
          : effectiveTuman && effectiveDistrictNum === undefined
            ? "district"
            : null;
      if (unresolvedScope) {
        this._regionalTimeseriesRequestKey = "";
        this._regionalTimeseriesAppliedKey = "";
        this._regionalTimeseriesLoadedAvgFields.clear();
        const { language } = this.state;
        const vegetationError =
          language === "en"
            ? unresolvedScope === "region"
              ? "Could not determine the selected region code."
              : "Could not determine the selected district code."
            : language === "ru"
            ? unresolvedScope === "region"
              ? "Не удалось определить код выбранной области."
              : "Не удалось определить код выбранного района."
            : language === "uz_lat"
              ? unresolvedScope === "region"
                ? "Tanlangan viloyat kodi aniqlanmadi."
                : "Tanlangan tuman kodi aniqlanmadi."
              : unresolvedScope === "region"
                ? "Танланган вилоят коди аниқланмади."
                : "Танланган туман коди аниқланмади.";
        AgriGraffWidget.graffLog("fetchRegionalTimeseries:SKIP-unresolved-scope", {
          viloyat: filterSnapshot.viloyat,
          tuman: filterSnapshot.tuman,
          unresolvedScope,
          resolvedRegionNum: regionNum,
          resolvedDistrictNum: effectiveDistrictNum,
          requestId,
        });
        this._hasCompletedGraphFetch = true;
        this.setState({
          vegetationData: [],
          loadingVegetation: false,
          vegetationError,
        });
        return;
      }

      const startDate = `${yearToken}-01-01`;
      const endDate = `${yearToken}-12-31`;

      const snapshotTurlar: string[] = JSON.parse(filterSnapshot.turlar || "[]");
      const selectedTurlar = snapshotTurlar.length
        ? snapshotTurlar
        : filterSnapshot.turi
          ? [filterSnapshot.turi]
          : [];
      const resolvedCropIds = selectedTurlar.map((crop) => {
        const key = this.makeRegionDistrictKey(this.normalizeApos(crop));
        return key ? this._turiToCropId[key] : undefined;
      });
      const unresolvedCrops = selectedTurlar.filter(
        (_crop, index) => !resolvedCropIds[index],
      );
      if (unresolvedCrops.length) {
        const vegetationError =
          this.state.language === "en"
            ? "Could not determine the selected crop code."
            : this.state.language === "ru"
              ? "Не удалось определить код выбранной культуры."
              : this.state.language === "uz_cyr"
                ? "Танланган экин коди аниқланмади."
                : "Tanlangan ekin kodi aniqlanmadi.";
        this._regionalTimeseriesRequestKey = "";
        this._regionalTimeseriesAppliedKey = "";
        this._regionalTimeseriesLoadedAvgFields.clear();
        this._hasCompletedGraphFetch = true;
        this.setState({
          vegetationData: [],
          loadingVegetation: false,
          vegetationError,
        });
        return;
      }
      const cropIds = Array.from(
        new Set(resolvedCropIds.filter((value): value is string => Boolean(value))),
      );
      const cropId = cropIds.length === 1 ? cropIds[0] : undefined;
      const turiKey = filterSnapshot.turi
        ? this.makeRegionDistrictKey(this.normalizeApos(filterSnapshot.turi))
        : "";

      // Geographic / filter scope only (not selected chart indices).
      requestKey = JSON.stringify({
        region: regionNum !== undefined && Number.isFinite(regionNum) ? regionNum : null,
        district: effectiveDistrictNum ?? null,
        cropIds: cropIds.slice().sort(),
        startDate: startDate || null,
        endDate: endDate || null,
        vh: filterSnapshot.vh || null,
        ndviStatus: VH_TO_NDVI_STATUS[filterSnapshot.vh] || null,
      });
      if (requestKey !== this._regionalTimeseriesAppliedKey) {
        // New geography/year/crop/VH — drop partial index cache for the old scope.
        this._regionalTimeseriesLoadedAvgFields.clear();
      }

      const isRepublicScope = !(
        regionNum !== undefined && Number.isFinite(regionNum)
      );
      const desiredRepublicFields: RepublicTimeseriesIndexField[] = Array.from(
        new Set(
          (this.state.selectedIndices || ["ndvi"])
            .map((key) => String(key).toLowerCase())
            .filter(isRepublicTimeseriesIndexField),
        ),
      );
      if (!desiredRepublicFields.length) {
        desiredRepublicFields.push("ndvi");
      }

      // Same resolved scope already showing — finish loading without refetch.
      // Republic: also require every currently selected index to be loaded
      // (SAVI/EVI toggles fetch only the missing columns).
      // Do NOT skip merely because another in-flight call shares this key:
      // that older call may still become stale and never clear the spinner.
      const republicFieldsReady =
        !isRepublicScope ||
        desiredRepublicFields.every((field) =>
          this._regionalTimeseriesLoadedAvgFields.has(field),
        );
      if (
        requestKey === this._regionalTimeseriesAppliedKey &&
        this.state.vegetationData.length > 0 &&
        !this.state.vegetationError &&
        republicFieldsReady
      ) {
        AgriGraffWidget.graffLog("fetchRegionalTimeseries:SKIP-already-applied", {
          requestKey,
          existingRowCount: this.state.vegetationData.length,
          isRepublicScope,
          desiredRepublicFields,
          loadedFields: Array.from(this._regionalTimeseriesLoadedAvgFields),
        });
        this._hasCompletedGraphFetch = true;
        this.setState({ loadingVegetation: false });
        return;
      }
      this._regionalTimeseriesRequestKey = requestKey;
      this.setState({ loadingVegetation: true, vegetationError: null });

      // Republic: only AVG the selected (still-missing) indices.
      // Viloyat/tuman: full outStatistics including min/max bands.
      const missingRepublicFields = desiredRepublicFields.filter(
        (field) => !this._regionalTimeseriesLoadedAvgFields.has(field),
      );
      const avgFields: string[] | undefined = isRepublicScope
        ? missingRepublicFields.length
          ? missingRepublicFields
          : desiredRepublicFields
        : undefined;
      const canAugmentExisting =
        isRepublicScope &&
        requestKey === this._regionalTimeseriesAppliedKey &&
        this._regionalTimeseriesLoadedAvgFields.size > 0 &&
        this.state.vegetationData.length > 0;

      AgriGraffWidget.graffLog("fetchRegionalTimeseries:request", {
        viloyat: filterSnapshot.viloyat,
        tuman: filterSnapshot.tuman,
        yil: filterSnapshot.yil,
        turi: filterSnapshot.turi,
        vh: filterSnapshot.vh,
        resolvedRegionNum: regionNum,
        resolvedDistrictNum: effectiveDistrictNum,
        resolvedCropId: cropId,
        turiKeyFoundInMap: turiKey ? turiKey in this._turiToCropId : null,
        vilKeyFoundInMap: vilKey ? vilKey in this._viloyatToRegion : null,
        isRepublicScope,
        desiredRepublicFields,
        avgFields: avgFields || "full",
        canAugmentExisting,
        requestId,
      });
      const ndviStatus = VH_TO_NDVI_STATUS[filterSnapshot.vh] || undefined;
      const queryCropIds = cropIds.length ? cropIds : [undefined];
      const responseGroups = await Promise.all(
        queryCropIds.map((selectedCropId) =>
          queryVegetationRegionalTimeseries({
            region:
              regionNum !== undefined && Number.isFinite(regionNum)
                ? regionNum
                : undefined,
            district: effectiveDistrictNum,
            cropId: selectedCropId,
            startDate,
            endDate,
            ndviStatus,
            avgFields,
          }) as Promise<RegionalTimeseriesRow[]>,
        ),
      );
      const data = mergeRegionalTimeseriesGroups(responseGroups);
      const rawRowCount = responseGroups.reduce(
        (total, rows) => total + rows.length,
        0,
      );
      const validNdviRows = data.filter((row) => Number.isFinite(Number(row.ndvi)));
      const ndviValues = validNdviRows.map((row) => Number(row.ndvi));
      const polygonCounts = validNdviRows.map(
        (row) => Number(row.polygon_count) || 0,
      );
      AgriGraffWidget.graffLog("fetchRegionalTimeseries:response", {
        rawRowCount,
        rowCount: data.length,
        duplicateDateRowsMerged: Math.max(0, rawRowCount - data.length),
        validNdviRowCount: validNdviRows.length,
        avgFields: avgFields || "full",
        ndviRange: ndviValues.length
          ? {
              min: Math.min(...ndviValues),
              max: Math.max(...ndviValues),
            }
          : null,
        polygonCountRange: polygonCounts.length
          ? {
              min: Math.min(...polygonCounts),
              max: Math.max(...polygonCounts),
            }
          : null,
        requestId,
        stale: isStale(),
      });
      if (isStale()) {
        AgriGraffWidget.graffLog("fetchRegionalTimeseries:SKIP-stale", {
          requestId,
          selecteduniqueid: this.state.selecteduniqueid,
          filterSnapshot,
          current: this.state.regionalFilters,
        });
        return;
      }
      const sorted = data
        .slice()
        .sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      const fetchedFields = avgFields?.length
        ? avgFields
        : [...REPUBLIC_TIMESERIES_INDEX_FIELDS];
      const chartRows: ChartVegetationRow[] = canAugmentExisting
        ? mergeRegionalTimeseriesFieldsIntoChart(
            this.state.vegetationData,
            sorted,
            fetchedFields,
          )
        : sorted.map((row) => ({
            ...row,
            raster_date: row.date,
          }));
      this._regionalTimeseriesAppliedKey = requestKey;
      if (isRepublicScope) {
        // First scope paint: mark requested fields even when empty (no rows).
        // Augment: only mark when the server returned rows — empty augment
        // must remain retryable (do not permanently skip a missing index).
        if (!canAugmentExisting || sorted.length > 0) {
          fetchedFields.forEach((field) => {
            if (isRepublicTimeseriesIndexField(field)) {
              this._regionalTimeseriesLoadedAvgFields.add(field);
            }
          });
        }
      } else {
        REPUBLIC_TIMESERIES_INDEX_FIELDS.forEach((field) => {
          this._regionalTimeseriesLoadedAvgFields.add(field);
        });
      }
      this.applyGraphData(chartRows, {
        dateRangeStartIndex: null,
        dateRangeEndIndex: null,
      });
    } catch (err: any) {
      AgriGraffWidget.graffLog("fetchRegionalTimeseries:FAILED", {
        error: String(err?.message || err),
      });
      if (isStale()) return;
      if (this._regionalTimeseriesRequestKey === requestKey) {
        this._regionalTimeseriesRequestKey = "";
      }
      this._regionalTimeseriesAppliedKey = "";
      this._regionalTimeseriesLoadedAvgFields.clear();
      this._hasCompletedGraphFetch = true;
      this.setState({
        vegetationData: [],
        loadingVegetation: false,
        vegetationError: err?.message || "Вилоят вақт қатори юклана олмади.",
      });
    }
  };

  private switchToTable = () => {
    if (this.state.viewMode === "table") return;
    // Drop any in-flight graph series so a late response cannot leave
    // loadingVegetation stuck / overwrite the next graph open.
    // Keep vegetationData so returning to graph can morph without a cold loader.
    this._vegetationDataRequestId++;
    this._regionalTimeseriesRequestId++;
    this._regionalTimeseriesRequestKey = "";
    this._hasCompletedTableFetch = false;
    this.setState(
      {
        viewMode: "table",
        vegetationError: null,
        loadingVegetation: false,
        loading: true,
        isMonthPickerOpen: false,
      },
      () => {
        if (this.state.viewMode !== "table") return;
        if (this.state.selecteduniqueid) {
          this._pendingScrollUniqueid = this.state.selecteduniqueid;
        }
        const hasFilterOptions = Object.keys(this.state.filterOptions || {}).length > 0;
        if (hasFilterOptions) this.fetchData();
        else this.fetchFilterOptions();
      },
    );
  };

  private switchToGraph = () => {
    if (this.state.viewMode === "graph") return;
    // Drop any in-flight table page so a late response cannot leave loading stuck.
    this._tableDataRequestId++;
    this._hasCompletedTableFetch = true;
    const hadData = (this.state.vegetationData?.length || 0) > 0;
    const canReusePolygonGraph =
      !!this.state.selecteduniqueid &&
      hadData &&
      !this.state.vegetationError;
    // Cold-start loader only when there is no previous series (Agrobank morph).
    if (!hadData) this._hasCompletedGraphFetch = false;
    this.setState(
      {
        viewMode: "graph",
        error: null,
        vegetationError: null,
        loading: false,
        // Keep previous series + selected date visible when data is already loaded.
        loadingVegetation: canReusePolygonGraph ? false : !hadData,
        isMonthPickerOpen: false,
      },
      () => {
        if (this.state.viewMode !== "graph") return;
        if (canReusePolygonGraph) {
          this._hasCompletedGraphFetch = true;
          const date = this.state.selectedNdviDate;
          const indexKey = (this.state.selectedChartIndexKey ||
            "ndvi") as VegetationIndiceType;
          if (date && this.state.selecteduniqueid) {
            void this.applyVegetationImageOverlay(
              this.state.selecteduniqueid,
              date,
              indexKey,
            );
          }
          return;
        }
        if (this.state.selecteduniqueid) {
          this.fetchVegetationData();
        } else {
          this.fetchRegionalTimeseries();
        }
      },
    );
  };

  private renderViewModeToggle = (activeMode: "table" | "graph") => {
    const { language } = this.state;
    const viewTableLabel =
      language === "en"
        ? "Table"
        : language === "ru"
          ? "Таблица"
          : language === "uz_lat"
            ? "Jadval"
            : "Жадвал";
    const viewGraphLabel =
      language === "en"
        ? "Chart"
        : language === "ru"
          ? "График"
          : language === "uz_lat"
            ? "Grafik"
            : "График";
    const groupLabel =
      language === "en"
        ? "View mode"
        : language === "ru"
          ? "Режим просмотра"
          : language === "uz_lat"
            ? "Ko‘rinish"
            : "Кўриниш";
    const isGraph = activeMode === "graph";

    return (
      <button
        type="button"
        className={`graff-view-toggle${isGraph ? " graff-view-toggle--graph" : ""}`}
        role="switch"
        aria-label={groupLabel}
        aria-checked={isGraph}
        title={isGraph ? viewGraphLabel : viewTableLabel}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isGraph) this.switchToTable();
          else this.switchToGraph();
        }}
      >
        <Table
          className="graff-view-toggle__icon graff-view-toggle__icon--table"
          strokeWidth={2}
          aria-hidden="true"
        />
        <ChartLine
          className="graff-view-toggle__icon graff-view-toggle__icon--graph"
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="graff-view-toggle__thumb" aria-hidden="true">
          {isGraph ? (
            <ChartLine size={13} strokeWidth={2} />
          ) : (
            <Table size={13} strokeWidth={2} />
          )}
        </span>
      </button>
    );
  };

  private renderGraphLegend = () => {
    const { selectedIndices, language } = this.state;
    const regionalInteraction = this.isRegionalInteractionEnabled();
    const indexButtons: Array<{
      key: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi";
      label: string;
      color: string;
    }> = [
      { key: "ndvi", label: "NDVI", color: "#00d084" },
      { key: "savi", label: "SAVI", color: "#7aa5ff" },
      { key: "rvi", label: "RVI", color: "#ffb347" },
      { key: "ci", label: "CI", color: "#c78bff" },
      { key: "evi", label: "EVI", color: "#ff4d8d" },
      { key: "ndwi", label: "NDWI", color: "#2ec4f1" },
    ];
    const allColor = "#DC2626";
    const isAllSelected = indexButtons.every((btn) =>
      selectedIndices.includes(btn.key),
    );
    const allLabel =
      language === "en"
        ? "All"
        : language === "ru"
          ? "Все"
          : language === "uz_lat"
            ? "Barchasi"
            : "Барчаси";

    return (
      <div
        className="index-buttons-horizontal"
        role="group"
        aria-label={
          language === "en"
            ? "Index indicators"
            : language === "ru"
              ? "Индекс показателей"
              : language === "uz_lat"
                ? "Index ko‘rsatkichlari"
                : "Индекс кўрсаткичлари"
        }
      >
        <button
          type="button"
          className={`index-btn-h${isAllSelected ? " active" : ""}`}
          disabled={!regionalInteraction}
          onClick={this.handleToggleAllIndices}
          style={{ "--legend-color": allColor } as React.CSSProperties}
          aria-pressed={isAllSelected}
        >
          <span
            className="index-btn-h-dot"
            style={{ opacity: isAllSelected ? 1 : 0.45 }}
          />
          <span className="index-btn-h-label">{allLabel}</span>
        </button>
        {indexButtons.map((btn) => {
          const isActive = selectedIndices.includes(btn.key);
          return (
            <button
              key={btn.key}
              type="button"
              className={`index-btn-h${isActive ? " active" : ""}`}
              disabled={!regionalInteraction}
              onClick={() => this.handleIndexChange(btn.key)}
              style={{ "--legend-color": btn.color } as React.CSSProperties}
              aria-pressed={isActive}
            >
              <span
                className="index-btn-h-dot"
                style={{ opacity: isActive ? 1 : 0.45 }}
              />
              <span className="index-btn-h-label">{btn.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  private renderGraphHeader = () => {
    const { language } = this.state;
    const indicatorLabel =
      language === "en"
        ? "Index Indicators"
        : language === "ru"
          ? "Индекс Показателей"
          : language === "uz_lat"
            ? "Index Ko'rsatkichlari"
            : "Индекс Кўрсаткичлари";

    return (
      <div className="graff-index-top">
        <div className="graff-index-top-label">
          <span>{indicatorLabel}</span>
        </div>
        {this.renderGraphLegend()}
        <div className="graff-index-top-right">
          {this.renderViewModeToggle("graph")}
        </div>
      </div>
    );
  };

  private wrapGraphFrame = (
    body: React.ReactNode,
    options?: { refreshLoading?: boolean },
  ) => (
    <div
      className={`vegetation-graph-container${
        options?.refreshLoading ? " vegetation-graph-container--loading" : ""
      }`}
    >
      {this.renderGraphHeader()}
      <div className="graff-graph-body">{body}</div>
      {options?.refreshLoading ? <AgriChartLoader /> : null}
    </div>
  );

  private toggleMonthPicker = () => {
    if (!this.isRegionalInteractionEnabled()) return;

    this.setState((prev) => {
      if (prev.isMonthPickerOpen) {
        return {
          isMonthPickerOpen: false,
          monthPickerPlacement: prev.monthPickerPlacement,
        };
      }
      return {
        isMonthPickerOpen: true,
        monthPickerPlacement: this.resolveMonthPickerPlacement(),
      };
    });
  };

  private resolveMonthPickerPlacement = (): "up" | "down" => {
    const pickerRoot = this.monthPickerRef.current;
    if (!pickerRoot || typeof window === "undefined") return "down";

    const button = pickerRoot.querySelector(
      ".graff-month-button",
    ) as HTMLElement | null;
    const anchorRect = (button || pickerRoot).getBoundingClientRect();

    // 4 visible rows (including "all months") + panel padding/border.
    const estimatedPanelHeight = 132;
    const gap = 6;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight;

    // Dropdown is clipped by the widget card (overflow hidden), so place it
    // based on room inside that container first, then viewport as fallback.
    const card = pickerRoot.closest(".kadastr-status-card") as
      | HTMLElement
      | null;
    const cardRect = card?.getBoundingClientRect();
    const lowerBound = cardRect
      ? Math.min(cardRect.bottom, viewportHeight)
      : viewportHeight;
    const upperBound = cardRect ? Math.max(cardRect.top, 0) : 0;

    const spaceBelow = lowerBound - anchorRect.bottom;
    const spaceAbove = anchorRect.top - upperBound;

    if (spaceBelow < estimatedPanelHeight + gap && spaceAbove > spaceBelow) {
      return "up";
    }
    return "down";
  };

  private handleMonthOptionClick = (month: number | null) => {
    if (!this.isRegionalInteractionEnabled()) return;

    this.setState(
      {
        selectedMonth: month,
        isMonthPickerOpen: false,
        chartTooltip: null,
        selectedNdviDate: null,
      },
      this.scheduleGraphViewportRefresh,
    );
  };

  /** Numeric region_id for the currently selected viloyat — same resolution as fetchRegionalTimeseries. */
  private resolveCurrentRegionId(): number | undefined {
    const { viloyat } = this.state.regionalFilters;
    const effectiveViloyat = this.normalizeApos(viloyat);
    const vilKey = this.makeRegionDistrictKey(effectiveViloyat);
    const storedRegionCode =
      this.state.regionalRegionCode != null &&
      Number.isFinite(this.state.regionalRegionCode)
        ? this.state.regionalRegionCode
        : null;

    // Prefer name→region mapping over cached regionalRegionCode — the cache
    // can briefly belong to the previous viloyat during rapid clicks, which
    // makes /available-dates return [] and blank the polygon chart.
    const mappedRegionFromName =
      /^\d+$/.test(effectiveViloyat) && effectiveViloyat
        ? Number(effectiveViloyat)
        : vilKey
          ? this._viloyatToRegion[vilKey]
          : undefined;
    const regionNum =
      mappedRegionFromName !== undefined &&
      Number.isFinite(mappedRegionFromName)
        ? mappedRegionFromName
        : storedRegionCode ?? undefined;

    return regionNum !== undefined && Number.isFinite(regionNum)
      ? regionNum
      : undefined;
  }

  /** Numeric year parsed from regionalFilters.yil. */
  private resolveCurrentYear(): number | undefined {
    const { yil } = this.state.regionalFilters;
    if (!yil) return undefined;
    const year = String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0];
    return year ? Number(year) : undefined;
  }

  /**
   * Tells the bottom-left map indicator (AgriDateIndexIndicator) which
   * date+index is currently selected on this chart, and its value — fired
   * from componentDidUpdate whenever selectedNdviDate/selectedChartIndexKey
   * change, for any reason (chart click, polygon switch/clear, deselect).
   */
  private broadcastDateIndexSelection = (): void => {
    const {
      selectedNdviDate,
      selectedChartIndexKey,
      vegetationData,
      language,
      selecteduniqueid,
      polygonAvailableDates,
    } = this.state;

    const navigable = Boolean(selecteduniqueid);
    const availableDates = navigable
      ? this.getNavigableDateIndexDates()
      : [];

    if (!selectedNdviDate || !selectedChartIndexKey) {
      AgriGraffWidget.graffLog('chartPoint:indicator-broadcast-clear', {
        selectedNdviDate: selectedNdviDate || null,
        selectedChartIndexKey: selectedChartIndexKey || null,
      });
      document.dispatchEvent(
        new CustomEvent("graffDateIndexSelectionChanged", {
          detail: {
            date: null,
            indexKey: null,
            value: null,
            language,
            availableDates: [],
            navigable: false,
          },
          bubbles: true,
        }),
      );
      return;
    }

    // vegetationData rows are shaped differently depending on mode: a
    // selected polygon's own series uses `raster_date` (VegetationIndex),
    // while the regional (no-polygon-selected) timeseries normalizes it to
    // `date` (RegionalTimeseriesRow) — checking only raster_date meant the
    // value always failed to resolve (silently showing "-") whenever a date
    // was clicked before any polygon was picked, on the initial regional
    // chart.
    const row = (vegetationData || []).find((r: any) => {
      const rawDate = r.raster_date ?? r.date;
      if (!rawDate) return false;
      const ymd =
        this.resolveAgainstAvailableDates(
          rawDate,
          polygonAvailableDates || [],
        ) || formatArcgisDateToYmd(rawDate);
      return ymd === selectedNdviDate;
    }) as any;
    const rawValue = row ? Number(row[selectedChartIndexKey]) : NaN;

    AgriGraffWidget.graffLog('chartPoint:indicator-broadcast', {
      date: selectedNdviDate,
      indexKey: selectedChartIndexKey,
      value: Number.isFinite(rawValue) ? rawValue : null,
      rowFound: Boolean(row),
      vegetationRowCount: vegetationData?.length || 0,
      availableDatesCount: availableDates.length,
      navigable,
    });

    document.dispatchEvent(
      new CustomEvent("graffDateIndexSelectionChanged", {
        detail: {
          date: selectedNdviDate,
          indexKey: selectedChartIndexKey,
          value: Number.isFinite(rawValue) ? rawValue : null,
          language,
          availableDates,
          navigable,
        },
        bubbles: true,
      }),
    );
  };

  /**
   * Sorted unique YYYY-MM-DD dates from the selected polygon's chart series
   * (prefers advertised /available-dates when present).
   */
  private getNavigableDateIndexDates = (): string[] => {
    const { vegetationData, polygonAvailableDates } = this.state;
    const advertised = polygonAvailableDates || [];
    const fromSeries = (vegetationData || [])
      .map((r: any) => {
        const rawDate = r.raster_date ?? r.date;
        if (!rawDate) return "";
        return (
          this.resolveAgainstAvailableDates(rawDate, advertised) ||
          formatArcgisDateToYmd(rawDate) ||
          ""
        );
      })
      .filter(Boolean);
    const unique = Array.from(new Set(fromSeries));
    unique.sort((a, b) => a.localeCompare(b));
    return unique;
  };

  /**
   * Day-step from AgriDateIndexIndicator chevrons — select prev/next date
   * for the current polygon + index and refresh the raster overlay.
   */
  private handleDateIndexNavigate = (event: Event): void => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent)?.detail || {};
    const {
      selecteduniqueid,
      selectedNdviDate,
      selectedChartIndexKey,
      vegetationData,
    } = this.state;

    if (!selecteduniqueid || !selectedNdviDate || !selectedChartIndexKey) {
      return;
    }

    const dates = this.getNavigableDateIndexDates();
    if (dates.length < 2) return;

    let nextDate = d.date ? String(d.date).trim() : "";
    if (!nextDate || !dates.includes(nextDate)) {
      const direction = Number(d.direction) === -1 ? -1 : 1;
      const idx = dates.indexOf(selectedNdviDate);
      if (idx < 0) return;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= dates.length) return;
      nextDate = dates[nextIdx];
    }

    if (nextDate === selectedNdviDate) return;

    const row = (vegetationData || []).find((r: any) => {
      const rawDate = r.raster_date ?? r.date;
      if (!rawDate) return false;
      const ymd =
        this.resolveAgainstAvailableDates(
          rawDate,
          this.state.polygonAvailableDates || [],
        ) || formatArcgisDateToYmd(rawDate);
      return ymd === nextDate;
    }) as any;
    const rawValue = row ? Number(row[selectedChartIndexKey]) : NaN;

    AgriGraffWidget.graffLog("chartPoint:indicator-navigate", {
      uniqueid: selecteduniqueid,
      from: selectedNdviDate,
      to: nextDate,
      indexKey: selectedChartIndexKey,
      value: Number.isFinite(rawValue) ? rawValue : null,
    });

    this.setState({
      selectedNdviDate: nextDate,
      chartTooltip: null,
    });

    this.applyVegetationImageOverlay(
      selecteduniqueid,
      nextDate,
      selectedChartIndexKey,
    );
  };

  /** Removes the current vegetation-index image overlay from the map, if any. */
  /** Fixed id stamped on every vegetation-image MediaLayer we add — lets
   * removeVegetationImageOverlay() find and remove ANY such layer still on
   * the map by id, not just whichever one this component instance happens
   * to still hold a reference to. Relying solely on _vegetationImageLayer
   * silently leaks an orphaned layer forever if this widget instance is
   * ever recreated (e.g. Experience Builder remounting it) between adding
   * one overlay and the next selection trying to remove it — the new
   * instance's _vegetationImageLayer starts back at null and has nothing
   * to remove, even though the old layer is still sitting on the map. */
  private static readonly VEGETATION_IMAGE_LAYER_ID =
    "agri-graff-vegetation-image-overlay";

  /** Drop map-surface + polygon-image loaders owned by a vegetation raster request. */
  private clearVegetationImageSurfaceLoading = (requestId: number): void => {
    if (requestId !== this._vegetationImageRequestId) return;
    if (this.state.polygonImageLoading) {
      this.setState({ polygonImageLoading: false });
    }
    document.dispatchEvent(
      new CustomEvent("agriMapSurfaceLoading", {
        detail: {
          loading: false,
          source: "AgriGraffWidget",
          requestId,
          reason: "vegetation-raster",
        },
      }),
    );
  };

  /**
   * Invalidate any in-flight export-image fetch, remove the overlay, and
   * always release the map loader. Use on deselect / polygon switch — not
   * inside applyVegetationImageOverlay while swapping the active layer.
   */
  private cancelVegetationImageOverlay = (): void => {
    const requestId = ++this._vegetationImageRequestId;
    this.removeVegetationImageOverlay();
    this.setState({ polygonImageLoading: false, polygonImageError: null });
    document.dispatchEvent(
      new CustomEvent("agriMapSurfaceLoading", {
        detail: {
          loading: false,
          source: "AgriGraffWidget",
          requestId,
          reason: "vegetation-raster-cancel",
        },
      }),
    );
  };

  private removeVegetationImageOverlay = (): void => {
    this.detachVegetationRasterHover();
    this._vegetationRasterSample = null;

    const map = this.state.activeMapView?.view?.map;
    if (map) {
      try {
        if (this._vegetationImageLayer) {
          map.remove(this._vegetationImageLayer);
        }
        // Defensive sweep: remove any other/orphaned overlay(s) sharing our
        // fixed id, regardless of whether this instance still references them.
        const stray = (map.layers?.toArray?.() || []).filter(
          (l: any) => l?.id === AgriGraffWidget.VEGETATION_IMAGE_LAYER_ID,
        );
        for (const l of stray) {
          try {
            map.remove(l);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
    this._vegetationImageLayer = null;
  };

  private ensureVegetationHoverTooltipEl = (): HTMLDivElement | null => {
    if (typeof document === "undefined") return null;
    if (this._vegetationHoverTooltipEl?.isConnected) {
      return this._vegetationHoverTooltipEl;
    }
    const el = document.createElement("div");
    el.className = "agri-graff-raster-hover-tooltip";
    el.setAttribute("role", "tooltip");
    el.innerHTML = `
      <div class="agri-graff-raster-hover-tooltip__card">
        <span class="agri-graff-raster-hover-tooltip__label"></span>
        <span class="agri-graff-raster-hover-tooltip__value"></span>
      </div>
      <span class="agri-graff-raster-hover-tooltip__caret" aria-hidden="true"></span>
    `;
    document.body.appendChild(el);
    this._vegetationHoverTooltipEl = el;
    return el;
  };

  private static readonly INDEX_COLORS: Record<string, string> = {
    ndvi: "#00d084",
    savi: "#7aa5ff",
    rvi: "#ffb347",
    ci: "#c78bff",
    evi: "#ff4d8d",
    ndwi: "#2ec4f1",
  };

  private getIndexDisplayColor = (indexKey?: string | null): string => {
    const key = String(indexKey || "ndvi").toLowerCase();
    return AgriGraffWidget.INDEX_COLORS[key] || "#00d084";
  };

  private updateVegetationHoverTooltip = (
    value: number,
    clientX: number,
    clientY: number,
  ): void => {
    const tooltip = this.ensureVegetationHoverTooltipEl();
    if (!tooltip) return;

    const rawKey = String(this.state.selectedChartIndexKey || "ndvi");
    const indexKey = rawKey.toUpperCase();
    const indexColor = this.getIndexDisplayColor(rawKey);
    const labelEl = tooltip.querySelector(
      ".agri-graff-raster-hover-tooltip__label",
    ) as HTMLElement | null;
    const valueEl = tooltip.querySelector(
      ".agri-graff-raster-hover-tooltip__value",
    ) as HTMLElement | null;
    if (labelEl) {
      labelEl.textContent = indexKey;
      labelEl.style.color = indexColor;
    }
    if (valueEl) {
      valueEl.textContent = value.toFixed(2);
      valueEl.style.color = indexColor;
    }

    tooltip.style.left = `${clientX}px`;
    tooltip.style.top = `${clientY}px`;
    tooltip.classList.add("is-visible");
  };

  private hideVegetationHoverTooltip = (): void => {
    if (this._vegetationHoverTooltipEl) {
      this._vegetationHoverTooltipEl.classList.remove("is-visible");
    }
  };

  private detachVegetationRasterHover = (): void => {
    try {
      this._vegetationHoverHandle?.remove?.();
    } catch {
      /* ignore */
    }
    try {
      this._vegetationHoverLeaveHandle?.remove?.();
    } catch {
      /* ignore */
    }
    this._vegetationHoverHandle = null;
    this._vegetationHoverLeaveHandle = null;
    this.hideVegetationHoverTooltip();
    if (this._vegetationHoverTooltipEl?.parentNode) {
      try {
        this._vegetationHoverTooltipEl.parentNode.removeChild(
          this._vegetationHoverTooltipEl,
        );
      } catch {
        /* ignore */
      }
    }
    this._vegetationHoverTooltipEl = null;
  };

  private sampleVegetationRasterValue = (
    mapPoint: __esri.Point,
  ): number | null => {
    const sample = this._vegetationRasterSample;
    if (!sample?.values?.length || !mapPoint) return null;

    const x = mapPoint.x;
    const y = mapPoint.y;
    const { xmin, ymin, xmax, ymax, width, height, values } = sample;
    if (x < xmin || x > xmax || y < ymin || y > ymax) return null;

    const col = Math.floor(((x - xmin) / (xmax - xmin)) * width);
    // GeoTIFF rows start at the top (ymax).
    const row = Math.floor(((ymax - y) / (ymax - ymin)) * height);
    if (col < 0 || col >= width || row < 0 || row >= height) return null;

    const v = values[row * width + col];
    if (!Number.isFinite(v)) return null;
    return v;
  };

  private attachVegetationRasterHover = (
    view: __esri.MapView | __esri.SceneView,
  ): void => {
    this.detachVegetationRasterHover();
    if (!this._vegetationRasterSample) return;

    const tooltip = this.ensureVegetationHoverTooltipEl();
    if (!tooltip) return;

    this._vegetationHoverHandle = view.on("pointer-move", (event: any) => {
      if (!this._vegetationRasterSample || !this._isMounted) {
        this.hideVegetationHoverTooltip();
        return;
      }
      try {
        const mapPoint = view.toMap({ x: event.x, y: event.y });
        if (!mapPoint) {
          this.hideVegetationHoverTooltip();
          return;
        }
        const value = this.sampleVegetationRasterValue(mapPoint);
        if (value == null) {
          this.hideVegetationHoverTooltip();
          return;
        }
        const screen = view.toScreen(mapPoint);
        const rect = view.container?.getBoundingClientRect?.();
        if (!screen || !rect) {
          this.hideVegetationHoverTooltip();
          return;
        }
        this.updateVegetationHoverTooltip(
          value,
          rect.left + screen.x,
          rect.top + screen.y,
        );
      } catch {
        this.hideVegetationHoverTooltip();
      }
    });

    this._vegetationHoverLeaveHandle = view.on("pointer-leave", () => {
      this.hideVegetationHoverTooltip();
    });
  };

  /**
   * Fetches + decodes the export-image raster (api-agri, response_format=tiff)
   * for the selected polygon+date and overlays it on the map. A GeoTIFF
   * carries its own extent + CRS in its tags (read in
   * fetchPolygonExportImageTiff via geotiff.js), so the overlay is
   * positioned directly from that — no separate polygon-geometry lookup
   * needed for placement.
   */
  private applyVegetationImageOverlay = async (
    uniqueid: string,
    rasterDate: string,
    indiceType: VegetationIndiceType = "ndvi",
  ): Promise<void> => {
    const { activeMapView } = this.state;
    if (!activeMapView?.view?.map) return;

    const regionId = this.resolveCurrentRegionId();
    if (regionId === undefined) {
      AgriGraffWidget.graffLog("applyVegetationImageOverlay:SKIP-no-region", {
        uniqueid,
        rasterDate,
      });
      this.cancelVegetationImageOverlay();
      this.setState({
        polygonImageError:
          "Viloyat kodi topilmadi — indeks rasmini yuklab bo‘lmadi.",
      });
      return;
    }

    // Bumping requestId orphans any previous in-flight finally cleanup — every
    // exit path below MUST clear the map surface loader while still current.
    const requestId = ++this._vegetationImageRequestId;
    const cleanId = uniqueid.replace(/[{}]/g, "");
    const advertisedDates = this.state.polygonAvailableDates || [];
    const normalizedDate =
      this.resolveAgainstAvailableDates(rasterDate, advertisedDates) ||
      String(rasterDate || "").slice(0, 10);
    const rasterKey = `${cleanId}|${regionId}|${normalizedDate}|${indiceType}`;

    AgriGraffWidget.graffLog("chartPoint:raster-overlay-start", {
      requestId,
      uniqueid: cleanId,
      regionId,
      requestedDate: rasterDate,
      normalizedDate,
      indiceType,
      advertisedDateCount: advertisedDates.length,
      currentSelecteduniqueid: this.state.selecteduniqueid,
    });

    // The requestId counter alone only catches a NEWER applyVegetationImageOverlay
    // call superseding an older one — it says nothing about whether the
    // polygon this fetch was FOR is still even selected. Checking
    // selecteduniqueid directly closes that gap.
    const stillCurrent = (): boolean => {
      if (!this._isMounted || requestId !== this._vegetationImageRequestId)
        return false;
      const currentClean = (this.state.selecteduniqueid || "").replace(
        /[{}]/g,
        "",
      );
      return currentClean === cleanId;
    };

    try {
      // Avoid requests for dates the polygon pipeline never produced.
      if (
        advertisedDates.length > 0 &&
        !advertisedDates.includes(normalizedDate)
      ) {
        this.removeVegetationImageOverlay();
        this.setState({ polygonImageLoading: false, polygonImageError: null });
        AgriGraffWidget.graffLog(
          "applyVegetationImageOverlay:SKIP-unavailable-date",
          {
            uniqueid: cleanId,
            rasterDate: normalizedDate,
            requestedDate: String(rasterDate || "").slice(0, 10),
            indiceType,
          },
        );
        return;
      }

      // available-dates is not index-specific. Cache index/date combinations
      // which export-image has explicitly confirmed as missing.
      if (this._missingVegetationRasterKeys.has(rasterKey)) {
        this.removeVegetationImageOverlay();
        this.setState({ polygonImageLoading: false, polygonImageError: null });
        AgriGraffWidget.graffLog(
          "applyVegetationImageOverlay:SKIP-known-missing",
          {
            uniqueid: cleanId,
            rasterDate: normalizedDate,
            indiceType,
          },
        );
        return;
      }

      // Do NOT flip the full-map surface loader for rasters — that blur/scale
      // made the first field click feel "stretched" for the whole wait.
      // Chart already painted; overlay arrives when the TIFF is ready.
      this.setState({ polygonImageLoading: true, polygonImageError: null });

      AgriGraffWidget.graffLog("chartPoint:raster-api-request", {
        requestId,
        uniqueid: cleanId,
        regionId,
        rasterDate: normalizedDate,
        indiceType,
      });
      const result = await fetchPolygonExportImageTiff({
        uniqueid: cleanId,
        regionId,
        rasterDate: normalizedDate,
        indiceType,
        stretch: "minmax",
      });

      AgriGraffWidget.graffLog("chartPoint:raster-api-response", {
        requestId,
        uniqueid: cleanId,
        rasterDate: normalizedDate,
        indiceType,
        width: result.width,
        height: result.height,
        bbox: result.bbox,
        epsgCode: result.epsgCode,
        stillCurrent: stillCurrent(),
      });

      if (!stillCurrent()) {
        AgriGraffWidget.graffLog(
          "applyVegetationImageOverlay:SKIP-stale-selection",
          {
            uniqueid: cleanId,
            rasterDate,
            currentSelecteduniqueid: this.state.selecteduniqueid,
          },
        );
        return;
      }

      const [minX, minY, maxX, maxY] = result.bbox;
      if (
        ![minX, minY, maxX, maxY].every((n) => Number.isFinite(n)) ||
        !(maxX > minX) ||
        !(maxY > minY) ||
        !(result.width > 0) ||
        !(result.height > 0)
      ) {
        throw new Error("GeoTIFF georeference/bbox invalid");
      }

      // Never treat projected-metre coords as the view SR (Web Mercator) —
      // that misplaces/stretches the MediaLayer until it looks broken.
      const absMax = Math.max(
        Math.abs(minX),
        Math.abs(minY),
        Math.abs(maxX),
        Math.abs(maxY),
      );
      let epsgCode = result.epsgCode;
      if (
        (epsgCode == null || !Number.isFinite(epsgCode)) &&
        absMax <= 180
      ) {
        epsgCode = 4326;
      }
      if (epsgCode == null || !Number.isFinite(epsgCode)) {
        throw new Error(
          "GeoTIFF CRS (EPSG) topilmadi — indeks rasmini joylashtirib bo‘lmadi.",
        );
      }

      const nativeSr = new SpatialReference({ wkid: Number(epsgCode) });
      let overlayExtent = new Extent({
        xmin: minX,
        ymin: minY,
        xmax: maxX,
        ymax: maxY,
        spatialReference: nativeSr,
      });

      // MediaLayer stretches linearly in the view SR. Project first so small
      // field rasters keep a stable aspect instead of being warped through
      // on-the-fly reprojection of native CRS corners.
      const viewSr = activeMapView.view.spatialReference;
      if (
        viewSr?.wkid &&
        Number(viewSr.wkid) !== Number(nativeSr.wkid)
      ) {
        try {
          await projection.load();
          const projected = projection.project(
            overlayExtent,
            viewSr,
          ) as __esri.Extent;
          if (
            projected &&
            Number.isFinite(projected.xmin) &&
            Number.isFinite(projected.ymin) &&
            projected.xmax > projected.xmin &&
            projected.ymax > projected.ymin
          ) {
            overlayExtent = projected;
          }
        } catch {
          /* keep native extent; ArcGIS may still reproject */
        }
      }

      const imageElement = new ImageElement({
        image: result.canvas,
        georeference: new ExtentAndRotationGeoreference({
          extent: overlayExtent,
        }),
      });

      this.removeVegetationImageOverlay();

      const mediaLayer = new MediaLayer({
        id: AgriGraffWidget.VEGETATION_IMAGE_LAYER_ID,
        source: [imageElement],
        title: `Vegetation ${indiceType.toUpperCase()} ${normalizedDate}`,
        opacity: 0.85,
      });
      activeMapView.view.map.add(mediaLayer);
      this._vegetationImageLayer = mediaLayer;

      // Attach as soon as the layer is on the map — do not wait up to 2.5s for
      // layerView.updating (first MediaLayer often stays "updating" longer).
      try {
        void mediaLayer.load();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      } catch {
        /* draw can finish without load() acknowledgement */
      }

      if (!stillCurrent()) {
        this.removeVegetationImageOverlay();
        return;
      }

      if (
        result.values &&
        result.values.length === result.width * result.height
      ) {
        this._vegetationRasterSample = {
          values: result.values,
          width: result.width,
          height: result.height,
          xmin: overlayExtent.xmin,
          ymin: overlayExtent.ymin,
          xmax: overlayExtent.xmax,
          ymax: overlayExtent.ymax,
          spatialReference: overlayExtent.spatialReference || viewSr || nativeSr,
        };
        this.attachVegetationRasterHover(activeMapView.view);
      } else {
        this._vegetationRasterSample = null;
      }

      this.setState({ polygonImageLoading: false, polygonImageError: null });

      AgriGraffWidget.graffLog("applyVegetationImageOverlay:added", {
        uniqueid: cleanId,
        rasterDate: normalizedDate,
        indiceType,
        width: result.width,
        height: result.height,
        bbox: result.bbox,
        epsgCode,
        overlayWkId: overlayExtent.spatialReference?.wkid ?? null,
        hasHoverValues: Boolean(result.values),
      });
    } catch (err: any) {
      if (!stillCurrent()) return;
      if (
        Number(err?.status) === 404 ||
        /HTTP\s+404/i.test(String(err?.message || err))
      ) {
        this._missingVegetationRasterKeys.add(rasterKey);
        this.removeVegetationImageOverlay();
      }
      AgriGraffWidget.graffLog("applyVegetationImageOverlay:FAILED", {
        uniqueid,
        rasterDate: normalizedDate,
        indiceType,
        status: err?.status ?? null,
        statusText: err?.statusText || null,
        contentType: err?.contentType || null,
        responseText: err?.responseText || null,
        responseUrl: err?.url || null,
        error: String(err?.message || err),
      });
      this.setState({
        polygonImageLoading: false,
        polygonImageError: err?.message || "Расм юклана олмади",
      });
    } finally {
      // Clears orphaned loaders from early skips that bumped requestId, and
      // always releases the surface loader for the active request.
      this.clearVegetationImageSurfaceLoading(requestId);
    }
  };

  /**
   * Sort polygon vegetation rows and pick the chart's selected date/index.
   * When `availableDates` is non-empty, stamp API-canonical YMD on each row.
   */
  private preparePolygonGraphSeries = (
    rows: VegetationIndex[],
    availableDates: string[],
  ): {
    sorted: VegetationIndex[];
    nextDate: string | null;
    nextIndexKey: VegetationIndiceType | null;
    fingerprint: string;
  } => {
    const dates = availableDates || [];
    const sorted = rows
      .slice()
      .sort(
        (a, b) =>
          new Date(a.raster_date).getTime() - new Date(b.raster_date).getTime(),
      );
    if (!sorted.length) {
      return {
        sorted,
        nextDate: null,
        nextIndexKey: null,
        fingerprint: "",
      };
    }

    const lastRow = sorted[sorted.length - 1];
    const lastDate =
      this.resolveAgainstAvailableDates(lastRow.raster_date, dates) ||
      this.formatLocalDateYmd(new Date(lastRow.raster_date)) ||
      String(lastRow.raster_date || "").slice(0, 10);
    const indexKey = (this.state.selectedIndices?.[0] ||
      "ndvi") as VegetationIndiceType;

    // Prefer the date already chosen (chart click / NDVI chevrons).
    const existingDate = (this.state.selectedNdviDate || "").trim();
    const dateStillAvailable = existingDate
      ? sorted.some((row) => {
          const ymd =
            this.resolveAgainstAvailableDates(row.raster_date, dates) ||
            this.formatLocalDateYmd(new Date(row.raster_date)) ||
            String(row.raster_date || "").slice(0, 10);
          return ymd === existingDate;
        })
      : false;
    const nextDate = dateStillAvailable ? existingDate : lastDate || null;
    const existingIndexKey = this.state.selectedChartIndexKey;
    const selectedIndices = this.state.selectedIndices || [];
    const nextIndexKey = (nextDate
      ? existingIndexKey && selectedIndices.includes(existingIndexKey)
        ? existingIndexKey
        : indexKey
      : null) as VegetationIndiceType | null;

    const fingerprint = sorted
      .map(
        (row) =>
          this.resolveAgainstAvailableDates(row.raster_date, dates) ||
          this.formatLocalDateYmd(new Date(row.raster_date)) ||
          String(row.raster_date || "").slice(0, 10),
      )
      .join("|");

    return { sorted, nextDate, nextIndexKey, fingerprint };
  };

  private fetchVegetationData = async () => {
    const { selecteduniqueid } = this.state;

    if (!selecteduniqueid) {
      this._hasCompletedGraphFetch = true;
      this.setState({
        vegetationError:
          "Полигон танланмаган. Аввал жадвалдаги қатор ёки харитадаги полигонни босинг.",
        loadingVegetation: false,
      });
      return;
    }

    const requestId = ++this._vegetationDataRequestId;
    // Invalidate any in-flight regional chart fetch so its later response
    // cannot clobber this polygon's available-dates-filtered series.
    this._regionalTimeseriesRequestId++;
    // Polygon series replaces regional data — never SKIP-already-applied
    // with stale regional keys after the polygon chart is cleared.
    this._regionalTimeseriesRequestKey = "";
    this._regionalTimeseriesAppliedKey = "";
    this._regionalTimeseriesLoadedAvgFields.clear();
    // Allow completion in table mode too — row selection must still auto-pick
    // the latest date and apply the polygon raster overlay. Switch-to-table
    // already bumps _vegetationDataRequestId to cancel in-flight work.
    const isStale = () =>
      !this._isMounted || requestId !== this._vegetationDataRequestId;

    try {
      this.beginGraphFetch();

      const cleanId = selecteduniqueid.replace(/[{}]/g, "");
      const regionId = this.resolveCurrentRegionId();
      const year = this.resolveCurrentYear();
      const availableDatesAttempted =
        regionId !== undefined && year !== undefined;
      AgriGraffWidget.graffLog("fetchVegetationData:request", {
        uniqueid: cleanId,
        regionId,
        year,
        progressive: true,
      });

      // ── Phase 1: ArcGIS series only — unblock Index chart ASAP ──────────
      // Do NOT await /available-dates here. That REST call used to gate the
      // whole loader even when FeatureServer rows were already in hand.
      const data = (await queryVegetationSeriesForUniqueId(
        cleanId,
      )) as VegetationIndex[];

      AgriGraffWidget.graffLog("fetchVegetationData:series-response", {
        uniqueid: cleanId,
        rowCount: data.length,
        requestId,
      });

      if (isStale()) return;

      if (!data.length) {
        this.cancelVegetationImageOverlay();
        this.applyGraphData([], {
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          polygonAvailableDates: [],
        });
        return;
      }

      const firstPass = this.preparePolygonGraphSeries(data, []);
      let paintedDate = firstPass.nextDate;
      let paintedIndex = firstPass.nextIndexKey;
      let paintedFingerprint = firstPass.fingerprint;

      // Kick TIFF download/decode before React paints the chart so the first
      // field click overlaps network with chart render (shared cache promise).
      if (
        !isStale() &&
        paintedDate &&
        paintedIndex &&
        regionId !== undefined
      ) {
        void fetchPolygonExportImageTiff({
          uniqueid: cleanId,
          regionId,
          rasterDate: paintedDate,
          indiceType: paintedIndex,
          stretch: "minmax",
        }).catch(() => {
          /* applyVegetationImageOverlay handles errors */
        });
      }

      this.applyGraphData(firstPass.sorted, {
        dateRangeStartIndex: null,
        dateRangeEndIndex: null,
        selectedNdviDate: firstPass.nextDate,
        selectedChartIndexKey: firstPass.nextIndexKey,
      });

      if (
        !isStale() &&
        paintedDate &&
        paintedIndex &&
        this.state.selecteduniqueid
      ) {
        void this.applyVegetationImageOverlay(
          this.state.selecteduniqueid,
          paintedDate,
          paintedIndex,
        );
      }

      // ── Phase 2: available-dates refine (non-blocking for first paint) ──
      if (!availableDatesAttempted) return;

      let availableDates: string[] = [];
      let availableDatesFailed = false;
      try {
        availableDates = await fetchPolygonAvailableDates(
          cleanId,
          regionId as number,
          year as number,
        );
      } catch (err: any) {
        availableDatesFailed = true;
        AgriGraffWidget.graffLog(
          "fetchVegetationData:available-dates-FAILED",
          {
            uniqueid: cleanId,
            error: String(err?.message || err),
          },
        );
        availableDates = [];
      }

      if (isStale()) return;

      this.setState({ polygonAvailableDates: availableDates });

      // Empty/failed dates: keep Phase-1 ArcGIS series (never blank the chart).
      if (availableDatesFailed || !availableDates.length) {
        AgriGraffWidget.graffLog(
          "fetchVegetationData:KEEP-phase1-no-available-dates",
          {
            uniqueid: cleanId,
            availableDatesFailed,
            availableDatesCount: availableDates.length,
          },
        );
        return;
      }

      const availableDatesSet = new Set(availableDates);
      let scopedData = data
        .map((row) => {
          const matched = this.resolveAgainstAvailableDates(
            row.raster_date,
            availableDates,
          );
          if (!matched || !availableDatesSet.has(matched)) return null;
          return { ...row, raster_date: matched };
        })
        .filter((row): row is VegetationIndex => row != null);

      if (!scopedData.length) {
        AgriGraffWidget.graffLog(
          "fetchVegetationData:FALLBACK-unfiltered-arcgis",
          {
            uniqueid: cleanId,
            regionId,
            year,
            arcgisRowCount: data.length,
            availableDatesCount: availableDates.length,
          },
        );
        return;
      }

      const refined = this.preparePolygonGraphSeries(
        scopedData,
        availableDates,
      );

      // No material change — avoid chart remount / overlay re-fetch.
      if (
        refined.fingerprint === paintedFingerprint &&
        refined.nextDate === paintedDate &&
        refined.nextIndexKey === paintedIndex
      ) {
        AgriGraffWidget.graffLog("fetchVegetationData:refine-noop", {
          uniqueid: cleanId,
          rowCount: refined.sorted.length,
        });
        return;
      }

      this.applyGraphData(
        refined.sorted,
        {
          dateRangeStartIndex: null,
          dateRangeEndIndex: null,
          polygonAvailableDates: availableDates,
          selectedNdviDate: refined.nextDate,
          selectedChartIndexKey: refined.nextIndexKey,
        },
        { animate: false },
      );

      const dateOrIndexChanged =
        refined.nextDate !== paintedDate ||
        refined.nextIndexKey !== paintedIndex;
      if (
        !isStale() &&
        dateOrIndexChanged &&
        refined.nextDate &&
        refined.nextIndexKey &&
        this.state.selecteduniqueid
      ) {
        void this.applyVegetationImageOverlay(
          this.state.selecteduniqueid,
          refined.nextDate,
          refined.nextIndexKey,
        );
      }

      AgriGraffWidget.graffLog("fetchVegetationData:refined", {
        uniqueid: cleanId,
        phase1Rows: data.length,
        refinedRows: refined.sorted.length,
        nextDate: refined.nextDate,
        dateOrIndexChanged,
      });
    } catch (error: any) {
      if (isStale()) return;

      this._hasCompletedGraphFetch = true;
      this.setState({
        vegetationData: [],
        loadingVegetation: false,
        vegetationError: error.message || "Вегетация маълумоти юклана олмади",
        selectedNdviDate: null,
        selectedChartIndexKey: null,
      });
    }
  };

  private handleIndexChange = (
    index: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi",
  ) => {
    if (!this.isRegionalInteractionEnabled()) return;

    this.setState(
      (prevState) => {
        const exists = prevState.selectedIndices.includes(index);
        if (exists) {
          const next = prevState.selectedIndices.filter((k) => k !== index);
          // Keep at least NDVI so chart is never empty
          return { selectedIndices: next.length > 0 ? next : ["ndvi"] };
        }
        return { selectedIndices: [...prevState.selectedIndices, index] };
      },
      () => {
        const {
          selecteduniqueid,
          selectedNdviDate,
          selectedIndices,
          selectedChartIndexKey,
          viewMode,
        } = this.state;
        // Republic regional chart: fetch any newly enabled index columns on demand.
        if (!selecteduniqueid && viewMode === "graph") {
          void this.fetchRegionalTimeseries();
        }
        if (!selecteduniqueid || !selectedNdviDate) return;
        // Overlay follows the chart-selected index. Only refresh when that
        // index was toggled off the series list (fall back to primary).
        if (
          selectedChartIndexKey &&
          selectedIndices.includes(selectedChartIndexKey)
        ) {
          return;
        }
        const nextKey = (selectedIndices[0] || "ndvi") as VegetationIndiceType;
        this.setState({ selectedChartIndexKey: nextKey });
        this.applyVegetationImageOverlay(
          selecteduniqueid,
          selectedNdviDate,
          nextKey,
        );
      },
    );
  };

  private handleToggleAllIndices = () => {
    if (!this.isRegionalInteractionEnabled()) return;
    const allKeys: Array<"ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi"> = [
      "ndvi",
      "savi",
      "rvi",
      "ci",
      "evi",
      "ndwi",
    ];
    this.setState(
      (prev) => {
        const isAll = allKeys.every((k) => prev.selectedIndices.includes(k));
        return { selectedIndices: isAll ? ["ndvi"] : allKeys };
      },
      () => {
        if (!this.state.selecteduniqueid && this.state.viewMode === "graph") {
          void this.fetchRegionalTimeseries();
        }
      },
    );
  };

  private localizeRuntimeMessage = (value: unknown): string => {
    const message = String(value ?? "");
    if (this.state.language !== "en" || !message) return message;
    if (message.includes("Майдонлар танланмаган")) return "No fields are selected. Select widget fields in Settings.";
    if (message.includes("Созланган қатламда") || message.includes("ишлатиладиган майдонлар йўқ")) return "The configured layer has no usable fields. Check the layer settings.";
    if (message.includes("Маълумот манбаи мавжуд эмас")) return "The data source is unavailable.";
    if (message.includes("Бошланғич маълумот")) return "Could not load the initial data.";
    if (message.includes("Қатлам мавжуд эмас")) return "The configured layer is unavailable.";
    if (message.includes("Күтүлмаган хатолик")) return "An unexpected error occurred.";
    if (message.includes("Объектни танлаш")) return "Could not select the feature.";
    if (message.includes("Вилоят вақт қатори")) return "Could not load the regional time series.";
    if (message.includes("Вегетация маълумоти")) return "Could not load vegetation data.";
    return message;
  };

  private renderGraph = () => {
    const {
      vegetationData,
      loadingVegetation,
      vegetationError,
      selectedIndices,
      selecteduniqueid,
      chartTooltip,
      selectedNdviDate,
      selectedMonth,
      dateRangeStartIndex,
      dateRangeEndIndex,
      language,
    } = this.state;

    const allMonthsLabel =
      language === "en" ? "All months" : language === "ru"
        ? "Все месяцы"
        : language === "uz_lat"
          ? "Barcha oylar"
          : "Барча ойлар";

    const hasGraphData = !!(vegetationData && vegetationData.length > 0);
    const awaitingFirstGraphData = !this._hasCompletedGraphFetch;
    // Loader only on cold start — keep previous series while refetching (Agrobank morph).
    const showBlockingLoader =
      !hasGraphData && (loadingVegetation || awaitingFirstGraphData);
    // Empty state only after a real fetch returned zero rows.
    const showNoData =
      !loadingVegetation && this._hasCompletedGraphFetch && !hasGraphData;

    if (showBlockingLoader) {
      return this.wrapGraphFrame(
        <div className="kadastr-status-loading-container">
          <AgriChartLoader />
        </div>,
      );
    }

    if (vegetationError) {
      const onRetry = selecteduniqueid
        ? this.fetchVegetationData
        : this.fetchRegionalTimeseries;
      return this.wrapGraphFrame(
        <div className="kadastr-status-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
          <h3>
            {language === "en" ? "Could not load data" : language === "ru"
              ? "Не удалось загрузить данные"
              : language === "uz_lat"
                ? "Maʼlumot yuklanmadi"
                : "Маълумот юклана олмади"}
          </h3>
          <p>{this.localizeRuntimeMessage(vegetationError)}</p>
          <button onClick={onRetry} className="kadastr-status-retry-button">
            {language === "en" ? "Retry" : language === "ru"
              ? "Повторить"
              : language === "uz_lat"
                ? "Qayta urinib ko‘rish"
                : "Qayta urinish"}
          </button>
        </div>,
      );
    }

    if (showNoData) {
      return this.wrapGraphFrame(
        <div className="kadastr-status-no-data">
          <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
          <h3>{agriNoDataLabel(language)}</h3>
        </div>,
      );
    }

    const indexButtons: Array<{
      key: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi";
      label: string;
      color: string;
    }> = [
      { key: "ndvi", label: "NDVI", color: "#00d084" },
      { key: "savi", label: "SAVI", color: "#7aa5ff" },
      { key: "rvi", label: "RVI", color: "#ffb347" },
      { key: "ci", label: "CI", color: "#c78bff" },
      { key: "evi", label: "EVI", color: "#ff4d8d" },
      { key: "ndwi", label: "NDWI", color: "#2ec4f1" },
    ];

    const indexOrder: Array<"ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi"> = [
      "ndvi",
      "savi",
      "rvi",
      "ci",
      "evi",
      "ndwi",
    ];
    const activeIndices = indexOrder.filter((idx) =>
      selectedIndices.includes(idx),
    );
    const finalIndices: Array<"ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi"> =
      activeIndices.length > 0 ? activeIndices : ["ndvi"];
    const primaryIndex = finalIndices[0];
    const isMultiIndexMode = finalIndices.length > 1;
    const indexColorMap = indexButtons.reduce(
      (acc, item) => {
        acc[item.key] = item.color;
        return acc;
      },
      {} as Record<"ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi", string>,
    );

    // Calculate SVG dimensions from live container size
    const graphWidth = Math.max(this.state.graphViewportWidth, 120);
    const graphHeight = Math.max(this.state.graphViewportHeight, 120);
    const isNarrow = graphWidth < 640;
    const compactChart = graphWidth < 720;
    const isIpadLayout =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      (window.matchMedia(
        "(min-width: 1080px) and (max-width: 1400px) and (min-height: 780px) and (max-aspect-ratio: 3/2)",
      ).matches ||
        window.matchMedia(
          "(min-width: 1080px) and (max-width: 1400px) and (max-height: 910px) and (min-height: 500px)",
        ).matches ||
        window.matchMedia(
          "(min-width: 1024px) and (max-width: 1400px) and (min-height: 760px) and (max-height: 1100px)",
        ).matches ||
        // iPadOS Safari (incl. “Request Desktop Website”) often reports odd sizes
        (/iPad|Macintosh/.test(navigator.userAgent) &&
          navigator.maxTouchPoints > 1));
    const axisTickFont = 10;
    const axisTitleFont = 10;
    const monthTickFont = 10;
    const tooltipFont = 10;
    // Short viewports scale the SVG down — keep strokes readable on iPad band.
    // Safari often fails stroke-dash draw anim → line stays at offset 100 (invisible).
    const lineStrokeWidth = isIpadLayout ? 3.8 : 2.85;
    const lineGlowStrokeWidth = isIpadLayout ? 3.8 : 5.2;
    const padding = {
      top: compactChart ? 8 : 12,
      right: compactChart ? 6 : 8,
      bottom: compactChart ? 32 : 36,
      left: compactChart ? 50 : 56,
    };
    const chartWidth = graphWidth - padding.left - padding.right;
    const chartHeight = graphHeight - padding.top - padding.bottom;
    const monthTickY = padding.top + chartHeight + (isNarrow ? 16 : 17);

    const monthNamesFull =
      language === "en"
        ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        : language === "ru"
        ? [
            "Январь",
            "Февраль",
            "Март",
            "Апрель",
            "Май",
            "Июнь",
            "Июль",
            "Август",
            "Сентябрь",
            "Октябрь",
            "Ноябрь",
            "Декабрь",
          ]
        : language === "uz_lat"
          ? [
              "Yanvar",
              "Fevral",
              "Mart",
              "Aprel",
              "May",
              "Iyun",
              "Iyul",
              "Avgust",
              "Sentabr",
              "Oktabr",
              "Noyabr",
              "Dekabr",
            ]
          : [
              "Январ",
              "Феврал",
              "Март",
              "Апрел",
              "Май",
              "Июн",
              "Июл",
              "Август",
              "Сентябр",
              "Октябр",
              "Ноябр",
              "Декабр",
            ];

    const availableMonthIndices: number[] = Array.from(
      new Set(
        vegetationData
          .map((row) => new Date(row.raster_date))
          .filter((date) => !Number.isNaN(date.getTime()))
          .map((date) => date.getMonth()),
      ),
    ).sort((a, b) => a - b);

    const sortedRowsBase = [...vegetationData].sort(
      (a, b) =>
        new Date(a.raster_date).getTime() - new Date(b.raster_date).getTime(),
    );
    const lastRangeIndex = Math.max(sortedRowsBase.length - 1, 0);
    const effectiveRangeStart = Math.min(
      Math.max(dateRangeStartIndex ?? 0, 0),
      lastRangeIndex,
    );
    const effectiveRangeEnd = Math.max(
      effectiveRangeStart,
      Math.min(dateRangeEndIndex ?? lastRangeIndex, lastRangeIndex),
    );
    const sortedRows = sortedRowsBase.slice(
      effectiveRangeStart,
      effectiveRangeEnd + 1,
    );
    const rangeStartDate = sortedRowsBase[effectiveRangeStart]?.raster_date;
    const rangeEndDate = sortedRowsBase[effectiveRangeEnd]?.raster_date;
    const rangeStartPercent = lastRangeIndex
      ? (effectiveRangeStart / lastRangeIndex) * 100
      : 0;
    const rangeEndPercent = lastRangeIndex
      ? (effectiveRangeEnd / lastRangeIndex) * 100
      : 100;
    const formatRangeDate = (raw: unknown): string => {
      const date = new Date(String(raw || ''));
      if (Number.isNaN(date.getTime())) return '';
      return `${String(date.getDate()).padStart(2, '0')}.${String(
        date.getMonth() + 1,
      ).padStart(2, '0')}.${date.getFullYear()}`;
    };

    const seriesByIndex = finalIndices.reduce(
      (acc, idx) => {
        acc[idx] = sortedRows
          .map((row, rowIndex) => {
            const raw = row as any;
            const value = raw[idx] == null ? Number.NaN : Number(raw[idx]);
            const minRaw = raw[`${idx}_min`];
            const maxRaw = raw[`${idx}_max`];
            return {
              date: new Date(row.raster_date),
              value,
              sourceIndex: rowIndex,
              min:
                minRaw == null || Number.isNaN(Number(minRaw))
                  ? undefined
                  : Number(minRaw),
              max:
                maxRaw == null || Number.isNaN(Number(maxRaw))
                  ? undefined
                  : Number(maxRaw),
            };
          })
          .filter(
            (point) =>
              !Number.isNaN(point.date.getTime()) &&
              Number.isFinite(point.value),
          )
          .map((point, sourceIndex) => ({ ...point, sourceIndex }));
        return acc;
      },
      {} as Record<
        "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi",
        Array<{
          date: Date;
          value: number;
          sourceIndex: number;
          min?: number;
          max?: number;
        }>
      >,
    );

    const dataPoints = seriesByIndex[primaryIndex] || [];

    // Find min/max values across selected indicators for comparison scale
    const allSeriesPoints = finalIndices.flatMap((idx) => seriesByIndex[idx]);
    const values = allSeriesPoints
      .map((d) => d.value)
      .filter((v) => Number.isFinite(v));
    const allMins = allSeriesPoints
      .map((d) => d.min)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const allMaxs = allSeriesPoints
      .map((d) => d.max)
      .filter((v): v is number => v != null && Number.isFinite(v));

    if (values.length === 0 || dataPoints.length === 0) {
      return (
        <div className="kadastr-status-no-data">
          <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
          <h3>{agriNoDataLabel(language)}</h3>
        </div>
      );
    }

    const rawMinValue = Math.min(...values, ...allMins);
    const rawMaxValue = Math.max(...values, ...allMaxs);
    const valuePadding = Math.max((rawMaxValue - rawMinValue) * 0.08, 0.02);
    const minValue = rawMinValue - valuePadding;
    const maxValue = rawMaxValue + valuePadding;
    const isNdviScale = primaryIndex === "ndvi";
    const axisMinValue = isNdviScale ? rawMinValue : minValue;
    const axisMaxValue = isNdviScale ? rawMaxValue : maxValue;
    const axisRange = Math.max(axisMaxValue - axisMinValue, 0.001);

    // Scale functions
    const minDate = dataPoints[0].date.getTime();
    const maxDate = dataPoints[dataPoints.length - 1].date.getTime();
    const dateRange = Math.max(maxDate - minDate, 1);
    const innerPaddingX = 8;
    const rawXScale = (date: Date) => {
      return (
        padding.left +
        innerPaddingX +
        ((date.getTime() - minDate) / dateRange) * (chartWidth - innerPaddingX * 2)
      );
    };
    const xScale = (date: Date, sourceIndex?: number) => {
      if (
        sourceIndex == null ||
        dataPoints.length < 3 ||
        sourceIndex < 0 ||
        sourceIndex >= dataPoints.length
      ) {
        return rawXScale(date);
      }

      const uniformX =
        padding.left +
        innerPaddingX +
        (sourceIndex / Math.max(dataPoints.length - 1, 1)) *
          (chartWidth - innerPaddingX * 2);
      const rawX = rawXScale(date);

      // Blend date-based spacing with uniform spacing so dense points spread out visually.
      return rawX * 0.25 + uniformX * 0.75;
    };

    const yScale = (value: number) => {
      return (
        padding.top +
        chartHeight -
        ((value - axisMinValue) / axisRange) * chartHeight
      );
    };

    const yAxisTickValues = [1, 0.5, 0, -0.5, -1];

    // Persistent guide for the chart-selected date (survives mouse leave).
    const selectionGuide = (() => {
      if (!selectedNdviDate) return null;
      const indexKey = (this.state.selectedChartIndexKey ||
        primaryIndex) as
        | "ndvi"
        | "savi"
        | "rvi"
        | "ci"
        | "evi"
        | "ndwi";
      const series = seriesByIndex[indexKey] || [];
      const advertised = this.state.polygonAvailableDates || [];
      for (const p of series) {
        const ymd =
          this.resolveAgainstAvailableDates(p.date, advertised) ||
          this.formatLocalDateYmd(p.date);
        if (ymd !== selectedNdviDate) continue;
        return {
          indexKey,
          point: {
            date: p.date,
            value: p.value,
            min: p.min,
            max: p.max,
            sourceIndex: p.sourceIndex,
          },
        };
      }
      return null;
    })();

    const isSameGuidePoint = (
      a: typeof selectionGuide,
      b: typeof chartTooltip,
    ): boolean => {
      if (!a || !b) return false;
      if (a.indexKey !== b.indexKey) return false;
      const aIdx = a.point.sourceIndex;
      const bIdx = b.point.sourceIndex;
      if (aIdx != null && bIdx != null) return aIdx === bIdx;
      return a.point.date.getTime() === b.point.date.getTime();
    };

    // Sticky selection line always stays; hover adds a second line only when
    // the cursor is over a different point.
    const hoverGuide =
      chartTooltip && !isSameGuidePoint(selectionGuide, chartTooltip)
        ? chartTooltip
        : null;

    // Clean min/max band path
    const minMaxAreaPath = (() => {
      if (dataPoints.length === 0) return "";

      const valid = dataPoints.filter((d) => d.min != null && d.max != null);
      if (valid.length < 2) return "";

      const top = valid
        .map((d, index) => {
          const x = xScale(d.date, d.sourceIndex);
          const y = yScale(d.max as number);
          return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
        })
        .join(" ");

      const bottom = valid
        .slice()
        .reverse()
        .map((d) => {
          const x = xScale(d.date, d.sourceIndex);
          const y = yScale(d.min as number);
          return `L ${x} ${y}`;
        })
        .join(" ");

      return `${top} ${bottom} Z`;
    })();

    const buildSmoothPath = (points: Array<{ x: number; y: number }>) => {
      if (points.length === 0) return "";
      if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

      const tension = 0.9;
      let d = `M ${points[0].x} ${points[0].y}`;

      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;

        const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
        const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;
        const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
        const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;

        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }

      return d;
    };

    const lineSeries = finalIndices.map((idx) => {
      const points = (seriesByIndex[idx] || []).map((d) => ({
        x: xScale(d.date, d.sourceIndex),
        y: yScale(d.value),
        value: d.value,
        date: d.date,
        min: d.min,
        max: d.max,
        sourceIndex: d.sourceIndex,
      }));

      const baselineY = padding.top + chartHeight;
      const areaPath =
        points.length < 2
          ? ""
          : `${buildSmoothPath(points)} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;

      return {
        key: idx,
        color: indexColorMap[idx],
        points,
        path: buildSmoothPath(points),
        areaPath,
      };
    });

    // Month labels for x-axis
    const monthLabels =
      language === "en"
        ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        : language === "ru"
        ? [
            "Янв",
            "Фев",
            "Мар",
            "Апр",
            "Май",
            "Июн",
            "Июл",
            "Авг",
            "Сен",
            "Окт",
            "Ноя",
            "Дек",
          ]
        : language === "uz_lat"
          ? [
              "Yan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Iyun",
              "Iyul",
              "Avg",
              "Sen",
              "Okt",
              "Noy",
              "Dek",
            ]
          : [
              "Янв",
              "Фев",
              "Мар",
              "Апр",
              "Май",
              "Июн",
              "Июл",
              "Авг",
              "Сен",
              "Окт",
              "Ноя",
              "Дек",
            ];

    const visibleRangeMs = Math.max(
      dataPoints[dataPoints.length - 1].date.getTime() -
        dataPoints[0].date.getTime(),
      0,
    );
    const showDailyDateTicks = visibleRangeMs <= 31 * 24 * 60 * 60 * 1000;

    // For a one-month (or shorter) range show every observation date;
    // otherwise keep the compact one-label-per-month axis.
    const monthTickPoints = (() => {
      if (dataPoints.length === 0) return [];
      if (showDailyDateTicks) {
        return dataPoints.map((point) => ({
          x: xScale(point.date, point.sourceIndex),
          label: `${String(point.date.getDate()).padStart(2, '0')}.${String(
            point.date.getMonth() + 1,
          ).padStart(2, '0')}`,
          daily: true,
        }));
      }
      const seen = new Set<string>();
      const ticks: { x: number; label: string; daily?: boolean }[] = [];
      for (const d of dataPoints) {
        const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
        if (!seen.has(key)) {
          seen.add(key);
          ticks.push({
            x: xScale(d.date, d.sourceIndex),
            label: monthLabels[d.date.getMonth()],
          });
        }
      }
      if (graphWidth < 560 && ticks.length > 5) {
        return ticks.filter((_, index) => index % 2 === 0);
      }
      return ticks;
    })();

    const themeText = this.state.isDarkTheme ? "#e9f8ff" : "#111827";
    const themeGrid = this.state.isDarkTheme
      ? "rgba(233, 248, 255, 0.28)"
      : "rgba(15, 23, 42, 0.12)";
    const tooltipBg = this.state.isDarkTheme
      ? "rgba(7, 26, 43, 0.96)"
      : "rgba(250,250,249,0.98)";
    const tooltipHeaderBg = this.state.isDarkTheme
      ? "rgba(233,248,255,0.1)"
      : "rgba(15,23,42,0.06)";
    const tooltipBorder = this.state.isDarkTheme
      ? "rgba(126, 214, 255, 0.28)"
      : "rgba(15,23,42,0.12)";

    const findNearestPoint = (svgX: number) => {
      if (dataPoints.length === 0) return null;
      let nearest = 0;
      let minDist = Math.abs(
        xScale(dataPoints[0].date, dataPoints[0].sourceIndex) - svgX,
      );
      for (let i = 1; i < dataPoints.length; i++) {
        const d = Math.abs(
          xScale(dataPoints[i].date, dataPoints[i].sourceIndex) - svgX,
        );
        if (d < minDist) {
          minDist = d;
          nearest = i;
        }
      }
      return dataPoints[nearest];
    };

    const findNearestSeriesPoint = (
      svgX: number,
      indexKey: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi",
    ) => {
      const series = seriesByIndex[indexKey] || [];
      if (series.length === 0) return null;
      let nearest = 0;
      let minDist = Math.abs(
        xScale(series[0].date, series[0].sourceIndex) - svgX,
      );
      for (let i = 1; i < series.length; i++) {
        const distance = Math.abs(
          xScale(series[i].date, series[i].sourceIndex) - svgX,
        );
        if (distance < minDist) {
          minDist = distance;
          nearest = i;
        }
      }
      return series[nearest];
    };

    const findNearestPointAcrossSeries = (svgX: number, svgY: number) => {
      let best:
        | {
            distance: number;
            indexKey: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi";
            point: {
              date: Date;
              value: number;
              min?: number;
              max?: number;
              sourceIndex?: number;
            };
          }
        | null = null;

      for (const series of lineSeries) {
        for (const p of series.points) {
          const dx = p.x - svgX;
          const dy = p.y - svgY;
          const distance = Math.hypot(dx, dy);
          if (!best || distance < best.distance) {
            best = {
              distance,
              indexKey: series.key,
              point: {
                date: p.date,
                value: p.value,
                min: p.min,
                max: p.max,
                sourceIndex: p.sourceIndex,
              },
            };
          }
        }
      }

      return best;
    };

    const setChartTooltipForIndex = (
      indexKey: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi",
      point: {
        date: Date;
        value: number;
        min?: number;
        max?: number;
        sourceIndex?: number;
      },
    ) => {
      this.setState({
        chartTooltip: {
          indexKey,
          point: {
            date: point.date,
            value: point.value,
            min: point.min,
            max: point.max,
            ...(point.sourceIndex != null && point.sourceIndex >= 0
              ? { sourceIndex: point.sourceIndex }
              : {}),
          },
        },
      });
    };

    const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
      if (isMultiIndexMode) {
        this.setState({ chartTooltip: null });
        return;
      }
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * graphWidth;
      const point = findNearestPoint(svgX);
      if (point) {
        setChartTooltipForIndex(primaryIndex, point);
      }
    };

    const handleChartMouseLeave = () => {
      this.setState({ chartTooltip: null });
    };

    const handlePointSelection = (
      indexKey: "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi",
      point: {
        date: Date;
        value: number;
        min?: number;
        max?: number;
        sourceIndex?: number;
      },
    ) => {
      if (!this.state.selecteduniqueid) {
        AgriGraffWidget.graffLog('chartPoint:SKIP-no-polygon', {
          indexKey,
          pointDate: point.date?.toISOString?.() || String(point.date),
          pointValue: point.value,
        });
        return;
      }

      const advertised = this.state.polygonAvailableDates || [];
      const selectedDateStr =
        this.resolveAgainstAvailableDates(point.date, advertised) ||
        this.formatLocalDateYmd(point.date);
      if (!selectedDateStr) {
        AgriGraffWidget.graffLog('chartPoint:SKIP-date-unresolved', {
          indexKey,
          pointDate: point.date?.toISOString?.() || String(point.date),
          advertisedDateCount: advertised.length,
        });
        return;
      }

      const isSameDateClick =
        (this.state.selectedNdviDate || "") === selectedDateStr;
      const isSameIndexClick =
        (this.state.selectedChartIndexKey || "") === indexKey;

      // Same date + same index → toggle off. Same date + different index
      // (e.g. NDVI → EVI on that day) must still fetch/show the new raster;
      // previously any same-date click cleared the overlay, so switching
      // index indicators looked like "nothing on the field".
      AgriGraffWidget.graffLog('chartPoint:selection-resolved', {
        uniqueid: this.state.selecteduniqueid,
        indexKey,
        selectedDate: selectedDateStr,
        rawPointDate: point.date?.toISOString?.() || String(point.date),
        value: point.value,
        min: point.min ?? null,
        max: point.max ?? null,
        sourceIndex: point.sourceIndex ?? null,
        advertisedDateCount: advertised.length,
        previousDate: this.state.selectedNdviDate || null,
        previousIndexKey: this.state.selectedChartIndexKey || null,
        isSameDateClick,
        isSameIndexClick,
      });

      if (isSameDateClick && isSameIndexClick) {
        AgriGraffWidget.graffLog('chartPoint:toggle-off', {
          uniqueid: this.state.selecteduniqueid,
          indexKey,
          selectedDate: selectedDateStr,
          overlayPresent: Boolean(this._vegetationImageLayer),
        });
        this.setState({
          selectedNdviDate: null,
          selectedChartIndexKey: null,
          chartTooltip: null,
        });

        if (!this.state.selecteduniqueid) {
          document.dispatchEvent(
            new CustomEvent("widgetSelectionChanged", {
              detail: {
                ndviDate: "",
                source: "AgriGraffWidget",
                timestamp: Date.now(),
              },
              bubbles: true,
            }),
          );
        } else {
          AgriGraffWidget.graffLog('chartPoint:remove-overlay', {
            reason: 'same-date-and-index-toggle-off',
            overlayPresent: Boolean(this._vegetationImageLayer),
          });
          this.cancelVegetationImageOverlay();
        }
        return;
      }

      this.setState({
        selectedNdviDate: selectedDateStr,
        selectedChartIndexKey: indexKey,
        chartTooltip: {
          indexKey,
          point: {
            date: point.date,
            value: point.value,
            min: point.min,
            max: point.max,
            ...(point.sourceIndex != null && point.sourceIndex >= 0
              ? { sourceIndex: point.sourceIndex }
              : {}),
          },
        },
      });

      if (!this.state.selecteduniqueid) {
        document.dispatchEvent(
          new CustomEvent("widgetSelectionChanged", {
            detail: {
              ndviDate: selectedDateStr,
              source: "AgriGraffWidget",
              timestamp: Date.now(),
            },
            bubbles: true,
          }),
        );
      } else {
        // A polygon is selected and a date was picked on its chart — fetch
        // and overlay the colored index raster for that polygon+date.
        AgriGraffWidget.graffLog('chartPoint:request-overlay', {
          uniqueid: this.state.selecteduniqueid,
          selectedDate: selectedDateStr,
          indexKey,
        });
        this.applyVegetationImageOverlay(
          this.state.selecteduniqueid,
          selectedDateStr,
          indexKey,
        );
      }
    };

    const handleChartClick = (e: React.MouseEvent<SVGSVGElement>) => {
      if (!this.state.selecteduniqueid) {
        AgriGraffWidget.graffLog('chartPoint:click-SKIP-no-polygon', {
          selectedIndices: this.state.selectedIndices,
          isMultiIndexMode,
        });
        return;
      }

      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * graphWidth;
      const svgY = ((e.clientY - rect.top) / rect.height) * graphHeight;

      AgriGraffWidget.graffLog('chartPoint:click', {
        uniqueid: this.state.selecteduniqueid,
        clientX: e.clientX,
        clientY: e.clientY,
        svgX,
        svgY,
        graphWidth,
        graphHeight,
        isMultiIndexMode,
        primaryIndex,
        selectedIndices: this.state.selectedIndices,
      });

      if (isMultiIndexMode) {
        const nearest = findNearestPointAcrossSeries(svgX, svgY);
        // Only treat click as point-selection when cursor is actually close to a dot.
        if (!nearest || nearest.distance > 10) {
          AgriGraffWidget.graffLog('chartPoint:click-SKIP-no-near-dot', {
            nearestIndexKey: nearest?.indexKey || null,
            nearestDistance: nearest?.distance ?? null,
            threshold: 10,
          });
          return;
        }
        AgriGraffWidget.graffLog('chartPoint:nearest-dot', {
          indexKey: nearest.indexKey,
          distance: nearest.distance,
          date:
            nearest.point.date?.toISOString?.() || String(nearest.point.date),
          value: nearest.point.value,
        });
        handlePointSelection(nearest.indexKey, nearest.point);
        return;
      }

      const point = findNearestPoint(svgX);
      if (!point) {
        AgriGraffWidget.graffLog('chartPoint:click-SKIP-no-point', {
          primaryIndex,
          svgX,
        });
        return;
      }
      AgriGraffWidget.graffLog('chartPoint:nearest-dot', {
        indexKey: primaryIndex,
        date: point.date?.toISOString?.() || String(point.date),
        value: point.value,
        sourceIndex: point.sourceIndex ?? null,
      });
      handlePointSelection(primaryIndex, point);
    };

    const renderCrosshair = (
      guide: NonNullable<typeof selectionGuide> | NonNullable<typeof chartTooltip>,
      variant: "selection" | "hover",
    ) => {
      const pt = guide.point;
      const lineX = xScale(pt.date, pt.sourceIndex);
      const yVal = yScale(pt.value);
      const yMin = pt.min != null ? yScale(pt.min) : null;
      const yMax = pt.max != null ? yScale(pt.max) : null;
      const lineHt = 12;
      // Hover guide is a bit softer so the sticky selection line stays primary.
      const lineStroke =
        variant === "selection"
          ? "rgba(16, 185, 129, 0.55)"
          : "rgba(16, 185, 129, 0.28)";
      const lineWidth = variant === "selection" ? 1.5 : 1.2;
      return (
        <g
          key={`graph-crosshair-${variant}`}
          className={`graph-crosshair graph-crosshair--${variant}`}
          pointerEvents="none"
        >
          <line
            x1={lineX}
            y1={padding.top}
            x2={lineX}
            y2={padding.top + chartHeight}
            stroke={lineStroke}
            strokeWidth={lineWidth}
            strokeDasharray="6,4"
          />
          {yMin != null && (
            <line
              x1={lineX - lineHt / 2}
              y1={yMin}
              x2={lineX + lineHt / 2}
              y2={yMin}
              stroke="#f87171"
              strokeWidth={2}
              opacity={variant === "selection" ? 1 : 0.7}
            />
          )}
          {yMax != null && (
            <line
              x1={lineX - lineHt / 2}
              y1={yMax}
              x2={lineX + lineHt / 2}
              y2={yMax}
              stroke="#34d399"
              strokeWidth={2}
              opacity={variant === "selection" ? 1 : 0.7}
            />
          )}
          <line
            x1={lineX - lineHt / 2}
            y1={yVal}
            x2={lineX + lineHt / 2}
            y2={yVal}
            stroke="#fbbf24"
            strokeWidth={2}
            opacity={variant === "selection" ? 1 : 0.7}
          />
        </g>
      );
    };

    const floatingTooltip = chartTooltip
      ? (() => {
          const pt = chartTooltip.point;
          const lineX = xScale(pt.date, pt.sourceIndex);
          const boxW = 156;
          const boxH = 92;
          const wrapRect = this.graphSvgWrapRef.current?.getBoundingClientRect();
          if (!wrapRect) return null;

          let left = wrapRect.left + lineX - boxW / 2;
          left = Math.max(8, Math.min(left, window.innerWidth - boxW - 8));
          const top = Math.max(8, wrapRect.top - boxH - 10);

          const minStr = pt.min != null ? pt.min.toFixed(4) : "—";
          const maxStr = pt.max != null ? pt.max.toFixed(4) : "—";
          const valStr = pt.value.toFixed(4);
          const dateLocale = language === "ru" ? "ru-RU" : "en-GB";
          const dateStr = pt.date.toLocaleDateString(dateLocale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const indicatorColor = indexColorMap[chartTooltip.indexKey] || "#fbbf24";

          return {
            left,
            top,
            minStr,
            maxStr,
            valStr,
            dateStr,
            indicatorColor,
            key: chartTooltip.indexKey,
          };
        })()
      : null;

    const isRefreshing = !!loadingVegetation && hasGraphData;

    return (
      <div
        className={`vegetation-graph-container ${isNarrow ? "is-narrow" : ""} ${compactChart ? "is-compact" : ""}${
          isIpadLayout ? " is-ipad-layout" : ""
        }${isRefreshing ? " vegetation-graph-container--loading" : ""}`}
        ref={this.graphContainerRef}
      >
        {this.renderGraphHeader()}
        {isRefreshing ? <AgriChartLoader /> : null}

        <div className="graff-date-range" aria-label="Chart date range">
          <div
            className="graff-date-range-track"
            style={
              {
                '--range-start': `${rangeStartPercent}%`,
                '--range-end': `${rangeEndPercent}%`,
              } as React.CSSProperties
            }
          >
            <input
              className="graff-date-range-input graff-date-range-input-start"
              type="range"
              min={0}
              max={lastRangeIndex}
              step={1}
              value={effectiveRangeStart}
              disabled={lastRangeIndex < 1}
              aria-label="Start date"
              onChange={(event) => {
                const next = Math.min(
                  Number(event.currentTarget.value),
                  effectiveRangeEnd,
                );
                this.setState({
                  dateRangeStartIndex: next,
                  chartTooltip: null,
                });
              }}
            />
            <input
              className="graff-date-range-input graff-date-range-input-end"
              type="range"
              min={0}
              max={lastRangeIndex}
              step={1}
              value={effectiveRangeEnd}
              disabled={lastRangeIndex < 1}
              aria-label="End date"
              onChange={(event) => {
                const next = Math.max(
                  Number(event.currentTarget.value),
                  effectiveRangeStart,
                );
                this.setState({
                  dateRangeEndIndex: next,
                  chartTooltip: null,
                });
              }}
            />
          </div>
          <div className="graff-date-range-labels">
            <span>{formatRangeDate(rangeStartDate)}</span>
            <span>{formatRangeDate(rangeEndDate)}</span>
          </div>
        </div>

        {/* Chart area - center */}
        <div className="graff-chart-area">
          <div className="graph-svg-wrap" ref={this.graphSvgWrapRef}>
            <svg
              viewBox={`0 0 ${graphWidth} ${graphHeight}`}
              preserveAspectRatio="xMidYMid meet"
              width="100%"
              height="100%"
              className="graph-svg"
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
              onClick={handleChartClick}
            >
              <defs>
                <filter
                  id="toolinfoShadow"
                  x="-20%"
                  y="-20%"
                  width="140%"
                  height="140%"
                >
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="0"
                    floodColor="none"
                    floodOpacity="0"
                  />
                </filter>
                <linearGradient
                  id="minMaxFill"
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop
                    offset="0%"
                    style={{ stopColor: "#94a3b8", stopOpacity: 0.16 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: "#94a3b8", stopOpacity: 0.02 }}
                  />
                </linearGradient>
                {lineSeries.map((series) => (
                  <linearGradient
                    key={`area-gradient-${series.key}`}
                    id={`areaFill-${series.key}`}
                    x1="0%"
                    y1="0%"
                    x2="0%"
                    y2="100%"
                  >
                    <stop
                      offset="0%"
                      style={{ stopColor: series.color, stopOpacity: 0.26 }}
                    />
                    <stop
                      offset="100%"
                      style={{ stopColor: series.color, stopOpacity: 0.03 }}
                    />
                  </linearGradient>
                ))}
                {/* Soft glow only — expanded region avoids clipped “border” artifacts */}
                <filter
                  id="lineGlow"
                  x="-80%"
                  y="-80%"
                  width="260%"
                  height="260%"
                  filterUnits="objectBoundingBox"
                  colorInterpolationFilters="sRGB"
                >
                  <feGaussianBlur
                    in="SourceGraphic"
                    stdDeviation="2.8"
                    result="blur"
                  />
                  <feColorMatrix
                    in="blur"
                    type="matrix"
                    values="1 0 0 0 0
                            0 1 0 0 0
                            0 0 1 0 0
                            0 0 0 0.55 0"
                    result="soft"
                  />
                  <feMerge>
                    <feMergeNode in="soft" />
                  </feMerge>
                </filter>
                <filter
                  id="dotGlow"
                  x="-120%"
                  y="-120%"
                  width="340%"
                  height="340%"
                  filterUnits="objectBoundingBox"
                  colorInterpolationFilters="sRGB"
                >
                  <feGaussianBlur
                    in="SourceGraphic"
                    stdDeviation="2.4"
                    result="blur"
                  />
                  <feColorMatrix
                    in="blur"
                    type="matrix"
                    values="1 0 0 0 0
                            0 1 0 0 0
                            0 0 1 0 0
                            0 0 0 0.6 0"
                    result="soft"
                  />
                  <feMerge>
                    <feMergeNode in="soft" />
                  </feMerge>
                </filter>
              </defs>

              {/* Subtle background fill for chart area */}
              <rect
                x={padding.left}
                y={padding.top}
                width={chartWidth}
                height={chartHeight}
                fill="transparent"
                stroke="none"
                rx="0"
              />

              {/* Chart content */}
              <g>
                {/* Grid lines */}
                <g className="grid">
                  {yAxisTickValues.map((value) => {
                    const y = yScale(value);
                    // Hide axis labels that fall outside the plot (e.g. clipped "0.00").
                    if (
                      y < padding.top - 1 ||
                      y > padding.top + chartHeight + 1
                    ) {
                      return null;
                    }
                    return (
                      <g key={value}>
                        <text
                          x={padding.left - 12}
                          y={y + 4}
                          textAnchor="end"
                          fontSize={axisTickFont}
                          fill={themeText}
                          fontWeight="400"
                          fontFamily="'Manrope', sans-serif"
                        >
                          {value.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

                  <line
                    x1={padding.left}
                    y1={padding.top}
                    x2={padding.left}
                    y2={padding.top + chartHeight}
                    stroke={themeGrid}
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                    strokeLinecap="round"
                  />
                  <line
                    x1={padding.left}
                    y1={padding.top + chartHeight}
                    x2={padding.left + chartWidth}
                    y2={padding.top + chartHeight}
                    stroke={themeGrid}
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                    strokeLinecap="round"
                  />

                  {/* Selected-point min/max marks on the Y-axis */}
                  {selectionGuide &&
                    (() => {
                      const pt = selectionGuide.point;
                      const tickLen = 10;
                      const labelGap = 14;
                      const renderExtremum = (
                        kind: "min" | "max",
                        value: number | undefined,
                        color: string,
                      ) => {
                        if (value == null || !Number.isFinite(value)) return null;
                        const y = yScale(value);
                        if (
                          y < padding.top - 1 ||
                          y > padding.top + chartHeight + 1
                        ) {
                          return null;
                        }
                        return (
                          <g
                            key={`y-sel-${kind}`}
                            className={`graph-y-sel-extremum graph-y-sel-extremum--${kind}`}
                          >
                            <line
                              x1={padding.left - tickLen}
                              y1={y}
                              x2={padding.left + 3}
                              y2={y}
                              stroke={color}
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                            <circle
                              cx={padding.left}
                              cy={y}
                              r={2.4}
                              fill={color}
                            />
                            <text
                              x={padding.left - labelGap}
                              y={y + 3.5}
                              textAnchor="end"
                              fontSize={Math.max(9, axisTickFont - 1)}
                              fill={color}
                              fontWeight="700"
                              fontFamily="'Manrope', sans-serif"
                            >
                              {value.toFixed(2)}
                            </text>
                          </g>
                        );
                      };
                      return (
                        <g className="graph-y-sel-extrema" pointerEvents="none">
                          {renderExtremum("max", pt.max, "#34d399")}
                          {renderExtremum("min", pt.min, "#f87171")}
                        </g>
                      );
                    })()}
                </g>

                {false && minMaxAreaPath && (
                  <path
                    d={minMaxAreaPath}
                    fill="url(#minMaxFill)"
                    fillOpacity={1}
                  />
                )}
                {lineSeries.map((series, seriesIdx) => (
                  <g key={`${series.key}-${this.state.chartAnimKey}`}>
                    {series.areaPath && finalIndices.length <= 2 && (
                      <path
                        d={series.areaPath}
                        fill={`url(#areaFill-${series.key})`}
                        opacity={0.92}
                      />
                    )}
                    {series.path && (
                      <>
                        <path
                          className={`graff-line-path graff-line-path--glow${
                            isIpadLayout ? " graff-line-path--static" : ""
                          }`}
                          d={series.path}
                          pathLength={isIpadLayout ? undefined : 100}
                          strokeDasharray={isIpadLayout ? undefined : 100}
                          strokeDashoffset={isIpadLayout ? undefined : 100}
                          fill="none"
                          stroke={series.color}
                          strokeWidth={lineStrokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          filter={isIpadLayout ? undefined : "url(#lineGlow)"}
                          style={{
                            pointerEvents: "none",
                            animationDelay: isIpadLayout
                              ? undefined
                              : `${70 + seriesIdx * 130}ms`,
                          }}
                        />
                        <path
                          className={`graff-line-path${
                            isIpadLayout ? " graff-line-path--static" : ""
                          }`}
                          d={series.path}
                          pathLength={isIpadLayout ? undefined : 100}
                          strokeDasharray={isIpadLayout ? undefined : 100}
                          strokeDashoffset={isIpadLayout ? undefined : 100}
                          fill="none"
                          stroke={series.color}
                          strokeWidth={lineStrokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            opacity: 0.98,
                            animationDelay: isIpadLayout
                              ? undefined
                              : `${70 + seriesIdx * 130}ms`,
                          }}
                          onMouseMove={(e) => {
                            if (!isMultiIndexMode) return;
                            e.stopPropagation();
                            const svg = e.currentTarget.ownerSVGElement;
                            if (!svg) return;
                            const rect = svg.getBoundingClientRect();
                            const svgX =
                              ((e.clientX - rect.left) / rect.width) *
                              graphWidth;
                            const point = findNearestSeriesPoint(
                              svgX,
                              series.key,
                            );
                            if (point) {
                              setChartTooltipForIndex(series.key, point);
                            }
                          }}
                        />
                      </>
                    )}
                    {series.points.map((d, i) => {
                      const totalPoints = series.points.length;
                      // Thin visible markers a bit so dense series don't look cluttered.
                      const maxVisibleDots = (() => {
                        if (isIpadLayout) {
                          return Math.max(
                            8,
                            Math.min(14, Math.floor(chartWidth / 48)),
                          );
                        }
                        return Math.max(
                          18,
                          Math.min(42, Math.floor(chartWidth / 16)),
                        );
                      })();
                      const sampleStep = Math.max(
                        1,
                        Math.ceil(totalPoints / maxVisibleDots),
                      );
                      const localDateStr =
                        this.resolveAgainstAvailableDates(
                          d.date,
                          this.state.polygonAvailableDates || [],
                        ) || this.formatLocalDateYmd(d.date);
                      const isActive =
                        !!selectedNdviDate &&
                        localDateStr === selectedNdviDate &&
                        (!isMultiIndexMode ||
                          this.state.selectedChartIndexKey === series.key);
                      const isHovered =
                        !!chartTooltip &&
                        chartTooltip.indexKey === series.key &&
                        chartTooltip.point?.sourceIndex === d.sourceIndex;
                      const isSampled =
                        i % sampleStep === 0 || i === totalPoints - 1;
                      if (!isSampled && !isActive && !isHovered) return null;
                      const isInstantReveal = isHovered && !isSampled && !isActive;
                      const isLightTheme = !this.state.isDarkTheme;
                      // Dark: no colored outer ring — bump radius so size matches ring look.
                      // iPad / short windows: slightly smaller markers.
                      const baseRadius = isIpadLayout
                        ? isActive
                          ? 5.2
                          : isHovered
                            ? 4.4
                            : 3.5
                        : isActive
                          ? 7.6
                          : isHovered
                            ? 6.4
                            : 5.1;
                      const outerRingWidth = isLightTheme
                        ? isIpadLayout
                          ? 1.2
                          : 1.6
                        : 0;
                      const radius = isLightTheme
                        ? baseRadius
                        : baseRadius + (isIpadLayout ? 0.8 : 1.2);
                      const strokeWidth = isIpadLayout
                        ? isActive
                          ? 2
                          : isHovered
                            ? 1.7
                            : 1.35
                        : isActive
                          ? 2.6
                          : isHovered
                            ? 2.2
                            : 1.7;
                      const innerStroke = "#ffffff";
                      const outerRadius =
                        radius + strokeWidth / 2 + outerRingWidth / 2 + 0.4;
                      const glowRadius = isIpadLayout
                        ? radius + 1.4
                        : radius + 2.2;
                      return (
                        <g
                          key={`${series.key}-${i}`}
                          className={`graff-line-dot-group${
                            isInstantReveal ? " graff-line-dot-group--instant" : ""
                          }`}
                          style={{
                            animationDelay: isInstantReveal
                              ? undefined
                              : `${160 + seriesIdx * 120 + Math.floor(i / sampleStep) * 28}ms`,
                          }}
                          onMouseMove={(e) => {
                            if (!isMultiIndexMode) return;
                            e.stopPropagation();
                            setChartTooltipForIndex(series.key, {
                              date: d.date,
                              value: d.value,
                              min: d.min,
                              max: d.max,
                              sourceIndex: d.sourceIndex,
                            });
                          }}
                        >
                          <circle
                            className="graff-line-dot-glow"
                            cx={d.x}
                            cy={d.y}
                            r={glowRadius}
                            fill={series.color}
                            stroke="none"
                            filter="url(#dotGlow)"
                            style={{ pointerEvents: "none" }}
                          />
                          {isLightTheme ? (
                            <circle
                              className="graff-line-dot-ring"
                              cx={d.x}
                              cy={d.y}
                              r={outerRadius}
                              fill="none"
                              stroke={series.color}
                              strokeWidth={outerRingWidth}
                            />
                          ) : null}
                          <circle
                            className="graff-line-dot"
                            cx={d.x}
                            cy={d.y}
                            r={radius}
                            fill={series.color}
                            stroke={innerStroke}
                            strokeWidth={strokeWidth}
                            style={{
                              transition: "r 0.2s ease",
                            }}
                          >
                            <title>
                              {`${series.key.toUpperCase()}: ${d.value.toFixed(4)}`}
                              {"\n"}
                              {d.date.toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })}
                            </title>
                          </circle>
                        </g>
                      );
                    })}
                  </g>
                ))}

                {monthTickPoints.map((tick, i) => (
                  <text
                    key={i}
                    x={tick.x}
                    y={monthTickY}
                    textAnchor="middle"
                    fontSize={tick.daily ? 8 : monthTickFont}
                    fill={themeText}
                    fontWeight="400"
                    fontFamily="'Manrope', sans-serif"
                    transform={
                      tick.daily
                        ? `rotate(-38, ${tick.x}, ${monthTickY})`
                        : undefined
                    }
                  >
                    {tick.label}
                  </text>
                ))}

                {/* X-axis title removed by request */}
                {/* Y-axis title (INDEX) removed by request */}
              </g>

              {/* Sticky selection crosshair + optional hover crosshair */}
              {selectionGuide ? renderCrosshair(selectionGuide, "selection") : null}
              {hoverGuide ? renderCrosshair(hoverGuide, "hover") : null}
            </svg>
            {floatingTooltip &&
              ReactDOM.createPortal(
                <div
                  className={`graff-chart-tooltip${
                    this.state.isDarkTheme ? "" : " graff-chart-tooltip--light"
                  }`}
                  style={{
                    left: `${floatingTooltip.left}px`,
                    top: `${floatingTooltip.top}px`,
                  }}
                >
                  <div className="graff-chart-tooltip__title">
                    {floatingTooltip.dateStr}
                  </div>
                  <div className="graff-chart-tooltip__content">
                    <div className="graff-chart-tooltip__row">
                      <span className="graff-chart-tooltip__label">
                        {language === "en"
                          ? "Max"
                          : language === "ru"
                            ? "Макс"
                            : language === "uz_lat"
                              ? "Max"
                              : "Макс"}
                      </span>
                      <span className="graff-chart-tooltip__value">
                        {floatingTooltip.maxStr}
                      </span>
                    </div>
                    <div className="graff-chart-tooltip__row">
                      <span className="graff-chart-tooltip__label">
                        <span
                          className="graff-chart-tooltip__dot"
                          style={{ background: floatingTooltip.indicatorColor }}
                        />
                        {floatingTooltip.key.toUpperCase()}
                      </span>
                      <span className="graff-chart-tooltip__value">
                        {floatingTooltip.valStr}
                      </span>
                    </div>
                    <div className="graff-chart-tooltip__row">
                      <span className="graff-chart-tooltip__label">
                        {language === "en"
                          ? "Min"
                          : language === "ru"
                            ? "Мин"
                            : language === "uz_lat"
                              ? "Min"
                              : "Мин"}
                      </span>
                      <span className="graff-chart-tooltip__value">
                        {floatingTooltip.minStr}
                      </span>
                    </div>
                  </div>
                </div>,
                document.body,
              )}
          </div>
        </div>
      </div>
    );
  };
  render() {
    const {
      loading,
      error,
      records,
      isDarkTheme,
      connectionStatus,
      selecteduniqueid,
      currentPage,
      totalRecordCount,
      configuredFields,
      regionalFilters,
      language,
      searchText = "",
      searchError = null,
      isSearchActive = false,
      viewMode,
    } = this.state;

    const uniqueIdHeader = "UID";
    const vhHeaderLabel =
      language === "en" ? "Status" : language === "ru"
        ? "Состояние"
        : language === "uz_lat"
          ? "Holat"
          : "Ҳолат";

    const activeFiltersLabel =
      language === "en" ? "Active filters" : language === "ru"
        ? "Активные фильтры"
        : language === "uz_lat"
          ? "Faol filtrlar"
          : "Фаол фильтрлар";

    const viloyatLabel =
      language === "en" ? "Region" : language === "ru"
        ? "Область"
        : language === "uz_lat"
          ? "Viloyat"
          : "Вилоят";
    const tumanLabel =
      language === "en" ? "District" : language === "ru" ? "Район" : language === "uz_lat" ? "Tuman" : "Туман";
    const regionLabel =
      language === "en" ? "Region" : language === "ru"
        ? "Регион"
        : language === "uz_lat"
          ? "Region"
          : "Регион";
    const districtLabel =
      language === "en" ? "District" : language === "ru" ? "Район" : language === "uz_lat" ? "Tuman" : "Туман";
    const yilLabel =
      language === "en" ? "Year" : language === "ru" ? "Год" : language === "uz_lat" ? "Yil" : "Йил";
    const turiLabel =
      language === "en" ? "Crop type" : language === "ru"
        ? "Тип посева"
        : language === "uz_lat"
          ? "Ekin turi"
          : "Экин тури";
    const vhLabel = language === "en" ? "VS" : language === "uz_lat" ? "VH" : "ВХ";
    const maydonLabel =
      language === "en" ? "Area" : language === "ru"
        ? "Площадь"
        : language === "uz_lat"
          ? "Maydon"
          : "Майдон";
    const nameLabel =
      language === "en" ? "Name" : language === "ru" ? "Имя" : language === "uz_lat" ? "Nom" : "Ном";
    const shapeLengLabel =
      language === "en" ? "Boundary length" : language === "ru"
        ? "Длина границы"
        : language === "uz_lat"
          ? "Chegara uzunligi"
          : "Чегара узунлиғи";
    const globalIdLabel =
      language === "en" ? "Global ID" : language === "ru"
        ? "Глобальный ID"
        : language === "uz_lat"
          ? "Global ID"
          : "Глобал ID";
    const fNameLabel =
      language === "en" ? "Farmer name" : language === "ru"
        ? "Название фермера"
        : language === "uz_lat"
          ? "Fermer nomi"
          : "Фермер номи";
    const fInnLabel =
      language === "en"
        ? "TIN"
        : language === "ru"
          ? "ИНН"
          : language === "uz_lat"
            ? "STIR"
            : "СТИР";
    const fCadLabel =
      language === "en" ? "Cadastral number" : language === "ru"
        ? "Кадастровый номер"
        : language === "uz_lat"
          ? "Kadastr raqami"
          : "Кадастр рақами";
    const yldLabel =
      language === "en" ? "Yield" : language === "ru"
        ? "Урожайность"
        : language === "uz_lat"
          ? "Hosildorlik"
          : "Ҳосилдорлик";
    const numericIdLabel =
      language === "en" ? "Numeric ID" : language === "ru"
        ? "Числовой ID"
        : language === "uz_lat"
          ? "Raqamli ID"
          : "Рақамли ID";
    const tableTitle =
      language === "en"
        ? "TABLE"
        : language === "ru"
          ? "ТАБЛИЦА"
          : language === "uz_lat"
            ? "JADVAL"
            : "ЖАДВАЛ";

    const uiText = (en: string, ru: string, uzLat: string, uzCyr: string) =>
      language === "en" ? en : language === "ru" ? ru : language === "uz_lat" ? uzLat : uzCyr;
    const themeClass = isDarkTheme ? "dark-theme" : "light-theme";
    const regionalInteraction = this.isRegionalInteractionEnabled();
    const isInitializing =
      connectionStatus === "connecting" || connectionStatus === "idle";

    // 🔎 Client-side refine (server already filters when isSearchActive)
    const getFilteredRecords = (): RecordData[] => {
      const term = (searchText || "").trim().toLowerCase();
      if (!term) return records;

      return records.filter((record) => {
        const fname = String(record.f_name || "").toLowerCase();
        const finn = String(record.f_inn || "").toLowerCase();
        return fname.includes(term) || finn.includes(term);
      });
    };

    const filteredRecords = getFilteredRecords();
    const pageSize = this.RECORDS_PER_PAGE;
    const totalPages = Math.max(
      1,
      Math.ceil((totalRecordCount || 0) / pageSize) || 1,
    );
    const safePage = Math.min(Math.max(1, currentPage || 1), totalPages);
    const paginationTotalLabel = uiText("Total", "Всего", "Jami", "Жами");
    const paginationPageLabel = uiText("Page", "Страница", "Sahifa", "Саҳифа");
    const paginationRowsLabel = uiText("Rows", "Строк", "Qator", "Қатор");

    const hasActiveSearch = isSearchActive && Boolean(searchText.trim());
    const needYear =
      connectionStatus === "connected" &&
      !regionalFilters?.yil &&
      !hasActiveSearch;
    const needViloyat = false; // republic-wide by default

    const activeFilterCount =
      Object.values(this.state.externalFilters || {}).filter(Boolean).length +
      Object.values(this.state.localFilters || {}).filter(Boolean).length +
      Object.values(regionalFilters || {}).filter(Boolean).length;

    const displayFields = this.getDisplayFields();

    return (
      <div className={`kadastr-status-card ${themeClass}`}>
        {/* Hidden mounts for DS/Map */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            pointerEvents: "none",
            opacity: 0,
          }}
        >
          {this.props.useMapWidgetIds?.length > 0 && (
            <JimuMapViewComponent
              useMapWidgetId={this.props.useMapWidgetIds[0]}
              onActiveViewChange={this.onActiveViewChange}
            />
          )}
        </div>

        <div className="kadastr-status-content">
          {/* Conditional Rendering based on viewMode */}
          {viewMode === "table" ? (
            <>
              <div className="kadastr-table-topbar">
                <div className="kadastr-table-top-label">{tableTitle}</div>
                {this.renderViewModeToggle("table")}
              </div>

              {/* Search actions removed by request */}

              {searchError && (
                <div className="kadastr-status-error" style={{ padding: 8 }}>
                  <p>{this.localizeRuntimeMessage(searchError)}</p>
                </div>
              )}

              {/* ===================== MAIN STATE RENDER ===================== */}
              {configuredFields.length === 0 && !isInitializing ? (
                <div className="kadastr-status-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
                  <h3>{uiText("Widget fields are required", "Требуются поля виджета", "Widget maydonlari talab qilinadi", "Виджет майдонлари талаб қилинади")}</h3>
                  <p>{uiText("Select widget fields in Settings.", "Выберите поля виджета в настройках.", "Widget maydonlarini sozlamalarda tanlang.", "Виджет майдонларини созламаларда танланг.")}</p>
                </div>
              ) : isInitializing ? (
                <div className="kadastr-status-loading-container">
                  <AgriChartLoader />
                </div>
              ) : connectionStatus === "failed" ? (
                <div className="kadastr-status-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
                  <p>
                    {this.localizeRuntimeMessage(error) || uiText("Could not connect to the map. Try again.", "Не удалось подключиться к карте. Попробуйте снова.", "Xaritaga ulana olmadi. Qayta urinib ko'ring.", "Харитага улана олмади. Қайта уриниб кўринг.")}
                  </p>
                  <button
                    onClick={this.retryMapConnection}
                    className="kadastr-status-retry-button"
                  >
                    {uiText("Reconnect", "Подключиться снова", "Qayta ulanish", "Қайта уланиш")}
                  </button>
                </div>
              ) : error ? (
                <div className="kadastr-status-error">
              <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
                  <p>{this.localizeRuntimeMessage(error)}</p>
                  <button
                    onClick={() => void this.fetchData()}
                    className="kadastr-status-retry-button"
                  >
                    {uiText("Retry", "Повторить", "Qayta urinish", "Қайта уриниш")}
                  </button>
                </div>
              ) : needYear ||
                (connectionStatus === "connected" &&
                  filteredRecords.length === 0 &&
                  (loading || !this._hasCompletedTableFetch)) ? (
                <div className="kadastr-status-loading-container">
                  <AgriChartLoader />
                </div>
              ) : connectionStatus === "connected" && loading ? (
                <div className="kadastr-status-loading-container">
                  <AgriChartLoader />
                </div>
              ) : connectionStatus === "connected" &&
                !loading &&
                this._hasCompletedTableFetch &&
                filteredRecords.length === 0 ? (
                <div className="kadastr-status-no-data">
                  <TriangleAlert className="agri-empty-state-icon" strokeWidth={1.7} aria-hidden="true" />
                  <h3>{agriNoDataLabel(language)}</h3>
                </div>
              ) : (
                <div className="kadastr-table-frame">
                  <div
                    className="kadastr-status-table-container"
                    ref={this.tableContainerRef}
                  >
                  <table className="kadastr-status-table">
                    <thead>
                      <tr>
                        {displayFields.map((fieldName) => {
                          const isVh = fieldName.toLowerCase() === "vh";
                          const lower = fieldName.toLowerCase();
                          let label: string;
                          if (isVh) label = vhHeaderLabel;
                          else if (lower === "tuman") label = tumanLabel;
                          else if (lower === "viloyat") label = viloyatLabel;
                          else if (lower === "region") label = regionLabel;
                          else if (lower === "district") label = districtLabel;
                          else if (lower === "yil") label = yilLabel;
                          else if (lower === "turi" || lower === "uzspace")
                            label = turiLabel;
                          else if (
                            lower === "shape_leng" ||
                            lower === "shape_length"
                          )
                            label = shapeLengLabel;
                          else if (
                            lower === "globalid_1" ||
                            lower === "globalid" ||
                            lower.startsWith("globalid")
                          )
                            label = globalIdLabel;
                          else if (lower === "f_name") label = fNameLabel;
                          else if (lower === "f_inn") label = fInnLabel;
                          else if (lower === "f_cad") label = fCadLabel;
                          else if (lower === "yld") label = yldLabel;
                          else if (lower === "numeric_id")
                            label = numericIdLabel;
                          else if (lower === "uniqueid") label = uniqueIdHeader;
                          else if (lower === "maydon") label = maydonLabel;
                          else if (
                            lower.includes("maydon") ||
                            lower.includes("area")
                          )
                            label = maydonLabel;
                          else if (
                            lower.includes("name") ||
                            lower.includes("nom")
                          )
                            label = nameLabel;
                          else label = this.getFieldDisplayName(fieldName);

                          const isMaydonSortable =
                            lower === "maydon" ||
                            lower.includes("maydon") ||
                            lower.includes("area");
                          if (isMaydonSortable) {
                            const sort = this.state.tableSort;
                            const isActive = sort?.column === "maydon";
                            const isAsc = isActive && sort?.order === "asc";
                            return (
                              <th key={fieldName}>
                                <button
                                  type="button"
                                  className={`kadastr-table-sort-btn${
                                    isActive
                                      ? " kadastr-table-sort-btn--active"
                                      : ""
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    this.toggleMaydonSort();
                                  }}
                                  aria-label={`${label} sort`}
                                >
                                  <span>{label}</span>
                                  <ChevronDown
                                    className={`kadastr-table-sort-icon${
                                      isAsc
                                        ? " kadastr-table-sort-icon--asc"
                                        : ""
                                    }${
                                      !isActive
                                        ? " kadastr-table-sort-icon--off"
                                        : ""
                                    }`}
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                  />
                                </button>
                              </th>
                            );
                          }

                          return <th key={fieldName}>{label}</th>;
                        })}
                      </tr>
                    </thead>

                    <tbody>
                      {filteredRecords.map((record, index) => {
                        const recordId =
                          record.uniqueid || record.objectid?.toString();
                        const isSelected =
                          selecteduniqueid &&
                          recordId &&
                          this.recordMatchesUniqueid(record, selecteduniqueid);

                        return (
                          <tr
                            key={`${record.uniqueid || record.objectid}-${index}`}
                            data-uniqueid={recordId || undefined}
                            onClick={() =>
                              regionalInteraction &&
                              this.handleRowClick(record)
                            }
                            className={`kadastr-table-row${
                              isSelected ? " selected-row" : ""
                            }`}
                            title={
                              regionalInteraction
                                ? "Харитада кўрсатиш ва график учун танлаш"
                                : ""
                            }
                            style={{
                              cursor: regionalInteraction
                                ? "pointer"
                                : "default",
                            }}
                          >
                            {displayFields.map((fieldName) => {
                              const isVh = fieldName.toLowerCase() === "vh";
                              const rawValue = isVh
                                ? this.getStatusValueForRecord(record)
                                : record[fieldName];
                              return (
                                <td
                                  key={fieldName}
                                  title={this.formatFieldValue(
                                    fieldName,
                                    rawValue,
                                  )}
                                >
                                  <span className="kadastr-table-cell-text">
                                    {this.formatFieldValue(fieldName, rawValue)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {totalRecordCount > pageSize ? (
                    <div
                      className="contours-table__pagination"
                      aria-label="Table pagination"
                    >
                      <span className="contours-table__pagination-chip contours-table__pagination-range">
                        <span className="contours-table__pagination-label">
                          {paginationTotalLabel}
                        </span>
                        <span className="contours-table__pagination-value">
                          {totalRecordCount}
                        </span>
                      </span>
                      <div className="contours-table__pagination-actions">
                        <button
                          type="button"
                          className="contours-table__pagination-btn"
                          disabled={safePage <= 1 || loading}
                          onClick={() => this.goToTablePage(safePage - 1)}
                          aria-label="Previous page"
                        >
                          <ChevronLeft
                            className="contours-table__pagination-btn-icon"
                            strokeWidth={1.75}
                          />
                        </button>
                        <span className="contours-table__pagination-chip contours-table__pagination-page">
                          <span className="contours-table__pagination-label">
                            {paginationPageLabel}
                          </span>
                          <span className="contours-table__pagination-value">
                            {safePage} / {totalPages}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="contours-table__pagination-btn"
                          disabled={safePage >= totalPages || loading}
                          onClick={() => this.goToTablePage(safePage + 1)}
                          aria-label="Next page"
                        >
                          <ChevronRight
                            className="contours-table__pagination-btn-icon"
                            strokeWidth={1.75}
                          />
                        </button>
                      </div>
                      <span className="contours-table__pagination-chip contours-table__pagination-size">
                        <span className="contours-table__pagination-label">
                          {paginationRowsLabel}
                        </span>
                        <span className="contours-table__pagination-value">
                          {pageSize}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Graph View */
            <>
              {this.renderGraph()}
            </>
          )}
        </div>
      </div>
    );
  }
}

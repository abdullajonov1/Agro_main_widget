/**
 * Client for the api-agri.sgm.uzspace.uz REST API — per-polygon vegetation
 * index available dates and colored raster exports.
 *
 * Separate from agri-vegetation-data-source.ts (which queries the raw
 * ArcGIS agri_vegetation_indices Table directly): that table has scalar
 * index values per (uniqueid, raster_date), fine for charts and the
 * region-wide status bar, but no pixel data. This API is used specifically
 * for the single-selected-polygon case in AgriGraff10, where we need an
 * actual rendered, georeferenced raster image to overlay on the map.
 */
import { addDecoder, fromArrayBuffer } from "geotiff";
import {
  DeflateDecoder,
  JpegDecoder,
  LercDecoder,
  LzwDecoder,
  PackbitsDecoder,
  RawDecoder,
  WebImageDecoder,
  ZstdDecoder,
  lercZstd,
  zstdInit,
} from "../vendor/geotiff-decoders";
import { getAgriServiceUrls } from "../shared/agri-service-urls";
import { getTuriCropLookupKey } from "../shared/agri-crop-labels";

// PreferWorker=false — Portal custom widgets cannot load geotiff's async
// widgets/chunks/* (publicPath → jimuConfig.baseUrl → 404 on Enterprise).
addDecoder([undefined, 1], async () => RawDecoder as any, undefined, false);
addDecoder(5, async () => LzwDecoder as any, undefined, false);
addDecoder(7, async () => JpegDecoder as any, undefined, false);
addDecoder([8, 32946], async () => DeflateDecoder as any, undefined, false);
addDecoder(32773, async () => PackbitsDecoder as any, undefined, false);
addDecoder(
  34887,
  async () => {
    if (typeof (lercZstd as any)?.init === "function") {
      await (lercZstd as any).init();
    }
    return LercDecoder as any;
  },
  undefined,
  false,
);
addDecoder(
  50000,
  async () => {
    if (typeof (zstdInit as any)?.init === "function") {
      await (zstdInit as any).init();
    }
    return ZstdDecoder as any;
  },
  undefined,
  false,
);
addDecoder(50001, async () => WebImageDecoder as any, undefined, false);

export function getAgriPolygonApiBaseUrl(): string {
  return getAgriServiceUrls().polygonApiBaseUrl;
}

/** Logger disabled — keep call sites without console noise. */
export function agriPolygonApiLog(
  _phase: string,
  _detail?: Record<string, unknown>,
): void {
  /* no-op */
}

export interface PolygonAvailableDatesResponse {
  uniqueid: string;
  region: string;
  year: number;
  count: number;
  dates: string[];
}

/**
 * GET /v1/polygon/{uniqueid}/available-dates
 * Confirmed response shape: { uniqueid, region, year, count, dates: [] }
 * In-flight + short TTL cache so Popup prefetch + Graff share one GET.
 */
const availableDatesInFlight = new Map<string, Promise<string[]>>();
const availableDatesCache = new Map<
  string,
  { dates: string[]; at: number }
>();
const AVAILABLE_DATES_TTL_MS = 60_000;

export async function fetchPolygonAvailableDates(
  uniqueid: string,
  regionId: number,
  year: number,
): Promise<string[]> {
  const id = String(uniqueid || "").replace(/[{}]/g, "").trim();
  const key = `${id}|${regionId}|${year}`;
  const cached = availableDatesCache.get(key);
  if (cached && Date.now() - cached.at < AVAILABLE_DATES_TTL_MS) {
    return cached.dates.slice();
  }
  let pending = availableDatesInFlight.get(key);
  if (!pending) {
    pending = fetchPolygonAvailableDatesUncached(id, regionId, year)
      .then((dates) => {
        availableDatesCache.set(key, { dates, at: Date.now() });
        while (availableDatesCache.size > 64) {
          const oldest = availableDatesCache.keys().next().value;
          if (oldest == null) break;
          availableDatesCache.delete(oldest);
        }
        return dates;
      })
      .finally(() => {
        availableDatesInFlight.delete(key);
      });
    availableDatesInFlight.set(key, pending);
  }
  return pending;
}

async function fetchPolygonAvailableDatesUncached(
  uniqueid: string,
  regionId: number,
  year: number,
): Promise<string[]> {
  const url =
    `${getAgriPolygonApiBaseUrl()}/v1/polygon/${encodeURIComponent(uniqueid)}/available-dates` +
    `?region_id=${encodeURIComponent(String(regionId))}&year=${encodeURIComponent(String(year))}`;
  agriPolygonApiLog("available-dates:request", { url, uniqueid, regionId, year });

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    agriPolygonApiLog("available-dates:FAILED", { url, status: res.status });
    throw new Error(`HTTP ${res.status}`);
  }
  const json: PolygonAvailableDatesResponse = await res.json();
  agriPolygonApiLog("available-dates:response", {
    uniqueid,
    count: json?.count,
    dates: json?.dates,
  });
  return Array.isArray(json?.dates) ? json.dates : [];
}

export type VegetationIndiceType =
  | "ndvi"
  | "savi"
  | "rvi"
  | "ci"
  | "evi"
  | "ndre"
  | "ndwi";

export interface PolygonExportImageResult {
  /** Decoded, colored raster drawn onto a canvas (RGBA), ready to display. */
  canvas: HTMLCanvasElement;
  /** [minX, minY, maxX, maxY], read directly from the GeoTIFF's own geo tags. */
  bbox: [number, number, number, number];
  /** EPSG/WKID read from the GeoTIFF geo keys, when present. */
  epsgCode: number | null;
  width: number;
  height: number;
  /**
   * Row-major per-pixel index values for map hover tooltips.
   * Prefer values calibrated from export-image `X-Index-Min` / `X-Index-Max`
   * headers (not raw TIFF stretch / RGB reverse on a 0..1 ramp).
   */
  values: Float32Array | null;
  /**
   * Row-major RGBA (length width*height*4) for lazy hover sampling on RGB TIFFs.
   * Null when `values` already holds calibrated indices.
   */
  rgba: Uint8ClampedArray | null;
  /** Sentinel for transparent / outside-polygon pixels. */
  noData: number | null;
  /** From response header `X-Index-Min` (field stats for this export). */
  indexMin: number | null;
  /** From response header `X-Index-Max`. */
  indexMax: number | null;
  /** From response header `X-Index-Mean`. */
  indexMean: number | null;
}

/** Read api-agri export-image stats headers (sent with response_format=tiff). */
export function parseExportImageIndexHeaders(headers: Headers): {
  indexMin: number | null;
  indexMax: number | null;
  indexMean: number | null;
} {
  const read = (name: string): number | null => {
    const raw =
      headers.get(name) ||
      headers.get(name.toLowerCase()) ||
      headers.get(name.replace(/X-/i, "x-"));
    if (raw == null || String(raw).trim() === "") return null;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : null;
  };
  return {
    indexMin: read("X-Index-Min"),
    indexMax: read("X-Index-Max"),
    indexMean: read("X-Index-Mean"),
  };
}

/**
 * Map a 0..1 colormap / stretch position onto the real index range from
 * export-image headers (chart min/max). Without headers, returns t01 as-is.
 */
export function mapStretch01ToIndexRange(
  t01: number,
  indexMin: number | null,
  indexMax: number | null,
): number {
  if (!Number.isFinite(t01)) return t01;
  if (
    indexMin == null ||
    indexMax == null ||
    !Number.isFinite(indexMin) ||
    !Number.isFinite(indexMax) ||
    !(indexMax > indexMin)
  ) {
    return t01;
  }
  const t = Math.max(0, Math.min(1, t01));
  return indexMin + t * (indexMax - indexMin);
}

/** Classic vegetation color stops (low → high) for client-side colorize + RGB reverse. */
const VEG_COLOR_STOPS: Array<{ v: number; r: number; g: number; b: number }> = [
  { v: 0.0, r: 165, g: 0, b: 38 },
  { v: 0.15, r: 215, g: 48, b: 39 },
  { v: 0.3, r: 244, g: 109, b: 67 },
  { v: 0.45, r: 253, g: 174, b: 97 },
  { v: 0.55, r: 254, g: 224, b: 139 },
  { v: 0.65, r: 217, g: 239, b: 139 },
  { v: 0.75, r: 166, g: 217, b: 106 },
  { v: 0.85, r: 102, g: 189, b: 99 },
  { v: 0.95, r: 26, g: 152, b: 80 },
  { v: 1.0, r: 0, g: 104, b: 55 },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function colorizeIndexValue(
  value: number,
  out: Uint8ClampedArray,
  offset: number,
): void {
  if (!Number.isFinite(value)) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    return;
  }
  const v = Math.max(0, Math.min(1, value));
  let i = 0;
  while (i < VEG_COLOR_STOPS.length - 1 && VEG_COLOR_STOPS[i + 1].v < v) i++;
  const a = VEG_COLOR_STOPS[i];
  const b = VEG_COLOR_STOPS[Math.min(i + 1, VEG_COLOR_STOPS.length - 1)];
  const span = b.v - a.v || 1;
  const t = (v - a.v) / span;
  out[offset] = Math.round(lerp(a.r, b.r, t));
  out[offset + 1] = Math.round(lerp(a.g, b.g, t));
  out[offset + 2] = Math.round(lerp(a.b, b.b, t));
  out[offset + 3] = 255;
}

/**
 * Recover an approximate continuous index (0..1) from a pre-colored RGB pixel.
 * Projects onto the nearest segment of VEG_COLOR_STOPS (not nearest stop only),
 * so hover shows values like 0.22 / 0.37 instead of only 0.15 / 0.30 / 0.45.
 * Still an approximation when the TIFF has no float band — true NDVI needs floats.
 */
export function sampleIndexFromRgba(
  r: number,
  g: number,
  b: number,
  a?: number,
): number | null {
  if (a != null && a < 8) return null;
  if (r + g + b < 8) return null;

  let bestVal = 0;
  let bestDist = Infinity;

  for (let i = 0; i < VEG_COLOR_STOPS.length - 1; i++) {
    const stopA = VEG_COLOR_STOPS[i];
    const stopC = VEG_COLOR_STOPS[i + 1];
    const abx = stopC.r - stopA.r;
    const aby = stopC.g - stopA.g;
    const abz = stopC.b - stopA.b;
    const ab2 = abx * abx + aby * aby + abz * abz || 1;
    const apx = r - stopA.r;
    const apy = g - stopA.g;
    const apz = b - stopA.b;
    let t = (apx * abx + apy * aby + apz * abz) / ab2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = stopA.r + abx * t;
    const cy = stopA.g + aby * t;
    const cz = stopA.b + abz * t;
    const dr = r - cx;
    const dg = g - cy;
    const db = b - cz;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestVal = stopA.v + (stopC.v - stopA.v) * t;
    }
  }

  return bestVal;
}

/** Session cache: first click pays network+decode; repeats reuse the canvas. */
const exportImageCache = new Map<string, Promise<PolygonExportImageResult>>();
const EXPORT_IMAGE_CACHE_MAX = 24;

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * export-image rejects dates outside a crop's index season with HTTP 400, e.g.
 * "Indices for crop_id=6 (wheat) are calculated only in March, April; September
 * is outside the season". /available-dates lists every scene date regardless of
 * crop, so an out-of-season date is a normal answer there — the season is only
 * discoverable from this error.
 */
export function isExportImageOutOfSeasonError(err: unknown): boolean {
  const status = Number((err as any)?.status);
  const text = String(
    (err as any)?.responseText || (err as any)?.message || "",
  );
  if (status !== 400 && !/HTTP\s+400/i.test(text)) return false;
  return /outside the season|calculated only in/i.test(text);
}

/** Month numbers (1–12) named in an out-of-season export-image error. */
export function parseExportImageSeasonMonths(err: unknown): number[] {
  const text = String(
    (err as any)?.responseText || (err as any)?.message || err || "",
  ).toLowerCase();
  const marker = text.indexOf("calculated only in");
  if (marker < 0) return [];
  // Stop before the "; <Month> is outside the season" tail — that month is NOT allowed.
  const tail = text.slice(marker);
  const allowedPart = tail.split(";")[0];
  const months = new Set<number>();
  for (const [name, num] of Object.entries(MONTH_NAME_TO_NUMBER)) {
    if (allowedPart.includes(name)) months.add(num);
  }
  return Array.from(months).sort((a, b) => a - b);
}

/** crop_id from "Indices for crop_id=6 (wheat) are calculated only in …". */
export function parseExportImageCropId(err: unknown): number | null {
  const text = String(
    (err as any)?.responseText || (err as any)?.message || err || "",
  );
  const match = text.match(/crop_id\s*=\s*(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

/**
 * Default index seasons for crops whose export-image rules are known from the
 * API. Without this, the first click probes /available-dates' latest scene
 * (often September) and burns a 400 before learning the season from the error.
 */
const DEFAULT_CROP_INDEX_SEASON_MONTHS: Record<number, number[]> = {
  6: [3, 4], // wheat / Bug'doy
};

export function getDefaultCropIndexSeasonMonths(
  cropId?: number | null,
): number[] {
  if (cropId == null || !Number.isFinite(Number(cropId))) return [];
  const months = DEFAULT_CROP_INDEX_SEASON_MONTHS[Number(cropId)];
  return months ? months.slice() : [];
}

/** Per-polygon index season learned from a 400. */
const seasonMonthsByUniqueid = new Map<string, number[]>();
/** Same season shared by all polygons of that crop_id (wheat=6 → Mar/Apr). */
const seasonMonthsByCropId = new Map<number, number[]>();
/**
 * Most recently learned season. Used when the next table row's crop_id is not
 * known yet — without this every new uniqueid re-tries September and 400s.
 * Overwritten when a different crop's season is discovered.
 */
let lastLearnedSeasonMonths: number[] = [];

/** region|date pairs export-image refused with "No imagery available". */
const regionDatesWithoutImagery = new Set<string>();
/** region|date pairs export-image has served (HTTP 200). */
const regionDatesWithImagery = new Set<string>();

/**
 * Everything learned from export-image (season per crop, regional scene gaps
 * and proven scenes) is mirrored to localStorage and re-read before use.
 *
 * This is NOT only for reloads: every Experience Builder widget (GraffPanel,
 * PopupPanel, …) gets its own webpack runtime and therefore its own instance
 * of this module — in-memory Maps here are per widget. Without the shared
 * store the map-click path (PopupPanel) re-probes September and the same
 * regional gaps GraffPanel already learned, producing fresh 400s.
 */
const EXPORT_IMAGE_KNOWLEDGE_STORAGE_KEY = "agri_export_image_knowledge_v1";
const KNOWLEDGE_SYNC_MIN_INTERVAL_MS = 300;
let lastKnowledgeSyncAt = 0;
let knowledgeStorageSignature = "";

interface ExportImageKnowledge {
  gaps?: string[];
  scenes?: string[];
  seasonsByCrop?: Record<string, number[]>;
  seasonsByUid?: Record<string, number[]>;
  lastSeason?: number[];
}

function isValidRegionDateKey(key: unknown): key is string {
  return typeof key === "string" && /^\d+\|\d{4}-\d{2}-\d{2}$/.test(key);
}

function sanitizeMonths(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((m) => Number(m))
        .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12),
    ),
  ).sort((a, b) => a - b);
}

function syncExportImageKnowledgeFromStorage(force = false): void {
  const now = Date.now();
  if (!force && now - lastKnowledgeSyncAt < KNOWLEDGE_SYNC_MIN_INTERVAL_MS) {
    return;
  }
  lastKnowledgeSyncAt = now;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(EXPORT_IMAGE_KNOWLEDGE_STORAGE_KEY);
    if (!raw || raw === knowledgeStorageSignature) return;
    knowledgeStorageSignature = raw;
    const parsed = JSON.parse(raw) as ExportImageKnowledge;
    if (!parsed || typeof parsed !== "object") return;
    for (const key of parsed.gaps || []) {
      if (isValidRegionDateKey(key)) regionDatesWithoutImagery.add(key);
    }
    for (const key of parsed.scenes || []) {
      if (isValidRegionDateKey(key)) regionDatesWithImagery.add(key);
    }
    for (const [crop, months] of Object.entries(parsed.seasonsByCrop || {})) {
      const id = Number(crop);
      const list = sanitizeMonths(months);
      if (Number.isFinite(id) && list.length) seasonMonthsByCropId.set(id, list);
    }
    for (const [uid, months] of Object.entries(parsed.seasonsByUid || {})) {
      const list = sanitizeMonths(months);
      if (uid && list.length) seasonMonthsByUniqueid.set(uid, list);
    }
    if (!lastLearnedSeasonMonths.length) {
      const last = sanitizeMonths(parsed.lastSeason);
      if (last.length) lastLearnedSeasonMonths = last;
    }
  } catch {
    /* ignore */
  }
}

function persistExportImageKnowledge(): void {
  try {
    if (typeof localStorage === "undefined") return;
    // Merge with what other widget instances wrote meanwhile.
    syncExportImageKnowledgeFromStorage(true);
    const seasonsByCrop: Record<string, number[]> = {};
    for (const [crop, months] of seasonMonthsByCropId) {
      seasonsByCrop[String(crop)] = months;
    }
    const seasonsByUid: Record<string, number[]> = {};
    for (const [uid, months] of seasonMonthsByUniqueid) {
      seasonsByUid[uid] = months;
    }
    const payload: ExportImageKnowledge = {
      gaps: Array.from(regionDatesWithoutImagery),
      scenes: Array.from(regionDatesWithImagery),
      seasonsByCrop,
      seasonsByUid,
      lastSeason: lastLearnedSeasonMonths,
    };
    const raw = JSON.stringify(payload);
    knowledgeStorageSignature = raw;
    localStorage.setItem(EXPORT_IMAGE_KNOWLEDGE_STORAGE_KEY, raw);
  } catch {
    /* ignore */
  }
}

syncExportImageKnowledgeFromStorage(true);

function normalizeUniqueidKey(uniqueid: string): string {
  return String(uniqueid || "").replace(/[{}]/g, "").trim().toLowerCase();
}

export function rememberExportImageSeasonMonths(
  uniqueid: string,
  months: number[],
  cropId?: number | null,
): void {
  if (!months.length) return;
  lastLearnedSeasonMonths = months.slice();
  const key = normalizeUniqueidKey(uniqueid);
  if (key) {
    seasonMonthsByUniqueid.set(key, months.slice());
    while (seasonMonthsByUniqueid.size > 128) {
      const oldest = seasonMonthsByUniqueid.keys().next().value;
      if (oldest == null) break;
      seasonMonthsByUniqueid.delete(oldest);
    }
  }
  if (cropId != null && Number.isFinite(cropId)) {
    seasonMonthsByCropId.set(Number(cropId), months.slice());
  }
  persistExportImageKnowledge();
}

/**
 * Season months for export-image. Prefer this polygon's learned months, else
 * the crop_id's (learned or built-in default), else last session learn.
 */
export function getExportImageSeasonMonths(
  uniqueid: string,
  cropId?: number | null,
): number[] {
  syncExportImageKnowledgeFromStorage();
  const key = normalizeUniqueidKey(uniqueid);
  if (key) {
    const byUid = seasonMonthsByUniqueid.get(key);
    if (byUid?.length) return byUid;
  }
  if (cropId != null && Number.isFinite(cropId)) {
    const byCrop = seasonMonthsByCropId.get(Number(cropId));
    if (byCrop?.length) return byCrop;
    const defaults = getDefaultCropIndexSeasonMonths(cropId);
    if (defaults.length) return defaults;
  }
  return lastLearnedSeasonMonths.slice();
}

/** Newest→oldest export candidates (season + known imagery gaps). */
export function listExportRasterDateCandidates(
  dates: string[] | null | undefined,
  opts?: {
    uniqueid?: string;
    cropId?: number | null;
    regionId?: number | null;
    exclude?: string[];
    limit?: number;
  },
): string[] {
  const months = getExportImageSeasonMonths(
    opts?.uniqueid || "",
    opts?.cropId,
  );
  // Default 1 — one export-image at a time (caller retries on 400).
  const limit = Math.max(1, opts?.limit ?? 1);
  const out: string[] = [];
  const exclude = [...(opts?.exclude || [])];
  while (out.length < limit) {
    const next =
      pickLatestUsableExportDate(dates, {
        months,
        regionId: opts?.regionId,
        exclude,
      }) ||
      (!months.length
        ? pickLatestUsableExportDate(dates, {
            regionId: opts?.regionId,
            exclude,
          })
        : null);
    if (!next) break;
    out.push(next);
    exclude.push(next);
  }
  return out;
}

/**
 * Pick the newest available-dates entry that export-image is likely to serve
 * for this polygon (crop season + known regional imagery gaps).
 */
export function pickExportRasterDate(
  dates: string[] | null | undefined,
  opts?: {
    uniqueid?: string;
    cropId?: number | null;
    regionId?: number | null;
    exclude?: string[];
  },
): string | null {
  return (
    listExportRasterDateCandidates(dates, { ...opts, limit: 1 })[0] || null
  );
}

/** Latest YYYY-MM-DD whose month is in `months` (all dates when months empty). */
export function pickLatestDateInMonths(
  dates: string[] | null | undefined,
  months: number[],
): string | null {
  return pickLatestUsableExportDate(dates, { months });
}

/**
 * `/available-dates` lists dates that have *index records*, but export-image
 * also needs the region's raster scene for that day and answers
 * "No imagery available for region_id=… on …" (HTTP 400) when it is missing.
 * That gap is region-wide, so cache it for every polygon of the region.
 */
export function isExportImageNoImageryError(err: unknown): boolean {
  const status = Number((err as any)?.status);
  const text = String(
    (err as any)?.responseText || (err as any)?.message || "",
  );
  if (status !== 400 && !/HTTP\s+400/i.test(text)) return false;
  return /no imagery available/i.test(text);
}

function regionDateKey(regionId: number | null | undefined, date: string): string {
  return `${regionId ?? ""}|${String(date || "").slice(0, 10)}`;
}

export function rememberRegionDateWithoutImagery(
  regionId: number | null | undefined,
  date: string,
): void {
  const key = regionDateKey(regionId, date);
  if (!isValidRegionDateKey(key)) return;
  if (regionDatesWithoutImagery.has(key)) return;
  regionDatesWithoutImagery.add(key);
  while (regionDatesWithoutImagery.size > 512) {
    const oldest = regionDatesWithoutImagery.keys().next().value;
    if (oldest == null) break;
    regionDatesWithoutImagery.delete(oldest);
  }
  persistExportImageKnowledge();
}

export function isRegionDateWithoutImagery(
  regionId: number | null | undefined,
  date: string,
): boolean {
  syncExportImageKnowledgeFromStorage();
  return regionDatesWithoutImagery.has(regionDateKey(regionId, date));
}

export function rememberRegionDateWithImagery(
  regionId: number | null | undefined,
  date: string,
): void {
  const key = regionDateKey(regionId, date);
  if (!isValidRegionDateKey(key)) return;
  if (regionDatesWithImagery.has(key)) return;
  regionDatesWithImagery.add(key);
  while (regionDatesWithImagery.size > 512) {
    const oldest = regionDatesWithImagery.keys().next().value;
    if (oldest == null) break;
    regionDatesWithImagery.delete(oldest);
  }
  persistExportImageKnowledge();
}

export function isRegionDateWithImagery(
  regionId: number | null | undefined,
  date: string,
): boolean {
  syncExportImageKnowledgeFromStorage();
  return regionDatesWithImagery.has(regionDateKey(regionId, date));
}

/**
 * crop_id from a field polygon's attributes (table row or clicked graphic):
 * numeric crop_id/cropId first, else the turi name (wheat → 6 in api-agri).
 */
export function resolveCropIdFromAttributes(
  attrs: Record<string, any> | null | undefined,
): number | null {
  if (!attrs || typeof attrs !== "object") return null;
  let turi = "";
  for (const [key, value] of Object.entries(attrs)) {
    const lower = key.toLowerCase();
    if (lower === "crop_id" || lower === "cropid") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    } else if (lower === "turi" && value != null) {
      turi = String(value).trim();
    }
  }
  if (turi && getTuriCropLookupKey(turi) === "bugdoy") return 6;
  return null;
}

/**
 * Numeric region_id for export-image from a clicked polygon's attributes.
 * Needed when Localization has no viloyat selected (republic) or Portal
 * filter broadcast has not yet mapped viloyat→region.
 */
export function resolveRegionIdFromAttributes(
  attrs: Record<string, any> | null | undefined,
): number | null {
  if (!attrs || typeof attrs !== "object") return null;
  for (const [key, value] of Object.entries(attrs)) {
    const lower = key.toLowerCase();
    if (
      lower === "region" ||
      lower === "region_id" ||
      lower === "regionid"
    ) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Newest date export-image can plausibly serve: inside the crop season and not
 * already known to lack regional imagery.
 */
export function pickLatestUsableExportDate(
  dates: string[] | null | undefined,
  opts?: {
    months?: number[];
    regionId?: number | null;
    exclude?: string[];
  },
): string | null {
  const months = opts?.months || [];
  const exclude = new Set(
    (opts?.exclude || []).map((d) => String(d || "").slice(0, 10)),
  );
  const list = (dates || [])
    .map((d) => String(d || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => a.localeCompare(b));

  for (let i = list.length - 1; i >= 0; i--) {
    const date = list[i];
    if (exclude.has(date)) continue;
    if (months.length && !months.includes(Number(date.slice(5, 7)))) continue;
    if (
      opts?.regionId != null &&
      isRegionDateWithoutImagery(opts.regionId, date)
    ) {
      continue;
    }
    return date;
  }
  return null;
}

function exportImageCacheKey(params: {
  uniqueid: string;
  regionId: number;
  rasterDate: string;
  indiceType?: VegetationIndiceType;
  stretch?: "fixed" | "minmax";
}): string {
  return [
    String(params.uniqueid || "").replace(/[{}]/g, ""),
    params.regionId,
    params.rasterDate,
    params.indiceType || "ndvi",
    params.stretch || "fixed",
  ].join("|");
}

function cloneExportCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext("2d");
  if (ctx) ctx.drawImage(source, 0, 0);
  return copy;
}

/**
 * Best-effort TLS / DNS warmup for api-agri so the first field click does not
 * pay cold-connection cost on export-image.
 */
export function warmPolygonApiConnection(): void {
  try {
    void fetch(`${getAgriPolygonApiBaseUrl()}/`, {
      method: "GET",
      headers: { accept: "*/*" },
      mode: "cors",
      cache: "no-store",
    }).catch(() => {
      /* ignore — warmup only */
    });
  } catch {
    /* ignore */
  }
}

/**
 * GET /v1/polygon/{uniqueid}/export-image, requested with
 * response_format=tiff — fetches the raw GeoTIFF bytes directly (skips the
 * response_format=json envelope, whose exact stats/base64 field names
 * weren't confirmed) and decodes it client-side with geotiff.js. A GeoTIFF
 * carries its own extent + CRS in its tags, so no separate georeferencing
 * call is needed — read it straight off the decoded image.
 */
export async function fetchPolygonExportImageTiff(params: {
  uniqueid: string;
  regionId: number;
  /** YYYY-MM-DD */
  rasterDate: string;
  indiceType?: VegetationIndiceType;
  stretch?: "fixed" | "minmax";
}): Promise<PolygonExportImageResult> {
  const cacheKey = exportImageCacheKey(params);
  let pending = exportImageCache.get(cacheKey);
  if (!pending) {
    pending = fetchPolygonExportImageTiffUncached(params).catch((err) => {
      exportImageCache.delete(cacheKey);
      throw err;
    });
    exportImageCache.set(cacheKey, pending);
    while (exportImageCache.size > EXPORT_IMAGE_CACHE_MAX) {
      const oldest = exportImageCache.keys().next().value;
      if (oldest == null) break;
      exportImageCache.delete(oldest);
    }
  }
  const result = await pending;
  // Clone canvas so a later MediaLayer remove/reuse cannot blank a cached entry.
  return {
    ...result,
    canvas: cloneExportCanvas(result.canvas),
  };
}

/** One in-flight date-walk per polygon — kickOptimistic + fetchData share it. */
const exportDateWalkInFlight = new Map<
  string,
  Promise<{ date: string; result: PolygonExportImageResult } | null>
>();

/**
 * Fetch available-dates (or use provided), then try export-image **one date
 * at a time** (newest in-season first). On HTTP 400, learn season/imagery
 * gaps and step to the next candidate — never race 2–3 dates in parallel
 * (that was flooding Network on every polygon click).
 * Deduped so Popup prefetch + Graff share one walk per polygon.
 */
export async function resolveExportImageWithDateWalk(params: {
  uniqueid: string;
  regionId: number;
  year: number;
  indiceType?: VegetationIndiceType;
  cropId?: number | null;
  dates?: string[] | null;
  stretch?: "fixed" | "minmax";
}): Promise<{ date: string; result: PolygonExportImageResult } | null> {
  const id = normalizeUniqueidKey(params.uniqueid);
  if (!id) return null;
  const indiceType = params.indiceType || "ndvi";
  const key = `${id}|${params.regionId}|${indiceType}`;
  const existing = exportDateWalkInFlight.get(key);
  if (existing) return existing;
  // Pull what other widget instances learned (seasons, gaps, proven scenes).
  syncExportImageKnowledgeFromStorage(true);

  const walk = (async () => {
    let dates = params.dates || null;
    if (!dates?.length) {
      try {
        dates = await fetchPolygonAvailableDates(
          id,
          params.regionId,
          params.year,
        );
      } catch {
        return null;
      }
    }
    if (!dates?.length) return null;

    const tried: string[] = [];
    // Up to 4 sequential probes — stop at first HTTP 200.
    for (let round = 0; round < 4; round++) {
      const candidates = listExportRasterDateCandidates(dates, {
        uniqueid: id,
        cropId: params.cropId,
        regionId: params.regionId,
        exclude: tried,
        limit: 1,
      });
      if (!candidates.length) return null;
      const date = candidates[0];
      tried.push(date);

      try {
        const result = await fetchPolygonExportImageTiff({
          uniqueid: id,
          regionId: params.regionId,
          rasterDate: date,
          indiceType,
          stretch: params.stretch || "fixed",
        });
        rememberRegionDateWithImagery(params.regionId, date);
        return { date, result };
      } catch (err) {
        if (isExportImageOutOfSeasonError(err)) {
          const months = parseExportImageSeasonMonths(err);
          const crop = parseExportImageCropId(err);
          if (months.length) {
            rememberExportImageSeasonMonths(id, months, crop ?? params.cropId);
          }
        } else if (isExportImageNoImageryError(err)) {
          rememberRegionDateWithoutImagery(params.regionId, date);
        } else {
          // Non-season/imagery failure — do not burn remaining candidates.
          return null;
        }
      }
    }
    return null;
  })().finally(() => {
    exportDateWalkInFlight.delete(key);
  });

  exportDateWalkInFlight.set(key, walk);
  return walk;
}

async function fetchPolygonExportImageTiffUncached(params: {
  uniqueid: string;
  regionId: number;
  rasterDate: string;
  indiceType?: VegetationIndiceType;
  stretch?: "fixed" | "minmax";
}): Promise<PolygonExportImageResult> {
  const qs = new URLSearchParams({
    region_id: String(params.regionId),
    raster_date: params.rasterDate,
    indice_type: params.indiceType || "ndvi",
    stretch: params.stretch || "fixed",
    response_format: "tiff",
  });
  const url = `${getAgriPolygonApiBaseUrl()}/v1/polygon/${encodeURIComponent(params.uniqueid)}/export-image?${qs.toString()}`;
  agriPolygonApiLog("export-image:request", { url, ...params });

  // Bound hung export-image calls so the map loader cannot stick forever.
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId =
    controller && typeof setTimeout === "function"
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch {
            /* ignore */
          }
        }, 25000)
      : null;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "*/*" },
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err: any) {
    if (timeoutId) clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      throw new Error("Export-image so‘rovi vaqtidan oshdi (25s).");
    }
    throw err;
  }
  if (timeoutId) clearTimeout(timeoutId);
  if (!res.ok) {
    let responseText = '';
    try {
      responseText = await res.text();
    } catch (bodyError: any) {
      responseText = `<response body read failed: ${String(bodyError?.message || bodyError)}>`;
    }
    const contentType = res.headers.get('content-type') || '';
    agriPolygonApiLog('export-image:FAILED-response', {
      url,
      status: res.status,
      statusText: res.statusText,
      contentType,
      responseText,
    });
    const error = new Error(
      `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${responseText ? `: ${responseText}` : ''}`,
    ) as Error & {
      status?: number;
      statusText?: string;
      contentType?: string;
      responseText?: string;
      url?: string;
    };
    error.status = res.status;
    error.statusText = res.statusText;
    error.contentType = contentType;
    error.responseText = responseText;
    error.url = url;
    // Learn from every caller's 400 (not only the date walk) so the next
    // polygon in this region / crop never re-asks the same refused date.
    if (isExportImageNoImageryError(error)) {
      rememberRegionDateWithoutImagery(params.regionId, params.rasterDate);
    } else if (isExportImageOutOfSeasonError(error)) {
      const months = parseExportImageSeasonMonths(error);
      if (months.length) {
        rememberExportImageSeasonMonths(
          params.uniqueid,
          months,
          parseExportImageCropId(error),
        );
      }
    }
    throw error;
  }
  rememberRegionDateWithImagery(params.regionId, params.rasterDate);
  // Stats for this polygon+date — chart/hover must use these, not raw TIFF
  // stretch values (RGB reverse on a 0..1 ramp often shows ~0.9 while true
  // field NDVI max is ~0.5).
  const indexHeaders = parseExportImageIndexHeaders(res.headers);
  const buffer = await res.arrayBuffer();

  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox() as [number, number, number, number];
  const width = image.getWidth();
  const height = image.getHeight();
  const samplesPerPixel = image.getSamplesPerPixel();
  const pixelCount = width * height;
  if (
    !Array.isArray(bbox) ||
    bbox.length < 4 ||
    ![bbox[0], bbox[1], bbox[2], bbox[3]].every((n) => Number.isFinite(n)) ||
    !(bbox[2] > bbox[0]) ||
    !(bbox[3] > bbox[1]) ||
    !(width > 0) ||
    !(height > 0)
  ) {
    throw new Error("GeoTIFF bounding box/size invalid");
  }

  let epsgCode: number | null = null;
  try {
    const geoKeys: any = image.getGeoKeys();
    epsgCode =
      Number(geoKeys?.ProjectedCSTypeGeoKey) ||
      Number(geoKeys?.GeographicTypeGeoKey) ||
      null;
    if (!Number.isFinite(epsgCode as number)) epsgCode = null;
  } catch {
    epsgCode = null;
  }
  // Geographic coords without geo-keys: safe default. Projected metres without
  // an EPSG must not be tagged as the map view SR (causes stretch/misplace).
  if (epsgCode == null) {
    const absMax = Math.max(
      Math.abs(bbox[0]),
      Math.abs(bbox[1]),
      Math.abs(bbox[2]),
      Math.abs(bbox[3]),
    );
    if (absMax <= 180) epsgCode = 4326;
  }

  let noData: number | null = null;
  try {
    const gd = Number((image as any).getGDALNoData?.());
    noData = Number.isFinite(gd) ? gd : null;
  } catch {
    noData = null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const imageData = ctx.createImageData(width, height);
  const out = imageData.data;
  const clamp255 = (v: unknown): number => {
    const n = Math.round(Number(v) || 0);
    return n < 0 ? 0 : n > 255 ? 255 : n;
  };

  let hoverValues: Float32Array | null = null;
  let dataMin = Infinity;
  let dataMax = -Infinity;

  if (samplesPerPixel >= 3) {
    // Pre-colored RGB/RGBA: one interleaved read only (was double-read before).
    const raster = (await image.readRasters({ interleave: true })) as
      | Uint8Array
      | Uint8ClampedArray
      | Float32Array
      | number[];
    const stride = samplesPerPixel;
    if (samplesPerPixel >= 4) {
      for (let p = 0; p < pixelCount; p++) {
        const o = p * stride;
        out[p * 4] = clamp255(raster[o]);
        out[p * 4 + 1] = clamp255(raster[o + 1]);
        out[p * 4 + 2] = clamp255(raster[o + 2]);
        out[p * 4 + 3] = clamp255(raster[o + 3]);
      }
    } else {
      for (let p = 0; p < pixelCount; p++) {
        const o = p * 3;
        out[p * 4] = clamp255(raster[o]);
        out[p * 4 + 1] = clamp255(raster[o + 1]);
        out[p * 4 + 2] = clamp255(raster[o + 2]);
        out[p * 4 + 3] = 255;
      }
    }
  } else {
    const bands = (await image.readRasters({ interleave: false })) as any[];
    const band0 = bands?.[0];
    const values = new Float32Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      const raw = Number(band0?.[p]);
      const v = Number.isFinite(raw) ? raw : NaN;
      values[p] = v;
      if (Number.isFinite(v) && (noData == null || v !== noData)) {
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
    }

    const looksLikeIndex =
      Number.isFinite(dataMin) &&
      Number.isFinite(dataMax) &&
      dataMin >= -1.5 &&
      dataMax <= 1.5;
    const looksLikeByte =
      Number.isFinite(dataMin) &&
      Number.isFinite(dataMax) &&
      dataMax > 2 &&
      dataMax <= 255;

    if (looksLikeIndex) {
      hoverValues = values;
    } else if (looksLikeByte) {
      hoverValues = new Float32Array(pixelCount);
      for (let p = 0; p < pixelCount; p++) {
        const v = values[p];
        hoverValues[p] =
          !Number.isFinite(v) || v <= 0 || (noData != null && v === noData)
            ? NaN
            : v / 255;
      }
    }

    if (looksLikeIndex || (looksLikeByte && hoverValues)) {
      const src = hoverValues || values;
      for (let p = 0; p < pixelCount; p++) {
        colorizeIndexValue(src[p], out, p * 4);
      }
    } else {
      for (let p = 0; p < pixelCount; p++) {
        const v = clamp255(values[p]);
        out[p * 4] = v;
        out[p * 4 + 1] = v;
        out[p * 4 + 2] = v;
        out[p * 4 + 3] = v > 0 ? 255 : 0;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const { indexMin, indexMax, indexMean } = indexHeaders;
  const hasHeaderRange =
    indexMin != null &&
    indexMax != null &&
    Number.isFinite(indexMin) &&
    Number.isFinite(indexMax) &&
    indexMax > indexMin;

  // Calibrate hover to header min/max. Server stretch=fixed paints a 0..1
  // colormap; sampleIndexFromRgba / float 0..1 must be remapped to the real
  // field range (e.g. 0.15–0.57) so tooltip matches Index chart stats.
  let calibratedValues: Float32Array | null = null;
  if (hasHeaderRange && hoverValues) {
    // Float band already in header range → keep as-is. Remap only when the
    // band looks like a 0..1 stretch (max well above X-Index-Max).
    const looksLike01Stretch =
      Number.isFinite(dataMax) && dataMax > (indexMax as number) + 0.08;
    if (looksLike01Stretch) {
      calibratedValues = new Float32Array(pixelCount);
      for (let p = 0; p < pixelCount; p++) {
        const v = hoverValues[p];
        if (!Number.isFinite(v) || (noData != null && v === noData)) {
          calibratedValues[p] = NaN;
          continue;
        }
        calibratedValues[p] = mapStretch01ToIndexRange(v, indexMin, indexMax);
      }
    }
  } else if (hasHeaderRange && samplesPerPixel >= 3) {
    calibratedValues = new Float32Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      const o = p * 4;
      const t = sampleIndexFromRgba(out[o], out[o + 1], out[o + 2], out[o + 3]);
      calibratedValues[p] =
        t == null ? NaN : mapStretch01ToIndexRange(t, indexMin, indexMax);
    }
  }

  const finalHoverValues = calibratedValues || hoverValues;

  // Only keep RGBA when calibrated/float hover values are missing.
  const rgbaForHover =
    !finalHoverValues && samplesPerPixel >= 3
      ? new Uint8ClampedArray(out)
      : null;

  agriPolygonApiLog("export-image:decoded", {
    uniqueid: params.uniqueid,
    rasterDate: params.rasterDate,
    width,
    height,
    samplesPerPixel,
    bbox,
    epsgCode,
    dataMin: Number.isFinite(dataMin) ? dataMin : null,
    dataMax: Number.isFinite(dataMax) ? dataMax : null,
    indexMin,
    indexMax,
    indexMean,
    hasHoverValues: Boolean(finalHoverValues),
    hasRgbaHover: Boolean(rgbaForHover),
    hoverCalibratedFromHeaders: Boolean(calibratedValues),
  });

  return {
    canvas,
    bbox,
    epsgCode,
    width,
    height,
    values: finalHoverValues,
    rgba: rgbaForHover,
    noData,
    indexMin,
    indexMax,
    indexMean,
  };
}

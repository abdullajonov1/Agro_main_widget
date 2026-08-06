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
// geotiff's package.json only exports "." — deep "geotiff/dist-module/..."
// imports fail under webpack 5. Relative node_modules paths bypass exports
 // and keep deflate/pako in the widget bundle (Portal ZIP has no /widgets/chunks).
import RawDecoder from "../../../../../../../../../node_modules/geotiff/dist-module/compression/raw.js";
import LzwDecoder from "../../../../../../../../../node_modules/geotiff/dist-module/compression/lzw.js";
import DeflateDecoder from "../../../../../../../../../node_modules/geotiff/dist-module/compression/deflate.js";
import PackbitsDecoder from "../../../../../../../../../node_modules/geotiff/dist-module/compression/packbits.js";

addDecoder([undefined, 1], async () => RawDecoder as any, undefined, false);
addDecoder(5, async () => LzwDecoder as any, undefined, false);
addDecoder([8, 32946], async () => DeflateDecoder as any, undefined, false);
addDecoder(32773, async () => PackbitsDecoder as any, undefined, false);

export const AGRI_POLYGON_API_BASE_URL = "https://api-agri.sgm.uzspace.uz";

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
 */
export async function fetchPolygonAvailableDates(
  uniqueid: string,
  regionId: number,
  year: number,
): Promise<string[]> {
  const url =
    `${AGRI_POLYGON_API_BASE_URL}/v1/polygon/${encodeURIComponent(uniqueid)}/available-dates` +
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
   * Row-major per-pixel index values (NDVI/SAVI/…), used for map hover tooltips.
   * Null when the TIFF is pre-colored RGB without recoverable float values.
   */
  values: Float32Array | null;
  /** Sentinel for transparent / outside-polygon pixels. */
  noData: number | null;
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

/** Nearest-stop reverse map from RGB → approximate index (0..1). */
function reverseIndexFromRgb(r: number, g: number, b: number): number | null {
  if (r + g + b < 8) return null;
  let best = 0;
  let bestDist = Infinity;
  for (const stop of VEG_COLOR_STOPS) {
    const dr = r - stop.r;
    const dg = g - stop.g;
    const db = b - stop.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = stop.v;
    }
  }
  return best;
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
  const qs = new URLSearchParams({
    region_id: String(params.regionId),
    raster_date: params.rasterDate,
    indice_type: params.indiceType || "ndvi",
    stretch: params.stretch || "fixed",
    response_format: "tiff",
  });
  const url = `${AGRI_POLYGON_API_BASE_URL}/v1/polygon/${encodeURIComponent(params.uniqueid)}/export-image?${qs.toString()}`;
  agriPolygonApiLog("export-image:request", { url, ...params });

  const res = await fetch(url, { headers: { accept: "*/*" } });
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
    throw error;
  }
  const buffer = await res.arrayBuffer();

  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox() as [number, number, number, number];
  const width = image.getWidth();
  const height = image.getHeight();
  const samplesPerPixel = image.getSamplesPerPixel();
  const pixelCount = width * height;

  let epsgCode: number | null = null;
  try {
    const geoKeys: any = image.getGeoKeys();
    epsgCode =
      Number(geoKeys?.ProjectedCSTypeGeoKey) ||
      Number(geoKeys?.GeographicTypeGeoKey) ||
      null;
  } catch {
    epsgCode = null;
  }

  let noData: number | null = null;
  try {
    const gd = Number((image as any).getGDALNoData?.());
    noData = Number.isFinite(gd) ? gd : null;
  } catch {
    noData = null;
  }

  const bands = (await image.readRasters({ interleave: false })) as any[];
  const band0 = bands?.[0];
  const values = new Float32Array(pixelCount);
  let dataMin = Infinity;
  let dataMax = -Infinity;
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

  // Hover values: true index floats, or byte-stretched → 0..1 remap.
  let hoverValues: Float32Array | null = null;
  if (looksLikeIndex) {
    hoverValues = values;
  } else if (looksLikeByte && samplesPerPixel === 1) {
    hoverValues = new Float32Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      const v = values[p];
      hoverValues[p] =
        !Number.isFinite(v) || v <= 0 || (noData != null && v === noData)
          ? NaN
          : v / 255;
    }
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

  if (samplesPerPixel >= 3) {
    const raster = (await image.readRasters({ interleave: true })) as
      | Uint8Array
      | Uint8ClampedArray
      | Float32Array
      | number[];
    if (samplesPerPixel >= 4) {
      for (let p = 0; p < pixelCount; p++) {
        out[p * 4] = clamp255(raster[p * samplesPerPixel]);
        out[p * 4 + 1] = clamp255(raster[p * samplesPerPixel + 1]);
        out[p * 4 + 2] = clamp255(raster[p * samplesPerPixel + 2]);
        out[p * 4 + 3] = clamp255(raster[p * samplesPerPixel + 3]);
      }
    } else {
      for (let p = 0; p < pixelCount; p++) {
        out[p * 4] = clamp255(raster[p * 3]);
        out[p * 4 + 1] = clamp255(raster[p * 3 + 1]);
        out[p * 4 + 2] = clamp255(raster[p * 3 + 2]);
        out[p * 4 + 3] = 255;
      }
    }
    // Pre-colored RGB: recover approximate index from palette for hover.
    if (!hoverValues) {
      hoverValues = new Float32Array(pixelCount);
      for (let p = 0; p < pixelCount; p++) {
        const a = out[p * 4 + 3];
        if (a < 8) {
          hoverValues[p] = NaN;
          continue;
        }
        const approx = reverseIndexFromRgb(
          out[p * 4],
          out[p * 4 + 1],
          out[p * 4 + 2],
        );
        hoverValues[p] = approx == null ? NaN : approx;
      }
    }
  } else if (looksLikeIndex || (looksLikeByte && hoverValues)) {
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

  ctx.putImageData(imageData, 0, 0);

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
    hasHoverValues: Boolean(hoverValues),
  });

  return {
    canvas,
    bbox,
    epsgCode,
    width,
    height,
    values: hoverValues,
    noData,
  };
}

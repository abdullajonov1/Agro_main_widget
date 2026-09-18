/**
 * Shared vegetation overlay context so Popup can warm export-image as soon as
 * uniqueid is known — without waiting for Graff setState / available-dates race.
 */
import {
  resolveExportImageWithDateWalk,
  type VegetationIndiceType,
} from "../gis/agri-polygon-api-source";

const SESSION_DATE_KEY = "agri.veg.overlay.lastDate";
const SESSION_INDEX_KEY = "agri.veg.overlay.lastIndex";
const SESSION_REGION_KEY = "agri.veg.overlay.lastRegion";
const SESSION_YEAR_KEY = "agri.veg.overlay.lastYear";
const SESSION_DATE_REGION_KEY = "agri.veg.overlay.lastDateRegion";
const SESSION_DATE_YEAR_KEY = "agri.veg.overlay.lastDateYear";

type OverlayContext = {
  regionId?: number;
  year?: number;
  lastDate?: string | null;
  lastIndex?: VegetationIndiceType;
  /**
   * Region/year the cached `lastDate` actually came from. Scene dates differ
   * per region, so reusing a date across regions makes export-image answer
   * 400 for a date that has no raster for the new polygon.
   */
  lastDateRegionId?: number;
  lastDateYear?: number;
};

let ctx: OverlayContext = {};

function readSession(): OverlayContext {
  try {
    if (typeof sessionStorage === "undefined") return {};
    const date = sessionStorage.getItem(SESSION_DATE_KEY) || undefined;
    const index = (sessionStorage.getItem(SESSION_INDEX_KEY) ||
      undefined) as VegetationIndiceType | undefined;
    const regionRaw = sessionStorage.getItem(SESSION_REGION_KEY);
    const yearRaw = sessionStorage.getItem(SESSION_YEAR_KEY);
    const dateRegionRaw = sessionStorage.getItem(SESSION_DATE_REGION_KEY);
    const dateYearRaw = sessionStorage.getItem(SESSION_DATE_YEAR_KEY);
    const regionId = regionRaw != null ? Number(regionRaw) : undefined;
    const year = yearRaw != null ? Number(yearRaw) : undefined;
    const lastDateRegionId =
      dateRegionRaw != null ? Number(dateRegionRaw) : undefined;
    const lastDateYear = dateYearRaw != null ? Number(dateYearRaw) : undefined;
    return {
      lastDate: date || null,
      lastIndex: index || "ndvi",
      regionId: Number.isFinite(regionId as number) ? regionId : undefined,
      year: Number.isFinite(year as number) ? year : undefined,
      lastDateRegionId: Number.isFinite(lastDateRegionId as number)
        ? lastDateRegionId
        : undefined,
      lastDateYear: Number.isFinite(lastDateYear as number)
        ? lastDateYear
        : undefined,
    };
  } catch {
    return {};
  }
}

function writeSession(next: OverlayContext): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (next.lastDate) sessionStorage.setItem(SESSION_DATE_KEY, next.lastDate);
    else sessionStorage.removeItem(SESSION_DATE_KEY);
    if (next.lastIndex)
      sessionStorage.setItem(SESSION_INDEX_KEY, next.lastIndex);
    if (next.regionId != null)
      sessionStorage.setItem(SESSION_REGION_KEY, String(next.regionId));
    if (next.year != null)
      sessionStorage.setItem(SESSION_YEAR_KEY, String(next.year));
    if (next.lastDate && next.lastDateRegionId != null) {
      sessionStorage.setItem(
        SESSION_DATE_REGION_KEY,
        String(next.lastDateRegionId),
      );
    } else {
      sessionStorage.removeItem(SESSION_DATE_REGION_KEY);
    }
    if (next.lastDate && next.lastDateYear != null) {
      sessionStorage.setItem(SESSION_DATE_YEAR_KEY, String(next.lastDateYear));
    } else {
      sessionStorage.removeItem(SESSION_DATE_YEAR_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Merge live Graff/Localization context (region/year/last successful date). */
export function setVegetationOverlayContext(
  patch: OverlayContext,
): OverlayContext {
  const next: OverlayContext = {
    ...ctx,
    ...patch,
  };
  // A date is only meaningful together with the region/year it came from.
  if (patch.lastDate !== undefined) {
    if (patch.lastDate) {
      next.lastDateRegionId =
        patch.lastDateRegionId ?? patch.regionId ?? ctx.regionId;
      next.lastDateYear = patch.lastDateYear ?? patch.year ?? ctx.year;
    } else {
      next.lastDate = null;
      next.lastDateRegionId = undefined;
      next.lastDateYear = undefined;
    }
  }
  ctx = next;
  writeSession(ctx);
  return ctx;
}

export function getVegetationOverlayContext(): OverlayContext {
  if (
    ctx.regionId == null ||
    ctx.year == null ||
    !ctx.lastDate
  ) {
    const fromSession = readSession();
    ctx = {
      regionId: ctx.regionId ?? fromSession.regionId,
      year: ctx.year ?? fromSession.year,
      lastDate: ctx.lastDate ?? fromSession.lastDate,
      lastIndex: ctx.lastIndex ?? fromSession.lastIndex ?? "ndvi",
      lastDateRegionId: ctx.lastDateRegionId ?? fromSession.lastDateRegionId,
      lastDateYear: ctx.lastDateYear ?? fromSession.lastDateYear,
    };
  }
  return ctx;
}

/**
 * Cached overlay date, but only when it belongs to the same region (and year):
 * export-image answers 400 for a raster_date that has no scene for the
 * requested polygon/region.
 */
export function getVegetationOverlayDateForRegion(
  regionId: number | null | undefined,
  year?: number | null,
): string | null {
  const live = getVegetationOverlayContext();
  const date = String(live.lastDate || "").trim();
  if (!date || regionId == null) return null;
  if (live.lastDateRegionId != null && live.lastDateRegionId !== regionId) {
    return null;
  }
  if (
    year != null &&
    live.lastDateYear != null &&
    live.lastDateYear !== year
  ) {
    return null;
  }
  return date;
}

function cleanUniqueid(uniqueid: string): string {
  return String(uniqueid || "").replace(/[{}]/g, "").trim();
}

/**
 * Fire-and-forget: resolve a servable raster_date (crop season + imagery) and
 * warm the TIFF cache. Deduped with Graff's early-overlay walk so table clicks
 * do not stack sequential 400 cascades.
 */
export function prefetchVegetationOverlayForUniqueid(
  uniqueid: string,
  opts?: {
    regionId?: number;
    year?: number;
    rasterDate?: string | null;
    indiceType?: VegetationIndiceType;
    cropId?: number | null;
    dates?: string[] | null;
  },
): void {
  const id = cleanUniqueid(uniqueid);
  if (!id) return;

  const live = getVegetationOverlayContext();
  const regionId = opts?.regionId ?? live.regionId;
  const year = opts?.year ?? live.year;
  const cropId = opts?.cropId ?? null;
  const indiceType = (opts?.indiceType ||
    live.lastIndex ||
    "ndvi") as VegetationIndiceType;
  if (regionId == null || !Number.isFinite(regionId)) return;
  if (year == null || !Number.isFinite(year)) return;

  void resolveExportImageWithDateWalk({
    uniqueid: id,
    regionId,
    year,
    cropId,
    indiceType,
    dates: opts?.dates,
  })
    .then((hit) => {
      if (!hit) return;
      setVegetationOverlayContext({
        regionId,
        year,
        lastDate: hit.date,
        lastDateRegionId: regionId,
        lastDateYear: year,
        lastIndex: indiceType,
      });
    })
    .catch(() => {
      /* warm only — Graff handles errors */
    });
}

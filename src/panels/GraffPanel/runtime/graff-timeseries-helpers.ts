/**
 * Pure regional timeseries merge helpers for GraffPanel.
 * No React / map / VH / polygon side effects.
 */

export type RegionalTimeseriesRow = {
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
};

/** Normalize regional/chart row date to YYYY-MM-DD for merge keys. */
export function regionalTimeseriesRowToYmd(row: {
  date?: unknown;
  raster_date?: unknown;
}): string | null {
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
}

/**
 * Merge newly fetched index columns into an existing regional chart series
 * by date. Never overwrites a finite existing value with null/NaN from a
 * partial (single-index) republic query.
 */
export function mergeRegionalTimeseriesFieldsIntoChart<
  TExisting extends Record<string, any>,
>(
  existing: TExisting[],
  incoming: RegionalTimeseriesRow[],
  fields: readonly string[],
): Array<TExisting | (RegionalTimeseriesRow & { raster_date: string })> {
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
      const prevNum = prev[field] == null ? Number.NaN : Number(prev[field]);
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
  return Array.from(byDate.values()).sort(
    (a, b) =>
      new Date(String(a.date)).getTime() - new Date(String(b.date)).getTime(),
  ) as Array<TExisting | (RegionalTimeseriesRow & { raster_date: string })>;
}

/** Build a smooth SVG path through chart points (Catmull-Rom style). */
export function buildGraffSmoothPath(
  points: Array<{ x: number; y: number }>,
  tension = 0.9,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

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
}

/** Default chart window: last N months ending at the newest observation. */
export const GRAFF_DEFAULT_VISIBLE_MONTHS = 3;

export function resolveDefaultDateRangeIndices(
  rows: Array<{ raster_date?: unknown; date?: unknown }>,
  visibleMonths: number = GRAFF_DEFAULT_VISIBLE_MONTHS,
): { startIndex: number; endIndex: number } {
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(
      String(a.raster_date ?? a.date ?? ""),
    ).getTime();
    const tb = new Date(
      String(b.raster_date ?? b.date ?? ""),
    ).getTime();
    return ta - tb;
  });
  const endIndex = Math.max(sorted.length - 1, 0);
  if (sorted.length <= 1) {
    return { startIndex: 0, endIndex };
  }

  const endRaw = sorted[endIndex]?.raster_date ?? sorted[endIndex]?.date;
  const endDate = new Date(String(endRaw ?? ""));
  if (Number.isNaN(endDate.getTime())) {
    return { startIndex: 0, endIndex };
  }

  const cutoff = new Date(endDate.getTime());
  cutoff.setMonth(cutoff.getMonth() - Math.max(1, visibleMonths));
  const cutoffMs = cutoff.getTime();

  let startIndex = 0;
  for (let i = 0; i <= endIndex; i++) {
    const t = new Date(
      String(sorted[i]?.raster_date ?? sorted[i]?.date ?? ""),
    ).getTime();
    if (Number.isFinite(t) && t >= cutoffMs) {
      startIndex = i;
      break;
    }
  }
  return { startIndex, endIndex };
}

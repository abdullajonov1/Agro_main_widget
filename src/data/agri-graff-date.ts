/**
 * Snap an ArcGIS/Date value onto an advertised available-dates YMD list.
 * UTC day → local day → nearest advertised within ±2 days.
 */
import { formatArcgisDateToYmd } from "../gis/agri-vegetation-data-source";

export function resolveAgainstAvailableDates(
  rawDate: any,
  availableDates: string[],
): string | null {
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
  // Within 2 calendar days only — farther matches are likely wrong years.
  if (best != null && bestDist <= 2 * 24 * 60 * 60 * 1000) return best;
  return null;
}

export type GraffRegionalFilterSlice = {
  viloyat: string;
  tuman: string;
  yil: string;
  uzspace: string;
  vh: string;
  turlar?: string[];
};

export function graffRegionalFiltersChanged(
  a: GraffRegionalFilterSlice,
  b: GraffRegionalFilterSlice,
): boolean {
  return (
    a.viloyat !== b.viloyat ||
    a.tuman !== b.tuman ||
    a.yil !== b.yil ||
    a.uzspace !== b.uzspace ||
    JSON.stringify(a.turlar || []) !== JSON.stringify(b.turlar || []) ||
    a.vh !== b.vh
  );
}

/** DD.MM.YYYY for chart range labels (local calendar). */
export function formatGraffRangeDate(raw: unknown): string {
  const date = new Date(String(raw || ""));
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}.${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}.${date.getFullYear()}`;
}

/**
 * Year token for Graff regional/polygon date windows.
 * Match-only `\b(18|19|20)\d{2}\b` — same as fetchRegionalTimeseries / controller.
 */
export function extractGraffYearToken(yil: unknown): string {
  return String(yil || "").match(/\b(18|19|20)\d{2}\b/)?.[0] || "";
}

export type GraffRegionalFilterSnapshot = {
  viloyat: string;
  tuman: string;
  yil: string;
  turi: string;
  turlar: string;
  vh: string;
};

export function snapshotGraffRegionalFilters(filters: {
  viloyat?: string | null;
  tuman?: string | null;
  yil?: string | null;
  uzspace?: string | null;
  turi?: string | null;
  turlar?: string[] | null;
  vh?: string | null;
}): GraffRegionalFilterSnapshot {
  return {
    viloyat: String(filters?.viloyat || ""),
    tuman: String(filters?.tuman || ""),
    yil: String(filters?.yil || ""),
    turi: String(filters?.uzspace || filters?.turi || ""),
    turlar: JSON.stringify(filters?.turlar || []),
    vh: String(filters?.vh || ""),
  };
}

/** Pure half of fetchRegionalTimeseries isStale (filters only). */
export function isGraffRegionalFilterSnapshotStale(
  snapshot: GraffRegionalFilterSnapshot,
  current: {
    viloyat?: string | null;
    tuman?: string | null;
    yil?: string | null;
    uzspace?: string | null;
    turi?: string | null;
    turlar?: string[] | null;
    vh?: string | null;
  } | null | undefined,
): boolean {
  const live = snapshotGraffRegionalFilters(current || {});
  return (
    live.viloyat !== snapshot.viloyat ||
    live.tuman !== snapshot.tuman ||
    live.yil !== snapshot.yil ||
    live.turi !== snapshot.turi ||
    live.turlar !== snapshot.turlar ||
    live.vh !== snapshot.vh
  );
}

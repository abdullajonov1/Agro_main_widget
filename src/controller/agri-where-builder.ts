/**
 * Shared ArcGIS WHERE clause primitives for Agro_widgetV5.
 *
 * Goal: one source for identical filter fragments (year, AND-join, table stats).
 * Panel-specific VH / uniqueid rules stay in each widget until pack can own them.
 *
 * IMPORTANT: do not "simplify" year matching — Region/Pie use digitFallback;
 * Graff uses match-only. Both paths are intentional.
 */
import {
  escapeArcGIS,
  escapeLikeLiteral,
  eqAposSmart,
  buildTumanEqualsSql,
} from "../data/agri-sql";
import { buildTurlarSqlClause } from "../shared/agri-crop-labels";
import { withAgriAccessWhere } from "../gis/feature-layer-data";

export type YearLikeOptions = {
  /** SQL field name (default: yil). */
  field?: string;
  /**
   * When true (default): if no \bYYYY\b match, use all remaining digits
   * (Region / Pie / Indicator / Localization).
   * When false: only \bYYYY\b counts; otherwise fall through to %raw%
   * (Graff table WHERE).
   */
  digitFallback?: boolean;
};

export type TableFilterInput = {
  yil: string;
  viloyat?: string;
  tuman?: string;
  turi?: string;
  turlar?: string[];
  lockedViloyat?: string;
  /** Exact STIR / f_inn from header search selection. */
  farmerInn?: string;
};

/** Extract a year token the same way panels historically did. */
export function extractYearDigits(
  yil: unknown,
  digitFallback = true,
): string {
  const raw = String(yil ?? "").trim();
  if (!raw) return "";
  const matched = raw.match(/\b(18|19|20)\d{2}\b/)?.[0] ?? "";
  if (matched) return matched;
  if (!digitFallback) return "";
  return raw.replace(/[^\d]/g, "");
}

/**
 * Build `yil LIKE 'YYYY%'` (or `%raw%` fallback).
 * Returns "" when yil is empty — caller decides whether to skip or use 1=0.
 */
export function buildYearLikeClause(
  yil: unknown,
  options?: YearLikeOptions,
): string {
  const field = (options?.field || "yil").trim() || "yil";
  const digitFallback = options?.digitFallback !== false;
  const raw = String(yil ?? "").trim();
  if (!raw) return "";

  const yDigits = extractYearDigits(raw, digitFallback);
  if (yDigits) {
    // Digits-only today, but still route through escapeLikeLiteral so %/_
    // cannot sneak in if extractYearDigits ever widens.
    return `${field} LIKE '${escapeLikeLiteral(yDigits)}%'`;
  }
  const safe = escapeLikeLiteral(raw);
  if (!safe) return "1=0";
  return `${field} LIKE '%${safe}%'`;
}

/** Join non-empty SQL fragments with AND. */
export function joinAndClauses(
  clauses: Array<string | null | undefined>,
  emptyFallback = "1=1",
): string {
  const parts = clauses
    .map((c) => String(c ?? "").trim())
    .filter((c) => c.length > 0);
  return parts.length ? parts.join(" AND ") : emptyFallback;
}

/**
 * Region aggregate WHERE — mirrors RegionPanel.buildWhereForAggregates.
 * Uses eqAposSmart for viloyat (same as Pie/Indicator/map text path).
 * Hudud bars ignore ekin turi (Pie) and VH — only yil + geography.
 */
export function buildRegionAggregatesWhere(
  input: TableFilterInput & {
    view: "viloyat" | "tuman";
    drillViloyat?: string;
  },
): string {
  const yil = String(input.yil || "").trim();
  if (!yil) return "1=0";

  const clauses: string[] = [];
  const yearClause = buildYearLikeClause(yil);
  if (yearClause) clauses.push(yearClause);

  const effectiveLock = String(input.lockedViloyat || "").trim();
  const drillViloyat =
    String(input.drillViloyat || "").trim() ||
    effectiveLock ||
    String(input.viloyat || "").trim();

  if (effectiveLock) {
    const vilClause = eqAposSmart("viloyat", effectiveLock);
    if (vilClause) clauses.push(vilClause);
  } else if (input.view === "tuman" && drillViloyat) {
    const vilClause = eqAposSmart("viloyat", drillViloyat);
    if (vilClause) clauses.push(vilClause);
  }

  // Intentionally omit turi/turlar — Pie crop must not filter Hudud.
  void input.turi;
  void input.turlar;

  return withAgriAccessWhere(joinAndClauses(clauses, "1=1"));
}

/**
 * Pie category stats WHERE — mirrors PiePanel.buildWhereClauseForDS.
 * Pass includeCategory explicitly (Pie fetch uses false for full breakdown).
 */
export function buildPieStatsWhere(
  input: TableFilterInput & { districtCode?: number | null },
  opts: { includeCategory?: boolean; includeViloyat?: boolean } = {},
): string {
  const includeCategory = opts.includeCategory !== false;
  const includeViloyat = opts.includeViloyat !== false;
  const clauses: string[] = [];
  const scopeViloyat = String(
    input.viloyat || input.lockedViloyat || "",
  ).trim();
  const tuman = String(input.tuman || "").trim();
  const yil = String(input.yil || "").trim();
  const districtCode =
    input.districtCode != null && Number.isFinite(Number(input.districtCode))
      ? Number(input.districtCode)
      : null;

  if (includeViloyat && scopeViloyat) {
    const vilClause = eqAposSmart("viloyat", scopeViloyat);
    if (vilClause) clauses.push(vilClause);
  }
  if (tuman && includeViloyat && scopeViloyat) {
    const tumanClause =
      districtCode != null
        ? `district = '${districtCode}'`
        : /^\d+$/.test(tuman)
          ? `district = '${Number(tuman)}'`
          : buildTumanEqualsSql("tuman", tuman);
    if (tumanClause) clauses.push(tumanClause);
  }

  if (yil) {
    const yearClause = buildYearLikeClause(yil);
    if (yearClause) clauses.push(yearClause);
  }

  if (includeCategory && input.turi) {
    const cropClause = buildTurlarSqlClause("turi", [input.turi]);
    if (cropClause) clauses.push(cropClause);
  }

  const farmerInn = String(input.farmerInn || "").trim();
  if (farmerInn) {
    clauses.push(`UPPER(f_inn)=UPPER('${escapeArcGIS(farmerInn)}')`);
  }

  return withAgriAccessWhere(joinAndClauses(clauses, "1=1"));
}

/**
 * Indicator table WHERE — mirrors IndicatorPanel.buildWhereClause geography
 * + year + crop (no VH uniqueids, no config filterExpression, no uniqueid).
 * Panel appends those extras locally.
 */
export function buildIndicatorStatsWhere(
  input: TableFilterInput,
  opts: {
    includeViloyat?: boolean;
    yearField?: string;
    turiField?: string;
    /** When set (e.g. maydon), append numeric `field > 0` like Indicator nz(). */
    excludeZeroField?: string;
  } = {},
): string {
  const includeViloyat = opts.includeViloyat !== false;
  const yearField = (opts.yearField || "yil").trim() || "yil";
  const turiField = (opts.turiField || "turi").trim() || "turi";
  const clauses: string[] = [];

  const yil = String(input.yil || "").trim();
  if (yil) {
    const yearClause = buildYearLikeClause(yil, { field: yearField });
    if (yearClause) clauses.push(yearClause);
  }

  const viloyat = String(input.viloyat || "").trim();
  const tuman = String(input.tuman || "").trim();
  if (includeViloyat && viloyat) {
    const vilClause = eqAposSmart("viloyat", viloyat);
    if (vilClause) clauses.push(vilClause);
  }
  if (tuman) {
    const tumanClause = buildTumanEqualsSql("tuman", tuman);
    if (tumanClause) clauses.push(tumanClause);
  }

  const selectedTurlar =
    Array.isArray(input.turlar) && input.turlar.length
      ? input.turlar
      : input.turi
        ? [input.turi]
        : [];
  const cropClause = buildTurlarSqlClause(turiField, selectedTurlar);
  if (cropClause) clauses.push(cropClause);

  const zeroField = String(opts.excludeZeroField || "").trim();
  if (zeroField) {
    clauses.push(`(${zeroField} > 0)`);
  }

  return withAgriAccessWhere(joinAndClauses(clauses, "1=1"));
}

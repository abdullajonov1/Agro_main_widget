/**
 * Crop list normalization for Indicator panels (agri-sql normalizeApos — no Localization trim).
 */
import { normalizeApos } from "./agri-sql";

/**
 * Matches IndicatorPanel / IndicatorYieldPanel historical normalizeTurlar:
 * array | single truthy | fallback; agri-sql apostrophe normalize; unique.
 */
export function normalizeTurlarListSql(
  raw: unknown,
  fallback = "",
): string[] {
  const source = Array.isArray(raw)
    ? raw
    : raw
      ? [raw]
      : fallback
        ? [fallback]
        : [];
  return Array.from(
    new Set(
      source
        .map((value) => normalizeApos(String(value || "")))
        .filter(Boolean),
    ),
  );
}

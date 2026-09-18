/**
 * Canonical SQL string helpers for Agro_widgetV5.
 * Single source — widgets must not reimplement escape/normalize logic.
 */

/**
 * Apostrophe / quote glyphs seen in Uzbek place names (Agri_table, UI).
 * Includes ASCII, curly quotes (U+2018/2019), modifier letters, grave.
 */
export const APOSTROPHE_VARIANTS = [
  "'", // U+0027
  "\u2018", // ‘
  "\u2019", // ’
  "\u201B", // ‛
  "\u02BB", // ʻ
  "\u02BC", // ʼ
  "\u0060", // `
] as const;

const APOSTROPHE_CLASS = "['\u2018\u2019\u201A\u201B\u02BB\u02BC\u02B9\u00B4\u2032\u2035`]";

/** Escape a value for ArcGIS SQL string literals. Safe for null/undefined/numbers. */
export function escapeArcGIS(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * Strip LIKE metacharacters from user input.
 * ArcGIS FeatureServer SQL often rejects `ESCAPE '\\'` and fails with
 * "Unable to complete operation" — so we sanitize instead of escaping.
 */
export function sanitizeLikeInput(value: unknown): string {
  return String(value ?? "").replace(/[%_\\]/g, "");
}

/**
 * Quote-safe fragment for LIKE patterns. Strips %/_ (no ESCAPE clause).
 * Prefer for year/search fragments embedded in LIKE '…'.
 */
export function escapeLikeLiteral(value: unknown): string {
  return escapeArcGIS(sanitizeLikeInput(value));
}

/** @deprecated Use sanitizeLikeInput — kept for call-site clarity during migration. */
export function escapeLikePattern(value: unknown): string {
  return sanitizeLikeInput(value);
}

/** Normalize apostrophe-like characters to ASCII single quote (NFKC). */
export function normalizeApos(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(new RegExp(APOSTROPHE_CLASS, "g"), "'");
}

/**
 * Build OR of equals for a field when the value may use different apostrophe glyphs.
 */
export function eqAposSmart(field: string, raw: unknown): string {
  const s = normalizeApos(String(raw ?? "").trim());
  if (!s) return "";
  if (!/'/.test(s)) return `${field}='${escapeArcGIS(s)}'`;
  const base = s.replace(/'/g, "\uFFFF");
  const parts = APOSTROPHE_VARIANTS.map((ch) => {
    const candidate = base.split("\uFFFF").join(ch);
    return `${field}='${escapeArcGIS(candidate)}'`;
  });
  return `(${parts.join(" OR ")})`;
}

const TUMAN_SUFFIXES = [
  " tumani",
  " shahri",
  " shahar",
  " тумани",
  " шаҳри",
  " район",
] as const;

/**
 * Compact tuman/district-name WHERE for Agri_table / Pie / Jadval.
 *
 * Do NOT nest expandDistrictVariants() + eqAposSmart() — that cartesian-
 * products apostrophe × suffix variants into huge broken SQL (Yakkabog').
 * Normalize apostrophes once, keep a few suffix forms, eqAposSmart each.
 */
export function buildTumanEqualsSql(field: string, raw: unknown): string {
  const s = normalizeApos(String(raw ?? "")).trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return `district = '${Number(s)}'`;

  const lower = s.toLowerCase();
  let base = s;
  for (const suf of TUMAN_SUFFIXES) {
    if (lower.endsWith(suf.toLowerCase())) {
      base = s.slice(0, s.length - suf.length).trim();
      break;
    }
  }

  const candidates = Array.from(
    new Set([s, base, base ? `${base} tumani` : ""].filter(Boolean)),
  );
  const parts = candidates
    .map((c) => eqAposSmart(field, c))
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

/** @deprecated use escapeArcGIS — kept for agri-table-data-source alias */
export function escapeAgriValue(value: unknown): string {
  return escapeArcGIS(value);
}

/**
 * Whole-day equality for a Date field. Safer than `field = DATE 'YMD'`, which
 * can miss rows when the stored value carries a non-midnight time component.
 * Rejects non YYYY-MM-DD input (including SQL metacharacters) with `1=0`.
 */
export function dateEqualsClause(dateField: string, ymd: string): string {
  const field = String(dateField || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) return "1=0";
  const parts = String(ymd ?? "").trim().split("-");
  if (parts.length !== 3) return "1=0";
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return "1=0";
  }
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) {
    return "1=0";
  }
  if (
    !/^\d+$/.test(parts[0]) ||
    !/^\d+$/.test(parts[1]) ||
    !/^\d+$/.test(parts[2])
  ) {
    return "1=0";
  }
  const safeYmd = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return `${field} >= DATE '${safeYmd}' AND ${field} < DATE '${nextYmd}'`;
}

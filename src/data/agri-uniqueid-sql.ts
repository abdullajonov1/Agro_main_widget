/**
 * Uniqueid / GIDV SQL fragments used by GraffPanel (and similar search).
 * Pure string helpers — no layer / React state.
 */
import { escapeArcGIS, escapeLikeLiteral } from "./agri-sql";

/** Brace-stripped lowercase uniqueid for equality checks in UI. */
export function normalizeUniqueidKey(
  value: string | null | undefined,
): string {
  return String(value || "").replace(/[{}]/g, "").trim().toLowerCase();
}

/** Brace-stripped uniqueid preserving case (raster/API keys). */
export function stripUniqueidBraces(
  value: string | null | undefined,
): string {
  return String(value || "").replace(/[{}]/g, "");
}

/** Table row match against selected uniqueid (case-insensitive). */
export function recordMatchesUniqueidKey(
  recordUniqueidOrOid: string | null | undefined,
  targetUniqueid: string | null | undefined,
): boolean {
  const target = normalizeUniqueidKey(targetUniqueid);
  if (!target) return false;
  const recordId = normalizeUniqueidKey(recordUniqueidOrOid);
  return !!recordId && recordId === target;
}

/**
 * UPPER(field)=UPPER(...) OR across term / {core} / core variants.
 * Empty term → 1=0.
 */
export function buildUniqueidUpperEqualsWhere(
  raw: string,
  field = "uniqueid",
): string {
  const term = (raw || "").trim();
  if (!term) return "1=0";

  const core = term.replace(/[{}]/g, "");
  const withBraces = `{${core}}`;
  const noBraces = core;

  const variants = Array.from(new Set([term, withBraces, noBraces]));
  const pieces = variants.map(
    (v) => `UPPER(${field})=UPPER('${escapeArcGIS(v)}')`,
  );
  return `(${pieces.join(" OR ")})`;
}

/**
 * Plain equals OR braced equals (no UPPER) — used for page/OID lookup.
 */
export function buildUniqueidPlainOrBracedWhere(uniqueid: string): string {
  const clean = normalizeUniqueidKey(uniqueid);
  if (!clean) return "1=0";
  const escaped = escapeArcGIS(clean);
  const braced = escapeArcGIS(`{${clean}}`);
  return `(uniqueid = '${escaped}' OR uniqueid = '${braced}')`;
}

/**
 * GIDV smart search: plain GUID, {GUID}, SU{GUID}-style prefixes, LIKE core.
 */
export function buildGidvSmartWhere(raw: string, field = "gidv"): string {
  const term = (raw || "").trim();
  if (!term) return "1=0";

  const core = term.replace(/[{}]/g, "");
  const GUID =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const pieces = new Set<string>();

  pieces.add(`UPPER(${field})=UPPER('${escapeArcGIS(term)}')`);
  if (core.length >= 8) {
    pieces.add(`UPPER(${field}) LIKE UPPER('%${escapeLikeLiteral(core)}%')`);
  }

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
}

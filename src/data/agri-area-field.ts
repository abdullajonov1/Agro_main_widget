/**
 * Shared area-field detection for Region / Pie / dashboard controller.
 * Algorithms match the previous per-panel implementations exactly.
 */

const NUMERIC_FIELD_TYPES = new Set([
  "double",
  "single",
  "integer",
  "small-integer",
  "long",
  "short",
  "float",
]);

/** Controller default preferred names (exact, then includes). */
export const AREA_FIELD_PREFERRED_CONTROLLER = [
  "maydon",
  "area_ha",
  "area",
  "hectare",
  "hectares",
] as const;

/** Pie preferred names (adds Cyrillic га). */
export const AREA_FIELD_PREFERRED_PIE = [
  "maydon",
  "area_ha",
  "area",
  "hectare",
  "hectares",
  "га",
] as const;

/** Region candidate names (exact match + numeric type required). */
export const AREA_FIELD_CANDIDATES_REGION = [
  "maydon",
  "maydon_ga",
  "maydon_ha",
  "area",
  "area_ga",
  "area_ha",
  "shape__area",
  "shape_area",
] as const;

function layerFieldNames(layer: __esri.FeatureLayer): string[] {
  const fields: any[] = (layer as any)?.fields || [];
  return fields.map((f) => String(f?.name || ""));
}

/**
 * Name-based lookup used by controller (and Pie layer fields pass).
 * Exact preferred match → includes match → optional final exact "maydon".
 */
export function findAreaFieldByPreferredNames(
  layer: __esri.FeatureLayer,
  preferred: readonly string[] = AREA_FIELD_PREFERRED_CONTROLLER,
  opts?: { finalMaydonFallback?: boolean },
): string | null {
  const names = layerFieldNames(layer);
  if (!names.length) return null;
  const lower = names.map((n) => n.toLowerCase());
  for (const p of preferred) {
    const idx = lower.indexOf(p);
    if (idx !== -1) return names[idx];
  }
  for (const p of preferred) {
    const idx = lower.findIndex((n) => n.includes(p));
    if (idx !== -1) return names[idx];
  }
  if (opts?.finalMaydonFallback !== false) {
    return names.find((n) => n.toLowerCase() === "maydon") || null;
  }
  return null;
}

/**
 * Region-style detection: optional config override, then candidate list with
 * numeric type check, then regex fallback on numeric fields.
 */
export function findAreaFieldNumeric(
  layer: __esri.FeatureLayer,
  opts?: { configField?: string },
): string | null {
  if (!layer?.fields) return null;
  const fields = layer.fields;

  const cfg = String(opts?.configField || "").toLowerCase();
  if (cfg) {
    const hit = fields.find(
      (f) =>
        f.name.toLowerCase() === cfg &&
        NUMERIC_FIELD_TYPES.has(f.type as any),
    );
    if (hit) return hit.name;
  }

  for (const guess of AREA_FIELD_CANDIDATES_REGION) {
    const f = fields.find((ff) => ff.name.toLowerCase() === guess);
    if (f && NUMERIC_FIELD_TYPES.has(f.type as any)) return f.name;
  }

  const fallback = fields.find(
    (f) =>
      NUMERIC_FIELD_TYPES.has(f.type as any) &&
      /maydon|area|ha|ga|shape/.test(f.name.toLowerCase()),
  );
  return fallback ? fallback.name : null;
}

/**
 * Tiny MapImage / region SOATO predicates.
 * Kept separate from the large feature-layer-data orchestration module.
 */

export function isMapImageSublayer(layer: any): boolean {
  return String(layer?.type || "").toLowerCase() === "sublayer";
}

/**
 * Layer ids owned by agri-admin-boundary-layer.ts (viloyat/tuman outlines,
 * labels). Duplicated here (not imported) to avoid a circular dependency —
 * feature-layer-data → map-image-predicates ← agri-admin-boundary-layer.
 */
const AGRI_ADMIN_BOUNDARY_LAYER_IDS = new Set([
  "agri-region-boundary",
  "agri-district-boundary",
  "agri-district-label-fl",
  "agri-district-fs-border",
]);

const AGRI_ADMIN_BOUNDARY_URL_RE =
  /\/(?:Tuman_chegara|Viloyat_chegara|Hosted\/(?:regions|district)s?)\b/i;

/**
 * True for viloyat/tuman outline + label layers the widget draws on top of the
 * map. They sit above the field polygons and their title/url contains "agri"
 * or the boundary service name, so any "looks agri" heuristic must reject
 * them — otherwise a map click resolves to a tuman polygon (no uniqueid) and
 * neither the popup, the zoom nor the vegetation overlay can work.
 */
export function isAgriAdminBoundaryLayer(layer: any): boolean {
  if (!layer) return false;
  const seen = new Set<any>();
  let current: any = layer;
  while (current && !seen.has(current)) {
    seen.add(current);
    const id = String(current?.id || "").trim();
    if (AGRI_ADMIN_BOUNDARY_LAYER_IDS.has(id)) return true;
    const title = String(current?.title || "").toLowerCase();
    if (
      title === "region boundary" ||
      title === "district boundary" ||
      title.includes("district borders") ||
      title.includes("tuman chegara")
    ) {
      return true;
    }
    if (AGRI_ADMIN_BOUNDARY_URL_RE.test(String(current?.url || ""))) {
      return true;
    }
    current = current.layer && current.layer !== current ? current.layer : current.parent;
  }
  return false;
}

export function isRegionSoatoCode(value: string): boolean {
  return /^\d{4}$/.test(String(value ?? "").trim());
}

/**
 * MapImage-owned leaves should refresh the parent service only.
 * Refreshing both leaf + parent cancels the first MapServer export.
 */
export function shouldRefreshMapImageParentOnly(layer: any): boolean {
  if (!layer) return false;
  const type = String(layer?.type || "").toLowerCase();
  if (type === "map-image") return true;
  if (type === "sublayer") return true;
  // Some sublayers expose type via parent pointers only.
  return !!(layer?.layer && layer.layer !== layer && type !== "feature");
}

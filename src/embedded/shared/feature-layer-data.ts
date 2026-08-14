/**
 * Shared FeatureLayer data access for embedded Evapo widgets.
 *
 * All embedded widgets in EvapoDashboardV6 read ONLY from the ArcGIS
 * FeatureLayer or MapImageLayer sublayer (water_table) — no external HTTP API.
 *
 * Field mapping (UI filter -> FeatureLayer field), with name-field fallbacks:
 *   yil      -> year
 *   viloyat  -> region_id  (fallback: viloyat)
 *   tuman    -> distrct_id (fallback: tuman)
 *   mavsum   -> season_id  (fallback: mavsum)
 *   fermer   -> full_name
 *   farmerTax -> tax_number (STIR qidiruv; dropdown fermer bilan bir vaqtda emas)
 *   crop     -> crop_id    (fallback: crop)
 *   manba    -> real_name
 *   kanal    -> real_n1
 *   minMax   -> minmax
 *
 * Metric fields:
 *   area     -> area_ha (SUM)
 *   count    -> objectid (COUNT)
 *   yield    -> yield   (MEDIAN)
 *   eff      -> wp_tot  (MEDIAN)
 *   monthly  -> uw3_m3 .. uw10_m3 (SUM)
 *   total    -> uwt_m3  (SUM)
 */
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import { combineAccessWhere } from "../../shared/agri-access-config";

/** Portal group access + business WHERE. */
export function withEvapoAccessWhere(mainWhere?: string): string {
  return combineAccessWhere(mainWhere);
}

export interface EvapoFilters {
  yil?: string;
  viloyat?: string;
  tuman?: string;
  mavsum?: string;
  /** Multiple mavsum values joined with OR (e.g. grouped season labels). */
  mavsumOrValues?: string[];
  fermer?: string;
  /** STIR / tax_number qidiruv (raqamli maydon). */
  farmerTax?: string;
  crop?: string;
  /** Numeric crop_id from EvapoCropV2 cropSelected (preferred over name on crop_id field). */
  cropId?: string;
  /** Land type selected in LocalizationWidgetV20: sugoriladigan | lalmi | "". */
  yerTuri?: string;
  /** water_table type_id: 1 = Sug'oriladigan/Sug'orilgan, 2 = Lalmi. */
  yerTuriId?: string;
  manba?: string;
  kanal?: string;
  minMax?: string; // "Min" | "Max" | "both" | ""
  /** Efficiency range filter (0–100), applied when not full range. */
  effMin?: number | null;
  effMax?: number | null;
  /** When true, viloyat is not added to WHERE (layer is already region-specific). */
  skipRegionFilter?: boolean;
  /** When true, yil is not added (year-layer mode — DS is already per-year). */
  skipYearFilter?: boolean;
}

export function resolveEfficiencyField(available: string[]): string | null {
  const lower = new Map(
    available.map((name) => [String(name).toLowerCase(), name]),
  );
  for (const candidate of ["eff", "efficiency", "wp_tot"]) {
    const hit = lower.get(candidate);
    if (hit) return hit;
  }
  return null;
}

export function clampEfficiencyValue(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function isEfficiencyRangeActive(
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  if (min == null || max == null) return false;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  return min > 0 || max < 100;
}

export function buildEfficiencyRangeWhere(
  min: number | null | undefined,
  max: number | null | undefined,
  available: string[],
): string {
  if (!isEfficiencyRangeActive(min, max)) return "";
  const field =
    resolveEfficiencyField(available) ??
    (available.length === 0 ? "eff" : null);
  if (!field) return "";
  const lo = clampEfficiencyValue(Number(min));
  const hi = clampEfficiencyValue(Number(max));
  const safeMin = Math.min(lo, hi);
  const safeMax = Math.max(lo, hi);
  return `${field} >= ${safeMin} AND ${field} <= ${safeMax}`;
}

export function mergeEfficiencyIntoFilters(
  filters: EvapoFilters,
  effMin: number | null | undefined,
  effMax: number | null | undefined,
): EvapoFilters {
  if (!isEfficiencyRangeActive(effMin, effMax)) return filters;
  return {
    ...filters,
    effMin: clampEfficiencyValue(Number(effMin)),
    effMax: clampEfficiencyValue(Number(effMax)),
  };
}

export interface ResolvedFeatureLayer {
  layer: any;
  fields: string[];
  /** True when the layer title/url already identifies the selected region. */
  regionScoped: boolean;
  /** True when the layer title/url already identifies the selected year. */
  yearScoped: boolean;
}

export const MONTHLY_FIELDS: Array<{ field: string; month: number; key: string }> =
  [
    { field: "uw3_m3", month: 3, key: "uw3_m3" },
    { field: "uw4_m3", month: 4, key: "uw4_m3" },
    { field: "uw5_m3", month: 5, key: "uw5_m3" },
    { field: "uw6_m3", month: 6, key: "uw6_m3" },
    { field: "uw7_m3", month: 7, key: "uw7_m3" },
    { field: "uw8_m3", month: 8, key: "uw8_m3" },
    { field: "uw9_m3", month: 9, key: "uw9_m3" },
    { field: "uw10_m3", month: 10, key: "uw10_m3" },
  ];

export function escapeArcGIS(value: string): string {
  return String(value ?? "").replace(/'/g, "''");
}

/** Uzbekistan region SOATO codes (water_table `region_id`). */
export const REGION_SOATO_TO_UZ_NAME: Record<string, string> = {
  "1703": "Andijon viloyati",
  "1706": "Buxoro viloyati",
  "1708": "Jizzax viloyati",
  "1710": "Farg'ona viloyati",
  "1712": "Namangan viloyati",
  "1714": "Navoiy viloyati",
  "1718": "Samarqand viloyati",
  "1722": "Surxondaryo viloyati",
  "1724": "Sirdaryo viloyati",
  "1726": "Toshkent viloyati",
  "1727": "Toshkent shahri",
  "1730": "Qashqadaryo viloyati",
  "1733": "Xorazm viloyati",
  "1735": "Qoraqalpog'iston Respublikasi",
};

export function isRegionSoatoCode(value: string): boolean {
  return /^\d{4}$/.test(String(value ?? "").trim());
}

export function regionSoatoToDisplayName(code: string): string | null {
  const c = String(code ?? "").trim();
  return REGION_SOATO_TO_UZ_NAME[c] || null;
}

/** English / translit aliases used when resolving a region label to SOATO. */
const REGION_NAME_ALIAS_GROUPS: string[][] = [
  ["fargona", "fergana", "ferghana", "фарғона", "фергана"],
  ["samarqand", "samarkand", "samar", "samarkhand"],
  ["toshkent", "tashkent"],
  ["andijon", "andijan"],
  ["namangan"],
  ["buxoro", "bukhara", "buxara"],
  ["qashqadaryo", "kashkadarya", "kashkadaria", "qashqadarya", "kashkada"],
  // "sukhandarya" (missing the 'r') is a typo in the WebMap's 2025 layer title.
  ["surxondaryo", "surkhandarya", "surxandarya", "sukhandarya"],
  ["jizzax", "jizzakh", "jizakh"],
  ["sirdaryo", "syrdarya", "sirdarya"],
  ["navoiy", "navoi"],
  ["xorazm", "khorezm", "xorezm", "kharezm"],
  ["qoraqalpogiston", "karakalpakstan", "nukus", "qqr"],
];

export function regionDisplayNameToSoato(name: string): string | null {
  const target = normalizeRegionToken(name);
  if (!target) return null;

  const matchTokens = new Set<string>([target]);
  for (const group of REGION_NAME_ALIAS_GROUPS) {
    const norms = group.map((alias) => normalizeRegionToken(alias)).filter(Boolean);
    if (norms.some((alias) => alias === target)) {
      norms.forEach((alias) => matchTokens.add(alias));
      break;
    }
  }

  for (const [code, label] of Object.entries(REGION_SOATO_TO_UZ_NAME)) {
    const labelToken = normalizeRegionToken(label);
    if (labelToken && matchTokens.has(labelToken)) return code;
  }
  return null;
}

/** UI / filter state should always use human-readable region names when possible. */
export function normalizeRegionDisplayValue(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (isRegionSoatoCode(raw)) {
    return regionSoatoToDisplayName(raw) || raw;
  }
  return raw;
}

/** Canonical value for filter state + events (prefer region name over SOATO code). */
export function canonicalizeRegionFilterValue(value: string): string {
  return normalizeRegionDisplayValue(value);
}

/** ArcGIS map layer id suffix embedded in Experience Builder child DS ids. */
export function extractMapLayerIdFromDsId(dsId: string): string | null {
  const match = String(dsId || "").match(/([0-9a-f]+-layer-\d+)$/i);
  return match ? match[1] : null;
}

/**
 * MapImage "Group Layer" nodes (e.g. title "Agri 2026 republic data").
 * They often expose a /MapServer/N URL and sometimes createQuery stubs, but
 * FeatureLayer#load() rejects them: Source type "Group Layer" is not supported.
 */
export function isMapImageGroupSublayer(layer: any): boolean {
  if (!layer) return false;
  const type = String(layer.type || "").toLowerCase();
  const sourceType = String(
    layer.sourceJSON?.type ||
      layer.resourceInfo?.type ||
      layer.source?.type ||
      "",
  ).toLowerCase();
  if (sourceType.includes("group")) return true;
  const kidCount =
    layer.sublayers?.length ?? layer.sublayers?.toArray?.()?.length ?? 0;
  if (type === "sublayer" && kidCount > 0) return true;
  // Nested group folders under MapImage also show up as type "group".
  if (type === "group") return true;
  return false;
}

/** True for FeatureLayer and MapImageLayer sublayers that support query APIs. */
export function isQueryableFieldLayer(layer: any): boolean {
  if (!layer) return false;
  // Never treat Group Layer folders as queryable — even if they expose
  // createQuery while hydrating (FeatureLayer load then hard-fails).
  if (isMapImageGroupSublayer(layer)) return false;
  // Prefer queryFeatures — some MapImage Sublayer builds expose createQuery +
  // queryFeatures but not queryFeatureCount until fully hydrated.
  if (typeof layer.createQuery === "function") {
    if (typeof layer.queryFeatures === "function") return true;
    if (typeof layer.queryFeatureCount === "function") return true;
  }
  // Leaf MapImage sublayer that can still be queried once load() finishes.
  const type = String(layer.type || "").toLowerCase();
  if (type === "sublayer") {
    if (layer.url || layer.id != null) {
      return (
        typeof layer.queryFeatures === "function" ||
        typeof layer.createQuery === "function"
      );
    }
  }
  return false;
}

export function getLayerFieldNames(layer: any): string[] {
  return (layer?.fields || []).map((f: any) =>
    String(f?.name || "").toLowerCase(),
  );
}

/** water_table / Map Service polygon layers used by Evapo dashboards. */
export function isEvapoWaterTableLayer(layer: any): boolean {
  if (!isQueryableFieldLayer(layer)) return false;
  const fields = getLayerFieldNames(layer);
  if (!fields.length) return false;
  const hasMetric =
    fields.includes("area_ha") ||
    fields.includes("uwt_m3") ||
    fields.includes("uwt_m3ha") ||
    fields.includes("year");
  const hasRegion =
    fields.includes("region_id") || fields.includes("viloyat");
  return hasMetric && hasRegion;
}

export function extractYearFromHaystack(haystack: string): string | null {
  const match = String(haystack || "").match(/(?:19|20)\d{2}/);
  return match ? match[0] : null;
}

export function normalizeMapServiceUrl(url: string): string {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\/\d+$/, "");
}

/** Full layer URL including MapServer index — unique per sublayer. */
export function normalizeQueryableLayerUrl(url: string): string {
  return String(url || "").trim().toLowerCase().replace(/\/+$/, "");
}

export function getEvapoLayerMapKey(layer: any): string {
  if (!layer) return "";
  const url = normalizeQueryableLayerUrl(String(layer.url || ""));
  if (url) return url;
  const parent = getMapImageParentLayer(layer);
  const parentUrl = parent
    ? normalizeQueryableLayerUrl(String(parent.url || ""))
    : "";
  const selfId = String(layer.id ?? "");
  if (parentUrl && selfId) return `${parentUrl}/${selfId}`;
  return selfId;
}

export function findQueryableLayerOnMapByUrl(map: any, url: string): any | null {
  const target = normalizeQueryableLayerUrl(url);
  if (!map || !target) return null;

  for (const layer of getAllFeatureLayersFromMap(map)) {
    if (normalizeQueryableLayerUrl(String(layer?.url || "")) === target) {
      return layer;
    }
  }

  const roots: any[] = map.allLayers?.toArray?.() || map.layers?.toArray?.() || [];
  for (const root of roots) {
    if (String(root?.type || "").toLowerCase() !== "map-image") continue;
    const subs =
      root.allSublayers?.toArray?.() || root.sublayers?.toArray?.() || [];
    for (const sub of subs) {
      if (
        isQueryableFieldLayer(sub) &&
        normalizeQueryableLayerUrl(String(sub?.url || "")) === target
      ) {
        return sub;
      }
    }
  }
  return null;
}

export function isMapImageSublayer(layer: any): boolean {
  return String(layer?.type || "").toLowerCase() === "sublayer";
}

export function getMapImageParentLayer(layer: any): any | null {
  let parent = layer?.parent;
  while (parent) {
    if (String(parent?.type || "").toLowerCase() === "map-image") return parent;
    parent = parent?.parent;
  }
  // Sublayer.layer points at the MapImageLayer even when nested groups
  // sit between this leaf and the root (parent chain may lack type).
  if (String(layer?.layer?.type || "").toLowerCase() === "map-image") {
    return layer.layer;
  }
  return null;
}

/**
 * True for MapImageLayer roots and any queryable leaf that belongs to one.
 * Used to gate uniqueid-IN definitionExpression mirrors — those must never
 * overwrite the short tuman/turi clauses owned by syncRegionYearLayerVisibility
 * (long uniqueid IN (...) layerDefs flash unfiltered / whole-viloyat tiles).
 */
export function isMapImageOwnedLayer(layer: any): boolean {
  if (!layer) return false;
  const type = String(layer?.type || "").toLowerCase();
  if (type === "map-image" || type === "sublayer") return true;
  if (getMapImageParentLayer(layer)) return true;
  const url = String(layer?.url || "");
  if (/\/MapServer\/\d+/i.test(url) && (layer?.parent || layer?.layer)) {
    return true;
  }
  return false;
}

/**
 * Off-map FeatureLayer clients per service URL. Querying a live MapImage
 * Sublayer (createQuery/queryFeatures/queryExtent/load) rehydrates it and can
 * clear its runtime definitionExpression — the map then exports and briefly
 * paints every district's fields until a guard restores the filter. Every
 * read-only query in filter/zoom/renderer flows must go through these
 * detached clients instead of the live layer.
 */
const detachedQueryLayerCache = new Map<string, any>();
/** URLs that FeatureLayer#load() rejected (Group Layer / bad endpoint). */
const detachedQueryLayerFailedUrls = new Set<string>();

export async function getDetachedQueryLayerForUrl(url: string): Promise<any | null> {
  const cleanUrl = String(url || "").trim().replace(/\/+$/, "");
  if (!cleanUrl) return null;
  if (detachedQueryLayerFailedUrls.has(cleanUrl)) return null;
  // FeatureLayer requires a layer endpoint (.../MapServer/0 or FeatureServer/N).
  // MapServer roots fail #load() and only spam the console.
  if (
    !/\/(?:MapServer|FeatureServer)\/\d+$/i.test(cleanUrl) &&
    !/\/FeatureServer$/i.test(cleanUrl)
  ) {
    detachedQueryLayerFailedUrls.add(cleanUrl);
    return null;
  }
  let layer = detachedQueryLayerCache.get(cleanUrl);
  if (!layer) {
    try {
      const [FeatureLayer] = await loadArcGISJSAPIModules([
        "esri/layers/FeatureLayer",
      ]);
      layer = new FeatureLayer({ url: cleanUrl });
      detachedQueryLayerCache.set(cleanUrl, layer);
    } catch {
      detachedQueryLayerFailedUrls.add(cleanUrl);
      return null;
    }
  }
  try {
    await layer.load();
  } catch {
    // Group Layer endpoints and other unsupported sources — never retry.
    detachedQueryLayerFailedUrls.add(cleanUrl);
    detachedQueryLayerCache.delete(cleanUrl);
    return null;
  }
  return layer;
}

/** Detached query client for a live layer/sublayer (null when it has no URL). */
export async function getDetachedQueryLayerFor(liveLayer: any): Promise<any | null> {
  if (!liveLayer || isMapImageGroupSublayer(liveLayer)) return null;
  return getDetachedQueryLayerForUrl(String(liveLayer?.url || ""));
}

/**
 * Collect every queryable leaf under a MapImage root / group / FeatureLayer.
 * Unlike getQueryableLayer (first match only), this walks the full tree so
 * district/year leaves under "Agri 2026 republic data" stay clickable.
 */
export function collectQueryableFieldLayers(root: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();
  const walk = (node: any) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    // Always descend into group / map-image folders first.
    if (isMapImageGroupSublayer(node)) {
      const kids =
        node?.allSublayers?.toArray?.() ||
        node?.sublayers?.toArray?.() ||
        [];
      if (Array.isArray(kids)) {
        for (const kid of kids) walk(kid);
      }
      return;
    }
    if (isQueryableFieldLayer(node)) {
      out.push(node);
      return;
    }
    const kids =
      node?.allSublayers?.toArray?.() ||
      node?.sublayers?.toArray?.() ||
      [];
    if (Array.isArray(kids)) {
      for (const kid of kids) walk(kid);
    }
  };
  walk(root);
  return out;
}

/** @deprecated Prefer findQueryableLayerOnMapByUrl — numeric ids collide across Map Services. */
export function findQueryableLayerOnMapById(map: any, layerId: string): any | null {
  const id = String(layerId ?? "").trim();
  if (!map || !id) return null;

  const matches: any[] = [];
  for (const layer of getAllFeatureLayersFromMap(map)) {
    if (String(layer?.id ?? "") === id) matches.push(layer);
  }

  const roots: any[] = map.allLayers?.toArray?.() || map.layers?.toArray?.() || [];
  for (const root of roots) {
    if (String(root?.type || "").toLowerCase() !== "map-image") continue;
    const subs =
      root.allSublayers?.toArray?.() || root.sublayers?.toArray?.() || [];
    for (const sub of subs) {
      if (String(sub?.id ?? "") === id && isQueryableFieldLayer(sub)) {
        matches.push(sub);
      }
    }
  }

  if (matches.length === 1) return matches[0];
  return null;
}

function isLikelyBasemapServiceLayer(layer: any): boolean {
  const haystack =
    `${String(layer?.title || "")} ${String(layer?.url || "")}`.toLowerCase();
  return (
    haystack.includes("hillshade") ||
    haystack.includes("elevation/world") ||
    haystack.includes("services.arcgisonline.com") ||
    haystack.includes("arcgisonline.com/arcgis/rest")
  );
}

/** Agri region/year polygon fields (MapImage sublayers + FeatureLayers). */
function isAgriFieldLayerCandidate(layer: any): boolean {
  const fields = getLayerFieldNames(layer);
  if (
    fields.includes("uniqueid") ||
    fields.includes("crop_id") ||
    fields.includes("turi") ||
    fields.includes("maydon") ||
    fields.includes("viloyat")
  ) {
    return true;
  }
  const haystack =
    `${String(layer?.title || "")} ${String(layer?.url || "")} ${String(layer?.parent?.title || "")}`.toLowerCase();
  return (
    /\bagri\b/.test(haystack) ||
    haystack.includes("agriculture") ||
    haystack.includes("qishloq")
  );
}

/** Map candidates for Evapo + Agri — excludes basemaps only. */
function isEvapoMapLayerCandidate(layer: any): boolean {
  if (!isQueryableFieldLayer(layer)) return false;
  if (isLikelyBasemapServiceLayer(layer)) return false;
  const fields = getLayerFieldNames(layer);
  if (fields.length > 0) {
    return isEvapoWaterTableLayer(layer) || isAgriFieldLayerCandidate(layer);
  }
  const haystack =
    `${String(layer?.title || "")} ${String(layer?.url || "")}`.toLowerCase();
  return (
    haystack.includes("water_") ||
    haystack.includes("/water") ||
    haystack.includes("test_gusniddin") ||
    haystack.includes("test/") ||
    haystack.includes("sgm.uzspace") ||
    /\bagri\b/.test(haystack) ||
    haystack.includes("agriculture") ||
    /mapserver\/\d+$/i.test(haystack)
  );
}

/**
 * Resolve a queryable field layer from a FeatureLayer or MapImageLayer root.
 * Map Service data sources expose the parent map-image layer; widgets need
 * the sublayer that owns fields + /query. Nested group-sublayers are walked.
 */
export function getQueryableLayer(layer: any): any | null {
  if (!layer) return null;
  if (isQueryableFieldLayer(layer)) return layer;

  const seen = new Set<any>();
  const walk = (node: any): any | null => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (isQueryableFieldLayer(node)) return node;
    const subs =
      node?.allSublayers?.toArray?.() ||
      node?.sublayers?.toArray?.() ||
      [];
    if (!Array.isArray(subs)) return null;
    for (const sub of subs) {
      const found = walk(sub);
      if (found) return found;
    }
    return null;
  };

  return walk(layer);
}

/**
 * Builds the definitionExpression for a region+year sublayer, optionally
 * narrowed to one tuman, crop type (turi), vegetation uniqueids, and/or a
 * legacy vh attribute. Vegetatsiya Holati filtering must use uniqueids from
 * agri_vegetation_indices (ndvi_status) — the polygon `vh` field does not
 * store bar-chart categories like "4-Past".
 */
function buildSublayerDefinitionExpression(
  sublayer: any,
  tuman: string,
  turi: string | string[],
  vh = "",
  uniqueIds: string[] | null = null,
): string {
  const fields: any[] = sublayer?.fields || [];
  const findField = (name: string) =>
    fields.find((f) => String(f?.name || "").toLowerCase() === name);

  const clauses: string[] = [];

  const trimmedTuman = String(tuman ?? "").trim();
  if (trimmedTuman) {
    const tumanField = findField("tuman");
    // Region-year MapImage sublayers often have empty `fields` until the first
    // export completes. Falling back to "1=1" here would briefly show every
    // district's polygons after a tuman is selected — use the known field name.
    const tumanFieldName = tumanField?.name || (fields.length ? null : "tuman");
    if (tumanFieldName) {
      const variants = expandDistrictVariants(trimmedTuman);
      const values = variants.length ? variants : [trimmedTuman];
      const tumanClauses = values.map(
        (v) => `${tumanFieldName}='${escapeArcGIS(v)}'`,
      );
      clauses.push(`(${tumanClauses.join(" OR ")})`);
    }
  }

  // Prefer uniqueid IN (...) from vegetation ndvi_status (bar chart source).
  // Chunk large lists — a single 2k–10k UUID IN blows MapImage export URLs
  // and makes the filter feel stuck even when the expression is correct.
  if (uniqueIds) {
    if (!uniqueIds.length) {
      clauses.push("1=0");
    } else {
      const idField = findField("uniqueid")?.name || "uniqueid";
      const CHUNK = 800;
      const chunks: string[] = [];
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const slice = uniqueIds.slice(i, i + CHUNK);
        const values = slice
          .map((id) => `'${escapeArcGIS(String(id))}'`)
          .join(",");
        chunks.push(`${idField} IN (${values})`);
      }
      clauses.push(
        chunks.length === 1 ? chunks[0] : `(${chunks.join(" OR ")})`,
      );
      // Ids from vegetation are already crop-scoped when turi is selected —
      // ANDing MapImage `turi` text again can wipe a valid uniqueid set on
      // apostrophe/spelling mismatch. Skip turi when uniqueids are present.
    }
  } else {
    // No uniqueid filter yet (turi-only, or deferred VH first paint).
    const selectedTurlar = (Array.isArray(turi) ? turi : [turi])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (selectedTurlar.length) {
      const turiField = findField("turi");
      const turiFieldName = turiField?.name || (fields.length ? null : "turi");
      if (turiFieldName) {
        // Match Localization eqAposSmart — Bug'doy / Bug’doy etc. on MapImage.
        const cropClauses = selectedTurlar.flatMap((value) => {
          const variants = apostropheVariants(value);
          const values = variants.length ? variants : [value];
          return values.map((v) => `${turiFieldName}='${escapeArcGIS(v)}'`);
        });
        clauses.push(
          cropClauses.length === 1
            ? cropClauses[0]
            : `(${cropClauses.join(" OR ")})`,
        );
      }
    }

    // Legacy fallback: attribute `vh` with category label OR ndvi_status token.
    // Callers must pass vh="" when using vegetation uniqueids / deferred paint
    // — polygon `vh` does not store bar categories like "4-Past".
    const trimmedVh = String(vh ?? "").trim();
    if (trimmedVh) {
      const vhField = findField("vh");
      const vhFieldName = vhField?.name || (fields.length ? null : "vh");
      if (vhFieldName) {
        const statusToken = VH_CATEGORY_TO_STATUS[trimmedVh] || "";
        const variants = Array.from(
          new Set(
            [trimmedVh, statusToken].filter((v) => String(v || "").trim()),
          ),
        );
        const vhClauses = variants.map(
          (v) => `${vhFieldName}='${escapeArcGIS(String(v))}'`,
        );
        clauses.push(
          vhClauses.length === 1 ? vhClauses[0] : `(${vhClauses.join(" OR ")})`,
        );
      }
    }
  }

  return clauses.length ? clauses.join(" AND ") : "1=1";
}

/** Bar category → ndvi_status token (same mapping as AgriLocalization). */
const VH_CATEGORY_TO_STATUS: Record<string, string> = {
  "1-Juda yaxshi": "juda_yaxshi",
  "2-Yaxshi": "yaxshi",
  "3-O'rta": "orta",
  "4-Past": "past",
};

function summarizeDefinitionExpression(
  expression: unknown,
): string | null {
  if (expression == null) return null;
  const text = String(expression);
  if (text.length <= 420) return text;

  const uniqueIdInCount = (text.match(/\buniqueid\s+IN\s*\(/gi) || []).length;
  const quotedValueCount = (text.match(/'/g) || []).length / 2;
  return `${text.slice(0, 220)} ... [truncated ${text.length} chars, uniqueidInClauses=${uniqueIdInCount}, quotedValues≈${Math.floor(quotedValueCount)}]`;
}

/**
 * Recursively forces every sublayer of a MapImageLayer (and any nested
 * sublayer groups) to `visible = true` and applies the correct tuman/turi/vh
 * -aware `definitionExpression`. A MapImageLayer's own `visible` flag only
 * controls whether it's requested from the server at all — what actually
 * gets drawn is driven independently by each sublayer's own `visible`,
 * which defaults to off, and its own `definitionExpression`, which these
 * services default to "1=0" (matches zero rows).
 */
function forceSublayersVisible(
  layer: any,
  tuman: string,
  turi: string | string[],
  vh = "",
  uniqueIds: string[] | null = null,
  out: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  const subs = layer?.sublayers?.toArray?.() || layer?.allSublayers?.toArray?.();
  if (!Array.isArray(subs)) return out;
  for (const sub of subs) {
    const definitionExpressionBefore = sub?.definitionExpression ?? null;
    try {
      sub.visible = true;
      const nextExpression = buildSublayerDefinitionExpression(
        sub,
        tuman,
        turi,
        vh,
        uniqueIds,
      );
      // Register/refresh the guard BEFORE assigning, so our own legitimate
      // assignment below isn't treated as drift. From now on, any external
      // mutation of this sublayer's definitionExpression is logged (with the
      // setter's stack) and rolled back synchronously.
      guardSublayerDefinitionExpression(sub, nextExpression);
      // Avoid re-assigning an identical expression — MapImageLayer treats that
      // as a fresh export and briefly can show unfiltered tiles.
      if (String(definitionExpressionBefore ?? "") !== String(nextExpression ?? "")) {
        sub.definitionExpression = nextExpression;
      }
    } catch {
      /* ignore */
    }
    out.push({
      id: sub?.id,
      title: sub?.title,
      visible: sub?.visible,
      minScale: sub?.minScale,
      maxScale: sub?.maxScale,
      definitionExpressionBefore: summarizeDefinitionExpression(
        definitionExpressionBefore,
      ),
      definitionExpressionAfter: summarizeDefinitionExpression(
        sub?.definitionExpression ?? null,
      ),
    });
    forceSublayersVisible(sub, tuman, turi, vh, uniqueIds, out);
  }
  return out;
}

function collectLiveSublayers(
  layer: any,
  out: any[] = [],
): any[] {
  const sublayers =
    layer?.sublayers?.toArray?.() || layer?.allSublayers?.toArray?.();
  if (!Array.isArray(sublayers)) return out;
  for (const sublayer of sublayers) {
    out.push(sublayer);
    collectLiveSublayers(sublayer, out);
  }
  return out;
}

export interface ShownRegionYearLayer {
  layer: any;
  sublayers: any[];
}

/**
 * Always-on definitionExpression guard for a shown region-year sublayer.
 * Whatever code path clears/overwrites the sublayer's runtime
 * definitionExpression (hitTest identify hydration, a stray live-layer query,
 * another widget) is logged WITH a stack trace and the expected tuman/turi
 * filter is restored immediately — before the unfiltered export can paint
 * other districts' fields.
 */
const sublayerDefinitionGuards = new WeakMap<
  any,
  { expected: string; handle: any }
>();

function guardSublayerDefinitionExpression(sub: any, expected: string): void {
  const existing = sublayerDefinitionGuards.get(sub);
  if (existing) {
    existing.expected = String(expected ?? "");
    return;
  }
  const entry = { expected: String(expected ?? ""), handle: null as any };
  sublayerDefinitionGuards.set(sub, entry);
  try {
    entry.handle = sub?.watch?.(
      "definitionExpression",
      (newValue: unknown) => {
        const next = String(newValue ?? "");
        if (next === entry.expected) return;
        let stack = "";
        try {
          stack = String(new Error().stack || "")
            .split("\n")
            .slice(1, 10)
            .map((line) => line.trim())
            .join(" <= ");
        } catch {
          /* ignore */
        }
        regionYearLog("definitionExpression:DRIFT-restored", {
          sublayer: sub?.title ?? sub?.id,
          drifted: next || "<empty>",
          restored: entry.expected || "<empty>",
          setterStack: stack,
        });
        try {
          sub.definitionExpression = entry.expected;
        } catch {
          /* ignore */
        }
      },
    );
  } catch {
    /* watch unsupported on this layer type */
  }
}

// Detail logger disabled — keep call sites without console noise.
function regionYearLog(_phase: string, _detail?: Record<string, unknown>): void {
  /* no-op */
}

/**
 * Toggles visibility of region+year map layers (e.g. "agri andijan 2026
 * year", grouped under a "database 2026 year" group layer, with one such
 * sibling layer per region per year). Agri_table_data (the external table)
 * has no geometry and cannot represent this — the map's spatial
 * representation is still organized as one distinct layer per region+year,
 * so "filtering the map" here means showing the one layer that matches the
 * selected viloyat+yil (and, when set, narrowing its sublayer(s) further to
 * one tuman, crop type, and/or vegetation status) and hiding every other
 * region/year layer.
 *
 * Region+year matching is purely title/url text matching — schema-agnostic,
 * so it works regardless of what fields the underlying layers expose. Tuman,
 * turi, and vh narrowing need a matching attribute field on the sublayer; see
 * buildSublayerDefinitionExpression().
 *
 * Returns the layer(s) actually shown, with their live sublayer references,
 * so the caller can zoom to the real (tuman-aware) extent instead of the
 * whole region's fullExtent.
 */
export function syncRegionYearLayerVisibility(
  map: any,
  filters: Pick<EvapoFilters, "yil" | "viloyat" | "tuman"> & {
    turi?: string;
    turlar?: string[];
    vh?: string;
    /** When set (including []), filter polygons by uniqueid IN (...). */
    uniqueIds?: string[] | null;
  },
): ShownRegionYearLayer[] {
  const shown: ShownRegionYearLayer[] = [];
  const log = (_phase: string, _detail?: Record<string, unknown>): void => {
    /* no-op */
  };

  if (!map) {
    log("SKIP:no-map");
    return shown;
  }
  const yil = String(filters.yil ?? "").trim();
  const viloyat = String(filters.viloyat ?? "").trim();
  const tuman = String(filters.tuman ?? "").trim();
  const vh = String(filters.vh ?? "").trim();
  const uniqueIds =
    filters.uniqueIds === undefined ? null : filters.uniqueIds;
  const turlar = Array.from(
    new Set(
      (Array.isArray(filters.turlar) && filters.turlar.length
        ? filters.turlar
        : [filters.turi || ""]
      )
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const turi = turlar.length === 1 ? turlar[0] : "";
  if (!yil) {
    log("SKIP:no-year-selected-yet");
    return shown;
  }

  // Walk GroupLayer / MapImage / FeatureLayer trees explicitly. Relying only
  // on allLayers can miss Map Viewer TOC titles that live as nested sublayers
  // under "agri YYYY republic data".
  const regionYearLeaves = collectRegionYearLeafLayers(map);
  log("scan:start", {
    filters: {
      yil,
      viloyat,
      tuman,
      turi,
      turlar,
      vh,
      uniqueIdCount: uniqueIds ? uniqueIds.length : null,
    },
    totalRegionYearLeaves: regionYearLeaves.length,
    allLayerTitles: regionYearLeaves.map(
      (l: any) => l?.title || l?.url || l?.id,
    ),
  });

  const candidates: Array<{
    title: string;
    matchesYear: boolean;
    matchesRegion: boolean;
    visible: boolean;
  }> = [];
  // Prepare DE / parents first, then flip visibility. Starting the MapImage
  // export only after definitionExpression is set avoids a wasted first
  // export against the service default (often "1=0" or unfiltered).
  const pendingShow: any[] = [];

  for (const layer of regionYearLeaves) {
    const haystack = `${String(layer?.title || "")} ${String(layer?.url || "")}`;
    const matchesYear = haystackMatchesYear(haystack, yil);
    const matchesRegion = viloyat
      ? haystackMatchesRegion(haystack, viloyat)
      : false;
    const shouldShow = matchesYear && matchesRegion;

    try {
      if (shouldShow) {
        // Keep opacity at 1. The old opacity-0 → crop → opacity-1 dance left
        // MapImage sublayers / FeatureLayers permanently invisible when the
        // opacity target was the leaf (Sublayer.opacity is not the paint
        // opacity of the parent MapImage export).
        try {
          const opacityTarget = getRegionYearOpacityTarget(layer);
          if (opacityTarget && Number(opacityTarget.opacity ?? 1) !== 1) {
            opacityTarget.opacity = 1;
          }
          if (Number(layer.opacity ?? 1) !== 1) layer.opacity = 1;
        } catch {
          /* ignore */
        }

        let parent = (layer as any)?.parent;
        while (parent) {
          const parentType = String(parent?.type || "").toLowerCase();
          if (parentType === "group" || parentType === "map-image") {
            try {
              parent.visible = true;
            } catch {
              /* ignore */
            }
          }
          parent = parent?.parent;
        }

        applyShownRegionYearLayerFilters(
          layer,
          tuman,
          turlar,
          vh,
          uniqueIds,
        );

        const liveSublayers = collectLiveSublayers(layer);
        shown.push({ layer, sublayers: liveSublayers });
        pendingShow.push(layer);
      } else {
        layer.visible = false;
      }
    } catch {
      /* some layer types may not support direct visibility assignment */
    }
    candidates.push({
      title: layer?.title || layer?.url || layer?.id,
      matchesYear,
      matchesRegion,
      visible: shouldShow,
    });
  }

  for (const layer of pendingShow) {
    try {
      layer.visible = true;
    } catch {
      /* ignore */
    }
  }

  if (!candidates.length && viloyat) {
    // Local-only diagnostic — no network. Helps confirm title mismatch.
    try {
      const titles = (
        map.allLayers?.toArray?.() ||
        map.layers?.toArray?.() ||
        []
      ).map((l: any) => `${l?.type || "?"}:${l?.title || l?.id || "?"}`);
      // eslint-disable-next-line no-console
      console.warn(
        "[Agro_widgetV5] No region-year field layers matched selection",
        { yil, viloyat, mapLayerTitles: titles },
      );
    } catch {
      /* ignore */
    }
  }

  log("scan:result", {
    candidates,
    shownCount: candidates.filter((c) => c.visible).length,
  });

  return shown;
}

/** Opacity must be set on MapImage parent — Sublayer.opacity does not paint tiles. */
function getRegionYearOpacityTarget(layer: any): any {
  const type = String(layer?.type || "").toLowerCase();
  if (type === "sublayer") {
    return getMapImageParentLayer(layer) || layer;
  }
  return layer;
}

/**
 * Collect only per-region field leaves (never the republic aggregate container).
 * Safe: does not toggle visibility and does not request exports.
 */
export function collectRegionYearLeafLayers(map: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();

  const consider = (layer: any): void => {
    if (!layer || seen.has(layer)) return;
    seen.add(layer);
    const type = String(layer?.type || "").toLowerCase();
    if (type === "group") {
      const children = layer.layers?.toArray?.() || [];
      for (const child of children) consider(child);
      return;
    }
    if (type === "map-image") {
      const haystack = `${String(layer?.title || "")} ${String(layer?.url || "")}`;
      // Single-region MapImage (classic naming) — treat the service itself.
      if (
        looksLikeRegionYearLayerHaystack(haystack) &&
        haystackHasKnownRegionToken(haystack)
      ) {
        out.push(layer);
      }
      const subs =
        layer.allSublayers?.toArray?.() ||
        layer.sublayers?.toArray?.() ||
        [];
      for (const sub of subs) consider(sub);
      return;
    }

    const haystack = `${String(layer?.title || "")} ${String(layer?.url || "")}`;
    if (
      looksLikeRegionYearLayerHaystack(haystack) &&
      haystackHasKnownRegionToken(haystack)
    ) {
      out.push(layer);
    }
  };

  const roots = map.layers?.toArray?.() || map.allLayers?.toArray?.() || [];
  for (const layer of roots) consider(layer);
  return out;
}

/** Region-year MapImage parent URLs whose load() already failed (e.g. deleted/renamed service) — never retry. */
const regionYearPreloadFailedUrls = new Set<string>();

/**
 * Load MapImage metadata for region-year leaves (current year, optional viloyat)
 * without toggling visibility. Speeds the first export when the user later
 * reveals that region — cold `load()` no longer shares the critical path
 * with the heavy `export` request.
 */
export async function preloadRegionYearMapImages(
  map: any,
  yil: string,
  viloyat?: string,
): Promise<number> {
  if (!map) return 0;
  const year = String(yil || "").trim();
  if (!year) return 0;
  const region = String(viloyat || "").trim();
  const leaves = collectRegionYearLeafLayers(map);
  const parents = new Set<any>();
  for (const layer of leaves) {
    const haystack = `${String(layer?.title || "")} ${String(layer?.url || "")}`;
    if (!haystackMatchesYear(haystack, year)) continue;
    if (region && !haystackMatchesRegion(haystack, region)) continue;
    const parent = getMapImageParentLayer(layer) || layer;
    if (parent) parents.add(parent);
  }
  let loaded = 0;
  await Promise.all(
    Array.from(parents).map(async (layer) => {
      const key = String(layer?.url || layer?.id || "");
      if (key && regionYearPreloadFailedUrls.has(key)) return;
      try {
        if (typeof layer?.load === "function" && !layer.loaded) {
          await layer.load();
          loaded += 1;
        }
      } catch {
        // Dead/renamed service on the server side — stop retrying it every
        // year-change or widget mount.
        if (key) regionYearPreloadFailedUrls.add(key);
      }
    }),
  );
  return loaded;
}

/** Collect every queryable field layer on the map (feature + map-image sublayers). */
export function getAllFeatureLayersFromMap(map: any): any[] {
  if (!map) return [];
  const layers: any[] =
    map.allLayers?.toArray?.() || map.layers?.toArray?.() || [];
  const result: any[] = [];
  const seen = new Set<string>();

  const push = (layer: any): void => {
    if (!isEvapoMapLayerCandidate(layer)) return;
    const key = getEvapoLayerMapKey(layer);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(layer);
  };

  const walk = (node: any): void => {
    if (!node) return;
    push(node);
    const subs =
      node?.allSublayers?.toArray?.() ||
      node?.sublayers?.toArray?.() ||
      [];
    if (!Array.isArray(subs)) return;
    for (const sub of subs) walk(sub);
  };

  for (const layer of layers) {
    walk(layer);
  }
  return result;
}

export function normalizeRegionToken(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’'`ʻ‘ʼ]/g, "")
    .replace(/\s+viloyati/g, "")
    .replace(/\s+viloyat/g, "")
    .replace(/\s+region/g, "")
    .replace(/[^a-z0-9\u0400-\u04ff]/g, "")
    .trim();
}

/** Compare region labels ignoring apostrophe / viloyati spelling variants. */
export function regionFilterValuesEqual(a: string, b: string): boolean {
  return normalizeRegionToken(a) === normalizeRegionToken(b);
}

const REGION_ALIAS_GROUPS: string[][] = [
  ["fargona", "fergana", "ferghana", "фарғона", "фергана"],
  ["samarqand", "samarkand", "samar", "samarkhand"],
  ["toshkent", "tashkent"],
  ["andijon", "andijan"],
  ["namangan", "namangan"],
  ["buxoro", "bukhara", "buxara"],
  ["qashqadaryo", "kashkadarya", "kashkadaria", "qashqadarya", "kashkada"],
  // "sukhandarya" (missing the 'r') is a typo in the WebMap's 2025 layer title.
  ["surxondaryo", "surkhandarya", "surxandarya", "sukhandarya"],
  ["jizzax", "jizzakh", "jizakh"],
  ["sirdaryo", "syrdarya", "sirdarya"],
  ["navoiy", "navoi"],
  ["xorazm", "khorezm", "xorezm", "kharezm"],
  ["qoraqalpogiston", "karakalpakstan", "nukus", "qqr"],
];

/**
 * Detect region+year field layers by title/url.
 * Accepts both:
 * - classic: "... year ... 2026" / "agri andijan 2026 year"
 * - Test agri style: "agri andijan 2026" (agri + year number, no "year" word)
 *
 * Does NOT by itself mean the layer should be toggled — callers must also
 * require a known region token so aggregate titles like
 * "agri 2026 republic data" are never treated as a single region leaf
 * (forcing all of its sublayers visible would export every region at once).
 */
export function looksLikeRegionYearLayerHaystack(haystack: string): boolean {
  const text = String(haystack || "");
  if (!/\b(19|20)\d{2}\b/.test(text)) return false;
  return /\byear\b/i.test(text) || /\bagri\b/i.test(text);
}

/** True when title/url contains a known viloyat alias (andijan, ferghana, …). */
export function haystackHasKnownRegionToken(haystack: string): boolean {
  const text = normalizeRegionToken(haystack);
  if (!text) return false;
  for (const group of REGION_ALIAS_GROUPS) {
    if (group.some((alias) => text.includes(normalizeRegionToken(alias)))) {
      return true;
    }
  }
  return false;
}

/**
 * Apply tuman/turi/vh DE for a shown region leaf.
 * - MapImage with children: only that service's sublayers (one region).
 * - Leaf FeatureLayer / MapImage sublayer: DE on itself only.
 * Never walks sibling region sublayers of a republic aggregate.
 */
function applyShownRegionYearLayerFilters(
  layer: any,
  tuman: string,
  turi: string | string[],
  vh = "",
  uniqueIds: string[] | null = null,
): Array<Record<string, unknown>> {
  const type = String(layer?.type || "").toLowerCase();
  const subs =
    layer?.sublayers?.toArray?.() || layer?.allSublayers?.toArray?.() || [];
  const hasChildSublayers = Array.isArray(subs) && subs.length > 0;

  // Leaf (FeatureLayer or MapImage Sublayer): filter this layer only.
  if (type === "sublayer" || !hasChildSublayers) {
    const definitionExpressionBefore = layer?.definitionExpression ?? null;
    try {
      const nextExpression = buildSublayerDefinitionExpression(
        layer,
        tuman,
        turi,
        vh,
        uniqueIds,
      );
      guardSublayerDefinitionExpression(layer, nextExpression);
      if (
        String(definitionExpressionBefore ?? "") !==
        String(nextExpression ?? "")
      ) {
        layer.definitionExpression = nextExpression;
      }
    } catch {
      /* ignore */
    }
    return [
      {
        id: layer?.id,
        title: layer?.title,
        visible: layer?.visible,
        definitionExpressionBefore: summarizeDefinitionExpression(
          definitionExpressionBefore,
        ),
        definitionExpressionAfter: summarizeDefinitionExpression(
          layer?.definitionExpression ?? null,
        ),
        mode: "leaf",
      },
    ];
  }

  // Single-region MapImage: force only its own field sublayers.
  return forceSublayersVisible(layer, tuman, turi, vh, uniqueIds);
}

/** Region name tokens for matching layer titles like "Water Fergana region 2025 year". */
function getRegionMatchTokens(viloyat: string): string[] {
  const canonical = canonicalizeRegionFilterValue(viloyat);
  const norm = normalizeRegionToken(canonical);
  if (!norm) return [];

  for (const group of REGION_ALIAS_GROUPS) {
    if (group.some((alias) => norm.includes(normalizeRegionToken(alias)))) {
      return group.map((alias) => normalizeRegionToken(alias)).filter(Boolean);
    }
  }

  return [norm];
}

/** Score a title/url/label string for year + region match (shared by map + DS). */
export function scoreHaystackForFilters(
  haystack: string,
  filters: Pick<EvapoFilters, "yil" | "viloyat">,
): number {
  const text = String(haystack || "").toLowerCase();
  let score = 0;

  const yil = String(filters.yil ?? "").trim();
  if (yil && /^\d{4}$/.test(yil) && text.includes(yil)) {
    score += 10;
  }

  const viloyat = String(filters.viloyat ?? "").trim();
  if (viloyat) {
    for (const token of getRegionMatchTokens(viloyat)) {
      if (token && text.includes(token)) {
        score += 25;
        break;
      }
    }
  }

  return score;
}

/** True when a layer title/url/label explicitly matches the selected region. */
export function haystackMatchesRegion(haystack: string, viloyat?: string): boolean {
  const value = canonicalizeRegionFilterValue(String(viloyat ?? "").trim());
  if (!value) return false;
  const text = normalizeRegionToken(haystack);
  if (!text) return false;
  return getRegionMatchTokens(value).some((token) => !!token && text.includes(token));
}

/** Infer canonical region display name from a layer/DS title or URL (e.g. "water ferghana 2025"). */
export function inferRegionDisplayFromHaystack(haystack: string): string | null {
  for (const label of Object.values(REGION_SOATO_TO_UZ_NAME)) {
    if (haystackMatchesRegion(haystack, label)) return label;
  }
  return null;
}

export function haystackMatchesYear(haystack: string, yil?: string): boolean {
  const year = String(yil ?? "").trim();
  if (!/^\d{4}$/.test(year)) return false;
  return String(haystack || "").toLowerCase().includes(year);
}

function scoreLayerForFilters(
  layer: any,
  filters: Pick<EvapoFilters, "yil" | "viloyat">,
): number {
  const title = String(layer?.title || "").toLowerCase();
  const url = String(layer?.url || "").toLowerCase();
  return scoreHaystackForFilters(`${title} ${url}`, filters);
}

type ScoredLayerItem<T> = T & { regionMatch: boolean };

/**
 * When a single Map Service layer is used, its title may say 2024 while the UI
 * filter is 2025 — year is still applied via the `year` field in WHERE.
 */
export function pickYearRegionLayerPool<T extends ScoredLayerItem<{ score: number }>>(
  scored: T[],
  totalCandidates: number,
  filters: Pick<EvapoFilters, "yil" | "viloyat">,
  haystackFor: (item: T) => string,
): T[] {
  const wantsYear = /^\d{4}$/.test(String(filters.yil ?? "").trim());
  const wantsRegion = !!String(filters.viloyat ?? "").trim();

  let yearPool = wantsYear
    ? scored.filter((item) => haystackMatchesYear(haystackFor(item), filters.yil))
    : scored;

  if (wantsYear && !yearPool.length && scored.length) {
    const regionMatched = scored.filter((item) => item.regionMatch);
    if (regionMatched.length === 1) {
      yearPool = regionMatched;
    } else if (scored.length === 1 || totalCandidates === 1) {
      yearPool = scored;
    } else if (regionMatched.length > 0) {
      yearPool = regionMatched;
    }
  }

  if (!yearPool.length) return [];

  if (!wantsRegion) return yearPool;

  const regionPool = yearPool.filter((item) => item.regionMatch);
  if (regionPool.length) return regionPool;

  if (yearPool.length === 1 || totalCandidates === 1) return yearPool;

  const regionMatched = scored.filter((item) => item.regionMatch);
  return regionMatched.length ? regionMatched : yearPool;
}

/**
 * Pick the best feature layer for the current year/region filters.
 * In multi-layer apps (one layer per region+year), this avoids querying
 * the wrong layer (e.g. Kashkadarya when Farg'ona is selected).
 */
export async function resolveFeatureLayerForFilters(
  jimuMapView: any,
  filters: Pick<EvapoFilters, "yil" | "viloyat">,
): Promise<ResolvedFeatureLayer | null> {
  if (!jimuMapView?.view?.map) return null;
  try {
    const candidates = getAllFeatureLayersFromMap(jimuMapView.view.map);
    if (!candidates.length) return null;

    const wantsRegion = !!String(filters.viloyat ?? "").trim();
    const scored = candidates.map((candidate) => {
      const haystack = `${String(candidate?.title || "")} ${String(candidate?.url || "")}`;
      return {
        candidate,
        score: scoreLayerForFilters(candidate, filters),
        regionMatch: haystackMatchesRegion(haystack, filters.viloyat),
      };
    });

    const pool = pickYearRegionLayerPool(
      scored,
      candidates.length,
      filters,
      (item) =>
        `${String(item.candidate?.title || "")} ${String(item.candidate?.url || "")}`,
    );
    if (!pool.length) return null;

    let best: any = null;
    let bestScore = -1;
    let bestRegionMatch = false;
    for (const item of pool) {
      const { candidate, score, regionMatch } = item;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
        bestRegionMatch = regionMatch;
      }
    }

    const layer = best || pool[0]?.candidate || candidates[0];
    if (typeof layer.load === "function") await layer.load();
    disableLayerPbf(layer);
    const fields: string[] = (layer.fields || []).map((f: any) => f.name);
    const haystack = `${String(layer?.title || "")} ${String(layer?.url || "")}`;
    return {
      layer,
      fields,
      regionScoped: bestRegionMatch || bestScore >= 25,
      yearScoped: haystackMatchesYear(haystack, filters.yil),
    };
  } catch {
    return null;
  }
}

/** Resolve the first feature layer from a JimuMapView, loaded and ready. */
export async function getFeatureLayerFromView(
  jimuMapView: any,
  filters?: Pick<EvapoFilters, "yil" | "viloyat">,
): Promise<{ layer: any; fields: string[] } | null> {
  if (filters?.yil || filters?.viloyat) {
    const resolved = await resolveFeatureLayerForFilters(jimuMapView, filters);
    if (!resolved) return null;
    return { layer: resolved.layer, fields: resolved.fields };
  }

  if (!jimuMapView?.view?.map) return null;
  try {
    const candidates = getAllFeatureLayersFromMap(jimuMapView.view.map);
    const layer = candidates[0];
    if (!layer) return null;
    if (typeof layer.load === "function") await layer.load();
    const fields: string[] = (layer.fields || []).map((f: any) => f.name);
    return { layer, fields };
  } catch {
    return null;
  }
}

function hasFieldIn(fields: string[], name: string): boolean {
  const target = name.toLowerCase();
  return fields.some((f) => String(f).toLowerCase() === target);
}

/** Apostrophe / quote variants so values like Farg'ona match all encodings. */
export function apostropheVariants(value: string): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const base = raw.replace(/[’`ʻ‘ʼ]/g, "'");
  return Array.from(
    new Set([
      base,
      base.replace(/'/g, "’"),
      base.replace(/'/g, "`"),
      base.replace(/'/g, "ʻ"),
      base.replace(/'/g, "‘"),
      base.replace(/'/g, "ʼ"),
    ]),
  ).filter(Boolean);
}

function sortDistinctStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((v) => String(v).trim()).filter(Boolean)),
  ).sort((a, b) =>
    a.localeCompare(b, "uz", {
      sensitivity: "base",
      ignorePunctuation: true,
      numeric: true,
    }),
  );
}

/** Region name variants for WHERE (viloyat / region_id). */
export function expandRegionVariants(value: string): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const expanded = new Set<string>();
  const hasCyrillic = /[\u0400-\u04FF]/.test(raw);
  const latinSuffix = " viloyati";
  const cyrSuffix = " вилояти";

  const push = (candidate: string): void => {
    const clean = String(candidate ?? "").trim();
    if (!clean) return;
    expanded.add(clean);
    apostropheVariants(clean).forEach((variant) => expanded.add(variant));
  };

  apostropheVariants(raw).forEach((variant) => {
    push(variant);
    const lower = variant.toLowerCase();
    if (hasCyrillic) {
      if (lower.endsWith(cyrSuffix)) {
        push(variant.slice(0, -cyrSuffix.length).trim());
      } else {
        push(`${variant}${cyrSuffix}`);
      }
    } else {
      if (lower.endsWith(latinSuffix)) {
        push(variant.slice(0, -latinSuffix.length).trim());
      } else if (!lower.endsWith(" viloyat")) {
        push(`${variant}${latinSuffix}`);
      }
    }
  });

  return sortDistinctStrings(Array.from(expanded));
}

/** District name variants for WHERE (tuman / distrct_id). */
export function expandDistrictVariants(value: string): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const expanded = new Set<string>();
  const push = (candidate: string): void => {
    const clean = String(candidate ?? "").trim();
    if (!clean) return;
    expanded.add(clean);
    apostropheVariants(clean).forEach((variant) => expanded.add(variant));
  };

  push(raw);
  const lower = raw.toLowerCase();
  const suffixes = [
    " tumani",
    " shahri",
    " shahar",
    " тумани",
    " шаҳри",
    " район",
  ];
  for (const suf of suffixes) {
    const s = suf.toLowerCase();
    if (lower.endsWith(s)) {
      push(raw.slice(0, raw.length - suf.length).trim());
    } else {
      push(`${raw}${suf}`);
    }
  }
  return sortDistinctStrings(Array.from(expanded));
}

/** Grouped mavsum labels (ikkilamchi / birlamchi) for OR clauses. */
export function getMavsumGroupedValues(selectedValue: string): string[] {
  const selected = String(selectedValue ?? "").trim();
  if (!selected) return [];

  const normalized = selected
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const expandedValues = [selected];

  const isIkkilamchi =
    normalized.includes("ikkilamchi") ||
    normalized.includes("иккиламчи") ||
    normalized.includes("вторич");
  if (isIkkilamchi) {
    expandedValues.push(" Ikkilamchi", "Ikkilamchi");
  }

  const isBirlamchi =
    normalized.includes("birlamchi") ||
    normalized.includes("бирламчи") ||
    normalized.includes("первич");
  if (isBirlamchi) {
    expandedValues.push(
      "Birlamchi va umummavsumiy",
      "Umumiy va birlamchi mavsum",
    );
  }

  const unique = sortDistinctStrings(expandedValues);
  return unique.length ? unique : [selected];
}

/* ── Distinct-value index ──
 * UI filter values (e.g. "Birlamchi va umummavsumiy", "Bog‘dod tumani") may
 * not match the layer's stored values exactly. We load the distinct values of
 * each filterable field once per layer and match UI values fuzzily against
 * them, so WHERE clauses use the layer's REAL values.
 */
const VALUE_INDEX_FIELDS = [
  "season_id",
  "mavsum",
  "distrct_id",
  "district_id",
  "tuman",
  "region_id",
  "viloyat",
  "crop_id",
  "crop",
  "type_id",
  "type",
  "yer_turi",
  "full_name",
  "real_name",
  "real_n1",
  "minmax",
];

const valueIndexCache = new Map<string, Record<string, string[]>>();
const valueIndexLoading = new Map<string, Promise<void>>();

export async function prepareValueIndex(
  layer: any,
  available: string[],
): Promise<void> {
  const key = getQueryUrl(layer);
  if (!key || valueIndexCache.has(key)) return;
  const pending = valueIndexLoading.get(key);
  if (pending) return pending;

  const job = (async () => {
    const index: Record<string, string[]> = {};
    const fields = VALUE_INDEX_FIELDS.filter((f) => hasFieldIn(available, f));
    await Promise.all(
      fields.map(async (f) => {
        try {
          index[f.toLowerCase()] = await distinctValues(layer, f);
        } catch {
          index[f.toLowerCase()] = [];
        }
      }),
    );
    valueIndexCache.set(key, index);
    const sample: Record<string, string[]> = {};
    for (const f of Object.keys(index)) sample[f] = index[f].slice(0, 15);
    flLog("value index loaded", { layer: layerLabel(layer), sample });
  })();
  valueIndexLoading.set(key, job);
  try {
    await job;
  } finally {
    valueIndexLoading.delete(key);
  }
}

/** Aggressive normalization for value comparison (apostrophes, suffixes). */
function normalizeValueToken(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’'`ʻ‘ʼ]/g, "")
    .replace(/\s+tumani\b/g, "")
    .replace(/\s+viloyati\b/g, "")
    .replace(/\s+shahri\b/g, "")
    .replace(/[^a-z0-9\u0400-\u04ff]/g, "")
    .trim();
}

/**
 * Match a UI value against the layer's indexed distinct values of a field.
 * Returns: matched actual values; [] = index loaded but no match;
 * null = no index for this field (caller falls back to literal variants).
 */
function matchIndexedValues(
  layer: any,
  field: string,
  value: string,
): string[] | null {
  if (!layer) return null;
  const idx = valueIndexCache.get(getQueryUrl(layer));
  const vals = idx?.[field.toLowerCase()];
  if (!vals) return null;
  if (!vals.length) return [];
  const target = normalizeValueToken(value);
  if (!target) return [];

  const exact = vals.filter((v) => normalizeValueToken(v) === target);
  if (exact.length) return exact;

  const contains = vals.filter((v) => {
    const n = normalizeValueToken(v);
    return (
      n.length >= 3 &&
      target.length >= 3 &&
      (n.includes(target) || target.includes(n))
    );
  });
  return contains;
}

type TextMatchKind = "region" | "district" | "default";

export type LayerFieldKind = "numeric" | "string" | "unknown";

/**
 * Field type from layer metadata. Returns "unknown" when metadata is missing —
 * callers must NOT guess numeric in that case: an unquoted numeric literal on
 * a string field makes this server fail with "Unable to complete operation",
 * which silently kills the whole query (empty dropdowns, broken map filter).
 */
export function layerFieldKind(layer: any, field: string): LayerFieldKind {
  const target = String(field || "").toLowerCase();
  const meta = (layer?.fields || []).find(
    (f: any) => String(f?.name || "").toLowerCase() === target,
  );
  if (!meta?.type) return "unknown";
  const t = String(meta.type).toLowerCase();
  if (
    t.includes("integer") ||
    t.includes("double") ||
    t.includes("single") ||
    t.includes("oid")
  ) {
    return "numeric";
  }
  return "string";
}

function literalVariantsForMatch(
  value: string,
  kind: TextMatchKind,
): string[] {
  const canonical =
    kind === "region" ? canonicalizeRegionFilterValue(value) : value;
  if (kind === "region") return expandRegionVariants(canonical);
  if (kind === "district") return expandDistrictVariants(value);
  return apostropheVariants(value);
}

function addTextEqTerms(
  field: string,
  literals: string[],
  layer: any | undefined,
  value: string,
  addTerm: (term: string) => void,
): void {
  const matched = matchIndexedValues(layer, field, value);
  const vals =
    matched === null
      ? literals
      : matched.length
        ? matched
        : literals;
  const numericField = layerFieldKind(layer, field) === "numeric";
  for (const v of vals) {
    const digits = String(v).replace(/[^\d]/g, "");
    if (numericField) {
      // Numeric field: only emit when the value is fully numeric — a quoted
      // text literal on a numeric field fails server-side and kills the query.
      const raw = String(v).trim();
      if (digits && digits === raw && !isNaN(Number(digits))) {
        addTerm(`${field}=${Number(digits)}`);
      }
    } else {
      addTerm(`${field}='${escapeArcGIS(v)}'`);
    }
  }
}

function matchRegionValuesFromIndex(
  layer: any,
  field: string,
  canonical: string,
  soato?: string | null,
): string[] | null {
  if (!layer) return null;
  const idx = valueIndexCache.get(getQueryUrl(layer));
  const vals = idx?.[field.toLowerCase()];
  if (!vals) return null;
  if (!vals.length) return [];

  const matched = new Set<string>();
  const probes = [
    canonical,
    ...(soato ? [soato] : []),
    ...expandRegionVariants(canonical),
  ];
  for (const probe of probes) {
    const fromIdx = matchIndexedValues(layer, field, probe);
    if (fromIdx?.length) fromIdx.forEach((v) => matched.add(v));
  }

  if (!matched.size) {
    const token = normalizeValueToken(canonical);
    for (const v of vals) {
      const n = normalizeValueToken(v);
      if (!token || !n || n.length < 4 || token.length < 4) continue;
      if (n === token || n.includes(token) || token.includes(n)) {
        matched.add(v);
      }
    }
  }

  return Array.from(matched);
}

/** Build an OR clause matching `value` (+ variants) across the given fields. */
function textMatchClause(
  fields: string[],
  available: string[],
  value: string,
  layer?: any,
  kind: TextMatchKind = "default",
): string {
  const usable = fields.filter((f) => hasFieldIn(available, f));
  if (!usable.length) return "";

  const terms: string[] = [];
  const seen = new Set<string>();

  const addTerm = (term: string): void => {
    if (!term || seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };

  if (kind === "region") {
    const canonical = canonicalizeRegionFilterValue(value);
    const soato = isRegionSoatoCode(value)
      ? value.trim()
      : regionDisplayNameToSoato(canonical);

    for (const field of usable) {
      const fl = field.toLowerCase();
      if (fl === "region_id" || fl.endsWith("_id")) {
        const indexed = matchRegionValuesFromIndex(
          layer,
          field,
          canonical,
          soato,
        );
        if (indexed?.length) {
          for (const v of indexed) {
            addTextEqTerms(field, [v], layer, v, addTerm);
          }
        } else if (soato) {
          const kind = layerFieldKind(layer, field);
          if (kind === "numeric") {
            addTerm(`${field}=${Number(soato)}`);
          } else {
            addTerm(`${field}='${escapeArcGIS(soato)}'`);
          }
        }
        continue;
      }
      if (fl === "viloyat") {
        const indexed = matchRegionValuesFromIndex(
          layer,
          field,
          canonical,
          soato,
        );
        if (indexed?.length) {
          for (const v of indexed) {
            addTextEqTerms(field, [v], layer, v, addTerm);
          }
        } else {
          addTextEqTerms(
            field,
            expandRegionVariants(canonical),
            layer,
            canonical,
            addTerm,
          );
        }
      }
    }

    if (!terms.length && canonical) {
      addTextEqTerms(
        usable[0],
        expandRegionVariants(canonical),
        layer,
        canonical,
        addTerm,
      );
    }
  } else {
    const literals = literalVariantsForMatch(value, kind);
    if (!literals.length) return "";
    for (const field of usable) {
      addTextEqTerms(field, literals, layer, value, addTerm);
    }
  }

  if (!terms.length) return "";
  return terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`;
}

/** Exact OR clause across all available aliases (e.g. season_id + mavsum). */
function exactOrClause(
  fieldAliases: string[],
  values: string[],
  available: string[],
  numeric = false,
): string {
  const fields = fieldAliases.filter((f) => hasFieldIn(available, f));
  if (!fields.length || !values.length) return "";
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    for (const v of values) {
      const raw = String(v ?? "").trim();
      if (!raw) continue;
      let term = "";
      if (numeric) {
        const digits = raw.replace(/[^\d]/g, "");
        if (!digits || isNaN(Number(digits))) continue;
        term = `${field}=${Number(digits)}`;
      } else {
        term = `${field}='${escapeArcGIS(raw)}'`;
      }
      if (term && !seen.has(term)) {
        seen.add(term);
        terms.push(term);
      }
    }
  }
  if (!terms.length) return "";
  return terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`;
}

export const FARMER_TAX_NUMBER_FIELD = "tax_number";
const FARMER_TAX_NUMBER_DIGITS = 9;

export function normalizeFarmerTaxSearchValue(value: string): string {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, FARMER_TAX_NUMBER_DIGITS);
}

/**
 * WHERE for STIR qidiruv — `tax_number`.
 * Maydon tipi layer metadata dan olinadi: string maydonda raqamsiz literal
 * serverda "Unable to complete operation" beradi.
 */
export function buildFarmerTaxWhere(
  taxValue: string,
  available: string[],
  layer?: any,
): string {
  const raw = normalizeFarmerTaxSearchValue(taxValue);
  if (!raw) return "";
  if (available.length && !hasFieldIn(available, FARMER_TAX_NUMBER_FIELD)) {
    return "1=0";
  }

  const fieldName =
    available.find(
      (f) => f.toLowerCase() === FARMER_TAX_NUMBER_FIELD,
    ) || FARMER_TAX_NUMBER_FIELD;

  const kind = layer ? layerFieldKind(layer, fieldName) : "unknown";
  const esc = escapeArcGIS(raw);
  const numericValue = Number(raw);

  const exactClause = (): string => {
    if (kind === "string") {
      return `${fieldName}='${esc}'`;
    }
    if (kind === "numeric") {
      if (!Number.isFinite(numericValue)) return "1=0";
      return `${fieldName}=${numericValue}`;
    }
    const parts: string[] = [`${fieldName}='${esc}'`];
    if (Number.isFinite(numericValue)) {
      parts.push(`${fieldName}=${numericValue}`);
    }
    return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
  };

  if (raw.length >= FARMER_TAX_NUMBER_DIGITS) {
    return exactClause();
  }

  const prefixStringClause = `${fieldName} LIKE '${esc}%'`;

  if (kind === "string") {
    return prefixStringClause;
  }

  if (!Number.isFinite(numericValue)) return "1=0";

  const remainingDigits = FARMER_TAX_NUMBER_DIGITS - raw.length;
  const factor = Math.pow(10, remainingDigits);
  const min = numericValue * factor;
  const max = (numericValue + 1) * factor;
  const rangeClause = `(${fieldName}>=${min} AND ${fieldName}<${max})`;

  if (kind === "numeric") {
    return rangeClause;
  }
  return `(${rangeClause} OR ${prefixStringClause})`;
}

/**
 * WHERE for crop picker → map / min-max / stats.
 * Matches display name on `crop` only; numeric (or typed) id on `crop_id`.
 * Never compares crop names against a numeric `crop_id` field.
 */
export function buildCropSelectionWhere(
  cropType: string,
  cropId: string | undefined | null,
  available: string[],
  layer?: any,
): string {
  const clauses: string[] = [];

  const buildIdClause = (): string => {
    const id = String(cropId ?? "").trim();
    if (!id) return "";
    if (available.length && !hasFieldIn(available, "crop_id")) return "";

    const terms: string[] = [];
    const seen = new Set<string>();
    const addTerm = (term: string): void => {
      if (!term || seen.has(term)) return;
      seen.add(term);
      terms.push(term);
    };
    const kind = layerFieldKind(layer, "crop_id");
    if (/^\d+$/.test(id)) {
      if (kind === "numeric") {
        addTerm(`crop_id=${Number(id)}`);
      } else if (kind === "string") {
        addTerm(`crop_id='${escapeArcGIS(id)}'`);
      } else {
        addTerm(`crop_id=${Number(id)}`);
      }
    } else if (available.length) {
      addTextEqTerms("crop_id", [id], layer, id, addTerm);
    }
    if (!terms.length) return "";
    return terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`;
  };

  const buildNameClause = (): string => {
    const name = String(cropType ?? "").trim();
    if (!name) return "";
    if (available.length && !hasFieldIn(available, "crop")) return "";

    if (available.length) {
      return textMatchClause(["crop"], available, name, layer);
    }
    const literals = apostropheVariants(name);
    if (!literals.length) return "";
    if (literals.length === 1) {
      return `crop='${escapeArcGIS(literals[0])}'`;
    }
    return `(${literals
      .map((v) => `crop='${escapeArcGIS(v)}'`)
      .join(" OR ")})`;
  };

  const idClause = buildIdClause();
  const nameClause = buildNameClause();
  if (idClause) clauses.push(idClause);
  if (nameClause) clauses.push(nameClause);

  if (!clauses.length) return "";
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
}

function normalizeLandTypeValue(value: string): "" | "sugoriladigan" | "lalmi" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[’`ʻ‘ʼ]/g, "'")
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, "");
  if (!normalized || normalized === "barchasi" || normalized === "umumiy") {
    return "";
  }
  if (normalized === "1" || normalized.includes("sugor")) {
    return "sugoriladigan";
  }
  if (normalized === "2" || normalized.includes("lalmi")) return "lalmi";
  return "";
}

export function landTypeIdForValue(value: string): string {
  const key = normalizeLandTypeValue(value);
  if (key === "sugoriladigan") return "1";
  if (key === "lalmi") return "2";
  return "";
}

/** True when a specific land type is selected (not Barchasi / empty). */
export function hasActiveLandTypeFilter(
  yerTuri?: string | null,
  yerTuriId?: string | null,
): boolean {
  return !!(
    normalizeLandTypeValue(String(yerTuriId ?? "")) ||
    normalizeLandTypeValue(String(yerTuri ?? ""))
  );
}

export function buildLandTypeWhere(
  yerTuri: string | undefined | null,
  yerTuriId: string | undefined | null,
  available: string[],
  layer?: any,
): string {
  const key =
    normalizeLandTypeValue(String(yerTuriId ?? "")) ||
    normalizeLandTypeValue(String(yerTuri ?? ""));
  if (!key) return "";

  const id = key === "sugoriladigan" ? "1" : "2";

  const labels =
    key === "sugoriladigan"
      ? [
          "Sug'oriladigan",
          "Sug'orilgan",
          "Sugoriladigan",
          "Sugorilgan",
          "Sug’oriladigan",
          "Sug’orilgan",
        ]
      : ["Lalmi"];
  const terms: string[] = [];
  const seen = new Set<string>();
  const addTerm = (term: string): void => {
    if (!term || seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };

  // Prefer type_id (ID 1 = Sug'orilgan, ID 2 = Lalmi). Barchasi → no clause.
  if (!available.length || hasFieldIn(available, "type_id")) {
    const matchedIds = layer
      ? matchIndexedValues(layer, "type_id", id)
      : null;
    if (matchedIds?.length) {
      for (const v of matchedIds) {
        addTextEqTerms("type_id", [v], layer, v, addTerm);
      }
    } else {
      const kind = layerFieldKind(layer, "type_id");
      if (kind === "numeric") addTerm(`type_id=${Number(id)}`);
      else addTerm(`type_id='${escapeArcGIS(id)}'`);
    }
  }

  if (hasFieldIn(available, "type")) {
    for (const label of labels) {
      addTextEqTerms("type", apostropheVariants(label), layer, label, addTerm);
    }
  }

  if (hasFieldIn(available, "yer_turi")) {
    for (const label of labels) {
      addTextEqTerms(
        "yer_turi",
        apostropheVariants(label),
        layer,
        label,
        addTerm,
      );
    }
  }

  if (!terms.length) return "";
  return terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`;
}

/**
 * Build the WHERE clause from filters using FeatureLayer fields only.
 * `available` is the list of field names present on the layer.
 */
export function buildEvapoWhere(
  filters: EvapoFilters,
  available: string[],
  layer?: any,
): string {
  const clauses: string[] = [];
  const push = (clause: string): void => {
    if (clause) clauses.push(clause);
  };

  const yil = String(filters.yil ?? "").trim();
  if (yil && !filters.skipYearFilter && /^\d{4}$/.test(yil)) {
    if (hasFieldIn(available, "year")) push(`year='${escapeArcGIS(yil)}'`);
    else if (hasFieldIn(available, "yil")) push(`yil=${Number(yil)}`);
  }

  if (filters.viloyat && !filters.skipRegionFilter)
    push(
      textMatchClause(
        ["region_id", "viloyat"],
        available,
        canonicalizeRegionFilterValue(filters.viloyat),
        layer,
        "region",
      ),
    );
  if (filters.tuman)
    push(
      textMatchClause(
        ["distrct_id", "district_id", "tuman"],
        available,
        filters.tuman,
        layer,
        "district",
      ),
    );
  if (filters.mavsumOrValues?.length) {
    push(
      exactOrClause(
        ["season_id", "mavsum"],
        filters.mavsumOrValues,
        available,
      ),
    );
  } else if (filters.mavsum) {
    const groupedMavsumValues = getMavsumGroupedValues(filters.mavsum);
    push(
      groupedMavsumValues.length > 1
        ? exactOrClause(
            ["season_id", "mavsum"],
            groupedMavsumValues,
            available,
          )
        : textMatchClause(
            ["season_id", "mavsum"],
            available,
            filters.mavsum,
            layer,
          ),
    );
  }
  const farmerTax = normalizeFarmerTaxSearchValue(
    String(filters.farmerTax ?? ""),
  );
  if (farmerTax) {
    push(buildFarmerTaxWhere(farmerTax, available, layer));
  } else if (filters.fermer) {
    push(textMatchClause(["full_name"], available, filters.fermer, layer));
  }
  if (filters.crop || filters.cropId) {
    push(
      buildCropSelectionWhere(
        String(filters.crop ?? ""),
        filters.cropId,
        available,
        layer,
      ),
    );
  }
  if (hasActiveLandTypeFilter(filters.yerTuri, filters.yerTuriId)) {
    push(
      buildLandTypeWhere(
        filters.yerTuri,
        filters.yerTuriId,
        available,
        layer,
      ),
    );
  }
  if (filters.manba)
    push(textMatchClause(["real_name"], available, filters.manba, layer));
  if (filters.kanal)
    push(textMatchClause(["real_n1"], available, filters.kanal, layer));

  const mm = String(filters.minMax ?? "").trim().toLowerCase();
  if (mm && hasFieldIn(available, "minmax")) {
    const valuesFor = (want: string): string[] => {
      const matched = matchIndexedValues(layer, "minmax", want);
      if (matched && matched.length) return matched;
      return [want.charAt(0).toUpperCase() + want.slice(1)];
    };
    const eq = (vals: string[]): string =>
      vals.length === 1
        ? `minmax='${escapeArcGIS(vals[0])}'`
        : `(${vals.map((v) => `minmax='${escapeArcGIS(v)}'`).join(" OR ")})`;
    if (mm === "both")
      push(`(${eq(valuesFor("min"))} OR ${eq(valuesFor("max"))})`);
    else if (mm === "min") push(eq(valuesFor("min")));
    else if (mm === "max") push(eq(valuesFor("max")));
    else push(`minmax='${escapeArcGIS(String(filters.minMax))}'`);
  }

  if (filters.effMin != null || filters.effMax != null) {
    const effWhere = buildEfficiencyRangeWhere(
      filters.effMin,
      filters.effMax,
      available,
    );
    if (effWhere) push(effWhere);
  }

  return clauses.length ? clauses.join(" AND ") : "1=1";
}

/** Disabled by default. Enable: localStorage evapo_fl_data_debug=1 */
export function flLog(phase: string, detail?: Record<string, unknown>): void {
  try {
    if (globalThis.localStorage?.getItem("evapo_fl_data_debug") !== "1") return;
    (globalThis as { console?: Console }).console?.log?.("[EvapoFLData]", phase, detail ?? {});
  } catch {
    /* ignore */
  }
}

function layerLabel(layer: any): string {
  return String(layer?.title || layer?.url || layer?.id || "unknown");
}

/**
 * REST JSON fallback. The JS API prefers PBF responses; this server returns
 * malformed PBF ("Error while parsing FeatureSet PBF payload" in console),
 * so on failure we re-run the same query through esri/request with f=json.
 */
/**
 * Workaround for servers returning malformed PBF: rewrite f=pbf -> f=json on
 * query requests so both map rendering and our statistics queries get JSON.
 */
let pbfInterceptorInstalled = false;
export async function installPbfJsonWorkaround(): Promise<void> {
  if (pbfInterceptorInstalled) return;
  pbfInterceptorInstalled = true;
  try {
    const [esriConfig] = await loadArcGISJSAPIModules(["esri/config"]);
    const interceptors = esriConfig?.request?.interceptors;
    if (!interceptors) return;
    interceptors.push({
      urls: /sgm\.uzspace\.uz/i,
      before: (params: any) => {
        const q = params?.requestOptions?.query;
        if (!q) return;
        const fmt = String(q.f ?? "").toLowerCase();
        if (fmt === "pbf") q.f = "json";
      },
    });
    flLog("PBF→JSON interceptor installed for sgm.uzspace.uz");
  } catch (err: any) {
    flLog("PBF→JSON interceptor FAILED", {
      error: String(err?.message || err),
    });
  }
}

/** Disable PBF on a FeatureLayer instance (map view worker path). */
export function disableLayerPbf(layer: any): void {
  if (!layer) return;
  try {
    if (Object.prototype.hasOwnProperty.call(layer, "pbfEnabled")) {
      layer.pbfEnabled = false;
    }
  } catch {
    /* ignore */
  }
}

// Install as early as possible — before map layers start fetching PBF tiles.
void installPbfJsonWorkaround();

let esriRequestPromise: Promise<any> | null = null;
async function getEsriRequest(): Promise<any> {
  if (!esriRequestPromise) {
    esriRequestPromise = (async () => {
      const [esriRequest] = await loadArcGISJSAPIModules(["esri/request"]);
      return esriRequest;
    })();
  }
  return esriRequestPromise;
}

export function getQueryUrl(layer: any): string {
  const base = String(layer?.url || "").replace(/\/+$/, "");
  if (!base) return "";
  const layerId = layer?.layerId;
  const hasIndex = /\/\d+$/.test(base);
  const withIndex =
    hasIndex || layerId === undefined || layerId === null
      ? base
      : `${base}/${layerId}`;
  return `${withIndex}/query`;
}

const QUERY_CACHE_TTL_MS = 60 * 60 * 1000;
type TimedPromiseCache<T> = Map<string, { expires: number; value: Promise<T> }>;
const queryCountCache: TimedPromiseCache<number> = new Map();
const queryStatsCache: TimedPromiseCache<Array<Record<string, any>>> = new Map();
const queryJsonCache: TimedPromiseCache<any> = new Map();

function pruneTimedCache<T>(
  cache: TimedPromiseCache<T>,
  now = Date.now(),
): void {
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
}

function pruneEvapoQueryCache(now = Date.now()): void {
  pruneTimedCache(queryCountCache, now);
  pruneTimedCache(queryStatsCache, now);
  pruneTimedCache(queryJsonCache, now);
}

export function invalidateEvapoQueryCache(forceClear = false): void {
  if (forceClear) {
    queryCountCache.clear();
    queryStatsCache.clear();
    queryJsonCache.clear();
    return;
  }
  pruneEvapoQueryCache();
}

function cacheKey(layer: any, kind: string, payload: string): string {
  return `${getQueryUrl(layer) || layerLabel(layer)}|${kind}|${payload}`;
}

/** Fast feature count for layer selection (shared one-hour cache). */
export async function quickLayerFeatureCount(
  layer: any,
  where: string,
): Promise<number> {
  return countWhere(layer, where);
}

function stableCachePayload(value: unknown): string {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableCachePayload(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableCachePayload(obj[key])}`)
    .join(",")}}`;
}

export async function queryLayerJson(
  layer: any,
  params: Record<string, unknown>,
): Promise<any> {
  const url = getQueryUrl(layer);
  if (!url) throw new Error("Layer has no URL for JSON query");

  const key = cacheKey(layer, "json", stableCachePayload(params));
  const now = Date.now();
  pruneEvapoQueryCache(now);
  const hit = queryJsonCache.get(key);
  if (hit && hit.expires > now) return hit.value;

  const job = (async () => {
    const esriRequest = await getEsriRequest();
    const res = await esriRequest(url, {
      query: { f: "json", ...params },
      responseType: "json",
    });
    const data = res?.data;
    if (data?.error) {
      throw new Error(String(data.error?.message || "Query error"));
    }
    return data;
  })();

  queryJsonCache.set(key, { expires: now + QUERY_CACHE_TTL_MS, value: job });
  try {
    return await job;
  } catch (err) {
    if (queryJsonCache.get(key)?.value === job) queryJsonCache.delete(key);
    throw err;
  }
}

let extentClassPromise: Promise<any> | null = null;

async function getExtentClass(): Promise<any> {
  if (!extentClassPromise) {
    extentClassPromise = loadArcGISJSAPIModules([
      "esri/geometry/Extent",
    ]).then(([Extent]) => Extent);
  }
  return extentClassPromise;
}

/** Validate extent envelope before view.goTo (guards null / world bounds). */
export function isValidMapExtent(extent: any): boolean {
  if (!extent) return false;
  const xmin = Number(extent.xmin ?? 0);
  const ymin = Number(extent.ymin ?? 0);
  const xmax = Number(extent.xmax ?? 0);
  const ymax = Number(extent.ymax ?? 0);
  return (
    Number.isFinite(xmin) &&
    Number.isFinite(ymin) &&
    Number.isFinite(xmax) &&
    Number.isFinite(ymax) &&
    !(xmin === 0 && ymin === 0 && xmax === 0 && ymax === 0) &&
    !(xmin === -180 && ymin === -90 && xmax === 180 && ymax === 90) &&
    Math.abs(xmax - xmin) > 0.001 &&
    Math.abs(ymax - ymin) > 0.001
  );
}

async function extentFromJson(ext: Record<string, any>): Promise<any> {
  const Extent = await getExtentClass();
  return new Extent({
    xmin: ext.xmin,
    ymin: ext.ymin,
    xmax: ext.xmax,
    ymax: ext.ymax,
    spatialReference: ext.spatialReference,
  });
}

/**
 * Query filtered feature extent — Map Image sublayers often need REST fallback
 * because LayerView.queryExtent is unavailable on map-image sublayers.
 */
export async function queryLayerExtent(
  layer: any,
  where: string,
): Promise<any | null> {
  const queryable = getQueryableLayer(layer) || layer;
  if (!queryable) return null;
  const w = String(where || "1=1").trim() || "1=1";

  try {
    if (typeof queryable.queryExtent === "function") {
      const q =
        typeof queryable.createQuery === "function"
          ? queryable.createQuery()
          : { where: w };
      q.where = w;
      q.returnGeometry = true;
      if ("maxAllowableOffset" in q) q.maxAllowableOffset = 0;
      const res = await queryable.queryExtent(q);
      if (isValidMapExtent(res?.extent)) return res.extent;
    }
  } catch {
    /* REST fallback below */
  }

  try {
    const data = await queryLayerJson(queryable, {
      where: w,
      returnExtentOnly: true,
      returnGeometry: false,
    });
    if (isValidMapExtent(data?.extent)) {
      return extentFromJson(data.extent);
    }
  } catch {
    /* geometry fallback below */
  }

  try {
    const data = await queryLayerJson(queryable, {
      where: w,
      returnGeometry: true,
      outFields: queryable?.objectIdField || "OBJECTID",
      resultRecordCount: 200,
    });
    const features = Array.isArray(data?.features) ? data.features : [];
    if (!features.length) return null;

    let xmin = Infinity;
    let ymin = Infinity;
    let xmax = -Infinity;
    let ymax = -Infinity;
    let spatialReference: any = null;

    for (const feature of features) {
      const geom = feature?.geometry;
      if (!geom) continue;
      spatialReference = spatialReference || geom.spatialReference;
      const rings = geom.rings;
      const paths = geom.paths;
      const x = Number(geom.x);
      const y = Number(geom.y);
      if (Array.isArray(rings)) {
        for (const ring of rings) {
          for (const pt of ring) {
            const px = Number(pt?.[0]);
            const py = Number(pt?.[1]);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            xmin = Math.min(xmin, px);
            ymin = Math.min(ymin, py);
            xmax = Math.max(xmax, px);
            ymax = Math.max(ymax, py);
          }
        }
      } else if (Array.isArray(paths)) {
        for (const path of paths) {
          for (const pt of path) {
            const px = Number(pt?.[0]);
            const py = Number(pt?.[1]);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            xmin = Math.min(xmin, px);
            ymin = Math.min(ymin, py);
            xmax = Math.max(xmax, px);
            ymax = Math.max(ymax, py);
          }
        }
      } else if (Number.isFinite(x) && Number.isFinite(y)) {
        xmin = Math.min(xmin, x);
        ymin = Math.min(ymin, y);
        xmax = Math.max(xmax, x);
        ymax = Math.max(ymax, y);
      }
    }

    if (
      Number.isFinite(xmin) &&
      Number.isFinite(ymin) &&
      Number.isFinite(xmax) &&
      Number.isFinite(ymax)
    ) {
      const ext = await extentFromJson({
        xmin,
        ymin,
        xmax,
        ymax,
        spatialReference,
      });
      if (isValidMapExtent(ext)) return ext;
    }
  } catch {
    /* no extent */
  }

  return null;
}

async function countWhereUncached(layer: any, where: string): Promise<number> {
  const w = where || "1=1";
  try {
    const query = layer.createQuery();
    query.where = w;
    query.returnGeometry = false;
    const count = await layer.queryFeatureCount(query);
    flLog("countWhere OK", { layer: layerLabel(layer), where: w, count });
    return Number(count) || 0;
  } catch (err: any) {
    flLog("countWhere layer query FAILED → JSON fallback", {
      layer: layerLabel(layer),
      where: w,
      error: String(err?.message || err),
    });
  }
  try {
    const data = await queryLayerJson(layer, {
      where: w,
      returnCountOnly: true,
    });
    const count = Number(data?.count) || 0;
    flLog("countWhere JSON OK", { layer: layerLabel(layer), where: w, count });
    return count;
  } catch (err: any) {
    flLog("countWhere JSON FAILED", {
      layer: layerLabel(layer),
      where: w,
      error: String(err?.message || err),
    });
    return 0;
  }
}

/** Count features matching the WHERE clause (shared one-hour cache). */
export async function countWhere(layer: any, where: string): Promise<number> {
  const w = where || "1=1";
  const key = cacheKey(layer, "count", w);
  const now = Date.now();
  pruneEvapoQueryCache(now);
  const hit = queryCountCache.get(key);
  if (hit && hit.expires > now) return hit.value;

  const job = countWhereUncached(layer, w);
  queryCountCache.set(key, { expires: now + QUERY_CACHE_TTL_MS, value: job });
  return job;
}

export interface PickWhereWithMavsumFallbackResult {
  where: string;
  count: number;
  mavsumRelaxed: boolean;
  landTypeRelaxed?: boolean;
}

/**
 * Region+year scoped layers may not store UI mavsum labels (e.g. Samarqand 2025).
 * Combined layers (e.g. test_gusniddin) may also store different mavsum/type_id values.
 * When strict WHERE returns 0 rows, retry without mavsum and/or land type.
 */
export async function pickWhereWithMavsumFallback(
  layer: any,
  strictWhere: string,
  relaxedWhere: string,
  options?: { regionScoped?: boolean; allowRelax?: boolean },
): Promise<PickWhereWithMavsumFallbackResult> {
  const strict = String(strictWhere || "1=1").trim();
  const relaxed = String(relaxedWhere || strict).trim();
  const allowRelax = options?.allowRelax !== false && relaxed !== strict;

  const strictCount = await countWhere(layer, strict);
  if (strictCount > 0 || !allowRelax) {
    return { where: strict, count: strictCount, mavsumRelaxed: false };
  }

  const relaxedCount = await countWhere(layer, relaxed);
  if (relaxedCount > 0) {
    flLog("pickWhereWithMavsumFallback relaxed", {
      layer: layerLabel(layer),
      strictCount,
      relaxedCount,
      strictPreview:
        strict.length > 120 ? `${strict.slice(0, 120)}…` : strict,
    });
    return { where: relaxed, count: relaxedCount, mavsumRelaxed: true };
  }

  return { where: strict, count: strictCount, mavsumRelaxed: false };
}

export interface PickWhereProgressiveResult {
  where: string;
  count: number;
  mavsumRelaxed: boolean;
  landTypeRelaxed: boolean;
}

/** Try strict WHERE, then drop mavsum and/or land type when count is 0. */
export async function pickWhereWithProgressiveFallback(
  layer: any,
  filters: EvapoFilters,
  available: string[],
  options?: {
    regionScoped?: boolean;
    yearScoped?: boolean;
    polygonFilter?: string;
    allowMavsumRelax?: boolean;
    allowLandTypeRelax?: boolean;
  },
): Promise<PickWhereProgressiveResult> {
  const build = (overrides: Partial<EvapoFilters>): string => {
    const merged = { ...filters, ...overrides };
    let where = buildEvapoWhere(
      {
        ...merged,
        skipRegionFilter: options?.regionScoped,
        skipYearFilter: options?.yearScoped,
      },
      available,
      layer,
    );
    const polygon = String(options?.polygonFilter || "").trim();
    if (polygon) where = `(${where}) AND (${polygon})`;
    return where || "1=1";
  };

  const hasMavsum = !!String(filters.mavsum || "").trim();
  const hasLandType = hasActiveLandTypeFilter(
    filters.yerTuri,
    filters.yerTuriId,
  );
  const hasTuman = !!String(filters.tuman || "").trim();
  const allowMavsum = options?.allowMavsumRelax !== false && !hasTuman;
  const allowLandType = options?.allowLandTypeRelax !== false && !hasTuman;

  const attempts: Array<{
    where: string;
    mavsumRelaxed: boolean;
    landTypeRelaxed: boolean;
  }> = [
    { where: build({}), mavsumRelaxed: false, landTypeRelaxed: false },
  ];

  if (hasMavsum && allowMavsum) {
    attempts.push({
      where: build({ mavsum: "" }),
      mavsumRelaxed: true,
      landTypeRelaxed: false,
    });
  }
  if (hasLandType && allowLandType) {
    attempts.push({
      where: build({ yerTuri: "", yerTuriId: "" }),
      mavsumRelaxed: false,
      landTypeRelaxed: true,
    });
  }
  if (hasMavsum && hasLandType && allowMavsum && allowLandType) {
    attempts.push({
      where: build({ mavsum: "", yerTuri: "", yerTuriId: "" }),
      mavsumRelaxed: true,
      landTypeRelaxed: true,
    });
  }

  const seen = new Set<string>();
  let lastCount = 0;
  let lastWhere = attempts[0].where;

  for (const attempt of attempts) {
    if (seen.has(attempt.where)) continue;
    seen.add(attempt.where);
    const count = await countWhere(layer, attempt.where);
    lastCount = count;
    lastWhere = attempt.where;
    if (count > 0) {
      if (attempt.mavsumRelaxed || attempt.landTypeRelaxed) {
        flLog("pickWhereWithProgressiveFallback relaxed", {
          layer: layerLabel(layer),
          count,
          mavsumRelaxed: attempt.mavsumRelaxed,
          landTypeRelaxed: attempt.landTypeRelaxed,
          wherePreview:
            attempt.where.length > 120
              ? `${attempt.where.slice(0, 120)}…`
              : attempt.where,
        });
      }
      return { ...attempt, count };
    }
  }

  return {
    where: lastWhere,
    count: lastCount,
    mavsumRelaxed: false,
    landTypeRelaxed: false,
  };
}

/** Median with mavsum relaxation when strict WHERE matches no rows. */
export async function medianFieldWithMavsumFallback(
  layer: any,
  strictWhere: string,
  relaxedWhere: string,
  field: string,
  options?: { regionScoped?: boolean },
): Promise<number> {
  const picked = await pickWhereWithMavsumFallback(
    layer,
    strictWhere,
    relaxedWhere,
    options,
  );
  return medianField(layer, picked.where, field);
}

async function runStatsQueryUncached(
  layer: any,
  where: string,
  outStatistics: Array<Record<string, unknown>>,
  groupBy?: string[],
): Promise<Array<Record<string, any>>> {
  const w = where || "1=1";

  const queryJson = async (): Promise<Array<Record<string, any>>> => {
    const params: Record<string, unknown> = {
      where: w,
      returnGeometry: false,
      outStatistics: JSON.stringify(outStatistics),
    };
    if (groupBy?.length) {
      params.groupByFieldsForStatistics = groupBy.join(",");
    }
    const data = await queryLayerJson(layer, params);
    const rows = (data?.features || []).map((f: any) => f?.attributes || {});
    flLog("stats JSON OK", {
      layer: layerLabel(layer),
      where: w,
      groupBy: groupBy || null,
      rowCount: rows.length,
      firstRow: rows[0] || null,
    });
    return rows;
  };

  const queryLayer = async (): Promise<Array<Record<string, any>>> => {
    const query = layer.createQuery();
    query.where = w;
    query.returnGeometry = false;
    query.outStatistics = outStatistics as any;
    if (groupBy?.length) query.groupByFieldsForStatistics = groupBy as any;
    const res = await layer.queryFeatures(query);
    const rows = (res?.features || []).map((f: any) => f?.attributes || {});
    flLog("stats layer query OK", {
      layer: layerLabel(layer),
      where: w,
      groupBy: groupBy || null,
      rowCount: rows.length,
      firstRow: rows[0] || null,
    });
    return rows;
  };

  const hasPercentile = outStatistics.some((stat) =>
    String(stat?.statisticType ?? "").toLowerCase().includes("percentile"),
  );
  const preferJsonFirst = !groupBy?.length || hasPercentile;

  if (preferJsonFirst) {
    try {
      return await queryJson();
    } catch (err: any) {
      flLog("stats JSON fallback to layer", {
        layer: layerLabel(layer),
        where: w,
        groupBy: groupBy || null,
        error: String(err?.message || err),
      });
    }
  }

  try {
    return await queryLayer();
  } catch (err: any) {
    flLog("stats layer query fallback to JSON", {
      layer: layerLabel(layer),
      where: w,
      groupBy: groupBy || null,
      error: String(err?.message || err),
    });
  }

  try {
    return await queryJson();
  } catch (err: any) {
    flLog("stats JSON FAILED", {
      layer: layerLabel(layer),
      where: w,
      groupBy: groupBy || null,
      error: String(err?.message || err),
    });
    return [];
  }
}

async function runStatsQuery(
  layer: any,
  where: string,
  outStatistics: Array<Record<string, unknown>>,
  groupBy?: string[],
): Promise<Array<Record<string, any>>> {
  const w = where || "1=1";
  const payload = JSON.stringify({ outStatistics, groupBy: groupBy || [] });
  const key = cacheKey(layer, "stats", `${w}|${payload}`);
  const now = Date.now();
  pruneEvapoQueryCache(now);
  const hit = queryStatsCache.get(key);
  if (hit && hit.expires > now) return hit.value;

  const job = runStatsQueryUncached(layer, w, outStatistics, groupBy);
  queryStatsCache.set(key, { expires: now + QUERY_CACHE_TTL_MS, value: job });
  return job;
}

/** SUM of a single field for the WHERE clause. */
export async function sumField(
  layer: any,
  where: string,
  field: string,
): Promise<number> {
  const rows = await runStatsQuery(layer, where, [
    {
      statisticType: "sum",
      onStatisticField: field,
      outStatisticFieldName: "stat_v",
    },
  ]);
  const attrs = rows[0] || {};
  const val =
    attrs.stat_v ?? attrs.STAT_V ?? Object.values(attrs)[0];
  return Number(val) || 0;
}

/** SUM of several fields in one query. Returns a map field->sum. */
export async function sumFields(
  layer: any,
  where: string,
  fields: string[],
): Promise<Record<string, number>> {
  const rows = await runStatsQuery(
    layer,
    where,
    fields.map((f, i) => ({
      statisticType: "sum",
      onStatisticField: f,
      outStatisticFieldName: `s${i}`,
    })),
  );
  const attrs: Record<string, any> = rows[0] || {};
  const lowerAttrs: Record<string, any> = {};
  for (const k of Object.keys(attrs)) lowerAttrs[k.toLowerCase()] = attrs[k];
  const out: Record<string, number> = {};
  fields.forEach((f, i) => {
    out[f] = Number(lowerAttrs[`s${i}`]) || 0;
  });
  return out;
}

/** MEDIAN of a field. Tries percentile_cont, falls back to client-side. */
export async function medianField(
  layer: any,
  where: string,
  field: string,
): Promise<number> {
  // 1) Server-side percentile_cont (ArcGIS 10.9.1+)
  const rows = await runStatsQuery(layer, where, [
    {
      statisticType: "percentile_cont",
      onStatisticField: field,
      outStatisticFieldName: "stat_med",
      statisticParameters: { value: 0.5 },
    },
  ]);
  const attrs: Record<string, any> = rows[0] || {};
  for (const k of Object.keys(attrs)) {
    if (k.toLowerCase() === "stat_med" && attrs[k] !== null) {
      return Number(attrs[k]) || 0;
    }
  }

  // 2) Client-side median over non-null values (JSON to avoid PBF issues)
  const w = `(${where || "1=1"}) AND ${field} IS NOT NULL`;
  try {
    const data = await queryLayerJson(layer, {
      where: w,
      returnGeometry: false,
      outFields: field,
      resultRecordCount: 4000,
    });
    const values = (data?.features || [])
      .map((feat: any) => Number(feat?.attributes?.[field]))
      .filter((n: number) => Number.isFinite(n))
      .sort((a: number, b: number) => a - b);
    flLog("median client-side", {
      layer: layerLabel(layer),
      where: w,
      field,
      valueCount: values.length,
    });
    if (!values.length) return 0;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 !== 0
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;
  } catch (err: any) {
    flLog("median client-side FAILED", {
      layer: layerLabel(layer),
      field,
      error: String(err?.message || err),
    });
    return 0;
  }
}

/** Group by a field and SUM another. Returns sorted [{name, total}] desc. */
export async function sumByGroup(
  layer: any,
  where: string,
  groupField: string,
  sumF: string,
): Promise<Array<{ name: string; total: number }>> {
  const rows = await runStatsQuery(
    layer,
    where,
    [
      {
        statisticType: "sum",
        onStatisticField: sumF,
        outStatisticFieldName: "stat_total",
      },
    ],
    [groupField],
  );
  return rows
    .map((a: Record<string, any>) => {
      const lower: Record<string, any> = {};
      for (const k of Object.keys(a)) lower[k.toLowerCase()] = a[k];
      return {
        name: String(lower[groupField.toLowerCase()] ?? "").trim(),
        total: Number(lower.stat_total) || 0,
      };
    })
    .filter((row) => row.name && row.total > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * Group by crop_id (or any field): count, AVG of numeric field, MAX of label.
 * Single server round-trip — works when percentile_cont+groupBy does not.
 */
export async function cropStatsByGroup(
  layer: any,
  where: string,
  groupField: string,
  valueField?: string,
  labelField?: string,
): Promise<
  Array<{ id: string; label: string; count: number; avg: number }>
> {
  const oidField =
    String(layer?.objectIdField || "objectid").trim() || "objectid";
  const stats: Array<Record<string, unknown>> = [
    {
      statisticType: "count",
      onStatisticField: oidField,
      outStatisticFieldName: "stat_cnt",
    },
  ];
  if (valueField) {
    stats.push({
      statisticType: "avg",
      onStatisticField: valueField,
      outStatisticFieldName: "stat_avg",
    });
  }
  if (labelField) {
    stats.push({
      statisticType: "max",
      onStatisticField: labelField,
      outStatisticFieldName: "stat_label",
    });
  }
  const rows = await runStatsQuery(layer, where, stats, [groupField]);
  return rows
    .map((a: Record<string, any>) => {
      const lower: Record<string, any> = {};
      for (const k of Object.keys(a)) lower[k.toLowerCase()] = a[k];
      const id = String(lower[groupField.toLowerCase()] ?? "").trim();
      return {
        id,
        label: String(lower.stat_label ?? "").trim() || id,
        count: Number(lower.stat_cnt) || 0,
        avg: Number(lower.stat_avg) || 0,
      };
    })
    .filter((row) => row.id && row.count > 0);
}

/** Distinct non-empty values of a field (optionally filtered). */
export async function distinctValues(
  layer: any,
  field: string,
  where = "1=1",
): Promise<string[]> {
  const collect = (features: any[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const feat of features || []) {
      const raw = feat?.attributes?.[field];
      const v = String(raw ?? "").trim();
      if (v && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  };

  try {
    const query = layer.createQuery();
    query.where = where || "1=1";
    query.returnGeometry = false;
    query.returnDistinctValues = true;
    query.outFields = [field];
    query.orderByFields = [field] as any;
    const res = await layer.queryFeatures(query);
    return collect(res?.features || []);
  } catch {
    /* JSON fallback below */
  }

  try {
    const data = await queryLayerJson(layer, {
      where: where || "1=1",
      returnGeometry: false,
      returnDistinctValues: true,
      outFields: field,
      orderByFields: field,
    });
    return collect(data?.features || []);
  } catch {
    return [];
  }
}

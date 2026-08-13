/**
 * Administrative boundary outlines for Agro_widgetV4 map.
 *
 * Regions:  Hosted/regions/FeatureServer/5
 * Districts: Hosted/district/FeatureServer/3
 *
 * Outlines are drawn on GraphicsLayers from a one-shot JSON query.
 * Putting the Hosted FeatureLayer on the map makes the JS API fire
 * quantized PBF tile queries (f=pbf, resultType=tile) — those 400/500
 * on detailed polygons such as Farg'ona (parent_cod = 1730).
 */
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import { SessionManager } from "jimu-core";
import {
  canonicalizeRegionFilterValue,
  isValidMapExtent,
  normalizeRegionToken,
} from "./feature-layer-data";

export const AGRI_REGION_BOUNDARY_LAYER_ID = "agri-region-boundary";
export const AGRI_DISTRICT_BOUNDARY_LAYER_ID = "agri-district-boundary";
export const AGRI_ADMIN_BORDERS_STORAGE_KEY = "agri_admin_borders_visible";

export const AGRI_REGION_BOUNDARY_URL =
  "https://sgm.uzspace.uz/server/rest/services/Hosted/regions/FeatureServer/5";
export const AGRI_DISTRICT_BOUNDARY_URL =
  "https://sgm.uzspace.uz/server/rest/services/Hosted/district/FeatureServer/3";

const SGM_SERVER = "https://sgm.uzspace.uz/server";

/** Same field as Agrobank / eco-monitoring / geo-react admin outlines. */
const REGION_PARENT_COD_FIELDS = ["parent_cod", "PARENT_COD"];
const DISTRICT_CODE_FIELDS = ["district", "DISTRICT"];

/**
 * `parent_cod` values on Hosted/regions (and Agri_table_data `region`) —
 * same map as Agrobank `regions.json`. This is NOT the official Uzbekistan
 * SOATO table (which swaps Navoi↔Namangan and Fergana↔Kashkadarya).
 */
const HOSTED_PARENT_COD_TO_NAME: Record<string, string> = {
  "1703": "Andijon viloyati",
  "1706": "Buxoro viloyati",
  "1708": "Jizzax viloyati",
  "1710": "Qashqadaryo viloyati",
  "1712": "Navoiy viloyati",
  "1714": "Namangan viloyati",
  "1718": "Samarqand viloyati",
  "1722": "Surxondaryo viloyati",
  "1724": "Sirdaryo viloyati",
  "1726": "Toshkent shahri",
  "1727": "Toshkent viloyati",
  "1730": "Farg'ona viloyati",
  "1733": "Xorazm viloyati",
  "1735": "Qoraqalpog'iston Respublikasi",
};

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

function hostedParentCodFromName(name: string): number | null {
  const target = normalizeRegionToken(name);
  if (!target) return null;

  const matchTokens = new Set<string>([target]);
  for (const group of REGION_NAME_ALIAS_GROUPS) {
    const norms = group
      .map((alias) => normalizeRegionToken(alias))
      .filter(Boolean);
    if (norms.some((alias) => alias === target)) {
      norms.forEach((alias) => matchTokens.add(alias));
      break;
    }
  }

  // Prefer city over viloyat when token is just "toshkent" and user said shahri.
  const rawLower = String(name ?? "").toLowerCase();
  const preferCity =
    /shahri|shahar|city|г\./i.test(rawLower) ||
    normalizeRegionToken(name).endsWith("sh");

  let fallback: number | null = null;
  for (const [code, label] of Object.entries(HOSTED_PARENT_COD_TO_NAME)) {
    const labelToken = normalizeRegionToken(label);
    if (!labelToken || !matchTokens.has(labelToken)) continue;
    const isCity = /shahri|shahar|city/i.test(label) || labelToken.endsWith("sh");
    if (preferCity === isCity) {
      const n = Number(code);
      return Number.isFinite(n) ? n : null;
    }
    if (fallback == null) {
      const n = Number(code);
      if (Number.isFinite(n)) fallback = n;
    }
  }
  return fallback;
}

type BoundaryModules = {
  FeatureLayer: any;
  GraphicsLayer: any;
  Graphic: any;
  IdentityManager: any;
};

export interface AgriAdminBoundarySelection {
  viloyat?: string | null;
  tuman?: string | null;
  /** Numeric region code from Agri_table_data (`region`). */
  regionCode?: number | string | null;
  /** Numeric district code from Agri_table_data (`district`). */
  districtCode?: number | string | null;
}

export interface AgriAdminBoundarySyncResult {
  extent: any | null;
  level: "district" | "region" | "none";
}

let lastSelection: AgriAdminBoundarySelection = {};
let bordersVisiblePreferenceInitialized = false;
let bordersVisiblePreference = true;

export function readAgriAdminBordersVisible(): boolean {
  if (bordersVisiblePreferenceInitialized) return bordersVisiblePreference;
  bordersVisiblePreferenceInitialized = true;
  try {
    const raw = localStorage.getItem(AGRI_ADMIN_BORDERS_STORAGE_KEY);
    if (raw === "0" || raw === "false") bordersVisiblePreference = false;
    else if (raw === "1" || raw === "true") bordersVisiblePreference = true;
  } catch {
    /* ignore */
  }
  return bordersVisiblePreference;
}

export function writeAgriAdminBordersVisible(visible: boolean): void {
  bordersVisiblePreference = visible;
  bordersVisiblePreferenceInitialized = true;
  try {
    localStorage.setItem(AGRI_ADMIN_BORDERS_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    /* ignore */
  }
}

let modulesPromise: Promise<BoundaryModules> | null = null;
const detachedQueryLayers = new Map<string, any>();

async function loadModules(): Promise<BoundaryModules> {
  if (!modulesPromise) {
    modulesPromise = loadArcGISJSAPIModules([
      "esri/layers/FeatureLayer",
      "esri/layers/GraphicsLayer",
      "esri/Graphic",
      "esri/identity/IdentityManager",
    ]).then(([FeatureLayer, GraphicsLayer, Graphic, IdentityManager]) => ({
      FeatureLayer,
      GraphicsLayer,
      Graphic,
      IdentityManager,
    }));
  }
  return modulesPromise;
}

function readAuthToken(): string | null {
  try {
    const session = SessionManager.getInstance().getMainSession() as any;
    const fromSession = String(session?.token || "").trim();
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined") return null;
  try {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      const exbRaw = storage.getItem("exb_auth");
      if (exbRaw) {
        const parsed = JSON.parse(exbRaw) as { token?: unknown };
        const token =
          typeof parsed.token === "string" ? parsed.token.trim() : "";
        if (token) return token;
      }
      for (const key of ["token", "authToken", "arcgis_token", "arcgisToken"]) {
        const value = storage.getItem(key)?.trim();
        if (value) return value;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function registerServerToken(IdentityManager: any): void {
  const token = readAuthToken();
  if (!token) return;
  for (const server of [
    `${SGM_SERVER}/rest/services`,
    `${SGM_SERVER}/rest`,
    SGM_SERVER,
    "https://sgm.uzspace.uz/portal/sharing/rest",
  ]) {
    try {
      IdentityManager.registerToken({ server, token });
    } catch {
      /* best effort */
    }
  }
}

function escapeSql(value: string): string {
  return String(value ?? "").replace(/'/g, "''");
}

function pickField(layer: any, candidates: string[]): string | null {
  const fields: any[] = Array.isArray(layer?.fields) ? layer.fields : [];
  const lower = new Map(
    fields.map((f) => [
      String(f?.name || "").toLowerCase(),
      String(f?.name || ""),
    ]),
  );
  for (const candidate of candidates) {
    const hit = lower.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function buildOutlineSymbol(width = 2.2) {
  return {
    type: "simple-fill",
    color: [0, 0, 0, 0],
    outline: {
      type: "simple-line",
      color: [255, 255, 255, 0.95],
      width,
    },
  };
}

function createOutlineGraphicsLayer(
  GraphicsLayer: any,
  opts: { id: string; title: string },
) {
  return new GraphicsLayer({
    id: opts.id,
    title: opts.title,
    listMode: "hide",
    visible: false,
    opacity: 1,
  });
}

function findLayerById(map: any, id: string): any | null {
  if (!map?.layers) return null;
  return map.layers.find((layer: any) => layer?.id === id) || null;
}

function removeLegacyFeatureBoundaryLayers(map: any, urlHint: string): void {
  if (!map?.layers || !urlHint) return;
  const layers = map.layers.toArray?.() || [];
  for (const layer of layers) {
    const type = String(layer?.type || "").toLowerCase();
    const url = String(layer?.url || "");
    if (type === "feature" && url.includes(urlHint)) {
      try {
        map.remove(layer);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Off-map FeatureLayer used only for queryFeatures / queryExtent.
 * Never added to the view — that is what triggered the failing PBF tiles.
 */
async function getDetachedQueryLayer(
  FeatureLayer: any,
  url: string,
): Promise<any> {
  let layer = detachedQueryLayers.get(url);
  if (!layer) {
    layer = new FeatureLayer({
      url,
      outFields: ["*"],
    });
    detachedQueryLayers.set(url, layer);
  }
  try {
    if (typeof layer.load === "function") await layer.load();
  } catch {
    /* query may still work after a partial load */
  }
  return layer;
}

/**
 * Resolve a single Hosted/regions `parent_cod`.
 * Prefer Agri_table_data `region` (same coding as Hosted), then name→code via
 * Agrobank regions.json — never the official SOATO table (codes differ).
 */
function resolveRegionParentCod(
  selection: AgriAdminBoundarySelection,
): number | null {
  const fromMap = String(selection.regionCode ?? "").trim();
  if (/^\d{4}$/.test(fromMap)) {
    const n = Number(fromMap);
    if (Number.isFinite(n)) return n;
  }

  const viloyat = canonicalizeRegionFilterValue(
    String(selection.viloyat ?? "").trim(),
  );
  if (/^\d{4}$/.test(viloyat)) {
    // Numeric codes coming from UI / agri are Hosted parent_cod, not SOATO.
    const n = Number(viloyat);
    return Number.isFinite(n) ? n : null;
  }

  return hostedParentCodFromName(viloyat);
}

/** District outline uses the string `district` field (same as Agrobank). */
function resolveDistrictCode(
  selection: AgriAdminBoundarySelection,
): string | null {
  const fromMap = String(selection.districtCode ?? "").trim();
  if (/^\d+$/.test(fromMap)) return fromMap;

  const tuman = String(selection.tuman ?? "").trim();
  if (/^\d+$/.test(tuman)) return tuman;

  return null;
}

/** Integer or text `parent_cod` — PBF tiles were strict about the unquoted form. */
function buildNumericOrStringEquals(field: string, value: number): string {
  const raw = String(value);
  return `(${field} = ${raw} OR ${field} = '${escapeSql(raw)}')`;
}

async function resolveRegionWhere(
  layer: any,
  parentCod: number | null,
): Promise<string> {
  if (parentCod == null || !Number.isFinite(parentCod)) return "1=0";
  const field = pickField(layer, REGION_PARENT_COD_FIELDS) || "parent_cod";
  return buildNumericOrStringEquals(field, parentCod);
}

async function resolveDistrictWhere(
  layer: any,
  districtCode: string | null,
): Promise<string> {
  if (!districtCode) return "1=0";
  const field = pickField(layer, DISTRICT_CODE_FIELDS) || "district";
  return `${field} = '${escapeSql(districtCode)}'`;
}

function extentFromFeatures(features: any[]): any | null {
  let merged: any = null;
  for (const feature of features) {
    const featureExtent = feature?.geometry?.extent;
    if (!isValidMapExtent(featureExtent)) continue;
    merged = merged
      ? merged.union(featureExtent)
      : featureExtent.clone?.() || featureExtent;
  }
  return isValidMapExtent(merged) ? merged : null;
}

async function queryAndDrawOutline(opts: {
  queryLayer: any;
  outlineLayer: any;
  Graphic: any;
  where: string;
  view: any;
  outlineWidth: number;
  bordersVisible: boolean;
}): Promise<any | null> {
  const {
    queryLayer,
    outlineLayer,
    Graphic,
    where,
    view,
    outlineWidth,
    bordersVisible,
  } = opts;

  try {
    outlineLayer.removeAll?.();
  } catch {
    /* ignore */
  }

  if (!queryLayer || !where || where === "1=0") {
    hideLayer(outlineLayer);
    return null;
  }

  const oidField = queryLayer.objectIdField || "OBJECTID";
  const runQuery = async (maxAllowableOffset?: number): Promise<any[]> => {
    const query = queryLayer.createQuery();
    query.where = where;
    query.returnGeometry = true;
    query.outFields = [oidField];
    query.num = 50;
    if (maxAllowableOffset != null && maxAllowableOffset > 0) {
      query.maxAllowableOffset = maxAllowableOffset;
    }
    const result = await queryLayer.queryFeatures(query);
    return result?.features || [];
  };

  let features: any[] = [];
  try {
    // Full rings — same visual as the previous FeatureLayer outline.
    // Do not generalize here: a 50–150 m offset made Farg'ona look jagged.
    features = await runQuery();
  } catch {
    features = [];
  }
  if (!features.length) {
    try {
      const resolution = Number(view?.resolution);
      const fallbackOffset =
        Number.isFinite(resolution) && resolution > 0 ? resolution * 0.25 : 5;
      features = await runQuery(fallbackOffset);
    } catch {
      features = [];
    }
  }

  const symbol = buildOutlineSymbol(outlineWidth);
  for (const feature of features) {
    if (!feature?.geometry) continue;
    try {
      outlineLayer.add(
        new Graphic({
          geometry: feature.geometry,
          symbol,
        }),
      );
    } catch {
      /* skip bad graphic */
    }
  }

  try {
    outlineLayer.visible = bordersVisible && features.length > 0;
  } catch {
    /* ignore */
  }

  const fromFeatures = extentFromFeatures(features);
  if (fromFeatures) return fromFeatures;

  try {
    const query = queryLayer.createQuery();
    query.where = where;
    query.returnGeometry = true;
    const extent = (await queryLayer.queryExtent(query))?.extent;
    if (isValidMapExtent(extent)) return extent;
  } catch {
    /* ignore */
  }
  return null;
}

function ensureOutlineLayer(
  map: any,
  GraphicsLayer: any,
  opts: { id: string; title: string; urlHint: string },
): any {
  removeLegacyFeatureBoundaryLayers(map, opts.urlHint);
  let layer = findLayerById(map, opts.id);
  const type = String(layer?.type || "").toLowerCase();
  if (layer && type !== "graphics") {
    try {
      map.remove(layer);
    } catch {
      /* ignore */
    }
    layer = null;
  }
  if (!layer) {
    layer = createOutlineGraphicsLayer(GraphicsLayer, opts);
    map.add(layer);
  }
  return layer;
}

function hideLayer(layer: any): void {
  if (!layer) return;
  try {
    layer.visible = false;
    if (typeof layer.removeAll === "function") layer.removeAll();
    if ("definitionExpression" in layer) layer.definitionExpression = "1=0";
  } catch {
    /* ignore */
  }
}

function bringToFront(map: any, layer: any): void {
  if (!map || !layer || typeof map.reorder !== "function") return;
  try {
    map.reorder(layer, Math.max(0, (map.layers?.length || 1) - 1));
  } catch {
    /* ignore */
  }
}

/**
 * Sync admin outline layers for the current viloyat/tuman selection and
 * return the preferred zoom extent (district > region > null).
 * Visibility toggle only hides the outline — extent is still returned for zoom.
 */
export async function syncAgriAdminBoundaries(
  view: any | null | undefined,
  selection: AgriAdminBoundarySelection,
): Promise<AgriAdminBoundarySyncResult> {
  const map = view?.map;
  if (!map || !view) {
    return { extent: null, level: "none" };
  }

  lastSelection = {
    viloyat: selection.viloyat ?? "",
    tuman: selection.tuman ?? "",
    regionCode: selection.regionCode ?? null,
    districtCode: selection.districtCode ?? null,
  };

  const bordersVisible = readAgriAdminBordersVisible();
  const viloyat = canonicalizeRegionFilterValue(
    String(selection.viloyat ?? "").trim(),
  );
  const tuman = String(selection.tuman ?? "").trim();
  const parentCod = resolveRegionParentCod(selection);
  const districtCode = resolveDistrictCode(selection);

  try {
    const { FeatureLayer, GraphicsLayer, Graphic, IdentityManager } =
      await loadModules();
    registerServerToken(IdentityManager);

    const regionOutline = ensureOutlineLayer(map, GraphicsLayer, {
      id: AGRI_REGION_BOUNDARY_LAYER_ID,
      title: "Region boundary",
      urlHint: "Hosted/regions",
    });
    const districtOutline = ensureOutlineLayer(map, GraphicsLayer, {
      id: AGRI_DISTRICT_BOUNDARY_LAYER_ID,
      title: "District boundary",
      urlHint: "Hosted/district",
    });
    const regionQueryLayer = await getDetachedQueryLayer(
      FeatureLayer,
      AGRI_REGION_BOUNDARY_URL,
    );
    const districtQueryLayer = await getDetachedQueryLayer(
      FeatureLayer,
      AGRI_DISTRICT_BOUNDARY_URL,
    );

    if (tuman) {
      hideLayer(regionOutline);
      const where = await resolveDistrictWhere(districtQueryLayer, districtCode);
      const extent = await queryAndDrawOutline({
        queryLayer: districtQueryLayer,
        outlineLayer: districtOutline,
        Graphic,
        where,
        view,
        outlineWidth: 2.0,
        bordersVisible,
      });
      if (bordersVisible) bringToFront(map, districtOutline);
      return {
        extent: isValidMapExtent(extent) ? extent : null,
        level: "district",
      };
    }

    hideLayer(districtOutline);

    if (viloyat || parentCod != null) {
      const where = await resolveRegionWhere(regionQueryLayer, parentCod);
      const extent = await queryAndDrawOutline({
        queryLayer: regionQueryLayer,
        outlineLayer: regionOutline,
        Graphic,
        where,
        view,
        outlineWidth: 2.4,
        bordersVisible,
      });
      if (bordersVisible) bringToFront(map, regionOutline);
      return {
        extent: isValidMapExtent(extent) ? extent : null,
        level: "region",
      };
    }

    hideLayer(regionOutline);
    hideLayer(districtOutline);
    return { extent: null, level: "none" };
  } catch {
    return { extent: null, level: "none" };
  }
}

/** Toggle outline visibility without clearing the last selection. */
export async function setAgriAdminBordersVisible(
  view: any | null | undefined,
  visible: boolean,
): Promise<void> {
  writeAgriAdminBordersVisible(visible);
  if (!view) return;
  if (!visible) {
    const map = view.map;
    if (!map) return;
    for (const layer of [
      findLayerById(map, AGRI_REGION_BOUNDARY_LAYER_ID),
      findLayerById(map, AGRI_DISTRICT_BOUNDARY_LAYER_ID),
    ]) {
      if (!layer) continue;
      try {
        layer.visible = false;
      } catch {
        /* ignore */
      }
    }
    return;
  }
  await syncAgriAdminBoundaries(view, lastSelection);
}

/** Clear both boundary outlines (home / no selection). */
export async function clearAgriAdminBoundaries(
  view: any | null | undefined,
): Promise<void> {
  lastSelection = {};
  const map = view?.map;
  if (!map) return;
  hideLayer(findLayerById(map, AGRI_REGION_BOUNDARY_LAYER_ID));
  hideLayer(findLayerById(map, AGRI_DISTRICT_BOUNDARY_LAYER_ID));
}

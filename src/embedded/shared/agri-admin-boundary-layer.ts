/**
 * Administrative boundary outlines for Agro_widgetV1 map.
 *
 * Regions:  Hosted/regions/FeatureServer/5
 * Districts: Hosted/district/FeatureServer/3
 *
 * On viloyat/tuman selection the matching polygon outline is shown and its
 * extent is returned for view.goTo (preferred over crop MapImage hull).
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
  ["surxondaryo", "surkhandarya", "surxandarya"],
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

async function loadModules(): Promise<BoundaryModules> {
  if (!modulesPromise) {
    modulesPromise = loadArcGISJSAPIModules([
      "esri/layers/FeatureLayer",
      "esri/identity/IdentityManager",
    ]).then(([FeatureLayer, IdentityManager]) => ({
      FeatureLayer,
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

function buildOutlineRenderer(width = 2.2) {
  return {
    type: "simple",
    symbol: {
      type: "simple-fill",
      color: [0, 0, 0, 0],
      outline: {
        type: "simple-line",
        color: [255, 255, 255, 0.95],
        width,
      },
    },
  };
}

function createBoundaryLayer(
  FeatureLayer: any,
  opts: { id: string; title: string; url: string; outlineWidth?: number },
) {
  const token = readAuthToken();
  return new FeatureLayer({
    id: opts.id,
    title: opts.title,
    url: opts.url,
    listMode: "hide",
    legendEnabled: false,
    popupEnabled: false,
    labelingInfo: [],
    labelsVisible: false,
    outFields: ["*"],
    visible: false,
    opacity: 1,
    definitionExpression: "1=0",
    renderer: buildOutlineRenderer(opts.outlineWidth ?? 2.2),
    ...(token ? { customParameters: { token } } : {}),
  });
}

function findLayerById(map: any, id: string, urlHint: string): any | null {
  if (!map?.layers) return null;
  return (
    map.layers.find(
      (layer: any) =>
        layer?.id === id || String(layer?.url || "").includes(urlHint),
    ) || null
  );
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

async function resolveRegionWhere(
  layer: any,
  parentCod: number | null,
): Promise<string> {
  if (parentCod == null || !Number.isFinite(parentCod)) return "1=0";

  try {
    if (typeof layer.load === "function") await layer.load();
  } catch {
    /* continue */
  }

  const field = pickField(layer, REGION_PARENT_COD_FIELDS) || "parent_cod";
  // Exact Agrobank / eco-monitoring expression — one code, one field.
  return `${field} = ${parentCod}`;
}

async function resolveDistrictWhere(
  layer: any,
  districtCode: string | null,
): Promise<string> {
  if (!districtCode) return "1=0";

  try {
    if (typeof layer.load === "function") await layer.load();
  } catch {
    /* continue */
  }

  const field = pickField(layer, DISTRICT_CODE_FIELDS) || "district";
  return `${field} = '${escapeSql(districtCode)}'`;
}

async function queryLayerExtentSafe(
  layer: any,
  where: string,
): Promise<any | null> {
  if (!layer || !where || where === "1=0") return null;
  try {
    const query = layer.createQuery();
    query.where = where;
    query.returnGeometry = true;
    const extent = (await layer.queryExtent(query))?.extent;
    if (isValidMapExtent(extent)) return extent;
  } catch {
    /* try features */
  }

  try {
    const query = layer.createQuery();
    query.where = where;
    query.returnGeometry = true;
    query.outFields = [layer.objectIdField || "OBJECTID"];
    query.num = 50;
    const result = await layer.queryFeatures(query);
    let merged: any = null;
    for (const feature of result?.features || []) {
      const featureExtent = feature?.geometry?.extent;
      if (!isValidMapExtent(featureExtent)) continue;
      merged = merged
        ? merged.union(featureExtent)
        : featureExtent.clone?.() || featureExtent;
    }
    return isValidMapExtent(merged) ? merged : null;
  } catch {
    return null;
  }
}

function ensureLayerOnMap(
  map: any,
  FeatureLayer: any,
  opts: { id: string; title: string; url: string; urlHint: string; outlineWidth?: number },
): any {
  let layer = findLayerById(map, opts.id, opts.urlHint);
  if (!layer) {
    layer = createBoundaryLayer(FeatureLayer, opts);
    map.add(layer);
  } else {
    try {
      layer.renderer = buildOutlineRenderer(opts.outlineWidth ?? 2.2);
    } catch {
      /* ignore */
    }
    const token = readAuthToken();
    if (token) {
      try {
        layer.customParameters = {
          ...(layer.customParameters || {}),
          token,
        };
      } catch {
        /* ignore */
      }
    }
  }
  return layer;
}

function hideLayer(layer: any): void {
  if (!layer) return;
  try {
    layer.visible = false;
    layer.definitionExpression = "1=0";
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
    const { FeatureLayer, IdentityManager } = await loadModules();
    registerServerToken(IdentityManager);

    const regionLayer = ensureLayerOnMap(map, FeatureLayer, {
      id: AGRI_REGION_BOUNDARY_LAYER_ID,
      title: "Region boundary",
      url: AGRI_REGION_BOUNDARY_URL,
      urlHint: "Hosted/regions",
      outlineWidth: 2.4,
    });
    const districtLayer = ensureLayerOnMap(map, FeatureLayer, {
      id: AGRI_DISTRICT_BOUNDARY_LAYER_ID,
      title: "District boundary",
      url: AGRI_DISTRICT_BOUNDARY_URL,
      urlHint: "Hosted/district",
      outlineWidth: 2.0,
    });

    if (tuman) {
      hideLayer(regionLayer);
      const where = await resolveDistrictWhere(districtLayer, districtCode);
      try {
        districtLayer.definitionExpression = where;
        districtLayer.visible = bordersVisible && where !== "1=0";
      } catch {
        /* ignore */
      }
      if (bordersVisible) bringToFront(map, districtLayer);
      const extent = await queryLayerExtentSafe(districtLayer, where);
      return {
        extent: isValidMapExtent(extent) ? extent : null,
        level: "district",
      };
    }

    hideLayer(districtLayer);

    if (viloyat || parentCod != null) {
      const where = await resolveRegionWhere(regionLayer, parentCod);
      try {
        regionLayer.definitionExpression = where;
        regionLayer.visible = bordersVisible && where !== "1=0";
      } catch {
        /* ignore */
      }
      if (bordersVisible) bringToFront(map, regionLayer);
      const extent = await queryLayerExtentSafe(regionLayer, where);
      return {
        extent: isValidMapExtent(extent) ? extent : null,
        level: "region",
      };
    }

    hideLayer(regionLayer);
    hideLayer(districtLayer);
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
      findLayerById(map, AGRI_REGION_BOUNDARY_LAYER_ID, "Hosted/regions"),
      findLayerById(map, AGRI_DISTRICT_BOUNDARY_LAYER_ID, "Hosted/district"),
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
  const regionLayer = findLayerById(
    map,
    AGRI_REGION_BOUNDARY_LAYER_ID,
    "Hosted/regions",
  );
  const districtLayer = findLayerById(
    map,
    AGRI_DISTRICT_BOUNDARY_LAYER_ID,
    "Hosted/district",
  );
  hideLayer(regionLayer);
  hideLayer(districtLayer);
}

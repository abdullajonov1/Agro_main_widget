/**
 * Administrative boundary outlines for Agro_widgetV5 map.
 *
 * Regions:  Hosted/regions/FeatureServer/5
 * Districts: Hosted/district/FeatureServer/3
 *
 * Outlines are drawn on GraphicsLayers from a one-shot JSON query.
 * Putting the Hosted FeatureLayer on the map makes the JS API fire
 * quantized PBF tile queries (f=pbf, resultType=tile) — those 400/500
 * on detailed polygons such as Farg'ona (parent_cod = 1730).
 */
/**
 * Admin outline layers (Hosted/regions, Tuman_chegara) use soato/name fields,
 * not Agri_table `viloyat`. Client access WHERE must NOT be applied here —
 * Localization already scopes selection via lockedViloyat / regionCode.
 * See combineAccessWhereIfFieldsExist in agri-access-config.ts.
 */
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import { SessionManager } from "jimu-core";
import {
  getAgriPortalSharingRestUrl,
  getAgriServiceUrls,
} from "../shared/agri-service-urls";
import {
  canonicalizeRegionFilterValue,
  isValidMapExtent,
  normalizeRegionToken,
} from "./feature-layer-data";
import { escapeLikeLiteral, normalizeApos } from "../data/agri-sql";
import { agroV5Log } from "./agri-debug-log";

export const AGRI_REGION_BOUNDARY_LAYER_ID = "agri-region-boundary";
export const AGRI_DISTRICT_BOUNDARY_LAYER_ID = "agri-district-boundary";
/** Client-side FeatureLayer (source graphics) — reliable labels above MapImage. */
export const AGRI_DISTRICT_LABEL_LAYER_ID = "agri-district-label-fl";
export const AGRI_ADMIN_BORDERS_STORAGE_KEY = "agri_admin_borders_visible";
/** Tag on view.graphics so we can clear district overlays that sit above MapImage. */
const AGRI_DISTRICT_VIEW_GRAPHIC_TAG = "agri-admin-district";

/** District → parent region link — numeric parent only (not free-text `region`). */
const DISTRICT_PARENT_COD_FIELDS = [
  "parent_cod",
  "PARENT_COD",
  "region_cod",
  "region_code",
  "reg_code",
  "viloyat_cod",
  "parent",
];

export function getAgriRegionBoundaryUrl(): string {
  return getAgriServiceUrls().adminRegionsUrl;
}

export function getAgriDistrictBoundaryUrl(): string {
  return getAgriServiceUrls().adminDistrictsUrl;
}

export function getAgriDistrictBoundaryFallbackUrl(): string {
  return getAgriServiceUrls().adminDistrictsFallbackUrl;
}

/** Same field as Agrobank / eco-monitoring / geo-react admin outlines. */
const REGION_PARENT_COD_FIELDS = ["parent_cod", "PARENT_COD"];
const DISTRICT_CODE_FIELDS = ["district", "DISTRICT"];
/** SOATO / district code fields (Tuman_chegara uses `soato`, both are text). */
const DISTRICT_SOATO_FIELDS = [
  "soato",
  "SOATO",
  ...DISTRICT_CODE_FIELDS,
  "district_cod",
  "district_code",
];
/** Region link fields that hold the viloyat *name* (Tuman_chegara `viloyat_no`). */
const DISTRICT_REGION_NAME_FIELDS = [
  "viloyat_no",
  "viloyat_nomi",
  "viloyat_uz",
  "viloyat",
  "region_name",
  "region",
];
/** District name fields — `tuman_nomi` / `label` are the Tuman_chegara ones. */
const DISTRICT_NAME_FIELDS = [
  "tuman_nomi",
  "label",
  "name_uz",
  "name_lat",
  "name_ru",
  "name",
  "nomi",
  "tuman",
  "district_name",
  "NAME",
  // Tuman_chegara / Evapo-style schemas
  "tuman_uz",
  "tuman_lat",
  "tuman_ru",
  "tuman_en",
  "district_uz",
  "district_lat",
];
/** Map label preference: Latin first (dashboard default), then Cyrillic / RU. */
const DISTRICT_LABEL_FIELD_PREF = [
  "tuman_nomi",
  "label",
  "name_lat",
  "name_uz",
  "tuman_lat",
  "tuman_uz",
  "name_ru",
  "tuman_ru",
  "name",
  "nomi",
  "tuman",
  "district_name",
  "NAME",
  "tuman_en",
  "district_uz",
  "district_lat",
];

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
  /** All tuman display keys for the selected viloyat (from Agri_table map). */
  districtNames?: string[] | null;
  /** All district SOATO codes for the selected viloyat. */
  districtCodes?: Array<number | string> | null;
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
/** URLs whose FeatureLayer.load() already failed this session — skip re-probe. */
const failedDetachedQueryUrls = new Set<string>();

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
  // Only well-known EXB auth storage — do not scan generic keys like "token"
  // (could pick up unrelated app secrets and forward them to ArcGIS Server).
  try {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      const exbRaw = storage.getItem("exb_auth");
      if (!exbRaw) continue;
      const parsed = JSON.parse(exbRaw) as { token?: unknown };
      const token =
        typeof parsed.token === "string" ? parsed.token.trim() : "";
      if (token) return token;
    }
  } catch {
    return null;
  }
  return null;
}

function registerServerToken(IdentityManager: any): void {
  const token = readAuthToken();
  if (!token) return;
  const arcgisServer = getAgriServiceUrls().arcgisServer.replace(/\/$/, "");
  for (const server of [
    `${arcgisServer}/rest/services`,
    `${arcgisServer}/rest`,
    arcgisServer,
    getAgriPortalSharingRestUrl(),
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

/** All present fields from a candidate list, in candidate order. */
function pickFields(layer: any, candidates: string[]): string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    const hit = pickField(layer, [candidate]);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/**
 * "string" / "number" / "unknown" for a layer field.
 * Tuman_chegara stores `soato` / `district` as text — numeric comparisons
 * there fail with "Invalid data type for expression".
 */
function fieldValueKind(layer: any, field: string): "string" | "number" | "unknown" {
  const meta = (Array.isArray(layer?.fields) ? layer.fields : []).find(
    (f: any) => String(f?.name || "").toLowerCase() === field.toLowerCase(),
  );
  const type = String(meta?.type || "").toLowerCase();
  if (!type) return "unknown";
  if (type.includes("string") || type.includes("text")) return "string";
  if (
    type.includes("integer") ||
    type.includes("double") ||
    type.includes("single") ||
    type.includes("number") ||
    type.includes("small") ||
    type.includes("long")
  ) {
    return "number";
  }
  return "unknown";
}

function buildOutlineSymbol(width = 2.2, color: number[] = [255, 255, 255, 0.95]) {
  return {
    type: "simple-fill",
    color: [0, 0, 0, 0],
    outline: {
      type: "simple-line",
      color,
      width,
    },
  };
}

/** District strokes: white, finer than the viloyat outline. */
function buildDistrictOutlineSymbol(width = 0.75) {
  return buildOutlineSymbol(width, [255, 255, 255, 0.88]);
}

function buildDistrictLabelSymbol(text: string) {
  return {
    type: "text",
    text,
    color: [255, 255, 255, 1],
    haloColor: [70, 70, 70, 0.9],
    haloSize: 1.5,
    font: {
      size: 8,
      family: "Arial",
      weight: "normal",
    },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
  };
}

function geometryLabelPoint(geometry: any): any | null {
  if (!geometry) return null;
  const type = String(geometry.type || "").toLowerCase();
  if (type === "point") return geometry;
  try {
    if (geometry.centroid) return geometry.centroid;
  } catch {
    /* ignore */
  }
  try {
    const center = geometry.extent?.center;
    if (center) return center;
  } catch {
    /* ignore */
  }
  return null;
}

function pickFeatureLabel(
  attributes: Record<string, unknown> | null | undefined,
  fields: string[],
): string {
  if (!attributes) return "";
  for (const field of fields) {
    const value = String(attributes[field] ?? "").trim();
    if (value) return value;
  }
  // Schema unknown — pick first plausible name-like string attribute.
  for (const [key, raw] of Object.entries(attributes)) {
    if (/objectid|oid|fid|shape|globalid|cod$|_id$|area|ha|length/i.test(key)) {
      continue;
    }
    const value = String(raw ?? "").trim();
    if (
      value.length >= 3 &&
      value.length < 64 &&
      /[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ'’ʻ`]/.test(value)
    ) {
      return value;
    }
  }
  return "";
}

function clearDistrictViewGraphics(view: any): void {
  if (!view?.graphics) return;
  try {
    const items =
      view.graphics.toArray?.() ||
      (Array.isArray(view.graphics.items) ? view.graphics.items : []);
    const doomed = items.filter(
      (g: any) =>
        g?.attributes?.agriAdminTag === AGRI_DISTRICT_VIEW_GRAPHIC_TAG,
    );
    for (const graphic of doomed) {
      try {
        view.graphics.remove(graphic);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * MapImage crop layers often cover GraphicsLayers. view.graphics always
 * paints on top — use it for district strokes (+ optional names).
 */
function paintDistrictsOnViewGraphics(opts: {
  view: any;
  Graphic: any;
  features: any[];
  labelFields: string[];
  bordersVisible: boolean;
  /** When false, only outlines — labels come from the client FeatureLayer. */
  withLabels?: boolean;
}): number {
  const {
    view,
    Graphic,
    features,
    labelFields,
    bordersVisible,
    withLabels = true,
  } = opts;
  clearDistrictViewGraphics(view);
  if (!bordersVisible || !view?.graphics || !features.length) return 0;

  const outlineSymbol = buildDistrictOutlineSymbol(0.85);
  let painted = 0;
  for (const feature of features) {
    if (!feature?.geometry) continue;
    try {
      view.graphics.add(
        new Graphic({
          geometry: feature.geometry,
          symbol: outlineSymbol,
          attributes: { agriAdminTag: AGRI_DISTRICT_VIEW_GRAPHIC_TAG },
        }),
      );
      painted += 1;
    } catch {
      /* skip */
    }
    if (!withLabels) continue;
    const label = pickFeatureLabel(feature.attributes, labelFields);
    const labelPoint = geometryLabelPoint(feature.geometry);
    if (!label || !labelPoint) continue;
    try {
      view.graphics.add(
        new Graphic({
          geometry: labelPoint,
          symbol: buildDistrictLabelSymbol(label),
          attributes: { agriAdminTag: AGRI_DISTRICT_VIEW_GRAPHIC_TAG },
        }),
      );
    } catch {
      /* skip */
    }
  }
  return painted;
}

/**
 * Publish districts as a client FeatureLayer with labelingInfo.
 * TextSymbol on GraphicsLayer / view.graphics is unreliable under ExB MapImage;
 * FeatureLayer labels render consistently on top.
 */
function publishDistrictLabelFeatureLayer(opts: {
  map: any;
  FeatureLayer: any;
  Graphic: any;
  features: any[];
  labelFields: string[];
  bordersVisible: boolean;
}): number {
  const { map, FeatureLayer, Graphic, features, labelFields, bordersVisible } =
    opts;
  const existing = findLayerById(map, AGRI_DISTRICT_LABEL_LAYER_ID);
  if (existing) {
    try {
      map.remove(existing);
    } catch {
      /* ignore */
    }
  }
  if (!bordersVisible || !features.length) return 0;

  const spatialReference =
    features.find((f) => f?.geometry?.spatialReference)?.geometry
      ?.spatialReference || undefined;
  const source = features
    .map((feature, index) => {
      if (!feature?.geometry) return null;
      const label =
        pickFeatureLabel(feature.attributes, labelFields) ||
        `Tuman ${index + 1}`;
      return new Graphic({
        geometry: feature.geometry,
        attributes: { OBJECTID: index + 1, label },
      });
    })
    .filter(Boolean);

  if (!source.length) return 0;

  const layer = new FeatureLayer({
    id: AGRI_DISTRICT_LABEL_LAYER_ID,
    title: "Agri district borders",
    source,
    objectIdField: "OBJECTID",
    fields: [
      { name: "OBJECTID", type: "oid" },
      { name: "label", type: "string" },
    ],
    geometryType: "polygon",
    spatialReference,
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color: [0, 0, 0, 0],
        outline: {
          type: "simple-line",
          color: [255, 255, 255, 0.88],
          width: 0.85,
        },
      },
    },
    labelingInfo: [
      {
        labelExpressionInfo: { expression: "$feature.label" },
        labelPlacement: "always-horizontal",
        symbol: {
          type: "text",
          color: [255, 255, 255, 1],
          haloColor: [70, 70, 70, 0.9],
          haloSize: 1.5,
          font: { size: 8, family: "Arial", weight: "normal" },
        },
      },
    ],
    labelsVisible: true,
    listMode: "hide",
    legendEnabled: false,
    popupEnabled: false,
    opacity: 1,
  });
  try {
    map.add(layer);
    bringToFront(map, layer);
  } catch {
    return 0;
  }
  return source.length;
}

function clearDistrictLabelFeatureLayer(map: any): void {
  const existing = findLayerById(map, AGRI_DISTRICT_LABEL_LAYER_ID);
  if (!existing) return;
  try {
    map.remove(existing);
  } catch {
    /* ignore */
  }
}

/** Live FeatureServer layer id (Evapo-style — labels via labelingInfo). */
export const AGRI_DISTRICT_FS_LAYER_ID = "agri-district-fs-border";

function buildDistrictLabelingInfo(labelField: string): any[] {
  const field = String(labelField || "label")
    .trim()
    .replace(/"/g, "");
  const safe = field || "label";
  return [
    {
      labelExpressionInfo: {
        expression: `$feature["${safe}"]`,
      },
      labelPlacement: "always-horizontal",
      symbol: {
        type: "text",
        color: [255, 255, 255, 1],
        haloColor: [70, 70, 70, 0.9],
        haloSize: 1.5,
        font: { size: 8, family: "Arial", weight: "normal" },
      },
      minScale: 0,
      maxScale: 0,
    },
  ];
}

function ensureDistrictFsBorderLayer(
  map: any,
  FeatureLayer: any,
  url: string,
  visible: boolean,
): any {
  let layer = findLayerById(map, AGRI_DISTRICT_FS_LAYER_ID);
  const sameUrl =
    layer &&
    String(layer.url || "").replace(/\/$/, "") ===
      String(url || "").replace(/\/$/, "");
  if (layer && !sameUrl) {
    try {
      map.remove(layer);
    } catch {
      /* ignore */
    }
    layer = null;
  }
  if (!layer) {
    layer = new FeatureLayer({
      id: AGRI_DISTRICT_FS_LAYER_ID,
      title: "Agri district borders",
      url,
      listMode: "hide",
      legendEnabled: false,
      popupEnabled: false,
      outFields: ["*"],
      visible,
      opacity: 1,
      definitionExpression: "1=0",
      labelingInfo: [],
      labelsVisible: true,
      renderer: {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [0, 0, 0, 0],
          outline: {
            type: "simple-line",
            color: [255, 255, 255, 0.88],
            width: 0.85,
          },
        },
      },
    });
    try {
      map.add(layer);
    } catch {
      return null;
    }
  } else {
    try {
      layer.visible = visible;
    } catch {
      /* ignore */
    }
  }
  return layer;
}

function clearDistrictFsBorderLayer(map: any): void {
  const existing = findLayerById(map, AGRI_DISTRICT_FS_LAYER_ID);
  if (!existing) return;
  try {
    existing.definitionExpression = "1=0";
    existing.visible = false;
  } catch {
    /* ignore */
  }
  try {
    map.remove(existing);
  } catch {
    /* ignore */
  }
}

/**
 * Evapo-style: put Tuman_chegara on the map with definitionExpression + labels.
 * Returns feature count when the expression matches, else 0.
 */
async function syncDistrictsViaMapFeatureLayer(opts: {
  map: any;
  FeatureLayer: any;
  parentCod: number | null;
  viloyat: string;
  districtNames: string[];
  districtCodes: Array<number | string>;
  bordersVisible: boolean;
}): Promise<{ count: number; mode: string; field: string | null; url: string }> {
  const {
    map,
    FeatureLayer,
    parentCod,
    viloyat,
    districtNames,
    districtCodes,
    bordersVisible,
  } = opts;
  const empty: {
    count: number;
    mode: string;
    field: string | null;
    url: string;
  } = { count: 0, mode: "none", field: null, url: "" };
  if (!bordersVisible) {
    clearDistrictFsBorderLayer(map);
    return empty;
  }

  // Prefer chegara for live map FL (Hosted/district PBF tiles are flaky on-map).
  const urls = Array.from(
    new Set(
      [
        getAgriDistrictBoundaryFallbackUrl(),
        getAgriDistrictBoundaryUrl(),
      ].filter(Boolean),
    ),
  );
  for (const url of urls) {
    let layer: any = null;
    try {
      layer = ensureDistrictFsBorderLayer(map, FeatureLayer, url, true);
      if (!layer) continue;
      if (typeof layer.load === "function") await layer.load();
    } catch (err: any) {
      agroV5Log(
        "admin-boundary:fs-layer-FAILED",
        { url, error: String(err?.message || err) },
        "tuman",
      );
      continue;
    }

    const attempts = buildDistrictWhereAttempts(layer, {
      parentCod,
      viloyat,
      districtNames,
      districtCodes,
    });
    agroV5Log(
      "admin-boundary:fs-layer-attempts",
      {
        url,
        fields: (layer?.fields || []).map((f: any) => f?.name),
        modes: attempts.map((a) => a.mode),
      },
      "tuman",
    );

    const maxCount = maxDistrictsForViloyat(districtCodes);

    for (const attempt of attempts) {
      if (!attempt.where || attempt.where === "1=0") continue;
      try {
        const countQuery = layer.createQuery?.() || {};
        countQuery.where = attempt.where;
        const count = await layer.queryFeatureCount(countQuery);
        // Reject expressions that clearly include neighboring viloyats.
        if (count <= 0 || count > maxCount) {
          agroV5Log(
            "admin-boundary:fs-layer-skip",
            {
              url,
              mode: attempt.mode,
              count,
              maxCount,
              where: attempt.where.slice(0, 120),
            },
            "tuman",
          );
          continue;
        }
        layer.definitionExpression = attempt.where;
        layer.visible = true;
        const labelField =
          pickField(layer, DISTRICT_LABEL_FIELD_PREF) ||
          pickField(layer, DISTRICT_NAME_FIELDS) ||
          pickField(layer, DISTRICT_SOATO_FIELDS);
        if (labelField) {
          layer.labelingInfo = buildDistrictLabelingInfo(labelField);
          layer.labelsVisible = true;
        }
        bringToFront(map, layer);
        agroV5Log(
          "admin-boundary:fs-layer-ok",
          {
            url,
            mode: attempt.mode,
            field: attempt.field,
            count,
            where: attempt.where.slice(0, 160),
          },
          "tuman",
        );
        return {
          count,
          mode: `fs:${attempt.mode}`,
          field: attempt.field,
          url,
        };
      } catch (err: any) {
        agroV5Log(
          "admin-boundary:fs-layer-query-FAILED",
          {
            url,
            mode: attempt.mode,
            error: String(err?.message || err),
          },
          "tuman",
        );
      }
    }
  }

  clearDistrictFsBorderLayer(map);
  return empty;
}

/** Candidate FeatureServer layer URLs for district polygons. */
function getDistrictLayerUrlCandidates(): string[] {
  const primary = getAgriDistrictBoundaryUrl();
  const fallback = getAgriDistrictBoundaryFallbackUrl();
  const urls: string[] = [];
  // Tuman_chegara first — Evapo-style SOATO borders (Hosted/district often empty/broken).
  if (fallback) urls.push(fallback);
  // Only the configured Hosted layer — probing sibling indexes /0…/5 floods the
  // console with request:server errors when those layers do not exist.
  if (primary) urls.push(primary);
  return Array.from(new Set(urls.filter(Boolean)));
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
    if (
      layer?.id === AGRI_DISTRICT_FS_LAYER_ID ||
      layer?.id === AGRI_DISTRICT_LABEL_LAYER_ID
    ) {
      continue;
    }
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
  const key = String(url || "").trim();
  if (!key) throw new Error("empty district layer url");
  if (failedDetachedQueryUrls.has(key)) {
    throw new Error(`district layer previously failed: ${key}`);
  }
  let layer = detachedQueryLayers.get(key);
  if (!layer) {
    layer = new FeatureLayer({
      url: key,
      outFields: ["*"],
    });
    detachedQueryLayers.set(key, layer);
  }
  try {
    if (typeof layer.load === "function") {
      await Promise.resolve(layer.load()).catch((err: unknown) => {
        throw err;
      });
    }
  } catch (err) {
    detachedQueryLayers.delete(key);
    failedDetachedQueryUrls.add(key);
    throw err instanceof Error ? err : new Error(String(err));
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

/**
 * Numeric district SOATO for Tuman_chegara / Hosted borders.
 * Prefer an explicit `selection.districtCode` from Agri_table maps (scoped by
 * viloyat). Fall back to a numeric `tuman` string when the UI selection itself
 * is a district id.
 */
function resolveDistrictCode(
  selection: AgriAdminBoundarySelection,
): string | null {
  const fromSelection = String(selection.districtCode ?? "").trim();
  if (/^\d+$/.test(fromSelection)) return fromSelection;
  const tuman = String(selection.tuman ?? "").trim();
  if (/^\d+$/.test(tuman)) return tuman;
  return null;
}

function equalsAnyEscaped(field: string, values: string[]): string {
  const parts = values
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .map((v) => `${field}='${escapeSql(v)}'`);
  if (!parts.length) return "1=0";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
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

interface DistrictWhereAttempt {
  where: string;
  mode: string;
  field: string | null;
}

/** Viloyat display spellings for text region fields (`viloyat_no`). */
function expandRegionNameVariants(viloyat: string): string[] {
  const raw = String(viloyat || "").trim();
  if (!raw) return [];
  const normalized = normalizeApos(raw);
  const base = normalized
    .replace(/\s+(viloyati|viloyat|shahri|respublikasi)$/i, "")
    .trim();
  const out = new Set<string>();
  for (const value of [
    raw,
    normalized,
    base,
    base ? `${base} viloyati` : "",
    base ? `${base} vil.` : "",
  ]) {
    if (!value) continue;
    out.add(value);
    // Services mix ' / ʻ / ’ for Farg'ona, Qoraqalpog'iston …
    out.add(value.replace(/['’ʻ`]/g, "'"));
    out.add(value.replace(/['’ʻ`]/g, "ʻ"));
    out.add(value.replace(/['’ʻ`]/g, "’"));
  }
  return Array.from(out);
}

/**
 * Every WHERE we are willing to try for "all districts of this viloyat",
 * strongest first. Each attempt targets a single field with a single value
 * kind — mixing text and numeric comparisons made the whole expression fail
 * ("Invalid data type for expression [district < 1725000]").
 */
function buildDistrictWhereAttempts(
  layer: any,
  opts: {
    parentCod: number | null;
    viloyat: string;
    districtNames: string[];
    districtCodes: Array<number | string>;
  },
): DistrictWhereAttempt[] {
  const { parentCod, viloyat, districtNames, districtCodes } = opts;
  const attempts: DistrictWhereAttempt[] = [];
  const prefix =
    parentCod != null && Number.isFinite(parentCod)
      ? String(Math.trunc(parentCod))
      : "";

  const codes = districtCodes
    .map((c) => Number(c))
    .filter((n) => Number.isFinite(n))
    .map((n) => String(n));

  const codeFields = pickFields(layer, DISTRICT_SOATO_FIELDS);
  for (const field of codeFields) {
    const kind = fieldValueKind(layer, field);
    if (/^\d{4}$/.test(prefix) && kind !== "number") {
      attempts.push({
        where: `${field} LIKE '${escapeLikeLiteral(prefix)}%'`,
        mode: `soato-prefix:${field}`,
        field,
      });
    }
    if (/^\d{4}$/.test(prefix) && kind !== "string") {
      const lo = Number(prefix) * 1000;
      const hi = (Number(prefix) + 1) * 1000;
      attempts.push({
        where: `(${field} >= ${lo} AND ${field} < ${hi})`,
        mode: `soato-range:${field}`,
        field,
      });
    }
    if (codes.length) {
      if (kind !== "number") {
        attempts.push({
          where: `${field} IN (${codes.map((c) => `'${escapeSql(c)}'`).join(",")})`,
          mode: `code-list-text:${field}`,
          field,
        });
      }
      if (kind !== "string") {
        attempts.push({
          where: `${field} IN (${codes.join(",")})`,
          mode: `code-list-num:${field}`,
          field,
        });
      }
    }
  }

  // Region link fields: numeric parent_cod or the viloyat name.
  const regionNameVariants = expandRegionNameVariants(viloyat);
  for (const field of pickFields(layer, [
    ...DISTRICT_PARENT_COD_FIELDS,
    ...DISTRICT_REGION_NAME_FIELDS,
  ])) {
    const kind = fieldValueKind(layer, field);
    if (prefix && kind !== "string") {
      attempts.push({
        where: `${field} = ${Number(prefix)}`,
        mode: `region-num:${field}`,
        field,
      });
    }
    if (prefix && kind !== "number") {
      attempts.push({
        where: `${field} = '${escapeSql(prefix)}'`,
        mode: `region-text:${field}`,
        field,
      });
    }
    if (regionNameVariants.length && kind !== "number") {
      attempts.push({
        where: equalsAnyEscaped(field, regionNameVariants),
        mode: `region-name:${field}`,
        field,
      });
    }
  }

  // District names last — spelling differences make these the least reliable.
  const nameVariants = expandDistrictNameVariants(districtNames);
  if (nameVariants.length) {
    for (const field of pickFields(layer, DISTRICT_NAME_FIELDS)) {
      if (fieldValueKind(layer, field) === "number") continue;
      attempts.push({
        where: equalsAnyEscaped(field, nameVariants),
        mode: `name-list:${field}`,
        field,
      });
    }
  }

  return attempts.filter((a) => a.where && a.where !== "1=0");
}

/**
 * Clause that keeps a query inside the selected viloyat, so a district name
 * that exists in two regions (Qamashi / Yakkabog') cannot resolve elsewhere.
 */
function buildRegionScopeClause(
  layer: any,
  parentCod: number | null,
  viloyat: string,
): string | null {
  const prefix =
    parentCod != null && Number.isFinite(parentCod)
      ? String(Math.trunc(parentCod))
      : "";
  if (/^\d{4}$/.test(prefix)) {
    for (const field of pickFields(layer, DISTRICT_SOATO_FIELDS)) {
      const kind = fieldValueKind(layer, field);
      if (kind === "number") {
        const lo = Number(prefix) * 1000;
        const hi = (Number(prefix) + 1) * 1000;
        return `(${field} >= ${lo} AND ${field} < ${hi})`;
      }
      return `${field} LIKE '${escapeLikeLiteral(prefix)}%'`;
    }
  }
  const regionNames = expandRegionNameVariants(viloyat);
  if (regionNames.length) {
    for (const field of pickFields(layer, DISTRICT_REGION_NAME_FIELDS)) {
      if (fieldValueKind(layer, field) === "number") continue;
      return equalsAnyEscaped(field, regionNames);
    }
  }
  return null;
}

/** WHERE candidates for one selected tuman, strongest first. */
function buildSingleDistrictAttempts(
  layer: any,
  opts: {
    tuman: string;
    districtCode: string | null;
    parentCod: number | null;
    viloyat: string;
  },
): DistrictWhereAttempt[] {
  const { tuman, districtCode, parentCod, viloyat } = opts;
  const attempts: DistrictWhereAttempt[] = [];
  const scope = buildRegionScopeClause(layer, parentCod, viloyat);
  const scoped = (where: string) => (scope ? `(${where}) AND ${scope}` : where);

  const code = String(districtCode ?? "").trim();
  if (/^\d+$/.test(code)) {
    for (const field of pickFields(layer, DISTRICT_SOATO_FIELDS)) {
      const kind = fieldValueKind(layer, field);
      if (kind !== "number") {
        attempts.push({
          where: `${field} = '${escapeSql(code)}'`,
          mode: `district-code-text:${field}`,
          field,
        });
      }
      if (kind !== "string") {
        attempts.push({
          where: `${field} = ${Number(code)}`,
          mode: `district-code-num:${field}`,
          field,
        });
      }
    }
  }

  const nameVariants = expandDistrictNameVariants([tuman]);
  if (nameVariants.length && !/^\d+$/.test(tuman)) {
    for (const field of pickFields(layer, DISTRICT_NAME_FIELDS)) {
      if (fieldValueKind(layer, field) === "number") continue;
      attempts.push({
        where: scoped(equalsAnyEscaped(field, nameVariants)),
        mode: `district-name:${field}`,
        field,
      });
    }
  }

  return attempts.filter((a) => a.where && a.where !== "1=0");
}

interface ViloyatDistrictFilter {
  parentCod: number | null;
  viloyat: string;
  districtNames: string[];
  districtCodes: Array<number | string>;
}

/** Keep only features that belong to the selected viloyat (client-side guard). */
function featureBelongsToViloyat(
  attrs: Record<string, unknown> | null | undefined,
  opts: ViloyatDistrictFilter,
): boolean {
  if (!attrs) return false;
  const { parentCod, viloyat, districtNames, districtCodes } = opts;
  const lowerAttrs = new Map<string, unknown>();
  for (const [k, v] of Object.entries(attrs)) {
    lowerAttrs.set(String(k).toLowerCase(), v);
  }
  const getAttr = (key: string) =>
    attrs[key] ?? lowerAttrs.get(String(key).toLowerCase());

  const codeSet = new Set(
    districtCodes
      .map((c) => String(Number(c)))
      .filter((s) => s && s !== "NaN"),
  );
  const nameSet = new Set(
    expandDistrictNameVariants(districtNames).map((n) =>
      normalizeApos(n).toLowerCase(),
    ),
  );

  const prefix =
    parentCod != null && Number.isFinite(parentCod)
      ? String(Math.trunc(parentCod))
      : "";

  for (const key of DISTRICT_SOATO_FIELDS) {
    const raw = getAttr(key);
    if (raw == null || raw === "") continue;
    const asStr = String(raw).trim();
    const asNum = Number(raw);
    if (codeSet.has(String(asNum)) || codeSet.has(asStr)) return true;
    if (prefix && /^\d+$/.test(asStr) && asStr.startsWith(prefix)) return true;
  }

  for (const key of DISTRICT_PARENT_COD_FIELDS) {
    const raw = getAttr(key);
    if (raw == null || raw === "") continue;
    if (parentCod != null && Number(raw) === Number(parentCod)) return true;
    if (prefix && String(raw).trim() === prefix) return true;
  }

  // Text region link (`viloyat_no` = "Sirdaryo").
  const regionNames = new Set(
    expandRegionNameVariants(viloyat).map((n) => n.toLowerCase()),
  );
  if (regionNames.size) {
    for (const key of DISTRICT_REGION_NAME_FIELDS) {
      const raw = String(getAttr(key) ?? "").trim();
      if (!raw) continue;
      if (regionNames.has(normalizeApos(raw).toLowerCase())) return true;
    }
  }

  if (nameSet.size) {
    for (const key of [...DISTRICT_LABEL_FIELD_PREF, ...DISTRICT_NAME_FIELDS]) {
      const raw = String(getAttr(key) ?? "").trim();
      if (!raw) continue;
      if (nameSet.has(normalizeApos(raw).toLowerCase())) return true;
      const base = normalizeApos(raw)
        .replace(/\s+tumani$/i, "")
        .trim()
        .toLowerCase();
      if (base && nameSet.has(base)) return true;
    }
  }

  return false;
}

function filterDistrictFeaturesToViloyat(
  features: any[],
  opts: ViloyatDistrictFilter,
): any[] {
  if (!features?.length) return [];
  const filtered = features.filter((f) =>
    featureBelongsToViloyat(f?.attributes, opts),
  );
  // If every feature was dropped (schema mismatch), fall back only when the
  // attribute filter had nothing to match on — otherwise keep empty.
  if (
    !filtered.length &&
    !opts.districtCodes.length &&
    opts.parentCod == null &&
    !opts.districtNames.length
  ) {
    return features;
  }
  return filtered;
}

/**
 * Max districts we ever expect for one viloyat (guards against 1=1 / spatial).
 * Border services also carry city polygons (Guliston, Yangiyer, Shirin) that
 * the Agri district map does not list, so allow generous headroom.
 */
function maxDistrictsForViloyat(districtCodes: Array<number | string>): number {
  const n = districtCodes.length;
  return n > 0 ? Math.min(60, n + 12) : 30;
}

/** Expand tuman keys into Hosted/district name spellings (same as single-tuman zoom). */
function expandDistrictNameVariants(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    const normalized = normalizeApos(trimmed);
    const base = normalized.replace(/\s+tumani$/i, "").trim();
    const titled = base
      ? base
          .split(/\s+/)
          .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
          .join(" ")
      : "";
    for (const value of [
      trimmed,
      normalized,
      base,
      base ? `${base} tumani` : "",
      titled,
      titled ? `${titled} tumani` : "",
    ]) {
      if (value) out.add(value);
    }
  }
  return Array.from(out);
}


async function resolveDistrictWhere(
  layer: any,
  districtCode: string | null,
  tumanName?: string | null,
): Promise<string> {
  const trimmedName = String(tumanName ?? "").trim();

  // Named selection → Hosted/district name fields (authoritative for zoom).
  if (trimmedName && !/^\d+$/.test(trimmedName)) {
    const normalized = normalizeApos(trimmedName);
    const base = normalized.replace(/\s+tumani$/i, "").trim();
    const nameValues = Array.from(
      new Set(
        [trimmedName, normalized, base, base ? `${base} tumani` : ""].filter(
          Boolean,
        ),
      ),
    );
    const nameField = pickField(layer, DISTRICT_NAME_FIELDS);
    if (nameField) return equalsAnyEscaped(nameField, nameValues);

    // Some Hosted layers store the district *name* in `district` (string).
    const codeField = pickField(layer, DISTRICT_CODE_FIELDS) || "district";
    const codeFieldMeta = (layer?.fields || []).find(
      (f: any) =>
        String(f?.name || "").toLowerCase() === codeField.toLowerCase(),
    );
    const codeType = String(codeFieldMeta?.type || "").toLowerCase();
    if (codeType.includes("string") || !codeFieldMeta) {
      return equalsAnyEscaped(codeField, nameValues);
    }
  }

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
  FeatureLayer?: any;
  where: string;
  view: any;
  outlineWidth: number;
  bordersVisible: boolean;
  /** Draw district names at polygon centroids (viloyat overview). */
  withLabels?: boolean;
  /** Use high-contrast district stroke (yellow) instead of white. */
  districtStyle?: boolean;
  /** Optional spatial filter (e.g. districts contained by viloyat polygon). */
  geometry?: any | null;
  spatialRelationship?: string;
  /** When set, drop features that do not belong to this viloyat. */
  viloyatFilter?: ViloyatDistrictFilter | null;
}): Promise<{
  extent: any | null;
  featureCount: number;
  /** First polygon geometry — used as spatial filter for child districts. */
  firstGeometry: any | null;
  features: any[];
  labelFields: string[];
}> {
  const {
    queryLayer,
    outlineLayer,
    Graphic,
    FeatureLayer = null,
    where,
    view,
    outlineWidth,
    bordersVisible,
    withLabels = false,
    districtStyle = false,
    geometry = null,
    spatialRelationship = "intersects",
    viloyatFilter = null,
  } = opts;

  try {
    outlineLayer.removeAll?.();
  } catch {
    /* ignore */
  }

  if (!queryLayer || ((!where || where === "1=0") && !geometry)) {
    hideLayer(outlineLayer);
    if (districtStyle) clearDistrictViewGraphics(view);
    return {
      extent: null,
      featureCount: 0,
      firstGeometry: null,
      features: [],
      labelFields: [],
    };
  }

  const oidField = queryLayer.objectIdField || "OBJECTID";
  const labelFields: string[] = [];
  if (withLabels || districtStyle) {
    for (const candidate of DISTRICT_LABEL_FIELD_PREF) {
      const hit = pickField(queryLayer, [candidate]);
      if (hit && !labelFields.includes(hit)) labelFields.push(hit);
    }
  }
  // Request all fields for districts so unknown name schemas still label.
  const outFields =
    withLabels || districtStyle
      ? ["*"]
      : Array.from(new Set([oidField, ...labelFields]));
  const pageSize = 200;
  const runQuery = async (maxAllowableOffset?: number): Promise<any[]> => {
    const allFeatures: any[] = [];
    let offset = 0;
    for (let page = 0; page < 50; page++) {
      const query = queryLayer.createQuery();
      query.where = where && where !== "1=0" ? where : "1=1";
      query.returnGeometry = true;
      query.outFields = outFields;
      query.num = pageSize;
      if (geometry) {
        query.geometry = geometry;
        query.spatialRelationship = spatialRelationship;
      }
      if (maxAllowableOffset != null && maxAllowableOffset > 0) {
        query.maxAllowableOffset = maxAllowableOffset;
      }
      (query as any).resultOffset = offset;
      const result = await queryLayer.queryFeatures(query);
      const batch = result?.features || [];
      allFeatures.push(...batch);
      const exceeded = Boolean((result as any)?.exceededTransferLimit);
      if (batch.length < pageSize && !exceeded) break;
      if (!batch.length) break;
      offset += batch.length;
      if (!exceeded && batch.length < pageSize) break;
    }
    return allFeatures;
  };

  let features: any[] = [];
  let queryError: string | null = null;
  try {
    // Full rings — same visual as the previous FeatureLayer outline.
    // Do not generalize here: a 50–150 m offset made Farg'ona look jagged.
    features = await runQuery();
  } catch (err: any) {
    queryError = String(err?.message || err);
    features = [];
  }
  if (!features.length) {
    try {
      const resolution = Number(view?.resolution);
      const fallbackOffset =
        Number.isFinite(resolution) && resolution > 0 ? resolution * 0.25 : 5;
      features = await runQuery(fallbackOffset);
    } catch (err: any) {
      queryError = queryError || String(err?.message || err);
      features = [];
    }
  }

  if (queryError) {
    agroV5Log(
      "admin-boundary:query-failed",
      {
        where: String(where).slice(0, 180),
        hasGeometry: !!geometry,
        error: queryError,
        layerFields: (queryLayer?.fields || [])
          .slice(0, 24)
          .map((f: any) => f?.name),
      },
      "tuman",
    );
  }

  if (districtStyle && viloyatFilter) {
    const before = features.length;
    features = filterDistrictFeaturesToViloyat(features, viloyatFilter);
    if (before !== features.length) {
      agroV5Log(
        "admin-boundary:client-filter",
        { before, after: features.length, parentCod: viloyatFilter.parentCod },
        "tuman",
      );
    }
  }

  const symbol = districtStyle
    ? buildDistrictOutlineSymbol(outlineWidth)
    : buildOutlineSymbol(outlineWidth);
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
    // districtStyle labels come from ONE of: client FeatureLayer or
    // view.graphics — never also from this GraphicsLayer (double text).
    if (districtStyle || !withLabels || !labelFields.length) continue;
    const label = pickFeatureLabel(feature.attributes, labelFields);
    const labelPoint = geometryLabelPoint(feature.geometry);
    if (!label || !labelPoint) continue;
    try {
      outlineLayer.add(
        new Graphic({
          geometry: labelPoint,
          symbol: buildDistrictLabelSymbol(label),
        }),
      );
    } catch {
      /* skip bad label */
    }
  }

  try {
    outlineLayer.visible = bordersVisible && features.length > 0;
  } catch {
    /* ignore */
  }

  if (districtStyle) {
    let clientFl = 0;
    const map = view?.map;
    if (map && FeatureLayer) {
      clientFl = publishDistrictLabelFeatureLayer({
        map,
        FeatureLayer,
        Graphic,
        features,
        labelFields,
        bordersVisible,
      });
    }
    // Prefer FeatureLayer labelingInfo. Only fall back to TextSymbol on
    // view.graphics when the client layer did not publish — never both.
    const painted = paintDistrictsOnViewGraphics({
      view,
      Graphic,
      features,
      labelFields,
      bordersVisible,
      withLabels: clientFl <= 0,
    });
    agroV5Log(
      "admin-boundary:view-graphics",
      {
        featureCount: features.length,
        painted,
        clientFl,
        labelFieldCount: labelFields.length,
        sampleLabel: features[0]
          ? pickFeatureLabel(features[0].attributes, labelFields)
          : null,
        sampleAttrKeys: features[0]
          ? Object.keys(features[0].attributes || {}).slice(0, 12)
          : [],
      },
      "tuman",
    );
  }

  const firstGeometry = features.find((f) => f?.geometry)?.geometry || null;
  const fromFeatures = extentFromFeatures(features);
  if (fromFeatures) {
    return {
      extent: fromFeatures,
      featureCount: features.length,
      firstGeometry,
      features,
      labelFields,
    };
  }

  try {
    const query = queryLayer.createQuery();
    query.where = where && where !== "1=0" ? where : "1=1";
    if (geometry) {
      query.geometry = geometry;
      query.spatialRelationship = spatialRelationship;
    }
    query.returnGeometry = true;
    const extent = (await queryLayer.queryExtent(query))?.extent;
    if (isValidMapExtent(extent)) {
      return {
        extent,
        featureCount: features.length,
        firstGeometry,
        features,
        labelFields,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    extent: null,
    featureCount: features.length,
    firstGeometry,
    features,
    labelFields,
  };
}

/** Extent-only admin boundary lookup — no map draw (use before zoom). */
async function queryLayerExtentOnly(
  queryLayer: any,
  where: string,
): Promise<any | null> {
  if (!queryLayer || !where || where === "1=0") return null;
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

/**
 * Returns admin boundary extent for zoom without drawing outline graphics.
 * Prefer this on the hot path; call syncAgriAdminBoundaries in the background
 * for the visual border.
 */
export async function queryAgriAdminBoundaryExtentOnly(
  selection: AgriAdminBoundarySelection,
): Promise<AgriAdminBoundarySyncResult> {
  const viloyat = canonicalizeRegionFilterValue(
    String(selection.viloyat ?? "").trim(),
  );
  const tuman = String(selection.tuman ?? "").trim();
  const parentCod = resolveRegionParentCod(selection);
  const districtCode = resolveDistrictCode(selection);

  if (!viloyat && !tuman && parentCod == null) {
    return { extent: null, level: "none" };
  }

  try {
    const { FeatureLayer } = await loadModules();

    if (tuman) {
      for (const url of getDistrictLayerUrlCandidates()) {
        try {
          const districtQueryLayer = await getDetachedQueryLayer(
            FeatureLayer,
            url,
          );
          const attempts = buildSingleDistrictAttempts(districtQueryLayer, {
            tuman,
            districtCode,
            parentCod,
            viloyat,
          });
          for (const attempt of attempts) {
            const extent = await queryLayerExtentOnly(
              districtQueryLayer,
              attempt.where,
            );
            if (isValidMapExtent(extent)) {
              return { extent, level: "district" };
            }
          }
        } catch {
          continue;
        }
      }
      return { extent: null, level: "district" };
    }

    if (viloyat || parentCod != null) {
      const regionQueryLayer = await getDetachedQueryLayer(
        FeatureLayer,
        getAgriRegionBoundaryUrl(),
      );
      const where = await resolveRegionWhere(regionQueryLayer, parentCod);
      const extent = await queryLayerExtentOnly(regionQueryLayer, where);
      return {
        extent: isValidMapExtent(extent) ? extent : null,
        level: "region",
      };
    }

    return { extent: null, level: "none" };
  } catch {
    return { extent: null, level: "none" };
  }
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
    districtNames: selection.districtNames ?? [],
    districtCodes: selection.districtCodes ?? [],
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
      getAgriRegionBoundaryUrl(),
    );
    // Do NOT eagerly load Hosted/district here — it often 500s and would abort
    // the whole sync before Tuman_chegara (first candidate) is tried.

    if (tuman) {
      hideLayer(regionOutline);
      clearDistrictFsBorderLayer(map);
      clearDistrictLabelFeatureLayer(map);
      clearDistrictViewGraphics(view);

      let drawn: {
        extent: any | null;
        featureCount: number;
      } = { extent: null, featureCount: 0 };
      let tumanMode = "none";
      let tumanUrl = "";

      // Same multi-service / typed-WHERE path as the viloyat overview:
      // Hosted/district alone returned 0 features for named tumans.
      for (const url of getDistrictLayerUrlCandidates()) {
        if (drawn.featureCount > 0) break;
        let queryLayer: any = null;
        try {
          queryLayer = await getDetachedQueryLayer(FeatureLayer, url);
        } catch (err: any) {
          agroV5Log(
            "admin-boundary:district-layer-FAILED",
            { url, error: String(err?.message || err) },
            "tuman",
          );
          continue;
        }
        const attempts = buildSingleDistrictAttempts(queryLayer, {
          tuman,
          districtCode,
          parentCod,
          viloyat,
        });
        for (const attempt of attempts) {
          const result = await queryAndDrawOutline({
            queryLayer,
            outlineLayer: districtOutline,
            Graphic,
            FeatureLayer,
            where: attempt.where,
            view,
            outlineWidth: 0.85,
            bordersVisible,
            withLabels: true,
            districtStyle: true,
          });
          if (result.featureCount > 0) {
            drawn = result;
            tumanMode = attempt.mode;
            tumanUrl = url;
            break;
          }
        }
      }

      if (drawn.featureCount <= 0) {
        // Legacy single-layer path (numeric district ids / odd schemas).
        try {
          const districtQueryLayer = await getDetachedQueryLayer(
            FeatureLayer,
            getAgriDistrictBoundaryUrl(),
          );
          const where = await resolveDistrictWhere(
            districtQueryLayer,
            districtCode,
            tuman,
          );
          const result = await queryAndDrawOutline({
            queryLayer: districtQueryLayer,
            outlineLayer: districtOutline,
            Graphic,
            FeatureLayer,
            where,
            view,
            outlineWidth: 0.85,
            bordersVisible,
            withLabels: true,
            districtStyle: true,
          });
          if (result.featureCount > 0) {
            drawn = result;
            tumanMode = "legacy-district-where";
            tumanUrl = getAgriDistrictBoundaryUrl();
          }
        } catch (err: any) {
          agroV5Log(
            "admin-boundary:district-layer-FAILED",
            {
              url: getAgriDistrictBoundaryUrl(),
              error: String(err?.message || err),
            },
            "tuman",
          );
        }
      }

      agroV5Log(
        "admin-boundary:single-district",
        {
          viloyat,
          tuman,
          districtCode,
          mode: tumanMode,
          url: tumanUrl,
          featureCount: drawn.featureCount,
        },
        "tuman",
      );

      if (bordersVisible) {
        bringToFront(map, findLayerById(map, AGRI_DISTRICT_LABEL_LAYER_ID));
        bringToFront(map, districtOutline);
      }
      return {
        extent: isValidMapExtent(drawn.extent) ? drawn.extent : null,
        level: "district",
      };
    }

    if (viloyat || parentCod != null) {
      const regionWhere = await resolveRegionWhere(regionQueryLayer, parentCod);
      const regionDrawn = await queryAndDrawOutline({
        queryLayer: regionQueryLayer,
        outlineLayer: regionOutline,
        Graphic,
        where: regionWhere,
        view,
        outlineWidth: 2.4,
        bordersVisible,
      });

      const districtNames = Array.isArray(selection.districtNames)
        ? selection.districtNames.map((n) => String(n || "").trim()).filter(Boolean)
        : [];
      const districtCodes = Array.isArray(selection.districtCodes)
        ? selection.districtCodes
        : [];

      // Reset previous district overlays before redrawing.
      try {
        districtOutline.removeAll?.();
      } catch {
        /* ignore */
      }
      clearDistrictViewGraphics(view);
      clearDistrictLabelFeatureLayer(map);

      // 1) Evapo-style: live FeatureServer layer + labelingInfo (best labels).
      const fsSync = await syncDistrictsViaMapFeatureLayer({
        map,
        FeatureLayer,
        parentCod,
        viloyat,
        districtNames,
        districtCodes,
        bordersVisible,
      });

      const districtUrls = getDistrictLayerUrlCandidates();

      let districtDrawn: {
        extent: any | null;
        featureCount: number;
        firstGeometry: any | null;
      } = {
        extent: null,
        featureCount: fsSync.count,
        firstGeometry: null,
      };
      let drawMode = fsSync.mode;
      let drawField: string | null = fsSync.field;
      let drawUrl = fsSync.url;

      const viloyatFilter = {
        parentCod,
        viloyat,
        districtNames,
        districtCodes,
      };

      const tryDrawDistricts = async (
        queryLayer: any,
        where: string,
        mode: string,
        field: string | null,
        geometry?: any | null,
        spatialRelationship?: string,
      ): Promise<boolean> => {
        if ((!where || where === "1=0") && !geometry) return false;
        const drawn = await queryAndDrawOutline({
          queryLayer,
          outlineLayer: districtOutline,
          Graphic,
          FeatureLayer,
          where: where || "1=1",
          view,
          outlineWidth: 0.75,
          bordersVisible,
          withLabels: true,
          districtStyle: true,
          geometry: geometry || null,
          spatialRelationship,
          viloyatFilter,
        });
        if (drawn.featureCount <= 0) return false;
        // Guard against neighbor spill from spatial queries.
        if (drawn.featureCount > maxDistrictsForViloyat(districtCodes)) {
          agroV5Log(
            "admin-boundary:reject-too-many",
            { mode, count: drawn.featureCount },
            "tuman",
          );
          try {
            districtOutline.removeAll?.();
          } catch {
            /* ignore */
          }
          clearDistrictViewGraphics(view);
          clearDistrictLabelFeatureLayer(map);
          return false;
        }
        districtDrawn = drawn;
        drawMode = mode;
        drawField = field;
        return true;
      };

      // 2) Query fallback — attribute filters only (no spatial-intersects:
      //    intersects pulls Chinoz/Zomin/etc. that touch the region border).
      if (districtDrawn.featureCount <= 0) {
        for (const url of districtUrls) {
          if (districtDrawn.featureCount > 0) break;
          let queryLayer: any = null;
          try {
            queryLayer = await getDetachedQueryLayer(FeatureLayer, url);
          } catch (err: any) {
            agroV5Log(
              "admin-boundary:district-layer-FAILED",
              { url, error: String(err?.message || err) },
              "tuman",
            );
            continue;
          }
          drawUrl = url;

          const attempts = buildDistrictWhereAttempts(queryLayer, {
            parentCod,
            viloyat,
            districtNames,
            districtCodes,
          });
          let drawn = false;
          for (const attempt of attempts) {
            if (
              await tryDrawDistricts(
                queryLayer,
                attempt.where,
                attempt.mode,
                attempt.field,
              )
            ) {
              drawn = true;
              break;
            }
          }
          if (drawn) break;

          // Last resort: districts fully inside the viloyat polygon — still
          // client-filtered by soato / name so neighbors cannot slip in.
          if (regionDrawn.firstGeometry) {
            if (
              await tryDrawDistricts(
                queryLayer,
                "1=1",
                "spatial-contains-region",
                null,
                regionDrawn.firstGeometry,
                "contains",
              )
            ) {
              break;
            }
          }
        }
      }

      agroV5Log(
        "admin-boundary:region-districts",
        {
          viloyat,
          parentCod,
          mode: drawMode,
          field: drawField,
          url: drawUrl,
          nameCount: districtNames.length,
          codeCount: districtCodes.length,
          nameSample: districtNames.slice(0, 5),
          districtFeatureCount: districtDrawn.featureCount,
          bordersVisible,
          fsCount: fsSync.count,
          viewGraphicsCount: (() => {
            try {
              return (
                view?.graphics?.toArray?.()?.filter(
                  (g: any) =>
                    g?.attributes?.agriAdminTag ===
                    AGRI_DISTRICT_VIEW_GRAPHIC_TAG,
                )?.length ?? 0
              );
            } catch {
              return -1;
            }
          })(),
        },
        "tuman",
      );
      try {
        // eslint-disable-next-line no-console
        console.warn("[AgroV5 admin-boundary]", {
          mode: drawMode,
          districtFeatureCount: districtDrawn.featureCount,
          fsCount: fsSync.count,
          nameCount: districtNames.length,
          codeCount: districtCodes.length,
          url: drawUrl,
        });
      } catch {
        /* ignore */
      }
      if (bordersVisible) {
        bringToFront(map, findLayerById(map, AGRI_DISTRICT_FS_LAYER_ID));
        bringToFront(map, findLayerById(map, AGRI_DISTRICT_LABEL_LAYER_ID));
        bringToFront(map, districtOutline);
        bringToFront(map, regionOutline);
      }
      return {
        extent: isValidMapExtent(regionDrawn.extent) ? regionDrawn.extent : null,
        level: "region",
      };
    }

    hideLayer(regionOutline);
    hideLayer(districtOutline);
    clearDistrictFsBorderLayer(map);
    clearDistrictLabelFeatureLayer(map);
    clearDistrictViewGraphics(view);
    return { extent: null, level: "none" };
  } catch (err) {
    agroV5Log(
      "admin-boundary:sync-failed",
      { error: String((err as any)?.message || err) },
      "map",
    );
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
    clearDistrictViewGraphics(view);
    const map = view.map;
    if (!map) return;
    clearDistrictFsBorderLayer(map);
    clearDistrictLabelFeatureLayer(map);
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
  clearDistrictViewGraphics(view);
  const map = view?.map;
  if (!map) return;
  clearDistrictFsBorderLayer(map);
  clearDistrictLabelFeatureLayer(map);
  hideLayer(findLayerById(map, AGRI_REGION_BOUNDARY_LAYER_ID));
  hideLayer(findLayerById(map, AGRI_DISTRICT_BOUNDARY_LAYER_ID));
}

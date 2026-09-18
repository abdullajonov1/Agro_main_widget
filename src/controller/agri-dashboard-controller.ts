/**
 * Dashboard controller — central brain for Agro_widgetV5 shared stats.
 *
 * Flow:
 *   master filter → query plan → warmup layers → (if planned) prefetch Region + Pie + Indicator + Graff
 *   → publish DashboardPack for panels to consume.
 *
 * VH: Region/Pie/Indicator stay deferred (statsDeferredToPanels); Graff regional
 * may still be packed with vh/ndviStatus in scopeKey.
 * Polygon series/TIFF stay panel-owned (controller leaves graffPolygon null).
 */
import { getAgriDashboardBootstrap } from "../data/agri-bootstrap";
import type { MasterFilterSnapshot } from "../data/agri-filter-store";
import { queryRegionAggregateRows } from "../data/agri-region-stats";
import { queryPieAggregateRows } from "../data/agri-pie-stats";
import { queryIndicatorSumMaydon } from "../data/agri-indicator-stats";
import {
  buildGraffRegionalScopeKey,
  buildTuriToCropIdMap,
  buildViloyatToRegionMap,
  queryGraffRegionalTimeseriesMerged,
  resolveGraffCropIds,
  resolveGraffDistrictNumber,
} from "../data/agri-graff-stats";
import { extractGraffYearToken } from "../data/agri-graff-date";
import { findAreaFieldByPreferredNames } from "../data/agri-area-field";
import { makeRegionDistrictKey } from "../filter/localization/geo-keys";
import { VH_TO_NDVI_STATUS } from "../filter/localization/vh-constants";
import {
  emptyDashboardPack,
  type DashboardFilterSlice,
  type DashboardGraffPack,
  type DashboardIndicatorPack,
  type DashboardPack,
  type DashboardPiePack,
  type DashboardRegionPack,
} from "../types/dashboard-pack";
import { patchDashboardPack, setDashboardPack, getDashboardPack, getPersistedDashboardPack } from "../store/agri-dashboard-store";
import {
  buildIndicatorStatsWhere,
  buildPieStatsWhere,
  buildRegionAggregatesWhere,
} from "./agri-where-builder";
import { buildDashboardQueryPlan } from "./agri-query-plan";
import { getAgriTableDataLayer } from "../gis/agri-table-data-source";
import { getAgriVegetationIndicesLayer } from "../gis/agri-vegetation-data-source";

const CONTROLLER_DEBOUNCE_MS = 60;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let lastKey = "";
let generation = 0;

function asString(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeTurlar(filters: Record<string, unknown>): string[] {
  const raw = Array.isArray(filters.turlar)
    ? filters.turlar
    : filters.turi
      ? [filters.turi]
      : [];
  return Array.from(
    new Set(
      raw
        .map((v) => asString(v))
        .filter(Boolean),
    ),
  );
}

export function extractDashboardFilterSlice(
  detail: MasterFilterSnapshot,
): DashboardFilterSlice {
  const filters = (detail.filters || {}) as Record<string, unknown>;
  const scope = (detail.scope || {}) as Record<string, unknown>;
  return {
    yil: asString(filters.yil),
    viloyat: asString(filters.viloyat),
    tuman: asString(filters.tuman),
    turi: asString(filters.turi),
    turlar: normalizeTurlar(filters),
    vh: asString(filters.vh),
    lockedViloyat: asString(scope.lockedViloyat),
    filterPieByVh: filters.filterPieByVh === true,
  };
}

export function buildDashboardPackKey(filter: DashboardFilterSlice): string {
  return JSON.stringify({
    yil: filter.yil,
    viloyat: filter.viloyat,
    tuman: filter.tuman,
    turi: filter.turi,
    turlar: filter.turlar,
    vh: filter.vh,
    lockedViloyat: filter.lockedViloyat,
    filterPieByVh: filter.filterPieByVh,
  });
}

function findAreaField(layer: __esri.FeatureLayer): string | null {
  return findAreaFieldByPreferredNames(layer);
}

async function prefetchRegionPack(
  filter: DashboardFilterSlice,
  layer: __esri.FeatureLayer,
): Promise<DashboardRegionPack | null> {
  const effectiveViloyat = filter.lockedViloyat || filter.viloyat || "";
  const view: "viloyat" | "tuman" = effectiveViloyat ? "tuman" : "viloyat";
  const groupField = view === "viloyat" ? "viloyat" : "tuman";
  const codeField = view === "viloyat" ? "region" : "district";
  const where = buildRegionAggregatesWhere({
    ...filter,
    view,
    drillViloyat: effectiveViloyat,
  });
  if (!where || where === "1=0") {
    return { view, groupField, where: where || "1=0", rows: [], totalArea: 0 };
  }

  const areaField = findAreaField(layer);
  const { rows, totalArea } = await queryRegionAggregateRows({
    layer,
    where,
    groupField,
    codeField,
    areaField,
    objectIdField: layer.objectIdField || "OBJECTID",
  });

  return { view, groupField, where, rows, totalArea };
}

async function prefetchPiePack(
  filter: DashboardFilterSlice,
  layer: __esri.FeatureLayer,
): Promise<DashboardPiePack | null> {
  const scopeViloyat = String(
    filter.viloyat || filter.lockedViloyat || "",
  ).trim();
  const where = buildPieStatsWhere(filter, {
    includeCategory: false,
    includeViloyat: !!scopeViloyat,
  });
  // Group by crop_id (stable); labels resolved via turi mapping in PiePanel.
  const categoryField = "crop_id";
  const areaField = findAreaField(layer);

  const { rows, totalValue } = await queryPieAggregateRows({
    layer,
    where: where || "1=1",
    categoryField,
    areaField,
    objectIdField: layer.objectIdField || "OBJECTID",
  });

  return { where: where || "1=1", categoryField, rows, totalValue };
}

/**
 * Default Indicator card: sum(maydon) with excludeZero — matches dashboard config.
 */
async function prefetchIndicatorPack(
  filter: DashboardFilterSlice,
  layer: __esri.FeatureLayer,
): Promise<DashboardIndicatorPack | null> {
  const attributeField = "maydon";
  const where = buildIndicatorStatsWhere(
    {
      yil: filter.yil,
      viloyat: filter.viloyat,
      tuman: filter.tuman,
      turi: filter.turi,
      turlar: filter.turlar,
    },
    { includeViloyat: true, excludeZeroField: attributeField },
  );

  const value = await queryIndicatorSumMaydon({
    layer,
    where: where || "1=1",
  });

  return {
    where: where || "1=1",
    statOperation: "sum",
    attributeField,
    value,
  };
}

/**
 * Graff regional timeseries — includes VH status when filter.vh is set.
 * Polygon uniqueid remains panel-owned (not in DashboardFilterSlice).
 */
async function prefetchGraffPack(
  filter: DashboardFilterSlice,
): Promise<DashboardGraffPack | null> {
  const yearToken = extractGraffYearToken(filter.yil);
  if (!yearToken) return null;

  const bootstrap = await getAgriDashboardBootstrap();
  const viloyatToRegion = buildViloyatToRegionMap(
    bootstrap.regionDistrictRows || [],
  );
  const turiToCropId = buildTuriToCropIdMap(bootstrap.turiCropRows || []);

  const effectiveViloyat = String(
    filter.lockedViloyat || filter.viloyat || "",
  ).trim();
  const effectiveTuman = effectiveViloyat
    ? String(filter.tuman || "").trim()
    : "";

  let regionNum: number | undefined;
  if (effectiveViloyat) {
    if (/^\d+$/.test(effectiveViloyat)) {
      regionNum = Number(effectiveViloyat);
    } else {
      const key = makeRegionDistrictKey(effectiveViloyat);
      regionNum = key ? viloyatToRegion[key] : undefined;
    }
    if (regionNum === undefined || !Number.isFinite(regionNum)) {
      return null;
    }
  }

  let districtNum: number | undefined;
  if (effectiveTuman) {
    if (/^\d+$/.test(effectiveTuman)) {
      districtNum = Number(effectiveTuman);
    } else {
      districtNum = resolveGraffDistrictNumber(
        effectiveViloyat,
        effectiveTuman,
        bootstrap.regionDistrictRows || [],
        viloyatToRegion,
      );
    }
    if (districtNum === undefined || !Number.isFinite(districtNum)) {
      return null;
    }
  }

  const { cropIds, unresolved } = resolveGraffCropIds(
    filter.turlar || [],
    filter.turi || "",
    turiToCropId,
  );
  if (unresolved.length) return null;

  const startDate = `${yearToken}-01-01`;
  const endDate = `${yearToken}-12-31`;
  const region =
    regionNum !== undefined && Number.isFinite(regionNum) ? regionNum : null;
  const district =
    districtNum !== undefined && Number.isFinite(districtNum)
      ? districtNum
      : null;
  const vh = String(filter.vh || "").trim();
  const ndviStatus = vh ? VH_TO_NDVI_STATUS[vh] || undefined : undefined;

  const scopeKey = buildGraffRegionalScopeKey({
    region,
    district,
    cropIds,
    startDate,
    endDate,
    vh,
  });

  // No viloyat: default chart is NDVI-only — do not AVG SAVI/EVI/… yet.
  // Viloyat/tuman: full index set (min/max bands) so legend toggles are instant.
  const avgFields = region == null ? (["ndvi"] as string[]) : undefined;

  const rows = await queryGraffRegionalTimeseriesMerged({
    region: region ?? undefined,
    district: district ?? undefined,
    cropIds,
    startDate,
    endDate,
    ndviStatus,
    avgFields,
  });

  return {
    scopeKey,
    region,
    district,
    cropIds,
    startDate,
    endDate,
    rows,
  };
}

async function runController(
  detail: MasterFilterSnapshot,
  key: string,
  gen: number,
): Promise<void> {
  const filter = extractDashboardFilterSlice(detail);
  const plan = buildDashboardQueryPlan(filter);

  setDashboardPack(
    emptyDashboardPack({
      phase: plan.warmupLayers ? "warming" : "ready",
      key,
      filter,
      region: null,
      pie: null,
      indicator: null,
      graff: null,
      graffPolygon: null,
      statsDeferredToPanels: plan.deferStatsToPanels,
      error: null,
    }),
  );

  if (plan.warmupLayers) {
    await Promise.all([
      getAgriDashboardBootstrap().catch((): undefined => undefined),
      getAgriTableDataLayer().catch((): undefined => undefined),
      getAgriVegetationIndicesLayer().catch((): undefined => undefined),
    ]);
    if (gen !== generation) return;
  }

  const anyPrefetch =
    plan.prefetchRegion ||
    plan.prefetchPie ||
    plan.prefetchIndicator ||
    plan.prefetchGraff;

  if (!anyPrefetch) {
    patchDashboardPack({
      phase: "ready",
      key,
      filter,
      region: null,
      pie: null,
      indicator: null,
      graff: null,
      graffPolygon: null,
      statsDeferredToPanels: plan.deferStatsToPanels,
      error: null,
    });
    return;
  }

  patchDashboardPack({ phase: "loading-stats", key, filter });

  try {
    const { layer } = await getAgriTableDataLayer();
    if (gen !== generation) return;
    if (!layer?.loaded && typeof (layer as any)?.load === "function") {
      try {
        await (layer as any).load();
      } catch {
        /* query may still succeed */
      }
    }
    if (gen !== generation) return;

    const [region, pie, indicator, graff] = await Promise.all([
      plan.prefetchRegion
        ? prefetchRegionPack(filter, layer as __esri.FeatureLayer).catch(
            (): null => null,
          )
        : Promise.resolve(null),
      plan.prefetchPie
        ? prefetchPiePack(filter, layer as __esri.FeatureLayer).catch(
            (): null => null,
          )
        : Promise.resolve(null),
      plan.prefetchIndicator
        ? prefetchIndicatorPack(filter, layer as __esri.FeatureLayer).catch(
            (): null => null,
          )
        : Promise.resolve(null),
      plan.prefetchGraff
        ? prefetchGraffPack(filter).catch((): null => null)
        : Promise.resolve(null),
    ]);
    if (gen !== generation) return;

    patchDashboardPack({
      phase: "ready",
      key,
      filter,
      region,
      pie,
      indicator,
      graff,
      graffPolygon: null,
      // Keep true under VH so Pie/Indicator refuse empty packed slices.
      // Region still packs (ignores VH) and matchRegion ignores this flag.
      statsDeferredToPanels: plan.deferStatsToPanels,
      error: null,
    });
  } catch (e: any) {
    if (gen !== generation) return;
    patchDashboardPack({
      phase: "error",
      key,
      filter,
      region: null,
      pie: null,
      indicator: null,
      graff: null,
      graffPolygon: null,
      statsDeferredToPanels: true,
      error: String(e?.message || e || "dashboard controller failed"),
    });
  }
}

/**
 * Schedule controller work after a master filter snapshot.
 * Replaces bare warmup — warmup is included inside the controller.
 */
export function scheduleDashboardController(
  detail: MasterFilterSnapshot | null | undefined,
): void {
  if (!detail || typeof detail !== "object") return;
  if (detail.vhBarDataPending === true) return;

  const filter = extractDashboardFilterSlice(detail);
  const key = buildDashboardPackKey(filter);

  if (!filter.yil) {
    setDashboardPack(
      emptyDashboardPack({
        phase: "ready",
        key,
        filter,
        statsDeferredToPanels: false,
      }),
    );
    return;
  }

  // Same filter already packed in memory (or multi-key localStorage hydrate).
  const existing = getDashboardPack();
  if (existing.phase === "ready" && existing.key === key) {
    lastKey = key;
    return;
  }

  const fromDisk = getPersistedDashboardPack(key);
  if (fromDisk) {
    lastKey = key;
    setDashboardPack(fromDisk);
    return;
  }

  if (key !== lastKey) {
    setDashboardPack(
      emptyDashboardPack({
        phase: "warming",
        key,
        filter,
        region: null,
        pie: null,
        indicator: null,
        graff: null,
        graffPolygon: null,
        statsDeferredToPanels: false,
        error: null,
      }),
    );
  }

  if (key === lastKey && inFlight) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (key === lastKey && inFlight) return;
    lastKey = key;
    const gen = ++generation;
    inFlight = runController(detail, key, gen).finally(() => {
      if (gen === generation) inFlight = null;
    });
  }, CONTROLLER_DEBOUNCE_MS);
}

/** Test / hot-reload helper */
export function resetDashboardController(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  inFlight = null;
  lastKey = "";
  generation += 1;
}

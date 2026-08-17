import { type QueriableDataSource } from "jimu-core";
import {
  buildEvapoWhere,
  canonicalizeRegionFilterValue,
  disableLayerPbf,
  flLog,
  haystackMatchesRegion,
  haystackMatchesYear,
  getQueryableLayer,
  pickYearRegionLayerPool,
  prepareValueIndex,
  quickLayerFeatureCount,
  resolveFeatureLayerForFilters,
  safeLoadMapLayer,
  scoreHaystackForFilters,
  type EvapoFilters,
  type ResolvedFeatureLayer,
} from "./feature-layer-data";

export function toPlainArray<T = any>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as T[];
  if (typeof val.asMutable === "function")
    return val.asMutable({ deep: true }) as T[];
  if (typeof val.toArray === "function") return val.toArray() as T[];
  return [];
}

export function getSelectedDsIds(useDataSources: any): string[] {
  const uds = toPlainArray<any>(useDataSources);
  const ids = uds.map((u) => u?.dataSourceId).filter(Boolean);
  return Array.from(new Set(ids));
}

type ScoredDs = {
  ds: QueriableDataSource;
  score: number;
  regionMatch: boolean;
};

/**
 * Resolves the active FeatureLayer for dashboard widgets.
 * Prefers EXB DataSources (same path as LocalizationWidgetV20),
 * falls back to JimuMapView map layers.
 */
export class EvapoDataSourceEngine {
  private dsById: Record<string, QueriableDataSource> = {};
  private selectedIds: string[] = [];
  private resolveCache = new Map<
    string,
    Promise<ResolvedFeatureLayer | null>
  >();

  onDsCreated(ds: QueriableDataSource, ids: string[]): void {
    if (!ds?.id) return;
    this.dsById[ds.id] = ds;
    this.selectedIds = [...ids];
    this.resolveCache.clear();
  }

  syncSelection(ids: string[]): void {
    this.selectedIds = [...ids];
    this.resolveCache.clear();
  }

  clearResolveCache(): void {
    this.resolveCache.clear();
  }

  /** True while selected data sources are still connecting (no map fallback yet). */
  isResolvePending(jimuMapView: any | null): boolean {
    if (jimuMapView?.view?.map) return false;
    if (!this.selectedIds.length) return false;
    const connected = this.selectedIds.filter((id) => !!this.dsById[id]).length;
    return connected < this.selectedIds.length;
  }

  hasConnectedSources(): boolean {
    return this.selectedIds.some((id) => !!this.dsById[id]);
  }

  getLayerFromDs(ds: QueriableDataSource): any | null {
    const anyDs = ds as any;
    return getQueryableLayer(anyDs.layer || anyDs._layer);
  }

  private getDsHaystack(ds: QueriableDataSource): string {
    const anyDs = ds as any;
    const layer = anyDs.layer || anyDs._layer;
    const title = String(layer?.title || "");
    const url = String(layer?.url || anyDs.getDataSourceJson?.()?.url || "");
    const label = String(
      anyDs.getLabel?.() ||
        anyDs.getDataSourceJson?.()?.label ||
        anyDs.getDataSourceJson?.()?.sourceLabel ||
        "",
    );
    return `${title} ${url} ${label}`;
  }

  private buildRegionProbeWhere(
    filters: Pick<EvapoFilters, "yil" | "viloyat">,
    layer: any,
    fields: string[],
    regionScoped: boolean,
    yearScoped: boolean,
  ): string {
    return buildEvapoWhere(
      {
        yil: filters.yil,
        viloyat: filters.viloyat,
        skipRegionFilter: regionScoped,
        skipYearFilter: yearScoped,
      },
      fields,
      layer,
    );
  }

  private async pickBestDsByCount(
    pool: ScoredDs[],
    filters: Pick<EvapoFilters, "yil" | "viloyat">,
    preferredDs: QueriableDataSource | null,
  ): Promise<ScoredDs | null> {
    if (!pool.length) return null;
    if (!String(filters.viloyat ?? "").trim() || pool.length === 1) {
      return pool[0];
    }

    const scored: Array<{ item: ScoredDs; count: number }> = [];
    const tryItem = async (item: ScoredDs): Promise<void> => {
      const layer = this.getLayerFromDs(item.ds);
      if (!layer) return;
      try {
        await safeLoadMapLayer(layer);
      } catch {
        /* ignore */
      }
      const fields: string[] = (layer.fields || []).map((f: any) => f.name);
      const where = this.buildRegionProbeWhere(
        filters,
        layer,
        fields,
        item.regionMatch,
        haystackMatchesYear(this.getDsHaystack(item.ds), filters.yil),
      );
      const count = await quickLayerFeatureCount(layer, where);
      scored.push({ item, count });
    };

    if (preferredDs) {
      const preferred = pool.find((p) => p.ds.id === preferredDs.id);
      if (preferred) {
        await tryItem(preferred);
        const preferredCount = scored[0]?.count ?? -1;
        if (preferredCount > 0) return preferred;
      }
    }

    const remaining = pool.filter(
      (p) => !preferredDs || p.ds.id !== preferredDs.id,
    );
    await Promise.all(remaining.map((item) => tryItem(item)));

    const positive = scored
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);
    if (positive.length) return positive[0].item;

    return (
      scored.find((s) => s.count >= 0)?.item ||
      pool.find((p) => p.ds.id === preferredDs?.id) ||
      pool[0]
    );
  }

  async resolveFromDataSources(
    filters: Pick<EvapoFilters, "yil" | "viloyat">,
  ): Promise<ResolvedFeatureLayer | null> {
    const normalizedFilters = {
      yil: filters.yil,
      viloyat: canonicalizeRegionFilterValue(String(filters.viloyat ?? "").trim()),
    };
    const wantsRegion = !!normalizedFilters.viloyat;
    const scored: ScoredDs[] = [];

    for (const id of this.selectedIds) {
      const ds = this.dsById[id];
      if (!ds || !this.getLayerFromDs(ds)) continue;
      const haystack = this.getDsHaystack(ds);
      scored.push({
        ds,
        score: scoreHaystackForFilters(haystack, normalizedFilters),
        regionMatch: haystackMatchesRegion(haystack, normalizedFilters.viloyat),
      });
    }

    if (!scored.length) return null;

    const pool = pickYearRegionLayerPool(
      scored,
      scored.length,
      normalizedFilters,
      (item) => this.getDsHaystack(item.ds),
    );
    if (!pool.length) return null;

    let bestScore = -1;
    let scoreWinner: ScoredDs | null = null;
    for (const item of pool) {
      if (item.score > bestScore) {
        bestScore = item.score;
        scoreWinner = item;
      }
    }

    const preferredDs = scoreWinner?.ds || null;
    const bestItem =
      wantsRegion && pool.length > 1
        ? await this.pickBestDsByCount(pool, normalizedFilters, preferredDs)
        : scoreWinner;

    const bestDs = bestItem?.ds || preferredDs;
    if (!bestDs) return null;

    const layer = this.getLayerFromDs(bestDs);
    if (!layer) return null;

    try {
      await safeLoadMapLayer(layer);
    } catch {
      /* layer may already be loaded */
    }
    disableLayerPbf(layer);

    const fields: string[] = (layer.fields || []).map((f: any) => f.name);
    const regionMatch = bestItem?.regionMatch ?? false;
    const regionScoped = regionMatch || (bestItem?.score ?? 0) >= 25;
    const haystack = this.getDsHaystack(bestDs);
    const yearScoped = haystackMatchesYear(haystack, normalizedFilters.yil);

    flLog("resolve via DataSource", {
      filters: normalizedFilters,
      dsId: bestDs.id,
      layerTitle: layer?.title || layer?.url || null,
      score: bestItem?.score ?? bestScore,
      regionScoped,
      yearScoped,
      fieldCount: fields.length,
      countBased: wantsRegion && pool.length > 1,
    });22
    void prepareValueIndex(layer, fields);
    return {
      layer,
      fields,
      regionScoped,
      yearScoped,
    };
  }

  async resolve(
    filters: Pick<EvapoFilters, "yil" | "viloyat">,
    jimuMapView: any | null,
  ): Promise<ResolvedFeatureLayer | null> {
    const cacheKey = JSON.stringify({
      yil: filters.yil || "",
      viloyat: canonicalizeRegionFilterValue(String(filters.viloyat ?? "").trim()),
      ids: this.selectedIds,
    });
    const pending = this.resolveCache.get(cacheKey);
    if (pending) return pending;

    const job = this.resolveInternal(filters, jimuMapView);
    this.resolveCache.set(cacheKey, job);
    try {
      return await job;
    } finally {
      if (this.resolveCache.get(cacheKey) === job) {
        this.resolveCache.delete(cacheKey);
      }
    }
  }

  private async resolveInternal(
    filters: Pick<EvapoFilters, "yil" | "viloyat">,
    jimuMapView: any | null,
  ): Promise<ResolvedFeatureLayer | null> {
    const fromDs = await this.resolveFromDataSources(filters);
    if (fromDs) return fromDs;
    if (!jimuMapView) {
      flLog("resolve FAILED (no DS layer, no map view)", {
        filters,
        selectedIds: this.selectedIds,
        connectedIds: this.selectedIds.filter((id) => !!this.dsById[id]),
      });
      return null;
    }
    const fromMap = await resolveFeatureLayerForFilters(jimuMapView, filters);
    flLog("resolve via Map", {
      filters,
      layerTitle: fromMap?.layer?.title || fromMap?.layer?.url || null,
      regionScoped: fromMap?.regionScoped ?? null,
      yearScoped: fromMap?.yearScoped ?? null,
      found: !!fromMap,
    });
    if (fromMap?.layer) {
      void prepareValueIndex(fromMap.layer, fromMap.fields);
    }
    return fromMap;
  }
}

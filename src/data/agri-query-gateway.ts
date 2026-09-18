/**
 * In-flight deduplication for ArcGIS layer queries.
 * Same URL + WHERE + outFields → one network round-trip shared by all callers.
 */

export interface DedupedLayerQuerySpec {
  where?: string;
  outFields?: string[];
  groupByFieldsForStatistics?: string[];
  outStatistics?: unknown[];
  returnDistinctValues?: boolean;
  orderByFields?: string[];
  returnGeometry?: boolean;
  returnCountOnly?: boolean;
  num?: number;
  resultRecordCount?: number;
  resultOffset?: number;
}

const inFlight = new Map<string, Promise<unknown>>();

function layerUrl(layer: any): string {
  return String(layer?.url || layer?.layer?.url || "").trim();
}

/**
 * Normalize outStatistics array for stable key comparison.
 * Sorts by (statisticType, onStatisticField) so that two callers building
 * the stat array independently get the same key even if field order differs.
 */
function normalizeStats(stats: unknown[] | null | undefined): unknown {
  if (!stats || !stats.length) return null;
  return [...stats]
    .map((s: any) => ({
      t: String(s?.statisticType ?? "").toLowerCase(),
      f: String(s?.onStatisticField ?? "").toLowerCase(),
      o: String(s?.outStatisticFieldName ?? "").toLowerCase(),
    }))
    .sort((a, b) =>
      a.t !== b.t ? a.t.localeCompare(b.t) : a.f.localeCompare(b.f),
    );
}

function stableKey(url: string, spec: DedupedLayerQuerySpec): string {
  const normalized = {
    where: String(spec.where ?? "1=1"),
    outFields: [...(spec.outFields ?? [])].sort(),
    groupBy: [...(spec.groupByFieldsForStatistics ?? [])].sort(),
    stats: normalizeStats(spec.outStatistics),
    distinct: !!spec.returnDistinctValues,
    orderBy: spec.orderByFields ?? [],
    geom: spec.returnGeometry !== false,
    countOnly: !!spec.returnCountOnly,
    num: spec.num ?? null,
    rrc: spec.resultRecordCount ?? null,
    ro: spec.resultOffset ?? null,
  };
  return `${url}|${JSON.stringify(normalized)}`;
}

function applySpecToQuery(query: any, spec: DedupedLayerQuerySpec): void {
  query.where = spec.where ?? "1=1";
  if (spec.outFields) query.outFields = spec.outFields;
  if (spec.groupByFieldsForStatistics) {
    query.groupByFieldsForStatistics = spec.groupByFieldsForStatistics;
  }
  if (spec.outStatistics) query.outStatistics = spec.outStatistics;
  if (spec.returnDistinctValues != null) {
    query.returnDistinctValues = spec.returnDistinctValues;
  }
  if (spec.orderByFields) query.orderByFields = spec.orderByFields;
  if (spec.returnGeometry != null) query.returnGeometry = spec.returnGeometry;
  if (spec.returnCountOnly != null) {
    query.returnCountOnly = spec.returnCountOnly;
  }
  if (spec.num != null) query.num = spec.num;
  if (spec.resultRecordCount != null) {
    query.resultRecordCount = spec.resultRecordCount;
  }
  if (spec.resultOffset != null) query.resultOffset = spec.resultOffset;
}

export async function dedupedQueryFeatures(
  layer: any,
  spec: DedupedLayerQuerySpec,
): Promise<__esri.FeatureSet> {
  const url = layerUrl(layer);
  const key = stableKey(url, spec);
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<__esri.FeatureSet>;

  const promise = (async () => {
    const query = layer.createQuery();
    applySpecToQuery(query, spec);
    return layer.queryFeatures(query);
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

export async function dedupedQueryFeatureCount(
  layer: any,
  where: string,
): Promise<number> {
  const url = layerUrl(layer);
  const key = `${url}|count|${where}`;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<number>;

  const promise = (async () => {
    if (typeof layer?.queryFeatureCount === "function") {
      return Number((await layer.queryFeatureCount({ where })) || 0);
    }
    const query = layer.createQuery();
    query.where = where;
    query.returnGeometry = false;
    query.outFields = [layer.objectIdField || "objectid"];
    query.returnCountOnly = true;
    const result = await layer.queryFeatures(query);
    if (typeof result?.count === "number") return result.count;
    return Number(result?.totalCount ?? 0);
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/** Test-only / hot-reload helper */
export function clearAgriQueryGatewayCache(): void {
  inFlight.clear();
}

/**
 * Selection-order bridge between Vegetatsiya Holati (vh) and Ekin turi (turi).
 *
 * Whichever dimension is chosen first scopes the *other widget's chart*.
 * The second dimension only narrows the map (both still AND on the map).
 *
 * Pie uniqueids are stored here (not in CustomEvent) to avoid shipping
 * 10k+ IDs through masterFilterChanged payloads.
 */

export type ChartDim = "vh" | "turi";

export interface ChartFilterFlags {
  filterPieByVh: boolean;
  filterVhBarByCrop: boolean;
}

/** Uniqueids for Pie when VH was selected first (no crop narrowing). */
let pieVhUniqueIds: string[] | null = null;
let pieVhUniqueIdsSig = "";

export function setPieVhFilterUniqueIds(ids: string[] | null): void {
  pieVhUniqueIds = ids;
  pieVhUniqueIdsSig = ids
    ? `${ids.length}:${ids[0] || ""}:${ids[ids.length - 1] || ""}`
    : "";
}

export function getPieVhFilterUniqueIds(): string[] | null {
  return pieVhUniqueIds;
}

/** Compact signature so Pie can detect id-set changes without deep compare. */
export function getPieVhFilterUniqueIdsSig(): string {
  return pieVhUniqueIdsSig;
}

export function clearPieVhFilterUniqueIds(): void {
  pieVhUniqueIds = null;
  pieVhUniqueIdsSig = "";
}

/**
 * Derive chart-scoping flags from selection order.
 * `order` lists active dims in the order they were first selected.
 */
export function deriveChartFilterFlags(
  order: ChartDim[],
  vhActive: boolean,
  turiActive: boolean,
): ChartFilterFlags {
  const vhIdx = order.indexOf("vh");
  const turiIdx = order.indexOf("turi");
  return {
    filterPieByVh:
      vhActive &&
      (!turiActive || (vhIdx >= 0 && (turiIdx < 0 || vhIdx < turiIdx))),
    filterVhBarByCrop:
      turiActive &&
      (!vhActive || (turiIdx >= 0 && (vhIdx < 0 || turiIdx < vhIdx))),
  };
}

export function upsertChartDimOrder(
  order: ChartDim[],
  dim: ChartDim,
  active: boolean,
): ChartDim[] {
  const has = order.includes(dim);
  if (active) {
    // Keep original first-selected position — never move an existing dim.
    return has ? order.slice() : [...order, dim];
  }
  return order.filter((d) => d !== dim);
}

export function clearChartDimOrder(): ChartDim[] {
  return [];
}

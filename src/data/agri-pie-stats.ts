/**
 * Shared Pie category stats helpers.
 * Used by dashboard controller (DashboardPack prefetch).
 * PiePanel already calls getPieCategoryStatsCached for fallback queries.
 */

import { getPieCategoryStatsCached } from "./agri-stats-store";
import type { DashboardPieRow } from "../types/dashboard-pack";

export async function queryPieAggregateRows(opts: {
  layer: __esri.FeatureLayer;
  where: string;
  categoryField: string;
  areaField?: string | null;
  objectIdField?: string;
}): Promise<{ rows: DashboardPieRow[]; totalValue: number }> {
  const rows = await getPieCategoryStatsCached({
    layer: opts.layer,
    where: opts.where || "1=1",
    categoryField: opts.categoryField,
    areaField: opts.areaField,
    objectIdField: opts.objectIdField || opts.layer.objectIdField || "OBJECTID",
  });
  const totalValue = rows.reduce((s, r) => s + (r.value || 0), 0);
  return { rows, totalValue };
}

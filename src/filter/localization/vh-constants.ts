/**
 * VH bar chart constants + types.
 * Single source for Localization (computes vhBarData) — BarPanel displays that
 * payload and does not redefine categories.
 */

export interface VHBarDataItem {
  category: string;
  label: string;
  count: number;
  fieldCount: number;
  percentage: number;
  color: string;
  order: number;
}

export interface VHBarData {
  categories: VHBarDataItem[];
  totalCount: number;
}

/** VH category definitions for bar chart (Localization → Bar via vhBarData). */
export const VH_CATEGORIES = [
  { value: "1-Juda yaxshi", label: "Жуда яхши", order: 1, color: "#16a34a" },
  { value: "2-Yaxshi", label: "Яхши", order: 2, color: "#4ade80" },
  { value: "3-O'rta", label: "Ўрта", order: 3, color: "#f97316" },
  { value: "4-Past", label: "Паст", order: 4, color: "#ef4444" },
] as const;

/** Map precalculated ndvi_status table values to VH category value. */
export const NDVI_STATUS_TO_VH: Record<string, string> = {
  juda_yaxshi: "1-Juda yaxshi",
  yaxshi: "2-Yaxshi",
  orta: "3-O'rta",
  past: "4-Past",
};

/** Reverse: VH category value → ndvi_status table value (for table WHERE). */
export const VH_TO_NDVI_STATUS: Record<string, string> = {
  "1-Juda yaxshi": "juda_yaxshi",
  "2-Yaxshi": "yaxshi",
  "3-O'rta": "orta",
  "4-Past": "past",
};

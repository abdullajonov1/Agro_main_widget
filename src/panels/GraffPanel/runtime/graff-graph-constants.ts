/** Shared vegetation index legend config for Graff graph/table views. */
export type GraffIndexKey = "ndvi" | "savi" | "rvi" | "ci" | "evi" | "ndwi";

export interface GraffIndexButton {
  key: GraffIndexKey;
  label: string;
  color: string;
}

export const GRAFF_INDEX_BUTTONS: GraffIndexButton[] = [
  { key: "ndvi", label: "NDVI", color: "#00d084" },
  { key: "savi", label: "SAVI", color: "#7aa5ff" },
  { key: "rvi", label: "RVI", color: "#ffb347" },
  { key: "ci", label: "CI", color: "#c78bff" },
  { key: "evi", label: "EVI", color: "#ff4d8d" },
  { key: "ndwi", label: "NDWI", color: "#2ec4f1" },
];

export const GRAFF_INDEX_ORDER: GraffIndexKey[] = GRAFF_INDEX_BUTTONS.map(
  (item) => item.key,
);

/** Republic regional timeseries AVG field allow-list. */
export const REPUBLIC_TIMESERIES_INDEX_FIELDS = [
  "ndvi",
  "savi",
  "evi",
  "rvi",
  "ci",
  "ndwi",
] as const;

export type RepublicTimeseriesIndexField =
  (typeof REPUBLIC_TIMESERIES_INDEX_FIELDS)[number];

export function isRepublicTimeseriesIndexField(
  value: string,
): value is RepublicTimeseriesIndexField {
  return (REPUBLIC_TIMESERIES_INDEX_FIELDS as readonly string[]).includes(
    value,
  );
}

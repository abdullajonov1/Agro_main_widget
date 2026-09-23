/**
 * Crop polygon renderer palette helpers for LocalizationPanel.
 * Pure helpers — symbol objects are plain JSON for ArcGIS SimpleFillSymbol.
 */

export type CropRendererMode = "off" | "on";

export const CROP_RENDERER_ITEMS: Array<{
  value: string;
  label: string;
  color: string;
}> = [
  { value: "bug'doy", label: "Bug'doy", color: "#D9A300" },
  { value: "bugdoy", label: "Bug'doy", color: "#D9A300" },
  { value: "paxta", label: "Paxta", color: "#E8E1D1" },
  { value: "makka", label: "Makka", color: "#7CB342" },
  { value: "makkajo'xori", label: "Makkajo'xori", color: "#7CB342" },
  { value: "makkajoxori", label: "Makkajo'xori", color: "#7CB342" },
  { value: "sholi", label: "Sholi", color: "#26A69A" },
  { value: "mosh", label: "Mosh", color: "#8E44AD" },
  { value: "beda", label: "Beda", color: "#43A047" },
  { value: "ozuqa", label: "Ozuqa", color: "#8BC34A" },
  { value: "loviya", label: "Loviya", color: "#6A5ACD" },
  { value: "poliz", label: "Poliz", color: "#F26B38" },
  { value: "tariq", label: "Tariq", color: "#C58F00" },
  { value: "bog'", label: "Bog'", color: "#1B5E20" },
  { value: "bog", label: "Bog'", color: "#1B5E20" },
  { value: "bogi", label: "Bogi", color: "#1B5E20" },
  { value: "bog'lar", label: "Bog'lar", color: "#1B5E20" },
  { value: "yeryong'oq", label: "Yeryong'oq", color: "#8D6E63" },
  { value: "yeryongoq", label: "Yeryong'oq", color: "#8D6E63" },
  { value: "yer yong'oq", label: "Yer yong'oq", color: "#8D6E63" },
  { value: "sabzi", label: "Sabzi", color: "#E65100" },
  { value: "kungaboqar", label: "Kungaboqar", color: "#FDD835" },
  { value: "baliqxovuz", label: "Baliqxovuz", color: "#0288D1" },
  { value: "baliq hovuz", label: "Baliqxovuz", color: "#0288D1" },
  { value: "boshqa", label: "Boshqa", color: "#78909C" },
  { value: "noxat", label: "No'xat", color: "#C48A3A" },
  { value: "no'xat", label: "No'xat", color: "#C48A3A" },
  { value: "novot", label: "No'xat", color: "#C48A3A" },
  { value: "kartoshka", label: "Kartoshka", color: "#C4B08A" },
  { value: "piyoz", label: "Piyoz", color: "#8E6BB5" },
  { value: "issiqxona", label: "Issiqxona", color: "#78909C" },
  { value: "sarimsoq", label: "Sarimsoq", color: "#F5F0E6" },
  { value: "sarimsoqpiyoz", label: "Sarimsoq", color: "#F5F0E6" },
  { value: "sarimsoq piyoz", label: "Sarimsoq", color: "#F5F0E6" },
];

export function normalizeCropKey(raw: string): string {
  return (raw ?? "")
    .toString()
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    // Match agri-crop-labels normalizeCropName apostrophe set (incl. ´).
    .replace(/['\u2018\u2019\u02BB\u02BC`\u00B4]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolveCropRendererColor(raw: unknown): string {
  const key = normalizeCropKey(String(raw ?? ""));
  if (!key) return "#78909C";

  const exact = CROP_RENDERER_ITEMS.find(
    (item) => normalizeCropKey(item.value) === key,
  );
  if (exact) return exact.color;

  const collapsed = key.replace(/\s+/g, "");
  const collapsedMatch = CROP_RENDERER_ITEMS.find(
    (item) => normalizeCropKey(item.value).replace(/\s+/g, "") === collapsed,
  );
  if (collapsedMatch) return collapsedMatch.color;

  const partial = CROP_RENDERER_ITEMS.find((item) => {
    const itemKey = normalizeCropKey(item.value);
    return key.includes(itemKey) || itemKey.includes(key);
  });
  return partial?.color ?? "#78909C";
}

export function hexToRgba(
  hex: string,
  alpha = 1,
): [number, number, number, number] {
  const h = (hex || "").replace("#", "");
  const r = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  return r
    ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16), alpha]
    : [170, 170, 170, alpha];
}

export function createCropFillSymbol(color: string): any {
  return {
    type: "simple-fill",
    // 70% transparent = 30% visible fill; outline remains fully opaque.
    color: hexToRgba(color, 0.3),
    outline: {
      color: hexToRgba(color, 1),
      width: 1,
    },
  };
}

/**
 * Unique-value infos for crop renderer from distinct layer values.
 * When field is crop_id, resolve display crop name via turi→cropId map.
 */
export function buildCropUniqueValueInfosFromValues(
  field: string,
  distinctValues: string[],
  turiToCropId: Record<string, string | number> = {},
): any[] {
  const fieldLower = String(field || "").toLowerCase();
  if (!distinctValues.length) return [];

  return distinctValues.map((value) => {
    const cropName =
      fieldLower === "crop_id"
        ? Object.entries(turiToCropId || {}).find(
            ([, cropId]) => String(cropId) === String(value),
          )?.[0] || String(value)
        : String(value);
    return {
      value,
      label: value,
      symbol: createCropFillSymbol(resolveCropRendererColor(cropName)),
    };
  });
}

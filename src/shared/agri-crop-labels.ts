/**
 * Canonical crop-type keys and display labels for Agro_widgetV5 charts.
 * Merges Cyrillic/Latin/apostrophe variants (e.g. Буғдой + Bug'doy) into one slice.
 */
import { eqAposSmart } from "../data/agri-sql";

export type AgriCropLanguage = "uz_cyr" | "uz_lat" | "ru" | "en";

export type CropLabelEntry = Record<AgriCropLanguage, string>;

/** Preferred canonical key per crop (latin, stable for merge + color lookup). */
export const CROP_CANONICAL_KEYS: Record<string, string> = {
  "bug'doy": "bugdoy",
  bugdoy: "bugdoy",
  "makkajo'xori": "makkajoxori",
  makkajoxori: "makkajoxori",
  "bog'": "bog",
  bog: "bog",
  bogi: "bog",
  "bog'lar": "bog",
  "yeryong'oq": "yeryongoq",
  yeryongoq: "yeryongoq",
  "yer yong'oq": "yeryongoq",
  "baliq hovuz": "baliqxovuz",
};

export const CROP_LABELS: Record<string, CropLabelEntry> = {
  sholi: { uz_cyr: "Шоли", uz_lat: "Sholi", ru: "Рис", en: "Rice" },
  paxta: { uz_cyr: "Пахта", uz_lat: "Paxta", ru: "Хлопок", en: "Cotton" },
  makka: { uz_cyr: "Макка", uz_lat: "Makka", ru: "Кукуруза", en: "Corn" },
  makkajoxori: {
    uz_cyr: "Маккажўхори",
    uz_lat: "Makkajo'xori",
    ru: "Кукуруза",
    en: "Corn",
  },
  bugdoy: {
    uz_cyr: "Буғдой",
    uz_lat: "Bug'doy",
    ru: "Пшеница",
    en: "Wheat",
  },
  mosh: { uz_cyr: "Мош", uz_lat: "Mosh", ru: "Маш", en: "Mung bean" },
  beda: { uz_cyr: "Беда", uz_lat: "Beda", ru: "Люцерна", en: "Alfalfa" },
  ozuqa: { uz_cyr: "Озуқа", uz_lat: "Ozuqa", ru: "Кормовые", en: "Fodder" },
  loviya: { uz_cyr: "Ловия", uz_lat: "Loviya", ru: "Фасоль", en: "Beans" },
  poliz: { uz_cyr: "Полиз", uz_lat: "Poliz", ru: "Бахчевые", en: "Melons" },
  tariq: { uz_cyr: "Тариқ", uz_lat: "Tariq", ru: "Просо", en: "Millet" },
  bog: { uz_cyr: "Боғ", uz_lat: "Bog'", ru: "Сад", en: "Orchard" },
  yeryongoq: {
    uz_cyr: "Ерёнғоқ",
    uz_lat: "Yeryong'oq",
    ru: "Арахис",
    en: "Peanut",
  },
  sabzi: { uz_cyr: "Сабзи", uz_lat: "Sabzi", ru: "Морковь", en: "Carrot" },
  kungaboqar: {
    uz_cyr: "Кунгабоқар",
    uz_lat: "Kungaboqar",
    ru: "Подсолнечник",
    en: "Sunflower",
  },
  baliqxovuz: {
    uz_cyr: "Балиқҳовуз",
    uz_lat: "Baliqxovuz",
    ru: "Рыбный пруд",
    en: "Fish pond",
  },
  boshqa: { uz_cyr: "Бошқа", uz_lat: "Boshqa", ru: "Другое", en: "Other" },
  issiqxona: {
    uz_cyr: "Иссиқхона",
    uz_lat: "Issiqxona",
    ru: "Теплица",
    en: "Greenhouse",
  },
};

export const CROP_COLOR_MAP: Record<string, string> = {
  bugdoy: "#D9A300",
  paxta: "#E8E1D1",
  makka: "#7CB342",
  sholi: "#26A69A",
  mosh: "#8E44AD",
  beda: "#43A047",
  ozuqa: "#8BC34A",
  loviya: "#6A5ACD",
  poliz: "#F26B38",
  tariq: "#C58F00",
  bog: "#1B5E20",
  yeryongoq: "#8D6E63",
  sabzi: "#E65100",
  kungaboqar: "#FDD835",
  baliqxovuz: "#0288D1",
  boshqa: "#78909C",
  makkajoxori: "#7CB342",
  issiqxona: "#78909C",
};

let aliasToCanonical: Map<string, string> | null = null;

const APOSTROPHE_CLASS =
  "[\u0027\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u00B4\u0060\u02B9\u02C8]";

export function normalizeCropName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    // Apostrophe-like marks from DB / Excel / Cyrillic keyboards → ASCII '
    .replace(new RegExp(APOSTROPHE_CLASS, "g"), "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCropPunctuation(value: string): string {
  return value.replace(/'/g, "").replace(/\s+/g, "");
}

function buildAliasToCanonical(): Map<string, string> {
  const map = new Map<string, string>();

  const register = (alias: string, canonical: string) => {
    const key = normalizeCropName(alias).toLowerCase();
    if (!key) return;
    map.set(key, canonical);
    // Also register apostrophe-stripped form (Bug'doy → bugdoy).
    const stripped = stripCropPunctuation(key);
    if (stripped) map.set(stripped, canonical);
  };

  for (const [rawKey, entry] of Object.entries(CROP_LABELS)) {
    const canonical =
      CROP_CANONICAL_KEYS[rawKey] ||
      CROP_CANONICAL_KEYS[normalizeCropName(rawKey).toLowerCase()] ||
      stripCropPunctuation(normalizeCropName(rawKey).toLowerCase());
    register(rawKey, canonical);
    register(canonical, canonical);
    for (const label of Object.values(entry)) {
      register(label, canonical);
    }
  }

  for (const [alias, canonical] of Object.entries(CROP_CANONICAL_KEYS)) {
    register(alias, canonical);
  }

  return map;
}

/** Stable merge key — collapses Буғдой / Bug'doy / bugdoy into one bucket. */
export function getCropCanonicalKey(rawKey: unknown): string {
  const norm = normalizeCropName(rawKey).toLowerCase();
  if (!norm) return "";
  if (!aliasToCanonical) aliasToCanonical = buildAliasToCanonical();
  const stripped = stripCropPunctuation(norm);
  return (
    aliasToCanonical.get(norm) ||
    aliasToCanonical.get(stripped) ||
    stripped ||
    norm
  );
}

/** Key for turi → crop_id dictionaries (matches Pie chart canonical keys). */
export function getTuriCropLookupKey(raw: unknown): string {
  return getCropCanonicalKey(raw);
}

/**
 * All turi spellings to match in SQL / MapImage layerDefs for one crop pick
 * (canonical + localized labels + the raw value from the event).
 */
export function getCropTuriMatchValues(raw: unknown): string[] {
  const canonical = getCropCanonicalKey(raw);
  const out = new Set<string>();
  const add = (value: unknown) => {
    const text = normalizeCropName(value);
    if (text) out.add(text);
  };
  if (canonical) {
    add(canonical);
    const entry = CROP_LABELS[canonical];
    if (entry) {
      for (const label of Object.values(entry)) add(label);
    }
  }
  add(raw);
  for (const [alias, mapped] of Object.entries(CROP_CANONICAL_KEYS)) {
    if (mapped === canonical) add(alias);
  }
  return Array.from(out);
}

/** SQL WHERE for Pie canonical keys (bugdoy) against DB spellings (Bug'doy / Буғдой). */
export function buildTurlarSqlClause(
  field: string,
  values: unknown[],
): string {
  const literals = new Set<string>();
  for (const value of values) {
    for (const match of getCropTuriMatchValues(value)) {
      literals.add(match);
    }
  }
  const clauses = Array.from(literals)
    .map((value) => eqAposSmart(field, value))
    .filter(Boolean);
  if (!clauses.length) return "";
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
}

export function getCropDisplayName(
  rawKey: unknown,
  language: AgriCropLanguage,
): string {
  const canonical = getCropCanonicalKey(rawKey);
  if (!canonical) return String(rawKey ?? "").trim();
  const entry = CROP_LABELS[canonical];
  if (!entry) return String(rawKey ?? "").trim();
  return entry[language] || String(rawKey ?? "").trim();
}

export function getCropColor(rawKey: unknown, fallbackIndex = 0): string {
  const canonical = getCropCanonicalKey(rawKey);
  const hit = CROP_COLOR_MAP[canonical];
  if (hit) return hit;
  const palette = [
    "#1E7AE6",
    "#202124",
    "#6C6FD5",
    "#56AEDA",
    "#F6A11A",
    "#FF4E46",
    "#8B95A7",
    "#7B61FF",
    "#2AA1FF",
    "#00C389",
    "#D97706",
    "#EF4444",
    "#0EA5E9",
    "#4F46E5",
    "#334155",
  ];
  return palette[fallbackIndex % palette.length] ?? "#1E7AE6";
}

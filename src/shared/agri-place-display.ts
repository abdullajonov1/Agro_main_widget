/**
 * Display-name translation for Agri place labels (viloyat / tuman).
 * Same rules as RegionPanel / GraffPanel charts.
 */
import type { AgriLanguage } from "./agri-language";
import {
  translateUzbekPlaceToEnglish,
  type EnglishPlaceKind,
} from "../gis/english-place-names";

const UZ_CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A",
  а: "a",
  Б: "B",
  б: "b",
  В: "V",
  в: "v",
  Г: "G",
  г: "g",
  Д: "D",
  д: "d",
  Е: "E",
  е: "e",
  Ё: "Yo",
  ё: "yo",
  Ж: "J",
  ж: "j",
  З: "Z",
  з: "z",
  И: "I",
  и: "i",
  Й: "Y",
  й: "y",
  К: "K",
  к: "k",
  Л: "L",
  л: "l",
  М: "M",
  м: "m",
  Н: "N",
  н: "n",
  О: "O",
  о: "o",
  П: "P",
  п: "p",
  Р: "R",
  р: "r",
  С: "S",
  с: "s",
  Т: "T",
  т: "t",
  У: "U",
  у: "u",
  Ф: "F",
  ф: "f",
  Х: "X",
  х: "x",
  Ц: "Ts",
  ц: "ts",
  Ч: "Ch",
  ч: "ch",
  Ш: "Sh",
  ш: "sh",
  Щ: "Shch",
  щ: "shch",
  Ъ: "'",
  ъ: "'",
  Ы: "I",
  ы: "i",
  Ь: "'",
  ь: "'",
  Э: "E",
  э: "e",
  Ю: "Yu",
  ю: "yu",
  Я: "Ya",
  я: "ya",
  Ғ: "Gʻ",
  ғ: "gʻ",
  Қ: "Q",
  қ: "q",
  Ў: "Oʻ",
  ў: "oʻ",
  Ҳ: "H",
  ҳ: "h",
  Ң: "Ng",
  ң: "ng",
};

const UZ_LATIN_TO_CYRILLIC: Record<string, string> = {
  A: "А",
  a: "а",
  B: "Б",
  b: "б",
  C: "Ц",
  c: "ц",
  D: "Д",
  d: "д",
  E: "Е",
  e: "е",
  F: "Ф",
  f: "ф",
  G: "Г",
  g: "г",
  H: "Ҳ",
  h: "ҳ",
  I: "И",
  i: "и",
  J: "Ж",
  j: "ж",
  K: "К",
  k: "к",
  L: "Л",
  l: "л",
  M: "М",
  m: "м",
  N: "Н",
  n: "н",
  O: "О",
  o: "о",
  P: "П",
  p: "п",
  Q: "Қ",
  q: "қ",
  R: "Р",
  r: "р",
  S: "С",
  s: "с",
  T: "Т",
  t: "т",
  U: "У",
  u: "у",
  V: "В",
  v: "в",
  X: "Х",
  x: "х",
  Y: "Й",
  y: "й",
  Z: "З",
  z: "з",
  Gʻ: "Ғ",
  gʻ: "ғ",
  "G'": "Ғ",
  "g'": "ғ",
  Oʻ: "Ў",
  oʻ: "ў",
  "O'": "Ў",
  "o'": "ў",
  Sh: "Ш",
  sh: "ш",
  Ch: "Ч",
  ch: "ч",
  Ng: "Ң",
  ng: "ң",
  Yo: "Ё",
  yo: "ё",
  Yu: "Ю",
  yu: "ю",
  Ya: "Я",
  ya: "я",
  Ts: "Ц",
  ts: "ц",
  Shch: "Щ",
  shch: "щ",
};

const RU_REGION_NAMES: Record<string, string> = {
  andijon: "Андижан",
  buxoro: "Бухара",
  fargona: "Фергана",
  jizzax: "Джизак",
  namangan: "Наманган",
  navoiy: "Навои",
  qashqadaryo: "Кашкадарья",
  qoraqalpogiston: "Каракалпакстан",
  samarqand: "Самарканд",
  sirdaryo: "Сырдарья",
  surxondaryo: "Сурхандарья",
  toshkent: "Ташкент",
  xorazm: "Хорезм",
};

function uzCyrillicToLatin(text: string): string {
  if (!text || typeof text !== "string") return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += UZ_CYRILLIC_TO_LATIN[text[i]] ?? text[i];
  }
  return out;
}

function uzLatinToCyrillic(text: string): string {
  if (!text || typeof text !== "string") return text;
  const lower = text.toLowerCase();
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const twoLower = lower.slice(i, i + 2);
    const mappedTwo =
      UZ_LATIN_TO_CYRILLIC[two] ?? UZ_LATIN_TO_CYRILLIC[twoLower];
    if (two.length === 2 && mappedTwo) {
      out += mappedTwo;
      i += 2;
      continue;
    }
    const c = text[i];
    const cLower = lower[i];
    out += UZ_LATIN_TO_CYRILLIC[c] ?? UZ_LATIN_TO_CYRILLIC[cLower] ?? c;
    i += 1;
  }
  return out;
}

/**
 * Translate a viloyat/tuman label for the active Agri UI language.
 */
export function translateAgriPlaceForDisplay(
  text: string,
  language: AgriLanguage,
  placeKind: EnglishPlaceKind = "region",
): string {
  const str = String(text ?? "").trim();
  if (!str) return str;

  const latin = uzCyrillicToLatin(str);
  const qqKey = latin
    .toLowerCase()
    .replace(/[ʻʼ`’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+viloyat(?:i)?$/i, "")
    .replace(/\s+tumani$/i, "")
    .replace(/\s+respublikasi$/i, "")
    .replace(/\s+shahri$/i, "")
    .trim();

  if (qqKey === "qoraqalpogiston" || qqKey.startsWith("qoraqalpog")) {
    if (language === "en") {
      return /\brespublikasi\b/i.test(latin)
        ? "Republic of Karakalpakstan"
        : "Karakalpakstan";
    }
    if (language === "ru") {
      return /\brespublikasi\b/i.test(latin)
        ? "Республика Каракалпакстан"
        : "Каракалпакстан";
    }
    if (language === "uz_lat") {
      return /\brespublikasi\b/i.test(latin)
        ? "Qoraqalpog'iston Respublikasi"
        : "Qoraqalpog'iston";
    }
    return /\brespublikasi\b/i.test(latin)
      ? "Қорақалпоғистон Республикаси"
      : "Қорақалпоғистон";
  }

  if (language === "uz_lat") return latin;
  if (language === "uz_cyr") return uzLatinToCyrillic(latin);
  if (language === "en") {
    return translateUzbekPlaceToEnglish(latin, placeKind);
  }

  // Russian
  const normalized = latin.toLowerCase().replace(/[ʻʼ`’']/g, "'").trim();
  const isCity = /\s+shahri$/i.test(latin);
  const isRegion = /\s+viloyat(?:i)?$/i.test(latin);
  const isDistrict = /\s+tumani$/i.test(latin);
  const baseKey = normalized
    .replace(/\s+viloyat(?:i)?$/i, "")
    .replace(/\s+tumani$/i, "")
    .replace(/\s+shahri$/i, "")
    .replace(/\s+respublikasi$/i, "")
    .trim();
  const named = RU_REGION_NAMES[baseKey];
  const cyr =
    named ||
    uzLatinToCyrillic(
      latin
        .replace(/\s+viloyat(?:i)?$/i, "")
        .replace(/\s+tumani$/i, "")
        .replace(/\s+shahri$/i, ""),
    );
  if (isCity) return `город ${cyr}`;
  if (isRegion) return `${cyr}ская область`;
  if (isDistrict) return `${cyr} район`;
  return cyr;
}

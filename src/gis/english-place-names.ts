export type EnglishPlaceKind = "region" | "district";

const REGION_NAMES: Record<string, string> = {
  andijon: "Andijan",
  buxoro: "Bukhara",
  fargona: "Fergana",
  jizzax: "Jizzakh",
  namangan: "Namangan",
  navoiy: "Navoi",
  qashqadaryo: "Kashkadarya",
  qoraqalpogiston: "Karakalpakstan",
  "qoraqalpogiston respublikasi": "Republic of Karakalpakstan",
  samarqand: "Samarkand",
  sirdaryo: "Syrdarya",
  surxondaryo: "Surkhandarya",
  toshkent: "Tashkent",
  "toshkent shahri": "Tashkent City",
  xorazm: "Khorezm",
};

const PLACE_NAMES: Record<string, string> = {
  boyovut: "Boyovut",
  boevut: "Boyovut",
  "bo'evut": "Boyovut",
  guliston: "Gulistan",
  xovos: "Khavast",
  mirzaobod: "Mirzaabad",
  oqoltin: "Akaltyn",
  sardoba: "Sardoba",
  sayxunobod: "Saykhunabad",
  shirin: "Shirin",
  yangiyer: "Yangiyer",
};

function normalizePlaceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+viloyat(?:i)?$/i, "")
    .replace(/\s+tumani$/i, "")
    .trim();
}

function titleCase(value: string): string {
  return value.replace(/(^|[\s-])([a-z])/g, (_all, boundary: string, letter: string) =>
    `${boundary}${letter.toUpperCase()}`,
  );
}

function transliterateUzbekLatin(value: string): string {
  return titleCase(
    value
      .replace(/g['’‘`]/gi, (token) => token[0] === "G" ? "Gh" : "gh")
      .replace(/o['’‘`]/gi, (token) => token[0] === "O" ? "O" : "o")
      .replace(/x/g, "kh")
      .replace(/X/g, "Kh")
      .replace(/['’‘`´]/g, ""),
  );
}

export function translateUzbekPlaceToEnglish(
  value: string,
  _kind?: EnglishPlaceKind,
): string {
  const key = normalizePlaceKey(String(value || ""));
  if (!key) return "";
  const lookupKey = key.replace(/'/g, "");

  return REGION_NAMES[key] ||
    REGION_NAMES[lookupKey] ||
    PLACE_NAMES[key] ||
    PLACE_NAMES[lookupKey] ||
    transliterateUzbekLatin(key);
}
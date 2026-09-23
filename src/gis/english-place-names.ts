export type EnglishPlaceKind = "region" | "district";

const REGION_NAMES: Record<string, string> = {
  andijon: "Andijan",
  buxoro: "Bukhara",
  fargona: "Fergana",
  jizzax: "Jizzakh",
  namangan: "Namangan",
  navoiy: "Navoiy",
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
  qoqon: "Kokand",
  margilon: "Margilan",
  nukus: "Nukus",
  urganch: "Urgench",
  qarshi: "Karshi",
  termiz: "Termez",
  chirchiq: "Chirchiq",
  angren: "Angren",
  bekobod: "Bekabad",
  olmaliq: "Almalyk",
  zarafshon: "Zarafshan",
  denov: "Denov",
  kitob: "Kitab",
  shahrisabz: "Shakhrisabz",
  urgut: "Urgut",
  bulungur: "Bulungur",
  paxtakor: "Pakhtakor",
  zomin: "Zomin",
  gallaorol: "Gallaorol",
  quva: "Quva",
  rishton: "Rishton",
  oltiariq: "Oltiariq",
  bagdod: "Baghdad",
  uchkurgan: "Uchkurgan",
  chust: "Chust",
  pop: "Pop",
  koson: "Kasan",
  kasbi: "Kasbi",
  muborak: "Mubarek",
  nishon: "Nishan",
  qamashi: "Kamashi",
  yakkabog: "Yakkabag",
  shofirkon: "Shofirkon",
  gijduvon: "Gijduvan",
  romitan: "Romitan",
  qorako: "Karakul",
  yangiariq: "Yangiariq",
  xonqa: "Khonqa",
  bogot: "Bogot",
  hazorasp: "Khazarasp",
  ellikkala: "Ellikkala",
  beruniy: "Beruniy",
  chimboy: "Chimbay",
  kungrad: "Kungrad",
  moynoq: "Muynak",
  tortkol: "Turtkul",
  xojayli: "Khojayli",
  bostonliq: "Bostanlyk",
  boka: "Buka",
  oqqorgon: "Akkurgan",
  ortachirchiq: "Urtachirchiq",
  yuqorichirchiq: "Yukorichirchiq",
  quyichirchiq: "Kuyichirchiq",
  yangiyol: "Yangiyul",
  chinoz: "Chinaz",
  qibray: "Kibray",
  piskent: "Piskent",
  parkent: "Parkent",
  zangiota: "Zangiota",
  ohangaron: "Akhangaran",
  nurafshon: "Nurafshon",
  qorakol: "Karakul",
  xojaobod: "Khojaabad",
  qorgontepa: "Kurgontepa",
  oltinkol: "Oltinkol",
  sox: "Sokh",
  qoshtepa: "Kushtepa",
  uchkoprik: "Uchkoprik",
  dostlik: "Dustlik",
  mirzachol: "Mirzachul",
  toraqorgon: "Turakurgan",
  yangiqorgon: "Yangikurgan",
  shorchi: "Shurchi",
  jarqorgon: "Jarkurgan",
  qumqorgon: "Kumkurgan",
  qoshkopir: "Kushkupir",
  qongirot: "Kungrad",
  qoraozak: "Karauzyak",
};

function normalizePlaceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u02BF\u00B4\u0060\u02B9]/g, "'")
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
      .replace(/[\u0027\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u02BF\u00B4\u0060\u02B9]/g, "'")
      .replace(/g'/gi, (token) => (token[0] === "G" ? "Gh" : "gh"))
      .replace(/o'/gi, (token) => (token[0] === "O" ? "O" : "o"))
      .replace(/x/g, "kh")
      .replace(/X/g, "Kh")
      .replace(/'/g, ""),
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
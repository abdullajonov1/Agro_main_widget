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

/** Official Russian oblast names — do not build these with a "ская" suffix. */
const RU_OBLAST: Record<string, string> = {
  andijon: "Андижанская область",
  buxoro: "Бухарская область",
  fargona: "Ферганская область",
  jizzax: "Джизакская область",
  namangan: "Наманганская область",
  navoiy: "Навоийская область",
  qashqadaryo: "Кашкадарьинская область",
  samarqand: "Самаркандская область",
  sirdaryo: "Сырдарьинская область",
  surxondaryo: "Сурхандарьинская область",
  toshkent: "Ташкентская область",
  xorazm: "Хорезмская область",
};

/**
 * Official Russian district names.
 * Keys are apostrophe-free, space-free Uzbek Latin (Bo'stonliq → bostonliq).
 */
const RU_DISTRICT: Record<string, string> = {
  // Andijon
  andijon: "Андижанский район",
  asaka: "Асакинский район",
  baliqchi: "Балыкчинский район",
  boston: "Бустонский район",
  buloqboshi: "Булакбашинский район",
  izboskan: "Избасканский район",
  jalaquduq: "Джалалкудукский район",
  jalolquduq: "Джалалкудукский район",
  xojaobod: "Ходжаабадский район",
  qorgontepa: "Кургантепинский район",
  marhamat: "Мархаматский район",
  oltinkol: "Алтынкульский район",
  paxtaobod: "Пахтаабадский район",
  shahrixon: "Шахриханский район",
  ulugnor: "Улугнорский район",
  // Buxoro
  buxoro: "Бухарский район",
  gijduvon: "Гиждуванский район",
  jondor: "Жондорский район",
  kogon: "Каганский район",
  qorakol: "Каракульский район",
  qorakul: "Каракульский район",
  qorovulbozor: "Караулбазарский район",
  olot: "Алатский район",
  peshku: "Пешкунский район",
  romitan: "Ромитанский район",
  shofirkon: "Шафирканский район",
  vobkent: "Вабкентский район",
  // Farg'ona
  oltiariq: "Алтыарыкский район",
  bagdod: "Багдадский район",
  beshariq: "Бешарыкский район",
  buvayda: "Бувайдинский район",
  dangara: "Дангаринский район",
  fargona: "Ферганский район",
  furqat: "Фуркатский район",
  qoshtepa: "Куштепинский район",
  quva: "Кувинский район",
  rishton: "Риштанский район",
  sox: "Сохский район",
  toshloq: "Ташлакский район",
  uchkoprik: "Учкуприкский район",
  ozbekiston: "Узбекистанский район",
  yozyovon: "Язъяванский район",
  // Jizzax
  arnasoy: "Арнасайский район",
  baxmal: "Бахмальский район",
  dostlik: "Дустликский район",
  forish: "Фаришский район",
  gallaorol: "Галляаральский район",
  sharofrashidov: "Шараф-Рашидовский район",
  mirzachol: "Мирзачульский район",
  paxtakor: "Пахтакорский район",
  yangiobod: "Янгиабадский район",
  zomin: "Зааминский район",
  zafarobod: "Зафарабадский район",
  zarbdor: "Зарбдарский район",
  jizzax: "Джизакский район",
  // Namangan
  chortoq: "Чартакский район",
  chust: "Чустский район",
  kosonsoy: "Касансайский район",
  mingbuloq: "Мингбулакский район",
  namangan: "Наманганский район",
  norin: "Нарынский район",
  pop: "Папский район",
  toraqorgon: "Туракурганский район",
  uchqorgon: "Учкурганский район",
  uchkurgan: "Учкурганский район",
  uychi: "Уйчинский район",
  yangiqorgon: "Янгикурганский район",
  davlatobod: "Давлатабадский район",
  // Navoiy
  karmana: "Карманинский район",
  konimex: "Канимехский район",
  navbahor: "Навбахорский район",
  nurota: "Нуратинский район",
  qiziltepa: "Кызылтепинский район",
  tomdi: "Тамдынский район",
  uchquduq: "Учкудукский район",
  xatirchi: "Хатырчинский район",
  // Qashqadaryo
  chiroqchi: "Чиракчинский район",
  dehqonobod: "Дехканабадский район",
  guzor: "Гузарский район",
  kasbi: "Касбинский район",
  kitob: "Китабский район",
  koson: "Касанский район",
  mirishkor: "Миришкорский район",
  muborak: "Мубарекский район",
  nishon: "Нишанский район",
  qamashi: "Камашинский район",
  qarshi: "Каршинский район",
  shahrisabz: "Шахрисабзский район",
  yakkabog: "Яккабагский район",
  kokdala: "Кукдалинский район",
  // Samarqand
  bulungur: "Булунгурский район",
  ishtixon: "Иштыханский район",
  jomboy: "Джамбайский район",
  kattaqorgon: "Каттакурганский район",
  narpay: "Нарпайский район",
  nurobod: "Нурабадский район",
  oqdaryo: "Акдарьинский район",
  paxtachi: "Пахтачийский район",
  payariq: "Пайарыкский район",
  pastdargom: "Пастдаргомский район",
  qoshrabot: "Кушрабадский район",
  samarqand: "Самаркандский район",
  toyloq: "Тайлякский район",
  urgut: "Ургутский район",
  // Sirdaryo
  boyovut: "Баяутский район",
  boevut: "Баяутский район",
  guliston: "Гулистанский район",
  xovos: "Хавастский район",
  mirzaobod: "Мирзаабадский район",
  oqoltin: "Акалтынский район",
  sardoba: "Сардобинский район",
  sayxunobod: "Сайхунабадский район",
  sirdaryo: "Сырдарьинский район",
  // Surxondaryo
  angor: "Ангорский район",
  bandixon: "Бандиханский район",
  boysun: "Байсунский район",
  denov: "Денауский район",
  jarqorgon: "Джаркурганский район",
  qiziriq: "Кизирикский район",
  qumqorgon: "Кумкурганский район",
  muzrabot: "Музрабадский район",
  oltinsoy: "Алтынсайский район",
  sariosiyo: "Сариасийский район",
  sherobod: "Шерабадский район",
  shorchi: "Шурчинский район",
  termiz: "Термезский район",
  uzun: "Узунский район",
  // Toshkent
  bekobod: "Бекабадский район",
  boka: "Букинский район",
  bostonliq: "Бостанлыкский район",
  chinoz: "Чиназский район",
  qibray: "Кибрайский район",
  ohangaron: "Ахангаранский район",
  oqqorgon: "Аккурганский район",
  ortachirchiq: "Уртачирчикский район",
  parkent: "Паркентский район",
  piskent: "Пскентский район",
  quyichirchiq: "Куйичирчикский район",
  yangiyol: "Янгиюльский район",
  yuqorichirchiq: "Юкоричирчикский район",
  zangiota: "Зангиатинский район",
  toshkent: "Ташкентский район",
  // Xorazm
  bogot: "Багатский район",
  gurlan: "Гурленский район",
  xonqa: "Ханкинский район",
  hazorasp: "Хазараспский район",
  xiva: "Хивинский район",
  qoshkopir: "Кушкупирский район",
  shovot: "Шаватский район",
  urganch: "Ургенчский район",
  yangiariq: "Янгиарыкский район",
  yangibozor: "Янгибазарский район",
  tuproqqala: "Тупроккалинский район",
  // Qoraqalpog'iston
  amudaryo: "Амударьинский район",
  beruniy: "Берунийский район",
  chimboy: "Чимбайский район",
  ellikqala: "Элликкалинский район",
  ellikkala: "Элликкалинский район",
  kegeyli: "Кегейлийский район",
  moynoq: "Муйнакский район",
  muynoq: "Муйнакский район",
  nukus: "Нукусский район",
  qanlikol: "Канлыкульский район",
  qongirot: "Кунградский район",
  kungrad: "Кунградский район",
  qoraozak: "Караузякский район",
  shumanay: "Шуманайский район",
  taxtakopir: "Тахтакупырский район",
  tortkol: "Турткульский район",
  turtkul: "Турткульский район",
  xojayli: "Ходжейлийский район",
  bozatov: "Бозатауский район",
  taxiatosh: "Тахиаташский район",
};

/** City names. Districts that share the stem stay in RU_DISTRICT. */
const RU_CITY: Record<string, string> = {
  andijon: "Андижан",
  asaka: "Асака",
  xonobod: "Ханабад",
  buxoro: "Бухара",
  kogon: "Каган",
  fargona: "Фергана",
  qoqon: "Коканд",
  margilon: "Маргилан",
  quvasoy: "Кувасай",
  jizzax: "Джизак",
  namangan: "Наманган",
  navoiy: "Навои",
  zarafshon: "Зарафшан",
  qarshi: "Карши",
  shahrisabz: "Шахрисабз",
  samarqand: "Самарканд",
  kattaqorgon: "Каттакурган",
  guliston: "Гулистан",
  shirin: "Ширин",
  yangiyer: "Янгиер",
  termiz: "Термез",
  denov: "Денау",
  urganch: "Ургенч",
  xiva: "Хива",
  nukus: "Нукус",
  toshkent: "Ташкент",
  chirchiq: "Чирчик",
  angren: "Ангрен",
  olmaliq: "Алмалык",
  ohangaron: "Ахангаран",
  bekobod: "Бекабад",
  yangiyol: "Янгиюль",
  nurafshon: "Нурафшон",
};

/** Apostrophe-like marks from DB, Excel and keyboards, including U+2018. */
const APOSTROPHE_CLASS =
  /[\u0027\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u02BF\u00B4\u0060\u02B9\u02C8\u02CA\u02CB]/g;

function foldApostrophes(value: string): string {
  return value.replace(APOSTROPHE_CLASS, "'");
}

function placeBaseKey(latin: string): string {
  return foldApostrophes(latin)
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+viloyat(?:i)?$/i, "")
    .replace(/\s+tumani$/i, "")
    .replace(/\s+respublikasi$/i, "")
    .replace(/\s+shahri$/i, "")
    .trim()
    .replace(/\s+/g, "");
}

/** Uzbek Latin → Russian letters for names that are not in the gazetteer. */
function transliterateUzbekToRussian(value: string): string {
  const src = foldApostrophes(value);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2).toLowerCase();
    const pair: Record<string, string> = {
      "g'": "г",
      "o'": "у",
      sh: "ш",
      ch: "ч",
      yo: "ё",
      yu: "ю",
      ya: "я",
      ng: "нг",
    };
    if (pair[two]) {
      const token = pair[two];
      out += src[i] === src[i].toUpperCase() ? token[0].toUpperCase() + token.slice(1) : token;
      i += 2;
      continue;
    }
    const ch = src[i];
    const lower = ch.toLowerCase();
    const one: Record<string, string> = {
      a: "а", b: "б", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и",
      j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к",
      r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "й", z: "з", "'": "",
    };
    const mapped = one[lower];
    if (mapped == null) out += ch;
    else out += ch === ch.toUpperCase() && ch !== ch.toLowerCase()
      ? mapped.toUpperCase()
      : mapped;
    i += 1;
  }
  return out.replace(/'/g, "").replace(/\s+/g, " ").trim();
}

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
  const folded = foldApostrophes(text);
  const lower = folded.toLowerCase();
  let out = "";
  let i = 0;
  while (i < folded.length) {
    const threeLower = lower.slice(i, i + 3);
    if (threeLower === "yo'") {
      out += folded[i] === "Y" ? "Йў" : "йў";
      i += 3;
      continue;
    }
    const two = folded.slice(i, i + 2);
    const twoLower = lower.slice(i, i + 2);
    const mappedTwo =
      UZ_LATIN_TO_CYRILLIC[two] ?? UZ_LATIN_TO_CYRILLIC[twoLower];
    if (two.length === 2 && mappedTwo) {
      out += mappedTwo;
      i += 2;
      continue;
    }
    const c = folded[i];
    const cLower = lower[i];
    out += UZ_LATIN_TO_CYRILLIC[c] ?? UZ_LATIN_TO_CYRILLIC[cLower] ?? c;
    i += 1;
  }
  return out.replace(APOSTROPHE_CLASS, "");
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

  const latin = foldApostrophes(uzCyrillicToLatin(str));
  const qqKey = placeBaseKey(latin);

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

  const suffixCity = /\s+shahri$/i.test(latin);
  const suffixRegion = /\s+viloyat(?:i)?$/i.test(latin);
  const suffixDistrict = /\s+tumani$/i.test(latin);
  const isCity = suffixCity;
  const isRegion =
    suffixRegion || (!suffixDistrict && !suffixCity && placeKind === "region");
  const isDistrict =
    suffixDistrict || (!suffixRegion && !suffixCity && placeKind === "district");

  if (language === "en") {
    const en = translateUzbekPlaceToEnglish(latin, placeKind);
    if (isRegion && !/region|republic/i.test(en)) return `${en} Region`;
    if (isDistrict && !/district/i.test(en)) return `${en} District`;
    if (isCity && !/\bcity\b/i.test(en)) return `${en} City`;
    return en;
  }

  const baseKey = placeBaseKey(latin);
  if (isRegion && RU_OBLAST[baseKey]) return RU_OBLAST[baseKey];
  if (isCity && RU_CITY[baseKey]) {
    const city = RU_CITY[baseKey];
    return /^город\b/i.test(city) ? city : `город ${city}`;
  }
  if (isDistrict && RU_DISTRICT[baseKey]) {
    const district = RU_DISTRICT[baseKey];
    if (/район$/i.test(district) || /^город\b/i.test(district)) return district;
    return `${district}ский район`;
  }
  if (isDistrict && RU_CITY[baseKey]) {
    const city = RU_CITY[baseKey];
    return /^город\b/i.test(city) ? city : `город ${city}`;
  }
  const stem = transliterateUzbekToRussian(
    latin
      .replace(/\s+viloyat(?:i)?$/i, "")
      .replace(/\s+tumani$/i, "")
      .replace(/\s+shahri$/i, "")
      .replace(/\s+respublikasi$/i, ""),
  );
  if (isCity) return `город ${stem}`;
  if (isRegion) return `${stem}ская область`;
  if (isDistrict) return `${stem}ский район`;
  return stem;
}

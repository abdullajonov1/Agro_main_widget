/**
 * Pure field helpers for PopupPanel (no React / map side effects).
 */

export type PopupFieldLang = "uz_lat" | "uz_cyr" | "ru" | "en";

type FieldLabel = Record<PopupFieldLang, string>;

const label = (
  uz_lat: string,
  uz_cyr: string,
  ru: string,
  en: string,
): FieldLabel => ({ uz_lat, uz_cyr, ru, en });

/**
 * Every Agri popup attribute, including ones not currently checked in Builder.
 * Popup display only — the settings list keeps the service field name.
 */
const POPUP_FIELD_LABELS: Record<string, FieldLabel> = {
  crop_id: label("Ekin kodi", "Экин коди", "Код культуры", "Crop ID"),
  crop: label("Ekin turi", "Экин тури", "Тип культуры", "Crop type"),
  f_cad: label("Kadastr raqami", "Кадастр рақами", "Кадастровый номер", "Cadastral number"),
  f_card: label("Kadastr raqami", "Кадастр рақами", "Кадастровый номер", "Cadastral number"),
  f_inn: label("STIR", "СТИР", "ИНН", "TIN"),
  f_name: label("Fermer nomi", "Фермер номи", "Название фермера", "Farmer name"),
  full_name: label("To'liq nom", "Тўлиқ ном", "Полное имя", "Full name"),
  real_name: label("Fermer nomi", "Фермер номи", "Название фермера", "Farmer name"),
  globalid: label("Global ID", "Глобал ID", "Глобальный ID", "Global ID"),
  globalid_1: label("Global ID", "Глобал ID", "Глобальный ID", "Global ID"),
  uniqueid: label("Unique ID", "Unique ID", "Уникальный ID", "Unique ID"),
  numeric_id: label("Raqamli ID", "Рақамли ID", "Числовой ID", "Numeric ID"),
  objectid: label("Object ID", "Object ID", "Object ID", "Object ID"),
  fid: label("Object ID", "Object ID", "Object ID", "Object ID"),
  maydon: label("Maydon (ga)", "Майдон (га)", "Площадь (га)", "Area (ha)"),
  shape_area: label("Maydon (ga)", "Майдон (га)", "Площадь (га)", "Area (ha)"),
  shape__area: label("Maydon (ga)", "Майдон (га)", "Площадь (га)", "Area (ha)"),
  "st_area(shape)": label("Maydon (ga)", "Майдон (га)", "Площадь (га)", "Area (ha)"),
  shape_length: label("Chegara uzunligi", "Чегара узунлиги", "Длина границы", "Boundary length"),
  shape_leng: label("Chegara uzunligi", "Чегара узунлиги", "Длина границы", "Boundary length"),
  "st_length(shape)": label("Chegara uzunligi", "Чегара узунлиги", "Длина границы", "Boundary length"),
  tuman: label("Tuman", "Туман", "Район", "District"),
  viloyat: label("Viloyat", "Вилоят", "Область", "Region"),
  region: label("Viloyat kodi", "Вилоят коди", "Код области", "Region code"),
  region_id: label("Viloyat kodi", "Вилоят коди", "Код области", "Region code"),
  district: label("Tuman kodi", "Туман коди", "Код района", "District code"),
  district_id: label("Tuman kodi", "Туман коди", "Код района", "District code"),
  distrct_id: label("Tuman kodi", "Туман коди", "Код района", "District code"),
  turi: label("Ekin turi", "Экин тури", "Тип культуры", "Crop type"),
  uzspace: label("Ekin turi", "Экин тури", "Тип культуры", "Crop type"),
  vh: label("Vegetativ holat", "Вегетатив ҳолат", "Состояние вегетации", "Vegetation status"),
  ndvi_status: label("Vegetativ holat", "Вегетатив ҳолат", "Состояние вегетации", "Vegetation status"),
  yil: label("Yil", "Йил", "Год", "Year"),
  year: label("Yil", "Йил", "Год", "Year"),
  yld: label("Hosildorlik, s/ga", "Ҳосилдорлик, с/га", "Урожайность, ц/га", "Yield, c/ha"),
  year1: label("1-yil", "1-йил", "Год 1", "Year 1"),
  year2: label("2-yil", "2-йил", "Год 2", "Year 2"),
  year3: label("3-yil", "3-йил", "Год 3", "Year 3"),
  mavsum: label("Mavsum", "Мавсум", "Сезон", "Season"),
  season_id: label("Mavsum kodi", "Мавсум коди", "Код сезона", "Season code"),
  yer_turi: label("Yer turi", "Ер тури", "Тип земли", "Land type"),
  type: label("Tur", "Тур", "Тип", "Type"),
  type_id: label("Tur kodi", "Тур коди", "Код типа", "Type code"),
};

export function localizedPopupFieldLabel(
  fieldName: string,
  language: PopupFieldLang,
): string | null {
  const key = String(fieldName || "")
    .trim()
    .toLowerCase();
  const entry = POPUP_FIELD_LABELS[key];
  if (!entry) return null;
  return entry[language] || entry.uz_lat;
}

const VH_VALUE_LABELS: Array<{ test: RegExp; label: FieldLabel }> = [
  {
    test: /juda\s*yaxshi/,
    label: label("Juda yaxshi", "Жуда яхши", "Очень хороший", "Excellent"),
  },
  {
    test: /yaxshi/,
    label: label("Yaxshi", "Яхши", "Хороший", "Good"),
  },
  {
    test: /o'?rta|orta|ўрта/,
    label: label("O'rta", "Ўрта", "Средний", "Moderate"),
  },
  {
    test: /past|паст/,
    label: label("Past", "Паст", "Низкий", "Poor"),
  },
];

/** Vegetation-status cell text. Other values stay unchanged. */
export function localizedPopupVhValue(
  raw: unknown,
  language: PopupFieldLang,
): string | null {
  const text = String(raw ?? "")
    .trim()
    .replace(/^\d+\s*[-–]\s*/, "")
    .toLowerCase()
    .replace(/[ʻʼ’‘´`]/g, "'");
  if (!text) return null;
  const hit = VH_VALUE_LABELS.find((row) => row.test.test(text));
  if (!hit) return null;
  return hit.label[language] || hit.label.uz_lat;
}

export function normalizeFieldAlias(field: any, fallbackName: string): string {
  const name = String(field?.name || fallbackName || "").trim();
  const alias = String(
    field?.alias || field?.displayName || field?.label || "",
  ).trim();
  if (!alias) return name;
  return alias;
}

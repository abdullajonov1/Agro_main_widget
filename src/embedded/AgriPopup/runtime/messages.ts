export type LangCode = "uz_lat" | "uz_cyr" | "ru" | "en";

type Dict = Record<string, string>;
type Bundle = Record<LangCode, Dict>;

const MESSAGES: Bundle = {
  uz_lat: {
    "title.default": "Poligon ma'lumoti",
    "title.attributes": "Atribut ma'lumotlari",
    "title.record": "Ma'lumot #{{id}}",
    "action.pin": "Popupni yuqori-o'ngga qadash",
    "action.unpin": "Popupni yechish",
    "status.warning": "Ogohlantirish",
    "status.loadingFeature": "Obyekt ma'lumotlari yuklanmoqda...",
    "status.noConfiguredData": "Sozlangan maydonlar uchun ma'lumot topilmadi",
    "status.noFields":
      "Maydonlar sozlanmagan. Vidjet sozlamalarida maydonlarni tanlang.",
    "attachments.title": "Rasmlar va fayllar",
    "status.loadingAttachments": "Qo'shimchalar yuklanmoqda...",
    "status.noAttachments": "Qo'shimchalar yo'q",
    "attachment.imageFallback": "Rasm",
    "attachment.fileFallback": "fayl-{{id}}",
    "attachment.download": "Yuklab olish",
    "status.clickPolygon":
      "Tafsilotlarni ko'rish uchun xaritada poligonni bosing",
    "status.ready": "Polygon Inspector tayyor",
    "status.loading": "Yuklanmoqda...",
    "error.noMapView": "Xarita ko'rinishi topilmadi",
    "error.noLayersSelected":
      "Qatlam tanlanmagan. Sozlamalarda kamida bitta Feature Layer tanlang.",
    "error.selectedLayersMissing":
      "Tanlangan qatlamlar xaritada topilmadi. Tanlangan Map vidjet ichida shu qatlamlar borligini tekshiring.",
    "error.objectIdFieldMissing":
      "Bosilgan qatlamda ObjectId maydoni topilmadi.",
    "error.objectIdMissing": "ObjectId topilmadi. Kutilgan maydon: {{field}}",
    "error.featureByObjectIdMissing": "ObjectId bo'yicha obyekt topilmadi.",
    "error.configuredFieldMissing":
      "Ba'zi sozlangan maydonlar topilmadi: {{fields}}",
    "error.noDataForConfiguredFields":
      "Sozlangan maydonlar uchun ma'lumot mavjud emas",
    "error.unexpected": "Kutilmagan xato: {{message}}",
    "indices.title": "Vegetatsiya indekslari",
    "indices.loading": "Indekslar yuklanmoqda...",
    "indices.none": "Bu poligon uchun indeks ma'lumoti yo'q",
  },
  uz_cyr: {
    "title.attributes": "Атрибут маълумотлари",
    "title.default": "Полигон маълумоти",
    "title.record": "Маълумот #{{id}}",
    "action.pin": "Попапни юқори-ўнгга қадаш",
    "action.unpin": "Попапни ечиш",
    "status.warning": "Огоҳлантириш",
    "status.loadingFeature": "Объект маълумотлари юкланмоқда...",
    "status.noConfiguredData": "Созланган майдонлар учун маълумот топилмади",
    "status.noFields":
      "Майдонлар созланмаган. Виджет созламаларида майдонларни танланг.",
    "attachments.title": "Расмлар ва файллар",
    "status.loadingAttachments": "Қўшимчалар юкланмоқда...",
    "status.noAttachments": "Қўшимчалар йўқ",
    "attachment.imageFallback": "Расм",
    "attachment.fileFallback": "файл-{{id}}",
    "attachment.download": "Юклаб олиш",
    "status.clickPolygon": "Тафсилотларни кўриш учун харитада полигонни босинг",
    "status.ready": "Polygon Inspector тайёр",
    "status.loading": "Юкланмоқда...",
    "error.noMapView": "Харита кўриниши топилмади",
    "error.noLayersSelected":
      "Қатлам танланмаган. Созламаларда камида битта Feature Layer танланг.",
    "error.selectedLayersMissing":
      "Танланган қатламлар харитада топилмади. Танланган Map виджет ичида шу қатламлар борлигини текширинг.",
    "error.objectIdFieldMissing":
      "Босилган қатламда ObjectId майдони топилмади.",
    "error.objectIdMissing": "ObjectId топилмади. Кутилган майдон: {{field}}",
    "error.featureByObjectIdMissing": "ObjectId бўйича объект топилмади.",
    "error.configuredFieldMissing":
      "Баъзи созланган майдонлар топилмади: {{fields}}",
    "error.noDataForConfiguredFields":
      "Созланган майдонлар учун маълумот мавжуд эмас",
    "error.unexpected": "Кутилмаган хато: {{message}}",
    "indices.title": "Вегетация индекслари",
    "indices.loading": "Индекслар юкланмоқда...",
    "indices.none": "Бу полигон учун индекс маълумоти йўқ",
  },
  ru: {
    "title.attributes": "Атрибутивные данные",
    "title.default": "Информация о полигоне",
    "title.record": "Запись #{{id}}",
    "action.pin": "Закрепить окно справа сверху",
    "action.unpin": "Открепить окно",
    "status.warning": "Предупреждение",
    "status.loadingFeature": "Загрузка данных объекта...",
    "status.noConfiguredData": "Нет данных для настроенных полей",
    "status.noFields": "Поля не настроены. Выберите поля в настройках виджета.",
    "attachments.title": "Изображения и файлы",
    "status.loadingAttachments": "Загрузка вложений...",
    "status.noAttachments": "Нет вложений",
    "attachment.imageFallback": "Изображение",
    "attachment.fileFallback": "файл-{{id}}",
    "attachment.download": "Скачать",
    "status.clickPolygon": "Нажмите на полигон на карте, чтобы увидеть детали",
    "status.ready": "Polygon Inspector готов",
    "status.loading": "Загрузка...",
    "error.noMapView": "Вид карты не найден",
    "error.noLayersSelected":
      "Слои не выбраны. В настройках выберите минимум один Feature Layer.",
    "error.selectedLayersMissing":
      "Выбранные слои не найдены на карте. Проверьте, что они есть в выбранном Map виджете.",
    "error.objectIdFieldMissing": "В выбранном слое не найдено поле ObjectId.",
    "error.objectIdMissing": "ObjectId не найден. Ожидаемое поле: {{field}}",
    "error.featureByObjectIdMissing": "Объект по ObjectId не найден.",
    "error.configuredFieldMissing":
      "Некоторые настроенные поля не найдены: {{fields}}",
    "error.noDataForConfiguredFields": "Нет данных для настроенных полей",
    "error.unexpected": "Непредвиденная ошибка: {{message}}",
    "indices.title": "Индексы вегетации",
    "indices.loading": "Загрузка индексов...",
    "indices.none": "Нет данных по индексам для этого полигона",
  },
  en: {
    "title.attributes": "Attribute data",
    "title.default": "Polygon info",
    "title.record": "Record #{{id}}",
    "action.pin": "Pin popup to top-right",
    "action.unpin": "Unpin popup",
    "status.warning": "Warning",
    "status.loadingFeature": "Loading feature data...",
    "status.noConfiguredData": "No data available for configured fields",
    "status.noFields":
      "No fields configured. Please configure fields in widget settings.",
    "attachments.title": "Images & Files",
    "status.loadingAttachments": "Loading attachments...",
    "status.noAttachments": "No attachments",
    "attachment.imageFallback": "Image",
    "attachment.fileFallback": "attachment-{{id}}",
    "attachment.download": "Download",
    "status.clickPolygon": "Click a polygon on the map to see its details",
    "status.ready": "Polygon Inspector Ready",
    "status.loading": "Loading...",
    "error.noMapView": "No map view provided",
    "error.noLayersSelected":
      "No layers selected. Please select one or more Feature Layers in Settings.",
    "error.selectedLayersMissing":
      "None of the selected layers were found on the map. Ensure the chosen layers exist in the selected Map widget.",
    "error.objectIdFieldMissing": "ObjectId field not found for clicked layer.",
    "error.objectIdMissing": "ObjectId not found. Expected field: {{field}}",
    "error.featureByObjectIdMissing": "Feature not found by ObjectId.",
    "error.configuredFieldMissing":
      "Some configured fields not found: {{fields}}",
    "error.noDataForConfiguredFields":
      "No data available for configured fields",
    "error.unexpected": "Unexpected error: {{message}}",
    "indices.title": "Vegetation indices",
    "indices.loading": "Loading indices...",
    "indices.none": "No index data for this polygon",
  },
};

export function normalizeLang(input: any): LangCode {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase();

  if (raw === "en" || raw === "eng" || raw === "english") return "en";
  if (raw === "ru" || raw === "rus" || raw === "russian") return "ru";

  if (
    raw === "uz_cyr" ||
    raw === "uz-cyr" ||
    raw === "uz_cyrl" ||
    raw === "uz-cyrl" ||
    raw === "uzcyrl" ||
    raw === "uz_cyrillic" ||
    raw === "uz-cyrillic" ||
    raw === "cyrillic"
  ) {
    return "uz_cyr";
  }

  if (
    raw === "uz_lat" ||
    raw === "uz-lat" ||
    raw === "uzlatin" ||
    raw === "uz-latin" ||
    raw === "uz"
  ) {
    return "uz_lat";
  }

  return "uz_lat";
}

export function getInitialLang(): LangCode {
  return normalizeLang(
    localStorage.getItem("evapo_app_lang") ||
      localStorage.getItem("app_lang") ||
      "uz_lat",
  );
}

export function getInitialTheme(): boolean {
  const storedTheme = localStorage.getItem("agri_v11_app_theme");
  if (storedTheme === "dark") return true;
  if (storedTheme === "light") return false;
  const root = document.documentElement;
  const body = document.body;
  const isLight =
    storedTheme === "light" ||
    root.classList.contains("light-theme") ||
    body.classList.contains("light-theme") ||
    root.getAttribute("data-theme") === "light";
  return !isLight;
}

export function t(
  lang: LangCode,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = MESSAGES[lang] || MESSAGES.uz_lat;
  const fallback = MESSAGES.en[key] ?? key;
  const template = dict[key] ?? fallback;
  if (!params) return template;

  return Object.keys(params).reduce((result, paramKey) => {
    const value = String(params[paramKey] ?? "");
    return result.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, "g"), value);
  }, template);
}

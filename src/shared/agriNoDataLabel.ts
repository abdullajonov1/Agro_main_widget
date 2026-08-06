export type AgriUiLanguage = "uz_cyr" | "uz_lat" | "ru" | "en";

/** Single localized empty-state label used across Agri dashboard charts. */
export function agriNoDataLabel(language: AgriUiLanguage | string): string {
  switch (language) {
    case "en":
      return "No data found";
    case "ru":
      return "Данные не найдены";
    case "uz_cyr":
      return "Маълумот топилмади";
    case "uz_lat":
    default:
      return "Ma'lumot topilmadi";
  }
}

/**
 * Shared language + theme helpers for Agri dashboard panels.
 */

export type AgriLanguage = "uz_cyr" | "uz_lat" | "ru" | "en";

export const AGRI3_LANG_PREF_KEY_V3 = "agri3_lang_initialized_uz_lat_v3";

export function ensureAgri3UzLatLanguageDefault(): void {
  try {
    if (localStorage.getItem(AGRI3_LANG_PREF_KEY_V3) === "1") return;
    localStorage.setItem("app_lang", "uz_lat");
    localStorage.setItem("agro_lang", "uz_lat");
    localStorage.setItem(AGRI3_LANG_PREF_KEY_V3, "1");
  } catch {
    /* ignore storage errors */
  }
}

export function normalizeLanguage(raw?: string | null): AgriLanguage {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "en" || v === "english") return "en";
  if (v === "ru" || v === "russian") return "ru";
  if (v.startsWith("uz_cyr") || v.startsWith("uz-cyr")) return "uz_cyr";
  if (v.startsWith("uz_lat") || v.startsWith("uz-lat") || v === "uz") {
    return "uz_lat";
  }
  return "uz_lat";
}

/** Resolve dashboard language from URL / localStorage; default first-run = O'zbek (Lotin). */
export function resolveInitialLanguage(): AgriLanguage {
  try {
    ensureAgri3UzLatLanguageDefault();
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    const fromStorage =
      localStorage.getItem("app_lang") ||
      localStorage.getItem("agri_app_lang") ||
      localStorage.getItem("agro_lang");
    return normalizeLanguage(fromUrl || fromStorage);
  } catch {
    return "uz_lat";
  }
}

export function detectIsDarkTheme(): boolean {
  try {
    const saved = window.localStorage?.getItem("agri_v11_app_theme");
    if (saved === "light") return false;
    if (saved === "dark") return true;
    const dom = document.documentElement.getAttribute("data-theme");
    if (dom === "light") return false;
    if (dom === "dark") return true;
  } catch {
    /* ignore */
  }
  return true;
}

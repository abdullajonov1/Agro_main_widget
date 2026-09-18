/**
 * Language preference helpers for LocalizationPanel.
 * Re-exports shared panel helpers for backward compatibility.
 */

export {
  AGRI3_LANG_PREF_KEY_V3,
  ensureAgri3UzLatLanguageDefault,
  normalizeLanguage,
  resolveInitialLanguage,
  type AgriLanguage as AgriUiLanguage,
} from "../../shared/agri-language";

import {
  ensureAgri3UzLatLanguageDefault,
  normalizeLanguage,
  type AgriLanguage,
} from "../../shared/agri-language";

/** Align with Bar/Region/Popup localStorage; default first-run = O'zbek (Lotin). */
export function resolveStoredAgriLanguage(): AgriLanguage {
  try {
    ensureAgri3UzLatLanguageDefault();
    const raw =
      localStorage.getItem("agri_app_lang") ||
      localStorage.getItem("app_lang") ||
      localStorage.getItem("agro_lang") ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("lang")
        : null) ||
      "";
    return normalizeLanguage(raw);
  } catch {
    return "uz_lat";
  }
}

/**
 * App background theme classes for LocalizationPanel (documentElement/body).
 */

export const APP_BG_DARK_CLASS = "agri-app-bg-dark";
export const APP_BG_LIGHT_CLASS = "agri-app-bg-light";

export function applyAppBackgroundTheme(theme: "dark" | "light"): void {
  try {
    const root = document.documentElement;
    const body = document.body;
    const nextClass = theme === "dark" ? APP_BG_DARK_CLASS : APP_BG_LIGHT_CLASS;

    if (root.classList.contains(nextClass) && body.classList.contains(nextClass)) {
      return;
    }

    root.classList.remove(APP_BG_DARK_CLASS, APP_BG_LIGHT_CLASS);
    body.classList.remove(APP_BG_DARK_CLASS, APP_BG_LIGHT_CLASS);

    root.classList.add(nextClass);
    body.classList.add(nextClass);
  } catch {
    // DOM might be unavailable in some environments
  }
}

/**
 * Pure field helpers for PopupPanel (no React / map side effects).
 */

export function normalizeFieldAlias(field: any, fallbackName: string): string {
  const name = String(field?.name || fallbackName || "").trim();
  const alias = String(
    field?.alias || field?.displayName || field?.label || "",
  ).trim();
  if (!alias) return name;
  return alias;
}

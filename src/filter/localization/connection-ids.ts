/**
 * Tiny string helpers for Localization connection / DS id matching.
 */

/** Normalize widget/dataSource ids for loose equality (alnum only). */
export function normalizeConnectionId(s?: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Geography key helpers for LocalizationPanel.
 * Apostrophe normalization matches data/agri-sql (incl. U+2018 Yakkabog‘),
 * plus trailing trim used by Localization dictionaries.
 */
import { normalizeApos as normalizeAposSql } from "../../data/agri-sql";

/**
 * NFKC + unify apostrophes + trim.
 */
export function normalizeLocalizationApos(s: string): string {
  return normalizeAposSql(s).trim();
}

/** Canonicalize viloyat/tuman keys for region/district dictionaries. */
export function makeRegionDistrictKey(
  raw: string | null | undefined,
): string {
  if (raw == null) return "";
  const s = normalizeLocalizationApos(String(raw)).trim().toLowerCase();
  return s;
}

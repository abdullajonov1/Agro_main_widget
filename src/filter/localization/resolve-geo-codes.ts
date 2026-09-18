/**
 * Pure region/district number resolution for Localization VH / map scope.
 * Lookup uses makeRegionDistrictKey(raw) — same as historical Localization.
 *
 * District lookup is viloyat-scoped: bare tuman→district maps collide when
 * the same district name exists in multiple regions (Qamashi → wrong rows).
 */
export type GeoCodeHelpers = {
  normalizeApos: (s: string) => string;
  makeRegionDistrictKey: (raw: string | null | undefined) => string;
};

export function resolveRegionNumberFromMaps(
  rawViloyat: string,
  viloyatToRegion: Record<string, number>,
  helpers: GeoCodeHelpers,
): number | undefined {
  const effectiveViloyat = helpers.normalizeApos(String(rawViloyat || ""));
  if (!effectiveViloyat) return undefined;

  if (/^\d+$/.test(effectiveViloyat)) {
    const n = Number(effectiveViloyat);
    return Number.isFinite(n) ? n : undefined;
  }

  const regionKey = helpers.makeRegionDistrictKey(rawViloyat);
  const regionNum = regionKey ? viloyatToRegion[regionKey] : undefined;
  if (regionNum === undefined || !Number.isFinite(regionNum)) return undefined;
  return regionNum;
}

/**
 * Build scoped keys used in `_tumanToDistrict` maps.
 * Prefer `region:N|tuman` then `viloyat:name|tuman`; bare tuman is legacy only.
 */
export function buildDistrictLookupKeys(
  rawViloyat: string,
  rawTuman: string,
  viloyatToRegion: Record<string, number>,
  helpers: GeoCodeHelpers,
): string[] {
  const effectiveTuman = helpers.normalizeApos(String(rawTuman || ""));
  if (!effectiveTuman) return [];
  const tumanKey = helpers.makeRegionDistrictKey(rawTuman);
  if (!tumanKey) return [];

  const keys: string[] = [];
  const regionNum = resolveRegionNumberFromMaps(
    rawViloyat,
    viloyatToRegion,
    helpers,
  );
  if (regionNum !== undefined && Number.isFinite(regionNum)) {
    keys.push(`region:${regionNum}|${tumanKey}`);
  }
  const viloyatKey = helpers.makeRegionDistrictKey(rawViloyat);
  if (viloyatKey) {
    keys.push(`viloyat:${viloyatKey}|${tumanKey}`);
  }
  // Legacy bare-tuman key — last resort only (can collide across viloyats).
  keys.push(tumanKey);
  return keys;
}

/** Store one mapping row into viloyat→region / scoped tuman→district maps. */
export function storeScopedRegionDistrictMapping(
  viloyatRaw: string | null | undefined,
  regionRaw: unknown,
  tumanRaw: string | null | undefined,
  districtRaw: unknown,
  viloyatToRegion: Record<string, number>,
  tumanToDistrict: Record<string, number>,
  helpers: GeoCodeHelpers,
  opts?: {
    /** Feature count for this (tuman, district) pair — higher wins on conflict. */
    count?: number;
    /** Parallel map of the vote weight already stored per key. */
    tumanToDistrictVotes?: Record<string, number>;
  },
): void {
  const viloyatKey = helpers.makeRegionDistrictKey(
    viloyatRaw != null && viloyatRaw !== "" ? String(viloyatRaw) : null,
  );
  const region =
    regionRaw != null && regionRaw !== "" ? Number(regionRaw) : NaN;
  const tumanKey = helpers.makeRegionDistrictKey(
    tumanRaw != null && tumanRaw !== "" ? String(tumanRaw) : null,
  );
  const district =
    districtRaw != null && districtRaw !== "" ? Number(districtRaw) : NaN;
  const vote =
    opts?.count != null && Number.isFinite(opts.count) && opts.count > 0
      ? Number(opts.count)
      : 1;
  const votes = opts?.tumanToDistrictVotes;

  if (viloyatKey && Number.isFinite(region)) {
    viloyatToRegion[viloyatKey] = region;
  }
  if (!(tumanKey && Number.isFinite(district))) return;

  const put = (key: string) => {
    const prevVote = votes?.[key] ?? 0;
    // Agri_table sometimes attaches the wrong district code to a tuman name
    // (Qamashi rows tagged with Yakkabog' SOATO). Keep the code with the
    // most supporting rows so rare poison rows cannot win.
    if (tumanToDistrict[key] == null || vote > prevVote) {
      tumanToDistrict[key] = district;
      if (votes) votes[key] = vote;
    }
  };

  if (Number.isFinite(region)) {
    put(`region:${region}|${tumanKey}`);
  }
  if (viloyatKey) {
    put(`viloyat:${viloyatKey}|${tumanKey}`);
  }
}

export function resolveDistrictNumberFromMaps(
  rawTuman: string,
  tumanToDistrict: Record<string, number>,
  helpers: GeoCodeHelpers,
  opts?: {
    rawViloyat?: string;
    viloyatToRegion?: Record<string, number>;
  },
): number | undefined {
  const effectiveTuman = helpers.normalizeApos(String(rawTuman || ""));
  if (!effectiveTuman) return undefined;

  if (/^\d+$/.test(effectiveTuman)) {
    const n = Number(effectiveTuman);
    return Number.isFinite(n) ? n : undefined;
  }

  const rawViloyat = String(opts?.rawViloyat || "");
  const viloyatToRegion = opts?.viloyatToRegion || {};
  const keys = buildDistrictLookupKeys(
    rawViloyat,
    rawTuman,
    viloyatToRegion,
    helpers,
  );
  for (const key of keys) {
    const districtNum = tumanToDistrict[key];
    if (districtNum !== undefined && Number.isFinite(districtNum)) {
      return districtNum;
    }
  }
  return undefined;
}

/**
 * All tumans mapped under a viloyat/region — used to draw every district
 * border when only the region is selected (name WHERE on Hosted/district).
 */
export function listDistrictsForViloyat(
  rawViloyat: string,
  tumanToDistrict: Record<string, number>,
  viloyatToRegion: Record<string, number>,
  helpers: GeoCodeHelpers,
): { names: string[]; codes: number[] } {
  const names = new Set<string>();
  const codes = new Set<number>();
  const regionNum = resolveRegionNumberFromMaps(
    rawViloyat,
    viloyatToRegion,
    helpers,
  );
  const viloyatKey = helpers.makeRegionDistrictKey(rawViloyat);
  const prefixes: string[] = [];
  if (regionNum !== undefined && Number.isFinite(regionNum)) {
    prefixes.push(`region:${regionNum}|`);
  }
  if (viloyatKey) prefixes.push(`viloyat:${viloyatKey}|`);
  if (!prefixes.length) return { names: [], codes: [] };

  for (const [key, code] of Object.entries(tumanToDistrict || {})) {
    const prefix = prefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    const nameKey = key.slice(prefix.length).trim();
    if (nameKey) names.add(nameKey);
    if (Number.isFinite(code)) codes.add(Number(code));
  }
  return { names: Array.from(names), codes: Array.from(codes) };
}

/** True when a scoped (or legacy) district mapping exists for this selection. */
export function hasDistrictMappingForSelection(
  rawViloyat: string,
  rawTuman: string,
  tumanToDistrict: Record<string, number>,
  viloyatToRegion: Record<string, number>,
  helpers: GeoCodeHelpers,
): boolean {
  return (
    resolveDistrictNumberFromMaps(rawTuman, tumanToDistrict, helpers, {
      rawViloyat,
      viloyatToRegion,
    }) != null
  );
}

/** Cache key: status|date|region|district|sortedCropIds */
export function buildVhUniqueIdCacheKey(opts: {
  status: string;
  ndviDate: string;
  regionNum: number;
  districtNum?: number;
  cropIds: string[];
}): string {
  return [
    opts.status,
    opts.ndviDate,
    opts.regionNum,
    opts.districtNum ?? "",
    opts.cropIds.slice().sort().join(","),
  ].join("|");
}

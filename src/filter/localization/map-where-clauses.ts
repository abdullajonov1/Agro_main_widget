/**
 * Pure map / table WHERE fragments for LocalizationPanel.
 * Side-effect free — panel supplies maps, layers, and apostrophe helpers.
 */
import { escapeArcGIS, escapeLikeLiteral } from "../../data/agri-sql";
import { extractYearDigits } from "../../controller/agri-where-builder";
import { VH_TO_NDVI_STATUS } from "./vh-constants";

export type AposHelpers = {
  normalizeApos: (s: string) => string;
  makeRegionDistrictKey: (raw: string | null | undefined) => string;
  eqAposSmart: (field: string, raw: string) => string;
};

/** uniqueid equals with brace / bare / braced variants. */
export function buildUniqueIdSqlClause(
  raw: string,
  field = "uniqueid",
): string {
  const id = String(raw || "").trim();
  if (!id) return "";
  const core = id.replace(/[{}]/g, "");
  const variants = Array.from(new Set([id, core, `{${core}}`])).filter(
    Boolean,
  );
  const clauses = variants.map(
    (v) => `${field}='${escapeArcGIS(String(v))}'`,
  );
  return clauses.length > 1 ? `(${clauses.join(" OR ")})` : clauses[0] || "";
}

/**
 * Viloyat → region number from mapping, else text viloyat equals.
 * Numeric codes filter `region` directly.
 */
export function buildViloyatRegionSqlClause(
  rawViloyat: string,
  viloyatToRegion: Record<string, number>,
  helpers: AposHelpers,
): string {
  const effectiveViloyat = helpers.normalizeApos(rawViloyat);
  if (!effectiveViloyat) return "";

  if (/^\d+$/.test(effectiveViloyat)) {
    return `region = '${Number(effectiveViloyat)}'`;
  }

  const key = helpers.makeRegionDistrictKey(rawViloyat);
  const regionNum = key ? viloyatToRegion[key] : undefined;
  if (regionNum !== undefined && Number.isFinite(regionNum)) {
    return `region = '${regionNum}'`;
  }

  return helpers.eqAposSmart("viloyat", effectiveViloyat);
}

/**
 * Tuman → district number from mapping, else text tuman equals.
 * Prefer viloyat-scoped keys (`region:N|tuman` / `viloyat:name|tuman`) so
 * same-named districts in other regions do not steal the filter.
 */
export function buildTumanDistrictSqlClause(
  rawTuman: string,
  tumanToDistrict: Record<string, number>,
  helpers: AposHelpers,
  opts?: {
    rawViloyat?: string;
    viloyatToRegion?: Record<string, number>;
  },
): string {
  const effectiveTuman = helpers.normalizeApos(rawTuman);
  if (!effectiveTuman) return "";

  if (/^\d+$/.test(effectiveTuman)) {
    return `district = '${Number(effectiveTuman)}'`;
  }

  const rawViloyat = String(opts?.rawViloyat || "");
  const viloyatToRegion = opts?.viloyatToRegion || {};
  const tumanKey = helpers.makeRegionDistrictKey(rawTuman);
  const lookupKeys: string[] = [];
  if (tumanKey) {
    const regionKey = helpers.makeRegionDistrictKey(rawViloyat);
    const regionNum = /^\d+$/.test(helpers.normalizeApos(rawViloyat))
      ? Number(helpers.normalizeApos(rawViloyat))
      : regionKey
        ? viloyatToRegion[regionKey]
        : undefined;
    if (regionNum !== undefined && Number.isFinite(regionNum)) {
      lookupKeys.push(`region:${regionNum}|${tumanKey}`);
    }
    if (regionKey) lookupKeys.push(`viloyat:${regionKey}|${tumanKey}`);
    lookupKeys.push(tumanKey);
  }

  for (const key of lookupKeys) {
    const districtNum = tumanToDistrict[key];
    if (districtNum !== undefined && Number.isFinite(districtNum)) {
      return `district = '${districtNum}'`;
    }
  }

  return helpers.eqAposSmart("tuman", effectiveTuman);
}

export function resolveNdviStatusFieldName(
  ndviDate: string,
  prefix: string,
  dateFieldMap: Record<string, string>,
): string {
  const mapped = dateFieldMap[ndviDate];
  if (mapped) return mapped;
  const suffix = ndviDate.replace(/-/g, "_");
  return `${prefix}${suffix}`;
}

function layerHasFieldName(fields: any[] | undefined, fieldName: string): boolean {
  if (!fields?.length) return false;
  const needle = fieldName.toLowerCase();
  return fields.some(
    (f) => (f?.name || "").toString().toLowerCase() === needle,
  );
}

/** Example: status_2025_09_01 = 'yaxshi' */
export function buildNdviStatusEqualsSqlClause(opts: {
  ndviDate: string;
  vhCategory: string;
  prefix: string;
  dateFieldMap: Record<string, string>;
  layerFields: any[] | undefined;
}): string {
  const ndviDate = String(opts.ndviDate || "").trim();
  const vhCategory = String(opts.vhCategory || "").trim();
  if (!ndviDate || !vhCategory) return "";

  const statusTableValue = VH_TO_NDVI_STATUS[vhCategory];
  if (!statusTableValue) return "";

  const statusField = resolveNdviStatusFieldName(
    ndviDate,
    opts.prefix,
    opts.dateFieldMap,
  );
  if (!layerHasFieldName(opts.layerFields, statusField)) return "";

  return `${statusField} = '${escapeArcGIS(statusTableValue)}'`;
}

/** Example: status_2025_09_18 IS NOT NULL */
export function buildNdviDateNotNullSqlClause(opts: {
  ndviDate: string;
  prefix: string;
  dateFieldMap: Record<string, string>;
  layerFields: any[] | undefined;
}): string {
  const ndviDate = String(opts.ndviDate || "").trim();
  if (!ndviDate) return "";

  const statusField = resolveNdviStatusFieldName(
    ndviDate,
    opts.prefix,
    opts.dateFieldMap,
  );
  if (!layerHasFieldName(opts.layerFields, statusField)) return "";

  return `${statusField} IS NOT NULL`;
}

/**
 * Assemble Localization map/table WHERE from pre-built clause fragments.
 * Year / geography / crop / VH uniqueids / polygon selection stay resolved
 * by the panel; this only encodes join + hide rules.
 */
export function assembleLocalizationWhere(opts: {
  yearClause: string;
  includeViloyat: boolean;
  viloyatClause: string;
  /** When true, append tumanClause if non-empty. */
  includeTuman: boolean;
  tumanClause: string;
  includeTuri: boolean;
  cropClause: string;
  includeVh: boolean;
  vhCategory: string;
  /** null = still resolving; string[] = ready (may be empty → 1=0 via join). */
  vhUniqueIds: string[] | null;
  uniqueIdClause: string;
  /** Exact STIR from header search (`f_inn='…'`). */
  farmerInnClause?: string;
  buildSpatialJoinWhere: (ids: string[]) => string;
  withAccessWhere: (where: string) => string;
}): string {
  if (!opts.yearClause || opts.yearClause === "1=0") return "1=0";

  const clauses: string[] = [opts.yearClause];

  if (opts.includeViloyat) {
    if (!opts.viloyatClause) return "1=0";
    clauses.push(opts.viloyatClause);
  }

  if (opts.includeTuman && opts.tumanClause) {
    clauses.push(opts.tumanClause);
  }

  if (opts.includeTuri && opts.cropClause) {
    clauses.push(opts.cropClause);
  }

  if (opts.farmerInnClause) {
    clauses.push(opts.farmerInnClause);
  }

  if (opts.includeVh && opts.vhCategory) {
    if (Array.isArray(opts.vhUniqueIds)) {
      clauses.push(opts.buildSpatialJoinWhere(opts.vhUniqueIds));
    } else {
      return "1=0";
    }
  }

  if (opts.uniqueIdClause) {
    clauses.push(opts.uniqueIdClause);
  }

  const result = clauses.length ? clauses.join(" AND ") : "1=0";
  return opts.withAccessWhere(result);
}

/**
 * Layer-aware `yil` clause (numeric vs string field type).
 * Matches previous Localization buildYearClauseForLayer exactly.
 */
export function buildYearClauseForLayerFields(
  yil: string,
  layerFields: any[] | undefined,
): string {
  if (!yil) return "1=0";

  const yDigits = extractYearDigits(yil);
  if (!yDigits) {
    return `yil LIKE '%${escapeLikeLiteral(String(yil))}%'`;
  }

  const fields: any[] = layerFields || [];
  const yilField = fields.find(
    (f) => String(f?.name || "").toLowerCase() === "yil",
  );
  const t = String(yilField?.type || "").toLowerCase();
  const isNumeric =
    t === "small-integer" ||
    t === "integer" ||
    t === "single" ||
    t === "double";

  if (isNumeric) {
    const n = Number(yDigits);
    return Number.isFinite(n)
      ? `yil = ${n}`
      : `yil LIKE '${escapeLikeLiteral(yDigits)}%'`;
  }

  // Default to string semantics (safe for string/unknown types).
  return `yil LIKE '${escapeLikeLiteral(yDigits)}%'`;
}

/** NDVI table date equality: dateField = 'YYYY-MM-DD'. */
export function buildTableDateEqualsWhere(
  dateField: string,
  ndviDate: string,
): string | null {
  if (!dateField || !ndviDate) return null;
  return `${dateField} = '${escapeArcGIS(ndviDate)}'`;
}

/**
 * NDVI vegetation-table WHERE: date + yil + region/district (+ optional turi).
 * Lookup keys match Localization history: effective name after normalizeApos
 * (not makeRegionDistrictKey) when resolving maps.
 */
export function buildNdviTableWhereWithRegion(opts: {
  dateField: string;
  ndviDate: string;
  tableFieldNames: string[];
  yil: string;
  viloyat: string;
  tuman: string;
  lockedViloyat?: string | null;
  viloyatToRegion: Record<string, number>;
  tumanToDistrict: Record<string, number>;
  normalizeApos: (s: string) => string;
  cropClause: string;
}): string | null {
  const dateWhere = buildTableDateEqualsWhere(opts.dateField, opts.ndviDate);
  if (!dateWhere) return null;
  const parts: string[] = [dateWhere];

  const hasField = (name: string) =>
    opts.tableFieldNames.some((f) => f.toLowerCase() === name.toLowerCase());

  if (opts.yil && hasField("yil")) {
    const yDigits = extractYearDigits(opts.yil);
    if (yDigits) parts.push(`yil LIKE '${escapeLikeLiteral(yDigits)}%'`);
  }

  const effectiveViloyat = opts.normalizeApos(
    (opts.viloyat || opts.lockedViloyat || "").toString(),
  );
  if (effectiveViloyat) {
    if (hasField("region")) {
      const regionNum = /^\d+$/.test(effectiveViloyat)
        ? Number(effectiveViloyat)
        : opts.viloyatToRegion[effectiveViloyat];
      if (regionNum !== undefined && Number.isFinite(regionNum)) {
        parts.push(`region = '${regionNum}'`);
      } else if (hasField("viloyat")) {
        parts.push(`viloyat = '${escapeArcGIS(effectiveViloyat)}'`);
      }
    } else if (hasField("viloyat")) {
      parts.push(`viloyat = '${escapeArcGIS(effectiveViloyat)}'`);
    }
  }

  if (opts.tuman) {
    const effectiveTuman = opts.normalizeApos(opts.tuman.toString());
    if (effectiveTuman) {
      if (hasField("district")) {
        const districtNum = /^\d+$/.test(effectiveTuman)
          ? Number(effectiveTuman)
          : opts.tumanToDistrict[effectiveTuman];
        if (districtNum !== undefined && Number.isFinite(districtNum)) {
          parts.push(`district = '${districtNum}'`);
        } else if (hasField("tuman")) {
          parts.push(`tuman = '${escapeArcGIS(effectiveTuman)}'`);
        }
      } else if (hasField("tuman")) {
        parts.push(`tuman = '${escapeArcGIS(effectiveTuman)}'`);
      }
    }
  }

  if (hasField("turi") && opts.cropClause) {
    parts.push(opts.cropClause);
  }
  return parts.join(" AND ");
}

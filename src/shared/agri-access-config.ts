import { getAppStore } from "jimu-core";
import { normalizeApos as normalizeAposSql } from "../data/agri-sql";

/**
 * Client-side access WHERE is UX-only. Real enforcement must mirror these rules
 * on the FeatureServer / Portal (definition query, hosted view, or item sharing).
 * Bypass via direct REST remains possible until server-side controls exist.
 * Empty access stays fail-open (1=1) by design — do not flip to 1=0 here.
 */

export type RuleOperator = "equal" | "range" | "include" | "like";

export interface AccessRule {
  id: string;
  operator: RuleOperator;
  value?: string;
  from?: string;
  to?: string;
  values?: string[];
  groups: string[];
}

export interface AccessFieldRule {
  id: string;
  title: string;
  field: string;
  rules: AccessRule[];
}

export interface AccessConfig {
  fullAccessGroups: string[];
  rules: AccessFieldRule[];
}

export type AccessConfigValidationResult =
  | { ok: true; config: AccessConfig }
  | { ok: false; errors: string[] };

const emptyAccessConfig: AccessConfig = {
  fullAccessGroups: [],
  rules: [],
};

/** ArcGIS field names used in access rules — structural injection guard. */
const ACCESS_FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Portal group ids + rule scalar values — no SQL control chars. */
const ACCESS_SAFE_TOKEN_RE = /^[\w.\-:@+#/()\[\]'ʼʻ` ]{0,200}$/u;
const ACCESS_GROUP_ID_RE = /^[\w.\-]{1,128}$/;
const MAX_ACCESS_RULES_PER_FIELD = 64;
const MAX_ACCESS_FIELDS = 64;
const MAX_INCLUDE_VALUES = 200;

let activeAccessConfig: AccessConfig = emptyAccessConfig;
let accessWhere = "1=1";
let accessConfigProvided = false;

export let fullAccess = true;
export let lockedViloyat = "";

const escapeSqlString = (value: string): string =>
  String(value ?? "").replace(/'/g, "''");

/** Strip LIKE metacharacters — ArcGIS often rejects ESCAPE clauses. */
export const escapeAccessLikePattern = (value: string): string =>
  String(value ?? "").replace(/[%_\\]/g, "");

const isSafeAccessFieldName = (field: string): boolean =>
  ACCESS_FIELD_NAME_RE.test(String(field ?? "").trim());

const isSafeAccessToken = (value: string): boolean =>
  ACCESS_SAFE_TOKEN_RE.test(String(value ?? ""));

const isSafeGroupId = (groupId: string): boolean =>
  ACCESS_GROUP_ID_RE.test(String(groupId ?? "").trim());

const normalizeOperator = (operator: unknown): RuleOperator | null => {
  if (
    operator === "equal" ||
    operator === "range" ||
    operator === "include" ||
    operator === "like"
  ) {
    return operator;
  }
  if (operator === "eq") return "equal";
  if (operator === "between") return "range";
  if (operator === "in") return "include";
  return null;
};

export const normalizeAccessConfig = (config: unknown): AccessConfig => {
  const rawConfig =
    config && typeof (config as any).asMutable === "function"
      ? (config as any).asMutable({ deep: true })
      : config;

  if (!rawConfig) {
    return emptyAccessConfig;
  }

  return {
    fullAccessGroups: Array.isArray((rawConfig as any).fullAccessGroups)
      ? (rawConfig as any).fullAccessGroups.map((groupId: unknown) =>
          String(groupId),
        )
      : [],
    rules: Array.isArray((rawConfig as any).rules)
      ? (rawConfig as any).rules.map((fieldRule: any) => ({
          id: String(fieldRule?.id ?? ""),
          title: String(fieldRule?.title ?? ""),
          field: String(fieldRule?.field ?? ""),
          rules: Array.isArray(fieldRule?.rules)
            ? fieldRule.rules.map((rule: any) => ({
                id: String(rule?.id ?? ""),
                operator: normalizeOperator(rule?.operator) ?? "equal",
                value:
                  rule?.value !== undefined ? String(rule.value) : undefined,
                from: rule?.from !== undefined ? String(rule.from) : undefined,
                to: rule?.to !== undefined ? String(rule.to) : undefined,
                values: Array.isArray(rule?.values)
                  ? rule.values.map((value: unknown) => String(value))
                  : [],
                groups: Array.isArray(rule?.groups)
                  ? rule.groups.map((groupId: unknown) => String(groupId))
                  : [],
              }))
            : [],
        }))
      : [],
  };
};

/**
 * Strict validation for imported / uploaded access JSON (SEC-2 / SEC-6).
 * Rejects unknown operators, unsafe field names, and values with SQL control chars.
 */
export const validateAccessConfigImport = (
  data: unknown,
): AccessConfigValidationResult => {
  const errors: string[] = [];

  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["Root must be a JSON object"] };
  }

  const raw = data as Record<string, unknown>;
  const allowedKeys = new Set(["fullAccessGroups", "rules"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown top-level key: ${key}`);
    }
  }

  if (
    raw.fullAccessGroups !== undefined &&
    !Array.isArray(raw.fullAccessGroups)
  ) {
    errors.push("fullAccessGroups must be an array");
  }
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) {
    errors.push("rules must be an array");
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  const config = normalizeAccessConfig(raw);

  if (config.rules.length > MAX_ACCESS_FIELDS) {
    errors.push(`Too many field rules (max ${MAX_ACCESS_FIELDS})`);
  }

  for (const groupId of config.fullAccessGroups) {
    if (!isSafeGroupId(groupId)) {
      errors.push(`Invalid fullAccess group id: ${groupId}`);
    }
  }

  for (const fieldRule of config.rules) {
    if (!fieldRule.field.trim() || !isSafeAccessFieldName(fieldRule.field)) {
      errors.push(`Invalid field name: ${fieldRule.field || "(empty)"}`);
    }
    if (fieldRule.title.length > 200) {
      errors.push(`Field title too long: ${fieldRule.field}`);
    }
    if (fieldRule.rules.length > MAX_ACCESS_RULES_PER_FIELD) {
      errors.push(
        `Too many rules on field ${fieldRule.field} (max ${MAX_ACCESS_RULES_PER_FIELD})`,
      );
    }

    for (const rule of fieldRule.rules) {
      if (normalizeOperator(rule.operator) == null) {
        errors.push(`Invalid operator on ${fieldRule.field}`);
      }
      for (const groupId of rule.groups) {
        if (!isSafeGroupId(groupId)) {
          errors.push(`Invalid rule group id: ${groupId}`);
        }
      }
      const scalars = [
        rule.value,
        rule.from,
        rule.to,
        ...(rule.values ?? []),
      ].filter((v) => v !== undefined && v !== null) as string[];
      for (const scalar of scalars) {
        if (!isSafeAccessToken(scalar)) {
          errors.push(
            `Unsafe rule value on ${fieldRule.field}: contains disallowed characters`,
          );
          break;
        }
      }
      if ((rule.values?.length ?? 0) > MAX_INCLUDE_VALUES) {
        errors.push(
          `Too many include values on ${fieldRule.field} (max ${MAX_INCLUDE_VALUES})`,
        );
      }
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }
  return { ok: true, config };
};

/** Human-readable before/after summary for Settings confirm dialogs. */
export const summarizeAccessConfigDiff = (
  before: AccessConfig,
  after: AccessConfig,
): string => {
  const beforeGroups = before.fullAccessGroups.length;
  const afterGroups = after.fullAccessGroups.length;
  const beforeRules = before.rules.reduce((n, f) => n + f.rules.length, 0);
  const afterRules = after.rules.reduce((n, f) => n + f.rules.length, 0);
  const beforeFields = before.rules.length;
  const afterFields = after.rules.length;
  return [
    `Full-access groups: ${beforeGroups} → ${afterGroups}`,
    `Field definitions: ${beforeFields} → ${afterFields}`,
    `Rules: ${beforeRules} → ${afterRules}`,
  ].join("\n");
};

const quoteValue = (value: string): string => {
  const trimmed = String(value ?? "").trim();

  if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") {
    return trimmed.toLowerCase();
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  return `'${escapeSqlString(trimmed)}'`;
};

export const buildAccessRuleWhere = (
  field: string,
  rule: AccessRule,
): string => {
  const safeField = String(field ?? "").trim();
  if (!safeField || !isSafeAccessFieldName(safeField)) {
    return "1=0";
  }

  if (rule.operator === "equal") {
    const value = String(rule.value ?? "");
    if (!isSafeAccessToken(value)) return "1=0";
    return `${safeField} = ${quoteValue(value)}`;
  }

  if (rule.operator === "range") {
    const from = String(rule.from ?? "");
    const to = String(rule.to ?? "");
    if (!isSafeAccessToken(from) || !isSafeAccessToken(to)) return "1=0";
    return `${safeField} BETWEEN ${quoteValue(from)} AND ${quoteValue(to)}`;
  }

  if (rule.operator === "include") {
    const values = (rule.values ?? []).filter((v) => isSafeAccessToken(String(v)));
    if (!values.length) return "1=0";
    return `${safeField} IN (${values.map((v) => quoteValue(String(v))).join(", ")})`;
  }

  if (rule.operator === "like") {
    const raw = String(rule.value ?? "");
    if (!isSafeAccessToken(raw)) return "1=0";
    const pattern = escapeAccessLikePattern(raw);
    return `${safeField} LIKE '${escapeSqlString(pattern)}'`;
  }

  return "1=0";
};

const getCurrentUserGroupIds = (): string[] =>
  Array.from(getAppStore().getState()?.user?.groups ?? []).map((group: any) =>
    String(group.id),
  );

const isAccessConfigEmpty = (config: AccessConfig): boolean =>
  !config.fullAccessGroups.length && !config.rules.length;

const checkingAccess = (config: AccessConfig): string => {
  const userGroups = getCurrentUserGroupIds();

  const hasFullAccess = config.fullAccessGroups.some((groupId) =>
    userGroups.includes(groupId),
  );
  if (hasFullAccess) {
    return "1=1";
  }

  const allowedClauses: string[] = [];
  for (const fieldRule of config.rules) {
    for (const rule of fieldRule.rules) {
      const hasRuleAccess = rule.groups.some((groupId) =>
        userGroups.includes(groupId),
      );
      if (hasRuleAccess) {
        allowedClauses.push(buildAccessRuleWhere(fieldRule.field, rule));
      }
    }
  }
  const uniqueClauses = Array.from(new Set(allowedClauses.filter(Boolean)));
  if (!uniqueClauses.length) return "1=0";
  return uniqueClauses.length === 1
    ? uniqueClauses[0]
    : `(${uniqueClauses.join(" OR ")})`;
};

const parseQuotedValue = (where: string): string | null => {
  const match = /=\s*'((?:[^']|'')*)'/i.exec(where);
  if (!match) return null;
  return match[1].replace(/''/g, "'");
};

/**
 * Fallback: recover a single-region lock from a simple equality WHERE.
 * Must accept spaces inside the quoted value (`Toshkent viloyati`).
 * Multi-clause OR/AND access (multi-group) cannot be reduced to one lock —
 * returns "" so the UI stays on the allowed-viloyats list instead.
 */
const parseLockedRegionFromAccess = (where: string): string => {
  if (!where || where === "1=1" || where === "1=0") return "";
  if (/\bOR\b|\bAND\b|\bBETWEEN\b|\bIN\b|\bLIKE\b/i.test(where)) return "";

  if (!/^(viloyat|region_id|region)\s*=/i.test(where.trim())) return "";

  const quoted = parseQuotedValue(where);
  if (quoted) return quoted;

  const numeric = /=\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(where.trim());
  return numeric ? numeric[1] : "";
};

/**
 * Preferred lock source: structured rule values (not SQL round-trip).
 * Only locks when exactly one viloyat/region value is allowed for the user.
 */
const deriveLockedViloyatFromConfig = (config: AccessConfig): string => {
  const groups = getCurrentUserGroupIds().map((id) => ({ id }));
  const allowed = resolveAllowedViloyatsForGroups(groups, config);
  return allowed.length === 1 ? allowed[0] : "";
};

/** Shared agri-sql normalize + trim (access keys are dictionary lookups). */
const normalizeApos = (value: string): string =>
  normalizeAposSql(value).trim();

const extractViloyatValuesFromRule = (
  field: string,
  rule: AccessRule,
): string[] => {
  const fieldName = field.trim().toLowerCase();
  if (!["viloyat", "region", "region_id"].includes(fieldName)) {
    return [];
  }

  if (rule.operator === "equal" && rule.value) {
    return [normalizeApos(rule.value)];
  }

  if (rule.operator === "include" && rule.values?.length) {
    return rule.values.map((value) => normalizeApos(value)).filter(Boolean);
  }

  return [];
};

export const resolveAllowedViloyatsForGroups = (
  groups: Array<{ id: string }>,
  config: AccessConfig = activeAccessConfig,
): string[] => {
  const userGroupIds = groups.map((group) => String(group.id));
  const allowed = new Set<string>();

  const hasFullAccess = config.fullAccessGroups.some((groupId) =>
    userGroupIds.includes(groupId),
  );
  if (hasFullAccess) {
    return [];
  }

  for (const fieldRule of config.rules) {
    for (const rule of fieldRule.rules) {
      const hasRuleAccess = rule.groups.some((groupId) =>
        userGroupIds.includes(groupId),
      );
      if (!hasRuleAccess) continue;
      extractViloyatValuesFromRule(fieldRule.field, rule).forEach((value) => {
        if (value) allowed.add(value);
      });
    }
  }

  return Array.from(allowed);
};

const updateComputedAccess = (): void => {
  if (!accessConfigProvided || isAccessConfigEmpty(activeAccessConfig)) {
    accessWhere = "1=1";
    fullAccess = true;
    lockedViloyat = "";
    return;
  }

  accessWhere = checkingAccess(activeAccessConfig);
  fullAccess = accessWhere === "1=1";
  if (fullAccess) {
    lockedViloyat = "";
    return;
  }
  // Structural first — handles spaces in names and single-value `include`.
  // SQL regex is only a fallback for unusual field shapes.
  lockedViloyat =
    deriveLockedViloyatFromConfig(activeAccessConfig) ||
    parseLockedRegionFromAccess(accessWhere);
};

export const setAccessConfig = (config?: unknown): void => {
  accessConfigProvided = config != null;
  activeAccessConfig = normalizeAccessConfig(config);
  updateComputedAccess();
};

export const getAccessWhere = (): string => accessWhere;

export const isAccessDenied = (): boolean => accessWhere === "1=0";

export const isAccessConfigured = (): boolean =>
  accessConfigProvided && !isAccessConfigEmpty(activeAccessConfig);

export const combineAccessWhere = (mainWhere?: string): string => {
  // Client-side only — see module header. Server-side mirror is still required
  // for real enforcement (FeatureServer definition query / hosted view).
  const access = getAccessWhere();
  const base = String(mainWhere ?? "").trim() || "1=1";
  if (access === "1=1") return base;
  return `(${access}) AND (${base})`;
};

/**
 * Apply access WHERE only when every identifier referenced by the access
 * clause exists on the target layer. Vegetation indices and admin-boundary
 * layers use `region`/`soato`, not `viloyat` — wrapping them with a viloyat
 * clause would invalidate the SQL or empty the result set.
 *
 * Callers that already scope by region code from the UI lock (F-04) should
 * keep that path; use this helper only for layers that share Agri_table fields.
 */
export const combineAccessWhereIfFieldsExist = (
  mainWhere: string | undefined,
  layerFieldNames: Iterable<string>,
): string => {
  const access = getAccessWhere();
  const base = String(mainWhere ?? "").trim() || "1=1";
  if (access === "1=1" || access === "1=0") {
    return access === "1=0" ? "1=0" : base;
  }
  const available = new Set(
    Array.from(layerFieldNames, (name) => String(name || "").toLowerCase()),
  );
  if (!available.size) return base;
  // Identifiers that look like field names in the access clause.
  const referenced = access.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
  const sqlKeywords = new Set([
    "and",
    "or",
    "not",
    "in",
    "between",
    "like",
    "null",
    "is",
    "true",
    "false",
  ]);
  for (const token of referenced) {
    const lower = token.toLowerCase();
    if (sqlKeywords.has(lower)) continue;
    if (/^\d+$/.test(token)) continue;
    if (!available.has(lower)) {
      // Incompatible schema — do not poison the query; UI lock remains the control.
      return base;
    }
  }
  return `(${access}) AND (${base})`;
};

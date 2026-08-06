import { getAppStore } from "jimu-core";

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

const emptyAccessConfig: AccessConfig = {
  fullAccessGroups: [],
  rules: [],
};

let activeAccessConfig: AccessConfig = emptyAccessConfig;
let accessWhere = "1=1";
let accessConfigProvided = false;

export let fullAccess = true;
export let lockedViloyat = "";

const escapeSqlString = (value: string): string =>
  String(value ?? "").replace(/'/g, "''");

const normalizeOperator = (operator: unknown): RuleOperator => {
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
  return "equal";
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
                operator: normalizeOperator(rule?.operator),
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
  if (!field.trim()) {
    return "1=0";
  }

  if (rule.operator === "equal") {
    return `${field} = ${quoteValue(rule.value ?? "")}`;
  }

  if (rule.operator === "range") {
    return `${field} BETWEEN ${quoteValue(rule.from ?? "")} AND ${quoteValue(rule.to ?? "")}`;
  }

  if (rule.operator === "include") {
    const values = rule.values ?? [];
    if (!values.length) return "1=0";
    return `${field} IN (${values.map(quoteValue).join(", ")})`;
  }

  if (rule.operator === "like") {
    return `${field} LIKE ${quoteValue(rule.value ?? "")}`;
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

const parseLockedRegionFromAccess = (where: string): string => {
  if (!where || where === "1=1" || where === "1=0") return "";

  const viloyatMatch = /^viloyat\s*=\s*'?([^'\s]+)'?$/i.exec(where);
  if (viloyatMatch) return viloyatMatch[1];

  const regionIdMatch = /^region_id\s*=\s*'?([^'\s]+)'?$/i.exec(where);
  if (regionIdMatch) return regionIdMatch[1];

  const regionMatch = /^region\s*=\s*'?([^'\s]+)'?$/i.exec(where);
  if (regionMatch) return regionMatch[1];

  return "";
};

const normalizeApos = (value: string): string =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/['''ʻʼ`]/g, "'")
    .trim();

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
  lockedViloyat = fullAccess ? "" : parseLockedRegionFromAccess(accessWhere);
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
  const access = getAccessWhere();
  const base = String(mainWhere ?? "").trim() || "1=1";
  if (access === "1=1") return base;
  return `(${access}) AND (${base})`;
};

/**
 * Pure PopupPanel format / attribute helpers.
 */

export function findAttributeValueCaseInsensitive(
  attributes: Record<string, any> | null | undefined,
  fieldName: string,
): any {
  if (!attributes) return null;
  const target = fieldName.toLowerCase();
  const key = Object.keys(attributes).find((k) => k.toLowerCase() === target);
  return key ? attributes[key] : null;
}

export function formatDateSmart(raw: any): string {
  if (raw instanceof Date) return raw.toLocaleString();

  if (typeof raw === "number" && isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return isNaN(d.getTime())
      ? String(raw)
      : d.toLocaleString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d{10,13}$/.test(trimmed)) return formatDateSmart(Number(trimmed));
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  return String(raw);
}

export function niceChartMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const padded = value * 1.08;
  const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
  const normalized = padded / magnitude;
  let nice = 10;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  return nice * magnitude;
}

export function formatChartTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return `${Math.round(value)}`;
  if (Math.abs(value) >= 100) return `${Math.round(value)}`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function formatChartTooltipValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) {
    return value.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ");
  }
  return value
    .toLocaleString("ru-RU", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/,/g, ".");
}

/** ArcGIS field type guard for popup date formatting. */
export function isEsriDateFieldType(type: unknown): boolean {
  const t = String(type || "");
  return (
    t === "date" ||
    t === "timestamp-offset" ||
    t === "date-only" ||
    t === "time-only"
  );
}

/** Display string for a popup attribute cell. */
export function formatPopupAttributeValue(
  raw: any,
  opts: {
    isDateField: boolean;
    formatDate: (value: any) => string;
  },
): string {
  if (raw === null || raw === undefined || raw === "") return "—";

  if (opts.isDateField) return opts.formatDate(raw);
  if (
    (typeof raw === "number" && raw > 1e9 && raw < 1e14) ||
    (typeof raw === "string" && /^\d{10,13}$/.test(raw))
  ) {
    return opts.formatDate(raw);
  }

  if (typeof raw === "number" && isFinite(raw)) {
    return raw
      .toLocaleString("ru-RU")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/,/g, ".");
  }
  if (Array.isArray(raw)) return raw.join(", ");
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

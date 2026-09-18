/**
 * Opt-in debug logging for Agro_widgetV5.
 *
 * Enable in browser console:
 *   window.__AGRO_V5_DEBUG = true         // all [AgroV5] logs
 *   window.__AGRO_V5_VH_DEBUG = true      // VH / Pie / Bar filter flow only
 *   window.__AGRO_V5_TUMAN_DEBUG = true   // tuman select / Pie / Jadval (default ON)
 *   window.__AGRO_V5_TUMAN_DEBUG = false  // turn tuman logs off
 */
export type AgroV5LogTopic = "all" | "vh" | "map" | "connection" | "tuman";

function readGlobalFlag(name: string): boolean | undefined {
  try {
    const g = globalThis as any;
    if (g?.[name] === true) return true;
    if (g?.[name] === false) return false;
    return undefined;
  } catch {
    return undefined;
  }
}

function isDebugEnabled(topic: AgroV5LogTopic = "all"): boolean {
  if (readGlobalFlag("__AGRO_V5_DEBUG") === true) return true;
  if (topic === "vh" && readGlobalFlag("__AGRO_V5_VH_DEBUG") === true) {
    return true;
  }
  if (topic === "tuman") {
    // Default ON so tuman select debugging is visible without setup.
    const flag = readGlobalFlag("__AGRO_V5_TUMAN_DEBUG");
    return flag !== false;
  }
  return false;
}

export function agroV5Log(
  phase: string,
  detail?: Record<string, unknown>,
  topic: AgroV5LogTopic = "all",
): void {
  if (!isDebugEnabled(topic)) return;
  try {
    const prefix = topic === "tuman" ? "[AgroV5 tuman]" : "[AgroV5]";
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${phase}`, detail ?? {});
  } catch {
    /* ignore */
  }
}

/** Always-visible helper for tuman selection diagnosis. */
export function agriTumanLog(
  phase: string,
  detail?: Record<string, unknown>,
): void {
  agroV5Log(phase, detail, "tuman");
}

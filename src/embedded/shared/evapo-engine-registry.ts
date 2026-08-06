import { EvapoDataSourceEngine } from "./evapo-data-source-engine";

const DASHBOARD_CHILD_SUFFIXES = [
  "-localization",
  "-indicator",
  "-region",
  "-pie",
  "-graff",
  "-bar",
  "-popup",
] as const;

/** Root EvapoDashboardV6 widget id from any embedded child id. */
export function getEvapoDashboardRootId(widgetId: string): string {
  const id = String(widgetId || "");
  for (const suffix of DASHBOARD_CHILD_SUFFIXES) {
    if (id.endsWith(suffix)) return id.slice(0, -suffix.length);
  }
  return id;
}

const sharedEngines = new Map<string, EvapoDataSourceEngine>();

/** One DataSource engine per dashboard instance — shared by all embedded children. */
export function getSharedEvapoDataSourceEngine(
  widgetId: string,
): EvapoDataSourceEngine {
  const rootId = getEvapoDashboardRootId(widgetId);
  let engine = sharedEngines.get(rootId);
  if (!engine) {
    engine = new EvapoDataSourceEngine();
    sharedEngines.set(rootId, engine);
  }
  return engine;
}

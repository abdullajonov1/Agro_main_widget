/**
 * Central snapshot of the last masterFilterChanged payload.
 *
 * Dashboard panels MUST read filters via subscribeMasterFilter / bindMasterFilter.
 * document CustomEvent bus is kept only for map layer hooks and ExB compatibility.
 *
 * UI filter geography is NOT restored on refresh (always default republic +
 * latest year). Loaded stats stay in agri-persistent-cache / DashboardPack
 * multi-key store for 1 hour so re-selecting a prior filter reuses data.
 */
import { scheduleDashboardOrchestrator } from "../controller/agri-dashboard-orchestrator";

export type MasterFilterSnapshot = Record<string, unknown>;

type MasterFilterListener = (detail: MasterFilterSnapshot) => void;

let lastSnapshot: MasterFilterSnapshot | null = null;
const listeners = new Set<MasterFilterListener>();

export function syncMasterFilterSnapshot(
  detail: MasterFilterSnapshot | null | undefined,
): void {
  if (!detail || typeof detail !== "object") return;
  lastSnapshot = detail;
  scheduleDashboardOrchestrator(detail);
  listeners.forEach((listener) => {
    try {
      listener(detail);
    } catch {
      /* panel handler must not break store */
    }
  });
}

export function getMasterFilterSnapshot(): MasterFilterSnapshot | null {
  return lastSnapshot;
}

export function clearMasterFilterSnapshot(): void {
  lastSnapshot = null;
}

/** In-memory subscription — preferred read path for dashboard panels. */
export function subscribeMasterFilter(
  listener: MasterFilterListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Late-mounted panels: apply cached filter immediately, or ask Localization to replay.
 * @deprecated Prefer bindMasterFilter from agri-filter-bus.ts
 */
export function bootstrapMasterFilterSync(
  handler: (event: Event) => void,
): void {
  const snapshot = getMasterFilterSnapshot();
  if (snapshot) {
    handler(new CustomEvent("masterFilterChanged", { detail: snapshot }));
    return;
  }
  document.dispatchEvent(new CustomEvent("requestMasterFilterState"));
}

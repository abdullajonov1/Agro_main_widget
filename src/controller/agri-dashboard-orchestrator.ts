/**
 * Coordinates dashboard-wide work when the master filter changes.
 * Delegates to agri-dashboard-controller (warmup + shared Region/Pie pack).
 */
import type { MasterFilterSnapshot } from "../data/agri-filter-store";
import {
  resetDashboardController,
  scheduleDashboardController,
} from "./agri-dashboard-controller";

/**
 * Schedule shared dashboard work after a master filter snapshot.
 * Safe to call on every broadcast — debounced and keyed inside controller.
 */
export function scheduleDashboardOrchestrator(
  detail: MasterFilterSnapshot | null | undefined,
): void {
  scheduleDashboardController(detail);
}

/** Test / hot-reload helper */
export function resetDashboardOrchestrator(): void {
  resetDashboardController();
}

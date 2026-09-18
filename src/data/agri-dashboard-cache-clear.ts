import { clearAgriDashboardBootstrapCache } from "./agri-bootstrap";
import { clearAgriQueryGatewayCache } from "./agri-query-gateway";
import { clearAgriStatsStoreCache } from "./agri-stats-store";
import { resetStatsQueryScheduler } from "./agri-query-scheduler";
import { clearMasterFilterSnapshot } from "./agri-filter-store";
import { resetDashboardPackStore } from "../store/agri-dashboard-store";
import { resetDashboardOrchestrator } from "../controller/agri-dashboard-orchestrator";

/** Clear in-memory dashboard caches / schedulers on widget unmount. */
export function clearDashboardCaches(): void {
  try {
    resetDashboardOrchestrator();
  } catch {
    /* ignore */
  }
  try {
    resetDashboardPackStore();
  } catch {
    /* ignore */
  }
  try {
    resetStatsQueryScheduler();
  } catch {
    /* ignore */
  }
  try {
    clearMasterFilterSnapshot();
  } catch {
    /* ignore */
  }
  clearAgriDashboardBootstrapCache();
  clearAgriQueryGatewayCache();
  clearAgriStatsStoreCache();
}

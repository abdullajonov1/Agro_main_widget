/** @jsx jsx */
import { jsx, React } from "jimu-core";
import AgriChartLoader from "../shared/AgriChartLoader";
// Keep Graff CSS on the shell bundle so it cannot inject AFTER agri-dashboard.css
// when this widget lazy-loads (that was breaking Ekin Turi legend/donut layout).
import "../panels/GraffPanel/runtime/AgriGraff.css";

/**
 * Only Graff stays lazy (large). Popup must be eager: its
 * agri-vegetation-overlay-prefetch dependency was split into
 * widgets/chunks/… and 404s when the portal/GitHub deploy ships the
 * widget folder without sibling chunks (sgm.uzspace.uz Agro-main-widget).
 */
export const LazyAgriGraff10 = React.lazy(
  () => import("../panels/GraffPanel"),
);

export function LazyPanelFallback(): React.ReactElement {
  return (
    <div
      className="agri-dashboard-widget-slot-loading"
      aria-label="Loading panel"
    >
      <AgriChartLoader />
    </div>
  );
}

export function LazyPanelSuspense(props: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <React.Suspense fallback={<LazyPanelFallback />}>{props.children}</React.Suspense>
  );
}

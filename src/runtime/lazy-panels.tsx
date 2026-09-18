/** @jsx jsx */
import { jsx, React } from "jimu-core";
import AgriChartLoader from "../shared/AgriChartLoader";
// Keep panel CSS on the shell bundle so it cannot inject AFTER agri-dashboard.css
// when these widgets lazy-load (that was breaking Ekin Turi legend/donut layout).
import "../panels/GraffPanel/runtime/AgriGraff.css";
import "../panels/PopupPanel/runtime/AgriPolygon.css";

export const LazyAgriGraff10 = React.lazy(
  () => import("../panels/GraffPanel"),
);
export const LazyAgriPopup = React.lazy(
  () => import("../panels/PopupPanel/runtime/widget"),
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

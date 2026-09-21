/** @jsx jsx */
import { jsx, React } from "jimu-core";
import AgriChartLoader from "../shared/AgriChartLoader";

/**
 * Panel CSS stays on the shell. All heavy panels are eager now so Portal
 * custom-widget updates do not depend on a separate widgets/chunks/ file
 * that Enterprise often caches separately from widget.js.
 */
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

/** @jsx jsx */
import { jsx, React, type AllWidgetProps } from "jimu-core";
import AgriIndicator10 from "../embedded/AgriIndicator10/runtime/widget";
import AgriIndicatorYield from "../embedded/AgriIndicatorYield/runtime/widget";
import AgriIndicatorUnusedLand from "../embedded/AgriIndicatorUnusedLand/runtime/widget";
import AgriIndicatorReserveLand from "../embedded/AgriIndicatorReserveLand/runtime/widget";

export type IndicatorAnimPhase =
  | "collapsed"
  | "expanding"
  | "expanded"
  | "collapsing";

type Props = {
  overlayRef: React.RefObject<HTMLDivElement>;
  panelRef: React.RefObject<HTMLDivElement>;
  phase: IndicatorAnimPhase;
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
  indicatorProps: AllWidgetProps<any>;
  yieldProps: AllWidgetProps<any>;
  unusedLandProps: AllWidgetProps<any>;
  reserveLandProps: AllWidgetProps<any>;
};

/**
 * Isolated from dashboard mapLoading / layout re-renders so indicator widgets
 * keep their data and do not refetch while the drawer animates.
 */
export default class AgriMapIndicatorDrawer extends React.Component<Props> {
  shouldComponentUpdate(nextProps: Props): boolean {
    return (
      nextProps.phase !== this.props.phase ||
      nextProps.indicatorProps !== this.props.indicatorProps ||
      nextProps.yieldProps !== this.props.yieldProps ||
      nextProps.unusedLandProps !== this.props.unusedLandProps ||
      nextProps.reserveLandProps !== this.props.reserveLandProps ||
      nextProps.onToggle !== this.props.onToggle
    );
  }

  render() {
    const {
      overlayRef,
      panelRef,
      phase,
      onToggle,
      indicatorProps,
      yieldProps,
      unusedLandProps,
      reserveLandProps,
    } = this.props;

    const isOpen = phase === "expanded" || phase === "expanding";
    const className = [
      "agri-dashboard-indicator-drawer",
      "agri-dashboard-indicator-overlay",
      "agri-dashboard-indicator-overlay--compact",
      `agri-dashboard-indicator-drawer--${phase}`,
    ].join(" ");

    return (
      <div
        ref={overlayRef}
        className={className}
        aria-label="Crop area indicators"
      >
        <button
          type="button"
          className="agri-dashboard-indicator-toggle"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls="agri-dashboard-indicator-panel"
          title={isOpen ? "Indikatorlarni yopish" : "Indikatorlarni ochish"}
        >
          <span
            className="agri-dashboard-indicator-toggle-icon"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M9 6L15 12L9 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
        <div className="agri-dashboard-indicator-panel-clip">
          <div
            ref={panelRef}
            id="agri-dashboard-indicator-panel"
            className="agri-dashboard-indicator-panel"
            aria-hidden={!isOpen}
          >
            <div className="agri-dashboard-indicator-slot" key="indicator">
              <AgriIndicator10 {...indicatorProps} />
            </div>
            <div className="agri-dashboard-indicator-slot" key="yield">
              <AgriIndicatorYield {...yieldProps} />
            </div>
            <div className="agri-dashboard-indicator-slot" key="unused">
              <AgriIndicatorUnusedLand {...unusedLandProps} />
            </div>
            <div className="agri-dashboard-indicator-slot" key="reserve">
              <AgriIndicatorReserveLand {...reserveLandProps} />
            </div>
          </div>
        </div>
      </div>
    );
  }
}

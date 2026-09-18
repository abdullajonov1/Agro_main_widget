import * as React from "react";
import "./agri-dashboard-spinner.css";

type AgriDashboardSpinnerProps = {
  className?: string;
  /** Visual size hint; animation always runs at 65px then scales. */
  size?: number;
  compact?: boolean;
  ariaLabel?: string;
};

/** Base morph box matches agri-chart-loader (.loader is 65×65). */
const BASE_SIZE = 65;

export default function AgriDashboardSpinner({
  className,
  size,
  compact = false,
  ariaLabel = "Loading",
}: AgriDashboardSpinnerProps): JSX.Element {
  // Keep the same hollow inset animation as chart cards. Shrinking the box
  // itself (e.g. 40px) made the mid-frame look like a blue rectangular border.
  const target = size ?? (compact ? 36 : BASE_SIZE);
  const scale = target / BASE_SIZE;

  return (
    <div
      className={`agri-dashboard-spinner-wrap ${className || ""}`.trim()}
      style={{ width: target, height: target }}
      role="status"
      aria-label={ariaLabel}
    >
      <div
        className={`agri-dashboard-spinner ${compact ? "agri-dashboard-spinner--compact" : ""}`.trim()}
        style={{
          width: BASE_SIZE,
          height: BASE_SIZE,
          transform: `scale(${scale})`,
        }}
        aria-hidden="true"
      />
    </div>
  );
}

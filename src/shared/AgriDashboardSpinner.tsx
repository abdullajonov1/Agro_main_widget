import * as React from "react";
import "./agri-dashboard-spinner.css";

type AgriDashboardSpinnerProps = {
  className?: string;
  size?: number;
  compact?: boolean;
  ariaLabel?: string;
};

export default function AgriDashboardSpinner({
  className,
  size,
  compact = false,
  ariaLabel = "Loading",
}: AgriDashboardSpinnerProps): JSX.Element {
  const dimension = size ?? (compact ? 40 : 52);

  return (
    <div
      className={`agri-dashboard-spinner ${compact ? "agri-dashboard-spinner--compact" : ""} ${className || ""}`.trim()}
      style={{ width: dimension, height: dimension }}
      role="status"
      aria-label={ariaLabel}
    />
  );
}
import * as React from "react";
import "./agri-chart-loader.css";

type AgriChartLoaderProps = {
  label?: string;
  className?: string;
};

export default function AgriChartLoader({
  label = "Loading chart data",
  className,
}: AgriChartLoaderProps): JSX.Element {
  return (
    <div
      className={`agri-chart-loader ${className || ""}`.trim()}
      role="status"
      aria-label={label}
    >
      <div className="loader" aria-hidden="true" />
    </div>
  );
}

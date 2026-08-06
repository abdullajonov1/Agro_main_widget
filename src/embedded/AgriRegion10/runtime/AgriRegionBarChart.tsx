import { React } from "jimu-core";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useAnimatedNumber } from "./useAnimatedNumber";
import "./AgriRegionBarChart.css";

const BAR_ANIMATION_MS = 650;
const BAR_STAGGER_MS = 48;
/** Cap bar thickness so few regions/districts don't become huge blocks. */
const MAX_BAR_HEIGHT_PX = 60;
const MIN_BAR_HEIGHT_PX = 14;

export type AgriRegionBarChartItem = {
  name: string;
  maydon: number;
  percentage?: number;
  displayName?: string;
};

type AgriRegionBarChartProps = {
  data: AgriRegionBarChartItem[];
  chartAreaHeight: number;
  chartBarGap: number;
  chartTrackRightInset: number;
  nameColumnWidth: number;
  chartAxisMax: number;
  unitLabel: string;
  selectedRegion: string | null;
  viewKey: string;
  formatNumber: (value: number) => string;
  onRowClick: (item: AgriRegionBarChartItem) => void;
  onRowPointerEnter: (
    item: AgriRegionBarChartItem,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  onRowPointerMove: (
    item: AgriRegionBarChartItem,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
};

function splitLabelTwoLines(label: string): [string, string?] {
  // Single-line labels with CSS ellipsis (eco RegionStatsChart style).
  const safe = String(label || "").trim();
  return [safe || ""];
}

function getBarWrapWidth(
  barWidthPercent: number,
  minBarWidthPx: number,
): string {
  if (barWidthPercent <= 0) return "0px";
  const trackWidth = `${barWidthPercent}%`;
  if (minBarWidthPx <= 0) return trackWidth;
  return `max(${minBarWidthPx}px, ${trackWidth})`;
}

type BarRowProps = {
  item: AgriRegionBarChartItem;
  index: number;
  percent: number;
  viewKey: string;
  selected: boolean;
  dimmed: boolean;
  nameColumnWidth: number;
  unitLabel: string;
  barHeight: number;
  formatNumber: (value: number) => string;
  onClick: () => void;
  onPointerEnter: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

function BarRow({
  item,
  index,
  percent,
  viewKey,
  selected,
  dimmed,
  nameColumnWidth,
  unitLabel,
  barHeight,
  formatNumber,
  onClick,
  onPointerEnter,
  onPointerMove,
}: BarRowProps) {
  const [barWidth, setBarWidth] = useState(0);
  const lastViewKeyRef = useRef<string | null>(null);
  const hasEnteredRef = useRef(false);
  const animatedValue = useAnimatedNumber(item.maydon, {
    duration: BAR_ANIMATION_MS,
  });
  const displayName = item.displayName || item.name;
  const [line1, line2] = splitLabelTwoLines(displayName);

  useEffect(() => {
    const viewChanged = lastViewKeyRef.current !== viewKey;
    const shouldEnter = !hasEnteredRef.current || viewChanged;

    if (shouldEnter) {
      lastViewKeyRef.current = viewKey;
      hasEnteredRef.current = true;
      setBarWidth(0);

      const delay = index * BAR_STAGGER_MS;
      const timer = window.setTimeout(() => {
        requestAnimationFrame(() => {
          setBarWidth(percent);
        });
      }, delay);

      return () => window.clearTimeout(timer);
    }

    setBarWidth(percent);
  }, [index, percent, viewKey]);

  const valueLabel = `${formatNumber(Math.round(animatedValue))}\u00A0${unitLabel}`;
  const minBarWidthPx = item.maydon > 0 ? 14 : 0;

  return (
    <button
      type="button"
      className={`agri-region-bar-chart__row${
        selected ? " agri-region-bar-chart__row--selected" : ""
      }${dimmed ? " agri-region-bar-chart__row--dimmed" : ""}`}
      style={
        {
          "--bar-chart-name-width": `${nameColumnWidth}px`,
          height: `${barHeight}px`,
          flex: `0 0 ${barHeight}px`,
        } as CSSProperties
      }
      onClick={onClick}
      onMouseEnter={onPointerEnter}
      onMouseMove={onPointerMove}
    >
      <span className="agri-region-bar-chart__name" title={displayName}>
        <span className="agri-region-bar-chart__name-line">{line1}</span>
        {line2 ? (
          <span className="agri-region-bar-chart__name-line">{line2}</span>
        ) : null}
      </span>
      <span className="agri-region-bar-chart__chart">
        <span className="agri-region-bar-chart__track">
          <span
            className="agri-region-bar-chart__fill-wrap"
            style={{ width: getBarWrapWidth(barWidth, minBarWidthPx) }}
          >
            <span className="agri-region-bar-chart__fill" />
            <span className="agri-region-bar-chart__value">{valueLabel}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

export function AgriRegionBarChart({
  data,
  chartAreaHeight,
  chartBarGap,
  chartTrackRightInset,
  nameColumnWidth,
  chartAxisMax,
  unitLabel,
  selectedRegion,
  viewKey,
  formatNumber,
  onRowClick,
  onRowPointerEnter,
  onRowPointerMove,
}: AgriRegionBarChartProps) {
  const hasSelectedRegion = selectedRegion != null;

  return (
    <div
      className="agri-region-bar-chart"
      style={{
        height: chartAreaHeight,
        gap: chartBarGap,
        paddingRight: chartTrackRightInset,
      }}
    >
      {data.map((item, index) => {
        const selected = selectedRegion === item.name;
        const percent =
          chartAxisMax > 0 ? (item.maydon / chartAxisMax) * 100 : 0;
        const rowCount = Math.max(data.length, 1);
        const barHeight = Math.min(
          MAX_BAR_HEIGHT_PX,
          Math.max(
            MIN_BAR_HEIGHT_PX,
            Math.floor(
              (chartAreaHeight - Math.max(0, rowCount - 1) * chartBarGap) /
                rowCount,
            ),
          ),
        );

        return (
          <BarRow
            key={`${item.name}-${index}`}
            item={item}
            index={index}
            percent={percent}
            viewKey={viewKey}
            selected={selected}
            dimmed={hasSelectedRegion && !selected}
            nameColumnWidth={nameColumnWidth}
            unitLabel={unitLabel}
            barHeight={barHeight}
            formatNumber={formatNumber}
            onClick={() => onRowClick(item)}
            onPointerEnter={(event) => onRowPointerEnter(item, event)}
            onPointerMove={(event) => onRowPointerMove(item, event)}
          />
        );
      })}
    </div>
  );
}

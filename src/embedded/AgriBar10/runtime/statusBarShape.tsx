import { React } from "jimu-core";

const MIN_BAR_PX = 8;
/** Diagonal cut depth on the top edge (left high → right low). */
const TOP_SLANT_RATIO = 0.14;
const TOP_SLANT_MAX = 18;

/** Tailwind *-50 equivalents for VH bar fills. */
const VH_STATUS_TRACK_50: Record<string, string> = {
  "#16a34a": "#f0fdf4", // green-50
  "#4ade80": "#f0fdf4", // green-50
  "#f97316": "#fff7ed", // orange-50
  "#ef4444": "#fef2f2", // red-50
};

function statusTrackColor(barColor: string, theme: "light" | "dark"): string {
  const key = String(barColor || "").trim().toLowerCase();
  const light50 =
    VH_STATUS_TRACK_50[key] ||
    VH_STATUS_TRACK_50[key.toUpperCase()] ||
    `color-mix(in srgb, ${barColor} 14%, #ffffff)`;

  if (theme === "light") return light50;
  // Dark theme: soft tint of the same bar color
  return `color-mix(in srgb, ${barColor} 22%, transparent)`;
}

/**
 * Vertical bar with slanted top + border-radius on top and bottom corners.
 */
function slantedBarPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): string {
  if (w <= 0 || h <= 0) return "";

  const slant = Math.min(TOP_SLANT_MAX, Math.max(6, w * TOP_SLANT_RATIO));
  const r = Math.min(radius, w / 2, h / 2);
  const bottomY = y + h;

  // Too short for full rounded + slant geometry — keep a soft slanted tip.
  if (h < r * 2 + slant * 0.5) {
    const tinySlant = Math.min(slant, Math.max(2, h * 0.4));
    const tinyR = Math.min(r, h / 3, w / 3);
    return [
      `M ${x + tinyR} ${y}`,
      `L ${x + w - tinyR} ${y + tinySlant}`,
      `Q ${x + w} ${y + tinySlant} ${x + w} ${y + tinySlant + tinyR}`,
      `L ${x + w} ${bottomY - tinyR}`,
      `Q ${x + w} ${bottomY} ${x + w - tinyR} ${bottomY}`,
      `L ${x + tinyR} ${bottomY}`,
      `Q ${x} ${bottomY} ${x} ${bottomY - tinyR}`,
      `L ${x} ${y + tinyR}`,
      `Q ${x} ${y} ${x + tinyR} ${y}`,
      "Z",
    ].join(" ");
  }

  const topRightStartY = y + slant;
  const rightAfterRound = topRightStartY + r;

  return [
    // Top-left rounded corner
    `M ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    // Slanted top edge
    `L ${x + w - r} ${topRightStartY}`,
    // Top-right rounded corner into the right wall
    `Q ${x + w} ${topRightStartY} ${x + w} ${rightAfterRound}`,
    // Right side down to bottom-right round
    `L ${x + w} ${bottomY - r}`,
    `Q ${x + w} ${bottomY} ${x + w - r} ${bottomY}`,
    // Bottom edge
    `L ${x + r} ${bottomY}`,
    `Q ${x} ${bottomY} ${x} ${bottomY - r}`,
    // Left side back up
    "Z",
  ].join(" ");
}

export function renderStatusBarShape(
  props: any,
  color: string,
  selected: boolean,
  dimmed: boolean,
  theme: "light" | "dark",
) {
  const x = props.x ?? 0;
  const rawH = props.height ?? 0;
  const w = props.width ?? 0;
  const plotBottom = (props.y ?? 0) + rawH;
  const fillRatio =
    props.payload &&
    typeof props.payload === "object" &&
    "fill" in props.payload
      ? Math.max(0, Math.min(1, Number(props.payload.fill)))
      : 0;
  const fullH = fillRatio > 0 ? rawH / fillRatio : Math.max(rawH, MIN_BAR_PX);
  const h = Math.max(rawH, MIN_BAR_PX);
  const y = plotBottom - h;
  const radius = Math.min(10, w / 2);
  const trackY = plotBottom - fullH;
  const trackColor = statusTrackColor(color, theme);
  const opacity = dimmed ? 0.68 : 1;
  const barPath = slantedBarPath(x, y, w, h, radius);
  const trackPath = slantedBarPath(x, trackY, w, fullH, radius);
  const glowId = `vh-bar-glow-${String(color || "c").replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <g className="agri-status-bar-shape" style={{ opacity }}>
      <defs>
        <filter
          id={glowId}
          x="-60%"
          y="-40%"
          width="220%"
          height="180%"
          filterUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation="3.2"
            result="blur"
          />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 0.55 0"
            result="soft"
          />
          <feMerge>
            <feMergeNode in="soft" />
          </feMerge>
        </filter>
      </defs>
      <path d={trackPath} fill={trackColor} />
      {/* Soft bloom behind the filled bar (same approach as line chart). */}
      <path
        d={barPath}
        fill={color}
        filter={`url(#${glowId})`}
        style={{ pointerEvents: "none" }}
      />
      <path d={barPath} fill={color} />
      {selected ? (
        <path
          d={barPath}
          fill="none"
          stroke={color}
          strokeWidth={2.25}
          style={{ pointerEvents: "none" }}
        />
      ) : null}
    </g>
  );
}

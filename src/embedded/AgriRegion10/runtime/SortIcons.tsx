import { React } from "jimu-core";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "agri-v11-regional-sort-icon",
  "aria-hidden": true,
};

/** Cloned from ../assets/arrow-down-wide-narrow.svg (lucide ArrowDownWideNarrow) */
export const SortDescIcon = () => (
  <svg {...iconProps}>
    <path d="m3 16 4 4 4-4" />
    <path d="M7 20V4" />
    <path d="M11 4h10" />
    <path d="M11 8h7" />
    <path d="M11 12h4" />
  </svg>
);

/** Cloned from ../assets/arrow-up-wide-narrow.svg (lucide ArrowUpWideNarrow) */
export const SortAscIcon = () => (
  <svg {...iconProps}>
    <path d="m3 8 4-4 4 4" />
    <path d="M7 4v16" />
    <path d="M11 12h10" />
    <path d="M11 16h7" />
    <path d="M11 20h4" />
  </svg>
);

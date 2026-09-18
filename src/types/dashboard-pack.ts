/**
 * Shared dashboard data contract for Agro_widgetV5.
 *
 * Controllers publish a DashboardPack; panels may consume matching slices
 * instead of issuing duplicate ArcGIS stats queries. Panel UI state and
 * click handlers stay local — only the stats payload is shared.
 */
export type DashboardPackPhase =
  | "idle"
  | "warming"
  | "loading-stats"
  | "ready"
  | "error";

export type DashboardFilterSlice = {
  yil: string;
  viloyat: string;
  tuman: string;
  turi: string;
  turlar: string[];
  vh: string;
  lockedViloyat: string;
  filterPieByVh: boolean;
};

export type DashboardRegionRow = {
  name: string;
  maydon: number;
  percentage?: number;
};

export type DashboardRegionPack = {
  view: "viloyat" | "tuman";
  groupField: string;
  where: string;
  rows: DashboardRegionRow[];
  totalArea: number;
};

export type DashboardPieRow = {
  key: string;
  value: number;
};

export type DashboardPiePack = {
  where: string;
  categoryField: string;
  rows: DashboardPieRow[];
  totalValue: number;
};

/** Default dashboard indicator: sum(maydon) on Agri_table_data (no VH). */
export type DashboardIndicatorPack = {
  where: string;
  statOperation: "sum";
  attributeField: string;
  value: number;
};

/**
 * Graff regional vegetation timeseries (no VH / no polygon uniqueid).
 * scopeKey matches GraffPanel fetchRegionalTimeseries requestKey.
 */
export type DashboardGraffPack = {
  scopeKey: string;
  region: number | null;
  district: number | null;
  cropIds: string[];
  startDate: string;
  endDate: string;
  rows: Array<Record<string, any>>;
};

/**
 * Polygon Graff series slice — panel-owned in stage 1.
 * Controller always leaves this null (no TIFF / series prefetch).
 * uniqueid is intentionally NOT on DashboardFilterSlice so polygon clicks
 * do not invalidate Region/Pie/Indicator packs.
 */
export type DashboardGraffPolygonPack = {
  scopeKey: string;
  uniqueid: string;
  regionId: number | null;
  year: number | null;
  rows: Array<Record<string, any>>;
  availableDates?: string[];
};

export type DashboardPack = {
  phase: DashboardPackPhase;
  /** Stable key for the filter slice that produced this pack. */
  key: string;
  filter: DashboardFilterSlice;
  updatedAt: number;
  error?: string | null;
  region: DashboardRegionPack | null;
  pie: DashboardPiePack | null;
  indicator: DashboardIndicatorPack | null;
  graff: DashboardGraffPack | null;
  graffPolygon: DashboardGraffPolygonPack | null;
  /**
   * When true, VH / uniqueid scoping requires panel-owned queries.
   * Pack still marks ready after warmup so UI can proceed.
   */
  statsDeferredToPanels: boolean;
};

export function emptyDashboardPack(
  partial?: Partial<DashboardPack>,
): DashboardPack {
  return {
    phase: "idle",
    key: "",
    filter: {
      yil: "",
      viloyat: "",
      tuman: "",
      turi: "",
      turlar: [],
      vh: "",
      lockedViloyat: "",
      filterPieByVh: false,
    },
    updatedAt: Date.now(),
    error: null,
    region: null,
    pie: null,
    indicator: null,
    graff: null,
    graffPolygon: null,
    statsDeferredToPanels: false,
    ...partial,
  };
}

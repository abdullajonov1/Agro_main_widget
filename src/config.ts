import { type ImmutableObject } from "jimu-core";

export interface AgriPopupConfig {
  fieldsToShow?: string[];
  titleField?: string;
  labels?: Record<string, string>;
  settings?: {
    zoomToSelection?: boolean;
    showMapPopup?: boolean;
    showAttachments?: boolean;
  };
  selectedFieldsMap?: unknown;
  chartEnabled?: boolean;
  chartType?: "bar" | "line";
  chartTitle?: string;
  chartFields?: string[];
  chartColor?: string;
}

export interface IndicatorChildConfig {
  useApiDataSource?: boolean;
  apiEndpoint?: string;
  apiUrl?: string;
  responseField?: string;
  statOperation?: "count" | "sum" | "avg" | "min" | "max" | "first";
  attributeField?: string;
  label?: string;
  unitLabel?: string;
  decimalPlaces?: number;
  excludeZeroValues?: boolean;
  mapOverlayMode?: boolean;
}

export interface AccessRule {
  id: string;
  operator: "equal" | "range" | "include" | "like";
  value?: string;
  from?: string;
  to?: string;
  values?: string[];
  groups: string[];
}

export interface AccessFieldRule {
  id: string;
  title: string;
  field: string;
  rules: AccessRule[];
}

export interface AccessConfig {
  fullAccessGroups: string[];
  rules: AccessFieldRule[];
}

export interface Config {
  leftPanelWidthPercent?: number;
  bottomRowFraction?: number;
  /** Web Map data source used by the map rendered inside this widget. */
  webMapDataSourceId?: string;
  indicator?: IndicatorChildConfig;
  agriPopup?: AgriPopupConfig;
  accessConfig?: AccessConfig;
}

export type IMConfig = ImmutableObject<Config>;

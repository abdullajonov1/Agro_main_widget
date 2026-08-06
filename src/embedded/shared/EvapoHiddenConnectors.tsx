/** @jsx jsx */
import {
  DataSourceComponent,
  jsx,
  type DataSource,
  type QueriableDataSource,
} from "jimu-core";
import { JimuMapViewComponent, type JimuMapView } from "jimu-arcgis";
import { toPlainArray } from "./evapo-data-source-engine";

interface Props {
  useDataSources?: any;
  useMapWidgetIds?: any;
  onDataSourceCreated?: (ds: QueriableDataSource) => void;
  onActiveViewChange?: (jimuMapView: JimuMapView) => void;
}

/** Hidden DataSource + Map connectors (same pattern as LocalizationWidgetV20).
 * Only connect the first useDataSource — mounting all ~30+ region FeatureServers
 * on every child remount floods Network with FeatureServer?f=json loads and
 * does not help map hit-testing (live MapView layers are used instead). */
export function EvapoHiddenConnectors(props: Props): JSX.Element {
  const selectedUseDataSources = toPlainArray<any>(props.useDataSources);
  const mapWidgetId = toPlainArray<string>(props.useMapWidgetIds)[0];
  const primaryDs = selectedUseDataSources[0];

  return (
    <div style={{ display: "none" }} aria-hidden="true">
      {primaryDs ? (
        <DataSourceComponent
          key={primaryDs?.dataSourceId}
          useDataSource={primaryDs}
          onDataSourceCreated={
            props.onDataSourceCreated
              ? (ds: DataSource) => {
                  props.onDataSourceCreated?.(ds as QueriableDataSource);
                }
              : undefined
          }
        />
      ) : null}
      {mapWidgetId && (
        <JimuMapViewComponent
          useMapWidgetId={mapWidgetId}
          onActiveViewChange={props.onActiveViewChange}
        />
      )}
    </div>
  );
}

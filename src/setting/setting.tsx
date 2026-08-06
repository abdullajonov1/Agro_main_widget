import {
  DataSourceManager,
  DataSourceTypes,
  Immutable,
  React,
  type UseDataSource,
} from "jimu-core";
import { type AllWidgetSettingProps } from "jimu-for-builder";
import { ArcGISDataSourceTypes } from "jimu-arcgis";
import { DataSourceSelector } from "jimu-ui/advanced/data-source-selector";
import { Label, NumericInput, Switch, TextInput } from "jimu-ui";
import { type IMConfig } from "../config";
import AgriPopupSettingPanel from "./agri-popup-setting";
import AgriAccessSettingPanel from "./agri-access-setting";

/** jimu-core re-exports seamless-immutable as a namespace; cast for callable use. */
const Imm = Immutable as unknown as <T>(val: T) => any;

export default class Setting extends React.PureComponent<
  AllWidgetSettingProps<IMConfig>
> {
  private readonly mapSettingsRef = React.createRef<HTMLDivElement>();
  private readonly supportedTypes = Imm([
    DataSourceTypes.FeatureLayer,
    DataSourceTypes.MapService,
  ]);
  private readonly webMapTypes = Imm([ArcGISDataSourceTypes.WebMap]);

  componentDidMount(): void {
    window.addEventListener(
      "agri-main:map-settings-request",
      this.onMapSettingsRequest as EventListener,
    );
  }

  componentWillUnmount(): void {
    window.removeEventListener(
      "agri-main:map-settings-request",
      this.onMapSettingsRequest as EventListener,
    );
  }

  private onMapSettingsRequest = (event: CustomEvent<{ widgetId?: string }>): void => {
    if (event.detail?.widgetId !== this.props.id) return;
    this.mapSettingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    this.mapSettingsRef.current?.classList.add("agri-map-settings-active");
    window.setTimeout(
      () => this.mapSettingsRef.current?.classList.remove("agri-map-settings-active"),
      1200,
    );
  };

  private ensureConfig() {
    return (
      this.props.config ??
      Imm({
        leftPanelWidthPercent: 25,
        bottomRowFraction: 38,
        indicator: {
          useApiDataSource: false,
          statOperation: "sum",
          attributeField: "maydon",
          label: "Ekin maydonlari",
          unitLabel: "ga",
          decimalPlaces: 0,
          excludeZeroValues: true,
        },
        agriPopup: {
          fieldsToShow: [],
          titleField: "",
          labels: {},
          settings: {
            zoomToSelection: true,
            showMapPopup: false,
            showAttachments: true,
          },
          chartEnabled: false,
          chartType: "bar",
          chartTitle: "",
          chartFields: [],
          chartColor: "#00a8e8",
        },
      })
    );
  }

  private updateConfig(patch: Record<string, unknown>): void {
    const current = this.ensureConfig();
    const next = current.merge(patch as any);
    this.props.onSettingChange({
      id: this.props.id,
      config: next,
    });
  }

  private updateIndicator(patch: Record<string, unknown>): void {
    const current = this.ensureConfig();
    const indicator = (current as any).indicator?.merge
      ? (current as any).indicator.merge(patch)
      : Imm({ ...(current as any).indicator, ...patch });
    this.props.onSettingChange({
      id: this.props.id,
      config: current.set("indicator", indicator),
    });
  }

  private toPlainArray(value: unknown): unknown[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof (value as any).asMutable === "function") {
      return (value as any).asMutable({ deep: true });
    }
    if (typeof (value as any).toArray === "function") {
      return (value as any).toArray();
    }
    return [];
  }

  private onDataSourceChange = (useDataSources: unknown): void => {
    const webMapId = String((this.ensureConfig() as any).webMapDataSourceId || "");
    const webMapSource = this.toPlainArray(this.props.useDataSources).find(
      (source: any) => source?.dataSourceId === webMapId,
    );
    this.props.onSettingChange({
      id: this.props.id,
      useDataSources: [
        ...this.toPlainArray(useDataSources),
        ...(webMapSource ? [webMapSource] : []),
      ] as UseDataSource[],
    });
  };

  private onWebMapChange = (next: UseDataSource[]): void => {
    const current = this.toPlainArray(this.props.useDataSources) as UseDataSource[];
    const previousId = String((this.ensureConfig() as any).webMapDataSourceId || "");
    const selected = next?.[0];
    const merged = current.filter((source) => source.dataSourceId !== previousId);
    if (selected && !merged.some((source) => source.dataSourceId === selected.dataSourceId)) {
      merged.push(selected);
    }
    this.props.onSettingChange({
      id: this.props.id,
      useDataSources: merged,
      config: this.ensureConfig().set("webMapDataSourceId", selected?.dataSourceId || ""),
    });
  };

  render() {
    const cfg = this.ensureConfig();
    const indicator = (cfg as any).indicator || Imm({});
    const allSources = this.toPlainArray(this.props.useDataSources) as UseDataSource[];
    const webMapId = String((cfg as any).webMapDataSourceId || "");
    const webMapSource = allSources.find((source) => source.dataSourceId === webMapId);
    const featureSources = allSources.filter((source) => {
      const ds = DataSourceManager.getInstance().getDataSource(source.dataSourceId);
      return ds?.type !== ArcGISDataSourceTypes.WebMap && source.dataSourceId !== webMapId;
    });

    return (
      <div style={{ padding: 16 }}>
        <h4 style={{ marginBottom: 10 }}>AgriDashboard</h4>
        <p style={{ marginBottom: 14, fontSize: 12, color: "#5b6b7a" }}>
          Self-contained dashboard (embedded copies of all Agri3 child widgets).
          Layout: AgriLocalization header, AgriRegion10 + map on top,
          AgriPie10 / AgriGraff10 / AgriBar10 on bottom, AgriIndicator10 on
          the map. Does not require standalone Agri3 widgets on the page.
          The map is built into this widget. Select an ArcGIS Web Map and any
          additional feature layers below; no separate Map widget is required.
        </p>

        <div
          ref={this.mapSettingsRef}
          style={{ marginBottom: 14, padding: 10, borderRadius: 6 }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Xarita sozlamalari</div>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>ArcGIS Web Map</div>
          <div style={{ marginBottom: 7, fontSize: 12, color: "#5b6b7a" }}>
            Optional. If none is selected, an ArcGIS topographic basemap opens automatically.
          </div>
          <DataSourceSelector
            mustUseDataSource={false}
            types={this.webMapTypes}
            useDataSources={Imm(webMapSource ? [webMapSource] : [])}
            onChange={this.onWebMapChange}
            widgetId={this.props.id}
            hideDataView
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Data sources (Feature layers)
          </div>
          <DataSourceSelector
            mustUseDataSource
            types={this.supportedTypes}
            useDataSources={Imm(featureSources)}
            onChange={this.onDataSourceChange}
            widgetId={this.props.id}
            hideDataView
            isMultiple
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <Label style={{ display: "block", marginBottom: 6 }}>
            Left panel width (%)
          </Label>
          <NumericInput
            min={18}
            max={45}
            size="sm"
            value={cfg.leftPanelWidthPercent || 25}
            onAcceptValue={(value) =>
              this.updateConfig({ leftPanelWidthPercent: value })
            }
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <Label style={{ display: "block", marginBottom: 6 }}>
            Bottom row height (%)
          </Label>
          <NumericInput
            min={28}
            max={55}
            size="sm"
            value={cfg.bottomRowFraction || 38}
            onAcceptValue={(value) =>
              this.updateConfig({ bottomRowFraction: value })
            }
          />
        </div>

        <AgriPopupSettingPanel {...this.props} />

        <AgriAccessSettingPanel {...this.props} />

        <h5 style={{ margin: "16px 0 8px" }}>Map overlay indicator (API)</h5>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <Switch
            checked={indicator.useApiDataSource !== false}
            onChange={(e) =>
              this.updateIndicator({
                useApiDataSource: (e.target as HTMLInputElement).checked,
              })
            }
          />
          <span>Use API data source</span>
        </label>

        <div style={{ marginBottom: 10 }}>
          <Label style={{ display: "block", marginBottom: 6 }}>
            API endpoint
          </Label>
          <TextInput
            size="sm"
            value={indicator.apiEndpoint || ""}
            onChange={(e) =>
              this.updateIndicator({
                apiEndpoint: (e.target as HTMLInputElement).value,
              })
            }
            placeholder="https://apisoil.sgm.uzspace.uz/api/v1/..."
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <Label style={{ display: "block", marginBottom: 6 }}>
            Response field
          </Label>
          <TextInput
            size="sm"
            value={indicator.responseField || "total"}
            onChange={(e) =>
              this.updateIndicator({
                responseField: (e.target as HTMLInputElement).value,
              })
            }
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <Label style={{ display: "block", marginBottom: 6 }}>Label</Label>
          <TextInput
            size="sm"
            value={indicator.label || "Ekin maydonlari"}
            onChange={(e) =>
              this.updateIndicator({
                label: (e.target as HTMLInputElement).value,
              })
            }
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <Label style={{ display: "block", marginBottom: 6 }}>Unit</Label>
          <TextInput
            size="sm"
            value={indicator.unitLabel || "ga"}
            onChange={(e) =>
              this.updateIndicator({
                unitLabel: (e.target as HTMLInputElement).value,
              })
            }
          />
        </div>
      </div>
    );
  }
}

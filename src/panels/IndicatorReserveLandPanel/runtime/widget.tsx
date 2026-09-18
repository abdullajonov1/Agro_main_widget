// Reserve Land Indicator — standalone widget, independent of AgriIndicator10.
// Shows sum(maydon) from the current reserve-land inventory.
// All reserve-layer-compatible dashboard filters apply.

import { AllWidgetProps, React } from "jimu-core";
import AgriDashboardSpinner from "../../../shared/AgriDashboardSpinner";
import AgriAnimatedCount from "../../../shared/AgriAnimatedCount";
import { getAgriReserveLandLayer } from "../../../gis/agri-reserve-land-data-source";
import { withAgriAccessWhere } from "../../../gis/feature-layer-data";
import {
  escapeArcGIS,
  escapeLikeLiteral,
  eqAposSmart,
  normalizeApos,
} from "../../../data/agri-sql";
import { bindMasterFilter } from "../../../data/agri-filter-bus";
import { getTuriCropLookupKey } from "../../../shared/agri-crop-labels";
import { queryIndicatorOutStat } from "../../../data/agri-indicator-stats";
import {
  detectIsDarkTheme,
  normalizeLanguage,
  resolveInitialLanguage,
  type AgriLanguage,
} from "../../../shared/agri-language";
import { isStaleMasterFilterEvent } from "../../../shared/agri-indicator-common";

import "../../IndicatorPanel/runtime/KadastrIndicator.css";

/** Logger disabled — keep call sites without console noise. */
function agriLog(_phase: string, _detail?: Record<string, unknown>): void {
  /* no-op */
}

interface State {
  value: number | null;
  loading: boolean;
  error: string | null;

  yil: string;
  viloyat: string;
  tuman: string;
  turlar: string[];
  uniqueid: string;
  lockedViloyat: string | null;

  layer: __esri.FeatureLayer | null;
  connectionStatus: "idle" | "connecting" | "connected" | "failed";

  isDarkTheme: boolean;
  language: AgriLanguage;
}

export default class AgriIndicatorReserveLand extends React.PureComponent<
  AllWidgetProps<any>,
  State
> {
  private _isMounted = false;
  private _unbindMasterFilter: (() => void) | null = null;
  private _requestId = 0;
  private _cropIdMapPromise: Promise<Map<string, string[]>> | null = null;
  private _lastMasterFilterTs = 0;
  private _lastMasterFilterBroadcastGeneration = 0;
  /** Do not query until master filter (incl. yil) has been received once. */
  private _hasMasterFilter = false;

  constructor(props: AllWidgetProps<any>) {
    super(props);
    this.state = {
      value: null,
      loading: true,
      error: null,

      yil: "",
      viloyat: "",
      tuman: "",
      turlar: [],
      uniqueid: "",
      lockedViloyat: null,

      layer: null,
      connectionStatus: "idle",

      isDarkTheme: detectIsDarkTheme(),
      language: resolveInitialLanguage(),
    };
  }

  componentDidMount(): void {
    this._isMounted = true;
    this._unbindMasterFilter = bindMasterFilter(this.handleMasterFilterChanged);
    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.addEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
    );

    this.setState({ connectionStatus: "connecting" });
    getAgriReserveLandLayer()
      .then(({ layer }) => {
        if (!this._isMounted) return;
        this.setState({ layer: layer as any, connectionStatus: "connected" }, () => {
          // Only query after year filter is known — otherwise the unscoped
          // sum flashes briefly, then drops to 0 when an empty year arrives.
          if (this._hasMasterFilter) this.fetchValue();
        });
      })
      .catch((err) => {
        if (!this._isMounted) return;
        this.setState({
          connectionStatus: "failed",
          loading: false,
          error: String(err?.message || err),
        });
      });
  }

  componentWillUnmount(): void {
    this._isMounted = false;
    this._unbindMasterFilter?.();
    this._unbindMasterFilter = null;
    document.removeEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.removeEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
    );
  }

  private handleThemeChange = (event: any): void => {
    const detail = (event as CustomEvent)?.detail;
    if (detail?.theme) {
      this.setState({ isDarkTheme: detail.theme === "dark" });
    } else {
      this.setState({ isDarkTheme: detectIsDarkTheme() });
    }
  };

  private handleLanguageChange = (event: Event): void => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent)?.detail || {};
    const next = normalizeLanguage(d.lang ?? d.language ?? d.code);
    if (next !== this.state.language) this.setState({ language: next });
  };

  private normalizeTurlar = (raw: unknown, fallback = ""): string[] => {
    const values = Array.isArray(raw) ? raw : fallback ? [fallback] : [];
    return Array.from(
      new Set(
        values
          .map((value) => normalizeApos(String(value || "").trim()))
          .filter(Boolean),
      ),
    );
  };

  private buildStringInClause = (field: string, values: string[]): string => {
    const normalized = Array.from(
      new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
    );
    if (!normalized.length) return "";
    if (normalized.length === 1) return eqAposSmart(field, normalized[0]);
    return `${field} IN (${normalized
      .map((value) => `'${escapeArcGIS(value)}'`)
      .join(",")})`;
  };

  private handleMasterFilterChanged = (event: Event): void => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent).detail || {};
    if (!d?.filters) return;

    const eventTs =
      typeof d?.meta?.timestamp === "number" && Number.isFinite(d.meta.timestamp)
        ? d.meta.timestamp
        : 0;
    const eventGen =
      typeof d?.meta?.broadcastGeneration === "number" &&
      Number.isFinite(d.meta.broadcastGeneration)
        ? d.meta.broadcastGeneration
        : 0;
    if (
      isStaleMasterFilterEvent(eventTs, eventGen, {
        lastMasterFilterTs: this._lastMasterFilterTs,
        lastMasterFilterBroadcastGeneration:
          this._lastMasterFilterBroadcastGeneration,
      })
    ) {
      return;
    }
    if (eventGen > 0) this._lastMasterFilterBroadcastGeneration = eventGen;
    if (eventTs > 0) this._lastMasterFilterTs = eventTs;

    const f = d.filters;
    const nextYil = (f.yil ?? "").toString();
    const nextViloyat = normalizeApos(f.viloyat || "");
    const nextTuman = normalizeApos(f.tuman || "");
    const nextTurlar = this.normalizeTurlar(
      f.turlar,
      f.turi || f.tur || "",
    );
    const nextUniqueid = f.polygonMode
      ? String(f.uniqueid || "").trim()
      : "";
    const nextLocked = d?.scope?.lockedViloyat
      ? normalizeApos(String(d.scope.lockedViloyat))
      : null;

    const firstFilter = !this._hasMasterFilter;
    this._hasMasterFilter = true;

    const changed =
      firstFilter ||
      nextYil !== this.state.yil ||
      nextViloyat !== this.state.viloyat ||
      nextTuman !== this.state.tuman ||
      JSON.stringify(nextTurlar) !== JSON.stringify(this.state.turlar) ||
      nextUniqueid !== this.state.uniqueid ||
      nextLocked !== this.state.lockedViloyat;

    if (!changed) return;

    this.setState(
      {
        yil: nextYil,
        viloyat: nextViloyat,
        tuman: nextTuman,
        turlar: nextTurlar,
        uniqueid: nextUniqueid,
        lockedViloyat: nextLocked,
      },
      () => this.fetchValue(),
    );
  };

  private extractYear = (raw: unknown): string =>
    String(raw ?? "").match(/\b(18|19|20)\d{2}\b/)?.[0] ??
    String(raw ?? "").replace(/[^\d]/g, "");

  private makeCropKey = (raw: unknown): string =>
    getTuriCropLookupKey(raw);

  private getCropIdMap = async (
    layer: __esri.FeatureLayer,
  ): Promise<Map<string, string[]>> => {
    if (!this._cropIdMapPromise) {
      this._cropIdMapPromise = (async () => {
        try {
          const q = layer.createQuery();
          q.where = "1=1";
          q.groupByFieldsForStatistics = ["turi", "crop_id"];
          q.outStatistics = [
            {
              statisticType: "count",
              onStatisticField: layer.objectIdField || "objectid",
              outStatisticFieldName: "cnt",
            },
          ] as any;
          q.returnGeometry = false;
          const response = await layer.queryFeatures(q);
          const rows = (response?.features || []).map((feature: any) => ({
            turi: String(feature?.attributes?.turi || "").trim(),
            cropId: String(feature?.attributes?.crop_id || "").trim(),
          }));
          const idsByTuri = new Map<string, Set<string>>();
          for (const row of rows) {
            const key = this.makeCropKey(row.turi);
            const cropId = String(row.cropId || "").trim();
            if (!key || !cropId) continue;
            if (!idsByTuri.has(key)) idsByTuri.set(key, new Set<string>());
            idsByTuri.get(key)!.add(cropId);
          }
          const result = new Map<string, string[]>();
          idsByTuri.forEach((ids, key) => result.set(key, Array.from(ids)));
          agriLog("crop-id-map:loaded", {
            turiCount: result.size,
            rowCount: rows.length,
            mappings: Array.from(result.entries()),
          });
          return result;
        } catch (error: any) {
          agriLog("crop-id-map:FAILED", {
            error: String(error?.message || error),
          });
          return new Map<string, string[]>();
        }
      })();
    }
    return this._cropIdMapPromise;
  };

  private resolveCropIds = (
    turlar: string[],
    cropIdMap: Map<string, string[]>,
  ): string[] =>
    Array.from(
      new Set(
        turlar.flatMap(
          (turi) => cropIdMap.get(this.makeCropKey(turi)) || [],
        ),
      ),
    );

  private buildWhere(
    cropIds: string[],
    cropFilterRequested: boolean,
  ): string {
    const { yil, viloyat, tuman, uniqueid, lockedViloyat } = this.state;
    const clauses: string[] = [];

    const year = this.extractYear(yil);
    if (!year) return withAgriAccessWhere("1=0");
    clauses.push(`yil LIKE '${escapeLikeLiteral(year)}%'`);

    const effectiveViloyat = lockedViloyat || viloyat;
    if (effectiveViloyat) {
      clauses.push(eqAposSmart("viloyat", effectiveViloyat));
    }
    if (tuman) clauses.push(eqAposSmart("tuman", tuman));

    if (cropFilterRequested) {
      const cropIdClause = this.buildStringInClause("crop_id", cropIds);
      clauses.push(cropIdClause || "1=0");
    }

    if (uniqueid) clauses.push(eqAposSmart("uniqueid", uniqueid));

    return withAgriAccessWhere(clauses.join(" AND "));
  }

  private fetchValue = async (): Promise<void> => {
    const { layer, connectionStatus, yil } = this.state;
    if (!layer || connectionStatus !== "connected") return;
    if (!this._hasMasterFilter) return;

    // Match Yield/Unused — never query the full table with an empty year.
    if (!String(yil || "").match(/\b(18|19|20)\d{2}\b/)) {
      this.setState({ value: null, loading: true, error: null });
      return;
    }

    const requestId = ++this._requestId;
    this.setState({ error: null, loading: true });

    try {
      const cropIdMap = await this.getCropIdMap(layer);
      if (!this._isMounted || requestId !== this._requestId) return;
      const cropIds = this.resolveCropIds(this.state.turlar, cropIdMap);
      const cropFilterRequested = this.state.turlar.length > 0;
      if (cropFilterRequested) {
        agriLog("crop-filter:resolved", {
          selectedTurlar: this.state.turlar,
          cropIds,
          allMapped: cropIds.length > 0,
        });
      }
      const where = this.buildWhere(cropIds, cropFilterRequested);

      agriLog("query:request", {
        url: (layer as any)?.url,
        where,
        outStatistics: [
          {
            onStatisticField: "maydon",
            statisticType: "sum",
            outStatisticFieldName: "agg",
          },
        ],
      });

      // Reserve card treats missing aggregate as 0 ha (not "-").
      const raw = await queryIndicatorOutStat({
        layer,
        where,
        statisticType: "sum",
        onStatisticField: "maydon",
      });
      if (!this._isMounted || requestId !== this._requestId) return;

      agriLog("query:response", {
        where,
        rawAgg: raw,
        sumMaydon: raw,
        matchedZeroRows: raw === 0,
      });
      this.setState({
        value: Number.isFinite(raw) ? raw : 0,
        loading: false,
        error: null,
      });
    } catch (e: any) {
      if (!this._isMounted || requestId !== this._requestId) return;
      this.setState({ loading: false, value: null, error: null });
    }
  };

  render() {
    const { value, loading, error, isDarkTheme, language } = this.state;

    const label =
      language === "en"
        ? "Reserve land"
        : language === "ru"
        ? "Резервные земли"
        : language === "uz_lat"
          ? "Zaxira maydonlari"
          : "Захира майдонлари";

    const unit = language === "en" ? "ha" : language === "uz_lat" ? "ga" : "га";

    const themeClass = isDarkTheme ? "dark-theme" : "light-theme";
    const showBlockingLoader =
      !error &&
      value == null &&
      (loading ||
        !String(this.state.yil || "").match(/\b(18|19|20)\d{2}\b/));
    const connectionFailed =
      this.state.connectionStatus === "failed" && !!error && value == null;

    return (
      <div
        className={`vegetation-stats-widget ${themeClass} map-overlay-mode`}
        data-ind-size="sm"
      >
        {showBlockingLoader ? (
          <div className="loading-indicator">
            <AgriDashboardSpinner compact size={40} />
          </div>
        ) : (
          <div className="widget-content">
            <div className="stat-main">
              <div className="stat-label">{label}</div>
              <div className="stat-value">
                {connectionFailed ? (
                  <span title={String(error || "")}>-</span>
                ) : (
                  <AgriAnimatedCount value={value} emptyFallback="-" />
                )}
                <span className="unit">{unit}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

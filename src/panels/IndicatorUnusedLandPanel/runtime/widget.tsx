// Unused Land Indicator — standalone widget, independent of AgriIndicator10.
// Shows sum(maydon) from Agri_unused_land, scoped by the same master yil/viloyat/tuman filters.

import { AllWidgetProps, React } from "jimu-core";
import AgriDashboardSpinner from "../../../shared/AgriDashboardSpinner";
import AgriAnimatedCount from "../../../shared/AgriAnimatedCount";
import { getAgriUnusedLandLayer } from "../../../gis/agri-unused-land-data-source";
import { eqAposSmart, normalizeApos } from "../../../data/agri-sql";
import { buildIndicatorStatsWhere } from "../../../controller/agri-where-builder";
import { bindMasterFilter } from "../../../data/agri-filter-bus";
import { queryIndicatorOutStatNullable } from "../../../data/agri-indicator-stats";
import { normalizeTurlarListSql } from "../../../data/agri-turlar";
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

export default class AgriIndicatorUnusedLand extends React.PureComponent<
  AllWidgetProps<any>,
  State
> {
  private _isMounted = false;
  private _unbindMasterFilter: (() => void) | null = null;
  private _requestId = 0;
  private _lastMasterFilterTs = 0;
  private _lastMasterFilterBroadcastGeneration = 0;

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
    getAgriUnusedLandLayer()
      .then(({ layer }) => {
        if (!this._isMounted) return;
        this.setState({ layer: layer as any, connectionStatus: "connected" }, () =>
          this.fetchValue(),
        );
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

  private normalizeTurlar = (raw: unknown, fallback = ""): string[] =>
    normalizeTurlarListSql(raw, fallback);

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

    const changed =
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

  private buildWhere(): string {
    const { yil, viloyat, tuman, turlar, uniqueid, lockedViloyat } = this.state;
    if (!yil) return "1=0";

    let where = buildIndicatorStatsWhere(
      {
        yil,
        viloyat: lockedViloyat || viloyat || "",
        tuman: tuman || "",
        turlar: turlar || [],
      },
      { includeViloyat: true },
    );

    if (uniqueid) {
      where = `(${where}) AND (${eqAposSmart("uniqueid", uniqueid)})`;
    }

    return where;
  }

  private fetchValue = async (): Promise<void> => {
    const { layer, connectionStatus, yil } = this.state;
    if (!layer || connectionStatus !== "connected") return;

      if (!yil) {
      this.setState({ value: null, loading: true, error: null });
      return;
    }

    const requestId = ++this._requestId;
    this.setState({ error: null });
    if (this.state.value == null) {
      this.setState({ loading: true });
    }

    try {
      const where = this.buildWhere();

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

      const raw = await queryIndicatorOutStatNullable({
        layer,
        where,
        statisticType: "sum",
        onStatisticField: "maydon",
      });
      if (!this._isMounted || requestId !== this._requestId) return;

      // null aggregate means no matching data; keep it distinct from a real zero.
      agriLog("query:response", {
        where,
        rawAgg: raw,
        sumMaydon: raw,
        matchedZeroRows: raw == null,
      });
      this.setState({
        value: raw != null && Number.isFinite(raw) ? raw : null,
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
        ? "Unused land"
        : language === "ru"
        ? "Неиспользуемые земли"
        : language === "uz_lat"
          ? "Foydalanilmagan yer"
          : "Фойдаланилмаган ер";

    const unit = language === "en" ? "ha" : language === "uz_lat" ? "ga" : "га";

    const themeClass = isDarkTheme ? "dark-theme" : "light-theme";
    const showBlockingLoader =
      !error &&
      value == null &&
      (loading || !(this.state.yil || "").trim());
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

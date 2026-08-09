// Average Yield Indicator — standalone widget, independent of AgriIndicator10.
// Shows avg(yld) from Agri_table_data, scoped by the same master yil/viloyat/tuman filters.

import { AllWidgetProps, React } from "jimu-core";
import AgriDashboardSpinner from "../../../shared/AgriDashboardSpinner";
import AgriAnimatedCount from "../../../shared/AgriAnimatedCount";
import { getAgriTableDataLayer } from "../../shared/agri-table-data-source";
import { withEvapoAccessWhere } from "../../shared/feature-layer-data";
import "../../AgriIndicator10/runtime/KadastrIndicator.css";

// Real console reference, resolved via `window` so it isn't captured by the
// local `console` shadow below — see agriLog().
const nativeConsole: Console =
  typeof window !== "undefined" ? window.console : ({} as Console);

const console = {
  log: (..._args: any[]) => {},
  warn: (..._args: any[]) => {},
  error: (..._args: any[]) => {},
};

/** Logger disabled — keep call sites without console noise. */
function agriLog(_phase: string, _detail?: Record<string, unknown>): void {
  /* no-op */
}

type AgriLanguage = "uz_cyr" | "uz_lat" | "ru" | "en";

const AGRI3_LANG_PREF_KEY_V3 = "agri3_lang_initialized_uz_lat_v3";
const ensureAgri3UzLatLanguageDefault = (): void => {
  try {
    if (localStorage.getItem(AGRI3_LANG_PREF_KEY_V3) === "1") return;
    localStorage.setItem("app_lang", "uz_lat");
    localStorage.setItem("evapo_app_lang", "uz_lat");
    localStorage.setItem("agro_lang", "uz_lat");
    localStorage.setItem(AGRI3_LANG_PREF_KEY_V3, "1");
  } catch {
    /* ignore storage errors */
  }
};

const APOSTROPHE_VARIANTS = ["'", "’", "‘", "ʻ", "ʼ", "`"];

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

export default class AgriIndicatorYield extends React.PureComponent<
  AllWidgetProps<any>,
  State
> {
  private _isMounted = false;
  private _requestId = 0;
  private _lastMasterFilterTs = 0;
  private _lastMasterFilterBroadcastGeneration = 0;

  private normalizeLanguage = (raw?: string | null): AgriLanguage => {
    const v = String(raw || "").trim().toLowerCase();
    if (v === "en" || v === "english") return "en";
    if (v === "ru" || v === "russian") return "ru";
    if (v.startsWith("uz_cyr") || v.startsWith("uz-cyr")) return "uz_cyr";
    if (v.startsWith("uz_lat") || v.startsWith("uz-lat") || v === "uz")
      return "uz_lat";
    return "uz_lat";
  };

  private resolveInitialLanguage = (): AgriLanguage => {
    try {
      ensureAgri3UzLatLanguageDefault();
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      const fromStorage =
        localStorage.getItem("app_lang") ||
        localStorage.getItem("evapo_app_lang") ||
        localStorage.getItem("agro_lang");
      return this.normalizeLanguage(fromUrl || fromStorage);
    } catch {
      return "uz_lat";
    }
  };

  private detectIsDarkTheme = (): boolean => {
    try {
      const saved = window.localStorage?.getItem("agri_v11_app_theme");
      if (saved === "light") return false;
      if (saved === "dark") return true;
      const dom = document.documentElement.getAttribute("data-theme");
      if (dom === "light") return false;
      if (dom === "dark") return true;
    } catch {
      /* ignore */
    }
    return true;
  };

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

      isDarkTheme: this.detectIsDarkTheme(),
      language: this.resolveInitialLanguage(),
    };
  }

  componentDidMount(): void {
    this._isMounted = true;
    document.addEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChanged as EventListener,
    );
    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.addEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
    );
    document.dispatchEvent(new CustomEvent("requestMasterFilterState"));

    this.setState({ connectionStatus: "connecting" });
    getAgriTableDataLayer()
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
    document.removeEventListener(
      "masterFilterChanged",
      this.handleMasterFilterChanged as EventListener,
    );
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
      this.setState({ isDarkTheme: this.detectIsDarkTheme() });
    }
  };

  private handleLanguageChange = (event: Event): void => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent)?.detail || {};
    const next = this.normalizeLanguage(d.lang ?? d.language ?? d.code);
    if (next !== this.state.language) this.setState({ language: next });
  };

  private normalizeApos = (s: string): string =>
    (s ?? "").normalize("NFKC").replace(/['’‘ʻʼ`]/g, "'");

  private escapeArcGIS = (v: string): string =>
    v ? v.replace(/'/g, "''") : "";

  private eqAposSmart = (field: string, raw: string): string => {
    if (!raw) return "";
    const s = this.normalizeApos(String(raw).trim());
    if (!/'/.test(s)) return `${field}='${this.escapeArcGIS(s)}'`;
    const base = s.replace(/'/g, "￿");
    const parts = APOSTROPHE_VARIANTS.map((ch) => {
      const candidate = base.split("￿").join(ch);
      return `${field}='${this.escapeArcGIS(candidate)}'`;
    });
    return `(${parts.join(" OR ")})`;
  };

  private normalizeTurlar = (raw: unknown, fallback = ""): string[] => {
    const source = Array.isArray(raw)
      ? raw
      : raw
        ? [raw]
        : fallback
          ? [fallback]
          : [];
    return Array.from(
      new Set(
        source
          .map((value) => this.normalizeApos(String(value || "")))
          .filter(Boolean),
      ),
    );
  };

  private buildTurlarClause = (field: string, values: string[]): string => {
    const clauses = values
      .map((value) => this.eqAposSmart(field, value))
      .filter(Boolean);
    if (!clauses.length) return "";
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
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
      eventGen > 0 &&
      this._lastMasterFilterBroadcastGeneration > 0 &&
      eventGen < this._lastMasterFilterBroadcastGeneration
    ) {
      return;
    }
    if (
      eventTs > 0 &&
      this._lastMasterFilterTs > 0 &&
      eventTs < this._lastMasterFilterTs
    ) {
      return;
    }
    if (eventGen > 0) this._lastMasterFilterBroadcastGeneration = eventGen;
    if (eventTs > 0) this._lastMasterFilterTs = eventTs;

    const f = d.filters;
    const nextYil = (f.yil ?? "").toString();
    const nextViloyat = this.normalizeApos(f.viloyat || "");
    const nextTuman = this.normalizeApos(f.tuman || "");
    const nextTurlar = this.normalizeTurlar(
      f.turlar,
      f.turi || f.tur || "",
    );
    const nextUniqueid = f.polygonMode
      ? String(f.uniqueid || "").trim()
      : "";
    const nextLocked = d?.scope?.lockedViloyat
      ? this.normalizeApos(String(d.scope.lockedViloyat))
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

    const clauses: string[] = [];
    const yDigits =
      String(yil).match(/\b(18|19|20)\d{2}\b/)?.[0] ??
      String(yil).replace(/[^\d]/g, "");
    clauses.push(
      yDigits
        ? `yil LIKE '${yDigits}%'`
        : `yil LIKE '%${this.escapeArcGIS(String(yil))}%'`,
    );

    const effectiveViloyat = lockedViloyat || viloyat;
    if (effectiveViloyat) {
      clauses.push(this.eqAposSmart("viloyat", effectiveViloyat));
    }
    if (tuman) clauses.push(this.eqAposSmart("tuman", tuman));

    const cropClause = this.buildTurlarClause("turi", turlar);
    if (cropClause) clauses.push(cropClause);
    if (uniqueid) clauses.push(this.eqAposSmart("uniqueid", uniqueid));

    return withEvapoAccessWhere(clauses.join(" AND "));
  }

  private fetchValue = async (): Promise<void> => {
    const { layer, connectionStatus, yil } = this.state;
    if (!layer || connectionStatus !== "connected") return;

    if (!yil) {
      this.setState({ value: null, loading: false, error: null });
      return;
    }

    const requestId = ++this._requestId;
    // Keep previous value visible while refreshing — no spinner flash.
    this.setState({ error: null });

    try {
      const where = this.buildWhere();
      const q = layer.createQuery();
      q.where = where;
      q.outStatistics = [
        {
          onStatisticField: "yld",
          statisticType: "avg",
          outStatisticFieldName: "agg",
        },
      ] as any;
      q.returnGeometry = false;

      agriLog("query:request", {
        url: (layer as any)?.url,
        where,
        outStatistics: q.outStatistics,
      });

      // Only show blocking loader when we have nothing to display yet.
      if (this.state.value == null) {
        this.setState({ loading: true });
      }

      const res = await layer.queryFeatures(q);
      if (!this._isMounted || requestId !== this._requestId) return;

      const rawAgg = res?.features?.[0]?.attributes?.agg;
      const raw = rawAgg == null || rawAgg === "" ? null : Number(rawAgg);
      agriLog("query:response", {
        where,
        rawAgg,
        avgYld: raw,
        matchedZeroRows: rawAgg == null,
      });
      this.setState({
        value: raw != null && Number.isFinite(raw) ? raw : null,
        loading: false,
        error: null,
      });
    } catch (e: any) {
      if (!this._isMounted || requestId !== this._requestId) return;
      // Soft-empty on query failure — never flash ⚠️ on first paint when
      // year/filter is still settling or yld is sparse.
      this.setState({ loading: false, value: null, error: null });
    }
  };

  private formatNumber = (num: number | null): string => {
    if (num === null || num === undefined) return "-";
    return Math.round(num)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  };

  render() {
    const { value, loading, error, isDarkTheme, language } = this.state;

    const label =
      language === "en"
        ? "Average yield"
        : language === "ru"
        ? "Средняя урожайность"
        : language === "uz_lat"
          ? "O'rtacha hosildorlik"
          : "Ўртача ҳосилдорлик";

    const themeClass = isDarkTheme ? "dark-theme" : "light-theme";
    const showBlockingLoader = loading && value == null && !error;
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
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

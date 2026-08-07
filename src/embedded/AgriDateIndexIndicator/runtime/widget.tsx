// Date/Index Indicator — standalone widget, top-right of the map.
// Shows whichever date+vegetation-index is currently selected on
// AgriGraff10's chart (and that index's value for that date), purely by
// listening to the "graffDateIndexSelectionChanged" event Graff broadcasts —
// no ArcGIS queries of its own. Hidden when nothing is selected.
// Round prev/next chevrons sit outside the card and step the selected date.

import { AllWidgetProps, React } from "jimu-core";
import "../../AgriIndicator10/runtime/KadastrIndicator.css";

type AgriLanguage = "uz_cyr" | "uz_lat" | "ru" | "en";

const INDEX_COLORS: Record<string, string> = {
  ndvi: "#00d084",
  savi: "#7aa5ff",
  rvi: "#ffb347",
  ci: "#c78bff",
  evi: "#ff4d8d",
  ndwi: "#2ec4f1",
};

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

interface State {
  date: string | null;
  indexKey: string | null;
  value: number | null;
  /** Sorted YYYY-MM-DD dates for the selected polygon (for day navigation). */
  availableDates: string[];
  /** True when a polygon is selected and day chevrons should be shown. */
  navigable: boolean;

  isDarkTheme: boolean;
  language: AgriLanguage;
}

export default class AgriDateIndexIndicator extends React.PureComponent<
  AllWidgetProps<any>,
  State
> {
  private _isMounted = false;

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
      date: null,
      indexKey: null,
      value: null,
      availableDates: [],
      navigable: false,

      isDarkTheme: this.detectIsDarkTheme(),
      language: this.resolveInitialLanguage(),
    };
  }

  componentDidMount(): void {
    this._isMounted = true;
    document.addEventListener(
      "graffDateIndexSelectionChanged",
      this.handleSelectionChanged as EventListener,
    );
    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.addEventListener(
      "languageChanged",
      this.handleLanguageChange as EventListener,
    );
  }

  componentWillUnmount(): void {
    this._isMounted = false;
    document.removeEventListener(
      "graffDateIndexSelectionChanged",
      this.handleSelectionChanged as EventListener,
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

  private handleSelectionChanged = (event: Event): void => {
    if (!this._isMounted) return;
    const d: any = (event as CustomEvent)?.detail || {};

    const nextDate = d.date ? String(d.date) : null;
    const nextIndexKey = d.indexKey ? String(d.indexKey) : null;
    const nextValue = typeof d.value === "number" ? d.value : null;
    const nextLanguage = d.language
      ? this.normalizeLanguage(d.language)
      : this.state.language;
    const nextDates = Array.isArray(d.availableDates)
      ? d.availableDates
          .map((x: unknown) => String(x || "").trim())
          .filter(Boolean)
      : [];
    const nextNavigable = Boolean(d.navigable) && nextDates.length > 1;

    this.setState({
      date: nextDate,
      indexKey: nextIndexKey,
      value: nextValue,
      availableDates: nextDates,
      navigable: nextNavigable,
      language: nextLanguage,
    });
  };

  private formatValue = (num: number | null): string => {
    if (num === null || num === undefined || !Number.isFinite(num))
      return "-";
    return num.toFixed(4);
  };

  private navigateDay = (direction: -1 | 1): void => {
    const { date, availableDates, navigable } = this.state;
    if (!navigable || !date || availableDates.length < 2) return;

    const idx = availableDates.indexOf(date);
    if (idx < 0) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= availableDates.length) return;

    try {
      document.dispatchEvent(
        new CustomEvent("graffDateIndexNavigate", {
          detail: {
            date: availableDates[nextIdx],
            direction,
            source: "AgriDateIndexIndicator",
            timestamp: Date.now(),
          },
          bubbles: true,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  private handlePrevDay = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    this.navigateDay(-1);
  };

  private handleNextDay = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    this.navigateDay(1);
  };

  render() {
    const { date, indexKey, value, isDarkTheme, availableDates, navigable } =
      this.state;

    const hasSelection = !!(date && indexKey);
    if (!hasSelection) return null;

    const themeClass = isDarkTheme ? "dark-theme" : "light-theme";
    const indexColor =
      INDEX_COLORS[String(indexKey || "").toLowerCase()] || "#2ec4f1";
    const dateIdx = date ? availableDates.indexOf(date) : -1;
    const canPrev = navigable && dateIdx > 0;
    const canNext =
      navigable && dateIdx >= 0 && dateIdx < availableDates.length - 1;
    const showNav = navigable;

    return (
      <div
        className={`agri-date-index-shell ${themeClass}${
          showNav ? " has-day-nav" : ""
        }`}
        style={{ "--agri-date-index-color": indexColor } as React.CSSProperties}
      >
        {showNav ? (
          <button
            type="button"
            className="agri-date-index-nav agri-date-index-nav--prev"
            onClick={this.handlePrevDay}
            disabled={!canPrev}
            aria-label="Previous day"
            title="Previous day"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 6L9 12L15 18"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <div
          className={`vegetation-stats-widget ${themeClass} map-overlay-mode agri-date-index-card has-selection`}
          data-ind-size="sm"
        >
          <div className="widget-content">
            <div className="stat-main">
              <div className="agri-date-index-meta">
                <span className="agri-date-index-key">
                  {indexKey.toUpperCase()}
                </span>
                <span className="agri-date-index-date">{date}</span>
              </div>
              <div className="agri-date-index-value-row">
                <span className="agri-date-index-accent" aria-hidden="true" />
                <span className="stat-value">{this.formatValue(value)}</span>
              </div>
            </div>
          </div>
        </div>
        {showNav ? (
          <button
            type="button"
            className="agri-date-index-nav agri-date-index-nav--next"
            onClick={this.handleNextDay}
            disabled={!canNext}
            aria-label="Next day"
            title="Next day"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 6L15 12L9 18"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    );
  }
}

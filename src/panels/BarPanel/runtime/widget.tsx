// VH Categories Widget - Display only. Filter state from AgriFilter via shared filter store.

import { AllWidgetProps, React } from "jimu-core";
import { TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import AgriChartLoader from "../../../shared/AgriChartLoader";
import { agriNoDataLabel } from "../../../shared/agriNoDataLabel";
import { renderStatusBarShape } from "./statusBarShape";
import { bindMasterFilter } from "../../../data/agri-filter-bus";
import { agroV5Log } from "../../../gis/agri-debug-log";
import { resolveInitialLanguage } from "../../../shared/agri-language";

const BAR_ANIM_MS = 680;
const BAR_STAGGER_MS = 70;

type ChartDatum = { fill: number };

const StatusBarChart = (props: {
  fill: number;
  color: string;
  chartKey: string;
  animate: boolean;
  animIndex: number;
  selected: boolean;
  dimmed: boolean;
  theme: "light" | "dark";
}) => {
  const { fill, color, chartKey, animate, animIndex, selected, dimmed, theme } =
    props;
  const data = useMemo<ChartDatum[]>(() => [{ fill }], [fill]);
  const barShape = useMemo(
    () => (p: any) =>
      renderStatusBarShape(p, color, selected, dimmed, theme),
    [color, selected, dimmed, theme],
  );
  const toneClass = selected
    ? "agri-status-chart--selected"
    : dimmed
      ? "agri-status-chart--dimmed"
      : "";

  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      className={`agri-status-chart ${toneClass}`.trim()}
    >
      <BarChart
        key={chartKey}
        data={data}
        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
        barCategoryGap={0}
      >
        <XAxis hide />
        <YAxis domain={[0, 1]} hide />
        <Bar
          dataKey="fill"
          shape={barShape}
          isAnimationActive={animate}
          animationDuration={BAR_ANIM_MS}
          animationBegin={animIndex * BAR_STAGGER_MS}
          animationEasing="ease-in-out"
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

interface VHDataItem {
  category: string;
  label: string;
  count: number;
  fieldCount: number;
  percentage: number;
  color: string;
  order: number;
}

interface AgriBarProps extends AllWidgetProps<any> {
  externalFilters?: {
    tuman?: string;
    viloyat?: string;
    yil?: string;
    tur?: string;
  };
}

interface AgriBarState {
  loading: boolean;
  error: string | null;
  vhData: {
    categories: VHDataItem[];
    totalCount: number;
  };
  selectedViloyat: string;
  selectedYear: string;
  selectedtur: string;
  selectedturlar: string[];
  selectedTuman: string;
  selectedVHCategory: string | null;
  displayCount: number;
  sortOrder: "asc" | "desc";
  isDarkTheme: boolean;
  language: "uz_cyr" | "uz_lat" | "ru" | "en";
  lockedViloyat: string | null;
  widgetSize: "xs" | "sm" | "md" | "lg";
  compactHeight: boolean;
}

export default class AgriBar extends React.PureComponent<
  AgriBarProps,
  AgriBarState
> {
  _isMounted = false;
  private _unbindMasterFilter: (() => void) | null = null;
  private _containerRef = React.createRef<HTMLDivElement>();
  private _resizeObserver: ResizeObserver | null = null;
  /** True only after at least one VH bar payload finished (success or empty). */
  private _hasCompletedFetch = false;

  constructor(props: AgriBarProps) {
    super(props);
    this._isMounted = false;
    const initialLanguage = resolveInitialLanguage();
    this.state = {
      loading: false,
      error: null,
      vhData: { categories: [], totalCount: 0 },
      selectedViloyat: "",
      selectedYear: "",
      selectedtur: "",
      selectedturlar: [],
      selectedTuman: "",
      selectedVHCategory: null,
      displayCount: -1,
      sortOrder: "desc",
      isDarkTheme: false,
      language: initialLanguage,
      lockedViloyat: null,
      widgetSize: "lg",
      compactHeight: false,
    };
    this.handleVHSelectionClick = this.handleVHSelectionClick.bind(this);
    this.handleDisplayCountChange = this.handleDisplayCountChange.bind(this);
    this.toggleSortOrder = this.toggleSortOrder.bind(this);
    this.handleThemeChange = this.handleThemeChange.bind(this);
    this.formatNumber = this.formatNumber.bind(this);
  }

  private initializeTheme = () => {
    const savedTheme = localStorage.getItem("agri_v11_app_theme");
    const isDarkTheme = savedTheme === "dark";
    this.setState({ isDarkTheme });
  };

  private getLocalizedCategoryLabel = (
    category: string,
    language: "uz_cyr" | "uz_lat" | "ru" | "en",
  ): string => {
    const base = category.trim();
    if (base === "1-Juda yaxshi") {
      if (language === "en") return "Excellent";
      if (language === "ru") return "Очень хороший";
      if (language === "uz_lat") return "A'lo";
      return "Жуда яхши";
    }
    if (base === "2-Yaxshi") {
      if (language === "en") return "Good";
      if (language === "ru") return "Хороший";
      if (language === "uz_lat") return "Yaxshi";
      return "Яхши";
    }
    if (base === "3-O'rta") {
      if (language === "en") return "Moderate";
      if (language === "ru") return "Средний";
      if (language === "uz_lat") return "O'rta";
      return "Ўрта";
    }
    if (base === "4-Past") {
      if (language === "en") return "Poor";
      if (language === "ru") return "Низкий";
      if (language === "uz_lat") return "Past";
      return "Паст";
    }
    return category;
  };

  private handleMasterFilterChange = (event: Event) => {
    const d: any = (event as CustomEvent).detail || {};
    if (!d.filters) return;

    const nextYear = d.filters.yil || "";
    const nextLockedVil = d?.scope?.lockedViloyat
      ? String(d.scope.lockedViloyat)
      : null;
    const nextVil = nextLockedVil || d.filters.viloyat || "";
    const nextTum = d.filters.tuman || "";
    const nextTurlar = Array.isArray(d.filters.turlar)
      ? d.filters.turlar.map((value: unknown) => String(value || "")).filter(Boolean)
      : d.filters.turi
        ? [String(d.filters.turi)]
        : [];
    const nextTur = nextTurlar.length === 1 ? nextTurlar[0] : "";
    const nextVh = d.filters.vh || "";
    const nextLanguage: "uz_cyr" | "uz_lat" | "ru" | "en" =
      (d.filters.language as any) || this.state.language || "ru";

    const vhBarDataPending = d.vhBarDataPending === true;
    const vhBarData = d.vhBarData ?? null;
    if (vhBarDataPending) {
      // Keep spinner, but paint progressive republic totals when present so
      // the user sees 1/8 → 8/8 growth instead of a blank long wait.
      const patch: Record<string, unknown> = {
        selectedYear: nextYear,
        selectedViloyat: nextVil,
        selectedTuman: nextTum,
        selectedtur: nextTur,
        selectedturlar: nextTurlar,
        selectedVHCategory: nextVh ? nextVh : null,
        loading: true,
        error: null,
        language: nextLanguage,
        lockedViloyat: nextLockedVil,
      };
      if (vhBarData) {
        patch.vhData = {
          categories: (vhBarData.categories || []).map(
            (c: VHDataItem & { label?: string }) => ({
              ...c,
              label: this.getLocalizedCategoryLabel(
                c.category || c.label,
                nextLanguage,
              ),
            }),
          ),
          totalCount: vhBarData.totalCount ?? 0,
        };
      }
      this.setState(patch as any);
      return;
    }

    const nextVhData = {
      categories: (vhBarData?.categories || []).map(
        (c: VHDataItem & { label?: string }) => ({
        ...c,
        label: this.getLocalizedCategoryLabel(
          c.category || c.label,
          nextLanguage,
        ),
      }),
      ),
      totalCount: vhBarData?.totalCount ?? 0,
    };

    this._hasCompletedFetch = true;
    this.setState({
      selectedYear: nextYear,
      selectedViloyat: nextVil,
      selectedTuman: nextTum,
      selectedtur: nextTur,
      selectedturlar: nextTurlar,
      // Keep VH selection in sync with master filter; clear when filter sends empty.
      selectedVHCategory: nextVh ? nextVh : null,
      vhData: nextVhData,
      loading: false,
      error: null,
      language: nextLanguage,
      lockedViloyat: nextLockedVil,
    });
  };

  componentDidMount() {
    this._isMounted = true;
    this.initializeTheme();
    this._unbindMasterFilter = bindMasterFilter(this.handleMasterFilterChange);
    document.addEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.addEventListener("resetAllFilters", this._onReset as any);

    // responsive sizing (deferred to ensure DOM is ready)
    setTimeout(() => {
      if (
        this._isMounted &&
        this._containerRef.current &&
        typeof ResizeObserver !== "undefined"
      ) {
        this._resizeObserver = new ResizeObserver((entries) => {
          const w = entries[0]?.contentRect?.width ?? 0;
          const h = entries[0]?.contentRect?.height ?? 0;
          const next: "xs" | "sm" | "md" | "lg" =
            w < 220 ? "xs" : w < 340 ? "sm" : w < 500 ? "md" : "lg";
          const compactHeight = h > 0 && h < 260;
          if (
            next !== this.state.widgetSize ||
            compactHeight !== this.state.compactHeight
          ) {
            this.setState({ widgetSize: next, compactHeight });
          }
        });
        this._resizeObserver.observe(this._containerRef.current);
      }
    }, 0);
    if (this.props.externalFilters) {
      this.setState({
        selectedViloyat: this.props.externalFilters.viloyat || "",
        selectedTuman: this.props.externalFilters.tuman || "",
        selectedYear: this.props.externalFilters.yil || "",
        selectedtur: this.props.externalFilters.tur || "",
        lockedViloyat: null,
      });
    }
  }

  componentWillUnmount() {
    this._isMounted = false;
    if (this._vhDispatchTimer) {
      clearTimeout(this._vhDispatchTimer);
      this._vhDispatchTimer = null;
    }
    this._unbindMasterFilter?.();
    this._unbindMasterFilter = null;
    document.removeEventListener(
      "agriV11ThemeToggled",
      this.handleThemeChange as EventListener,
    );
    document.removeEventListener("resetAllFilters", this._onReset as any);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  private _onReset = (): void => {
    if (!this._isMounted) return;
    this._hasCompletedFetch = false;
    this.setState({
      selectedYear: "",
      selectedViloyat: "",
      selectedTuman: "",
      selectedtur: "",
      selectedturlar: [],
      selectedVHCategory: null,
      vhData: { categories: [], totalCount: 0 },
      loading: false,
      error: null,
      lockedViloyat: null,
    });
  };

  componentDidUpdate(prevProps: AgriBarProps) {
    if (
      this.props.externalFilters !== prevProps.externalFilters &&
      this.props.externalFilters
    ) {
      this.updateFiltersFromProps(this.props.externalFilters);
    }
  }

  handleThemeChange(event: CustomEvent<{ isDarkTheme?: boolean }> | Event): void {
    const detail = (event as CustomEvent<{ isDarkTheme?: boolean }>)?.detail;
    if (detail && typeof detail.isDarkTheme === "boolean") {
      const { isDarkTheme } = detail;
      this.setState({ isDarkTheme });
    }
  }

  private updateFiltersFromProps(filters: any): void {
    try {
      this.setState({
        selectedViloyat: (filters.viloyat || "").trim(),
        selectedTuman: (filters.tuman || "").trim(),
        selectedYear: filters.yil ? String(filters.yil) : "",
        selectedtur: (filters.tur || "").trim(),
        error: null,
        lockedViloyat: null,
      });
    } catch (_) {}
  }

  handleDisplayCountChange(count: number) {

    this.setState({ displayCount: isNaN(count) ? -1 : count });
  }

  toggleSortOrder() {
    const newOrder = this.state.sortOrder === "asc" ? "desc" : "asc";

    this.setState({ sortOrder: newOrder });
  }

  /** Debounce rapid bar clicks so Localization only resolves the last VH. */
  private _vhDispatchTimer: ReturnType<typeof setTimeout> | null = null;

  handleVHSelectionClick = (arg: any) => {
    const effectiveVil = (
      this.state.lockedViloyat ||
      this.state.selectedViloyat ||
      ""
    ).trim();
    // Map filter needs a selected viloyat (region-year MapImage layers).
    if (!effectiveVil) return;

    const vhValue = arg?.category ?? arg?.payload?.category ?? null;
    if (vhValue == null) return;

    const newSelection =
      vhValue === this.state.selectedVHCategory ? null : vhValue;

    // Keep previous chart visible — category counts do not change on VH toggle.
    this.setState({ selectedVHCategory: newSelection, error: null });

    // Only send vh — do not re-broadcast geography (that can look like a
    // region/tuman change and wipe the VH selection in Localization).
    // Keep existing ekin turi: first-selected wins for chart scoping
    // (crop-first → VH does not filter Pie; VH-first → crop does not
    // re-filter the VH bar). Map still ANDs both dimensions.
    const detail: {
      source: string;
      vh: string;
      language: string;
    } = {
      source: "AgriBar",
      vh: newSelection || "",
      language: this.state.language,
    };

    agroV5Log(
      "bar:vh-click",
      {
        previous: this.state.selectedVHCategory,
        next: newSelection,
        viloyat: effectiveVil,
        detail,
      },
      "vh",
    );

    if (this._vhDispatchTimer) clearTimeout(this._vhDispatchTimer);
    this._vhDispatchTimer = setTimeout(() => {
      this._vhDispatchTimer = null;
      if (!this._isMounted) return;
      document.dispatchEvent(
        new CustomEvent("widgetSelectionChanged", {
          detail,
          bubbles: true,
        }),
      );
    }, 40);
  };

  /** Display-only: VH data comes from AgriFilter via masterFilterChanged.vhBarData */

  formatNumber = (value: number | null | undefined, decimals = 0) => {
    if (value === null || value === undefined) return "-";
    return Number(value).toFixed(decimals);
  };

  private formatCount = (value: number): string => {
    return new Intl.NumberFormat("ru-RU").format(Math.ceil(Number(value) || 0));
  };

  render() {
    const {
      loading,
      error,
      vhData,
      selectedVHCategory,
      displayCount,
      isDarkTheme,
      selectedYear,
      selectedViloyat,
      lockedViloyat,
      language,
    } = this.state;
    const effectiveViloyat = (lockedViloyat || selectedViloyat || "").trim();
    const chartInteractive = !!effectiveViloyat;
    const areaUnit =
      language === "en" ? "ha" : language === "uz_lat" ? "ga" : "га";
    const theme: "light" | "dark" = isDarkTheme ? "dark" : "light";

    const titleText =
      language === "en"
        ? "Vegetation Status"
        : language === "ru"
          ? "Состояние вегетации"
          : language === "uz_lat"
            ? "Vegetatsiya Holati"
            : "Вегетация Ҳолати";

    const selectRegionTitle =
      language === "en"
        ? "Select a region"
        : language === "ru"
          ? "Выберите регион"
          : language === "uz_lat"
            ? "Viloyatni tanlang"
            : "Вилоятни танланг";

    const selectRegionBody =
      language === "en"
        ? "Select a region first to view vegetation status"
        : language === "ru"
          ? "Чтобы увидеть состояние вегетации, сначала выберите регион"
          : language === "uz_lat"
            ? "Vegetatsiya holatini ko‘rish uchun avval viloyatni tanlang"
            : "Вегетация ҳолатини кўриш учун аввал вилоятни танланг";

    const sortedCategories = [...vhData.categories].sort(
      (a, b) => a.order - b.order,
    );
    const limitedCategories =
      displayCount === -1
        ? sortedCategories
        : sortedCategories.slice(0, displayCount);
    const denom = vhData.totalCount > 0 ? vhData.totalCount : 1;
    const chartData = limitedCategories.map((catItem) => {
      const color = catItem.color || "#94a3b8";
      return {
        ...catItem,
        color,
        fill: Math.max(0, Math.min(1, (catItem.count || 0) / denom)),
      };
    });
    const hasSelection = !!selectedVHCategory;
    const themeClass = isDarkTheme ? "dark-theme" : "light-theme";

    const hasChartData =
      vhData.categories.length > 0 && vhData.totalCount > 0;
    const awaitingFirstData = !this._hasCompletedFetch;

    // Loader until first fetch finishes — never flash "no data" during connect/refresh.
    const showBlockingLoader =
      !selectedYear ||
      (!hasChartData && (loading || awaitingFirstData));

    // Overlay loader on any subsequent data change while previous bars remain.
    const showRefreshLoader = loading && hasChartData;

    // Empty state only after a real fetch returned zero categories.
    const showNoData =
      !!selectedYear &&
      !loading &&
      this._hasCompletedFetch &&
      !hasChartData;

    return (
      <div
        ref={this._containerRef}
        className={`construction-years-card ${themeClass}`}
        data-bar-size={this.state.widgetSize}
        data-compact-height={this.state.compactHeight ? "true" : "false"}
      >
        <div className="construction-years-content">
          <div className="construction-years-header">
            <div className="construction-years-header-title">{titleText}</div>
          </div>

          {error ? (
            <div className="construction-years-error">
              <TriangleAlert
                className="agri-empty-state-icon"
                strokeWidth={1.7}
                aria-hidden="true"
              />
              <p>{error}</p>
            </div>
          ) : showBlockingLoader ? (
            <div className="construction-years-loading-container">
              <AgriChartLoader />
            </div>
          ) : showNoData ? (
            <div className="construction-years-no-data">
              <TriangleAlert
                className="agri-empty-state-icon"
                strokeWidth={1.7}
                aria-hidden="true"
              />
              <h3>{agriNoDataLabel(language)}</h3>
            </div>
          ) : (
            <div
              className={`agri-status-root${
                selectedVHCategory ? " has-selection" : ""
              }${showRefreshLoader ? " agri-status-root--loading" : ""}${
                !chartInteractive ? " agri-status-root--no-region" : ""
              }`}
              style={{
                pointerEvents: "auto",
                opacity: chartInteractive ? 1 : 0.92,
              }}
              aria-disabled={!chartInteractive}
              title={
                !chartInteractive
                  ? `${selectRegionTitle}. ${selectRegionBody}`
                  : undefined
              }
            >
              {showRefreshLoader ? <AgriChartLoader /> : null}
              <div
                className="agri-status-grid"
                role="list"
                aria-label={titleText}
              >
                {chartData.map((item, index) => {
                  const selected = selectedVHCategory === item.category;
                  const dimmed = hasSelection && !selected;
                  return (
                    <button
                      key={item.category}
                      type="button"
                      role="listitem"
                      aria-pressed={selected}
                      disabled={!chartInteractive || showRefreshLoader}
                      className={[
                        "agri-status-col",
                        "agri-status-col-button",
                        selected ? "agri-status-col--selected" : "",
                        dimmed ? "agri-status-col--dimmed" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ ["--accent" as any]: item.color }}
                      onClick={() =>
                        chartInteractive &&
                        !showRefreshLoader &&
                        this.handleVHSelectionClick(item)
                      }
                      onKeyDown={(e) => {
                        if (!chartInteractive || showRefreshLoader) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          this.handleVHSelectionClick(item);
                        }
                      }}
                    >
                      <div className="agri-status-text">
                        <div className="agri-status-value-wrap">
                          <div className="agri-status-value">
                            {this.formatCount(item.count)}
                            <span className="agri-status-unit">
                              {"\u00A0"}
                              {areaUnit}
                            </span>
                          </div>
                        </div>
                        <div className="agri-status-label">{item.label}</div>
                      </div>
                      <div className="agri-status-bar-area" aria-hidden="true">
                        <StatusBarChart
                          fill={item.fill}
                          color={item.color}
                          chartKey={`${item.category}-${item.count}`}
                          animate
                          animIndex={index}
                          selected={selected}
                          dimmed={dimmed}
                          theme={theme}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

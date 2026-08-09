/** @jsx jsx */
import {
  DataSourceComponent,
  DataSourceManager,
  getAppStore,
  jsx,
  React,
  type DataSource,
} from "jimu-core";
import {
  JimuMapView,
  MapViewManager,
  loadArcGISJSAPIModules,
} from "jimu-arcgis";
import plusLight from "./assets/PlusLight.svg";
import minusLight from "./assets/MinusLight.svg";
import expandLight from "./assets/ExpandLight.svg";
import compressLight from "./assets/CompressLight.svg";
import basemapIcon from "./assets/basemap.svg";
import {
  readAgriAdminBordersVisible,
  setAgriAdminBordersVisible,
} from "../embedded/shared/agri-admin-boundary-layer";
import { looksLikeRegionYearLayerHaystack } from "../embedded/shared/feature-layer-data";

interface Props {
  mapWidgetId: string;
  webMapDataSourceId?: string;
  webMapUseDataSource?: any;
  featureUseDataSources?: any[];
  onViewReady?: (jimuMapView: JimuMapView) => void;
  onLoadingChange?: (loading: boolean) => void;
  onError?: (message: string) => void;
}


type MapLanguage = "uz_lat" | "uz_cyr" | "ru" | "en";

function normalizeMapLanguage(raw: unknown): MapLanguage {
  const value = String(raw || "").trim().toLowerCase().replace(/-/g, "_");
  if (value === "en" || value === "english") return "en";
  if (value === "ru" || value === "russian") return "ru";
  if (value.startsWith("uz_cyr")) return "uz_cyr";
  if (value === "uz" || value.startsWith("uz_lat")) return "uz_lat";
  return "uz_lat";
}
function resolveInitialDarkTheme(): boolean {
  try {
    const saved = String(localStorage.getItem("agri_v11_app_theme") || "").toLowerCase();
    if (saved === "dark" || saved === "light") return saved === "dark";
    const attr = String(document.documentElement.getAttribute("data-theme") || "").toLowerCase();
    if (attr === "dark" || attr === "light") return attr === "dark";
  } catch {
    // Default dashboard theme is dark.
  }
  return true;
}

const BASEMAP_TEXT: Record<MapLanguage, {
  controls: string;
  zoomIn: string;
  zoomOut: string;
  enterFullscreen: string;
  exitFullscreen: string;
  choose: string;
  title: string;
  borders: string;
  items: Array<[string, string]>;
}> = {
  uz_lat: {
    controls: "Xarita boshqaruvlari",
    zoomIn: "Yaqinlashtirish",
    zoomOut: "Uzoqlashtirish",
    enterFullscreen: "To'liq ekranga o'tish",
    exitFullscreen: "To'liq ekrandan chiqish",
    choose: "Xarita turini tanlash",
    title: "Asosiy xaritalar",
    borders: "Chegaralar",
    items: [["Qorong'u", "dark-gray-vector"], ["Kulrang", "gray-vector"], ["Sun'iy yo'ldosh", "satellite"], ["Gibrid", "hybrid"], ["Topografik", "topo-vector"]],
  },
  uz_cyr: {
    controls: "Харита бошқарувлари",
    zoomIn: "Яқинлаштириш",
    zoomOut: "Узоқлаштириш",
    enterFullscreen: "Тўлиқ экранга ўтиш",
    exitFullscreen: "Тўлиқ экрандан чиқиш",
    choose: "Харита турини танлаш",
    title: "Асосий хариталар",
    borders: "Чегаралар",
    items: [["Қоронғу", "dark-gray-vector"], ["Кулранг", "gray-vector"], ["Сунъий йўлдош", "satellite"], ["Гибрид", "hybrid"], ["Топографик", "topo-vector"]],
  },
  en: {
    controls: "Map controls",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    enterFullscreen: "Enter fullscreen",
    exitFullscreen: "Exit fullscreen",
    choose: "Choose basemap",
    title: "Basemaps",
    borders: "Borders",
    items: [["Dark", "dark-gray-vector"], ["Gray", "gray-vector"], ["Satellite", "satellite"], ["Hybrid", "hybrid"], ["Topographic", "topo-vector"]],
  },
  ru: {
    controls: "Управление картой",
    zoomIn: "Приблизить",
    zoomOut: "Отдалить",
    enterFullscreen: "На весь экран",
    exitFullscreen: "Выйти из полноэкранного режима",
    choose: "Выбрать тип карты",
    title: "Базовые карты",
    borders: "Границы",
    items: [["Тёмная", "dark-gray-vector"], ["Серая", "gray-vector"], ["Спутник", "satellite"], ["Гибрид", "hybrid"], ["Топографическая", "topo-vector"]],
  },
};

function getPortalUrl(dataSource: any): string {
  const json = dataSource?.getDataSourceJson?.();
  const state = getAppStore().getState() as any;
  return String(
    dataSource?.portalUrl || json?.portalUrl || state?.portalUrl ||
      state?.appConfig?.portalUrl || (window as any)?.jimuConfig?.portalUrl ||
      "https://www.arcgis.com",
  ).replace(/\/$/, "");
}

function getItemId(dataSource: any): string {
  const json = dataSource?.getDataSourceJson?.();
  return String(dataSource?.itemId || json?.itemId || "").trim();
}

export default function EmbeddedAgriMap(props: Props) {
  const [basemapMenuOpen, setBasemapMenuOpen] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isDarkTheme, setIsDarkTheme] = React.useState(resolveInitialDarkTheme);
  const [hasSelectedRegion, setHasSelectedRegion] = React.useState(false);
  const [activeBasemapId, setActiveBasemapId] = React.useState<string>(() =>
    resolveInitialDarkTheme() ? "dark-gray-vector" : "gray-vector",
  );
  const [bordersVisible, setBordersVisible] = React.useState<boolean>(() =>
    readAgriAdminBordersVisible(),
  );
  const [language, setLanguage] = React.useState<MapLanguage>(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      const fromStorage = localStorage.getItem("app_lang") || localStorage.getItem("evapo_app_lang");
      return normalizeMapLanguage(fromUrl || fromStorage);
    } catch {
      return "uz_lat";
    }
  });
  const basemapText = BASEMAP_TEXT[language];
  const fullscreenText = isFullscreen
    ? basemapText.exitFullscreen
    : basemapText.enterFullscreen;

  React.useEffect(() => {
    const handleLanguageChange = (event: Event): void => {
      const detail = (event as CustomEvent)?.detail || {};
      setLanguage(normalizeMapLanguage(detail.lang || detail.language || detail.code));
    };
    document.addEventListener("languageChanged", handleLanguageChange);
    return () => document.removeEventListener("languageChanged", handleLanguageChange);
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("agri-basemap-menu-open", basemapMenuOpen);
    return () => root.classList.remove("agri-basemap-menu-open");
  }, [basemapMenuOpen]);
  const firstFeatureDataSourceId = String(
    props.featureUseDataSources?.[0]?.dataSourceId || "",
  );
  const firstFeatureRootDataSourceId = String(
    props.featureUseDataSources?.[0]?.rootDataSourceId || "",
  );
  const effectiveRootDataSourceId = String(
    props.webMapDataSourceId ||
      firstFeatureRootDataSourceId ||
      firstFeatureDataSourceId.split("-")[0] ||
      "",
  );
  const effectiveRootUseDataSource = props.webMapUseDataSource ||
    (effectiveRootDataSourceId
      ? {
          dataSourceId: effectiveRootDataSourceId,
          mainDataSourceId: effectiveRootDataSourceId,
          rootDataSourceId: effectiveRootDataSourceId,
        }
      : null);
  const [rootDataSource, setRootDataSource] = React.useState<DataSource | null>(
    () => effectiveRootDataSourceId
      ? DataSourceManager.getInstance().getDataSource(effectiveRootDataSourceId) || null
      : null,
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<__esri.MapView | null>(null);
  const mapRef = React.useRef<any>(null);
  const jimuMapViewRef = React.useRef<JimuMapView | null>(null);
  const automaticBasemapId = hasSelectedRegion
    ? "satellite"
    : isDarkTheme
      ? "dark-gray-vector"
      : "gray-vector";
  const automaticBasemapRef = React.useRef(automaticBasemapId);
  automaticBasemapRef.current = automaticBasemapId;

  React.useEffect(() => {
    const handleTheme = (event: Event): void => {
      const detail = (event as CustomEvent)?.detail || {};
      const dark = typeof detail.isDarkTheme === "boolean"
        ? detail.isDarkTheme
        : String(detail.theme || "").toLowerCase() === "dark";
      setIsDarkTheme(dark);
    };
    const handleFilter = (event: Event): void => {
      const detail = (event as CustomEvent)?.detail || {};
      const filters = detail.filters || detail.currentFilters || {};
      const locked = detail.scope?.lockedViloyat || "";
      setHasSelectedRegion(Boolean(String(locked || filters.viloyat || "").trim()));
    };
    document.addEventListener("agriV11ThemeToggled", handleTheme);
    document.addEventListener("masterFilterChanged", handleFilter);
    return () => {
      document.removeEventListener("agriV11ThemeToggled", handleTheme);
      document.removeEventListener("masterFilterChanged", handleFilter);
    };
  }, []);

  React.useEffect(() => {
    const map = viewRef.current?.map || mapRef.current;
    if (!map || viewRef.current?.destroyed) return;
    if (String((map as any).basemap?.id || (map as any).basemap || "") !== automaticBasemapId) {
      (map as any).basemap = automaticBasemapId;
    }
    setActiveBasemapId(automaticBasemapId);
    setBasemapMenuOpen(false);
  }, [automaticBasemapId]);

  React.useEffect(() => {
    const syncFullscreenState = (): void => {
      const mapSlot = containerRef.current?.closest(
        ".agri-dashboard-map-slot",
      ) as HTMLElement | null;
      const fullscreenDocument = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      const activeElement =
        document.fullscreenElement ||
        fullscreenDocument.webkitFullscreenElement ||
        null;
      setIsFullscreen(Boolean(mapSlot && activeElement === mapSlot));
      window.requestAnimationFrame(() => {
        try {
          (viewRef.current as any)?.resize?.();
        } catch {
          /* MapView resize observer will handle it */
        }
      });
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener(
      "webkitfullscreenchange",
      syncFullscreenState as EventListener,
    );
    syncFullscreenState();

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener(
        "webkitfullscreenchange",
        syncFullscreenState as EventListener,
      );
    };
  }, []);
  const zoomBy = React.useCallback((delta: number): void => {
    const view = viewRef.current;
    if (!view || view.destroyed) return;
    const minZoom = Number((view.constraints as any)?.minZoom ?? 5);
    const targetZoom = Math.max(minZoom, Number(view.zoom || minZoom) + delta);
    void view.goTo(
      { center: view.center, zoom: targetZoom },
      { animate: true, duration: 420, easing: "ease-in-out" } as any,
    ).catch((): undefined => undefined);
  }, []);

  const toggleFullscreen = React.useCallback(async (): Promise<void> => {
    const mapSlot = containerRef.current?.closest(
      ".agri-dashboard-map-slot",
    ) as HTMLElement | null;
    if (!mapSlot) return;

    const fullscreenDocument = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const fullscreenMapSlot = mapSlot as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    try {
      const activeElement =
        document.fullscreenElement ||
        fullscreenDocument.webkitFullscreenElement ||
        null;
      if (activeElement === mapSlot) {
        if (typeof document.exitFullscreen === "function") {
          await document.exitFullscreen();
        } else {
          await Promise.resolve(fullscreenDocument.webkitExitFullscreen?.());
        }
      } else {
        if (activeElement) {
          if (typeof document.exitFullscreen === "function") {
            await document.exitFullscreen();
          } else {
            await Promise.resolve(fullscreenDocument.webkitExitFullscreen?.());
          }
        }
        if (typeof mapSlot.requestFullscreen === "function") {
          await mapSlot.requestFullscreen();
        } else {
          await Promise.resolve(fullscreenMapSlot.webkitRequestFullscreen?.());
        }
      }
      setBasemapMenuOpen(false);
    } catch {
      /* Fullscreen may be blocked by the browser or iframe policy. */
    }
  }, []);

  const selectBasemap = React.useCallback((basemapId: string): void => {
    const view = viewRef.current;
    if (!view?.map || view.destroyed) return;
    (view.map as any).basemap = basemapId;
    setActiveBasemapId(basemapId);
    setBasemapMenuOpen(false);
  }, []);

  const toggleBordersVisible = React.useCallback((): void => {
    const next = !bordersVisible;
    setBordersVisible(next);
    void setAgriAdminBordersVisible(viewRef.current, next);
  }, [bordersVisible]);

  React.useEffect(() => {
    let disposed = false;
    let view: __esri.MapView | null = null;
    let jimuMapViewId = "";
    let updatingHandle: { remove?: () => void } | null = null;

    const initialize = async (): Promise<void> => {
      if (!containerRef.current) return;
      props.onLoadingChange?.(true);
      try {
        const manager = MapViewManager.getInstance();
        const ds = rootDataSource || (effectiveRootDataSourceId
          ? DataSourceManager.getInstance().getDataSource(effectiveRootDataSourceId)
          : null);
        if (effectiveRootDataSourceId && !ds) return;
        if (ds) {
          try { await ds.ready?.(); } catch { /* WebMap loads from the portal item */ }
        }

        const itemId = getItemId(ds);
        const portalUrl = getPortalUrl(ds);
        const [WebMap, Map, MapView, Extent] = await loadArcGISJSAPIModules([
          "esri/WebMap",
          "esri/Map",
          "esri/views/MapView",
          "esri/geometry/Extent",
        ]);
        if (disposed || !containerRef.current) return;

        const map = itemId
          ? new WebMap({ portalItem: { id: itemId, portal: { url: portalUrl } } })
          : new Map({ basemap: automaticBasemapRef.current });
        mapRef.current = map;
        setActiveBasemapId(automaticBasemapRef.current);

        // Parse the WebMap before creating MapView, then hide every
        // region+year operational layer. Otherwise MapView immediately sends
        // exports for the WebMap's saved visibility and Localization hides
        // them only after those expensive requests have already started.
        if (itemId && typeof map.load === 'function') {
          await map.load();
          map.basemap = automaticBasemapRef.current;
          setActiveBasemapId(automaticBasemapRef.current);
          const operationalLayers =
            map.allLayers?.toArray?.() || map.layers?.toArray?.() || [];
          for (const layer of operationalLayers) {
            const haystack = `${String(layer?.title || '')} ${String(layer?.url || '')}`;
            const isRegionYearLayer =
              String(layer?.type || '').toLowerCase() !== 'group' &&
              looksLikeRegionYearLayerHaystack(haystack);
            if (!isRegionYearLayer) continue;
            // Hide only — do not layer.when()/load every region service here.
            // Forcing load on all agri region layers at once can flood MapServer.
            layer.visible = false;
            if (Number(layer.opacity ?? 1) !== 1) layer.opacity = 1;
          }
        }

        // Always frame Uzbekistan — WebMap portal viewpoint is often all of
        // Central Asia, which looks like "UZ is incomplete / empty".
        const uzbekistanExtent = new Extent({
          xmin: 55.9,
          ymin: 37.15,
          xmax: 73.2,
          ymax: 45.65,
          spatialReference: { wkid: 4326 },
        });

        view = new MapView({
          container: containerRef.current,
          map,
          extent: uzbekistanExtent,
          constraints: { rotationEnabled: false, minZoom: 5, snapToZoom: false },
          ui: { components: [] },
        });
        viewRef.current = view;
        try {
          view.ui.remove("attribution");
        } catch {
          /* already absent */
        }
        await view.when();
        if (disposed) { view.destroy(); return; }

        try {
          await view.goTo(uzbekistanExtent, { animate: false });
        } catch {
          /* viewpoint already set via extent */
        }

        const jimuMapView = await manager.createJimuMapView({
          mapWidgetId: props.mapWidgetId,
          dataSourceId: effectiveRootDataSourceId,
          view,
          isActive: true,
          isEnablePopup: false,
          mapViewManager: manager,
          useUrlHashLayersVisibility: false,
        });
        jimuMapViewId = jimuMapView.id;
        jimuMapViewRef.current = jimuMapView;
        // The map is usable as soon as the view is ready. Hidden/background
        // layer updates must not keep the whole dashboard behind a loader.
        props.onLoadingChange?.(false);
        props.onViewReady?.(jimuMapView);
      } catch (error) {
        if (!disposed) {
          props.onLoadingChange?.(false);
          props.onError?.(error instanceof Error ? error.message : "Xaritani yuklab bo'lmadi");
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      updatingHandle?.remove?.();
      if (jimuMapViewId) MapViewManager.getInstance().destroyJimuMapView(jimuMapViewId);
      jimuMapViewRef.current = null;
      viewRef.current = null;
      mapRef.current = null;
      try { view?.destroy(); } catch { /* noop */ }
    };
  }, [props.mapWidgetId, effectiveRootDataSourceId, rootDataSource]);

  return (
    <React.Fragment>
      <div
        ref={containerRef}
        className="agri-dashboard-embedded-map"
        onPointerDownCapture={() => {
          window.dispatchEvent(
            new CustomEvent("agri-main:map-settings-request", {
              detail: { widgetId: props.mapWidgetId.replace(/-embedded-map$/, "") },
            }),
          );
        }}
      />
      <div className="agri-dashboard-map-controls" aria-label={basemapText.controls}>
        <button
          type="button"
          className="agri-dashboard-map-zoom-button"
          aria-label={basemapText.zoomIn}
          title={basemapText.zoomIn}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            zoomBy(1);
          }}
        >
          <img
            src={plusLight}
            alt=""
            className="agri-dashboard-map-control-icon"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="agri-dashboard-map-zoom-button"
          aria-label={basemapText.zoomOut}
          title={basemapText.zoomOut}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            zoomBy(-1);
          }}
        >
          <img
            src={minusLight}
            alt=""
            className="agri-dashboard-map-control-icon"
            aria-hidden="true"
          />
        </button>
      </div>
      <button
        type="button"
        className={`agri-dashboard-map-zoom-button agri-dashboard-fullscreen-button${isFullscreen ? " is-active" : ""}`}
        aria-label={fullscreenText}
        aria-pressed={isFullscreen}
        title={fullscreenText}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void toggleFullscreen();
        }}
      >
        <img
          src={isFullscreen ? compressLight : expandLight}
          alt=""
          className="agri-dashboard-map-control-icon"
          aria-hidden="true"
        />
      </button>
      <div className="agri-dashboard-basemap-control">
          <button
            type="button"
            className={`agri-dashboard-map-zoom-button agri-dashboard-basemap-button${basemapMenuOpen ? " is-active" : ""}`}
            aria-label={basemapText.choose}
            aria-expanded={basemapMenuOpen}
            title={basemapText.choose}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setBasemapMenuOpen((open) => !open);
            }}
          >
            <img
              src={basemapIcon}
              alt=""
              className="agri-dashboard-map-control-icon"
              aria-hidden="true"
            />
          </button>
          {basemapMenuOpen && (
            <div
              className="agri-dashboard-basemap-menu"
              role="menu"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="agri-dashboard-basemap-menu-title">{basemapText.title}</div>
              {basemapText.items.map(([label, id]) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeBasemapId === id}
                  className={`agri-dashboard-basemap-option${activeBasemapId === id ? " is-active" : ""}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    selectBasemap(id);
                  }}
                >
                  {label}
                </button>
              ))}
              <div className="agri-dashboard-basemap-borders-row">
                <span className="agri-dashboard-basemap-borders-label">
                  {basemapText.borders}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bordersVisible}
                  aria-label={basemapText.borders}
                  className={`agri-dashboard-basemap-borders-toggle${bordersVisible ? " is-on" : ""}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleBordersVisible();
                  }}
                >
                  <span className="agri-dashboard-basemap-borders-thumb" />
                </button>
              </div>
            </div>
          )}
        </div>
      {effectiveRootUseDataSource && (
        <div style={{ display: "none" }} aria-hidden="true">
          <DataSourceComponent
            useDataSource={effectiveRootUseDataSource}
            widgetId={props.mapWidgetId}
            onDataSourceCreated={(dataSource: DataSource) => setRootDataSource(dataSource)}
          />
        </div>
      )}
    </React.Fragment>
  );
}

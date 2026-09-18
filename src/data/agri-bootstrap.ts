/**
 * One-shot dashboard bootstrap: reference mappings shared by Localization,
 * Graff, Pie, and map filter resolution. Does not replace per-filter stats.
 * Resolved mappings persist for 1 hour across refresh.
 */
import {
  queryAgriRegionDistrictMappings,
  queryAgriTuriCropMappings,
  type AgriRegionDistrictMappingRow,
  type AgriTuriCropMappingRow,
} from "../gis/agri-table-data-source";
import {
  AGRI_PERSIST_TTL_MS,
  getAgriPersistentCache,
  removeAgriPersistentCache,
  setAgriPersistentCache,
} from "./agri-persistent-cache";

export interface AgriDashboardBootstrap {
  regionDistrictRows: AgriRegionDistrictMappingRow[];
  turiCropRows: AgriTuriCropMappingRow[];
}

const BOOTSTRAP_NS = "bootstrap";
/** Bump when mapping semantics change (majority-vote district codes, counts). */
const BOOTSTRAP_KEY = "mappings-v3";

let bootstrapPromise: Promise<AgriDashboardBootstrap> | null = null;

export function getAgriDashboardBootstrap(): Promise<AgriDashboardBootstrap> {
  if (!bootstrapPromise) {
    const persisted = getAgriPersistentCache<AgriDashboardBootstrap>(
      BOOTSTRAP_NS,
      BOOTSTRAP_KEY,
    );
    if (
      persisted &&
      Array.isArray(persisted.regionDistrictRows) &&
      Array.isArray(persisted.turiCropRows)
    ) {
      bootstrapPromise = Promise.resolve(persisted);
      return bootstrapPromise;
    }

    bootstrapPromise = Promise.all([
      queryAgriRegionDistrictMappings(),
      queryAgriTuriCropMappings(),
    ])
      .then(([regionDistrictRows, turiCropRows]) => {
        const payload: AgriDashboardBootstrap = {
          regionDistrictRows,
          turiCropRows,
        };
        setAgriPersistentCache(
          BOOTSTRAP_NS,
          BOOTSTRAP_KEY,
          payload,
          AGRI_PERSIST_TTL_MS,
        );
        return payload;
      })
      .catch((err) => {
        bootstrapPromise = null;
        throw err;
      });
  }
  return bootstrapPromise;
}

export function clearAgriDashboardBootstrapCache(): void {
  bootstrapPromise = null;
  removeAgriPersistentCache(BOOTSTRAP_NS, BOOTSTRAP_KEY);
}

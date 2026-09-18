/**
 * In-memory DashboardPack store.
 * Panels subscribe here for shared Region/Pie stats (and future slices).
 *
 * Ready packs are persisted for 1 hour *per filter key* so republic and
 * viloyat/tuman scopes can coexist after refresh (not a single "latest" slot).
 */
import {
  emptyDashboardPack,
  type DashboardPack,
} from "../types/dashboard-pack";
import {
  AGRI_PERSIST_TTL_MS,
  clearAgriPersistentNamespace,
  getAgriPersistentCache,
  removeAgriPersistentCache,
  setAgriPersistentCache,
} from "../data/agri-persistent-cache";

type PackListener = (pack: DashboardPack) => void;

const PACK_PERSIST_NS = "dashboard-pack";
/** Pointer to last active pack key (for optional cold-start hydrate). */
const PACK_LATEST_PTR = "__latest_key__";
/** Legacy single-slot key from the first persist implementation. */
const PACK_LEGACY_LATEST = "latest";

/** Short stable id for localStorage — filter keys are long JSON strings. */
export function dashboardPackPersistId(packKey: string): string {
  const raw = String(packKey || "");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `k_${(hash >>> 0).toString(16)}`;
}

function normalizePersistedPack(saved: DashboardPack): DashboardPack {
  return {
    ...emptyDashboardPack(),
    ...saved,
    graffPolygon: null,
    updatedAt: Date.now(),
  };
}

/** Load a ready pack for an exact filter key from localStorage. */
export function getPersistedDashboardPack(
  packKey: string,
): DashboardPack | null {
  const id = dashboardPackPersistId(packKey);
  if (!id || id === "k_0") return null;
  const saved = getAgriPersistentCache<DashboardPack>(PACK_PERSIST_NS, id);
  if (
    !saved ||
    typeof saved !== "object" ||
    saved.phase !== "ready" ||
    String(saved.key || "") !== String(packKey || "")
  ) {
    return null;
  }
  return normalizePersistedPack(saved);
}

function hydratePackFromPersistent(): DashboardPack {
  // Never preload the last active (viloyat/tuman) pack into the live store.
  // Refresh UI always starts at republic default; packs are adopted by key
  // when Localization broadcasts / user re-selects a filter.
  return emptyDashboardPack();
}

let pack: DashboardPack = hydratePackFromPersistent();
const listeners = new Set<PackListener>();

function persistReadyPack(next: DashboardPack): void {
  if (
    next.phase !== "ready" ||
    !String(next.key || "").trim() ||
    !String(next.filter?.yil || "").trim()
  ) {
    // Do not overwrite other scopes with an empty-year placeholder.
    return;
  }
  const toSave: DashboardPack = {
    ...next,
    graffPolygon: null,
    error: next.error ?? null,
  };
  const id = dashboardPackPersistId(next.key);
  setAgriPersistentCache(PACK_PERSIST_NS, id, toSave, AGRI_PERSIST_TTL_MS);
  setAgriPersistentCache(
    PACK_PERSIST_NS,
    PACK_LATEST_PTR,
    next.key,
    AGRI_PERSIST_TTL_MS,
  );
  // Drop legacy single-slot so it cannot shadow multi-key lookups.
  removeAgriPersistentCache(PACK_PERSIST_NS, PACK_LEGACY_LATEST);
}

export function getDashboardPack(): DashboardPack {
  return pack;
}

export function setDashboardPack(next: DashboardPack): void {
  pack = next;
  if (next.phase === "ready") {
    persistReadyPack(next);
  }
  listeners.forEach((listener) => {
    try {
      listener(pack);
    } catch {
      /* panel must not break store */
    }
  });
}

export function patchDashboardPack(
  patch: Partial<DashboardPack>,
): DashboardPack {
  const next = { ...pack, ...patch, updatedAt: Date.now() };
  setDashboardPack(next);
  return next;
}

export function subscribeDashboardPack(listener: PackListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Wait until pack reaches a terminal phase (ready/error) or timeout.
 * Used by Region/Pie so they can consume a just-scheduled controller pack.
 */
export function waitForDashboardPackReady(
  maxMs = 2500,
): Promise<DashboardPack> {
  const current = getDashboardPack();
  if (current.phase === "ready" || current.phase === "error") {
    return Promise.resolve(current);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve(getDashboardPack());
    };

    const unsub = subscribeDashboardPack((p) => {
      if (p.phase === "ready" || p.phase === "error") finish();
    });

    const timer = setTimeout(finish, Math.max(0, maxMs));
  });
}

export function resetDashboardPackStore(): void {
  pack = emptyDashboardPack();
  listeners.clear();
  clearAgriPersistentNamespace(PACK_PERSIST_NS);
}

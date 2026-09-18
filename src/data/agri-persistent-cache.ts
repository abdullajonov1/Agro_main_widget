/**
 * Browser-persisted cache for Agro_widgetV5 stats (survives page refresh).
 *
 * In-memory Maps alone reset on F5 — this layer keeps JSON values in
 * localStorage for up to 1 hour so Region/Pie/Indicator/Graff/VH can reuse
 * the last successful ArcGIS aggregates without re-querying.
 *
 * Do NOT store huge uniqueid lists or FeatureLayer instances here.
 */

export const AGRI_PERSIST_TTL_MS = 60 * 60 * 1000; // 1 hour

const STORAGE_PREFIX = "agri_v5_pc:";
/** Soft budget — drop oldest entries when exceeded. */
const MAX_STORAGE_CHARS = 2_500_000;
const MAX_ENTRY_CHARS = 750_000;

type PersistEnvelope<T> = {
  expiresAt: number;
  savedAt: number;
  value: T;
};

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function fullKey(namespace: string, key: string): string {
  return `${STORAGE_PREFIX}${namespace}:${key}`;
}

function safeParse<T>(raw: string | null): PersistEnvelope<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistEnvelope<T>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Drop expired keys; if still over budget, drop oldest by savedAt. */
export function pruneAgriPersistentCache(now = Date.now()): void {
  const store = storage();
  if (!store) return;

  type Meta = { key: string; savedAt: number; size: number };
  const metas: Meta[] = [];
  let total = 0;

  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const raw = store.getItem(key);
    if (!raw) continue;
    const env = safeParse<unknown>(raw);
    if (!env || env.expiresAt <= now) {
      try {
        store.removeItem(key);
      } catch {
        /* ignore */
      }
      continue;
    }
    total += raw.length;
    metas.push({ key, savedAt: env.savedAt || 0, size: raw.length });
  }

  if (total <= MAX_STORAGE_CHARS) return;
  metas.sort((a, b) => a.savedAt - b.savedAt);
  for (const meta of metas) {
    if (total <= MAX_STORAGE_CHARS) break;
    try {
      store.removeItem(meta.key);
      total -= meta.size;
    } catch {
      /* ignore */
    }
  }
}

export function getAgriPersistentCache<T>(
  namespace: string,
  key: string,
): T | null {
  const store = storage();
  if (!store || !key) return null;
  const fk = fullKey(namespace, key);
  try {
    const env = safeParse<T>(store.getItem(fk));
    if (!env) return null;
    if (env.expiresAt <= Date.now()) {
      store.removeItem(fk);
      return null;
    }
    return env.value as T;
  } catch {
    return null;
  }
}

export function setAgriPersistentCache<T>(
  namespace: string,
  key: string,
  value: T,
  ttlMs: number = AGRI_PERSIST_TTL_MS,
): boolean {
  const store = storage();
  if (!store || !key) return false;
  const fk = fullKey(namespace, key);
  const now = Date.now();
  const envelope: PersistEnvelope<T> = {
    expiresAt: now + Math.max(0, ttlMs),
    savedAt: now,
    value,
  };
  let raw: string;
  try {
    raw = JSON.stringify(envelope);
  } catch {
    return false;
  }
  if (raw.length > MAX_ENTRY_CHARS) return false;
  try {
    store.setItem(fk, raw);
    pruneAgriPersistentCache(now);
    return true;
  } catch {
    // Quota — prune and retry once.
    try {
      pruneAgriPersistentCache(now);
      store.setItem(fk, raw);
      return true;
    } catch {
      return false;
    }
  }
}

export function removeAgriPersistentCache(
  namespace: string,
  key: string,
): void {
  const store = storage();
  if (!store || !key) return;
  try {
    store.removeItem(fullKey(namespace, key));
  } catch {
    /* ignore */
  }
}

export function clearAgriPersistentNamespace(namespace: string): void {
  const store = storage();
  if (!store) return;
  const prefix = `${STORAGE_PREFIX}${namespace}:`;
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Promise-map helper: memory hit → return; else persistent hit → warm memory;
 * else run factory, persist resolved JSON value.
 */
export function rememberAsync<T>(opts: {
  memory: Map<string, Promise<T>>;
  namespace: string;
  key: string;
  factory: () => Promise<T>;
  ttlMs?: number;
  /** When true, delete memory entry on reject (default true). */
  dropMemoryOnError?: boolean;
}): Promise<T> {
  const { memory, namespace, key, factory } = opts;
  const existing = memory.get(key);
  if (existing) return existing;

  const persisted = getAgriPersistentCache<T>(namespace, key);
  if (persisted != null) {
    const warmed = Promise.resolve(persisted);
    memory.set(key, warmed);
    return warmed;
  }

  const request = factory()
    .then((value) => {
      if (opts.ttlMs !== 0) {
        setAgriPersistentCache(namespace, key, value, opts.ttlMs);
      }
      return value;
    })
    .catch((err) => {
      if (opts.dropMemoryOnError !== false && memory.get(key) === request) {
        memory.delete(key);
      }
      throw err;
    });

  memory.set(key, request);
  return request;
}

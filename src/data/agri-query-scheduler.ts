/**
 * Limits concurrent ArcGIS statistics queries from dashboard panels.
 * Prevents startup filter changes from opening 5+ parallel groupBy requests.
 */

const MAX_CONCURRENT_STATS_QUERIES = 2;

let activeSlots = 0;
const waitQueue: Array<() => void> = [];

function releaseSlot(): void {
  activeSlots = Math.max(0, activeSlots - 1);
  const next = waitQueue.shift();
  if (next) next();
}

function acquireSlot(): Promise<void> {
  if (activeSlots < MAX_CONCURRENT_STATS_QUERIES) {
    activeSlots += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeSlots += 1;
      resolve();
    });
  });
}

/** Run a stats query when a scheduler slot is available. */
export async function withStatsQuerySlot<T>(
  task: () => Promise<T>,
): Promise<T> {
  await acquireSlot();
  try {
    return await task();
  } finally {
    releaseSlot();
  }
}

/** Test / hot-reload helper */
export function resetStatsQueryScheduler(): void {
  activeSlots = 0;
  waitQueue.length = 0;
}

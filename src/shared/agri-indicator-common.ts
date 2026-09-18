/**
 * Shared master-filter staleness + request-id helpers for indicator panels.
 */

export interface MasterFilterMetaState {
  lastMasterFilterTs: number;
  lastMasterFilterBroadcastGeneration: number;
}

/** True when an incoming masterFilterChanged event is older than what we applied. */
export function isStaleMasterFilterEvent(
  eventTs: number,
  eventGen: number,
  state: MasterFilterMetaState,
): boolean {
  if (
    eventGen > 0 &&
    state.lastMasterFilterBroadcastGeneration > 0 &&
    eventGen < state.lastMasterFilterBroadcastGeneration
  ) {
    return true;
  }
  if (
    eventTs > 0 &&
    state.lastMasterFilterTs > 0 &&
    eventTs < state.lastMasterFilterTs
  ) {
    return true;
  }
  return false;
}

/** Record meta from a masterFilterChanged event we are about to apply. */
export function recordMasterFilterMeta(
  eventTs: number,
  eventGen: number,
  state: MasterFilterMetaState,
): void {
  if (eventGen > 0) {
    state.lastMasterFilterBroadcastGeneration = eventGen;
  }
  if (eventTs > 0) {
    state.lastMasterFilterTs = eventTs;
  }
}

export function nextIndicatorRequestId(current: number): number {
  return current + 1;
}

export function isCurrentIndicatorRequest(
  requestId: number,
  current: number,
  mounted: boolean,
): boolean {
  return mounted && requestId === current;
}

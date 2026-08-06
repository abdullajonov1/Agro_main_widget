/** Console diagnostics for map click / polygon popup pipeline. Disabled. */

export function isEvapoMapClickDebugEnabled(): boolean {
  return false;
}

export function evapoMapClickDebug(..._args: unknown[]): void {
  /* no-op */
}

export function evapoMapClickWarn(..._args: unknown[]): void {
  /* no-op */
}

/** Log which DOM element sits above the map at click coordinates. */
export function logPointerStack(
  _clientX: number,
  _clientY: number,
  _label: string,
): void {
  /* no-op */
}

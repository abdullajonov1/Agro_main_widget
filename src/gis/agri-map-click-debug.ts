/** Console diagnostics for map click / polygon popup pipeline. Disabled. */

export function isAgriMapClickDebugEnabled(): boolean {
  return false;
}

export function agriMapClickDebug(..._args: unknown[]): void {
  /* no-op */
}

export function agriMapClickWarn(..._args: unknown[]): void {
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

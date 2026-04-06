export interface NightSetbackSettings {
  enabled: boolean;
  /** Hour (0-23) when night setback begins. Default 22. */
  startHour: number;
  /** Hour (0-23, exclusive) when night setback ends. Default 6. */
  endHour: number;
  /** Night comfort band minimum temperature. Default 17.0°C. */
  minTemp: number;
  /** Night comfort band maximum temperature. Default 19.0°C. */
  maxTemp: number;
}

/**
 * Returns true if `currentHour` falls within the night setback window.
 *
 * Handles windows that cross midnight (e.g. startHour=22, endHour=6).
 * The window is [startHour, endHour) — startHour inclusive, endHour exclusive.
 * Returns false when startHour === endHour (degenerate: no window).
 */
export function isNightHour(currentHour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    // Same-day window, e.g. 01:00–05:00
    return currentHour >= startHour && currentHour < endHour;
  }
  // Crosses midnight, e.g. 22:00–06:00
  return currentHour >= startHour || currentHour < endHour;
}

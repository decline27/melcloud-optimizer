/**
 * Default comfort band settings
 * 
 * These values are used as fallbacks when user settings are not configured.
 * Extracted from the original optimization engine to maintain backwards compatibility.
 */

export interface ComfortBand {
  lowerC: number;
  upperC: number;
}

export interface ComfortDefaults {
  comfortOccupied: ComfortBand;
  comfortAway: ComfortBand;
}

/**
 * Default comfort band configuration
 * These values match the original engine defaults to ensure no behavior changes
 */
export const DefaultComfortConfig: ComfortDefaults = {
  comfortOccupied: { lowerC: 20.0, upperC: 23.0 }, // Expanded to match user settings capability
  comfortAway: { lowerC: 19.0, upperC: 21.0 },     // Reasonable away range
};
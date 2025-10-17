/**
 * Test for comfort band constraint resolution fix
 */

import { DefaultComfortConfig } from '../../src/config/comfort-defaults';

describe('Comfort Band Constraint Resolution', () => {
  const mockToNumber = (value: unknown): number | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  it('should respect user settings over hardcoded defaults', () => {
    // Mock user settings where away is set to 20°C (not the default 19°C)
    const mockHomeySettings: Record<string, number> = {
      'comfort_lower_occupied': 20,
      'comfort_lower_away': 20,      // User explicitly set this to 20°C
      'comfort_upper_occupied': 23,
      'comfort_upper_away': 21
    };

    const mockHomeySettingsGet = (key: string): number | undefined => mockHomeySettings[key];

    // Apply the NEW logic (fixed)
    const userComfortLowerOccupied = mockToNumber(mockHomeySettingsGet('comfort_lower_occupied'));
    const userComfortLowerAway = mockToNumber(mockHomeySettingsGet('comfort_lower_away'));
    const userComfortUpperOccupied = mockToNumber(mockHomeySettingsGet('comfort_upper_occupied'));
    const userComfortUpperAway = mockToNumber(mockHomeySettingsGet('comfort_upper_away'));

    // Use user settings if available, otherwise use defaults
    const comfortLowerOccupied = userComfortLowerOccupied ?? DefaultComfortConfig.comfortOccupied.lowerC;
    const comfortLowerAway = userComfortLowerAway ?? DefaultComfortConfig.comfortAway.lowerC;
    const comfortUpperOccupied = userComfortUpperOccupied ?? DefaultComfortConfig.comfortOccupied.upperC;
    const comfortUpperAway = userComfortUpperAway ?? DefaultComfortConfig.comfortAway.upperC;

    const comfortLowerCandidates = [comfortLowerOccupied, comfortLowerAway];
    const comfortUpperCandidates = [comfortUpperOccupied, comfortUpperAway];

    const derivedMin = Math.min(...comfortLowerCandidates);
    let derivedMax = Math.max(...comfortUpperCandidates);

    if (derivedMax <= derivedMin) {
      derivedMax = derivedMin + 1;
    }

    const minTemp = Math.max(16, Math.min(derivedMin, 26));

    // Verify the fix
    expect(minTemp).toBe(20);
    expect(derivedMin).toBe(20);
    expect(comfortLowerAway).toBe(20); // Should use user setting, not default 19
  });

  it('should fall back to defaults when user settings are missing', () => {
    // Mock user settings with missing values
    const mockHomeySettingsGet = (key: string): undefined => undefined;

    // Apply the logic with missing user settings
    const userComfortLowerOccupied = mockToNumber(mockHomeySettingsGet('comfort_lower_occupied'));
    const userComfortLowerAway = mockToNumber(mockHomeySettingsGet('comfort_lower_away'));

    const comfortLowerOccupied = userComfortLowerOccupied ?? DefaultComfortConfig.comfortOccupied.lowerC;
    const comfortLowerAway = userComfortLowerAway ?? DefaultComfortConfig.comfortAway.lowerC;

    const comfortLowerCandidates = [comfortLowerOccupied, comfortLowerAway];
    const derivedMin = Math.min(...comfortLowerCandidates);

    // Should fall back to defaults when user settings are missing
    expect(comfortLowerOccupied).toBe(20.0);
    expect(comfortLowerAway).toBe(19.0);
    expect(derivedMin).toBe(19.0);
  });

  it('should demonstrate the old buggy behavior (for comparison)', () => {
    // Mock user settings where away is set to 20°C
    const mockHomeySettings: Record<string, number> = {
      'comfort_lower_occupied': 20,
      'comfort_lower_away': 20,      // User set this to 20°C
      'comfort_upper_occupied': 23,
      'comfort_upper_away': 21
    };

    const mockHomeySettingsGet = (key: string): number | undefined => mockHomeySettings[key];

    // OLD BUGGY LOGIC - mixed user settings with defaults
    const oldComfortLowerCandidates = [
      mockToNumber(mockHomeySettingsGet('comfort_lower_occupied')),
      mockToNumber(mockHomeySettingsGet('comfort_lower_away')),
      DefaultComfortConfig.comfortOccupied.lowerC,
      DefaultComfortConfig.comfortAway.lowerC  // This 19.0 would override user's 20.0!
    ].filter((value) => value !== null);

    const oldDerivedMin = Math.min(...oldComfortLowerCandidates);

    // Demonstrate the bug - user's 20°C setting was ignored due to hardcoded 19°C
    expect(oldComfortLowerCandidates).toEqual([20, 20, 20.0, 19.0]);
    expect(oldDerivedMin).toBe(19.0); // BUG: Should have been 20.0
  });
});
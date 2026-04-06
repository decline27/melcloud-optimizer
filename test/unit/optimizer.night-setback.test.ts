// test/unit/optimizer.night-setback.test.ts
import { ConstraintManager } from '../../src/services/constraint-manager';
import { isNightHour } from '../../src/util/night-setback';

// Unit test for the composed night-mode resolution logic
// (the optimizer's private method is tested indirectly via constraint manager + isNightHour)
describe('Night setback integration', () => {
  let cm: ConstraintManager;
  const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;

  beforeEach(() => {
    cm = new ConstraintManager(mockLogger);
  });

  const makeSettings = (extra: Record<string, unknown> = {}) => ({
    get: (key: string) => ({
      comfort_lower_occupied: 20,
      comfort_upper_occupied: 21,
      comfort_lower_away: 19,
      comfort_upper_away: 20.5,
      comfort_lower_night: 17,
      comfort_upper_night: 19,
      night_setback_enabled: true,
      night_start_hour: 22,
      night_end_hour: 6,
      ...extra,
    }[key] ?? null)
  });

  test('resolves to night band at 23:00 when enabled', () => {
    const settings = makeSettings();
    const nightMode = isNightHour(23, 22, 6); // true
    const band = cm.getCurrentComfortBand(true, settings, nightMode);
    expect(band.minTemp).toBe(17);
    expect(band.maxTemp).toBe(19);
  });

  test('resolves to daytime band at 12:00 even when enabled', () => {
    const settings = makeSettings();
    const nightMode = isNightHour(12, 22, 6); // false
    const band = cm.getCurrentComfortBand(true, settings, nightMode);
    expect(band.minTemp).toBe(20);
    expect(band.maxTemp).toBe(21);
  });

  test('resolves to daytime band at 23:00 when disabled (enabled=false)', () => {
    const settings = makeSettings({ night_setback_enabled: false });
    const nightMode = false; // disabled overrides time check
    const band = cm.getCurrentComfortBand(true, settings, nightMode);
    expect(band.minTemp).toBe(20);
    expect(band.maxTemp).toBe(21);
  });
});

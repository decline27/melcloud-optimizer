import { isNightHour } from '../../src/util/night-setback';

describe('isNightHour', () => {
  // Normal midnight-crossing window: 22:00–06:00
  test('returns true for hour inside midnight-crossing window (start side)', () => {
    expect(isNightHour(23, 22, 6)).toBe(true);
  });

  test('returns true at exactly startHour', () => {
    expect(isNightHour(22, 22, 6)).toBe(true);
  });

  test('returns true for hour inside midnight-crossing window (end side)', () => {
    expect(isNightHour(3, 22, 6)).toBe(true);
  });

  test('returns false at exactly endHour (exclusive)', () => {
    expect(isNightHour(6, 22, 6)).toBe(false);
  });

  test('returns false for daytime hour outside window', () => {
    expect(isNightHour(12, 22, 6)).toBe(false);
  });

  test('returns false for hour just before start', () => {
    expect(isNightHour(21, 22, 6)).toBe(false);
  });

  // Same-day window: 01:00–05:00 (no midnight crossing)
  test('returns true inside same-day window', () => {
    expect(isNightHour(3, 1, 5)).toBe(true);
  });

  test('returns false before same-day window', () => {
    expect(isNightHour(0, 1, 5)).toBe(false);
  });

  test('returns false after same-day window', () => {
    expect(isNightHour(5, 1, 5)).toBe(false);
  });

  // Degenerate: startHour === endHour means no night window
  test('returns false when startHour equals endHour', () => {
    expect(isNightHour(6, 6, 6)).toBe(false);
  });

  // Edge: midnight
  test('returns true at midnight (hour 0) in crossing window', () => {
    expect(isNightHour(0, 22, 6)).toBe(true);
  });
});

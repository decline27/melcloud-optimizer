import { advanceEnergyMeter, dayBefore } from '../../src/util/energy-meter';

describe('cumulative energy meter from per-day counters', () => {
  test('starts at today so far and adds only growth within a day', () => {
    let m = advanceEnergyMeter(null, '2026-10-17', 2.26);
    expect(m).toEqual({ date: '2026-10-17', lastToday: 2.26, totalKWh: 2.26 });
    m = advanceEnergyMeter(m, '2026-10-17', 3.0);
    expect(m.totalKWh).toBeCloseTo(3.0, 6);
  });

  test('a lower reading (MELCloud revising the day) never lowers the meter or double counts', () => {
    let m = advanceEnergyMeter(null, '2026-10-17', 3.0);
    m = advanceEnergyMeter(m, '2026-10-17', 2.5);
    expect(m.totalKWh).toBeCloseTo(3.0, 6);
    m = advanceEnergyMeter(m, '2026-10-17', 3.4);
    expect(m.totalKWh).toBeCloseTo(3.4, 6);
  });

  test("midnight: yesterday's final total tops up the missed tail, then today's counter adds", () => {
    let m = advanceEnergyMeter(null, '2026-10-17', 9.5);
    m = advanceEnergyMeter(m, '2026-10-18', 0.4, 10.0);
    expect(m.totalKWh).toBeCloseTo(9.5 + 0.5 + 0.4, 6);
    expect(m).toMatchObject({ date: '2026-10-18', lastToday: 0.4 });
  });

  test('without yesterday final, or after a gap of days, only today is added', () => {
    const base = advanceEnergyMeter(null, '2026-10-17', 9.5);
    expect(advanceEnergyMeter(base, '2026-10-18', 0.4, null).totalKWh).toBeCloseTo(9.9, 6);
    expect(advanceEnergyMeter(base, '2026-10-20', 1, 12).totalKWh).toBeCloseTo(10.5, 6);
  });

  test('never decreases over a sequence of readings', () => {
    const readings: Array<[string, number, number | null]> = [
      ['2026-10-17', 1, null], ['2026-10-17', 0.8, null], ['2026-10-17', 4, null],
      ['2026-10-18', 0.2, 3.5], ['2026-10-18', 0, null], ['2026-10-18', 2, null]
    ];
    let m = null as any;
    let previous = 0;
    for (const [date, today, yesterday] of readings) {
      m = advanceEnergyMeter(m, date, today, yesterday);
      expect(m.totalKWh).toBeGreaterThanOrEqual(previous);
      previous = m.totalKWh;
    }
  });

  test('day before handles month ends', () => {
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
  });
});

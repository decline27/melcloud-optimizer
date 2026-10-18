import {
  applyMeasuredDay,
  dayBefore,
  daysAwaitingTotal,
  estimatedPowerW,
  expireOpenDays,
  initEnergyMeter,
  kWhPerHzHour,
  meterReading,
  recordCompressorSample,
  EnergyMeterState
} from '../../src/util/energy-meter';

const MIN = 60 * 1000;
const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00Z`);

/** Samples every 5 minutes over [from, to) at a constant frequency. */
function run(state: EnergyMeterState, date: string, from: string, to: string, hz: number): EnergyMeterState {
  for (let t = at(date, from); t < at(date, to); t += 5 * MIN) {
    state = recordCompressorSample(state, t, date, hz);
  }
  return state;
}

describe('heat pump energy meter (compressor integral, corrected to MELCloud day totals)', () => {
  test('integrates Hz over time; gaps longer than the limit are skipped', () => {
    let s = initEnergyMeter(null, null);
    s = recordCompressorSample(s, at('2026-10-17', '10:00'), '2026-10-17', 30);
    s = recordCompressorSample(s, at('2026-10-17', '11:00'), '2026-10-17', 30); // 60 min gap: skipped
    s = recordCompressorSample(s, at('2026-10-17', '11:10'), '2026-10-17', 10); // 10 min, avg 20 Hz
    expect(s.open[0].hzHours).toBeCloseTo(20 * (10 / 60), 6);
    expect(s.open[0].sampledHours).toBeCloseTo(10 / 60, 6);
  });

  test('before a rate is learned, the 7-day average day is spread over the sampled hours', () => {
    let s = run(initEnergyMeter(null, null), '2026-10-17', '00:00', '12:00', 0);
    s = meterReading(s, 6);
    expect(s.meterKWh).toBeCloseTo(3, 1);
    expect(estimatedPowerW(s, 30)).toBeNull();
  });

  test('a measured full day teaches the rate; the next day follows the compressor', () => {
    let s = initEnergyMeter(null, null);
    s = run(s, '2026-10-17', '00:00', '23:59', 0);
    s = run(s, '2026-10-17', '06:00', '10:00', 25); // samples 06:00..09:55
    const dayHz = s.open[0].hzHours;
    expect(dayHz).toBeCloseTo(25 * (235 / 60), 6);
    s = applyMeasuredDay(s, '2026-10-17', 5);
    const rate = kWhPerHzHour(s) as number;
    expect(rate).toBeCloseTo(5 / dayHz, 9);
    s = run(s, '2026-10-18', '06:00', '08:00', 25);
    s = meterReading(s, null);
    expect(s.meterKWh).toBeCloseTo(5 + rate * 25 * (115 / 60), 6);
    expect(estimatedPowerW(s, 20)).toBe(Math.round(rate * 20 * 1000));
  });

  test('the measured total replaces the estimate; the meter never goes down', () => {
    let s = initEnergyMeter(null, null);
    s = { ...s, calibration: [{ date: '2026-10-15', kWh: 10, hzHours: 100 }] }; // 0.1 kWh/Hz-h
    s = run(s, '2026-10-16', '00:00', '23:59', 0);
    s = run(s, '2026-10-16', '06:00', '10:00', 25); // estimate 10 kWh
    s = meterReading(s, null);
    const before = s.meterKWh;
    s = meterReading(applyMeasuredDay(s, '2026-10-16', 8), null); // measured lower
    expect(s.meterKWh).toBeCloseTo(before, 6);
    expect(s.measuredKWh).toBe(8);
    s = meterReading(applyMeasuredDay(s, '2026-10-16', 99), null); // a second report is ignored
    expect(s.measuredKWh).toBe(8);
  });

  test('a higher measured total lifts the meter', () => {
    let s = initEnergyMeter(null, null);
    s = run(s, '2026-10-16', '20:00', '23:00', 30);
    s = meterReading(s, 4);
    s = meterReading(applyMeasuredDay(s, '2026-10-16', 7), 4);
    expect(s.meterKWh).toBeCloseTo(7, 6);
  });

  test('part days do not calibrate the rate', () => {
    let s = run(initEnergyMeter(null, null), '2026-10-17', '19:00', '23:59', 20);
    s = applyMeasuredDay(s, '2026-10-17', 6);
    expect(s.calibration).toHaveLength(0);
    expect(kWhPerHzHour(s)).toBeNull();
  });

  test('days waiting too long keep their estimate as final', () => {
    let s = initEnergyMeter(null, null);
    s = { ...s, calibration: [{ date: '2026-10-10', kWh: 10, hzHours: 100 }] };
    s = run(s, '2026-10-12', '06:00', '08:00', 30); // 30 Hz × 115 min at 0.1 kWh/Hz-h
    expect(daysAwaitingTotal(s, '2026-10-14')).toEqual(['2026-10-12']);
    s = expireOpenDays(s, '2026-10-16', null);
    expect(s.open).toHaveLength(0);
    expect(s.measuredKWh).toBeCloseTo(0.1 * 30 * (115 / 60), 6);
  });

  test('a first-version meter keeps its value as measured up to the day before', () => {
    const s = initEnergyMeter({ date: '2026-10-17', lastToday: 3.19, totalKWh: 3.19 }, dayBefore('2026-10-17'));
    expect(s).toMatchObject({ version: 2, measuredKWh: 3.19, meterKWh: 3.19, lastMeasuredDate: '2026-10-16' });
    expect(applyMeasuredDay(s, '2026-10-16', 3.19).measuredKWh).toBe(3.19);
  });

  test('day before handles month ends', () => {
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
  });
});

import * as fs from 'fs';
import * as path from 'path';
import {
  CalibrationStep,
  initPowerCalibration,
  median,
  overheadSharePct,
  PowerCalibrationState,
  recordPowerSample,
  stepWPerHz,
  summarizePowerCalibration
} from '../../src/util/power-calibration';
import {
  houseMeterCandidates,
  MeterDeviceLike,
  HouseMeterService,
  pickHouseMeter,
  readPowerW
} from '../../src/services/house-meter-service';
import { POWER_CALIBRATION_CONSTANTS as C } from '../../src/constants';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 20, 0, 0, 0);

/** Feeds polls [minute, Hz, house W] through the recorder. */
function feed(samples: Array<[number, number, number | null]>, start: PowerCalibrationState = initPowerCalibration(null)) {
  return samples.reduce((state, [m, hz, w]) => recordPowerSample(state, T0 + m * MIN, hz, w), start);
}

describe('stepWPerHz', () => {
  test('a start: rise in house power divided by the new frequency', () => {
    expect(stepWPerHz([T0, 0, 600], [T0 + 5 * MIN, 50, 1600])).toBeCloseTo(20);
  });

  test('a stop: fall in house power divided by the frequency it ran at', () => {
    expect(stepWPerHz([T0, 40, 1500], [T0 + 5 * MIN, 0, 700])).toBeCloseTo(20);
  });

  test('no change in run state is no step', () => {
    expect(stepWPerHz([T0, 40, 1500], [T0 + 5 * MIN, 60, 2000])).toBeNull();
    expect(stepWPerHz([T0, 0, 500], [T0 + 5 * MIN, 0, 2500])).toBeNull();
  });

  test('polls too far apart are no step', () => {
    expect(stepWPerHz([T0, 0, 600], [T0 + (C.MAX_PAIR_GAP_MINUTES + 1) * MIN, 50, 1600])).toBeNull();
    expect(stepWPerHz([T0, 0, 600], [T0 + C.MAX_PAIR_GAP_MINUTES * MIN, 50, 1600])).toBeCloseTo(20);
  });

  test('implausible steps (another load switching too) are dropped', () => {
    // Kettle on with the start: 3 kW + 1 kW over 50 Hz = 80 W/Hz
    expect(stepWPerHz([T0, 0, 600], [T0 + 5 * MIN, 50, 4600])).toBeNull();
    // Something else switched off with the start: power fell
    expect(stepWPerHz([T0, 0, 2600], [T0 + 5 * MIN, 50, 1600])).toBeNull();
  });
});

describe('recordPowerSample / summarizePowerCalibration', () => {
  /** n start/stop cycles of a 20 W/Hz compressor at 50 Hz on a 600 W base, 5-min polls. */
  function cycles(n: number, startMinute = 0, noise: (i: number) => number = () => 0) {
    const samples: Array<[number, number, number | null]> = [];
    for (let i = 0; i < n; i++) {
      const m = startMinute + i * 20;
      samples.push([m, 0, 600 + noise(i)]);
      samples.push([m + 5, 50, 1600 + noise(i)]);
      samples.push([m + 10, 50, 1600 + noise(i)]);
    }
    return samples;
  }

  test('each start and stop is one step', () => {
    // 3 cycles: 3 starts and 2 stops (the third run has not stopped yet)
    const state = feed(cycles(3));
    expect(state.steps).toHaveLength(5);
    state.steps.forEach(([, w]) => expect(w).toBeCloseTo(20));
  });

  test('no figure until enough steps', () => {
    const few = feed(cycles(Math.floor(C.MIN_STEPS / 2)));
    expect(few.steps.length).toBeLessThan(C.MIN_STEPS);
    expect(summarizePowerCalibration(few, T0 + 1000 * MIN).wPerHz).toBeNull();

    const enough = feed(cycles(C.MIN_STEPS));
    const summary = summarizePowerCalibration(enough, T0 + 1000 * MIN);
    expect(summary.steps).toBeGreaterThanOrEqual(C.MIN_STEPS);
    expect(summary.wPerHz).toBeCloseTo(20);
  });

  test('the median holds against other loads switching now and then', () => {
    // Every fourth cycle another load adds 400 W at the start and stays on: start 28 W/Hz,
    // stop still 20 W/Hz. The median stays at the compressor's draw.
    const samples = cycles(20).map(([m, hz, w], i): [number, number, number | null] => {
      const cycle = Math.floor(i / 3);
      const extra = cycle % 4 === 0 && i % 3 !== 0 ? 400 : 0;
      return [m, hz, (w as number) + extra];
    });
    const summary = summarizePowerCalibration(feed(samples), T0 + 1000 * MIN);
    expect(summary.wPerHz).toBeCloseTo(20);
  });

  test('a missing house reading breaks the chain: no step across it', () => {
    const state = feed([[0, 0, 600], [5, 50, null], [10, 0, 600]]);
    expect(state.steps).toHaveLength(0);
    expect(state.last).toEqual([T0 + 10 * MIN, 0, 600]);
  });

  test('invalid frequency or power breaks the chain', () => {
    expect(feed([[0, 0, 600], [5, Number.NaN, 1600]]).last).toBeNull();
    expect(feed([[0, 0, 600], [5, 50, -10]]).last).toBeNull();
    expect(feed([[0, 0, 600], [5, -1, 1600]]).steps).toHaveLength(0);
  });

  test('non-increasing timestamps are ignored', () => {
    const state = feed([[5, 0, 600]]);
    expect(recordPowerSample(state, T0 + 5 * MIN, 50, 1600)).toBe(state);
    expect(recordPowerSample(state, T0, 50, 1600)).toBe(state);
  });

  test('old steps expire and the count is capped', () => {
    const old = feed(cycles(5));
    const later = recordPowerSample(old, T0 + (C.RETENTION_DAYS * 24 * 60 + 200) * MIN, 0, 600);
    expect(later.steps).toHaveLength(0);

    const many = feed(cycles(C.MAX_STEPS));
    expect(many.steps).toHaveLength(C.MAX_STEPS);
    expect(many.steps[many.steps.length - 1][0]).toBe(T0 + ((C.MAX_STEPS - 1) * 20 + 5) * MIN);
  });

  test('restores from the store, dropping bad entries, and survives a JSON round trip', () => {
    const state = feed(cycles(4));
    expect(initPowerCalibration(JSON.parse(JSON.stringify(state)))).toEqual(state);

    const restored = initPowerCalibration({
      version: 1,
      last: [T0, 0, 'x'],
      steps: [[T0 + 2, 21], [T0 + 1, 19], ['bad', 3], [T0 + 3], null]
    });
    expect(restored.last).toBeNull();
    expect(restored.steps).toEqual<CalibrationStep[]>([[T0 + 1, 19], [T0 + 2, 21]]);

    expect(initPowerCalibration({ version: 2, steps: [] })).toEqual({ version: 1, last: null, steps: [] });
    expect(initPowerCalibration('nonsense')).toEqual({ version: 1, last: null, steps: [] });
  });
});

describe('median and overhead share', () => {
  test('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test('share of MELCloud energy the compressor steps do not explain', () => {
    // Live 2026-10: MELCloud-calibrated ~1.4 kW vs Pulse step ~1.05 kW at the same frequency
    expect(overheadSharePct(28, 21)).toBeCloseTo(25);
    expect(overheadSharePct(20, 25)).toBeCloseTo(-25);
    expect(overheadSharePct(10, 40)).toBe(-100);
    expect(overheadSharePct(null, 20)).toBeNull();
    expect(overheadSharePct(20, null)).toBeNull();
    expect(overheadSharePct(0, 20)).toBeNull();
  });
});

describe('house meter selection', () => {
  const pulse: MeterDeviceLike = {
    id: 'pulse', name: 'Pulse', capabilities: ['measure_power', 'meter_power', 'meter_power.imported'],
    energyObj: { cumulative: true }
  };
  const p1: MeterDeviceLike = {
    id: 'p1', name: 'P1', capabilities: ['measure_power', 'meter_power.imported']
  };
  const plug: MeterDeviceLike = { id: 'plug', name: 'Plug', capabilities: ['onoff', 'measure_power', 'meter_power'] };
  const heatPump: MeterDeviceLike = { id: 'hp', name: 'Heatpump', capabilities: ['measure_power', 'meter_power'] };

  test('automatic: the one home meter Homey Energy knows', () => {
    expect(pickHouseMeter([plug, pulse, p1, heatPump], '')?.id).toBe('pulse');
    expect(pickHouseMeter([plug, pulse, p1], undefined)?.id).toBe('pulse');
    expect(pickHouseMeter([plug, pulse], null)?.id).toBe('pulse');
  });

  test('automatic without a cumulative meter: the one device with imported energy', () => {
    expect(pickHouseMeter([plug, p1, heatPump], '')?.id).toBe('p1');
  });

  test('automatic picks nothing when it is ambiguous or nothing fits', () => {
    expect(pickHouseMeter([pulse, { ...pulse, id: 'pulse2' }], '')).toBeNull();
    expect(pickHouseMeter([p1, { ...p1, id: 'p1b' }], '')).toBeNull();
    expect(pickHouseMeter([plug, heatPump], '')).toBeNull();
  });

  test('a chosen device, or none', () => {
    expect(pickHouseMeter([pulse, plug], 'plug')?.id).toBe('plug');
    expect(pickHouseMeter([pulse, plug], 'gone')).toBeNull();
    expect(pickHouseMeter([pulse, plug], 'none')).toBeNull();
  });

  test('candidates list home meters first, never plain plugs', () => {
    expect(houseMeterCandidates([plug, p1, pulse]).map(c => c.id)).toEqual(['pulse', 'p1']);
  });

  test('readPowerW uses fresh, valid readings only', () => {
    const now = T0;
    const with_ = (value: unknown, lastUpdated?: unknown): MeterDeviceLike =>
      ({ id: 'x', capabilities: ['measure_power'], capabilitiesObj: { measure_power: { value, lastUpdated } } });
    expect(readPowerW(with_(1234, new Date(now - MIN).toISOString()), now)).toBe(1234);
    expect(readPowerW(with_(1234), now)).toBe(1234);
    expect(readPowerW(with_(1234, now - (C.MAX_READING_AGE_MINUTES + 1) * MIN), now)).toBeNull();
    expect(readPowerW(with_(null, now), now)).toBeNull();
    expect(readPowerW(with_('1234', now), now)).toBeNull();
    expect(readPowerW({ id: 'x' }, now)).toBeNull();
  });
});

describe('HouseMeterService without a meter', () => {
  test('searches the device list again at most once per RESCAN_MINUTES', async () => {
    const getDevices = jest.fn().mockResolvedValue({});
    const service = new HouseMeterService({ settings: { get: () => undefined } });
    (service as any).api = { devices: { getDevices } };

    expect(await service.powerW(T0)).toBeNull();
    expect(await service.powerW(T0 + 5 * MIN)).toBeNull();
    expect(getDevices).toHaveBeenCalledTimes(1);
    expect(await service.powerW(T0 + C.RESCAN_MINUTES * MIN)).toBeNull();
    expect(getDevices).toHaveBeenCalledTimes(2);
  });

  test('a changed choice is searched right away', async () => {
    let setting: string | undefined;
    const getDevices = jest.fn().mockResolvedValue({});
    const service = new HouseMeterService({ settings: { get: () => setting } });
    (service as any).api = { devices: { getDevices } };

    await service.powerW(T0);
    setting = 'meter-1';
    await service.powerW(T0 + MIN);
    expect(getDevices).toHaveBeenCalledTimes(2);
  });
});

describe('flow/return and power capabilities are declared everywhere Homey reads them', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const driverCompose = read('drivers/boiler/driver.compose.json');
  const app = read('app.json');
  const appDriver = app.drivers.find((d: { id: string }) => d.id === 'boiler');

  test.each(['flow_return_delta', 'power_overhead_share'])('%s is defined in compose, driver and app.json', (cap) => {
    const compose = read(`.homeycompose/capabilities/${cap}.json`);
    expect(compose.type).toBe('number');
    expect(compose.insights).toBe(true);
    expect(compose.setable).toBe(false);
    expect(read(`capabilities/${cap}.json`)).toEqual(compose);
    expect(driverCompose.capabilities).toContain(cap);
    expect(app.capabilities[cap]).toEqual(compose);
    expect(appDriver.capabilities).toContain(cap);
  });

  test.each(['measure_temperature.flow', 'measure_temperature.return'])('%s is listed with a title', (cap) => {
    expect(driverCompose.capabilities).toContain(cap);
    expect(driverCompose.capabilitiesOptions[cap].title.en).toBeTruthy();
    expect(appDriver.capabilities).toContain(cap);
    expect(appDriver.capabilitiesOptions[cap]).toEqual(driverCompose.capabilitiesOptions[cap]);
  });
});

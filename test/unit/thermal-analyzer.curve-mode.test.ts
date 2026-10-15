import { ThermalAnalyzer, coolingRatesFromStretches, curveWarmingFromStretches, predictCurveWarming } from '../../src/services/thermal-model/thermal-analyzer';
import { ThermalDataPoint } from '../../src/services/thermal-model/data-collector';

const HOUR = 3600000;
const T0 = Date.UTC(2026, 9, 14, 0);

function point(hour: number, indoor: number, heating: boolean, extra: Partial<ThermalDataPoint> = {}): ThermalDataPoint {
  return {
    timestamp: new Date(T0 + hour * HOUR).toISOString(),
    indoorTemperature: indoor,
    outdoorTemperature: 11,
    targetTemperature: 22,
    heatingActive: heating,
    roomTargetMode: false,
    weatherConditions: { windSpeed: 0, humidity: 50, cloudCover: 50, precipitation: 0 },
    ...extra
  };
}

function makeAnalyzer() {
  const store: Record<string, any> = {};
  return new ThermalAnalyzer({
    settings: { get: (k: string) => store[k], set: (k: string, v: any) => { store[k] = v; } },
    log: jest.fn(),
    error: jest.fn()
  });
}

describe('coolingRatesFromStretches (Curve/Flow mode)', () => {
  test('a heating-off stretch yields a rate from its total drop', () => {
    // 22.5 -> 21.5 over 4 h, mean indoor-outdoor about 11 K.
    const data = [point(0, 22.5, false), point(1, 22.5, false), point(2, 22, false), point(3, 22, false), point(4, 21.5, false)];
    const [rate] = coolingRatesFromStretches(data);
    const meanGradient = (11.5 + 11.5 + 11 + 11 + 10.5) / 5;
    expect(rate).toBeCloseTo((1 / 4) / meanGradient);
  });

  test('a flat stretch counts as zero cooling instead of being dropped', () => {
    // Quantised sensor: no visible change over 3 h is a real (small) rate, not missing data.
    const rates = coolingRatesFromStretches([point(0, 22, false), point(1, 22, false), point(2, 22, false), point(3, 22, false)]);
    expect(rates).toEqual([0]);
  });

  test('a stretch that warmed (sun) is skipped', () => {
    expect(coolingRatesFromStretches([point(0, 22, false), point(1, 22.5, false), point(2, 23, false)])).toEqual([]);
  });

  test('short stretches, heating-on points and gaps break the measurement', () => {
    expect(coolingRatesFromStretches([point(0, 22, false), point(1, 21.5, false)])).toEqual([]);
    expect(coolingRatesFromStretches([point(0, 22, false), point(1, 22, true), point(2, 21.5, false)])).toEqual([]);
    expect(coolingRatesFromStretches([point(0, 22, false), point(3, 21.5, false)])).toEqual([]);
  });

  test('Room-mode points are left to the pairwise method', () => {
    const data = [0, 1, 2, 3].map(h => point(h, 22 - h * 0.5, false, { roomTargetMode: true }));
    expect(coolingRatesFromStretches(data)).toEqual([]);
  });
});

describe('ThermalAnalyzer.updateModel with Curve-mode data', () => {
  test('learns a cooling rate but never a heating rate', () => {
    const analyzer = makeAnalyzer();
    const before = { ...analyzer.getThermalCharacteristics() };
    // 24 h: heating on for 4 h (room rising), then off for 4 h (falling), repeated.
    const data: ThermalDataPoint[] = [];
    for (let h = 0; h < 24; h++) {
      const phase = h % 8;
      const heating = phase < 4;
      const indoor = heating ? 21 + phase * 0.5 : 23 - (phase - 4) * 0.5;
      data.push(point(h, indoor, heating));
    }

    const after = analyzer.updateModel(data);

    expect(after.heatingRate).toBe(before.heatingRate);
    expect(after.coolingRate).not.toBe(before.coolingRate);
    expect(after.coolingRate).toBeGreaterThan(0);
  });
});

describe('curve warming (Curve/Flow mode heating characteristic)', () => {
  test('a heating-on stretch gives net warming per hour, binned by outdoor temperature', () => {
    // 21 -> 22 over 4 h at 11 °C outside: 0.25 °C/h in the 12 °C bin.
    const data = [0, 1, 2, 3, 4].map(h => point(h, 21 + h * 0.25, true));
    expect(curveWarmingFromStretches(data)).toEqual([{ outdoorC: 12, ratePerHour: 0.25, samples: 1 }]);
  });

  test('a stretch where the curve only holds or loses is kept, not discarded', () => {
    // Cold night: heating on all night, room still falls 0.5 °C over 4 h.
    const data = [0, 1, 2, 3, 4].map(h => point(h, 21.5 - (h === 4 ? 0.5 : 0), true, { outdoorTemperature: 3 }));
    const [bin] = curveWarmingFromStretches(data);
    expect(bin.outdoorC).toBe(4);
    expect(bin.ratePerHour).toBeCloseTo(-0.125);
  });

  test('Room-mode and heating-off points do not contribute', () => {
    const room = [0, 1, 2, 3].map(h => point(h, 21 + h * 0.5, true, { roomTargetMode: true }));
    const off = [0, 1, 2, 3].map(h => point(h, 22, false));
    expect(curveWarmingFromStretches(room)).toEqual([]);
    expect(curveWarmingFromStretches(off)).toEqual([]);
  });

  test('prediction uses nearby bins and refuses to guess without data', () => {
    const bins = [
      { outdoorC: 2, ratePerHour: 0.0, samples: 3 },
      { outdoorC: 12, ratePerHour: 0.3, samples: 1 },
      { outdoorC: 14, ratePerHour: 0.2, samples: 1 }
    ];
    expect(predictCurveWarming(bins, 13)).toBeCloseTo(0.25);
    expect(predictCurveWarming(bins, 2)).toBeCloseTo(0);
    // Nothing within 2 °C of -5: no prediction.
    expect(predictCurveWarming(bins, -5)).toBeNull();
    // A single stretch is not enough.
    expect(predictCurveWarming([{ outdoorC: 8, ratePerHour: 0.4, samples: 1 }], 8)).toBeNull();
    expect(predictCurveWarming(undefined, 8)).toBeNull();
  });

  test('updateModel stores the profile on the characteristics', () => {
    const analyzer = makeAnalyzer();
    const data: ThermalDataPoint[] = [];
    for (let h = 0; h < 24; h++) {
      const phase = h % 8;
      const heating = phase < 4;
      data.push(point(h, heating ? 21 + phase * 0.5 : 23 - (phase - 4) * 0.5, heating));
    }
    const after = analyzer.updateModel(data);
    expect(after.curveWarming?.length).toBeGreaterThan(0);
    expect(after.curveWarming![0].ratePerHour).toBeGreaterThan(0);
  });
});

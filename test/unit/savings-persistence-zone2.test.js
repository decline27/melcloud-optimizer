/* eslint-disable @typescript-eslint/no-var-requires */

describe('Hourly optimization persistence with Zone2-only change (JS)', () => {
  let api;
  let homey;
  let settingsStore;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    api = require('../../api.js');
    if (api.__test && typeof api.__test.resetAll === 'function') {
      api.__test.resetAll();
    }

    settingsStore = {};
    homey = {
      app: { log: jest.fn(), error: jest.fn(), timeline: undefined },
      settings: {
        get: jest.fn((k) => settingsStore[k]),
        set: jest.fn((k, v) => { settingsStore[k] = v; })
      }
    };

    settingsStore['time_zone_offset'] = 0;
    settingsStore['use_dst'] = false;
    settingsStore['currency'] = 'EUR';

    const mockOptimizer = {
      setTemperatureConstraints: jest.fn(),
      setZone2TemperatureConstraints: jest.fn(),
      setTankTemperatureConstraints: jest.fn(),
      setThermalModel: jest.fn(),
      setCOPSettings: jest.fn(),
      calculateSavings: (oldT, newT, price, kind) => {
        const per = kind === 'tank' ? 2 : kind === 'zone2' ? 4 : 5;
        return ((oldT - newT) * per / 100) * 1.0 * price;
      },
      runEnhancedOptimization: jest.fn().mockResolvedValue({
        success: true,
        action: 'no_change',
        fromTemp: 21.0,
        toTemp: 21.0,
        priceData: { current: 1.0, average: 1.0, min: 1.0, max: 1.0 },
        zone2Data: { fromTemp: 21.0, toTemp: 20.0, reason: 'Test zone2 down 1°C' },
        timestamp: new Date().toISOString(),
      })
    };

    api.__test.setServices({ optimizer: mockOptimizer, melCloud: {}, tibber: {}, weather: null });
  });

  test('persists derived savings when only Zone2 changes', async () => {
    const res = await api.getRunHourlyOptimizer({ homey });
    expect(res.success).toBe(true);

    const hist = settingsStore['savings_history'];
    expect(Array.isArray(hist)).toBe(true);
    expect(hist.length).toBeGreaterThanOrEqual(1);
    const today = hist[hist.length - 1];
    expect(today).toHaveProperty('date');
    expect(today).toHaveProperty('total');
    expect(Number(today.total.toFixed(4))).toBeCloseTo(0.04, 4);
  });
});


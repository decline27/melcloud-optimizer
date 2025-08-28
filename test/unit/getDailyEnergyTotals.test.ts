import { MelCloudApi } from '../../src/services/melcloud-api';

// Minimal dummy logger
const logger: any = {
  info: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('MelCloudApi.getDailyEnergyTotals', () => {
  let api: MelCloudApi;

  beforeEach(() => {
    api = new MelCloudApi(logger);
  });

  test('All totals present and valid -> COPs from totals', async () => {
    const mockData = {
      TotalHeatingConsumed: 10,
      TotalHeatingProduced: 30,
      TotalHotWaterConsumed: 5,
      TotalHotWaterProduced: 15,
      TotalCoolingConsumed: 2,
      TotalCoolingProduced: 4,
      CoP: [3, 3]
    };

  // getDailyEnergyTotals may call getEnergyData twice (7-day range then yesterday) when totals are zero
  jest.spyOn(api as any, 'getEnergyData').mockResolvedValueOnce(mockData).mockResolvedValueOnce(mockData);

    const res = await api.getDailyEnergyTotals('1', 1);

    expect(res.heatingCOP).toBeCloseTo(3.0, 2);
    expect(res.hotWaterCOP).toBeCloseTo(3.0, 2);
    expect(res.coolingCOP).toBeCloseTo(2.0, 2);
    expect(res.averageCOP).toBeCloseTo( (3+3+2)/3, 2 );
    expect(res.AverageHeatingCOP).toBeCloseTo(3.0, 2);
    expect(res.AverageHotWaterCOP).toBeCloseTo(3.0, 2);
  });

  test('Some categories consumed = 0 -> skip those categories', async () => {
    const mockData = {
      TotalHeatingConsumed: 0,
      TotalHeatingProduced: 0,
      TotalHotWaterConsumed: 5,
      TotalHotWaterProduced: 15,
      CoP: [0, null, 3]
    };

  // getDailyEnergyTotals will call getEnergyData twice when totals are zero (7-day, then yesterday)
  jest.spyOn(api as any, 'getEnergyData').mockResolvedValueOnce(mockData).mockResolvedValueOnce(mockData);

    const res = await api.getDailyEnergyTotals('1', 1);

    expect(res.heatingCOP).toBeNull();
    expect(res.hotWaterCOP).toBeCloseTo(3.0, 2);
    expect(res.averageCOP).toBeCloseTo(3.0, 2);
  });

  test('All consumption = 0 -> fallback to CoP[] average', async () => {
    const mockData = {
      TotalHeatingConsumed: 0,
      TotalHeatingProduced: 0,
      TotalHotWaterConsumed: 0,
      TotalHotWaterProduced: 0,
      CoP: [0, null, 2.5, 3.0]
    };

  // getDailyEnergyTotals will call getEnergyData twice when totals are zero
  jest.spyOn(api as any, 'getEnergyData').mockResolvedValueOnce(mockData).mockResolvedValueOnce(mockData);

    const res = await api.getDailyEnergyTotals('1', 1);

    expect(res.heatingCOP).toBeNull();
    expect(res.hotWaterCOP).toBeNull();
    expect(res.averageCOP).toBeCloseTo((2.5 + 3.0) / 2, 2);
    expect(res.AverageHeatingCOP).toBeCloseTo((2.5 + 3.0) / 2, 2);
  });

  test('Empty/malformed API response -> fallback zeros and null COPs', async () => {
  // Simulate API returning null for both attempts (7-day range then yesterday)
  jest.spyOn(api as any, 'getEnergyData').mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const res = await api.getDailyEnergyTotals('1', 1);

    expect(res.TotalHeatingConsumed).toBe(0);
    expect(res.TotalHotWaterConsumed).toBe(0);
    expect(res.heatingCOP).toBeNull();
    expect(res.hotWaterCOP).toBeNull();
    expect(res.averageCOP).toBeNull();
  });
});

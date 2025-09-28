import os from 'os';
import { HotWaterService } from '../../src/services/hot-water/hot-water-service';

describe('HotWaterService (unit)', () => {
  const makeHomey = () => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    settings: {
      get: jest.fn().mockReturnValue(undefined),
      set: jest.fn(),
      unset: jest.fn(),
      on: jest.fn()
    },
    env: { userDataPath: os.tmpdir() }
  });

  test('collectData returns false when deviceState is missing temperature', async () => {
    const homey: any = makeHomey();
    const svc = new HotWaterService(homey);

    // Replace internal dependencies with light-weight mocks
    (svc as any).dataCollector = { addDataPoint: jest.fn().mockResolvedValue(undefined) };
    (svc as any).analyzer = { updatePatterns: jest.fn().mockResolvedValue(undefined) };

    const res = await svc.collectData(undefined as any);
    expect(res).toBe(false);
    expect((svc as any).dataCollector.addDataPoint).not.toHaveBeenCalled();
  });

  test('collectData adds a valid datapoint and triggers analyzer when interval passed', async () => {
    const homey: any = makeHomey();
    const svc = new HotWaterService(homey);

    // Make dataCollector and analyzer mocks
    const addSpy = jest.fn().mockResolvedValue(undefined);
    const updatePatterns = jest.fn().mockResolvedValue(undefined);

    (svc as any).dataCollector = {
      addDataPoint: addSpy,
      getMemoryUsage: jest.fn().mockReturnValue(123),
      getDataStatistics: jest.fn().mockReturnValue({}),
      getAllDataPoints: jest.fn().mockReturnValue([]),
      clearData: jest.fn().mockResolvedValue(undefined)
    };
    (svc as any).analyzer = {
      updatePatterns,
      getOptimalTankTemperature: jest.fn().mockReturnValue(42),
      getPatterns: jest.fn().mockReturnValue({}),
      predictNext24Hours: jest.fn().mockReturnValue([]),
      resetPatterns: jest.fn()
    };

    // Force lastDataCollectionTime back so collectData proceeds
    (svc as any).lastDataCollectionTime = Date.now() - (60 * 60 * 1000);
    (svc as any).lastAnalysisTime = Date.now() - (24 * 60 * 60 * 1000);

    const deviceState = {
      SetTankWaterTemperature: 50,
      TankWaterTemperature: 45,
      DailyHotWaterEnergyProduced: 1.2,
      DailyHotWaterEnergyConsumed: 2.4,
      HotWaterActive: true
    };

    const res = await svc.collectData(deviceState as any);
    expect(res).toBe(true);
    expect(addSpy).toHaveBeenCalled();
    expect(updatePatterns).toHaveBeenCalled();
  });

  test('getOptimalTankTemperature returns analyzer result and handles errors', () => {
    const homey: any = makeHomey();
    const svc = new HotWaterService(homey);

    (svc as any).dataCollector = { getMemoryUsage: jest.fn().mockReturnValue(10) };
    (svc as any).analyzer = { getOptimalTankTemperature: jest.fn().mockReturnValue(38) };

    const opt = svc.getOptimalTankTemperature(30, 50, 0.5, 'NORMAL');
    expect(opt).toBe(38);

    // Simulate analyzer throwing
    (svc as any).analyzer.getOptimalTankTemperature = jest.fn().mockImplementation(() => { throw new Error('boom'); });
    const fallback = svc.getOptimalTankTemperature(30, 50, 0.5, 'NORMAL');
    expect(fallback).toBeCloseTo(40); // middle value
  });

  test('forceDataCleanup calls underlying dataCollector and returns summary', async () => {
    const homey: any = makeHomey();
    const svc = new HotWaterService(homey);

    const mockCollector: any = {
      getMemoryUsage: jest.fn().mockReturnValue(50),
      getAllDataPoints: jest.fn().mockReturnValue([1, 2, 3]),
      clearData: jest.fn().mockResolvedValue(undefined)
    };

    (svc as any).dataCollector = mockCollector;

    const res = await svc.forceDataCleanup();
    expect(res).toHaveProperty('memoryBefore');
    expect(res).toHaveProperty('dataPointsBefore');
    expect(mockCollector.clearData).toHaveBeenCalled();
  });
});

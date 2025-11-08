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
    expect((svc as any).lastDataCollectionTime).toBe(0);
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
    (svc as any).lastDataCollectionTime = Date.now() - (6 * 60 * 1000);
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

  test('collectData derives incremental energy from raw counters', async () => {
    const homey: any = makeHomey();
    const svc = new HotWaterService(homey);

    const storedPoints: any[] = [];
    const addSpy = jest.fn(async (point: any) => {
      storedPoints.push(point);
    });
    const getAllSpy = jest.fn(() => storedPoints);
    const updatePatterns = jest.fn().mockResolvedValue(undefined);

    (svc as any).dataCollector = {
      addDataPoint: addSpy,
      getAllDataPoints: getAllSpy
    };
    (svc as any).analyzer = { updatePatterns };

    const sample = async (produced: number, consumed: number) => {
      await svc.collectData({
        SetTankWaterTemperature: 50,
        TankWaterTemperature: 45,
        DailyHotWaterEnergyProduced: produced,
        DailyHotWaterEnergyConsumed: consumed,
        HotWaterActive: true
      } as any);
      // Allow subsequent samples
      (svc as any).lastDataCollectionTime = Date.now() - (6 * 60 * 1000);
    };

    await sample(2.0, 1.0);
    await sample(2.4, 1.2);
    await sample(2.7, 1.35);

    expect(storedPoints).toHaveLength(3);
    expect(storedPoints[0].hotWaterEnergyProduced).toBeCloseTo(2.0, 5);
    expect(storedPoints[1].hotWaterEnergyProduced).toBeCloseTo(0.4, 5);
    expect(storedPoints[2].hotWaterEnergyProduced).toBeCloseTo(0.3, 5);
    expect(storedPoints[1].rawHotWaterEnergyProduced).toBeCloseTo(2.4, 5);
    expect(storedPoints[2].rawHotWaterEnergyProduced).toBeCloseTo(2.7, 5);
  });

  test('collectData keeps UTC+2 evening samples on the same local day', async () => {
    const homey: any = makeHomey();
    const svc = new HotWaterService(homey);

    const storedPoints: any[] = [];
    const addSpy = jest.fn(async (point: any) => storedPoints.push(point));

    (svc as any).dataCollector = {
      addDataPoint: addSpy,
      getAllDataPoints: jest.fn(() => storedPoints)
    };
    (svc as any).analyzer = { updatePatterns: jest.fn().mockResolvedValue(undefined) };

    const localTimes = [
      {
        date: new Date(Date.UTC(2024, 0, 1, 22, 30)),
        hour: 22,
        timeString: '2024-01-01 22:30:00 Europe/Oslo',
        timeZoneOffset: 2,
        effectiveOffset: 2,
        timeZoneName: 'Europe/Oslo'
      },
      {
        date: new Date(Date.UTC(2024, 0, 1, 22, 35)),
        hour: 22,
        timeString: '2024-01-01 22:35:00 Europe/Oslo',
        timeZoneOffset: 2,
        effectiveOffset: 2,
        timeZoneName: 'Europe/Oslo'
      }
    ];

    (svc as any).timeZoneHelper = {
      getLocalTime: jest.fn(() => (localTimes.length > 1 ? localTimes.shift()! : localTimes[0]))
    };

    const nowSpy = jest.spyOn(Date, 'now')
      .mockReturnValueOnce(Date.UTC(2024, 0, 1, 20, 30))
      .mockReturnValueOnce(Date.UTC(2024, 0, 1, 20, 35));

    const sample = async (produced: number, consumed: number) => {
      await svc.collectData({
        SetTankWaterTemperature: 50,
        TankWaterTemperature: 45,
        DailyHotWaterEnergyProduced: produced,
        DailyHotWaterEnergyConsumed: consumed,
        HotWaterActive: true
      } as any);
    };

    await sample(1.2, 0.6);
    await sample(1.4, 0.7);

    nowSpy.mockRestore();

    expect(storedPoints).toHaveLength(2);
    expect(storedPoints[0].localDayKey).toBe(storedPoints[1].localDayKey);
    expect(storedPoints[1].hotWaterEnergyProduced).toBeCloseTo(0.2, 5);
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

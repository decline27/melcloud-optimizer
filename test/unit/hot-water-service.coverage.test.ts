describe('HotWaterService branch coverage', () => {
  let homey: any;
  let service: any;
  let HotWaterService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    homey = { log: jest.fn(), error: jest.fn() };

    // Mock dependencies used by the service constructor
    const mockCollectorInstance = {
      addDataPoint: jest.fn().mockResolvedValue(undefined),
      getMemoryUsage: jest.fn().mockReturnValue(12345),
      getAllDataPoints: jest.fn().mockReturnValue([]),
      clearData: jest.fn().mockResolvedValue(undefined),
      getDataStatistics: jest.fn().mockReturnValue({ days: 7 }),
    };
    const mockAnalyzerInstance = {
      updatePatterns: jest.fn().mockResolvedValue(true),
      getOptimalTankTemperature: jest.fn().mockReturnValue(50),
      getPatterns: jest.fn().mockReturnValue({ peaks: [7, 20] }),
      predictNext24Hours: jest.fn().mockReturnValue([0, 1, 2]),
      resetPatterns: jest.fn(),
    };

    jest.doMock('../../src/services/hot-water/hot-water-data-collector', () => ({
      HotWaterDataCollector: class {
        constructor() { return mockCollectorInstance as any; }
      }
    }));

    jest.doMock('../../src/services/hot-water/hot-water-analyzer', () => ({
      HotWaterAnalyzer: class {
        constructor() { return mockAnalyzerInstance as any; }
      }
    }));

    const mod = await import('../../src/services/hot-water/hot-water-service');
    HotWaterService = mod.HotWaterService;
    service = new HotWaterService(homey);
  });

  test('collectData returns false when called before interval', async () => {
    (service as any).lastDataCollectionTime = Date.now();
    const res = await service.collectData({});
    expect(res).toBe(false);
  });

  test('collectData returns false when tank data missing', async () => {
    (service as any).lastDataCollectionTime = 0;
    const res = await service.collectData({});
    expect(res).toBe(false);
    expect(homey.log).toHaveBeenCalledWith('No tank water temperature data available');
  });

  test('collectData happy path collects and triggers analysis occasionally', async () => {
    (service as any).lastDataCollectionTime = 0;
    (service as any).lastAnalysisTime = 0; // ensure analysis path
    const deviceState = {
      SetTankWaterTemperature: 50,
      TankWaterTemperature: 45,
      DailyHotWaterEnergyProduced: 4,
      DailyHotWaterEnergyConsumed: 2,
      OperationMode: 1,
      HotWaterActive: true,
    };
    const ok = await service.collectData(deviceState);
    expect(ok).toBe(true);
    expect((service as any).dataCollector.addDataPoint).toHaveBeenCalled();
    expect((service as any).analyzer.updatePatterns).toHaveBeenCalled();
  });

  test('collectData catches errors and returns false', async () => {
    (service as any).lastDataCollectionTime = 0;
    (service as any).dataCollector.addDataPoint.mockRejectedValue(new Error('fail'));
    const ok = await service.collectData({ SetTankWaterTemperature: 50 });
    expect(ok).toBe(false);
    expect(homey.error).toHaveBeenCalled();
  });

  test('calculateCOP covers zero and normal and error paths', async () => {
    const copZero = (service as any).calculateCOP({ DailyHotWaterEnergyProduced: 1, DailyHotWaterEnergyConsumed: 0 });
    expect(copZero).toBe(0);
    const cop = (service as any).calculateCOP({ DailyHotWaterEnergyProduced: 4, DailyHotWaterEnergyConsumed: 2 });
    expect(cop).toBe(2);
    const copErr = (service as any).calculateCOP(null);
    expect(copErr).toBe(0);
  });

  test('isHeatingHotWater covers mode flag, below-target+flag, and error path', () => {
    const modeTrue = (service as any).isHeatingHotWater({ OperationMode: 1 });
    expect(modeTrue).toBe(true);
    const belowTargetTrue = (service as any).isHeatingHotWater({ OperationMode: 0, TankWaterTemperature: 40, SetTankWaterTemperature: 50, HotWaterActive: true });
    expect(belowTargetTrue).toBe(true);
    const falseCase = (service as any).isHeatingHotWater({ OperationMode: 0, TankWaterTemperature: 50, SetTankWaterTemperature: 50, HotWaterActive: false });
    expect(falseCase).toBe(false);
    const errCase = (service as any).isHeatingHotWater(null);
    expect(errCase).toBe(false);
  });

  test('getOptimalTankTemperature returns analyzer value and error fallback', () => {
    const val = service.getOptimalTankTemperature(45, 55, 0.5, 'NORMAL');
    expect(val).toBe(50);
    (service as any).analyzer.getOptimalTankTemperature.mockImplementation(() => { throw new Error('boom'); });
    const fallback = service.getOptimalTankTemperature(40, 60, 0.5, 'NORMAL');
    expect(fallback).toBe(50); // mid-point fallback
  });

  test('getUsageStatistics returns structure and handles errors', () => {
    const res = service.getUsageStatistics(7);
    expect(res).toHaveProperty('statistics');
    expect(res).toHaveProperty('patterns');
    expect(res).toHaveProperty('predictions');
    (service as any).dataCollector.getDataStatistics.mockImplementation(() => { throw new Error('bad'); });
    const errRes = service.getUsageStatistics();
    expect(errRes).toBeNull();
  });

  test('forceDataCleanup returns metrics and handles errors', async () => {
    (service as any).dataCollector.getAllDataPoints.mockReturnValue([1, 2, 3]);
    const res = await service.forceDataCleanup();
    expect(res).toHaveProperty('memoryBefore');
    expect(res).toHaveProperty('memoryAfter');
    expect(res).toHaveProperty('dataPointsBefore');
    expect(res).toHaveProperty('dataPointsAfter');

    (service as any).dataCollector.clearData.mockRejectedValue(new Error('nope'));
    const err = await service.forceDataCleanup();
    expect(err).toHaveProperty('error');
  });

  test('clearData clears and conditionally resets patterns', async () => {
    await service.clearData(true);
    expect((service as any).dataCollector.clearData).toHaveBeenCalledWith(true);
    expect((service as any).analyzer.resetPatterns).toHaveBeenCalled();

    jest.clearAllMocks();
    await service.clearData(false);
    expect((service as any).dataCollector.clearData).toHaveBeenCalledWith(false);
    expect((service as any).analyzer.resetPatterns).not.toHaveBeenCalled();
  });
});

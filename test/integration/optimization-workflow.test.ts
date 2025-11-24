import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';
import { Optimizer } from '../../src/services/optimizer';
import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { COPHelper } from '../../src/services/cop-helper';
import {
  createMockLogger,
  createMockHomey
} from '../mocks';

// This test uses real implementations but mock APIs
describe('Optimization Workflow Integration', () => {
  let melCloud: MelCloudApi;
  let tibber: TibberApi;
  let optimizer: Optimizer;
  let thermalModelService: ThermalModelService;
  let copHelper: COPHelper;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockHomey: ReturnType<typeof createMockHomey>;

  beforeEach(() => {
    // Create mocks
    mockLogger = createMockLogger();

    // Create mock Homey
    mockHomey = createMockHomey();

    // Mock the file system operations
    jest.mock('fs', () => ({
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn().mockReturnValue('{}'),
      writeFileSync: jest.fn(),
      mkdirSync: jest.fn()
    }));

    // Create real instances with mock dependencies
    melCloud = new MelCloudApi(mockLogger);
    tibber = new TibberApi('test-token', mockLogger);

    // Mock the ThermalModelService and COPHelper instead of creating real instances
    thermalModelService = {
      collectDataPoint: jest.fn(),
      getThermalCharacteristics: jest.fn().mockReturnValue({
        heatingRate: 0.5,
        coolingRate: 0.2,
        thermalMass: 0.8,
        modelConfidence: 0.7,
        lastUpdated: new Date().toISOString()
      }),
      getHeatingRecommendation: jest.fn().mockReturnValue({
        recommendedTemperature: 21.5,
        recommendedStartTime: new Date().toISOString(),
        estimatedSavings: 0.5,
        confidence: 0.7,
        explanation: 'Test recommendation'
      }),
      getTimeToTarget: jest.fn().mockReturnValue({
        timeToTarget: 60,
        confidence: 0.7
      }),
      stop: jest.fn()
    } as any;

    copHelper = {
      compute: jest.fn().mockResolvedValue(undefined),
      getAverageCOP: jest.fn().mockResolvedValue(3.5),
      getLatestCOP: jest.fn().mockResolvedValue({
        heating: 3.2,
        hotWater: 2.8
      }),
      isSummerSeason: jest.fn().mockReturnValue(false),
      getSeasonalCOP: jest.fn().mockResolvedValue(3.2),
      getCOPData: jest.fn().mockResolvedValue({
        heating: {
          daily: 3.2,
          weekly: 3.3,
          monthly: 3.4
        },
        hotWater: {
          daily: 2.8,
          weekly: 2.9,
          monthly: 3.0
        },
        seasonal: {
          isSummer: false,
          currentCOP: 3.2
        }
      })
    } as any;

    // Mock API methods
    melCloud.login = jest.fn().mockResolvedValue(true);
    melCloud.getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: 'device-1',
      RoomTemperature: 21,
      RoomTemperatureZone1: 21,
      SetTemperature: 22,
      SetTemperatureZone1: 22,
      OutdoorTemperature: 5,
      IdleZone1: false,
      DailyHeatingEnergyProduced: 10,
      DailyHeatingEnergyConsumed: 3,
      DailyHotWaterEnergyProduced: 5,
      DailyHotWaterEnergyConsumed: 2
    });
    melCloud.setDeviceTemperature = jest.fn().mockResolvedValue(true);

    tibber.getPrices = jest.fn().mockResolvedValue({
      current: {
        price: 1.2,
        time: new Date().toISOString()
      },
      prices: [
        {
          time: new Date().toISOString(),
          price: 1.2
        },
        {
          time: new Date(Date.now() + 3600000).toISOString(),
          price: 1.5
        },
        {
          time: new Date(Date.now() + 7200000).toISOString(),
          price: 0.8
        }
      ]
    });

    // Create optimizer with real implementations
    optimizer = new Optimizer(
      melCloud,
      tibber,
      'device-1',
      1,
      mockLogger as any,
      undefined,
      mockHomey
    );

    // Set up optimizer
    optimizer.setTemperatureConstraints(18, 22, 0.5);
    optimizer.setCOPSettings(0.3, true, false);

    // Set the services using reflection to avoid TypeScript errors
    // This is only for testing purposes
    Object.defineProperty(optimizer, 'thermalModelService', {
      value: thermalModelService,
      writable: true
    });

    Object.defineProperty(optimizer, 'copHelper', {
      value: copHelper,
      writable: true
    });

    // Mock thermal model service methods
    (thermalModelService as any).collectDataPoint = jest.fn();
    (thermalModelService as any).getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.2,
      thermalMass: 0.8,
      modelConfidence: 0.7,
      lastUpdated: new Date().toISOString()
    });

    // Mock COP helper methods
    (copHelper as any).getSeasonalCOP = jest.fn().mockResolvedValue(3.2);
    (copHelper as any).getLatestCOP = jest.fn().mockResolvedValue({
      heating: 3.2,
      hotWater: 2.8
    });
    (copHelper as any).isSummerSeason = jest.fn().mockReturnValue(false);
  });

  test('Complete optimization workflow', async () => {
    // Run the optimization
    const result = await optimizer.runOptimization();

    // Verify the result
    expect(result).toBeDefined();
    expect(result.targetTemp).toBeDefined();
    expect(result.reason).toBeDefined();
    expect(result.priceNow).toBe(1.2);

    // Verify API calls
    expect(tibber.getPrices).toHaveBeenCalled();
    expect(melCloud.getDeviceState).toHaveBeenCalledWith('device-1', 1);
    expect(melCloud.setDeviceTemperature).toHaveBeenCalled();

    // Verify thermal model data collection
    expect((thermalModelService as any).collectDataPoint).toHaveBeenCalled();
  });

  test('Weekly calibration workflow', async () => {
    // Mock the thermal model service to return data for calibration
    (thermalModelService as any).getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.6, // Different from initial K value
      coolingRate: 0.2,
      thermalMass: 0.8,
      modelConfidence: 0.8, // High confidence
      lastUpdated: new Date().toISOString()
    });

    // Set initial K value
    optimizer.setThermalModel(0.5);

    // Run the calibration
    const result = await optimizer.runWeeklyCalibration();

    // Verify the result
    expect(result).toBeDefined();
    expect(result.newK).toBeDefined();
    expect(result.oldK).toBeDefined();

    // Since we're using mocks, we can't guarantee the K value will change
    // Instead, verify that the thermal model was used
    expect((thermalModelService as any).getThermalCharacteristics).toHaveBeenCalled();
  });

  test('Optimization with COP weighting', async () => {
    // Set a higher COP weight
    optimizer.setCOPSettings(0.7, true, false);

    // Run the optimization
    const result = await optimizer.runOptimization();

    // Verify the result
    expect(result).toBeDefined();
    expect(result.targetTemp).toBeDefined();
    expect(result.reason).toBeDefined();
    expect(result.priceNow).toBe(1.2);

    // Verify COP helper was used
    expect((copHelper as any).getSeasonalCOP).toHaveBeenCalled();
  });

  test('Optimization in summer mode', async () => {
    // Set summer mode
    optimizer.setCOPSettings(0.3, true, true);
    (copHelper as any).isSummerSeason = jest.fn().mockReturnValue(true);

    // Mock the getHeatingRecommendation to include summer in the explanation
    (thermalModelService as any).getHeatingRecommendation = jest.fn().mockReturnValue({
      recommendedTemperature: 21.5,
      recommendedStartTime: new Date().toISOString(),
      estimatedSavings: 0.5,
      confidence: 0.7,
      explanation: 'Summer mode active, optimizing for hot water only'
    });

    // Run the optimization
    const result = await optimizer.runOptimization();

    // Verify the result
    expect(result).toBeDefined();
    expect(result.targetTemp).toBeDefined();

    // Verify summer mode logic was used
    expect((copHelper as any).isSummerSeason).toHaveBeenCalled();
  });

  test('Error handling in optimization workflow', async () => {
    // Make Tibber API fail
    tibber.getPrices = jest.fn().mockRejectedValue(new Error('Tibber API error'));

    // Run the optimization and expect it to throw
    await expect(optimizer.runOptimization()).rejects.toThrow('Tibber API error');

    // Verify error logging
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

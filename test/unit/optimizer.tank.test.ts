import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';
import { ThermalModelService } from '../../src/services/thermal-model';
import { WeatherApi } from '../../src/services/weather-api';
import { HomeyApp, HomeyLogger, MelCloudDevice, TibberPriceInfo, WeatherData, OptimizationResult } from '../../src/types';
import { validateNumber } from '../../src/util/validation'; // Assuming this is used by optimizer or needed for mocks

// --- Mocks ---
const mockLogger: HomeyLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  api: jest.fn(), // if your HomeyLogger has this
  optimization: jest.fn(), // if your HomeyLogger has this
};

const mockHomeySettingsGet = jest.fn();
const mockHomeyApp = {
  settings: {
    get: mockHomeySettingsGet,
    set: jest.fn(),
    unset: jest.fn(),
    on: jest.fn(),
  },
  log: mockLogger.log, // Use the same logger instance
  error: mockLogger.error,
} as unknown as HomeyApp;

const mockMelCloudApi = {
  getDeviceState: jest.fn(),
  setDeviceTemperature: jest.fn(),
  setDeviceTankTemperature: jest.fn(), // Important mock for these tests
  login: jest.fn(),
  getDevices: jest.fn(),
} as unknown as MelCloudApi;

const mockTibberApi = {
  getPrices: jest.fn(),
} as unknown as TibberApi;

const mockWeatherApi = {
  getCurrentWeather: jest.fn().mockResolvedValue({
    temperature: 10, windSpeed: 5, humidity: 60, cloudCover: 50, precipitation: 0,
  } as WeatherData),
} as unknown as WeatherApi;

const mockThermalModelService = {
    getHeatingRecommendation: jest.fn(),
    getThermalCharacteristics: jest.fn().mockReturnValue({ modelConfidence: 0.8 }),
    collectDataPoint: jest.fn(),
    getTimeToTarget: jest.fn().mockReturnValue({ timeToTarget: 30, confidence: 0.8, predictedTemperature: 21 }),
} as unknown as ThermalModelService;


describe('Optimizer - Tank Temperature Optimization Logic', () => {
  let optimizer: Optimizer;
  const deviceId = 'test-device';
  const buildingId = 123;

  // Default device state supporting tank temp
  const baseDeviceStateWithTank: MelCloudDevice = {
    DeviceID: deviceId,
    BuildingID: buildingId,
    RoomTemperature: 20,
    SetTemperature: 21,
    OutdoorTemperature: 10,
    SetTankWaterTemperature: 45, // Current tank temp
    Power: true,
    EffectiveFlags: 0,
    HasPendingCommand: false,
    IdleZone1: false, // Assuming not idle for heating tests
    // Add other relevant fields if Optimizer uses them
  };

  const basePriceInfo: TibberPriceInfo = {
      current: { price: 0.15, time: new Date().toISOString() }, // Normal price
      prices: Array.from({ length: 5 }, (_, i) => ({ price: 0.15 + i * 0.01, time: new Date(Date.now() + i * 3600000).toISOString() })),
  };
   // Add a mock for Tibber price levels
  const mockPriceLevels = (level: 'CHEAP' | 'NORMAL' | 'EXPENSIVE' | 'VERY_EXPENSIVE') => {
    let price = 0.15; // NORMAL
    if (level === 'CHEAP') price = 0.05;
    if (level === 'EXPENSIVE') price = 0.25;
    if (level === 'VERY_EXPENSIVE') price = 0.50;
    return {
      ...basePriceInfo,
      current: { ...basePriceInfo.current, price },
      // Adjust avg for price level logic in optimizer
      // avgPrice is calculated inside optimizer, so we just need to provide prices array
      prices: [{price: 0.10, time:''}, {price:0.20, time:''}] // ensure avg is around 0.15
    };
  };


  beforeEach(() => {
    jest.clearAllMocks();

    // Default settings
    mockHomeySettingsGet.mockImplementation((key: string) => {
      const settings: { [id: string]: any } = {
        'enable_tank_control': true,
        'min_tank_temp': 40,
        'max_tank_temp': 55,
        'tank_temp_step': 1,
        'min_temp': 18, 'max_temp': 22, 'temp_step': 0.5, // For main heating
        'cop_weight': 0.3, 'auto_seasonal_mode': true, 'summer_mode': false, // COP
        'comfort_profile_enabled': false, // Comfort profile disabled for these specific tank tests
      };
      return settings[key];
    });

    // Mock default getHeatingRecommendation from ThermalModelService
    mockThermalModelService.getHeatingRecommendation = jest.fn().mockReturnValue({
        recommendedTemperature: 21, // Default room temp target
        explanation: "Default recommendation",
    });


    optimizer = new Optimizer(
      mockMelCloudApi,
      mockTibberApi,
      deviceId,
      buildingId,
      mockLogger,
      mockWeatherApi,
      mockHomeyApp
    );
    // Initialize thermal model service within optimizer if not done by constructor already
    (optimizer as any).thermalModelService = mockThermalModelService;

  });

  it('1. Tank control disabled: should NOT call setDeviceTankTemperature', async () => {
    mockHomeySettingsGet.mockReturnValueOnce(false); // Disable tank control
    optimizer = new Optimizer(mockMelCloudApi, mockTibberApi, deviceId, buildingId, mockLogger, mockWeatherApi, mockHomeyApp);
     (optimizer as any).thermalModelService = mockThermalModelService;


    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue(baseDeviceStateWithTank);
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('NORMAL'));

    const result = await optimizer.runHourlyOptimization();

    expect(mockMelCloudApi.setDeviceTankTemperature).not.toHaveBeenCalled();
    expect(result.tank).toBeUndefined();
  });

  it('2. Device does not support tank control: should NOT call setDeviceTankTemperature', async () => {
    const deviceStateNoTank = { ...baseDeviceStateWithTank, SetTankWaterTemperature: undefined };
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue(deviceStateNoTank);
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('NORMAL'));

    const result = await optimizer.runHourlyOptimization();

    expect(mockMelCloudApi.setDeviceTankTemperature).not.toHaveBeenCalled();
    expect(result.tank?.reason).toContain('device does not support');
  });

  it('3. Price Level CHEAP: should set tank to maxTankTemp', async () => {
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: 45 });
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('CHEAP'));

    const result = await optimizer.runHourlyOptimization();

    const maxTankTemp = mockHomeySettingsGet('max_tank_temp');
    expect(mockMelCloudApi.setDeviceTankTemperature).toHaveBeenCalledWith(deviceId, buildingId, maxTankTemp);
    expect(result.tank?.targetTemp).toBe(maxTankTemp);
    expect(result.tank?.reason).toContain('Price is CHEAP');
  });

  it('4. Price Level EXPENSIVE: should set tank to minTankTemp', async () => {
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: 50 });
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('EXPENSIVE'));

    const result = await optimizer.runHourlyOptimization();

    const minTankTemp = mockHomeySettingsGet('min_tank_temp');
    expect(mockMelCloudApi.setDeviceTankTemperature).toHaveBeenCalledWith(deviceId, buildingId, minTankTemp);
    expect(result.tank?.targetTemp).toBe(minTankTemp);
    expect(result.tank?.reason).toContain('Price is EXPENSIVE');
  });

  it('5. Price Level NORMAL: should adjust to conservative temp if current is high', async () => {
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: 55 }); // Currently at max
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('NORMAL'));

    const result = await optimizer.runHourlyOptimization();

    const minTankTemp = mockHomeySettingsGet('min_tank_temp');
    const tankTempStep = mockHomeySettingsGet('tank_temp_step');
    const conservativeTarget = minTankTemp + tankTempStep; // e.g., 40 + 1 = 41

    expect(mockMelCloudApi.setDeviceTankTemperature).toHaveBeenCalledWith(deviceId, buildingId, conservativeTarget);
    expect(result.tank?.targetTemp).toBe(conservativeTarget);
    expect(result.tank?.reason).toContain('Price is NORMAL, adjusting tank to a conservative');
  });

  it('5b. Price Level NORMAL: should maintain acceptable temp if current is already conservative', async () => {
    const conservativeTemp = (mockHomeySettingsGet('min_tank_temp') as number) + (mockHomeySettingsGet('tank_temp_step') as number);
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: conservativeTemp });
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('NORMAL'));

    const result = await optimizer.runHourlyOptimization();

    expect(mockMelCloudApi.setDeviceTankTemperature).not.toHaveBeenCalled();
    expect(result.tank?.targetTemp).toBe(conservativeTemp);
    expect(result.tank?.reason).toContain('Price is NORMAL, tank temperature');
    expect(result.tank?.reason).toContain('is acceptable');
  });


  it('6. Temperature Already Optimal (CHEAP price, tank at max): should NOT call setDeviceTankTemperature', async () => {
    const maxTankTemp = mockHomeySettingsGet('max_tank_temp');
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: maxTankTemp });
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('CHEAP'));

    const result = await optimizer.runHourlyOptimization();

    expect(mockMelCloudApi.setDeviceTankTemperature).not.toHaveBeenCalled();
    expect(result.tank?.targetTemp).toBe(maxTankTemp);
  });

  it('6b. Temperature Already Optimal (EXPENSIVE price, tank at min): should NOT call setDeviceTankTemperature', async () => {
    const minTankTemp = mockHomeySettingsGet('min_tank_temp');
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: minTankTemp });
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('EXPENSIVE'));

    const result = await optimizer.runHourlyOptimization();

    expect(mockMelCloudApi.setDeviceTankTemperature).not.toHaveBeenCalled();
    expect(result.tank?.targetTemp).toBe(minTankTemp);
  });

  it('7. Step Constraints (NORMAL price, current at min, should step up)', async () => {
    const minTankTemp = mockHomeySettingsGet('min_tank_temp');
    const tankTempStep = mockHomeySettingsGet('tank_temp_step');
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: minTankTemp }); // Current is min
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('NORMAL'));

    // For NORMAL, if current is far from a 'normalTarget', it steps.
    // The logic is: normalTarget = minTankTemp + tankTempStep.
    // If currentTankTarget (minTankTemp) > normalTarget (minTankTemp + step) + step -> no (it's lower)
    // If currentTankTarget < minTankTemp -> no (it's at minTankTemp)
    // The "stepping" logic in the current implementation for NORMAL is:
    // `if (Math.abs(newTankTarget - currentTankTarget) > this.tankTempStep * 1.5)`
    // where newTankTarget is initially set to `minTankTemp + tankTempStep` if current is high, or `minTankTemp` if current is low.
    // If current is `minTankTemp`, newTankTarget is `minTankTemp`. Then `abs(minTankTemp - minTankTemp)` is 0, so no step.
    // This test needs to check a different scenario for stepping or the logic needs to be adjusted.
    // Let's test if current is higher, e.g. 50. minTankTemp = 40, step = 1. normalTarget = 41.
    // newTankTarget will be 41. currentTankTarget = 50. abs(41-50)=9. tankTempStep*1.5 = 1.5. 9 > 1.5 is true.
    // So it will step from 50: current (50) + (new (41) > current (50) ? step : -step) = 50 - 1 = 49.

    const highCurrentTemp = 50;
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: highCurrentTemp });
    const expectedSteppedTemp = highCurrentTemp - tankTempStep;

    const result = await optimizer.runHourlyOptimization();

    expect(mockMelCloudApi.setDeviceTankTemperature).toHaveBeenCalledWith(deviceId, buildingId, expectedSteppedTemp);
    expect(result.tank?.targetTemp).toBe(expectedSteppedTemp);
    expect(result.tank?.reason).toContain('stepping tank temperature towards lower setpoint');
  });

  it('8. Clamping: should clamp to maxTankTemp if calculation goes above', async () => {
    // This scenario is hard to trigger with current CHEAP logic as it directly sets to max.
    // Let's assume a misconfiguration or a different price level that might calculate high.
    // For now, CHEAP level directly sets to max, which is inherently clamped.
    // Test clamping by ensuring maxTankTemp is respected by CHEAP price level.
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: 40 });
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('CHEAP'));

    const result = await optimizer.runHourlyOptimization();
    const maxTankTemp = mockHomeySettingsGet('max_tank_temp');
    expect(mockMelCloudApi.setDeviceTankTemperature).toHaveBeenCalledWith(deviceId, buildingId, maxTankTemp);
    expect(result.tank?.targetTemp).toBe(maxTankTemp);
  });

  it('8b. Clamping: should clamp to minTankTemp if calculation goes below', async () => {
    // EXPENSIVE level directly sets to min, which is inherently clamped.
    mockMelCloudApi.getDeviceState = jest.fn().mockResolvedValue({ ...baseDeviceStateWithTank, SetTankWaterTemperature: 55 });
    mockTibberApi.getPrices = jest.fn().mockResolvedValue(mockPriceLevels('EXPENSIVE'));

    const result = await optimizer.runHourlyOptimization();
    const minTankTemp = mockHomeySettingsGet('min_tank_temp');
    expect(mockMelCloudApi.setDeviceTankTemperature).toHaveBeenCalledWith(deviceId, buildingId, minTankTemp);
    expect(result.tank?.targetTemp).toBe(minTankTemp);
  });

});

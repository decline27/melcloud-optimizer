import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { HomeyApp, PricePoint, WeatherData, ThermalCharacteristics, ComfortProfile } from '../../src/types';
import { DateTime } from 'luxon';

// Mock HomeyApp
const mockHomeyApp = {
  log: jest.fn(),
  error: jest.fn(),
  settings: {
    get: jest.fn(),
    set: jest.fn(),
    unset: jest.fn(),
    on: jest.fn(),
  },
  manifest: { version: '1.0.0' },
  id: 'test-app-weather',
  version: '1.0.0',
  platform: 'local',
  app: { // Mock app specific settings that might be used
    minComfortTemp: 18,
    minDeviceTemp: 15,
    maxDeviceTemp: 28, // Slightly higher max for testing pre-heat buffers
  } as any,
} as unknown as HomeyApp;

// Mock ThermalAnalyzer
const mockThermalCharacteristics: ThermalCharacteristics = {
  heatingRate: 0.6, // degC / hour per degree diff with no external influence
  coolingRate: 0.25, // degC / hour with no external influence
  thermalMass: 20,  // kWh / degC (example: energy to change avg building temp by 1C)
  modelConfidence: 0.9,
  lastUpdated: DateTime.now().toISO(),
  outdoorTempImpact: 0.1, // Factor of how much outdoor temp influences rates
  windImpact: 0.05,       // Factor of how much wind influences rates
};
const mockThermalAnalyzer = {
  getThermalCharacteristics: jest.fn().mockReturnValue(mockThermalCharacteristics),
  updateModel: jest.fn(),
  predictTemperature: jest.fn(),
  calculateTimeToTarget: jest.fn(),
};

describe('ThermalModelService - getHeatingRecommendation - Weather Integration', () => {
  let service: ThermalModelService;

  // Default inputs for tests - can be overridden per test case
  const baseTargetTemp = 22;
  const baseCurrentTemp = 20;
  // outdoorTemp passed to getHeatingRecommendation is the *current actual* outdoor temp from device sensor
  const baseOutdoorTempSensor = 10;

  const baseNeutralWeatherForecast: WeatherData = { // "Neutral" or moderate weather
    temperature: 10, // Corresponds to baseOutdoorTempSensor for simplicity in some tests
    windSpeed: 3,    // m/s, low wind
    humidity: 55,    // %
    cloudCover: 40,  // %
    precipitation: 0, // mm
  };

  const basePriceForecasts: PricePoint[] = Array.from({ length: 12 }, (_, i) => ({
    time: DateTime.now().plus({ hours: i }).toISO(),
    price: 0.15, // Stable moderate price
  }));

  const baseComfortProfile: ComfortProfile = {
    enabled: true,
    dayStart: 7,
    dayEnd: 22,
    nightTempReduction: 2,
    preHeatHours: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ThermalModelService(mockHomeyApp);
    (service as any).analyzer = mockThermalAnalyzer; // Inject mock

    // Reset system time for each test if using fake timers
    // jest.useRealTimers(); // Default to real timers unless a test needs fake ones
  });

  // Test placeholder
  it('should initialize', () => {
    expect(service).toBeDefined();
  });

  describe('1. Neutral or No Weather Data', () => {
    it('should use baseline calculations when weather data is neutral (no extreme conditions)', () => {
      // Scenario: Cheap period now, expensive later. Pre-heating should occur.
      const prices: PricePoint[] = [
        { time: DateTime.now().toISO(), price: 0.10 }, // cheap
        { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.30 }, // expensive
        { time: DateTime.now().plus({ hours: 3 }).toISO(), price: 0.30 },
      ];
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T03:00:00.000Z')); // Night time, outside day pre-heat

      const recommendation = service.getHeatingRecommendation(
        prices,
        baseTargetTemp, // 22
        baseTargetTemp - baseComfortProfile.nightTempReduction, // current is 20 (night target)
        baseOutdoorTempSensor, // 10
        baseNeutralWeatherForecast, // 10C, 3m/s wind
        baseComfortProfile
      );

      // Base preheat target (for price): preheatTargetTemp (22) + 1.5 = 23.5
      // Capped by thermalMass: 22 + 20*2 = 62. So, 23.5
      const expectedBasePreHeatTemp = Math.min(baseTargetTemp + 1.5, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);

      expect(recommendation.recommendedTemperature).toBeCloseTo(expectedBasePreHeatTemp);
      expect(recommendation.explanation).not.toMatch(/cold|windy|weather/i); // No mention of specific weather adjustments
      expect(mockHomeyApp.log).not.toHaveBeenCalledWith(expect.stringContaining('WeatherImpact'));
      expect(mockHomeyApp.log).not.toHaveBeenCalledWith(expect.stringContaining('due to Colder'));
      expect(mockHomeyApp.log).not.toHaveBeenCalledWith(expect.stringContaining('due to Windy'));
      jest.useRealTimers();
    });

    it('should handle missing (null/undefined) weatherForecast gracefully, treating as neutral', () => {
      const prices: PricePoint[] = [
        { time: DateTime.now().toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.30 },
      ];
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T03:00:00.000Z'));

      const recommendation = service.getHeatingRecommendation(
        prices,
        baseTargetTemp,
        baseTargetTemp - baseComfortProfile.nightTempReduction,
        baseOutdoorTempSensor, // Still provide current outdoor temp
        null as any, // Simulate null weatherForecast
        baseComfortProfile
      );
      const expectedBasePreHeatTemp = Math.min(baseTargetTemp + 1.5, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);
      expect(recommendation.recommendedTemperature).toBeCloseTo(expectedBasePreHeatTemp);
      expect(recommendation.explanation).not.toMatch(/cold|windy|weather/i);
      jest.useRealTimers();
    });
  });

  describe('2. Cold Outdoor Temperature Influence', () => {
    const coldWeatherForecast: WeatherData = { temperature: -2, windSpeed: 3, humidity: 70, cloudCover: 80, precipitation: 1 };
    const veryColdWeatherForecast: WeatherData = { temperature: -7, windSpeed: 3, humidity: 70, cloudCover: 80, precipitation: 1 };

    const pricesForPreheat: PricePoint[] = [
      { time: DateTime.now().toISO(), price: 0.10 }, // cheap current
      { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.10 },
      { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.35 }, // expensive upcoming
      { time: DateTime.now().plus({ hours: 3 }).toISO(), price: 0.35 },
    ];

    it('should increase pre-heat buffer when weather is cold', () => {
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T03:00:00.000Z')); // Night time
      const currentTemp = baseTargetTemp - baseComfortProfile.nightTempReduction;

      const recNeutral = service.getHeatingRecommendation(pricesForPreheat, baseTargetTemp, currentTemp, baseOutdoorTempSensor, baseNeutralWeatherForecast, baseComfortProfile);
      const recCold = service.getHeatingRecommendation(pricesForPreheat, baseTargetTemp, currentTemp, -2, coldWeatherForecast, baseComfortProfile);

      // Expected base preheat (neutral weather): target (22) + buffer (1.5) = 23.5
      // Expected cold preheat: target (22) + buffer (1.5 + 0.5 for cold) = 24.0
      const basePreHeatBuffer = 1.5; // From Optimizer logic
      const coldAdjustment = 0.5; // From Optimizer logic for temp < 5C
      const expectedNeutralPreHeatTemp = Math.min(baseTargetTemp + basePreHeatBuffer, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);
      const expectedColdPreHeatTemp = Math.min(baseTargetTemp + basePreHeatBuffer + coldAdjustment, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);

      expect(recNeutral.recommendedTemperature).toBeCloseTo(expectedNeutralPreHeatTemp);
      expect(recCold.recommendedTemperature).toBeCloseTo(expectedColdPreHeatTemp);
      expect(recCold.recommendedTemperature).toBeGreaterThan(recNeutral.recommendedTemperature);
      expect(recCold.explanation).toMatch(/colder/i);
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining(`due to Colder (${coldWeatherForecast.temperature.toFixed(1)}°C)`));
      jest.useRealTimers();
    });

    it('should reduce dynamicThermalInertiaHours when weather is very cold, potentially altering decisions', () => {
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T18:00:00.000Z')); // Approaching expensive, Day time

      const characteristics = mockThermalAnalyzer.getThermalCharacteristics();
      const originalInertia = (1 / characteristics.coolingRate) * characteristics.thermalMass; // e.g. (1/0.25)*20 = 80 hours (this seems too high, check mock)
                                                                                             // Let's use more realistic mock values for this test
      mockThermalAnalyzer.getThermalCharacteristics.mockReturnValueOnce({
        ...characteristics,
        coolingRate: 0.2, // Example: 0.2 degC/hour drop
        thermalMass: 10,  // Example: 10 kWh/degC. Inertia = 1/0.2 * 10 = 50 hours.
      });
      // If coolingRate is 0.2, thermalMass is 10 -> inertia is 50 hours.
      // If coolingRate is 0.5, thermalMass is 10 -> inertia is 20 hours.
      // Let's use a coolingRate that gives a more testable inertia. E.g. coolingRate = 0.2, thermalMass = 10 => inertia = 50
      // Let's make it smaller: coolingRate = 0.2, thermalMass = 2 => inertia = 10 hours.
      const testCharacteristics = { ...characteristics, coolingRate: 0.2, thermalMass: 2 }; // Inertia = 10 hours
      (service as any).analyzer.getThermalCharacteristics = jest.fn().mockReturnValue(testCharacteristics);


      // Scenario: expensive period is 6 hours away. Original inertia (10h) > 6h.
      // With very cold weather, dynamic inertia should be less (e.g., 10 * 0.75 = 7.5h), still > 6h.
      // If expensive was 8h away: orig_inertia (10h) > 8h. dynamic_inertia (7.5h) < 8h. This would show change.
      // Let's set expensive period 8 hours away.
      const hoursToExpensive = 8;
      const prices: PricePoint[] = [
        { time: DateTime.now().toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: hoursToExpensive -1 }).toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: hoursToExpensive }).toISO(), price: 0.40 }, // Expensive in 'hoursToExpensive'
      ];

      // Recalculate originalInertia with testCharacteristics
      const calculatedOriginalInertia = (1 / testCharacteristics.coolingRate) * testCharacteristics.thermalMass; // Should be 10

      // Neutral weather: hoursUntilExpensive (8) < calculatedOriginalInertia (10) -> should pre-heat
      const recNeutral = service.getHeatingRecommendation(prices, baseTargetTemp, baseCurrentTemp, baseOutdoorTempSensor, baseNeutralWeatherForecast, baseComfortProfile);
      expect(recNeutral.explanation).toContain('Pre-heating to');
      expect(mockHomeyApp.log).not.toHaveBeenCalledWith(expect.stringContaining('WeatherImpact:'));


      // Very cold weather: dynamic inertia = 10 * 0.75 = 7.5 hours.
      // Now, hoursUntilExpensive (8) is NOT < dynamicInertia (7.5h) is FALSE. It IS greater.
      // So, pre-heating decision based on `hoursUntilExpensive < thermalInertiaHours` should flip if the threshold is tight.
      // The logic is `if (hoursUntilExpensive < thermalInertiaHours) { preheat } else { maintain/default }`
      // Neutral: 8 < 10 is true -> preheat.
      // Cold: 8 < 7.5 is false -> default/maintain.
      const recVeryCold = service.getHeatingRecommendation(prices, baseTargetTemp, baseCurrentTemp, -7, veryColdWeatherForecast, baseComfortProfile);

      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining('WeatherImpact: Significantly reduced thermal inertia due to very cold conditions'));
      expect(recVeryCold.explanation).toContain('Maintaining temperature. Will pre-heat later if needed'); // or similar default explanation
      expect(recVeryCold.explanation).not.toContain('Pre-heating to'); // Should NOT pre-heat due to reduced inertia
      jest.useRealTimers();
    });
  });

  describe('3. High Wind Speed Influence', () => {
    const windyWeatherForecast: WeatherData = { temperature: 10, windSpeed: 18, humidity: 60, cloudCover: 50, precipitation: 0 }; // High wind
    const veryWindyWeatherForecast: WeatherData = { temperature: 10, windSpeed: 25, humidity: 60, cloudCover: 50, precipitation: 0 }; // Very high wind

    const pricesForPreheat: PricePoint[] = [
      { time: DateTime.now().toISO(), price: 0.10 }, // cheap current
      { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.10 },
      { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.35 }, // expensive upcoming
    ];

    it('should increase pre-heat buffer when weather is windy', () => {
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T03:00:00.000Z')); // Night time
      const currentTemp = baseTargetTemp - baseComfortProfile.nightTempReduction;

      const recNeutral = service.getHeatingRecommendation(pricesForPreheat, baseTargetTemp, currentTemp, baseOutdoorTempSensor, baseNeutralWeatherForecast, baseComfortProfile);
      const recWindy = service.getHeatingRecommendation(pricesForPreheat, baseTargetTemp, currentTemp, baseOutdoorTempSensor, windyWeatherForecast, baseComfortProfile);

      const basePreHeatBuffer = 1.5;
      const windAdjustment = 0.5; // For wind > 10 m/s (optimizer logic uses >10 for buffer, >15 for inertia)
                                  // The `calculatedPreHeatTemp` in optimizer uses `currentWindSpeed > 10` for its 0.5 buffer.
      const expectedNeutralPreHeatTemp = Math.min(baseTargetTemp + basePreHeatBuffer, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);
      const expectedWindyPreHeatTemp = Math.min(baseTargetTemp + basePreHeatBuffer + windAdjustment, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);

      expect(recNeutral.recommendedTemperature).toBeCloseTo(expectedNeutralPreHeatTemp);
      expect(recWindy.recommendedTemperature).toBeCloseTo(expectedWindyPreHeatTemp);
      expect(recWindy.recommendedTemperature).toBeGreaterThan(recNeutral.recommendedTemperature);
      expect(recWindy.explanation).toMatch(/windy/i);
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining(`due to Windy (${windyWeatherForecast.windSpeed.toFixed(1)}m/s)`));
      jest.useRealTimers();
    });

    it('should reduce dynamicThermalInertiaHours when weather is very windy, potentially altering decisions', () => {
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T18:00:00.000Z'));
      const testCharacteristics = { ...mockThermalCharacteristics, coolingRate: 0.2, thermalMass: 2 }; // Inertia = 10 hours
      (service as any).analyzer.getThermalCharacteristics = jest.fn().mockReturnValue(testCharacteristics);

      const hoursToExpensive = 8;
      const prices: PricePoint[] = [
        { time: DateTime.now().toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: hoursToExpensive - 1 }).toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: hoursToExpensive }).toISO(), price: 0.40 },
      ];

      // Neutral weather: inertia 10h. 8 < 10 -> preheat
      const recNeutral = service.getHeatingRecommendation(prices, baseTargetTemp, baseCurrentTemp, baseOutdoorTempSensor, baseNeutralWeatherForecast, baseComfortProfile);
      expect(recNeutral.explanation).toContain('Pre-heating to');

      // Very windy weather: dynamic inertia = 10 * 0.8 (for wind > 15) = 8 hours.
      // Now, hoursUntilExpensive (8) < dynamicInertia (8) is FALSE. So, should NOT pre-heat for price.
      // (The logic is `if (hoursUntilExpensive < thermalInertiaHours)`). If they are equal, it doesn't pre-heat.
      const recVeryWindy = service.getHeatingRecommendation(prices, baseTargetTemp, baseCurrentTemp, baseOutdoorTempSensor, veryWindyWeatherForecast, baseComfortProfile);
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining('WeatherImpact: Reduced thermal inertia due to high wind'));
      expect(recVeryWindy.explanation).toContain('Maintaining temperature. Will pre-heat later if needed');
      expect(recVeryWindy.explanation).not.toContain('Pre-heating to');
      jest.useRealTimers();
    });
  });

  describe('4. Cold and Windy Conditions Influence', () => {
    const coldAndWindyForecast: WeatherData = { temperature: -2, windSpeed: 18, humidity: 70, cloudCover: 80, precipitation: 1 };

    const pricesForPreheat: PricePoint[] = [
      { time: DateTime.now().toISO(), price: 0.10 },
      { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.10 },
      { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.35 },
    ];

    it('should apply cumulative effects for pre-heat buffer when cold and windy', () => {
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T03:00:00.000Z'));
      const currentTemp = baseTargetTemp - baseComfortProfile.nightTempReduction;

      const recNeutral = service.getHeatingRecommendation(pricesForPreheat, baseTargetTemp, currentTemp, baseOutdoorTempSensor, baseNeutralWeatherForecast, baseComfortProfile);
      const recColdAndWindy = service.getHeatingRecommendation(pricesForPreheat, baseTargetTemp, currentTemp, -2, coldAndWindyForecast, baseComfortProfile);

      const basePreHeatBuffer = 1.5;
      const coldAdjustment = 0.5;
      const windAdjustment = 0.5;
      const expectedNeutralPreHeatTemp = Math.min(baseTargetTemp + basePreHeatBuffer, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);
      const expectedColdAndWindyPreHeatTemp = Math.min(baseTargetTemp + basePreHeatBuffer + coldAdjustment + windAdjustment, baseTargetTemp + mockThermalCharacteristics.thermalMass * 2.5);

      expect(recNeutral.recommendedTemperature).toBeCloseTo(expectedNeutralPreHeatTemp);
      expect(recColdAndWindy.recommendedTemperature).toBeCloseTo(expectedColdAndWindyPreHeatTemp);
      expect(recColdAndWindy.recommendedTemperature).toBeGreaterThan(recNeutral.recommendedTemperature);
      expect(recColdAndWindy.explanation).toMatch(/colder/i);
      expect(recColdAndWindy.explanation).toMatch(/windy/i);
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining(`due to Colder (${coldAndWindyForecast.temperature.toFixed(1)}°C)`));
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining(`due to Windy (${coldAndWindyForecast.windSpeed.toFixed(1)}m/s)`));
      jest.useRealTimers();
    });

    it('should apply cumulative effects for dynamicThermalInertia when very cold and very windy', () => {
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T18:00:00.000Z'));
      const testCharacteristics = { ...mockThermalCharacteristics, coolingRate: 0.2, thermalMass: 2 }; // Base Inertia = 10 hours
      (service as any).analyzer.getThermalCharacteristics = jest.fn().mockReturnValue(testCharacteristics);

      const veryColdAndVeryWindyForecast: WeatherData = { temperature: -7, windSpeed: 25, humidity: 70, cloudCover: 80, precipitation: 1 };


      const hoursToExpensive = 9; // Set this carefully
      const prices: PricePoint[] = [
        { time: DateTime.now().toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: hoursToExpensive - 1 }).toISO(), price: 0.10 },
        { time: DateTime.now().plus({ hours: hoursToExpensive }).toISO(), price: 0.40 },
      ];

      // Neutral: inertia 10h. hoursToExpensive (9) < 10 -> preheat
      const recNeutral = service.getHeatingRecommendation(prices, baseTargetTemp, baseCurrentTemp, baseOutdoorTempSensor, baseNeutralWeatherForecast, baseComfortProfile);
      expect(recNeutral.explanation).toContain('Pre-heating to');

      // Very Cold (-7C) -> inertia *= 0.75  (10 * 0.75 = 7.5h)
      // Very Windy (25m/s) -> inertia *= 0.8 (7.5 * 0.8 = 6h)
      // Now, hoursToExpensive (9) is NOT < dynamicInertia (6h) is FALSE. It IS greater.
      // So, should NOT pre-heat.
      const recColdAndWindy = service.getHeatingRecommendation(prices, baseTargetTemp, baseCurrentTemp, -7, veryColdAndVeryWindyForecast, baseComfortProfile);
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining('WeatherImpact: Significantly reduced thermal inertia due to very cold conditions'));
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining('WeatherImpact: Reduced thermal inertia due to high wind'));
      expect(recColdAndWindy.explanation).toContain('Maintaining temperature. Will pre-heat later if needed');
      expect(recColdAndWindy.explanation).not.toContain('Pre-heating to');
      jest.useRealTimers();
    });
  });

  // Test cases will be added here

});

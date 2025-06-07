import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { HomeyApp, PricePoint, WeatherData, ThermalCharacteristics } from '../../src/types';
import { DateTime } from 'luxon';

// Mock HomeyApp
const mockHomeyApp = {
  log: jest.fn(),
  error: jest.fn(),
  settings: {
    get: jest.fn(),
    // Mock other settings methods if used by the service, though not expected for getHeatingRecommendation directly
    set: jest.fn(),
    unset: jest.fn(),
    on: jest.fn(),
  },
  manifest: { version: '1.0.0' },
  id: 'test-app',
  version: '1.0.0',
  platform: 'local',
  // Mock any other HomeyApp properties/methods if they become necessary
  // For ThermalModelService, it primarily uses log, error, and potentially settings.
  // The 'app' property for minComfortTemp, minDeviceTemp, maxDeviceTemp might be used.
  app: {
    minComfortTemp: 18, // Example
    minDeviceTemp: 16,
    maxDeviceTemp: 25,
  } as any, // Cast to any if 'app' structure is more complex or not fully typed here
} as unknown as HomeyApp; // Cast to HomeyApp, acknowledging it's a partial mock

// Mock ThermalAnalyzer
const mockThermalAnalyzer = {
  getThermalCharacteristics: jest.fn().mockReturnValue({
    heatingRate: 0.5, // degC / hour per degree diff
    coolingRate: 0.2, // degC / hour
    thermalMass: 20,  // kWh / degC (example value, indicates energy to change temp)
    modelConfidence: 0.8,
    lastUpdated: DateTime.now().toISO(),
    outdoorTempImpact: 0.1, // How much outdoor temp affects cooling/heating rate
    windImpact: 0.05,       // How much wind affects cooling/heating rate
  } as ThermalCharacteristics),
  // Mock other analyzer methods if they were to be called by getHeatingRecommendation
  updateModel: jest.fn(),
  predictTemperature: jest.fn(),
  calculateTimeToTarget: jest.fn(),
};

describe('ThermalModelService - getHeatingRecommendation - Comfort Profile Logic', () => {
  let service: ThermalModelService;

  // Default inputs for tests - can be overridden per test case
  const baseTargetTemp = 21;
  const baseCurrentTemp = 20;
  const baseOutdoorTemp = 10;
  const baseWeatherForecast: WeatherData = {
    temperature: 10,
    windSpeed: 5,
    humidity: 60,
    cloudCover: 50,
    precipitation: 0,
  };
  const basePriceForecasts: PricePoint[] = [
    { time: DateTime.now().minus({ hours: 1 }).toISO(), price: 0.1 },
    { time: DateTime.now().toISO(), price: 0.1 }, // Current hour
    { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.1 },
    { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.1 },
    { time: DateTime.now().plus({ hours: 3 }).toISO(), price: 0.1 },
    { time: DateTime.now().plus({ hours: 4 }).toISO(), price: 0.1 },
    { time: DateTime.now().plus({ hours: 5 }).toISO(), price: 0.1 },
  ];

  beforeEach(() => {
    jest.clearAllMocks(); // Clear mocks before each test
    service = new ThermalModelService(mockHomeyApp);
    // Inject the mocked analyzer into the service instance
    (service as any).analyzer = mockThermalAnalyzer;
  });

  describe('Comfort Profile Disabled', () => {
    it('should recommend original targetTemp when comfort profile is disabled, regardless of time', () => {
      const comfortProfile = { enabled: false, dayStart: 7, dayEnd: 22, nightTempReduction: 3, preHeatHours: 2 };
      const targetTemp = 22;
      const currentTemp = 20;

      // Mock current time to be night
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T02:00:00.000Z')); // 2 AM

      const recommendation = service.getHeatingRecommendation(
        basePriceForecasts,
        targetTemp,
        currentTemp,
        baseOutdoorTemp,
        baseWeatherForecast,
        comfortProfile
      );

      // Expectation: With profile disabled, it should aim for the targetTemp.
      // The default behavior without price variation is to maintain targetTemp.
      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('comfort profile disabled');
      expect(mockHomeyApp.log).toHaveBeenCalledWith('Comfort profile: Disabled. Using original target temperature.');
      jest.useRealTimers();
    });
  });

  describe('Day Time, Profile Enabled', () => {
    it('should recommend original targetTemp during day time when profile is enabled', () => {
      const comfortProfile = { enabled: true, dayStart: 7, dayEnd: 22, nightTempReduction: 3, preHeatHours: 2 };
      const targetTemp = 21;
      const currentTemp = 20;

      // Mock current time to be day time (e.g., 10 AM)
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T10:00:00.000Z'));

      const recommendation = service.getHeatingRecommendation(
        basePriceForecasts, // Assuming no significant price variations for this baseline test
        targetTemp,
        currentTemp,
        baseOutdoorTemp,
        baseWeatherForecast,
        comfortProfile
      );

      // Expectation: During day time, effective target is the main targetTemp.
      // Without price variations, recommended should be targetTemp.
      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('Day period active');
      expect(recommendation.explanation).not.toContain('Night reduction active');
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Day period. Target: ${targetTemp}°C`);
      jest.useRealTimers();
    });

    it('should handle overnight day period correctly (e.g. day is 22:00 to 07:00) - during day part 1', () => {
      const comfortProfile = { enabled: true, dayStart: 22, dayEnd: 7, nightTempReduction: 3, preHeatHours: 1 };
      const targetTemp = 20;
      // Mock current time to be 23:00 (part of "day")
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T23:00:00.000Z'));
      const recommendation = service.getHeatingRecommendation(basePriceForecasts, targetTemp, 19, baseOutdoorTemp, baseWeatherForecast, comfortProfile);
      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('Day period active');
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Day period. Target: ${targetTemp}°C`);
      jest.useRealTimers();
    });

    it('should handle overnight day period correctly (e.g. day is 22:00 to 07:00) - during day part 2', () => {
      const comfortProfile = { enabled: true, dayStart: 22, dayEnd: 7, nightTempReduction: 3, preHeatHours: 1 };
      const targetTemp = 20;
      // Mock current time to be 06:00 (part of "day")
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T06:00:00.000Z'));
      const recommendation = service.getHeatingRecommendation(basePriceForecasts, targetTemp, 19, baseOutdoorTemp, baseWeatherForecast, comfortProfile);
      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('Day period active');
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Day period. Target: ${targetTemp}°C`);
      jest.useRealTimers();
    });
  });

  describe('Night Time, Profile Enabled, No Pre-heating', () => {
    it('should recommend reduced targetTemp during night time and outside pre-heat window', () => {
      const nightTempReduction = 3;
      const targetTemp = 21;
      const expectedNightTarget = targetTemp - nightTempReduction; // 18
      const comfortProfile = { enabled: true, dayStart: 7, dayEnd: 22, nightTempReduction, preHeatHours: 1 }; // Day: 7-22, PreHeat: 6-7

      // Mock current time to be deep night (e.g., 2 AM), well outside preHeatHours for dayStart=7
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T02:00:00.000Z'));

      const recommendation = service.getHeatingRecommendation(
        basePriceForecasts, // Assuming no significant price variations
        targetTemp,
        targetTemp, // Current temp is at day target, should reduce
        baseOutdoorTemp,
        baseWeatherForecast,
        comfortProfile
      );

      // Expectation: Recommended temp should be the night-reduced target.
      expect(recommendation.recommendedTemperature).toBe(expectedNightTarget);
      expect(recommendation.explanation).toContain('Night reduction active');
      expect(recommendation.explanation).toContain(`target ${expectedNightTarget.toFixed(1)}°C`);
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Night period. Effective target: ${expectedNightTarget}°C (Original: ${targetTemp}°C)`);
      jest.useRealTimers();
    });

    it('should handle overnight day period (day 22-7) correctly during its "night" (e.g. 10:00)', () => {
      const nightTempReduction = 2;
      const targetTemp = 20; // Day target
      const expectedNightTarget = targetTemp - nightTempReduction; // 18
      const comfortProfile = { enabled: true, dayStart: 22, dayEnd: 7, nightTempReduction, preHeatHours: 1 }; // Day: 22-7, PreHeat for 22 starts at 21

      // Mock current time to be 10:00 (this is "night" for this profile)
      // PreHeat for dayStart=22 would be 21:00. 10:00 is not in pre-heat window.
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T10:00:00.000Z'));
      const recommendation = service.getHeatingRecommendation(basePriceForecasts, targetTemp, targetTemp, baseOutdoorTemp, baseWeatherForecast, comfortProfile);

      expect(recommendation.recommendedTemperature).toBe(expectedNightTarget);
      expect(recommendation.explanation).toContain('Night reduction active');
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Night period. Effective target: ${expectedNightTarget}°C (Original: ${targetTemp}°C)`);
      jest.useRealTimers();
    });
  });

  describe('Night Time, Profile Enabled, Pre-heating for Day Start', () => {
    it('should recommend original targetTemp if in pre-heat window for day start (normal day period)', () => {
      const targetTemp = 21;
      // PreHeatHours = 2, dayStart = 7. So pre-heat window is 5:00-6:59.
      const comfortProfile = { enabled: true, dayStart: 7, dayEnd: 22, nightTempReduction: 3, preHeatHours: 2 };

      // Mock current time to be 6:00 AM, which is within preHeatHours of dayStart=7
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T06:00:00.000Z'));

      const recommendation = service.getHeatingRecommendation(
        basePriceForecasts, // Assuming no significant price variations
        targetTemp,
        targetTemp - 3, // Current temp is at night reduced level
        baseOutdoorTemp,
        baseWeatherForecast,
        comfortProfile
      );

      // Expectation: Recommended temp should be the original targetTemp due to pre-heating.
      // This assumes the default behavior (no price optimization) aims to reach the effectiveTargetTemp,
      // which becomes targetTemp during pre-heat.
      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('Pre-heating for day period');
      expect(recommendation.explanation).not.toContain('Night reduction active');
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Pre-heating for day start. Aiming for ${targetTemp}°C.`);
      jest.useRealTimers();
    });

    it('should recommend original targetTemp if in pre-heat window for day start (overnight day period)', () => {
      const targetTemp = 20;
      // Day starts at 22:00. PreHeatHours = 2. So pre-heat window is 20:00-21:59.
      const comfortProfile = { enabled: true, dayStart: 22, dayEnd: 7, nightTempReduction: 3, preHeatHours: 2 };

      // Mock current time to be 21:00
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T21:00:00.000Z'));

      const recommendation = service.getHeatingRecommendation(
        basePriceForecasts,
        targetTemp,
        targetTemp - 2, // Current temp is lower
        baseOutdoorTemp,
        baseWeatherForecast,
        comfortProfile
      );
      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('Pre-heating for day period');
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Pre-heating for day start. Aiming for ${targetTemp}°C.`);
      jest.useRealTimers();
    });
  });

  describe('Comfort Profile Interaction with Price Optimization', () => {
    it('Scenario: Night time, cheap now, expensive later - should pre-heat to day target + buffer, overriding night reduction', () => {
      const targetTemp = 21; // Day target
      const nightReduction = 3;
      // Day: 7-22. Night reduction would aim for 18. PreHeat for day: 6-7.
      const comfortProfile = { enabled: true, dayStart: 7, dayEnd: 22, nightTempReduction: nightReduction, preHeatHours: 1 };

      // Mock time to be 3 AM (night, and not in day pre-heat window for dayStart=7)
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T03:00:00.000Z'));

      const prices: PricePoint[] = [
        { time: DateTime.now().toISO(), price: 0.05 }, // Current: cheap
        { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.06 },
        { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.25 }, // Upcoming expensive
        { time: DateTime.now().plus({ hours: 3 }).toISO(), price: 0.30 },
        { time: DateTime.now().plus({ hours: 4 }).toISO(), price: 0.28 },
      ];

      // Current temperature is at the (would-be) night reduced level
      const currentTemp = targetTemp - nightReduction;

      const recommendation = service.getHeatingRecommendation(prices, targetTemp, currentTemp, baseOutdoorTemp, baseWeatherForecast, comfortProfile);

      // Expected: Pre-heats aggressively towards `targetTemp + buffer` (day target + buffer).
      // The exact preHeatTemp is `Math.min(preheatTargetTemp + 1.5, preheatTargetTemp + (characteristics.thermalMass * 2))`
      // preheatTargetTemp is `targetTemp` (21). characteristics.thermalMass is 20.
      // So, min(21 + 1.5, 21 + 20*2) = min(22.5, 61) = 22.5
      // This might be further adjusted by weather. For simplicity, assuming base weather doesn't add much.
      // The logic for pre-heat buffer for price is: `Math.min(preheatTargetTemp + 1.5, preheatTargetTemp + (characteristics.thermalMass * 2))`
      // where preheatTargetTemp is the original `targetTemp`.
      const expectedPreHeatBuffer = 1.5; // from the most aggressive price pre-heat logic
      let expectedAggressivePreHeatTemp = targetTemp + expectedPreHeatBuffer;
      // Check against thermalMass limit: targetTemp + characteristics.thermalMass * 2
      expectedAggressivePreHeatTemp = Math.min(expectedAggressivePreHeatTemp, targetTemp + mockThermalAnalyzer.getThermalCharacteristics().thermalMass * 2);


      expect(recommendation.recommendedTemperature).toBeCloseTo(expectedAggressivePreHeatTemp); // Or exactly, if no weather adjustment
      expect(recommendation.explanation).toContain('Pre-heating to');
      expect(recommendation.explanation).toContain('during cheap electricity');
      // It should not mention night reduction if price pre-heating overrides it to aim for day target + buffer
      expect(recommendation.explanation).not.toContain('Night reduction active');
      // Log for comfort profile should show night period, but price logic takes over.
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Night period. Effective target: ${targetTemp-nightReduction}°C (Original: ${targetTemp}°C)`);
      // Log for price logic
      expect(mockHomeyApp.log).toHaveBeenCalledWith(expect.stringContaining('PriceLogic: Cheap period before expensive. Pre-heating to'));
      jest.useRealTimers();
    });

    it('Scenario: Night time, expensive now, cheap later - should aim for night reduced target if current is above, to save cost', () => {
      const targetTemp = 21; // Day target
      const nightReduction = 2;
      const expectedNightTarget = targetTemp - nightReduction; // 19
      // Day: 7-22. Night reduction aims for 19. PreHeat for day: 6-7.
      const comfortProfile = { enabled: true, dayStart: 7, dayEnd: 22, nightTempReduction: nightReduction, preHeatHours: 1 };

      // Mock time to be 1 AM (night, not in pre-heat window for dayStart=7)
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T01:00:00.000Z'));

      const prices: PricePoint[] = [
        { time: DateTime.now().toISO(), price: 0.30 }, // Current: expensive
        { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.25 },
        { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 0.05 }, // Upcoming cheap
        { time: DateTime.now().plus({ hours: 3 }).toISO(), price: 0.06 },
      ];

      // Current temperature is above the desired night target
      const currentTemp = targetTemp; // 21

      const recommendation = service.getHeatingRecommendation(prices, targetTemp, currentTemp, baseOutdoorTemp, baseWeatherForecast, comfortProfile);

      // Expected: System should recommend the night reduced target to save costs, as current temp is higher.
      // The logic for "Temporarily reducing temperature..." applies if nextCheapPeriod is soon and currentTemp > effectiveTargetTemp - buffer
      // Here, effectiveTargetTemp is 19. currentTemp is 21. hoursUntilCheap is 2.
      // reducedTemp = Math.max(effectiveTargetTemp - 1, effectiveTargetTemp - (characteristics.thermalMass * 0.5), 18)
      // reducedTemp = Math.max(18, 19 - 20*0.5, 18) = Math.max(18, 9, 18) = 18.
      // However, the current logic for expensive period without immediate cheap period before it defaults to defaultRecommendation,
      // which will use effectiveTargetTemp (19C in this case).
      expect(recommendation.recommendedTemperature).toBe(expectedNightTarget);
      expect(recommendation.explanation).toContain('Night reduction active');
      // It might also say "Maintaining temperature" because no aggressive price optimization is triggered for reduction
      // if current is already above the (reduced) target. The "Temporarily reducing temperature" applies if a cheap period is SOON.
      // Let's check the log for effective target.
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Night period. Effective target: ${expectedNightTarget}°C (Original: ${targetTemp}°C)`);
      // The price logic might decide to just maintain this 'effectiveTargetTemp' as current is above it.
      // If current was below, it would heat to effectiveTargetTemp.
      // If a cheap period was very soon, it might reduce further. Here, cheap is 2 hours away.
      expect(recommendation.explanation).toContain(`target ${expectedNightTarget.toFixed(1)}°C`);

      jest.useRealTimers();
    });
  });

  describe('Varying Comfort Profile Parameters (nightTempReduction, preHeatHours)', () => {
    it('should not reduce temperature at night if nightTempReduction is 0', () => {
      const targetTemp = 21;
      // Day: 7-22. Night reduction is 0.
      const comfortProfile = { enabled: true, dayStart: 7, dayEnd: 22, nightTempReduction: 0, preHeatHours: 1 };

      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T03:00:00.000Z')); // 3 AM (Night)

      const recommendation = service.getHeatingRecommendation(basePriceForecasts, targetTemp, targetTemp, baseOutdoorTemp, baseWeatherForecast, comfortProfile);

      expect(recommendation.recommendedTemperature).toBe(targetTemp); // Should stick to original target
      expect(recommendation.explanation).toContain('Night reduction active'); // Still "active" but reduction is 0
      expect(recommendation.explanation).toContain(`target ${targetTemp.toFixed(1)}°C`);
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Night period. Effective target: ${targetTemp}°C (Original: ${targetTemp}°C)`);
      jest.useRealTimers();
    });

    it('should not pre-heat for day if preHeatHours is 0, and apply night reduction if applicable', () => {
      const targetTemp = 21;
      const nightReduction = 2;
      const expectedNightTarget = targetTemp - nightReduction; // 19
      // Day: 7-22. PreHeatHours is 0.
      const comfortProfile = { enabled: true, dayStart: 7, dayEnd: 22, nightTempReduction: nightReduction, preHeatHours: 0 };

      // Time is 6 AM, which would be pre-heat if preHeatHours > 0
      jest.useFakeTimers().setSystemTime(new Date('2023-01-01T06:00:00.000Z'));

      const recommendation = service.getHeatingRecommendation(basePriceForecasts, targetTemp, targetTemp, baseOutdoorTemp, baseWeatherForecast, comfortProfile);

      // Expect night reduction to apply as preHeatHours is 0
      expect(recommendation.recommendedTemperature).toBe(expectedNightTarget);
      expect(recommendation.explanation).toContain('Night reduction active');
      expect(recommendation.explanation).not.toContain('Pre-heating for day period');
      expect(mockHomeyApp.log).toHaveBeenCalledWith(`Comfort profile: Night period. Effective target: ${expectedNightTarget}°C (Original: ${targetTemp}°C)`);
      jest.useRealTimers();
    });
  });
});

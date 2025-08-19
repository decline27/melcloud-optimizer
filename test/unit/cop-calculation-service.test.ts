import { COPCalculationService, COPCalculationData } from '../../src/services/cop-calculation-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { HomeyLogger } from '../../src/util/logger';

describe('COPCalculationService', () => {
  let service: COPCalculationService;
  let mockHomey: any;
  let mockConfigService: ConfigurationService;
  let mockLogger: HomeyLogger;

  beforeEach(() => {
    // Mock Homey instance
    mockHomey = {
      settings: {
        get: jest.fn(),
        set: jest.fn()
      }
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    } as any;

    // Mock configuration service
    mockConfigService = {
      getConfig: jest.fn().mockResolvedValue({
        temperature: { min: 18, max: 22, step: 0.5, deadband: 0.3 },
        cop: { weight: 0.3, autoSeasonal: true },
        thermalModel: { K: 0.5, useLearning: false }
      })
    } as any;

    service = new COPCalculationService(mockHomey, mockConfigService, mockLogger);
  });

  it('should calculate COP with temperature factors', async () => {
    const data: COPCalculationData = {
      temperature: 21,
      outdoorTemp: 10,
      operationMode: 'heating',
      seasonalMode: 'winter'
    };

    const result = await service.calculateCOP(data);

    expect(result).toBeDefined();
    expect(result.cop).toBeGreaterThan(0);
    expect(result.normalizedCOP).toBeGreaterThanOrEqual(0);
    expect(result.normalizedCOP).toBeLessThanOrEqual(1);
    expect(result.efficiency).toBeGreaterThanOrEqual(0);
    expect(result.efficiency).toBeLessThanOrEqual(100);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should handle different operation modes', async () => {
    const heatingData: COPCalculationData = {
      temperature: 21,  // Optimal for heating
      operationMode: 'heating',
      seasonalMode: 'winter'
    };

    const hotWaterData: COPCalculationData = {
      temperature: 55,  // Different optimal temperature for hot water
      operationMode: 'hotwater',
      seasonalMode: 'winter'
    };

    const heatingResult = await service.calculateCOP(heatingData);
    const hotWaterResult = await service.calculateCOP(hotWaterData);

    expect(heatingResult.cop).toBeGreaterThan(0);
    expect(hotWaterResult.cop).toBeGreaterThan(0);
    
    // Different temperatures and operation modes should give different results
    expect(heatingResult.cop).not.toBe(hotWaterResult.cop);
  });

  it('should apply seasonal factors correctly', async () => {
    const winterData: COPCalculationData = {
      temperature: 21,
      operationMode: 'heating',
      seasonalMode: 'winter'
    };

    const summerData: COPCalculationData = {
      temperature: 21,
      operationMode: 'heating',
      seasonalMode: 'summer'
    };

    const winterResult = await service.calculateCOP(winterData);
    const summerResult = await service.calculateCOP(summerData);

    expect(winterResult.factors.seasonal).toBeGreaterThan(0);
    expect(summerResult.factors.seasonal).toBeGreaterThan(0);
  });

  it('should handle outdoor temperature factor', async () => {
    const dataWithOutdoor: COPCalculationData = {
      temperature: 21,
      outdoorTemp: 10,
      operationMode: 'heating',
      seasonalMode: 'winter'
    };

    const dataWithoutOutdoor: COPCalculationData = {
      temperature: 21,
      operationMode: 'heating',
      seasonalMode: 'winter'
    };

    const resultWithOutdoor = await service.calculateCOP(dataWithOutdoor);
    const resultWithoutOutdoor = await service.calculateCOP(dataWithoutOutdoor);

    expect(resultWithOutdoor.confidence).toBeGreaterThan(resultWithoutOutdoor.confidence);
    expect(resultWithOutdoor.factors.weather).toBeGreaterThan(0);
    expect(resultWithoutOutdoor.factors.weather).toBe(0.8); // Default factor
  });
});

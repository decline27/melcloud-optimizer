/**
 * Integration tests for Enhanced Savings Calculator with Thermal Model and Hot Water services
 */

import { EnhancedSavingsCalculator } from '../src/util/enhanced-savings-calculator';
import { Logger } from '../src/util/logger';

describe('EnhancedSavingsCalculator Integration', () => {
  let calculator: EnhancedSavingsCalculator;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    } as any;
  });

  test('should initialize without services (fallback mode)', () => {
    calculator = new EnhancedSavingsCalculator(mockLogger);
    
    const result = calculator.calculateEnhancedDailySavings(0.1, [], 10);
    
    expect(result).toBeDefined();
    expect(result.method).not.toContain('thermal_aware');
    expect(result.method).not.toContain('usage_aware');
    expect(result.dailySavings).toBeGreaterThanOrEqual(0);
  });

  test('should initialize with thermal service only', () => {
    const mockThermalService = {
      getThermalCharacteristics: jest.fn().mockReturnValue({
        heatingRate: 0.5,
        coolingRate: 0.2,
        thermalMass: 0.7,
        modelConfidence: 0.8
      })
    };

    calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any);
    
    const result = calculator.calculateEnhancedDailySavings(0.1, [], 10);
    
    expect(result).toBeDefined();
    expect(result.method).toContain('thermal_aware');
  });

  test('should initialize with hot water service only', () => {
    const mockHotWaterService = {
      getUsagePatterns: jest.fn().mockReturnValue({
        hourlyUsagePattern: new Array(24).fill(1),
        confidence: 75
      })
    };

    calculator = new EnhancedSavingsCalculator(mockLogger, undefined, mockHotWaterService as any);
    
    const result = calculator.calculateEnhancedDailySavings(0.1, [], 10);
    
    expect(result).toBeDefined();
    expect(result.method).toContain('usage_aware');
  });

  test('should initialize with both services', () => {
    const mockThermalService = {
      getThermalCharacteristics: jest.fn().mockReturnValue({
        heatingRate: 0.5,
        coolingRate: 0.2,
        thermalMass: 0.7,
        modelConfidence: 0.8
      })
    };

    const mockHotWaterService = {
      getUsagePatterns: jest.fn().mockReturnValue({
        hourlyUsagePattern: new Array(24).fill(1),
        confidence: 75
      })
    };

    calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any, mockHotWaterService as any);
    
    const result = calculator.calculateEnhancedDailySavings(0.1, [], 10);
    
    expect(result).toBeDefined();
    expect(result.method).toContain('thermal_and_usage_aware');
  });

  test('should handle service failures gracefully', () => {
    const mockThermalService = {
      getThermalCharacteristics: jest.fn().mockImplementation(() => {
        throw new Error('Service error');
      })
    };

    calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any);
    
    // Should not throw error and fall back to basic calculation
    const result = calculator.calculateEnhancedDailySavings(0.1, [], 10);
    
    expect(result).toBeDefined();
    expect(result.dailySavings).toBeGreaterThanOrEqual(0);
  });
});
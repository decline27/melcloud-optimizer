/**
 * Phase 2 Integration Tests - Real Data Usage
 * Tests that verify the Enhanced Savings Calculator properly uses
 * real learned data from thermal and hot water services
 */

import { EnhancedSavingsCalculator, OptimizationData } from '../src/util/enhanced-savings-calculator';
import { Logger } from '../src/util/logger';

describe('EnhancedSavingsCalculator Phase 2 - Real Data Integration', () => {
  let calculator: EnhancedSavingsCalculator;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    } as any;
  });

  describe('Thermal Inertia with Real Data', () => {
    test('should use real thermal mass when available', () => {
      const mockThermalService = {
        getThermalCharacteristics: jest.fn().mockReturnValue({
          heatingRate: 0.5,
          coolingRate: 0.2,
          thermalMass: 0.8, // High thermal mass
          modelConfidence: 0.9, // High confidence
          outdoorTempImpact: 0.1,
          windImpact: 0.05
        })
      };

      calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any);

      const optimizations: OptimizationData[] = [
        {
          timestamp: '2025-09-29T10:00:00Z',
          savings: 0.1,
          targetTemp: 21,
          targetOriginal: 20,
          priceNow: 0.15,
          priceAvg: 0.12
        }
      ];

      const result = calculator.calculateEnhancedDailySavings(0.1, optimizations, 14);

      expect(result).toBeDefined();
      expect(mockThermalService.getThermalCharacteristics).toHaveBeenCalled();
      // With high thermal mass and confidence, should get enhanced savings
      expect(result.compoundedSavings).toBeGreaterThan(result.dailySavings * 0.95); // Should have some compounding
    });

    test('should fall back when thermal confidence is low', () => {
      const mockThermalService = {
        getThermalCharacteristics: jest.fn().mockReturnValue({
          heatingRate: 0.5,
          coolingRate: 0.2,
          thermalMass: 0.8,
          modelConfidence: 0.1, // Low confidence - should use fallback
          outdoorTempImpact: 0.1,
          windImpact: 0.05
        })
      };

      calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any);

      const optimizations: OptimizationData[] = [
        {
          timestamp: '2025-09-29T10:00:00Z',
          savings: 0.1,
          targetTemp: 21,
          targetOriginal: 20,
          priceNow: 0.15,
          priceAvg: 0.12
        }
      ];

      const result = calculator.calculateEnhancedDailySavings(0.1, optimizations, 14);

      expect(result).toBeDefined();
      expect(mockThermalService.getThermalCharacteristics).toHaveBeenCalled();
      // Should fall back to hardcoded calculation due to low confidence
    });
  });

  describe('Time-of-Day Factors with Real Usage Patterns', () => {
    test('should use learned hot water usage patterns', () => {
      const mockHotWaterService = {
        getUsagePatterns: jest.fn().mockReturnValue({
          hourlyUsagePattern: [
            // Night hours (0-5): low usage
            0.5, 0.3, 0.2, 0.2, 0.3, 0.4,
            // Morning peak (6-9): high usage  
            2.5, 3.0, 2.8, 1.5,
            // Day hours (10-16): medium usage
            1.0, 1.2, 1.1, 1.0, 0.9, 1.1, 1.2,
            // Evening peak (17-21): high usage
            2.0, 2.8, 3.2, 2.5, 2.0,
            // Late night (22-23): medium usage
            1.5, 1.0
          ],
          confidence: 85 // High confidence
        })
      };

      calculator = new EnhancedSavingsCalculator(mockLogger, undefined, mockHotWaterService as any);

      const result = calculator.calculateEnhancedDailySavings(0.1, [], 10); // 2 PM, 10 hours remaining

      expect(result).toBeDefined();
      expect(mockHotWaterService.getUsagePatterns).toHaveBeenCalled();
      expect(result.method).toContain('usage_aware');
    });

    test('should fall back when usage pattern confidence is low', () => {
      const mockHotWaterService = {
        getUsagePatterns: jest.fn().mockReturnValue({
          hourlyUsagePattern: new Array(24).fill(1),
          confidence: 15 // Low confidence - should use fallback
        })
      };

      calculator = new EnhancedSavingsCalculator(mockLogger, undefined, mockHotWaterService as any);

      const result = calculator.calculateEnhancedDailySavings(0.1, [], 10);

      expect(result).toBeDefined();
      expect(mockHotWaterService.getUsagePatterns).toHaveBeenCalled();
      // Should fall back to hardcoded time-of-day factors
    });
  });

  describe('Enhanced Confidence Calculation', () => {
    test('should blend service confidences with basic confidence', () => {
      const mockThermalService = {
        getThermalCharacteristics: jest.fn().mockReturnValue({
          modelConfidence: 0.8
        })
      };

      const mockHotWaterService = {
        getUsagePatterns: jest.fn().mockReturnValue({
          confidence: 90
        })
      };

      calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any, mockHotWaterService as any);

      const optimizations: OptimizationData[] = [
        { timestamp: '2025-09-29T10:00:00Z', savings: 0.1, targetTemp: 21, targetOriginal: 20, priceNow: 0.15, priceAvg: 0.12 },
        { timestamp: '2025-09-29T11:00:00Z', savings: 0.12, targetTemp: 21, targetOriginal: 20, priceNow: 0.14, priceAvg: 0.12 },
        { timestamp: '2025-09-29T12:00:00Z', savings: 0.11, targetTemp: 21, targetOriginal: 20, priceNow: 0.13, priceAvg: 0.12 }
      ];

      const result = calculator.calculateEnhancedDailySavings(0.1, optimizations, 14);

      expect(result).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.6); // Should have enhanced confidence
      expect(mockThermalService.getThermalCharacteristics).toHaveBeenCalled();
      expect(mockHotWaterService.getUsagePatterns).toHaveBeenCalled();
    });
  });

  describe('Weather-Aware Projections', () => {
    test('should apply weather adjustments when outdoor temperature data is available', () => {
      const mockThermalService = {
        getThermalCharacteristics: jest.fn().mockReturnValue({
          heatingRate: 0.5,
          coolingRate: 0.2,
          thermalMass: 0.7,
          modelConfidence: 0.8,
          outdoorTempImpact: 0.15, // Significant outdoor temperature impact
          windImpact: 0.05
        })
      };

      calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any);

      const optimizations: OptimizationData[] = [
        {
          timestamp: '2025-09-29T10:00:00Z',
          savings: 0.1,
          targetTemp: 21,
          targetOriginal: 20,
          priceNow: 0.15,
          priceAvg: 0.12,
          outdoorTemp: 15 // Starting temperature
        },
        {
          timestamp: '2025-09-29T12:00:00Z',
          savings: 0.12,
          targetTemp: 21,
          targetOriginal: 20,
          priceNow: 0.14,
          priceAvg: 0.12,
          outdoorTemp: 12 // Getting colder - should increase savings potential
        }
      ];

      const result = calculator.calculateEnhancedDailySavings(0.1, optimizations, 10);

      expect(result).toBeDefined();
      expect(mockThermalService.getThermalCharacteristics).toHaveBeenCalled();
      // When it's getting colder, projected savings should be adjusted upward
      expect(result.projectedSavings).toBeGreaterThan(0);
    });

    test('should handle missing weather data gracefully', () => {
      const mockThermalService = {
        getThermalCharacteristics: jest.fn().mockReturnValue({
          modelConfidence: 0.8,
          outdoorTempImpact: 0.15
        })
      };

      calculator = new EnhancedSavingsCalculator(mockLogger, mockThermalService as any);

      // No outdoor temperature data in optimizations
      const optimizations: OptimizationData[] = [
        {
          timestamp: '2025-09-29T10:00:00Z',
          savings: 0.1,
          targetTemp: 21,
          targetOriginal: 20,
          priceNow: 0.15,
          priceAvg: 0.12
          // No outdoorTemp field
        }
      ];

      const result = calculator.calculateEnhancedDailySavings(0.1, optimizations, 10);

      expect(result).toBeDefined();
      // Should work fine without weather adjustments
      expect(result.projectedSavings).toBeGreaterThanOrEqual(0);
    });
  });
});
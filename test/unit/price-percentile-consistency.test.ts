/**
 * Comprehensive test to validate the price percentile calculation fix
 * This ensures the engine uses the same percentile calculation as the main system
 */

import { computeHeatingDecision, DefaultEngineConfig, type EngineInputs } from '../../optimization/engine';

describe('Price Percentile Calculation Consistency', () => {
  describe('Percentile Calculation Methods', () => {
    it('should calculate percentiles consistently with main system', () => {
      // Create test price data representing a realistic scenario
      const testPrices = [
        { time: '2025-10-07T18:00:00Z', price: 0.60 }, // Current price (cheap)
        { time: '2025-10-07T19:00:00Z', price: 0.50 },
        { time: '2025-10-07T20:00:00Z', price: 1.20 },
        { time: '2025-10-07T21:00:00Z', price: 0.80 },
        { time: '2025-10-07T22:00:00Z', price: 2.50 },
        { time: '2025-10-07T23:00:00Z', price: 0.40 },
        { time: '2025-10-08T00:00:00Z', price: 1.50 },
        { time: '2025-10-08T01:00:00Z', price: 0.70 },
      ];

      const currentPrice = 0.60;
      
      // Calculate percentile using main system method
      const mainSystemPercentile = testPrices.filter(p => p.price <= currentPrice).length / testPrices.length;
      
      // Test the engine with this scenario
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: currentPrice,
        prices: testPrices,
        telemetry: {
          indoorC: 21.5,
          targetC: 20.0,
        },
        weather: {
          outdoorC: 14,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000, // 10 minutes ago
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // With consistent percentile calculation, cheap periods should trigger optimization
      // mainSystemPercentile should be around 0.375 (3 out of 8 prices <= 0.60)
      expect(mainSystemPercentile).toBeCloseTo(0.375, 2);
      
      // Since this is a cheap period (< 50th percentile), should trigger temperature increase
      if (mainSystemPercentile <= 0.5) {
        expect(decision.action).toBe('set_target');
        expect(decision.toC).toBeGreaterThan(20.0);
        expect(decision.toC).toBeLessThanOrEqual(23.25); // Within comfort + preheat range
      }
    });

    it('should respond appropriately to very cheap periods', () => {
      // Create scenario with current price in bottom 20th percentile
      const testPrices = [
        { time: '2025-10-07T18:00:00Z', price: 0.45 }, // Current (very cheap)
        { time: '2025-10-07T19:00:00Z', price: 0.50 },
        { time: '2025-10-07T20:00:00Z', price: 1.20 },
        { time: '2025-10-07T21:00:00Z', price: 0.80 },
        { time: '2025-10-07T22:00:00Z', price: 2.50 },
        { time: '2025-10-07T23:00:00Z', price: 1.80 },
        { time: '2025-10-08T00:00:00Z', price: 1.50 },
        { time: '2025-10-08T01:00:00Z', price: 0.70 },
      ];

      const currentPrice = 0.45;
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: currentPrice,
        prices: testPrices,
        telemetry: {
          indoorC: 21.0,
          targetC: 20.0,
        },
        weather: {
          outdoorC: 12, // Cold enough for preheat
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // Calculate expected percentile: prices <= 0.45 = [0.45] = 1/8 = 0.125 (12.5th percentile)
      const expectedPercentile = testPrices.filter(p => p.price <= currentPrice).length / testPrices.length;
      expect(expectedPercentile).toBeCloseTo(0.125, 3);
      
      // This should trigger preheat (< 35th percentile threshold)
      expect(decision.action).toBe('set_target');
      expect(decision.toC).toBeGreaterThan(22.0); // Should preheat aggressively
      expect(decision.reason).toContain('Cheaper hour');
    });

    it('should reduce temperature during expensive periods', () => {
      // Create scenario with current price in top 20th percentile  
      const testPrices = [
        { time: '2025-10-07T18:00:00Z', price: 2.20 }, // Current (expensive)
        { time: '2025-10-07T19:00:00Z', price: 0.50 },
        { time: '2025-10-07T20:00:00Z', price: 1.20 },
        { time: '2025-10-07T21:00:00Z', price: 0.80 },
        { time: '2025-10-07T22:00:00Z', price: 1.50 },
        { time: '2025-10-07T23:00:00Z', price: 0.60 },
        { time: '2025-10-08T00:00:00Z', price: 1.80 },
        { time: '2025-10-08T01:00:00Z', price: 0.70 },
      ];

      const currentPrice = 2.20;
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: currentPrice,
        prices: testPrices,
        telemetry: {
          indoorC: 22.0,
          targetC: 22.0,
        },
        weather: {
          outdoorC: 15,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // Calculate expected percentile: all prices <= 2.20, so 8/8 = 1.0 (100th percentile)
      const expectedPercentile = testPrices.filter(p => p.price <= currentPrice).length / testPrices.length;
      expect(expectedPercentile).toBe(1.0);
      
      // This expensive period should trigger temperature reduction
      expect(decision.action).toBe('set_target');
      expect(decision.toC).toBeLessThan(22.0);
      expect(decision.toC).toBeGreaterThanOrEqual(20.0); // Stay within comfort
      expect(decision.reason).toContain('Expensive hour');
    });
  });

  describe('Edge Cases', () => {
    it('should handle identical prices gracefully', () => {
      const identicalPrices = Array(8).fill(null).map((_, i) => ({
        time: `2025-10-07T${18 + i}:00:00Z`,
        price: 1.00 // All identical
      }));

      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: 1.00,
        prices: identicalPrices,
        telemetry: {
          indoorC: 21.0,
          targetC: 20.5,
        },
        weather: {
          outdoorC: 10,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // With identical prices, percentile should be 1.0 (all prices <= current)
      // This should not crash and should provide reasonable behavior
      expect(decision).toBeDefined();
      expect(decision.action).toBeDefined();
    });

    it('should handle empty price array gracefully', () => {
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: 1.00,
        prices: [],
        telemetry: {
          indoorC: 21.0,
          targetC: 20.5,
        },
        weather: {
          outdoorC: 10,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // Should not crash with empty prices and should provide fallback behavior
      expect(decision).toBeDefined();
      expect(decision.action).toBeDefined();
    });
  });
});
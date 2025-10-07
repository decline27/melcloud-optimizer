/**
 * Test to verify optimization engine improvements for cheap period utilization
 */

import { computeHeatingDecision, DefaultEngineConfig, type EngineInputs } from '../../optimization/engine';

describe('Optimization Engine Improvements', () => {
  describe('Configuration Improvements', () => {
    it('should have expanded comfort band configuration', () => {
      // Verify our changes to the default config
      expect(DefaultEngineConfig.comfortOccupied.upperC).toBe(23.0); // Expanded from 21.0
      expect(DefaultEngineConfig.comfortOccupied.lowerC).toBe(20.0); // Unchanged
      expect(DefaultEngineConfig.preheat.cheapPercentile).toBe(0.35); // Expanded from 0.25
    });
  });

  describe('Cheap Period Response', () => {
    it('should target higher temperatures when prices are very cheap', () => {
      // Create a scenario with very cheap current price
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: 0.40, // Very cheap
        prices: [
          { time: '2025-10-07T18:00:00Z', price: 0.40 }, // Current (cheapest)
          { time: '2025-10-07T19:00:00Z', price: 1.20 },
          { time: '2025-10-07T20:00:00Z', price: 1.50 },
          { time: '2025-10-07T21:00:00Z', price: 2.00 },
          { time: '2025-10-07T22:00:00Z', price: 1.80 },
        ],
        telemetry: {
          indoorC: 20.5,
          targetC: 20.0,
        },
        weather: {
          outdoorC: 14,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // Should increase temperature to take advantage of cheap prices
      expect(decision.action).toBe('set_target');
      expect(decision.toC).toBeGreaterThan(20.0);
      expect(decision.toC).toBeLessThanOrEqual(23.25); // Allow for preheat overshoot
    });

    it('should reduce temperature when prices are expensive', () => {
      // Create a scenario with expensive current price
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: 2.50, // Expensive
        prices: [
          { time: '2025-10-07T18:00:00Z', price: 2.50 }, // Current (expensive)
          { time: '2025-10-07T19:00:00Z', price: 1.20 },
          { time: '2025-10-07T20:00:00Z', price: 0.80 },
          { time: '2025-10-07T21:00:00Z', price: 0.60 },
          { time: '2025-10-07T22:00:00Z', price: 1.00 },
        ],
        telemetry: {
          indoorC: 21.5,
          targetC: 22.0,
        },
        weather: {
          outdoorC: 14,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // Should reduce temperature during expensive periods
      expect(decision.action).toBe('set_target');
      expect(decision.toC).toBeLessThan(22.0);
      expect(decision.toC).toBeGreaterThanOrEqual(20.0); // Stay within comfort
    });
  });

  describe('Deadband Behavior', () => {
    it('should respect deadband for small changes', () => {
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: 1.20,
        prices: [
          { time: '2025-10-07T18:00:00Z', price: 1.20 },
          { time: '2025-10-07T19:00:00Z', price: 1.25 },
          { time: '2025-10-07T20:00:00Z', price: 1.15 },
        ],
        telemetry: {
          indoorC: 21.0,
          targetC: 21.1, // Very close to calculated target
        },
        weather: {
          outdoorC: 14,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // Should not change due to deadband
      expect(decision.action).toBe('no_change');
      expect(decision.reason).toContain('deadband');
    });
  });

  describe('User Scenario Simulation', () => {
    it('should demonstrate improvement over old narrow comfort band', () => {
      // Simulate a moderately cheap period (similar to user's log)
      const inputs: EngineInputs = {
        now: new Date('2025-10-07T18:00:00Z'),
        occupied: true,
        currentPrice: 0.80, // Moderately cheap
        prices: [
          { time: '2025-10-07T18:00:00Z', price: 0.80 },
          { time: '2025-10-07T19:00:00Z', price: 1.20 },
          { time: '2025-10-07T20:00:00Z', price: 1.50 },
          { time: '2025-10-07T21:00:00Z', price: 2.00 },
        ],
        telemetry: {
          indoorC: 21.5,
          targetC: 20.0, // Current target from logs
        },
        weather: {
          outdoorC: 14,
        },
        lastSetpointChangeMs: Date.now() - 10 * 60 * 1000,
      };

      const decision = computeHeatingDecision(DefaultEngineConfig, inputs);
      
      // With new config, should increase target temperature
      expect(decision.action).toBe('set_target');
      expect(decision.toC).toBeGreaterThan(20.0);
      
      // With old narrow band (20-21°C), max improvement would be ~21°C
      // With new wide band (20-23°C), can reach ~22°C or higher
      expect(decision.toC).toBeGreaterThan(21.0); // Better than old config
    });
  });
});
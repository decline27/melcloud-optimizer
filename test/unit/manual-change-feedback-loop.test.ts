/**
 * Tests for manual temperature change detection feedback loop
 * 
 * This test suite verifies that the optimizer correctly distinguishes between:
 * 1. User manually changing temperature to a DIFFERENT value
 * 2. User setting the SAME temperature that optimizer would naturally choose
 * 
 * The bug was: User sets same temp as optimizer → System thinks it's "manual" → Resets optimization
 */

import { jest } from '@jest/globals';

// Mock the Homey API
const mockHomey = {
  settings: {
    get: jest.fn(),
    set: jest.fn(),
  },
  log: jest.fn(),
  error: jest.fn(),
};

// Mock MEL Cloud API
const mockMelCloudAPI = {
  getDeviceData: jest.fn() as jest.MockedFunction<any>,
  setTargetTemperature: jest.fn() as jest.MockedFunction<any>,
};

// Mock pricing service
const mockPricingService = {
  getCurrentPrice: jest.fn(),
  getNextHourPrice: jest.fn(),
};

describe('Manual Change Detection - Feedback Loop Prevention', () => {
  let optimizer: any;
  let mockLogger: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    // Import and create optimizer instance
    const { OptimizerService } = require('../../src/services/optimizer');
    optimizer = new OptimizerService(mockHomey, mockLogger);
    
    // Setup basic config
    optimizer.lastOptimizerTarget = null;
    optimizer.lastSetpointChangeMs = 0;
    optimizer.minSetpointChangeMinutes = 30;
  });

  describe('Scenario: Optimizer sets 21°C, User also sets 21°C', () => {
    it('should NOT detect as manual change when user sets same temperature as optimizer would choose', async () => {
      // Setup: Previous optimization set 21°C
      mockHomey.settings.get.mockImplementation((key) => {
        if (key === 'last_optimizer_target') return 21.0;
        if (key === 'last_setpoint_change_ms') return Date.now() - 3600000; // 1 hour ago
        return null;
      });

      // Current device shows 21°C (what optimizer set)
      mockMelCloudAPI.getDeviceData.mockResolvedValue({
        TargetTemperature: 21.0,
        RoomTemperature: 20.5,
      });

      // Pricing suggests 21°C is still optimal
      mockPricingService.getCurrentPrice.mockReturnValue(0.25);
      mockPricingService.getNextHourPrice.mockReturnValue(0.30);

      // This should calculate to 21°C again (same as before)
      const result = await optimizer.optimize('test-device-id', {
        currentTemp: 20.5,
        targetTemp: 21.0, // User hasn't changed it
        heatingCop: 3.0,
        maxPower: 5000,
      });

      // Should NOT detect manual change because:
      // - Current temp (21°C) matches what optimizer would naturally set (21°C)
      // - Even though user "set" 21°C, it's the same as optimal choice
      expect(mockLogger.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Manual temperature change detected')
      );
    });

    it('should detect as manual change when user sets different temperature than optimizer would choose', async () => {
      // Setup: Previous optimization set 21°C
      mockHomey.settings.get.mockImplementation((key) => {        if (key === 'last_optimizer_target') return 21.0;
        if (key === 'last_setpoint_change_ms') return Date.now() - 3600000; // 1 hour ago
        return null;
      });

      // Current device shows 22°C (user changed it)
      mockMelCloudAPI.getDeviceData.mockResolvedValue({
        TargetTemperature: 22.0,
        RoomTemperature: 20.5,
      });

      // Pricing still suggests 21°C would be optimal
      mockPricingService.getCurrentPrice.mockReturnValue(0.25);

      const result = await optimizer.optimize('test-device-id', {
        currentTemp: 20.5,
        targetTemp: 22.0, // User changed it to 22°C
        heatingCop: 3.0,
        maxPower: 5000,
      });

      // Should detect manual change because:
      // - Current temp (22°C) doesn't match what optimizer would naturally set (21°C)
      // - User actively chose a different temperature
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Manual temperature change detected')
      );
    });
  });

  describe('Scenario: First-time optimization', () => {
    it('should not trigger false manual change detection on first run', async () => {
      // Setup: No previous optimization target
      mockHomey.settings.get.mockImplementation((key) => {
        if (key === 'last_optimizer_target') return null;
        if (key === 'last_setpoint_change_ms') return 0;
        return null;
      });

      mockMelCloudAPI.getDeviceData.mockResolvedValue({
        TargetTemperature: 20.0,
        RoomTemperature: 19.5,
      });

      const result = await optimizer.optimize('test-device-id', {
        currentTemp: 19.5,
        targetTemp: 20.0,
        heatingCop: 3.0,
        maxPower: 5000,
      });

      // Should not detect any manual changes on first run
      expect(mockLogger.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Manual temperature change detected')
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle small temperature differences gracefully', async () => {
      // Setup with tiny difference (0.05°C - below 0.1°C threshold)
      mockHomey.settings.get.mockImplementation((key) => {
        if (key === 'last_optimizer_target') return 21.0;
        if (key === 'last_setpoint_change_ms') return Date.now() - 3600000;
        return null;
      });

      mockMelCloudAPI.getDeviceData.mockResolvedValue({
        TargetTemperature: 21.05, // Very small difference
        RoomTemperature: 20.5,
      });

      const result = await optimizer.optimize('test-device-id', {
        currentTemp: 20.5,
        targetTemp: 21.05,
        heatingCop: 3.0,
        maxPower: 5000,
      });

      // Should not detect as manual change due to small difference
      expect(mockLogger.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Manual temperature change detected')
      );
    });
  });
});
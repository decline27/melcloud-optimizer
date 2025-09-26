import { MelCloudApi } from '../../src/services/melcloud-api';
import { createMockLogger } from '../mocks/logger.mock';
import { MELCLOUD_FLAGS } from '../../src/constants/melcloud-api';
import { ErrorCategory } from '../../src/util/error-handler';

// Mock the ErrorHandler
jest.mock('../../src/util/error-handler');

describe('MelCloudApi setBatchedTemperatures', () => {
  let api: MelCloudApi;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockDeviceState: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock logger
    mockLogger = createMockLogger();
    
    // Create API instance
    api = new MelCloudApi(mockLogger);
    
    // Set up authenticated state
    (api as any).contextKey = 'test-context-key';
    
    // Mock device state
    mockDeviceState = {
      DeviceID: 'test-device',
      BuildingID: 123,
      SetTemperatureZone1: 20.0,
      SetTemperatureZone2: 21.0,
      TankWaterTemperature: 45.0,
      EffectiveFlags: 0,
      HasPendingCommand: false,
      Power: false,
      IdleZone1: true,
      IdleZone2: true
    };

    // Mock methods
    jest.spyOn(api, 'getDeviceState').mockResolvedValue(mockDeviceState);
    jest.spyOn(api as any, 'throttledApiCall').mockResolvedValue({ success: true });
    jest.spyOn(api as any, 'retryableRequest').mockImplementation(async (fn: any) => await fn());
    jest.spyOn(api as any, 'logApiCall').mockImplementation(() => {});
    jest.spyOn(api as any, 'invalidateDeviceStateCache').mockImplementation(() => {});
  });

  describe('successful operations', () => {
    test('should batch multiple temperature changes successfully', async () => {
      const changes = {
        zone1Temperature: 22.0,
        zone2Temperature: 23.0,
        tankTemperature: 50.0
      };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      // Verify getDeviceState was called
      expect(api.getDeviceState).toHaveBeenCalledWith('test-device', 123);
      
      // Verify throttledApiCall was called with correct parameters
      expect((api as any).throttledApiCall).toHaveBeenCalledWith(
        'POST',
        'Device/SetAtw',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String)
        })
      );

      // Parse the body to verify the state was modified correctly
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.SetTemperatureZone1).toBe(22.0);
      expect(sentState.SetTemperatureZone2).toBe(23.0);
      expect(sentState.TankWaterTemperature).toBe(50.0);
      expect(sentState.HasPendingCommand).toBe(true);
      expect(sentState.Power).toBe(true);
      expect(sentState.IdleZone1).toBe(false);
      expect(sentState.IdleZone2).toBe(false);
      
      // Verify flags were set correctly
      const expectedFlags = MELCLOUD_FLAGS.ZONE1_TEMPERATURE;
      expect(sentState.EffectiveFlags).toBe(expectedFlags);
      
      // Verify cache was invalidated
      expect((api as any).invalidateDeviceStateCache).toHaveBeenCalledWith('test-device', 123);
    });

    test('should handle zone1 only changes', async () => {
      const changes = { zone1Temperature: 22.5 };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.SetTemperatureZone1).toBe(22.5);
      expect(sentState.SetTemperatureZone2).toBe(21.0); // Unchanged
      expect(sentState.TankWaterTemperature).toBe(45.0); // Unchanged
      expect(sentState.IdleZone1).toBe(false);
      expect(sentState.IdleZone2).toBe(true); // Unchanged
      expect(sentState.EffectiveFlags).toBe(MELCLOUD_FLAGS.ZONE1_TEMPERATURE);
    });

    test('should handle zone2 only changes', async () => {
      const changes = { zone2Temperature: 19.5 };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.SetTemperatureZone1).toBe(20.0); // Unchanged
      expect(sentState.SetTemperatureZone2).toBe(19.5);
      expect(sentState.TankWaterTemperature).toBe(45.0); // Unchanged
      expect(sentState.IdleZone1).toBe(true); // Unchanged
      expect(sentState.IdleZone2).toBe(false);
      expect(sentState.EffectiveFlags).toBe(MELCLOUD_FLAGS.ZONE2_TEMPERATURE);
    });

    test('should handle tank only changes', async () => {
      const changes = { tankTemperature: 55.0 };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.SetTemperatureZone1).toBe(20.0); // Unchanged
      expect(sentState.SetTemperatureZone2).toBe(21.0); // Unchanged
      expect(sentState.TankWaterTemperature).toBe(55.0);
      expect(sentState.IdleZone1).toBe(true); // Unchanged
      expect(sentState.IdleZone2).toBe(true); // Unchanged
      expect(sentState.EffectiveFlags).toBe(MELCLOUD_FLAGS.TANK_TEMPERATURE);
    });

    test('should skip API call when no changes provided', async () => {
      const changes = {};

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      expect(api.getDeviceState).not.toHaveBeenCalled();
      expect((api as any).throttledApiCall).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('No temperature changes specified, skipping API call');
    });

    test('should skip API call when all changes are undefined', async () => {
      const changes = {
        zone1Temperature: undefined,
        zone2Temperature: undefined,
        tankTemperature: undefined
      };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      expect(api.getDeviceState).not.toHaveBeenCalled();
      expect((api as any).throttledApiCall).not.toHaveBeenCalled();
    });

    test('should preserve existing EffectiveFlags', async () => {
      mockDeviceState.EffectiveFlags = 0x1000; // Some existing flags
      const changes = { zone1Temperature: 22.0 };

      await api.setBatchedTemperatures('test-device', 123, changes);

      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      const expectedFlags = 0x1000 | MELCLOUD_FLAGS.ZONE1_TEMPERATURE;
      expect(sentState.EffectiveFlags).toBe(expectedFlags);
    });
  });

  describe('authentication handling', () => {
    test('should attempt to connect when not authenticated', async () => {
      (api as any).contextKey = null;
      jest.spyOn(api as any, 'ensureConnected').mockResolvedValue(true);

      const changes = { zone1Temperature: 22.0 };
      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      expect((api as any).ensureConnected).toHaveBeenCalled();
    });

    test('should throw error when connection fails', async () => {
      (api as any).contextKey = null;
      jest.spyOn(api as any, 'ensureConnected').mockResolvedValue(false);

      const changes = { zone1Temperature: 22.0 };

      await expect(api.setBatchedTemperatures('test-device', 123, changes))
        .rejects.toThrow('Not logged in to MELCloud');
    });

    test('should handle authentication errors during API call', async () => {
      const mockError = new Error('Auth error');
      jest.spyOn(api as any, 'createApiError').mockReturnValue({
        category: ErrorCategory.AUTHENTICATION,
        message: 'Auth error'
      });
      jest.spyOn(api as any, 'throttledApiCall').mockRejectedValue(mockError);
      jest.spyOn(api as any, 'ensureConnected').mockResolvedValue(true);

      const changes = { zone1Temperature: 22.0 };

      await expect(api.setBatchedTemperatures('test-device', 123, changes))
        .rejects.toThrow();

      // Should attempt to reconnect
      expect((api as any).ensureConnected).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('should handle API call failures', async () => {
      jest.spyOn(api as any, 'throttledApiCall').mockResolvedValue(null);

      const changes = { zone1Temperature: 22.0 };
      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to apply batched temperature changes')
      );
    });

    test('should handle getDeviceState errors', async () => {
      const mockError = new Error('Device state error');
      jest.spyOn(api, 'getDeviceState').mockRejectedValue(mockError);
      jest.spyOn(api as any, 'createApiError').mockReturnValue(mockError);

      const changes = { zone1Temperature: 22.0 };

      await expect(api.setBatchedTemperatures('test-device', 123, changes))
        .rejects.toThrow('Device state error');
    });

    test('should handle network failures', async () => {
      const networkError = new Error('Network error');
      jest.spyOn(api as any, 'throttledApiCall').mockRejectedValue(networkError);
      jest.spyOn(api as any, 'createApiError').mockReturnValue(networkError);

      const changes = { zone1Temperature: 22.0 };

      await expect(api.setBatchedTemperatures('test-device', 123, changes))
        .rejects.toThrow('Network error');
    });

    test('should handle malformed device state', async () => {
      const malformedState = { invalid: 'state' } as any;
      jest.spyOn(api, 'getDeviceState').mockResolvedValue(malformedState);

      const changes = { zone1Temperature: 22.0 };

      // Should handle malformed device state gracefully
      await expect(api.setBatchedTemperatures('test-device', 123, changes))
        .rejects.toThrow();
    });
  });

  describe('logging and monitoring', () => {
    test('should log temperature changes description', async () => {
      const changes = {
        zone1Temperature: 22.0,
        tankTemperature: 50.0
      };

      await api.setBatchedTemperatures('test-device', 123, changes);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Setting batched temperatures for device test-device: zone1Temperature=22°C, tankTemperature=50°C'
      );
    });

    test('should log successful completion', async () => {
      const changes = { zone1Temperature: 22.0 };

      await api.setBatchedTemperatures('test-device', 123, changes);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Successfully applied batched temperature changes for device test-device'
      );
    });

    test('should log API call details', async () => {
      const changes = { zone1Temperature: 22.0 };

      await api.setBatchedTemperatures('test-device', 123, changes);

      expect((api as any).logApiCall).toHaveBeenCalledWith(
        'POST',
        'Device/SetAtw',
        { deviceId: 'test-device', batchedChanges: changes }
      );
    });
  });

  describe('edge cases', () => {
    test('should handle zero temperature values', async () => {
      const changes = {
        zone1Temperature: 0,
        zone2Temperature: 0,
        tankTemperature: 0
      };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.SetTemperatureZone1).toBe(0);
      expect(sentState.SetTemperatureZone2).toBe(0);
      expect(sentState.TankWaterTemperature).toBe(0);
    });

    test('should handle negative temperature values', async () => {
      const changes = { zone1Temperature: -5.0 };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.SetTemperatureZone1).toBe(-5.0);
    });

    test('should handle very high temperature values', async () => {
      const changes = { tankTemperature: 99.9 };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.TankWaterTemperature).toBe(99.9);
    });

    test('should handle decimal temperature values', async () => {
      const changes = {
        zone1Temperature: 21.7,
        zone2Temperature: 19.3,
        tankTemperature: 47.5
      };

      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
      
      const call = ((api as any).throttledApiCall as jest.Mock).mock.calls[0];
      const sentState = JSON.parse(call[2].body);
      
      expect(sentState.SetTemperatureZone1).toBe(21.7);
      expect(sentState.SetTemperatureZone2).toBe(19.3);
      expect(sentState.TankWaterTemperature).toBe(47.5);
    });
  });

  describe('retry behavior', () => {
    test('should use conservative retry policy', async () => {
      const changes = { zone1Temperature: 22.0 };

      await api.setBatchedTemperatures('test-device', 123, changes);

      expect((api as any).retryableRequest).toHaveBeenCalledWith(
        expect.any(Function),
        2,    // 2 retries (reduced from default 3)
        3000  // 3 second delay
      );
    });

    test('should succeed after retry', async () => {
      let attemptCount = 0;
      jest.spyOn(api as any, 'retryableRequest').mockImplementation(async (fn) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('First attempt fails');
        }
        return await (fn as any)();
      });

      const changes = { zone1Temperature: 22.0 };
      const result = await api.setBatchedTemperatures('test-device', 123, changes);

      expect(result).toBe(true);
    });
  });
});
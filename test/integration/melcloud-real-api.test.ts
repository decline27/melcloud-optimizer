import { MelCloudApi } from '../../src/services/melcloud-api';
import { loadTestConfig, shouldSkipIntegrationTests } from '../test-config';
import { createMockLogger } from '../mocks';

/**
 * Real integration tests that connect to actual MELCloud API
 * These tests are skipped if credentials are not configured
 */
describe('MELCloud Integration Tests', () => {
  let melCloudApi: MelCloudApi;
  let testConfig: any;
  
  beforeAll(() => {
    testConfig = loadTestConfig();
  });

  beforeEach(() => {
    // Only run if we have real credentials
    if (shouldSkipIntegrationTests()) {
      pending('Integration tests skipped - no real credentials configured');
      return;
    }

    const mockLogger = createMockLogger();
  melCloudApi = new MelCloudApi(mockLogger, (global as any).homeySettings || { get: () => null, set: () => {} } as any);
  });

  describe('Real API Connection', () => {
    it('should login with real credentials', async () => {
      if (shouldSkipIntegrationTests()) {
        pending('Integration test skipped');
        return;
      }

      const success = await melCloudApi.login(
        testConfig.melcloud.email,
        testConfig.melcloud.password
      );
      
      expect(success).toBe(true);
    }, testConfig?.test?.timeout || 30000);

    it('should fetch real devices', async () => {
      if (shouldSkipIntegrationTests()) {
        pending('Integration test skipped');
        return;
      }

      // Login first
      await melCloudApi.login(
        testConfig.melcloud.email,
        testConfig.melcloud.password
      );

      const devices = await melCloudApi.getDevices();
      expect(Array.isArray(devices)).toBe(true);
      
      // If you have devices, test with real device IDs
      if (devices.length > 0) {
        const device = devices[0];
        const state = await melCloudApi.getDeviceState(device.id, device.buildingId);
        expect(state).toBeDefined();
        expect(state.DeviceID).toBe(device.id);
      }
    }, testConfig?.test?.timeout || 30000);
  });
});

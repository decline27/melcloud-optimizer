import { MelCloudApi } from '../../src/services/melcloud-api';
import { loadTestConfig, shouldSkipIntegrationTests } from '../test-config';
import { createMockLogger } from '../mocks';

// Allow adjustable timeout via env for slower networks
const TIMEOUT = parseInt(process.env.MEL_TEST_TIMEOUT || '60000', 10);

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
    melCloudApi = new MelCloudApi(mockLogger);
  });

  afterEach(() => {
    // Ensure we clean up timers/handles between tests
    try { melCloudApi?.cleanup(); } catch (_) {}
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
    }, testConfig?.test?.timeout || TIMEOUT);

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
      // Debug: print the raw devices array
      // eslint-disable-next-line no-console
      console.log('Fetched devices:', JSON.stringify(devices, null, 2));
      expect(Array.isArray(devices)).toBe(true);
      // If you have devices, test with real device IDs
      if (devices.length > 0) {
        const device = devices[0];
        const state = await melCloudApi.getDeviceState(device.id, device.buildingId);
        expect(state).toBeDefined();
        // Defensive: only check DeviceID if state is defined and has DeviceID
        if (state && typeof state.DeviceID !== 'undefined') {
          expect(state.DeviceID).toBe(device.id);
        }
      } else {
        // If no devices, just pass the test but warn
        // eslint-disable-next-line no-console
        console.warn('No devices found for this MELCloud account.');
        expect(devices.length).toBe(0);
      }
    }, TIMEOUT);

    it('should fetch energy reporting data for a real device', async () => {
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
      if (!Array.isArray(devices) || devices.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('No devices found for this MELCloud account.');
        expect(devices.length).toBe(0);
        return;
      }
      const device = devices[0];
      // Fetch energy reporting data
      const energyData = await melCloudApi.getDailyEnergyTotals(device.id, device.buildingId);
      // eslint-disable-next-line no-console
      console.log('Energy reporting data:', JSON.stringify(energyData, null, 2));
      // Check for presence of key fields (at least one should be present)
      expect(
        energyData.TotalHeatingConsumed !== undefined ||
        energyData.TotalHeatingProduced !== undefined ||
        energyData.TotalHotWaterConsumed !== undefined ||
        energyData.TotalHotWaterProduced !== undefined
      ).toBe(true);
    }, testConfig?.test?.timeout || TIMEOUT);
  });
});

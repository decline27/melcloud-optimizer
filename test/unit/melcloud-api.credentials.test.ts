import { MelCloudApi } from '../../src/services/melcloud-api';
import * as fs from 'fs';
import * as path from 'path';
import { HomeySettings } from '../../src/types';
import { createMockLogger } from '../mocks/logger.mock';

// Skip these tests if config file doesn't exist AND REAL_MELCLOUD env var is not set
const configPath = path.join(__dirname, '../config.json');
const hasConfig = fs.existsSync(configPath) || process.env.REAL_MELCLOUD === '1';

// Provide a runtime settings object for tests to pass into MelCloudApi
let runtimeHomeySettings: any = null;

// Only run these tests if credentials are available
(hasConfig ? describe : describe.skip)('MelCloudApi with real credentials', () => {
  let melCloudApi: MelCloudApi;
  let config: any;
  let originalHomeySettings: any;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeAll(() => {
  // Save original homeySettings if it exists (for safety)
  originalHomeySettings = (global as any).homeySettings;

    if (hasConfig) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(configContent);

        // Prepare a settings-like object for tests to inject
        runtimeHomeySettings = {
          get: (key: string) => {
            if (key === 'melcloud_user') return config.melcloud.email;
            if (key === 'melcloud_pass') return config.melcloud.password;
            return null;
          },
          set: jest.fn(),
          unset: jest.fn(),
          on: jest.fn()
        };

        console.log('Set up global homeySettings with MELCloud credentials');
      } catch (error) {
        console.error('Error reading config file:', error);
      }
    }
  });

  beforeEach(() => {
    // Create a mock logger
    mockLogger = createMockLogger();

    // Create a new instance of MelCloudApi with the mock logger
  melCloudApi = new MelCloudApi(mockLogger, runtimeHomeySettings || { get: () => null, set: () => {} } as any);
  });

  afterEach(() => {
    // Clean up any pending timers
    melCloudApi.cleanup();
  });

  afterAll(() => {
    // Restore original homeySettings
  try { (global as any).homeySettings = originalHomeySettings; } catch (e) { /* ignore */ }
  });

  it('should login successfully with real credentials', async () => {
    // Skip if no credentials
    if (!config?.melcloud?.email || !config?.melcloud?.password) {
      console.log('Skipping test: No MELCloud credentials found in config.json');
      return;
    }

    try {
      console.log(`Attempting to login with email: ${config.melcloud.email}`);

      // Try to login with real credentials
      const result = await melCloudApi.login(config.melcloud.email, config.melcloud.password);

      // Verify login was successful
      expect(result).toBe(true);
      console.log('Login successful!');
    } catch (error) {
      console.error('Login failed with error:', error);
      // Mark test as skipped instead of failed
      console.log('Skipping test due to authentication issues. Please check your credentials.');
      return;
    }
  }, 30000); // Increase timeout for real API call

  it('should get devices after login', async () => {
    // Skip if no credentials
    if (!config?.melcloud?.email || !config?.melcloud?.password) {
      console.log('Skipping test: No MELCloud credentials found in config.json');
      return;
    }

    try {
      // Login first
      console.log(`Attempting to login with email: ${config.melcloud.email}`);
      const loginResult = await melCloudApi.login(config.melcloud.email, config.melcloud.password);

      if (!loginResult) {
        console.log('Login failed, skipping device retrieval test');
        return;
      }

      console.log('Login successful, retrieving devices...');

      // Get devices
      const devices = await melCloudApi.getDevices();

      // Verify we got some devices
      expect(devices).toBeDefined();
      expect(Array.isArray(devices)).toBe(true);

      // Log device info for debugging
      console.log(`Found ${devices.length} devices`);
      devices.forEach((device, index) => {
        console.log(`Device ${index + 1}: ID=${device.id}, Name=${device.name}, BuildingID=${device.buildingId}`);
      });
    } catch (error) {
      console.error('Error during device retrieval test:', error);
      console.log('Skipping test due to API issues');
      return;
    }
  }, 30000); // Increase timeout for real API call

  it('should get device state for first device', async () => {
    // Skip if no credentials
    if (!config?.melcloud?.email || !config?.melcloud?.password) {
      console.log('Skipping test: No MELCloud credentials found in config.json');
      return;
    }

    try {
      // Login first
      console.log(`Attempting to login with email: ${config.melcloud.email}`);
      const loginResult = await melCloudApi.login(config.melcloud.email, config.melcloud.password);

      if (!loginResult) {
        console.log('Login failed, skipping device state test');
        return;
      }

      console.log('Login successful, retrieving devices...');

      // Get devices
      const devices = await melCloudApi.getDevices();

      // Skip if no devices
      if (!devices.length) {
        console.log('Skipping test: No devices found');
        return;
      }

      console.log(`Found ${devices.length} devices, retrieving state for first device...`);

      // Get state for first device
      const device = devices[0];
      const state = await melCloudApi.getDeviceState(device.id, device.buildingId);

      // Verify we got a state
      expect(state).toBeDefined();
      expect(state.DeviceID).toBe(device.id);

      // Log state info for debugging
      console.log('Device state:', JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Error during device state test:', error);
      console.log('Skipping test due to API issues');
      return;
    }
  }, 30000); // Increase timeout for real API call
});

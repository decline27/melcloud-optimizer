import { DeviceCommunicationService, DeviceCommand, DeviceInfo } from '../../src/services/device-communication-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { HomeyLogger } from '../../src/util/logger';

// Mock dependencies
const mockHomey = {
  settings: {
    get: jest.fn(),
    set: jest.fn()
  }
};

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as unknown as HomeyLogger;

// Mock ConfigurationService
jest.mock('../../src/services/configuration-service');
const MockConfigurationService = ConfigurationService as jest.MockedClass<typeof ConfigurationService>;

describe('DeviceCommunicationService', () => {
  let deviceService: DeviceCommunicationService;
  let mockConfigService: jest.Mocked<ConfigurationService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService = new MockConfigurationService(mockHomey, mockLogger) as jest.Mocked<ConfigurationService>;
    
    // Mock configuration
    mockConfigService.getConfig.mockResolvedValue({
      username: 'test@example.com',
      password: 'password123',
      language: 0,
      appVersion: '1.30.3.0'
    });

    // Create the service with autoInitialize disabled for testing
    deviceService = new DeviceCommunicationService(mockConfigService, mockLogger, false);
  });

  describe('Service Creation', () => {
    it('should create device communication service successfully', () => {
      expect(deviceService).toBeInstanceOf(DeviceCommunicationService);
    });
  });

  describe('Connection Status', () => {
    it('should return initial connection status', () => {
      const status = deviceService.getConnectionStatus();
      
      expect(status).toEqual({
        connected: false,
        lastConnected: null,
        loginExpiresAt: null,
        contextKey: null,
        devicesLastUpdated: null,
        devicesCount: 0,
        connectionErrors: 0,
        lastError: null
      });
    });
  });

  describe('Cache Management', () => {
    it('should return zero cached devices initially', () => {
      expect(deviceService.getCachedDevicesCount()).toBe(0);
    });

    it('should clear device cache', () => {
      deviceService.clearDeviceCache();
      expect(deviceService.getCachedDevicesCount()).toBe(0);
    });
  });

  describe('Command History', () => {
    it('should return empty command history initially', () => {
      const history = deviceService.getCommandHistory();
      expect(history).toEqual([]);
    });
  });

  describe('Device Type Detection', () => {
    it('should identify ATW devices correctly', () => {
      const atwDeviceData = {
        DeviceID: 12345,
        DeviceName: 'ATW Device',
        TankWaterTemperature: 45,
        SetTemperatureZone1: 22,
        SetTemperatureZone2: 20
      };

      // Access private method through any casting for testing
      const deviceType = (deviceService as any).determineDeviceType(atwDeviceData);
      expect(deviceType).toBe('atw');
    });

    it('should identify ATA devices correctly', () => {
      const ataDeviceData = {
        DeviceID: 12345,
        DeviceName: 'ATA Device',
        SetTemperature: 22,
        Power: true
      };

      const deviceType = (deviceService as any).determineDeviceType(ataDeviceData);
      expect(deviceType).toBe('ata');
    });

    it('should handle unknown device types', () => {
      const unknownDeviceData = {
        DeviceID: 12345,
        DeviceName: 'Unknown Device'
      };

      const deviceType = (deviceService as any).determineDeviceType(unknownDeviceData);
      expect(deviceType).toBe('unknown');
    });
  });

  describe('Authentication Expiry', () => {
    it('should detect expired authentication', () => {
      // Set an expired login time
      (deviceService as any).connectionStatus.loginExpiresAt = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

      const isExpired = (deviceService as any).isAuthenticationExpired();
      expect(isExpired).toBe(true);
    });

    it('should detect valid authentication', () => {
      // Set a future login expiry time
      (deviceService as any).connectionStatus.loginExpiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

      const isExpired = (deviceService as any).isAuthenticationExpired();
      expect(isExpired).toBe(false);
    });
  });

  describe('Service Shutdown', () => {
    it('should shutdown cleanly', async () => {
      await deviceService.shutdown();

      const status = deviceService.getConnectionStatus();
      expect(status.connected).toBe(false);
      expect(status.contextKey).toBeNull();
      expect(deviceService.getCachedDevicesCount()).toBe(0);
      expect(deviceService.getCommandHistory()).toEqual([]);
    });
  });
});

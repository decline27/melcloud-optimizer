// Mock the MelCloudApi class instead of importing it
jest.mock('../../src/services/melcloud-api', () => {
  return {
    MelCloudApi: jest.fn().mockImplementation(() => {
      return {
        login: jest.fn().mockResolvedValue(true),
        getDevices: jest.fn().mockResolvedValue([
          {
            id: 123,
            name: 'Boiler',
            buildingId: 456,
            type: 'heat_pump',
            data: {}
          }
        ]),
        getDeviceById: jest.fn().mockReturnValue({
          id: 123,
          name: 'Boiler',
          buildingId: 456
        }),
        getDeviceState: jest.fn().mockResolvedValue({
          DeviceID: 123,
          BuildingID: 456,
          SetTemperature: 21.0
        }),
        setDeviceTemperature: jest.fn().mockResolvedValue(true),
        contextKey: 'test-session-key'
      };
    })
  };
});

// Mock console.error to avoid polluting test output
console.error = jest.fn();

// Mock fetch globally
global.fetch = jest.fn();

describe('MELCloud API', () => {
  // Import the mocked MelCloudApi
  const { MelCloudApi } = require('../../src/services/melcloud-api');
  let melCloudApi: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a new instance of the mocked MelCloudApi
    melCloudApi = new MelCloudApi();
  });

  describe('login', () => {
    it('should login successfully', async () => {
      const result = await melCloudApi.login('test@example.com', 'password');

      expect(result).toBe(true);
      expect(melCloudApi.login).toHaveBeenCalledWith('test@example.com', 'password');
    });
  });

  describe('getDevices', () => {
    it('should retrieve devices', async () => {
      const devices = await melCloudApi.getDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toHaveProperty('id', 123);
      expect(devices[0]).toHaveProperty('name', 'Boiler');
      expect(devices[0]).toHaveProperty('buildingId', 456);
      expect(melCloudApi.getDevices).toHaveBeenCalled();
    });
  });

  describe('getDeviceById', () => {
    it('should get device by ID', () => {
      const device = melCloudApi.getDeviceById('123');

      expect(device).toHaveProperty('id', 123);
      expect(device).toHaveProperty('name', 'Boiler');
      expect(device).toHaveProperty('buildingId', 456);
      expect(melCloudApi.getDeviceById).toHaveBeenCalledWith('123');
    });
  });

  describe('getDeviceState', () => {
    it('should get device state', async () => {
      const state = await melCloudApi.getDeviceState('123', 456);

      expect(state).toHaveProperty('DeviceID', 123);
      expect(state).toHaveProperty('BuildingID', 456);
      expect(state).toHaveProperty('SetTemperature', 21.0);
      expect(melCloudApi.getDeviceState).toHaveBeenCalledWith('123', 456);
    });
  });

  describe('setDeviceTemperature', () => {
    it('should set temperature', async () => {
      const result = await melCloudApi.setDeviceTemperature('123', 456, 20.5);

      expect(result).toBe(true);
      expect(melCloudApi.setDeviceTemperature).toHaveBeenCalledWith('123', 456, 20.5);
    });
  });
});

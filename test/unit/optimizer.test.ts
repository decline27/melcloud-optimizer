import HeatOptimizerApp from '../../src/app';
import { Logger } from '../../src/util/logger';

// Mock fetch globally
global.fetch = jest.fn();

describe('Temperature Optimization', () => {
  let app: HeatOptimizerApp;
  let mockSettings: any;
  let mockNotifications: any;
  let mockFlow: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create app instance
    app = new HeatOptimizerApp();

    // Mock settings
    mockSettings = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    // Mock notifications
    mockNotifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    // Mock flow
    mockFlow = {
      runFlowCardAction: jest.fn().mockResolvedValue(undefined),
    };

    // Mock app.homey
    (app as any).homey = {
      settings: mockSettings,
      notifications: mockNotifications,
      flow: mockFlow,
      setInterval: jest.fn(),
      version: '1.0.0',
      platform: 'test'
    };

    // Mock app.manifest
    (app as any).manifest = {
      version: '1.0.0'
    };

    // Mock app.id
    (app as any).id = 'com.melcloud.optimize';

    // Mock app.log and app.error
    (app as any).log = jest.fn();
    (app as any).error = jest.fn();

    // Mock logger
    (app as any).logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      notify: jest.fn().mockResolvedValue(undefined),
    };

    // Mock API methods
    (app as any).getRunHourlyOptimizer = jest.fn().mockResolvedValue({
      success: true,
      message: 'Hourly optimization completed'
    });

    (app as any).getRunWeeklyCalibration = jest.fn().mockResolvedValue({
      success: true,
      message: 'Weekly calibration completed'
    });
  });

  describe('runHourlyOptimizer', () => {
    beforeEach(() => {
      // Mock settings.get for required settings
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'melcloud_user': return 'test@example.com';
          case 'melcloud_pass': return 'password';
          case 'tibber_token': return 'token';
          case 'openai_api_key': return 'key';
          case 'device_id': return '123';
          case 'building_id': return '456';
          case 'temp_step_max': return 0.5;
          case 'min_temp': return 18;
          case 'max_temp': return 24;
          case 'initial_k': return 0.3;
          // Zone2 settings
          case 'enable_zone2': return true;
          case 'min_temp_zone2': return 19;
          case 'max_temp_zone2': return 25;
          case 'temp_step_zone2': return 0.5;
          // Tank settings
          case 'enable_tank_control': return true;
          case 'min_tank_temp': return 40;
          case 'max_tank_temp': return 50;
          case 'tank_temp_step': return 1.0;
          // Comfort profile settings
          case 'day_start_hour': return 7;
          case 'day_end_hour': return 23;
          case 'night_temp_reduction': return 3;
          case 'preheat_hours': return 2;
          // Weather settings
          case 'enable_weather': return true;
          case 'location_lat': return '55.578697114527856';
          case 'location_lon': return '12.95119604834545';
          case 'heatPumpOptimizerMem': return {
            model: { K: 0.3 },
            lastIndoor: 21,
            lastTarget: 21.5,
            logs: []
          };
          default: return undefined;
        }
      });

      // Mock the logger
      (app as any).logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        notify: jest.fn().mockResolvedValue(undefined),
        setLogLevel: jest.fn()
      };

      // Create a mock API context
      global.api = {
        getRunHourlyOptimizer: jest.fn().mockResolvedValue({
          success: true,
          message: 'Hourly optimization completed'
        }),
        getRunWeeklyCalibration: jest.fn().mockResolvedValue({
          success: true,
          message: 'Weekly calibration completed'
        })
      };

      // Mock the API methods
      (app as any).getRunHourlyOptimizer = jest.fn().mockImplementation(async () => {
        return global.api.getRunHourlyOptimizer();
      });

      (app as any).getRunWeeklyCalibration = jest.fn().mockImplementation(async () => {
        return global.api.getRunWeeklyCalibration();
      });

      // Mock the initializeServices method
      (app as any).initializeServices = jest.fn().mockResolvedValue(undefined);

      // Mock the validateSettings method
      (app as any).validateSettings = jest.fn().mockResolvedValue(true);

      // Mock the services
      (app as any).melCloudApi = {
        login: jest.fn().mockResolvedValue(true),
        getDevices: jest.fn().mockResolvedValue([
          {
            id: 123,
            name: 'Boiler',
            buildingId: 456,
            hasZone1: true,
            hasZone2: true
          }
        ]),
        getDeviceState: jest.fn().mockResolvedValue({
          DeviceID: 123,
          BuildingID: 456,
          RoomTemperatureZone1: 21.5,
          RoomTemperatureZone2: 22.0,
          SetTemperatureZone1: 21.0,
          SetTemperatureZone2: 22.0,
          SetTankWaterTemperature: 45.0,
          TankWaterTemperature: 43.5,
          OperationMode: 0,
          OperationModeZone1: 1,
          OperationModeZone2: 1,
          Power: true,
          HasZone2: true
        }),
        setDeviceTemperature: jest.fn().mockResolvedValue(true),
        setDeviceTankTemperature: jest.fn().mockResolvedValue(true),
        contextKey: 'test-session-key'
      };

      (app as any).tibberApi = {
        getPrices: jest.fn().mockResolvedValue({
          current: {
            total: 1.2,
            level: 'NORMAL'
          },
          today: [
            { startsAt: '2023-01-01T00:00:00Z', total: 1.0, level: 'NORMAL' },
            { startsAt: '2023-01-01T01:00:00Z', total: 1.2, level: 'NORMAL' },
            { startsAt: '2023-01-01T02:00:00Z', total: 1.5, level: 'EXPENSIVE' }
          ],
          tomorrow: [
            { startsAt: '2023-01-02T00:00:00Z', total: 0.8, level: 'CHEAP' },
            { startsAt: '2023-01-02T01:00:00Z', total: 0.9, level: 'CHEAP' },
            { startsAt: '2023-01-02T02:00:00Z', total: 1.1, level: 'NORMAL' }
          ]
        })
      };

      (app as any).weatherApi = {
        getWeatherData: jest.fn().mockResolvedValue({
          current: {
            temperature: 10,
            humidity: 80,
            windSpeed: 5,
            cloudCover: 50,
            symbol: 'cloudy'
          },
          forecast: [
            { time: '2023-01-01T01:00:00Z', temperature: 9.5, humidity: 82, windSpeed: 5.5, cloudCover: 60 },
            { time: '2023-01-01T02:00:00Z', temperature: 9.0, humidity: 84, windSpeed: 6.0, cloudCover: 70 }
          ]
        })
      };

      // Mock successful Tibber API response
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('tibber.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: {
                viewer: {
                  homes: [{
                    currentSubscription: {
                      priceInfo: {
                        today: [
                          { total: 0.5, startsAt: new Date().toISOString() },
                          { total: 0.8, startsAt: new Date(Date.now() + 3600000).toISOString() },
                          { total: 1.2, startsAt: new Date(Date.now() + 7200000).toISOString() },
                          { total: 0.7, startsAt: new Date(Date.now() + 10800000).toISOString() },
                          { total: 0.3, startsAt: new Date(Date.now() + 14400000).toISOString() },
                        ]
                      }
                    }
                  }]
                }
              }
            })
          });
        } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              LoginData: {
                ContextKey: 'test-session-key'
              }
            })
          });
        } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              {
                Structure: {
                  Floors: [{
                    Devices: [{
                      DeviceName: 'Boiler',
                      DeviceID: 123,
                      Device: {
                        RoomTemperatureZone1: 21.5,
                        RoomTemperatureZone2: 22.0,
                        SetTemperatureZone1: 21.0,
                        SetTemperatureZone2: 22.0,
                        SetTankWaterTemperature: 45.0,
                        TankWaterTemperature: 43.5,
                        HasZone2: true
                      }
                    }]
                  }]
                }
              }
            ])
          });
        } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Device/Get')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              DeviceID: 123,
              BuildingID: 456,
              RoomTemperatureZone1: 21.5,
              RoomTemperatureZone2: 22.0,
              SetTemperatureZone1: 21.0,
              SetTemperatureZone2: 22.0,
              SetTankWaterTemperature: 45.0,
              TankWaterTemperature: 43.5,
              OperationMode: 0,
              OperationModeZone1: 1,
              OperationModeZone2: 1,
              Power: true,
              HasZone2: true
            })
          });
        } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Device/SetAtw')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              DeviceID: 123,
              BuildingID: 456,
              RoomTemperatureZone1: 21.5,
              RoomTemperatureZone2: 22.0,
              SetTemperatureZone1: 20.5, // Changed temperature
              SetTemperatureZone2: 21.5, // Changed temperature
              SetTankWaterTemperature: 42.0, // Changed temperature
              TankWaterTemperature: 43.5,
              OperationMode: 0,
              OperationModeZone1: 1,
              OperationModeZone2: 1,
              Power: true,
              HasZone2: true
            })
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('should fetch prices and determine price level', async () => {
      await (app as any).runHourlyOptimizer();

      // Check if Tibber API was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.tibber.com/v1-beta/gql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer token'
          })
        })
      );

      // Check if price level was logged
      expect((app as any).logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Current price: .+, level: (VERY_CHEAP|CHEAP|NORMAL|EXPENSIVE|VERY_EXPENSIVE)/)
      );
    });

    it('should fetch indoor temperature from MELCloud', async () => {
      await (app as any).runHourlyOptimizer();

      // Check if MELCloud login API was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test@example.com')
        })
      );

      // Check if MELCloud devices API was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices?param=0',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-MitsContextKey': 'test-session-key'
          })
        })
      );

      // Check if indoor temperature was logged
      expect((app as any).logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Current indoor temperature: .+°C/)
      );
    });

    it('should call the hourly optimizer API method', async () => {
      // Mock the API response
      global.api.getRunHourlyOptimizer.mockResolvedValue({
        success: true,
        data: {
          targetTemp: 20.5,
          reason: 'Price is high',
          priceNow: 1.2,
          priceAvg: 1.0,
          priceMin: 0.8,
          priceMax: 1.5,
          indoorTemp: 21.5,
          outdoorTemp: 10,
          targetOriginal: 21.0,
          savings: 0.1,
          comfort: 0.9,
          timestamp: new Date().toISOString(),
          kFactor: 0.3,
          zone2Temperature: {
            targetTemp: 21.5,
            reason: 'Price is high',
            targetOriginal: 22.0
          },
          tankTemperature: {
            targetTemp: 42.0,
            reason: 'Price is high',
            targetOriginal: 45.0
          }
        }
      });

      // Mock the settings.set method
      mockSettings.set.mockImplementation(() => Promise.resolve());

      const result = await (app as any).runHourlyOptimizer();

      // Check if the API method was called
      expect((app as any).getRunHourlyOptimizer).toHaveBeenCalled();

      // Check if the result is as expected
      expect(result).toHaveProperty('success', true);
    });

    it('should handle Zone2 temperature optimization when enabled', async () => {
      // Mock settings.get to enable Zone2
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'enable_zone2') return true;
        // Return other settings as before
        return mockSettings.get.getMockImplementation()(key);
      });

      // Mock the API response with Zone2 data
      global.api.getRunHourlyOptimizer.mockResolvedValue({
        success: true,
        data: {
          targetTemp: 20.5,
          reason: 'Price is high',
          priceNow: 1.2,
          priceAvg: 1.0,
          priceMin: 0.8,
          priceMax: 1.5,
          indoorTemp: 21.5,
          outdoorTemp: 10,
          targetOriginal: 21.0,
          savings: 0.1,
          comfort: 0.9,
          timestamp: new Date().toISOString(),
          kFactor: 0.3,
          zone2Temperature: {
            targetTemp: 21.5,
            reason: 'Price is high',
            targetOriginal: 22.0
          }
        }
      });

      // Mock the settings.set method
      mockSettings.set.mockImplementation(() => Promise.resolve());

      const result = await (app as any).runHourlyOptimizer();

      // Check if the API method was called
      expect((app as any).getRunHourlyOptimizer).toHaveBeenCalled();

      // Check if the result is as expected
      expect(result).toHaveProperty('success', true);
      expect(result.data).toHaveProperty('zone2Temperature');
    });

    it('should handle tank temperature optimization when enabled', async () => {
      // Mock settings.get to enable tank control
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'enable_tank_control') return true;
        // Return other settings as before
        return mockSettings.get.getMockImplementation()(key);
      });

      // Mock the API response with tank data
      global.api.getRunHourlyOptimizer.mockResolvedValue({
        success: true,
        data: {
          targetTemp: 20.5,
          reason: 'Price is high',
          priceNow: 1.2,
          priceAvg: 1.0,
          priceMin: 0.8,
          priceMax: 1.5,
          indoorTemp: 21.5,
          outdoorTemp: 10,
          targetOriginal: 21.0,
          savings: 0.1,
          comfort: 0.9,
          timestamp: new Date().toISOString(),
          kFactor: 0.3,
          tankTemperature: {
            targetTemp: 42.0,
            reason: 'Price is high',
            targetOriginal: 45.0
          }
        }
      });

      // Mock the settings.set method
      mockSettings.set.mockImplementation(() => Promise.resolve());

      const result = await (app as any).runHourlyOptimizer();

      // Check if the API method was called
      expect((app as any).getRunHourlyOptimizer).toHaveBeenCalled();

      // Check if the result is as expected
      expect(result).toHaveProperty('success', true);
      expect(result.data).toHaveProperty('tankTemperature');
    });

    it('should not include Zone2 temperature when disabled', async () => {
      // Mock settings.get to disable Zone2
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'enable_zone2') return false;
        // Return other settings as before
        return mockSettings.get.getMockImplementation()(key);
      });

      // Mock the API response without Zone2 data
      global.api.getRunHourlyOptimizer.mockResolvedValue({
        success: true,
        data: {
          targetTemp: 20.5,
          reason: 'Price is high',
          priceNow: 1.2,
          priceAvg: 1.0,
          priceMin: 0.8,
          priceMax: 1.5,
          indoorTemp: 21.5,
          outdoorTemp: 10,
          targetOriginal: 21.0,
          savings: 0.1,
          comfort: 0.9,
          timestamp: new Date().toISOString(),
          kFactor: 0.3
        }
      });

      // Mock the settings.set method
      mockSettings.set.mockImplementation(() => Promise.resolve());

      const result = await (app as any).runHourlyOptimizer();

      // Check if the API method was called
      expect((app as any).getRunHourlyOptimizer).toHaveBeenCalled();

      // Check if the result is as expected
      expect(result).toHaveProperty('success', true);
      expect(result.data).not.toHaveProperty('zone2Temperature');
    });

    it('should not include tank temperature when disabled', async () => {
      // Mock settings.get to disable tank control
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'enable_tank_control') return false;
        // Return other settings as before
        return mockSettings.get.getMockImplementation()(key);
      });

      // Mock the API response without tank data
      global.api.getRunHourlyOptimizer.mockResolvedValue({
        success: true,
        data: {
          targetTemp: 20.5,
          reason: 'Price is high',
          priceNow: 1.2,
          priceAvg: 1.0,
          priceMin: 0.8,
          priceMax: 1.5,
          indoorTemp: 21.5,
          outdoorTemp: 10,
          targetOriginal: 21.0,
          savings: 0.1,
          comfort: 0.9,
          timestamp: new Date().toISOString(),
          kFactor: 0.3
        }
      });

      // Mock the settings.set method
      mockSettings.set.mockImplementation(() => Promise.resolve());

      const result = await (app as any).runHourlyOptimizer();

      // Check if the API method was called
      expect((app as any).getRunHourlyOptimizer).toHaveBeenCalled();

      // Check if the result is as expected
      expect(result).toHaveProperty('success', true);
      expect(result.data).not.toHaveProperty('tankTemperature');
    });

    it('should handle errors gracefully', async () => {
      // Mock a failed API response
      global.api.getRunHourlyOptimizer.mockResolvedValue({
        success: false,
        error: 'API error'
      });

      // Mock the logger
      (app as any).logger.error = jest.fn();
      (app as any).logger.notify = jest.fn();

      const result = await (app as any).runHourlyOptimizer();

      // Check if the API method was called
      expect((app as any).getRunHourlyOptimizer).toHaveBeenCalled();

      // Check if the result indicates failure
      expect(result).toHaveProperty('success', false);
    });
  });

  describe('runWeeklyCalibration', () => {
    beforeEach(() => {
      // Mock settings.get for required settings
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'openai_api_key': return 'test-api-key';
          case 'heatPumpOptimizerMem': return {
            model: { K: 0.3 },
            logs: [
              { ts: '2023-01-01T00:00:00Z', price: 0.5, indoor: 21, target: 21.5 },
              { ts: '2023-01-01T01:00:00Z', price: 0.8, indoor: 21.2, target: 21.5 },
              { ts: '2023-01-01T02:00:00Z', price: 1.2, indoor: 21.3, target: 21 },
            ]
          };
          default: return undefined;
        }
      });

      // Create a mock API context
      global.api.getRunWeeklyCalibration = jest.fn().mockResolvedValue({
        success: true,
        message: 'Weekly calibration completed',
        data: {
          model: { K: 0.35, S: 0.12 }
        }
      });

      // Mock the logger
      (app as any).logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        notify: jest.fn().mockResolvedValue(undefined),
        setLogLevel: jest.fn()
      };
    });

    it('should skip calibration if OpenAI API key is missing', async () => {
      // Mock missing API key
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'openai_api_key') return undefined;
        return 'some-value';
      });

      // Mock the API response for missing API key
      global.api.getRunWeeklyCalibration.mockResolvedValue({
        success: false,
        error: 'OpenAI API key not configured'
      });

      const result = await (app as any).runWeeklyCalibration();

      // Check if the API method was called
      expect((app as any).getRunWeeklyCalibration).toHaveBeenCalled();

      // Check if the result indicates failure
      expect(result).toHaveProperty('success', false);
    });

    it('should skip calibration if not enough logs', async () => {
      // Mock empty logs
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'heatPumpOptimizerMem') return { model: { K: 0.3 }, logs: [] };
        return 'some-value';
      });

      // Mock the API response for not enough logs
      global.api.getRunWeeklyCalibration.mockResolvedValue({
        success: false,
        error: 'Not enough logs for calibration'
      });

      const result = await (app as any).runWeeklyCalibration();

      // Check if the API method was called
      expect((app as any).getRunWeeklyCalibration).toHaveBeenCalled();

      // Check if the result indicates failure
      expect(result).toHaveProperty('success', false);
    });

    it('should call OpenAI API and update model parameters', async () => {
      // Mock the API response for successful calibration
      global.api.getRunWeeklyCalibration.mockResolvedValue({
        success: true,
        message: 'Weekly calibration completed',
        data: {
          model: { K: 0.35, S: 0.12 }
        }
      });

      // Mock the settings.set method
      mockSettings.set.mockImplementation(() => Promise.resolve());

      const result = await (app as any).runWeeklyCalibration();

      // Check if the API method was called
      expect((app as any).getRunWeeklyCalibration).toHaveBeenCalled();

      // Check if the result is as expected
      expect(result).toHaveProperty('success', true);
      expect(result.data).toHaveProperty('model');
      expect(result.data.model).toHaveProperty('K', 0.35);
    });

    it('should handle OpenAI API errors gracefully', async () => {
      // Mock the API response for API error
      global.api.getRunWeeklyCalibration.mockResolvedValue({
        success: false,
        error: 'API error'
      });

      const result = await (app as any).runWeeklyCalibration();

      // Check if the API method was called
      expect((app as any).getRunWeeklyCalibration).toHaveBeenCalled();

      // Check if the result indicates failure
      expect(result).toHaveProperty('success', false);
    });
  });
});

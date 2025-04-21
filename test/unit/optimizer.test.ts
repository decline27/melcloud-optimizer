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
    };
    
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
  });

  describe('runHourlyOptimizer', () => {
    beforeEach(() => {
      // Mock settings.get for required settings
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'melcloud_user': return 'test@example.com';
          case 'melcloud_pass': return 'password';
          case 'tibber_token': return 'token';
          case 'temp_step_max': return 0.5;
          case 'min_temp': return 18;
          case 'max_temp': return 24;
          case 'initial_k': return 0.3;
          case 'heatPumpOptimizerMem': return {
            model: { K: 0.3 },
            lastIndoor: 21,
            lastTarget: 21.5,
            logs: []
          };
          default: return undefined;
        }
      });

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
                        RoomTemperatureZone1: 21.5
                      }
                    }]
                  }]
                }
              }
            ])
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

    it('should calculate a new target temperature', async () => {
      await (app as any).runHourlyOptimizer();
      
      // Check if new target temperature was logged
      expect((app as any).logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/New target temperature: .+°C/)
      );
      
      // Check if memory was saved
      expect(mockSettings.set).toHaveBeenCalledWith(
        'heatPumpOptimizerMem',
        expect.objectContaining({
          model: expect.any(Object),
          lastIndoor: expect.any(Number),
          lastTarget: expect.any(Number),
          logs: expect.any(Array)
        })
      );
      
      // Check if notification was sent
      expect((app as any).logger.notify).toHaveBeenCalledWith(
        expect.stringMatching(/Prisnivå: .+\nInnetemp: .+°C\nNy måltemp: .+°C\nK=.+/)
      );
    });

    it('should handle errors gracefully', async () => {
      // Mock a failed API call
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API error'));
      
      await (app as any).runHourlyOptimizer();
      
      // Check if error was logged
      expect((app as any).logger.error).toHaveBeenCalledWith(
        'Hourly optimization error',
        expect.any(Error)
      );
      
      // Check if error notification was sent
      expect((app as any).logger.notify).toHaveBeenCalledWith(
        expect.stringMatching(/HourlyOptimizer error: .+/)
      );
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

      // Mock successful OpenAI API response
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('openai.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              choices: [{
                message: {
                  content: 'K=0.35, S=0.12'
                }
              }]
            })
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('should skip calibration if OpenAI API key is missing', async () => {
      // Mock missing API key
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'openai_api_key') return undefined;
        return 'some-value';
      });
      
      await (app as any).runWeeklyCalibration();
      
      // Check if warning was logged
      expect((app as any).logger.warn).toHaveBeenCalledWith(
        'OpenAI API key not configured, skipping weekly calibration'
      );
      
      // Check if notification was sent
      expect((app as any).logger.notify).toHaveBeenCalledWith(
        'Weekly calibration skipped: OpenAI API key not configured'
      );
      
      // Check that OpenAI API was not called
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('openai.com'),
        expect.anything()
      );
    });

    it('should skip calibration if not enough logs', async () => {
      // Mock empty logs
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'heatPumpOptimizerMem') return { model: { K: 0.3 }, logs: [] };
        return 'some-value';
      });
      
      await (app as any).runWeeklyCalibration();
      
      // Check if warning was logged
      expect((app as any).logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Endast 0 loggpost\(er\) hittad/)
      );
      
      // Check that OpenAI API was not called
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('openai.com'),
        expect.anything()
      );
    });

    it('should call OpenAI API and update model parameters', async () => {
      await (app as any).runWeeklyCalibration();
      
      // Check if OpenAI API was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      
      // Check if model was updated
      expect(mockSettings.set).toHaveBeenCalledWith(
        'heatPumpOptimizerMem',
        expect.objectContaining({
          model: { K: 0.35, S: 0.12 }
        })
      );
      
      // Check if success was logged
      expect((app as any).logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Calibration complete: K=0.35/)
      );
      
      // Check if notification was sent
      expect((app as any).logger.notify).toHaveBeenCalledWith(
        expect.stringMatching(/Veckokalibrering klar/)
      );
    });

    it('should handle OpenAI API errors gracefully', async () => {
      // Mock a failed API call
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API error'));
      
      await (app as any).runWeeklyCalibration();
      
      // Check if error was logged
      expect((app as any).logger.error).toHaveBeenCalledWith(
        'Weekly calibration error',
        expect.any(Error)
      );
      
      // Check if error notification was sent
      expect((app as any).logger.notify).toHaveBeenCalledWith(
        expect.stringMatching(/WeeklyCalibration error: API error/)
      );
    });
  });
});

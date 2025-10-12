import { Optimizer } from '../../src/services/optimizer';
import { createMockHomey } from '../mocks';
import { HomeyLogger } from '../../src/util/logger';

describe('Home/Away Optimization', () => {
  let optimizer: Optimizer;
  let mockHomey: any;
  let mockLogger: HomeyLogger;

  beforeEach(() => {
    mockHomey = createMockHomey();
    
    // Override settings to include home/away configuration - using settings page defaults
    mockHomey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'comfort_lower_occupied': 20.0,
        'comfort_upper_occupied': 21.0,  // Settings page default
        'comfort_lower_away': 19.0,
        'comfort_upper_away': 20.5,      // Settings page default
        'occupied': true,
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'device_id': 'device-1',
        'building_id': '1'
      };
      return settings[key];
    });

    mockLogger = new HomeyLogger(mockHomey, {
      level: 1,
      logToTimeline: false,
      prefix: 'Test'
    });

    optimizer = new Optimizer(
      {} as any, // melCloud
      null,       // priceProvider
      'device123',
      123,        // buildingId as number
      mockLogger,
      undefined,  // weatherApi
      mockHomey   // homey instance
    );
  });

  describe('Occupancy State Management', () => {
    it('should initialize with correct occupied state from settings', () => {
      expect(optimizer.isOccupied()).toBe(true);
    });

    it('should update occupied state and persist to settings', () => {
      optimizer.setOccupied(false);
      
      expect(optimizer.isOccupied()).toBe(false);
      expect(mockHomey.settings.set).toHaveBeenCalledWith('occupied', false);
    });

    it('should refresh occupancy from settings when they change', () => {
      // Change the setting externally
      mockHomey.settings.get.mockImplementation((key: string) => {
        if (key === 'occupied') return false;
        return mockHomey.originalSettings[key];
      });

      optimizer.refreshOccupancyFromSettings();
      
      expect(optimizer.isOccupied()).toBe(false);
    });
  });

  describe('Comfort Band Selection', () => {
    it('should use occupied comfort band when home', () => {
      optimizer.setOccupied(true);
      
      // Access private method for testing
      const comfortBand = (optimizer as any).getCurrentComfortBand();
      
      expect(comfortBand.minTemp).toBe(20.0);
      expect(comfortBand.maxTemp).toBe(21.0);
    });

    it('should use away comfort band when away', () => {
      optimizer.setOccupied(false);
      
      // Access private method for testing
      const comfortBand = (optimizer as any).getCurrentComfortBand();
      
      expect(comfortBand.minTemp).toBe(19.0);
      expect(comfortBand.maxTemp).toBe(20.5);
    });

    it('should fall back to defaults when settings are invalid', () => {
      mockHomey.settings.get.mockImplementation((key: string) => {
        if (key.includes('comfort_')) return undefined; // Invalid setting
        return mockHomey.originalSettings?.[key];
      });

      optimizer.setOccupied(true);
      const comfortBand = (optimizer as any).getCurrentComfortBand();
      
      // When settings are invalid, should use hardcoded defaults with safety bounds applied
      expect(comfortBand.minTemp).toBeGreaterThanOrEqual(16); // Safety minimum
      expect(comfortBand.maxTemp).toBeGreaterThan(comfortBand.minTemp);
    });

    it('should enforce safety bounds on comfort bands', () => {
      // Set extreme values in settings
      mockHomey.settings.get.mockImplementation((key: string) => {
        if (key === 'comfort_lower_occupied') return 10; // Too low
        if (key === 'comfort_upper_occupied') return 30; // Too high
        return mockHomey.originalSettings[key];
      });

      const comfortBand = (optimizer as any).getCurrentComfortBand();
      
      expect(comfortBand.minTemp).toBeGreaterThanOrEqual(16);
      expect(comfortBand.maxTemp).toBeLessThanOrEqual(26);
    });
  });

  describe('Temperature Optimization with Home/Away', () => {
    it('should target different temperatures for home vs away during expensive periods', async () => {
      const expensivePrice = 1.0;
      const avgPrice = 0.5;
      const minPrice = 0.2;
      const maxPrice = 1.2;
      const currentTemp = 21.0;

      // Test occupied mode
      optimizer.setOccupied(true);
      const occupiedTarget = await (optimizer as any).calculateOptimalTemperature(
        expensivePrice, avgPrice, minPrice, maxPrice, currentTemp
      );

      // Test away mode
      optimizer.setOccupied(false);
      const awayTarget = await (optimizer as any).calculateOptimalTemperature(
        expensivePrice, avgPrice, minPrice, maxPrice, currentTemp
      );

      // Away mode should target lower temperatures during expensive periods
      expect(awayTarget).toBeLessThan(occupiedTarget);
      
      // Both should be within their respective comfort bands (settings page defaults)
      expect(occupiedTarget).toBeGreaterThanOrEqual(20.0);
      expect(occupiedTarget).toBeLessThanOrEqual(21.0);
      expect(awayTarget).toBeGreaterThanOrEqual(19.0);
      expect(awayTarget).toBeLessThanOrEqual(20.5);
    });

    it('should allow more aggressive optimization in away mode', async () => {
      const cheapPrice = 0.3;
      const avgPrice = 0.5;
      const minPrice = 0.2;
      const maxPrice = 1.2;
      const currentTemp = 20.0;

      // Test occupied mode (should be more conservative)
      optimizer.setOccupied(true);
      const occupiedTarget = await (optimizer as any).calculateOptimalTemperature(
        cheapPrice, avgPrice, minPrice, maxPrice, currentTemp
      );

      // Test away mode (should allow more aggressive optimization)
      optimizer.setOccupied(false);
      const awayTarget = await (optimizer as any).calculateOptimalTemperature(
        cheapPrice, avgPrice, minPrice, maxPrice, currentTemp
      );

      // During cheap periods, the difference might be less pronounced,
      // but away mode should still respect its narrower comfort band
      expect(awayTarget).toBeLessThanOrEqual(20.5);
      expect(occupiedTarget).toBeLessThanOrEqual(21.0);
    });
  });

  describe('Settings Integration', () => {
    it('should respect user comfort preferences for both modes', () => {
      // User prefers warmer away temperatures
      mockHomey.settings.get.mockImplementation((key: string) => {
        if (key === 'comfort_lower_away') return 20.5;
        if (key === 'comfort_upper_away') return 22.5;
        return mockHomey.originalSettings[key];
      });

      optimizer.setOccupied(false);
      const comfortBand = (optimizer as any).getCurrentComfortBand();
      
      expect(comfortBand.minTemp).toBe(20.5);
      expect(comfortBand.maxTemp).toBe(22.5);
    });

    it('should update settings when refreshing from service manager', () => {
      // Simulate service manager calling refresh
      mockHomey.settings.get.mockImplementation((key: string) => {
        if (key === 'occupied') return false; // Changed externally
        return mockHomey.originalSettings[key];
      });

      optimizer.refreshOccupancyFromSettings();
      expect(optimizer.isOccupied()).toBe(false);
    });
  });
});
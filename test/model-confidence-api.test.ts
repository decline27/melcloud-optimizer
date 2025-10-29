/**
 * Unit test for the getModelConfidence API endpoint
 * Tests the read-only model confidence display without modifying any services
 */

describe('Model Confidence API', () => {
  let mockHomey: any;
  let api: any;

  beforeEach(() => {
    // Mock Homey settings
    mockHomey = {
      app: {
        log: jest.fn(),
        error: jest.fn()
      },
      settings: {
        get: jest.fn((key: string) => {
          // Return mock data for testing
          if (key === 'thermal_model_characteristics') {
            return JSON.stringify({
              modelConfidence: 0.75,
              heatingRate: 1.2,
              coolingRate: 0.8,
              thermalMass: 0.65,
              lastUpdated: '2025-10-26T12:00:00Z'
            });
          }
          if (key === 'adaptive_business_parameters') {
            return JSON.stringify({
              learningCycles: 42,
              confidence: 0.7,
              lastUpdated: '2025-10-25T18:00:00Z'
            });
          }
          if (key === 'thermal_model_data') {
            return JSON.stringify([
              { timestamp: '2025-10-26T10:00:00Z', indoorTemperature: 20 },
              { timestamp: '2025-10-26T11:00:00Z', indoorTemperature: 21 }
            ]);
          }
          if (key === 'thermal_model_aggregated_data') {
            return JSON.stringify([
              { date: '2025-10-25', avgIndoorTemp: 20.5 }
            ]);
          }
          return null;
        })
      }
    };

    // Load the API module
    api = require('../api.js');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getModelConfidence endpoint', () => {
    it('should return model confidence data successfully', async () => {
      const result = await api.getModelConfidence({ homey: mockHomey });

      expect(result.success).toBe(true);
      expect(result.thermalModel).toBeDefined();
      expect(result.thermalModel.confidence).toBe(0.75);
      expect(result.thermalModel.heatingRate).toBe(1.2);
      expect(result.thermalModel.coolingRate).toBe(0.8);
      expect(result.thermalModel.thermalMass).toBe(0.65);
      expect(result.thermalModel.lastUpdated).toBe('2025-10-26T12:00:00Z');
      expect(result.smartSavingsDisplay).toBeDefined();
      expect(result.smartSavingsDisplay.today).toBeNull();
      expect(result.smartSavingsDisplay.last7).toBeNull();
      expect(result.smartSavingsDisplay.currency).toBeDefined();
    });

    it('should return adaptive parameters data', async () => {
      const result = await api.getModelConfidence({ homey: mockHomey });

      expect(result.success).toBe(true);
      expect(result.adaptiveParameters).toBeDefined();
      expect(result.adaptiveParameters.learningCycles).toBe(42);
      expect(result.adaptiveParameters.confidence).toBe(0.7);
      expect(result.adaptiveParameters.lastUpdated).toBe('2025-10-25T18:00:00Z');
    });

    it('should return data retention statistics', async () => {
      const result = await api.getModelConfidence({ homey: mockHomey });

      expect(result.success).toBe(true);
      expect(result.dataRetention).toBeDefined();
      expect(result.dataRetention.thermalRawPoints).toBe(2);
      expect(result.dataRetention.thermalAggPoints).toBe(1);
      expect(result.dataRetention.rawKB).toBeGreaterThan(0);
      expect(result.dataRetention.aggKB).toBeGreaterThan(0);
    });

    it('should handle missing thermal characteristics gracefully', async () => {
      mockHomey.settings.get = jest.fn((key: string) => {
        if (key === 'thermal_model_data') {
          return JSON.stringify([]);
        }
        return null;
      });

      const result = await api.getModelConfidence({ homey: mockHomey });

      expect(result.success).toBe(true);
      expect(result.thermalModel.confidence).toBeNull();
      expect(result.thermalModel.heatingRate).toBeNull();
      expect(result.thermalModel.coolingRate).toBeNull();
      expect(result.thermalModel.thermalMass).toBeNull();
      expect(result.thermalModel.lastUpdated).toBeNull();
    });

    it('should handle missing adaptive parameters gracefully', async () => {
      mockHomey.settings.get = jest.fn((key: string) => {
        if (key === 'thermal_model_characteristics') {
          return JSON.stringify({ modelConfidence: 0.5 });
        }
        return null;
      });

      const result = await api.getModelConfidence({ homey: mockHomey });

      expect(result.success).toBe(true);
      expect(result.adaptiveParameters.learningCycles).toBeNull();
      expect(result.adaptiveParameters.confidence).toBeNull();
    });

    it('should handle JSON parse errors gracefully', async () => {
      mockHomey.settings.get = jest.fn(() => 'invalid-json{');

      const result = await api.getModelConfidence({ homey: mockHomey });

      // Should still succeed but with null values
      expect(result.success).toBe(true);
      expect(result.thermalModel.confidence).toBeNull();
    });

    it('should calculate data size correctly', async () => {
      const largeData = JSON.stringify(Array(100).fill({ 
        timestamp: '2025-10-26T10:00:00Z', 
        indoorTemperature: 20 
      }));
      
      mockHomey.settings.get = jest.fn((key: string) => {
        if (key === 'thermal_model_data') {
          return largeData;
        }
        return null;
      });

      const result = await api.getModelConfidence({ homey: mockHomey });

      expect(result.success).toBe(true);
      expect(result.dataRetention.thermalRawPoints).toBe(100);
      expect(result.dataRetention.rawKB).toBeGreaterThan(0);
    });

    it('should not write to any settings', async () => {
      const setSpy = jest.fn();
      mockHomey.settings.set = setSpy;

      await api.getModelConfidence({ homey: mockHomey });

      // Ensure no set operations were called
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockHomey.settings.get = jest.fn(() => {
        throw new Error('Storage error');
      });

      const result = await api.getModelConfidence({ homey: mockHomey });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Storage error');
    });
  });
});

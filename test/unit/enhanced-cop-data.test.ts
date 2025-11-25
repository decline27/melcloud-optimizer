import { DailyCOPData, EnhancedCOPData, getCOPValue, isEnhancedCOPData } from '../../src/types/enhanced-cop-data';

const baseDaily: DailyCOPData = {
  TotalHeatingConsumed: 10,
  TotalHeatingProduced: 25,
  TotalHotWaterConsumed: 5,
  TotalHotWaterProduced: 12,
  TotalCoolingConsumed: 0,
  TotalCoolingProduced: 0,
  CoP: [],
  AverageHeatingCOP: 0,
  AverageHotWaterCOP: 0,
  heatingCOP: null,
  hotWaterCOP: null,
  coolingCOP: null,
  averageCOP: null,
  SampledDays: 1
};

describe('Enhanced COP data helpers', () => {
  describe('getCOPValue', () => {
    it('returns explicit COP when present', () => {
      const daily: DailyCOPData = { ...baseDaily, heatingCOP: 2.6, averageCOP: 1.9 };
      expect(getCOPValue(daily, 'heating', 0)).toBe(2.6);
    });

    it('falls back to average and legacy values', () => {
      const daily: DailyCOPData = { ...baseDaily, averageCOP: 2.2, AverageHotWaterCOP: 3.1, hotWaterCOP: undefined };
      expect(getCOPValue(daily, 'hotWater', 0)).toBe(2.2);

      const legacyDaily: DailyCOPData = { ...baseDaily, AverageHeatingCOP: 3.4 };
      expect(getCOPValue(legacyDaily, 'heating', 1.2)).toBe(3.4);
    });

    it('uses fallback when no COP values are available', () => {
      const daily: DailyCOPData = { ...baseDaily, heatingCOP: null, averageCOP: null, AverageHeatingCOP: null };
      expect(getCOPValue(daily, 'heating', 1.5)).toBe(1.5);
    });
  });

  describe('isEnhancedCOPData', () => {
    it('accepts a valid enhanced COP structure', () => {
      const sample: EnhancedCOPData = {
        current: { heating: 2.5, hotWater: 2.8, outdoor: 5, timestamp: new Date() },
        daily: { ...baseDaily, heatingCOP: 2.3, hotWaterCOP: 2.1 },
        historical: { heating: 2.1, hotWater: 2.0 },
        trends: { heatingTrend: 'stable', hotWaterTrend: 'improving', averageHeating: 2.2, averageHotWater: 2.1 },
        predictions: { nextHourHeating: 2.4, nextHourHotWater: 2.2, confidenceLevel: 0.6 }
      };

      expect(isEnhancedCOPData(sample)).toBe(true);
    });

    it('rejects incomplete structures', () => {
      expect(isEnhancedCOPData({})).toBe(false);
      expect(isEnhancedCOPData({ current: {}, daily: {} })).toBe(false);
    });
  });
});

import { ServiceBase } from './base/service-base';
import { ConfigurationService, OptimizationConfig } from './configuration-service';
import { HomeyLogger } from '../util/logger';

// Import the existing COP helper
const { COPHelper } = require('../../services/cop-helper');

export interface COPCalculationData {
  temperature: number;
  outdoorTemp?: number;
  operationMode: 'heating' | 'cooling' | 'hotwater';
  seasonalMode: 'winter' | 'summer' | 'transition';
}

export interface COPResult {
  cop: number;
  normalizedCOP: number;
  efficiency: number;
  confidence: number;
  factors: {
    temperature: number;
    seasonal: number;
    weather: number;
  };
}

export interface COPRange {
  min: number;
  max: number;
  average: number;
  samples: number;
}

export interface COPHistoricalData {
  heating: {
    daily: number;
    weekly: number;
    monthly: number;
    snapshots: Array<{
      timestamp: string;
      cop: number;
      produced: number;
      consumed: number;
    }>;
  };
  hotWater: {
    daily: number;
    weekly: number;
    monthly: number;
    snapshots: Array<{
      timestamp: string;
      cop: number;
      produced: number;
      consumed: number;
    }>;
  };
  seasonal: {
    isSummer: boolean;
    currentCOP: number;
  };
  weeklyTrend: Array<{
    timestamp: string;
    heatingCOP: number;
    hotWaterCOP: number;
  }>;
}

export class COPCalculationService extends ServiceBase {
  private copHelper: any = null;
  private homey: any;
  private copRange: COPRange = { min: 2.0, max: 6.0, average: 3.5, samples: 0 };
  private config: OptimizationConfig | null = null;

  constructor(
    homey: any,
    private configService: ConfigurationService,
    logger: HomeyLogger
  ) {
    super(logger);
    this.homey = homey;
    this.initializeCOPHelper();
  }

  private async initializeCOPHelper(): Promise<void> {
    try {
      this.config = await this.configService.getConfig('optimization');
      
      // Initialize the existing COP helper
      this.copHelper = new COPHelper(this.homey, this.logger);
      
      // Initialize COP range from historical data
      await this.initializeCOPRangeFromHistory();
      
      this.logInfo('COP calculation service initialized', {
        weight: this.config.cop.weight,
        autoSeasonal: this.config.cop.autoSeasonal,
        copRange: this.copRange
      });
    } catch (error) {
      this.logError(error as Error, { context: 'COPHelper initialization' });
      throw this.createServiceError(
        'Failed to initialize COP calculation service',
        'COP_INIT_ERROR',
        true
      );
    }
  }

  async calculateCOP(data: COPCalculationData): Promise<COPResult> {
    if (!this.copHelper || !this.config) {
      await this.initializeCOPHelper();
    }

    return this.executeWithRetry(async () => {
      // Get base COP from historical data or calculate based on operation mode
      const baseCOP = await this.getBaseCOP(data.operationMode);

      // Apply temperature factor
      const temperatureFactor = this.getTemperatureFactor(data.temperature, data.operationMode);
      
      // Apply seasonal factor
      const seasonalFactor = this.getSeasonalFactor(data.seasonalMode);
      
      // Apply weather factor
      const weatherFactor = this.getWeatherFactor(data.outdoorTemp);

      // Calculate adjusted COP
      const adjustedCOP = baseCOP * temperatureFactor * seasonalFactor * weatherFactor;

      // Normalize COP
      const normalizedCOP = this.normalizeCOP(adjustedCOP);
      
      // Calculate efficiency percentage
      const efficiency = this.calculateEfficiency(normalizedCOP);
      
      // Calculate confidence based on available data
      const confidence = this.calculateConfidence(data);

      // Update COP range for future normalizations
      this.updateCOPRange(adjustedCOP);

      return {
        cop: Math.round(adjustedCOP * 100) / 100,
        normalizedCOP: Math.round(normalizedCOP * 100) / 100,
        efficiency,
        confidence: Math.round(confidence * 100) / 100,
        factors: {
          temperature: Math.round(temperatureFactor * 100) / 100,
          seasonal: Math.round(seasonalFactor * 100) / 100,
          weather: Math.round(weatherFactor * 100) / 100
        }
      };
    });
  }

  private async getBaseCOP(operationMode: string): Promise<number> {
    try {
      if (!this.copHelper) {
        // Fallback default values
        return operationMode === 'hotwater' ? 3.0 : 3.5;
      }

      if (operationMode === 'hotwater') {
        const hotWaterCOP = await this.copHelper.getAverageCOP('daily', 'water');
        return hotWaterCOP > 0 ? hotWaterCOP : 3.0; // Default fallback
      } else {
        const heatingCOP = await this.copHelper.getAverageCOP('daily', 'heat');
        return heatingCOP > 0 ? heatingCOP : 3.5; // Default fallback
      }
    } catch (error) {
      this.logError(error as Error, { operationMode });
      // Return sensible defaults based on operation mode
      return operationMode === 'hotwater' ? 3.0 : 3.5;
    }
  }

  private normalizeCOP(cop: number): number {
    if (this.copRange.samples === 0) {
      return 0.5; // Default normalized value when no data
    }

    const range = this.copRange.max - this.copRange.min;
    if (range === 0) {
      return 0.5;
    }

    const normalized = (cop - this.copRange.min) / range;
    return Math.max(0, Math.min(1, normalized));
  }

  private updateCOPRange(cop: number): void {
    if (this.copRange.samples === 0) {
      this.copRange.min = cop;
      this.copRange.max = cop;
      this.copRange.average = cop;
    } else {
      this.copRange.min = Math.min(this.copRange.min, cop);
      this.copRange.max = Math.max(this.copRange.max, cop);
      this.copRange.average = (this.copRange.average * this.copRange.samples + cop) / (this.copRange.samples + 1);
    }
    
    this.copRange.samples++;

    // Log significant changes
    if (this.copRange.samples % 100 === 0) {
      this.logDebug('COP range updated', {
        range: this.copRange,
        latestCOP: cop
      });
    }
  }

  private calculateEfficiency(normalizedCOP: number): number {
    // Convert normalized COP to efficiency percentage
    return Math.round(normalizedCOP * 100);
  }

  private calculateConfidence(data: COPCalculationData): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence with more data points
    if (this.copRange.samples > 10) confidence += 0.1;
    if (this.copRange.samples > 50) confidence += 0.1;
    if (this.copRange.samples > 100) confidence += 0.1;

    // Outdoor temperature data increases confidence
    if (data.outdoorTemp !== undefined) confidence += 0.1;

    // Seasonal mode alignment increases confidence
    if (this.config?.cop.autoSeasonal) confidence += 0.1;

    return Math.min(1.0, confidence);
  }

  private getTemperatureFactor(temperature: number, operationMode: string): number {
    // Optimal temperature ranges by operation mode
    let optimal: number;
    let range: number;

    switch (operationMode) {
      case 'heating':
        optimal = 21; // Optimal heating temperature
        range = 10;   // ±10°C range
        break;
      case 'cooling':
        optimal = 23; // Optimal cooling temperature
        range = 8;    // ±8°C range
        break;
      case 'hotwater':
        optimal = 50; // Optimal hot water temperature
        range = 15;   // ±15°C range
        break;
      default:
        optimal = 21;
        range = 10;
    }

    const deviation = Math.abs(temperature - optimal);
    return Math.max(0.5, 1 - (deviation / range));
  }

  private getSeasonalFactor(seasonalMode: string): number {
    if (!this.config?.cop.autoSeasonal) {
      return 1.0; // No seasonal adjustment if disabled
    }

    const now = new Date();
    const month = now.getMonth();
    
    switch (seasonalMode) {
      case 'winter':
        return (month >= 10 || month <= 2) ? 1.0 : 0.7;
      case 'summer':
        return (month >= 5 && month <= 8) ? 1.0 : 0.7;
      case 'transition':
        return (month >= 3 && month <= 4) || (month === 9) ? 1.0 : 0.8;
      default:
        return 0.8;
    }
  }

  private getWeatherFactor(outdoorTemp?: number): number {
    if (outdoorTemp === undefined) return 0.8;
    
    // Ideal outdoor temperature for heat pump efficiency
    if (outdoorTemp >= 5 && outdoorTemp <= 15) return 1.0;
    if (outdoorTemp >= 0 && outdoorTemp <= 20) return 0.9;
    if (outdoorTemp >= -5 && outdoorTemp <= 25) return 0.8;
    return 0.7;
  }

  private async initializeCOPRangeFromHistory(): Promise<void> {
    try {
      if (!this.copHelper) return;

      // Get historical COP data to initialize range
      const historicalData = await this.copHelper.getCOPData();
      
      if (historicalData && !historicalData.error) {
        const heatingSnapshots = historicalData.heating?.snapshots || [];
        const hotWaterSnapshots = historicalData.hotWater?.snapshots || [];
        
        const allCOPs = [
          ...heatingSnapshots.map((s: any) => s.cop),
          ...hotWaterSnapshots.map((s: any) => s.cop)
        ].filter(cop => cop > 0 && cop < 10); // Filter reasonable COP values

        if (allCOPs.length > 0) {
          this.copRange.min = Math.min(...allCOPs);
          this.copRange.max = Math.max(...allCOPs);
          this.copRange.average = allCOPs.reduce((sum, cop) => sum + cop, 0) / allCOPs.length;
          this.copRange.samples = allCOPs.length;

          this.logInfo('COP range initialized from historical data', {
            range: this.copRange,
            dataPoints: allCOPs.length
          });
        }
      }
    } catch (error) {
      this.logError(error as Error, { context: 'COP range initialization' });
      // Continue with default values if historical data fails
    }
  }

  async reconfigureCOP(newConfig: Partial<OptimizationConfig>): Promise<void> {
    try {
      await this.configService.updateConfig('optimization', newConfig);
      this.config = await this.configService.getConfig('optimization');
      
      this.logInfo('COP calculation service reconfigured', { newConfig });
    } catch (error) {
      this.logError(error as Error, { newConfig });
      throw this.createServiceError(
        'Failed to reconfigure COP calculation service',
        'COP_RECONFIG_ERROR',
        true
      );
    }
  }

  async getHistoricalCOPData(): Promise<COPHistoricalData | null> {
    if (!this.copHelper) {
      await this.initializeCOPHelper();
    }

    try {
      const data = await this.copHelper.getCOPData();
      
      if (data && !data.error) {
        return data as COPHistoricalData;
      } else {
        this.logWarn('Error getting historical COP data', { error: data?.error });
        return null;
      }
    } catch (error) {
      this.logError(error as Error, { context: 'historical COP data retrieval' });
      return null;
    }
  }

  async getCurrentSeasonalCOP(): Promise<number> {
    if (!this.copHelper) {
      await this.initializeCOPHelper();
    }

    try {
      const seasonalCOP = await this.copHelper.getSeasonalCOP();
      return seasonalCOP || 3.0; // Fallback default
    } catch (error) {
      this.logError(error as Error, { context: 'seasonal COP retrieval' });
      return 3.0; // Fallback default
    }
  }

  async getLatestCOPValues(): Promise<{ heating: number; hotWater: number }> {
    if (!this.copHelper) {
      await this.initializeCOPHelper();
    }

    try {
      const latest = await this.copHelper.getLatestCOP();
      return latest || { heating: 0, hotWater: 0 };
    } catch (error) {
      this.logError(error as Error, { context: 'latest COP values retrieval' });
      return { heating: 0, hotWater: 0 };
    }
  }

  getCOPRange(): COPRange {
    return { ...this.copRange };
  }

  getStatistics(): Record<string, any> {
    return {
      copRange: this.copRange,
      helperInitialized: this.copHelper !== null,
      configLoaded: this.config !== null,
      weight: this.config?.cop.weight,
      autoSeasonal: this.config?.cop.autoSeasonal
    };
  }

  isSummerSeason(): boolean {
    if (this.copHelper) {
      return this.copHelper.isSummerSeason();
    }
    
    // Fallback implementation
    const month = new Date().getMonth();
    return month >= 4 && month <= 8;
  }

  async triggerCOPCalculation(timeframe: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    if (!this.copHelper) {
      await this.initializeCOPHelper();
    }

    try {
      await this.copHelper.compute(timeframe);
      this.logInfo(`${timeframe} COP calculation triggered successfully`);
    } catch (error) {
      this.logError(error as Error, { timeframe });
      throw this.createServiceError(
        `Failed to trigger ${timeframe} COP calculation`,
        'COP_CALCULATION_ERROR',
        true
      );
    }
  }
}

import { ServiceBase } from './base/service-base';
import { HomeyLogger } from '../util/logger';

export interface MelCloudConfig {
  username: string;
  password: string;
  language: number;
  appVersion: string;
}

export interface TibberConfig {
  apiKey: string;
  homeId?: string;
  enabled: boolean;
}

export interface OptimizationConfig {
  temperature: {
    min: number;
    max: number;
    step: number;
    deadband: number;
  };
  cop: {
    weight: number;
    autoSeasonal: boolean;
  };
  thermalModel: {
    K: number;
    useLearning: boolean;
  };
}

export interface ThermalConfig {
  thermalMass: {
    capacity: number;
    conductance: number;
    timeConstant: number;
  };
  strategy: {
    preheatingWindow: number;
    coastingThreshold: number;
    boostDuration: number;
  };
}

export interface HotWaterConfig {
  scheduling: {
    enabled: boolean;
    smartMode: boolean;
    minTemperature: number;
    maxTemperature: number;
  };
  usage: {
    learnPattern: boolean;
    defaultPeaks: string[];
    efficiency: number;
  };
}

export interface DataCollectionConfig {
  enabled: boolean;
  collectionInterval: number; // minutes
  memoryMonitoring: {
    enabled: boolean;
    warningThreshold: number; // MB
    criticalThreshold: number; // MB
    interval: number; // minutes
  };
  dataRetention: {
    maxDataPoints: number;
    maxAge: number; // days
    cleanupInterval: number; // hours
  };
  analytics: {
    enabled: boolean;
    aggregationInterval: number; // hours
    historicalDataPoints: number;
  };
  performance: {
    trackDeviceCommands: boolean;
    trackOptimizations: boolean;
    trackErrors: boolean;
    maxHistoryEntries: number;
  };
}

export interface AppConfiguration {
  melcloud: MelCloudConfig;
  tibber: TibberConfig;
  optimization: OptimizationConfig;
  thermal: ThermalConfig;
  hotWater: HotWaterConfig;
  dataCollection: DataCollectionConfig;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigurationService extends ServiceBase {
  private homey: any;
  private configCache: Partial<AppConfiguration> = {};
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private lastCacheUpdate = 0;

  constructor(homey: any, logger: HomeyLogger) {
    super(logger);
    this.homey = homey;
  }

  async getConfig<T extends keyof AppConfiguration>(
    section: T
  ): Promise<AppConfiguration[T]> {
    await this.refreshCacheIfNeeded();
    
    if (!this.configCache[section]) {
      await this.loadConfigSection(section);
    }
    
    return this.configCache[section] as AppConfiguration[T];
  }

  async updateConfig<T extends keyof AppConfiguration>(
    section: T,
    config: Partial<AppConfiguration[T]>
  ): Promise<void> {
    const currentConfig = await this.getConfig(section);
    const newConfig = { ...currentConfig, ...config };
    
    const validation = this.validateConfigSection(section, newConfig);
    if (!validation.isValid) {
      throw this.createServiceError(
        `Configuration validation failed: ${validation.errors.join(', ')}`,
        'CONFIG_VALIDATION_ERROR',
        false,
        { section, errors: validation.errors }
      );
    }

    await this.saveConfigSection(section, newConfig);
    this.configCache[section] = newConfig;
    
    this.logInfo(`Configuration updated for section: ${section}`);
  }

  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.cacheTimeout) {
      this.configCache = {};
      this.lastCacheUpdate = now;
    }
  }

  private async loadConfigSection<T extends keyof AppConfiguration>(
    section: T
  ): Promise<void> {
    try {
      switch (section) {
        case 'optimization':
          this.configCache.optimization = {
            temperature: {
              min: this.homey.settings.get('min_temp') || 18,
              max: this.homey.settings.get('max_temp') || 22,
              step: this.homey.settings.get('temp_step') || 0.5,
              deadband: this.homey.settings.get('deadband') || 0.3,
            },
            cop: {
              weight: this.homey.settings.get('cop_weight') || 0.3,
              autoSeasonal: this.homey.settings.get('auto_seasonal_mode') ?? true,
            },
            thermalModel: {
              K: this.homey.settings.get('thermal_k') || 0.5,
              useLearning: this.homey.settings.get('use_thermal_learning') ?? false,
            },
          };
          break;

        case 'melcloud':
          this.configCache.melcloud = {
            username: this.homey.settings.get('melcloud_username') || '',
            password: this.homey.settings.get('melcloud_password') || '',
            language: this.homey.settings.get('melcloud_language') || 0,
            appVersion: this.homey.settings.get('melcloud_app_version') || '1.30.3.0',
          };
          break;

        case 'tibber':
          this.configCache.tibber = {
            apiKey: this.homey.settings.get('tibber_api_key') || '',
            homeId: this.homey.settings.get('tibber_home_id'),
            enabled: this.homey.settings.get('tibber_enabled') ?? false,
          };
          break;

        case 'thermal':
          this.configCache.thermal = {
            thermalMass: {
              capacity: this.homey.settings.get('thermal_capacity') || 50,
              conductance: this.homey.settings.get('thermal_conductance') || 2.5,
              timeConstant: this.homey.settings.get('thermal_time_constant') || 8,
            },
            strategy: {
              preheatingWindow: this.homey.settings.get('preheating_window') || 2,
              coastingThreshold: this.homey.settings.get('coasting_threshold') || 0.8,
              boostDuration: this.homey.settings.get('boost_duration') || 30,
            },
          };
          break;

        case 'hotWater':
          this.configCache.hotWater = {
            scheduling: {
              enabled: this.homey.settings.get('hotwater_scheduling') ?? true,
              smartMode: this.homey.settings.get('hotwater_smart_mode') ?? true,
              minTemperature: this.homey.settings.get('hotwater_min_temp') || 40,
              maxTemperature: this.homey.settings.get('hotwater_max_temp') || 60,
            },
            usage: {
              learnPattern: this.homey.settings.get('hotwater_learn_pattern') ?? true,
              defaultPeaks: this.homey.settings.get('hotwater_default_peaks') || ['07:00', '19:00'],
              efficiency: this.homey.settings.get('hotwater_efficiency') || 0.85,
            },
          };
          break;

        case 'dataCollection':
          this.configCache.dataCollection = {
            enabled: this.homey.settings.get('data_collection_enabled') ?? true,
            collectionInterval: this.homey.settings.get('data_collection_interval') || 15,
            memoryMonitoring: {
              enabled: this.homey.settings.get('memory_monitoring_enabled') ?? true,
              warningThreshold: this.homey.settings.get('memory_warning_threshold') || 100,
              criticalThreshold: this.homey.settings.get('memory_critical_threshold') || 200,
              interval: this.homey.settings.get('memory_monitoring_interval') || 60,
            },
            dataRetention: {
              maxDataPoints: this.homey.settings.get('data_retention_max_points') || 10000,
              maxAge: this.homey.settings.get('data_retention_max_age') || 7,
              cleanupInterval: this.homey.settings.get('data_retention_cleanup_interval') || 4,
            },
            analytics: {
              enabled: this.homey.settings.get('analytics_enabled') ?? true,
              aggregationInterval: this.homey.settings.get('analytics_aggregation_interval') || 1,
              historicalDataPoints: this.homey.settings.get('analytics_historical_points') || 1000,
            },
            performance: {
              trackDeviceCommands: this.homey.settings.get('track_device_commands') ?? true,
              trackOptimizations: this.homey.settings.get('track_optimizations') ?? true,
              trackErrors: this.homey.settings.get('track_errors') ?? true,
              maxHistoryEntries: this.homey.settings.get('max_history_entries') || 500,
            },
          };
          break;

        default:
          throw this.createServiceError(
            `Unknown configuration section: ${section}`,
            'UNKNOWN_CONFIG_SECTION',
            false
          );
      }
    } catch (error) {
      this.logError(error as Error, { section });
      throw this.createServiceError(
        `Failed to load configuration section: ${section}`,
        'CONFIG_LOAD_ERROR',
        true,
        { section, originalError: (error as Error).message }
      );
    }
  }

  private async saveConfigSection<T extends keyof AppConfiguration>(
    section: T,
    config: AppConfiguration[T]
  ): Promise<void> {
    try {
      switch (section) {
        case 'optimization':
          const optConfig = config as OptimizationConfig;
          this.homey.settings.set('min_temp', optConfig.temperature.min);
          this.homey.settings.set('max_temp', optConfig.temperature.max);
          this.homey.settings.set('temp_step', optConfig.temperature.step);
          this.homey.settings.set('deadband', optConfig.temperature.deadband);
          this.homey.settings.set('cop_weight', optConfig.cop.weight);
          this.homey.settings.set('auto_seasonal_mode', optConfig.cop.autoSeasonal);
          this.homey.settings.set('thermal_k', optConfig.thermalModel.K);
          this.homey.settings.set('use_thermal_learning', optConfig.thermalModel.useLearning);
          break;

        case 'melcloud':
          const melConfig = config as MelCloudConfig;
          this.homey.settings.set('melcloud_username', melConfig.username);
          this.homey.settings.set('melcloud_password', melConfig.password);
          this.homey.settings.set('melcloud_language', melConfig.language);
          this.homey.settings.set('melcloud_app_version', melConfig.appVersion);
          break;

        case 'tibber':
          const tibberConfig = config as TibberConfig;
          this.homey.settings.set('tibber_api_key', tibberConfig.apiKey);
          this.homey.settings.set('tibber_home_id', tibberConfig.homeId);
          this.homey.settings.set('tibber_enabled', tibberConfig.enabled);
          break;

        case 'thermal':
          const thermalConfig = config as ThermalConfig;
          this.homey.settings.set('thermal_capacity', thermalConfig.thermalMass.capacity);
          this.homey.settings.set('thermal_conductance', thermalConfig.thermalMass.conductance);
          this.homey.settings.set('thermal_time_constant', thermalConfig.thermalMass.timeConstant);
          this.homey.settings.set('preheating_window', thermalConfig.strategy.preheatingWindow);
          this.homey.settings.set('coasting_threshold', thermalConfig.strategy.coastingThreshold);
          this.homey.settings.set('boost_duration', thermalConfig.strategy.boostDuration);
          break;

        case 'hotWater':
          const hotWaterConfig = config as HotWaterConfig;
          this.homey.settings.set('hotwater_scheduling', hotWaterConfig.scheduling.enabled);
          this.homey.settings.set('hotwater_smart_mode', hotWaterConfig.scheduling.smartMode);
          this.homey.settings.set('hotwater_min_temp', hotWaterConfig.scheduling.minTemperature);
          this.homey.settings.set('hotwater_max_temp', hotWaterConfig.scheduling.maxTemperature);
          this.homey.settings.set('hotwater_learn_pattern', hotWaterConfig.usage.learnPattern);
          this.homey.settings.set('hotwater_default_peaks', hotWaterConfig.usage.defaultPeaks);
          this.homey.settings.set('hotwater_efficiency', hotWaterConfig.usage.efficiency);
          break;

        case 'dataCollection':
          const dataCollectionConfig = config as DataCollectionConfig;
          this.homey.settings.set('data_collection_enabled', dataCollectionConfig.enabled);
          this.homey.settings.set('data_collection_interval', dataCollectionConfig.collectionInterval);
          this.homey.settings.set('memory_monitoring_enabled', dataCollectionConfig.memoryMonitoring.enabled);
          this.homey.settings.set('memory_warning_threshold', dataCollectionConfig.memoryMonitoring.warningThreshold);
          this.homey.settings.set('memory_critical_threshold', dataCollectionConfig.memoryMonitoring.criticalThreshold);
          this.homey.settings.set('memory_monitoring_interval', dataCollectionConfig.memoryMonitoring.interval);
          this.homey.settings.set('data_retention_max_points', dataCollectionConfig.dataRetention.maxDataPoints);
          this.homey.settings.set('data_retention_max_age', dataCollectionConfig.dataRetention.maxAge);
          this.homey.settings.set('data_retention_cleanup_interval', dataCollectionConfig.dataRetention.cleanupInterval);
          this.homey.settings.set('analytics_enabled', dataCollectionConfig.analytics.enabled);
          this.homey.settings.set('analytics_aggregation_interval', dataCollectionConfig.analytics.aggregationInterval);
          this.homey.settings.set('analytics_historical_points', dataCollectionConfig.analytics.historicalDataPoints);
          this.homey.settings.set('track_device_commands', dataCollectionConfig.performance.trackDeviceCommands);
          this.homey.settings.set('track_optimizations', dataCollectionConfig.performance.trackOptimizations);
          this.homey.settings.set('track_errors', dataCollectionConfig.performance.trackErrors);
          this.homey.settings.set('max_history_entries', dataCollectionConfig.performance.maxHistoryEntries);
          break;

        default:
          throw this.createServiceError(
            `Saving not implemented for section: ${section}`,
            'SAVE_NOT_IMPLEMENTED',
            false
          );
      }
    } catch (error) {
      this.logError(error as Error, { section });
      throw this.createServiceError(
        `Failed to save configuration section: ${section}`,
        'CONFIG_SAVE_ERROR',
        true
      );
    }
  }

  private validateConfigSection<T extends keyof AppConfiguration>(
    section: T,
    config: AppConfiguration[T]
  ): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      switch (section) {
        case 'optimization':
          const optConfig = config as OptimizationConfig;
          
          if (optConfig.temperature.min < 5 || optConfig.temperature.min > 30) {
            result.errors.push('Min temperature must be between 5-30°C');
          }
          
          if (optConfig.temperature.max < 15 || optConfig.temperature.max > 35) {
            result.errors.push('Max temperature must be between 15-35°C');
          }
          
          if (optConfig.temperature.min >= optConfig.temperature.max) {
            result.errors.push('Min temperature must be less than max temperature');
          }
          
          if (optConfig.cop.weight < 0 || optConfig.cop.weight > 1) {
            result.errors.push('COP weight must be between 0-1');
          }
          
          if (optConfig.temperature.step < 0.1 || optConfig.temperature.step > 2.0) {
            result.warnings.push('Temperature step should typically be between 0.1-2.0°C');
          }
          
          break;

        case 'melcloud':
          const melConfig = config as MelCloudConfig;
          
          if (!melConfig.username || melConfig.username.trim().length === 0) {
            result.errors.push('MELCloud username is required');
          }
          
          if (!melConfig.password || melConfig.password.trim().length === 0) {
            result.errors.push('MELCloud password is required');
          }
          
          if (melConfig.language < 0 || melConfig.language > 20) {
            result.warnings.push('MELCloud language should be a valid language code');
          }
          
          break;

        case 'tibber':
          const tibberConfig = config as TibberConfig;
          
          if (tibberConfig.enabled && (!tibberConfig.apiKey || tibberConfig.apiKey.trim().length === 0)) {
            result.errors.push('Tibber API key is required when Tibber is enabled');
          }
          
          break;

        case 'thermal':
          const thermalConfig = config as ThermalConfig;
          
          if (thermalConfig.thermalMass.capacity < 10 || thermalConfig.thermalMass.capacity > 200) {
            result.errors.push('Thermal mass capacity must be between 10-200');
          }
          
          if (thermalConfig.thermalMass.conductance < 0.5 || thermalConfig.thermalMass.conductance > 10) {
            result.errors.push('Thermal conductance must be between 0.5-10');
          }
          
          if (thermalConfig.thermalMass.timeConstant < 1 || thermalConfig.thermalMass.timeConstant > 24) {
            result.errors.push('Thermal time constant must be between 1-24 hours');
          }
          
          if (thermalConfig.strategy.preheatingWindow < 0.5 || thermalConfig.strategy.preheatingWindow > 6) {
            result.warnings.push('Preheating window should typically be between 0.5-6 hours');
          }
          
          break;

        case 'hotWater':
          const hotWaterConfig = config as HotWaterConfig;
          
          if (hotWaterConfig.scheduling.minTemperature < 30 || hotWaterConfig.scheduling.minTemperature > 50) {
            result.errors.push('Hot water minimum temperature must be between 30-50°C');
          }
          
          if (hotWaterConfig.scheduling.maxTemperature < 50 || hotWaterConfig.scheduling.maxTemperature > 80) {
            result.errors.push('Hot water maximum temperature must be between 50-80°C');
          }
          
          if (hotWaterConfig.scheduling.minTemperature >= hotWaterConfig.scheduling.maxTemperature) {
            result.errors.push('Hot water minimum temperature must be less than maximum temperature');
          }
          
          if (hotWaterConfig.usage.efficiency < 0.5 || hotWaterConfig.usage.efficiency > 1.0) {
            result.errors.push('Hot water efficiency must be between 0.5-1.0');
          }
          
          if (!Array.isArray(hotWaterConfig.usage.defaultPeaks) || hotWaterConfig.usage.defaultPeaks.length === 0) {
            result.warnings.push('At least one default peak time should be configured');
          }
          
          break;

        case 'dataCollection':
          const dataCollectionConfig = config as DataCollectionConfig;
          
          if (dataCollectionConfig.collectionInterval < 1 || dataCollectionConfig.collectionInterval > 1440) {
            result.errors.push('Data collection interval must be between 1-1440 minutes');
          }
          
          if (dataCollectionConfig.memoryMonitoring.warningThreshold < 50 || dataCollectionConfig.memoryMonitoring.warningThreshold > 1000) {
            result.errors.push('Memory warning threshold must be between 50-1000 MB');
          }
          
          if (dataCollectionConfig.memoryMonitoring.criticalThreshold <= dataCollectionConfig.memoryMonitoring.warningThreshold) {
            result.errors.push('Memory critical threshold must be higher than warning threshold');
          }
          
          if (dataCollectionConfig.memoryMonitoring.interval < 5 || dataCollectionConfig.memoryMonitoring.interval > 1440) {
            result.errors.push('Memory monitoring interval must be between 5-1440 minutes');
          }
          
          if (dataCollectionConfig.dataRetention.maxDataPoints < 100 || dataCollectionConfig.dataRetention.maxDataPoints > 100000) {
            result.errors.push('Maximum data points must be between 100-100000');
          }
          
          if (dataCollectionConfig.dataRetention.maxAge < 1 || dataCollectionConfig.dataRetention.maxAge > 365) {
            result.errors.push('Data retention max age must be between 1-365 days');
          }
          
          if (dataCollectionConfig.dataRetention.cleanupInterval < 1 || dataCollectionConfig.dataRetention.cleanupInterval > 168) {
            result.errors.push('Data cleanup interval must be between 1-168 hours');
          }
          
          if (dataCollectionConfig.analytics.aggregationInterval < 1 || dataCollectionConfig.analytics.aggregationInterval > 168) {
            result.warnings.push('Analytics aggregation interval should typically be between 1-168 hours');
          }
          
          if (dataCollectionConfig.analytics.historicalDataPoints < 100 || dataCollectionConfig.analytics.historicalDataPoints > 10000) {
            result.warnings.push('Historical data points should typically be between 100-10000');
          }
          
          if (dataCollectionConfig.performance.maxHistoryEntries < 50 || dataCollectionConfig.performance.maxHistoryEntries > 5000) {
            result.warnings.push('Performance history entries should typically be between 50-5000');
          }
          
          break;
      }
    } catch (error) {
      result.errors.push(`Validation error: ${(error as Error).message}`);
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  async getAllConfigurations(): Promise<AppConfiguration> {
    const config = {} as AppConfiguration;
    
    config.melcloud = await this.getConfig('melcloud');
    config.tibber = await this.getConfig('tibber');
    config.optimization = await this.getConfig('optimization');
    config.thermal = await this.getConfig('thermal');
    config.hotWater = await this.getConfig('hotWater');
    config.dataCollection = await this.getConfig('dataCollection');
    
    return config;
  }

  async validateAllConfigurations(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      const allConfigs = await this.getAllConfigurations();
      
      for (const [section, config] of Object.entries(allConfigs)) {
        const sectionResult = this.validateConfigSection(section as keyof AppConfiguration, config);
        result.errors.push(...sectionResult.errors.map(e => `${section}: ${e}`));
        result.warnings.push(...sectionResult.warnings.map(w => `${section}: ${w}`));
      }
      
      result.isValid = result.errors.length === 0;
    } catch (error) {
      result.errors.push(`Configuration validation failed: ${(error as Error).message}`);
      result.isValid = false;
    }

    return result;
  }

  async resetConfigSection<T extends keyof AppConfiguration>(section: T): Promise<void> {
    try {
      // Clear from cache
      delete this.configCache[section];
      
      // Load defaults (this will trigger the default values in loadConfigSection)
      await this.loadConfigSection(section);
      
      this.logInfo(`Configuration section reset to defaults: ${section}`);
    } catch (error) {
      this.logError(error as Error, { section });
      throw this.createServiceError(
        `Failed to reset configuration section: ${section}`,
        'CONFIG_RESET_ERROR',
        true
      );
    }
  }

  clearCache(): void {
    this.configCache = {};
    this.lastCacheUpdate = 0;
    this.logDebug('Configuration cache cleared');
  }

  getConfigurationStatus(): Record<string, any> {
    return {
      cacheSize: Object.keys(this.configCache).length,
      lastUpdate: new Date(this.lastCacheUpdate).toISOString(),
      cacheTimeout: this.cacheTimeout,
      cachedSections: Object.keys(this.configCache)
    };
  }

  /**
   * Get data collection configuration
   */
  async getDataCollectionConfig(): Promise<DataCollectionConfig> {
    return await this.getConfig('dataCollection');
  }

  /**
   * Update data collection configuration
   */
  async updateDataCollectionConfig(config: Partial<DataCollectionConfig>): Promise<void> {
    return await this.updateConfig('dataCollection', config);
  }
}

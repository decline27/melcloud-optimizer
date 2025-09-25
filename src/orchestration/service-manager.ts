import WeatherApi from '../../weather';
import { MelCloudApi } from '../services/melcloud-api';
import { TibberApi } from '../services/tibber-api';
import { Optimizer } from '../services/optimizer';
import { COPHelper } from '../services/cop-helper';

export interface HomeyLikeSettings {
  get(key: string): any;
  set(key: string, value: any): void | Promise<void>;
}

export interface HomeyLoggerLike {
  log(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn?(message: string, ...args: any[]): void;
}

export interface HomeyLike {
  settings: HomeyLikeSettings;
  app: HomeyLoggerLike;
  hotWaterService?: unknown;
}

export interface HistoricalData {
  optimizations: any[];
  lastCalibration: any;
}

export interface ServiceState {
  melCloud: MelCloudApi | null;
  tibber: TibberApi | null;
  optimizer: Optimizer | null;
  weather: WeatherApi | null;
  historicalData: HistoricalData;
}

const createEmptyHistoricalData = (): HistoricalData => ({
  optimizations: [],
  lastCalibration: null
});

const serviceState: ServiceState = {
  melCloud: null,
  tibber: null,
  optimizer: null,
  weather: null,
  historicalData: createEmptyHistoricalData()
};

export function getServiceState(): ServiceState {
  return serviceState;
}

export function resetServiceState(): void {
  serviceState.melCloud = null;
  serviceState.tibber = null;
  serviceState.optimizer = null;
  serviceState.weather = null;
  serviceState.historicalData = createEmptyHistoricalData();
}

export function applyServiceOverrides(overrides: Partial<ServiceState>): void {
  if (Object.prototype.hasOwnProperty.call(overrides, 'melCloud')) {
    serviceState.melCloud = overrides.melCloud ?? null;
    (global as any).melCloud = serviceState.melCloud;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'tibber')) {
    serviceState.tibber = overrides.tibber ?? null;
    (global as any).tibber = serviceState.tibber;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'optimizer')) {
    serviceState.optimizer = overrides.optimizer ?? null;
    (global as any).optimizer = serviceState.optimizer;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'weather')) {
    serviceState.weather = overrides.weather ?? null;
  }
  if (overrides.historicalData) {
    serviceState.historicalData = overrides.historicalData;
  }
}

export function setHistoricalData(data: HistoricalData): void {
  serviceState.historicalData = data;
}

export function getServiceStateSnapshot(): ServiceState {
  return {
    melCloud: serviceState.melCloud,
    tibber: serviceState.tibber,
    optimizer: serviceState.optimizer,
    weather: serviceState.weather,
    historicalData: {
      optimizations: Array.isArray(serviceState.historicalData.optimizations)
        ? [...serviceState.historicalData.optimizations]
        : [],
      lastCalibration: serviceState.historicalData.lastCalibration
    }
  };
}

export function saveHistoricalData(homey: HomeyLike): boolean {
  try {
    if (homey && homey.settings) {
      homey.app.log('Saving thermal model historical data to persistent storage');
      homey.settings.set('thermal_model_data', serviceState.historicalData);
      homey.app.log(`Saved ${serviceState.historicalData.optimizations.length} optimization data points`);
      return true;
    }
    return false;
  } catch (error) {
    if (homey && homey.app) {
      homey.app.error('Error saving thermal model data:', error);
    } else {
      // eslint-disable-next-line no-console
      console.error('Error saving thermal model data:', error);
    }
    return false;
  }
}

export function loadHistoricalData(homey: HomeyLike): boolean {
  try {
    if (homey && homey.settings) {
      const savedData = homey.settings.get('thermal_model_data');
      if (savedData) {
        homey.app.log('Loading thermal model historical data from persistent storage');
        if (savedData.optimizations && Array.isArray(savedData.optimizations)) {
          serviceState.historicalData = savedData;
          homey.app.log(`Loaded ${serviceState.historicalData.optimizations.length} optimization data points`);
          if (serviceState.historicalData.lastCalibration) {
            const ts = serviceState.historicalData.lastCalibration.timestamp;
            homey.app.log(`Last calibration: ${new Date(ts).toLocaleString()}, K=${serviceState.historicalData.lastCalibration.newK}`);
          }
          return true;
        }
        homey.app.log('Saved thermal model data has invalid format, using defaults');
      } else {
        homey.app.log('No saved thermal model data found, starting with empty dataset');
      }
    }
    return false;
  } catch (error) {
    if (homey && homey.app) {
      homey.app.error('Error loading thermal model data:', error);
    } else {
      // eslint-disable-next-line no-console
      console.error('Error loading thermal model data:', error);
    }
    return false;
  }
}

export async function initializeServices(homey: HomeyLike): Promise<ServiceState> {
  if (serviceState.melCloud && serviceState.tibber && serviceState.optimizer) {
    return serviceState;
  }

  const appLogger = (homey.app as any)?.logger;
  if (appLogger && typeof appLogger.api === 'function') {
    (global as any).logger = appLogger;
  }

  loadHistoricalData(homey);

  const melcloudUser = homey.settings.get('melcloud_user') || homey.settings.get('melcloudUser');
  const melcloudPass = homey.settings.get('melcloud_pass') || homey.settings.get('melcloudPass');
  const tibberToken = homey.settings.get('tibber_token') || homey.settings.get('tibberToken');
  const deviceId = homey.settings.get('device_id') || homey.settings.get('deviceId') || 'Boiler';
  let buildingIdRaw = homey.settings.get('building_id') || homey.settings.get('buildingId') || '456';
  const useWeatherData = homey.settings.get('use_weather_data') !== false;

  if (!melcloudUser || !melcloudPass) {
    throw new Error('MELCloud credentials are required. Please configure them in the settings.');
  }

  const parsedBuildingId = Number.parseInt(String(buildingIdRaw), 10);
  if (!Number.isFinite(parsedBuildingId)) {
    buildingIdRaw = '456';
  }
  const buildingId = Number.isFinite(parsedBuildingId) ? parsedBuildingId : 456;

  homey.app.log(`Using device ID: ${deviceId}`);
  homey.app.log(`Using building ID: ${buildingId}`);

  homey.app.log('Initializing services with settings:');
  homey.app.log('- MELCloud User:', melcloudUser ? '✓ Set' : '✗ Not set');
  homey.app.log('- MELCloud Pass:', melcloudPass ? '✓ Set' : '✗ Not set');
  homey.app.log('- Tibber Token:', tibberToken ? '✓ Set' : '✗ Not set');
  homey.app.log('- Device ID:', deviceId, '(Will be resolved after login)');
  homey.app.log('- Building ID:', buildingId, '(Will be resolved after login)');
  homey.app.log('- Weather Data:', useWeatherData ? '✓ Enabled' : '✗ Disabled');

  const melCloudLogger = (appLogger && typeof appLogger.api === 'function') ? appLogger : undefined;
  const melCloud = new MelCloudApi(melCloudLogger);
  await melCloud.login(melcloudUser, melcloudPass);
  serviceState.melCloud = melCloud;
  (global as any).melCloud = melCloud;
  homey.app.log('Successfully logged in to MELCloud');

  const devices = await melCloud.getDevices();
  homey.app.log(`Found ${devices.length} devices in MELCloud account`);
  if (devices.length > 0) {
    homey.app.log('===== AVAILABLE DEVICES =====');
    devices.forEach((device: any) => {
      homey.app.log(`Device: ${device.name} (ID: ${device.id}, Building ID: ${device.buildingId})`);
    });
    homey.app.log('=============================');
    const exists = devices.some((device: any) => (
      device.id?.toString() === deviceId.toString() ||
      String(device.name || '').toLowerCase() === deviceId.toLowerCase()
    ));
    if (!exists && devices[0]) {
      const fallback = devices[0];
      homey.app.log(`WARNING: Configured device ID "${deviceId}" not found. Using ${fallback.name} (ID: ${fallback.id}).`);
    }
  } else {
    homey.app.log('WARNING: No devices found in your MELCloud account.');
  }

  if (tibberToken) {
    const tibberLogger = (appLogger && typeof appLogger.api === 'function') ? appLogger : undefined;
    const tibber = new TibberApi(tibberToken, tibberLogger);
    serviceState.tibber = tibber;
    (global as any).tibber = tibber;
  } else {
    homey.app.warn?.('Skipping Tibber initialization: token not configured');
    serviceState.tibber = null;
    (global as any).tibber = null;
  }

  if (useWeatherData) {
    try {
      const weatherInstance = new WeatherApi(
        'MELCloudOptimizer/1.0 github.com/decline27/melcloud-optimizer',
        homey.app
      );
      serviceState.weather = weatherInstance;
      homey.app.log('Weather API initialized');
    } catch (error) {
      homey.app.error('Failed to initialize Weather API:', error);
      serviceState.weather = null;
    }
  } else {
    homey.app.log('Weather data disabled in settings');
    serviceState.weather = null;
  }

  const optimizer = new Optimizer(
    melCloud,
    tibber,
    deviceId,
    buildingId,
    homey.app as any,
    serviceState.weather as any,
    homey as any
  );
  serviceState.optimizer = optimizer;
  (global as any).optimizer = optimizer;

  await updateOptimizerSettings(homey);

  if (!(global as any).copHelper) {
    try {
      const copHelper = new COPHelper(homey as any, homey.app);
      (global as any).copHelper = copHelper;
      homey.app.log('COP Helper initialized globally');
    } catch (error) {
      homey.app.error('Failed to initialize COP Helper globally:', error);
    }
  }

  homey.app.log('Services initialized successfully');
  return serviceState;
}

export async function updateOptimizerSettings(homey: HomeyLike): Promise<void> {
  const optimizer = serviceState.optimizer;
  if (!optimizer) {
    return;
  }

  const minTemp = homey.settings.get('min_temp') || 18;
  const maxTemp = homey.settings.get('max_temp') || 22;
  const tempStep = homey.settings.get('temp_step_max') || 0.5;
  const kFactor = homey.settings.get('initial_k') || 0.5;

  const enableZone2 = homey.settings.get('enable_zone2') === true;
  const minTempZone2 = homey.settings.get('min_temp_zone2') || 18;
  const maxTempZone2 = homey.settings.get('max_temp_zone2') || 22;
  const tempStepZone2 = homey.settings.get('temp_step_zone2') || 0.5;

  const enableTankControl = homey.settings.get('enable_tank_control') === true;
  const minTankTemp = homey.settings.get('min_tank_temp') || 40;
  const maxTankTemp = homey.settings.get('max_tank_temp') || 50;
  const tankTempStep = homey.settings.get('tank_temp_step') || 1.0;

  homey.app.log('Optimizer settings:');
  homey.app.log('- Min Temp:', minTemp, '°C');
  homey.app.log('- Max Temp:', maxTemp, '°C');
  homey.app.log('- Temp Step:', tempStep, '°C (MELCloud supports 0.5°C increments)');
  homey.app.log('- K Factor:', kFactor);

  homey.app.log('Zone2 settings:');
  homey.app.log('- Zone2 Control:', enableZone2 ? 'Enabled' : 'Disabled');
  if (enableZone2) {
    homey.app.log('- Min Temp Zone2:', minTempZone2, '°C');
    homey.app.log('- Max Temp Zone2:', maxTempZone2, '°C');
    homey.app.log('- Temp Step Zone2:', tempStepZone2, '°C');
  }

  homey.app.log('Hot Water Tank settings:');
  homey.app.log('- Tank Control:', enableTankControl ? 'Enabled' : 'Disabled');
  if (enableTankControl) {
    homey.app.log('- Min Tank Temp:', minTankTemp, '°C');
    homey.app.log('- Max Tank Temp:', maxTankTemp, '°C');
    homey.app.log('- Tank Temp Step:', tankTempStep, '°C');
  }

  const copWeight = homey.settings.get('cop_weight') || 0.3;
  const autoSeasonalMode = homey.settings.get('auto_seasonal_mode') !== false;
  const summerMode = homey.settings.get('summer_mode') === true;

  homey.app.log('COP settings:');
  homey.app.log('- COP Weight:', copWeight);
  homey.app.log('- Auto Seasonal Mode:', autoSeasonalMode ? 'Enabled' : 'Disabled');
  homey.app.log('- Summer Mode:', summerMode ? 'Enabled' : 'Disabled');

  optimizer.setTemperatureConstraints(minTemp, maxTemp, tempStep);
  optimizer.setZone2TemperatureConstraints(enableZone2, minTempZone2, maxTempZone2, tempStepZone2);
  optimizer.setTankTemperatureConstraints(enableTankControl, minTankTemp, maxTankTemp, tankTempStep);
  optimizer.setThermalModel(kFactor);
  optimizer.setCOPSettings(copWeight, autoSeasonalMode, summerMode);
}

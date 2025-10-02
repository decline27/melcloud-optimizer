import { DateTime } from 'luxon';

// App types
export interface LogEntry {
  ts: string;
  price: number;
  indoor: number;
  target: number;
}

export interface ThermalModel {
  K: number;
  S?: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  type: string;
  buildingId: number;
  data?: any;
}

export interface PricePoint {
  time: string;
  price: number;
}

export interface OptimizationResult {
  targetTemp: number;
  reason: string;
  priceNow: number;
  priceAvg: number;
  priceMin: number;
  priceMax: number;
  indoorTemp: number;
  outdoorTemp: number;
  targetOriginal: number;
  savings: number;
  comfort: number;
  timestamp: string;
  kFactor?: number;
  thermalModel?: {
    characteristics: ThermalCharacteristics;
    timeToTarget: number;
    confidence: number;
    recommendation: any;
  };
  cop?: {
    heating: number;
    hotWater: number;
    seasonal: number;
    weight: number;
    isSummerMode: boolean;
    autoSeasonalMode: boolean;
  };
}

// MELCloud API types
export interface MelCloudDevice {
  DeviceID: string;
  DeviceName: string;
  BuildingID: number;
  RoomTemperature?: number;
  RoomTemperatureZone1?: number;
  SetTemperature?: number;
  SetTemperatureZone1?: number;
  OutdoorTemperature: number;
  IdleZone1: boolean;
  DailyHeatingEnergyProduced?: number;
  DailyHeatingEnergyConsumed?: number;
  DailyHotWaterEnergyProduced?: number;
  DailyHotWaterEnergyConsumed?: number;
  [key: string]: any; // For other properties
}

// Tibber API types
export interface TibberPriceInfo {
  current: {
    price: number;
    time: string;
  };
  prices: PricePoint[];
  quarterHourly?: PricePoint[];
  intervalMinutes?: number;
}

export interface PriceProvider {
  getPrices(): Promise<TibberPriceInfo>;
  updateTimeZoneSettings?(offsetHours: number, useDst: boolean): void;
  cleanup?(): void;
}

// Weather API types
export interface WeatherData {
  temperature: number;
  windSpeed: number;
  humidity: number;
  cloudCover: number;
  precipitation: number;
}

// Thermal model types
export interface ThermalCharacteristics {
  heatingRate: number;
  coolingRate: number;
  thermalMass: number;
  modelConfidence: number;
  lastUpdated: string;
}

export interface ThermalDataPoint {
  timestamp: string;
  indoorTemperature: number;
  outdoorTemperature: number;
  targetTemperature: number;
  heatingActive: boolean;
  weatherConditions: {
    windSpeed: number;
    humidity: number;
    cloudCover: number;
    precipitation: number;
  };
}

// Homey app interfaces
export interface HomeySettings {
  get(key: string): any;
  set(key: string, value: any): Promise<void>;
  unset(key: string): Promise<void>;
  on(event: string, listener: (key: string) => void): void;
}

export interface HomeyLogger {
  log(message: string, ...args: any[]): void;
  error(message: string, error?: Error | unknown, ...args: any[]): void;
  debug?(message: string, ...args: any[]): void;
  warn?(message: string, ...args: any[]): void;
}

export interface HomeyApp {
  id: string;
  manifest: {
    version: string;
  };
  version: string;
  platform: string;
  settings: HomeySettings;
  log(message: string, ...args: any[]): void;
  error(message: string, error?: Error | unknown, ...args: any[]): void;
  // Homey timeline and notifications APIs
  timeline?: {
    createEntry(options: { title: string; body: string; icon?: string; type?: string }): Promise<any>;
  };
  notifications?: {
    createNotification(options: { excerpt: string }): Promise<any>;
  };
  flow?: {
    runFlowCardAction(options: { uri: string; args: any }): Promise<any>;
  };
  // Internationalization and localization
  i18n?: {
    getLanguage(): string;
    getCurrency(): string;
  };
  // Optional properties that might be used in some contexts
  melcloudApi?: any;
  weatherApi?: any;
}

// Type guards
// isError removed here; use isError from util/error-handler for consistency

export function isMelCloudDevice(value: any): value is MelCloudDevice {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.DeviceID === 'string' &&
    typeof value.BuildingID === 'number'
  );
}

export function isTibberPriceInfo(value: any): value is TibberPriceInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.current === 'object' &&
    typeof value.current.price === 'number' &&
    Array.isArray(value.prices)
  );
}

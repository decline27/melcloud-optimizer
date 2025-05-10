# Batch 3: TypeScript Enhancements

## Overview

This batch focuses on improving the TypeScript implementation throughout the codebase. The primary goals are to:

1. Replace `any` types with proper interfaces
2. Add comprehensive type definitions
3. Implement type guards for safer type narrowing
4. Improve code organization with TypeScript features

## Detailed Implementation Plan

### 1. Replace `any` Types with Proper Interfaces

#### Files to Modify:
- `src/app.ts` (Lines 6-30)
- `src/services/optimizer.ts` (Lines 20-21)
- `src/services/thermal-model/thermal-model-service.ts` (Various any types)

#### Implementation:

Create a dedicated types file for shared interfaces:

```typescript
// Create new file: src/types/index.ts
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
}
```

Update imports and replace `any` types:

```typescript
// In app.ts
import {
  LogEntry,
  ThermalModel,
  DeviceInfo,
  PricePoint,
  OptimizationResult,
  HomeyApp
} from './types';

// Replace type definitions with imports
// Remove lines 6-30

// In optimizer.ts
import {
  MelCloudDevice,
  TibberPriceInfo,
  WeatherData,
  ThermalModel,
  OptimizationResult,
  HomeyLogger
} from '../types';

// Replace any types:
private logger: HomeyLogger;
private thermalModelService: ThermalModelService | null = null;
private weatherApi: { getCurrentWeather(): Promise<WeatherData> } | null = null;
```

### 2. Add Comprehensive Type Definitions

#### Files to Modify:
- `src/services/melcloud-api.ts`
- `src/services/tibber-api.ts`
- `src/services/thermal-model/thermal-analyzer.ts`

#### Implementation:

Add return type annotations to all methods:

```typescript
// In melcloud-api.ts
async login(email: string, password: string): Promise<boolean> {
  // ...
}

async getDevices(): Promise<DeviceInfo[]> {
  // ...
}

async getDeviceState(deviceId: string, buildingId: number): Promise<MelCloudDevice> {
  // ...
}

// In tibber-api.ts
async getPrices(): Promise<TibberPriceInfo> {
  // ...
}

// In thermal-analyzer.ts
public updateModel(dataPoints: ThermalDataPoint[]): ThermalCharacteristics {
  // ...
}

public getThermalCharacteristics(): ThermalCharacteristics {
  // ...
}
```

### 3. Implement Type Guards for Safer Type Narrowing

#### Files to Modify:
- `src/services/optimizer.ts`
- `src/services/thermal-model/thermal-model-service.ts`

#### Implementation:

Add type guards for error handling:

```typescript
// Add to src/types/index.ts
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

// In optimizer.ts
private handleApiError(error: unknown): never {
  if (isError(error)) {
    this.logger.error('API error:', error.message);
    throw new Error(`API error: ${error.message}`);
  } else {
    this.logger.error('Unknown API error:', String(error));
    throw new Error(`Unknown API error: ${String(error)}`);
  }
}

// Usage:
try {
  // API call
} catch (error) {
  this.handleApiError(error);
}
```

Add type guards for data validation:

```typescript
// Add to src/types/index.ts
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

// Usage in services:
const data = await response.json();
if (isMelCloudDevice(data)) {
  // Process device data
} else {
  throw new Error('Invalid device data received from API');
}
```

### 4. Improve Code Organization with TypeScript Features

#### Files to Modify:
- `src/app.ts`
- `src/services/optimizer.ts`

#### Implementation:

Use private class fields and method modifiers:

```typescript
// In app.ts
private readonly hourlyJob?: CronJob;
private readonly weeklyJob?: CronJob;
private readonly copHelper?: COPHelper;
private readonly memoryUsageInterval?: NodeJS.Timeout;

// In optimizer.ts
private readonly melCloud: MelCloudApi;
private readonly tibber: TibberApi;
private thermalModel: ThermalModel = { K: 0.5 };
private readonly minTemp: number = 18;
private readonly maxTemp: number = 22;
private readonly tempStep: number = 0.5;
private readonly deviceId: string;
private readonly buildingId: number;
private readonly logger: HomeyLogger;
```

Use TypeScript parameter properties:

```typescript
// In optimizer.ts
constructor(
  private readonly melCloud: MelCloudApi,
  private readonly tibber: TibberApi,
  private readonly deviceId: string,
  private readonly buildingId: number,
  private readonly logger: HomeyLogger,
  private readonly weatherApi?: { getCurrentWeather(): Promise<WeatherData> },
  private readonly homey?: HomeyApp
) {
  // Initialization code here
}
```

## Testing Procedures

1. **Type Checking Tests**:
   - Run TypeScript compiler with strict mode
   - Verify no type errors are reported
   - Check that all `any` types have been replaced

2. **Interface Validation Tests**:
   - Test type guards with valid and invalid data
   - Verify proper error handling for type mismatches

3. **Code Organization Tests**:
   - Verify private fields are not accessible from outside
   - Check that readonly fields cannot be modified

## Expected Outcomes

1. Improved type safety throughout the codebase
2. Better IDE support with comprehensive type definitions
3. More robust error handling with type guards
4. Cleaner code organization with TypeScript features

## Verification Steps

1. Run TypeScript compiler with `--strict` flag
2. Verify no type errors are reported
3. Check IDE autocompletion and type hints
4. Run tests to ensure functionality is preserved

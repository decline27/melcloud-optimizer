# Batch 5: Test Coverage Improvements

## Overview

This batch focuses on improving the test coverage of the MELCloud Optimizer codebase. The primary goals are to:

1. Increase test coverage for critical components
2. Enhance test quality with edge case testing
3. Standardize mocking strategies
4. Add integration tests for key workflows

## Detailed Implementation Plan

### 1. Increase Test Coverage for Critical Components

#### Files to Modify:
- `test/unit/melcloud-api.test.ts`
- `test/unit/optimizer.test.ts`
- `test/unit/thermal-model-service.test.ts`

#### Implementation:

Enhance MELCloud API tests:

```typescript
// In test/unit/melcloud-api.test.ts
describe('MelCloudApi', () => {
  let api: MelCloudApi;
  let mockLogger: any;
  
  beforeEach(() => {
    // Mock fetch
    global.fetch = jest.fn().mockImplementation((url, options) => {
      if (url.includes('Login/ClientLogin')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ErrorId: null,
            LoginData: {
              ContextKey: 'test-context-key'
            }
          })
        });
      } else if (url.includes('User/ListDevices')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              ID: 1,
              Structure: {
                Devices: [
                  {
                    DeviceID: 'device-1',
                    DeviceName: 'Test Device',
                    BuildingID: 1
                  }
                ]
              }
            }
          ])
        });
      } else if (url.includes('Device/Get')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 'device-1',
            DeviceName: 'Test Device',
            RoomTemperature: 21,
            SetTemperature: 22,
            OutdoorTemperature: 5
          })
        });
      } else if (url.includes('Device/SetAta')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      }
      
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    
    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    
    // Create API instance
    api = new MelCloudApi(mockLogger);
  });
  
  afterEach(() => {
    jest.resetAllMocks();
  });
  
  test('login should authenticate with MELCloud', async () => {
    const result = await api.login('test@example.com', 'password');
    
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('test@example.com')
      })
    );
  });
  
  test('login should handle authentication errors', async () => {
    // Mock fetch to return an error
    global.fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ErrorId: 1,
          ErrorMessage: 'Invalid credentials'
        })
      });
    });
    
    await expect(api.login('test@example.com', 'wrong-password')).rejects.toThrow('MELCloud login failed');
    expect(mockLogger.error).toHaveBeenCalled();
  });
  
  test('getDevices should return devices list', async () => {
    // First login to set context key
    await api.login('test@example.com', 'password');
    
    const devices = await api.getDevices();
    
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('device-1');
    expect(devices[0].name).toBe('Test Device');
    expect(devices[0].buildingId).toBe(1);
  });
  
  test('getDeviceState should return device state', async () => {
    // First login to set context key
    await api.login('test@example.com', 'password');
    
    const state = await api.getDeviceState('device-1', 1);
    
    expect(state.DeviceID).toBe('device-1');
    expect(state.RoomTemperature).toBe(21);
    expect(state.SetTemperature).toBe(22);
    expect(state.OutdoorTemperature).toBe(5);
  });
  
  test('setDeviceTemperature should update temperature', async () => {
    // First login to set context key
    await api.login('test@example.com', 'password');
    
    const result = await api.setDeviceTemperature('device-1', 1, 23);
    
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAta',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('23')
      })
    );
  });
  
  // Add tests for error handling
  test('getDeviceState should handle network errors', async () => {
    // First login to set context key
    await api.login('test@example.com', 'password');
    
    // Mock fetch to throw a network error
    global.fetch = jest.fn().mockImplementation(() => {
      return Promise.reject(new Error('Network error'));
    });
    
    await expect(api.getDeviceState('device-1', 1)).rejects.toThrow('Network error');
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
```

Add similar comprehensive tests for optimizer.ts and thermal-model-service.ts.

### 2. Enhance Test Quality with Edge Case Testing

#### Files to Modify:
- `test/unit/optimizer.test.ts`
- `test/unit/thermal-model-service.test.ts`

#### Implementation:

Add edge case tests for optimizer:

```typescript
// In test/unit/optimizer.test.ts
test('calculateOptimalTemperature should handle equal min and max prices', async () => {
  // Setup optimizer with mock dependencies
  const optimizer = new Optimizer(
    mockMelCloud,
    mockTibber,
    'device-1',
    1,
    mockLogger
  );
  
  // Set temperature constraints
  optimizer.setTemperatureConstraints(18, 22, 0.5);
  
  // Call the method with equal min and max prices
  const result = await optimizer['calculateOptimalTemperature'](
    10, // currentPrice
    10, // avgPrice
    10, // minPrice
    10, // maxPrice
    20  // currentTemp
  );
  
  // Should default to midpoint when prices are equal
  expect(result).toBe(20); // (18 + 22) / 2
});

test('runHourlyOptimization should handle API errors gracefully', async () => {
  // Setup optimizer with mock dependencies that will fail
  const failingMelCloud = {
    getDeviceState: jest.fn().mockRejectedValue(new Error('API error')),
    setDeviceTemperature: jest.fn()
  };
  
  const optimizer = new Optimizer(
    failingMelCloud as any,
    mockTibber,
    'device-1',
    1,
    mockLogger
  );
  
  // Set temperature constraints
  optimizer.setTemperatureConstraints(18, 22, 0.5);
  
  // Should throw but not crash
  await expect(optimizer.runHourlyOptimization()).rejects.toThrow('API error');
  expect(mockLogger.error).toHaveBeenCalled();
});

test('runHourlyOptimization should handle missing COP data gracefully', async () => {
  // Setup optimizer with mock dependencies
  const optimizer = new Optimizer(
    mockMelCloud,
    mockTibber,
    'device-1',
    1,
    mockLogger,
    undefined, // No weather API
    mockHomey
  );
  
  // Set temperature constraints
  optimizer.setTemperatureConstraints(18, 22, 0.5);
  
  // Mock COP helper to throw an error
  const mockCopHelper = {
    getSeasonalCOP: jest.fn().mockRejectedValue(new Error('COP data unavailable')),
    getLatestCOP: jest.fn().mockRejectedValue(new Error('COP data unavailable')),
    isSummerSeason: jest.fn().mockReturnValue(false)
  };
  
  // @ts-ignore - Set the COP helper directly
  optimizer.copHelper = mockCopHelper;
  optimizer.setCOPSettings(0.5, true, false);
  
  // Should complete without throwing
  const result = await optimizer.runHourlyOptimization();
  
  // Should still have valid result
  expect(result).toBeDefined();
  expect(result.targetTemp).toBeDefined();
  expect(mockLogger.error).toHaveBeenCalled();
});
```

### 3. Standardize Mocking Strategies

#### Files to Create:
- `test/mocks/index.ts`

#### Implementation:

Create standardized mocks:

```typescript
// In test/mocks/index.ts
import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';
import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { COPHelper } from '../../src/services/cop-helper';

// Mock logger
export const createMockLogger = () => ({
  log: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
});

// Mock MELCloud API
export const createMockMelCloudApi = () => ({
  login: jest.fn().mockResolvedValue(true),
  getDevices: jest.fn().mockResolvedValue([
    {
      id: 'device-1',
      name: 'Test Device',
      buildingId: 1,
      type: 'heat_pump',
      data: {}
    }
  ]),
  getDeviceById: jest.fn().mockReturnValue({
    id: 'device-1',
    name: 'Test Device',
    buildingId: 1,
    type: 'heat_pump',
    data: {}
  }),
  getDeviceState: jest.fn().mockResolvedValue({
    DeviceID: 'device-1',
    RoomTemperature: 21,
    RoomTemperatureZone1: 21,
    SetTemperature: 22,
    SetTemperatureZone1: 22,
    OutdoorTemperature: 5,
    IdleZone1: false,
    DailyHeatingEnergyProduced: 10,
    DailyHeatingEnergyConsumed: 3,
    DailyHotWaterEnergyProduced: 5,
    DailyHotWaterEnergyConsumed: 2
  }),
  setDeviceTemperature: jest.fn().mockResolvedValue(true)
});

// Mock Tibber API
export const createMockTibberApi = () => ({
  getPrices: jest.fn().mockResolvedValue({
    current: {
      price: 1.2,
      time: new Date().toISOString()
    },
    prices: [
      {
        time: new Date().toISOString(),
        price: 1.2
      },
      {
        time: new Date(Date.now() + 3600000).toISOString(),
        price: 1.5
      },
      {
        time: new Date(Date.now() + 7200000).toISOString(),
        price: 0.8
      }
    ]
  })
});

// Mock Thermal Model Service
export const createMockThermalModelService = () => ({
  collectDataPoint: jest.fn(),
  getThermalCharacteristics: jest.fn().mockReturnValue({
    heatingRate: 0.5,
    coolingRate: 0.2,
    thermalMass: 0.8,
    modelConfidence: 0.7,
    lastUpdated: new Date().toISOString()
  }),
  getHeatingRecommendation: jest.fn().mockReturnValue({
    recommendedTemperature: 21.5,
    recommendedStartTime: new Date().toISOString(),
    estimatedSavings: 0.5,
    confidence: 0.7,
    explanation: 'Test recommendation'
  }),
  getTimeToTarget: jest.fn().mockReturnValue({
    timeToTarget: 60,
    confidence: 0.7
  }),
  stop: jest.fn()
});

// Mock COP Helper
export const createMockCOPHelper = () => ({
  compute: jest.fn().mockResolvedValue(undefined),
  getAverageCOP: jest.fn().mockResolvedValue(3.5),
  getLatestCOP: jest.fn().mockResolvedValue({
    heating: 3.2,
    hotWater: 2.8
  }),
  isSummerSeason: jest.fn().mockReturnValue(false),
  getSeasonalCOP: jest.fn().mockResolvedValue(3.2),
  getCOPData: jest.fn().mockResolvedValue({
    heating: {
      daily: 3.2,
      weekly: 3.3,
      monthly: 3.4
    },
    hotWater: {
      daily: 2.8,
      weekly: 2.9,
      monthly: 3.0
    },
    seasonal: {
      isSummer: false,
      currentCOP: 3.2
    }
  })
});

// Mock Homey
export const createMockHomey = () => ({
  settings: {
    get: jest.fn((key) => {
      const settings: Record<string, any> = {
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'tibber_token': 'test-token',
        'device_id': 'device-1',
        'building_id': '1',
        'min_temp': 18,
        'max_temp': 22,
        'cop_weight': 0.3,
        'auto_seasonal_mode': true,
        'summer_mode': false
      };
      return settings[key];
    }),
    set: jest.fn(),
    unset: jest.fn(),
    on: jest.fn()
  },
  log: jest.fn(),
  error: jest.fn(),
  notifications: {
    createNotification: jest.fn().mockResolvedValue(undefined)
  },
  timeline: {
    createEntry: jest.fn().mockResolvedValue(undefined)
  },
  flow: {
    runFlowCardAction: jest.fn().mockResolvedValue(undefined)
  },
  scheduler: {
    scheduleTask: jest.fn().mockReturnValue({
      stop: jest.fn()
    })
  },
  id: 'com.melcloud.optimize',
  manifest: {
    version: '1.0.0'
  },
  version: '1.0.0',
  platform: 'local'
});
```

Use standardized mocks in tests:

```typescript
// In test files
import {
  createMockLogger,
  createMockMelCloudApi,
  createMockTibberApi,
  createMockThermalModelService,
  createMockCOPHelper,
  createMockHomey
} from '../mocks';

describe('Optimizer', () => {
  let optimizer: Optimizer;
  let mockMelCloud: ReturnType<typeof createMockMelCloudApi>;
  let mockTibber: ReturnType<typeof createMockTibberApi>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockHomey: ReturnType<typeof createMockHomey>;
  
  beforeEach(() => {
    mockMelCloud = createMockMelCloudApi();
    mockTibber = createMockTibberApi();
    mockLogger = createMockLogger();
    mockHomey = createMockHomey();
    
    optimizer = new Optimizer(
      mockMelCloud as unknown as MelCloudApi,
      mockTibber as unknown as TibberApi,
      'device-1',
      1,
      mockLogger,
      undefined,
      mockHomey
    );
  });
  
  // Tests...
});
```

### 4. Add Integration Tests for Key Workflows

#### Files to Create:
- `test/integration/optimization-workflow.test.ts`

#### Implementation:

Create integration tests for key workflows:

```typescript
// In test/integration/optimization-workflow.test.ts
import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';
import { Optimizer } from '../../src/services/optimizer';
import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { COPHelper } from '../../src/services/cop-helper';
import {
  createMockLogger,
  createMockHomey
} from '../mocks';

// This test uses real implementations but mock APIs
describe('Optimization Workflow Integration', () => {
  let melCloud: MelCloudApi;
  let tibber: TibberApi;
  let optimizer: Optimizer;
  let thermalModelService: ThermalModelService;
  let copHelper: COPHelper;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockHomey: ReturnType<typeof createMockHomey>;
  
  beforeEach(() => {
    // Create mocks
    mockLogger = createMockLogger();
    mockHomey = createMockHomey();
    
    // Create real instances with mock dependencies
    melCloud = new MelCloudApi(mockLogger);
    tibber = new TibberApi('test-token', mockLogger);
    thermalModelService = new ThermalModelService(mockHomey);
    copHelper = new COPHelper(mockHomey, mockLogger);
    
    // Mock API methods
    melCloud.login = jest.fn().mockResolvedValue(true);
    melCloud.getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: 'device-1',
      RoomTemperature: 21,
      RoomTemperatureZone1: 21,
      SetTemperature: 22,
      SetTemperatureZone1: 22,
      OutdoorTemperature: 5,
      IdleZone1: false
    });
    melCloud.setDeviceTemperature = jest.fn().mockResolvedValue(true);
    
    tibber.getPrices = jest.fn().mockResolvedValue({
      current: {
        price: 1.2,
        time: new Date().toISOString()
      },
      prices: [
        {
          time: new Date().toISOString(),
          price: 1.2
        },
        {
          time: new Date(Date.now() + 3600000).toISOString(),
          price: 1.5
        },
        {
          time: new Date(Date.now() + 7200000).toISOString(),
          price: 0.8
        }
      ]
    });
    
    // Create optimizer with real implementations
    optimizer = new Optimizer(
      melCloud,
      tibber,
      'device-1',
      1,
      mockLogger,
      undefined,
      mockHomey
    );
    
    // Set up optimizer
    optimizer.setTemperatureConstraints(18, 22, 0.5);
    optimizer.setCOPSettings(0.3, true, false);
    
    // @ts-ignore - Set the services directly
    optimizer.thermalModelService = thermalModelService;
    optimizer.copHelper = copHelper;
  });
  
  test('Complete optimization workflow', async () => {
    // Run the optimization
    const result = await optimizer.runHourlyOptimization();
    
    // Verify the result
    expect(result).toBeDefined();
    expect(result.targetTemp).toBeDefined();
    expect(result.reason).toBeDefined();
    expect(result.priceNow).toBe(1.2);
    
    // Verify API calls
    expect(tibber.getPrices).toHaveBeenCalled();
    expect(melCloud.getDeviceState).toHaveBeenCalledWith('device-1', 1);
    expect(melCloud.setDeviceTemperature).toHaveBeenCalled();
    
    // Verify thermal model data collection
    // @ts-ignore - Access private method
    expect(thermalModelService.collectDataPoint).toHaveBeenCalled();
  });
  
  test('Weekly calibration workflow', async () => {
    // Run the calibration
    const result = await optimizer.runWeeklyCalibration();
    
    // Verify the result
    expect(result).toBeDefined();
    expect(result.newK).toBeDefined();
    expect(result.oldK).toBeDefined();
    
    // Verify thermal model was updated
    // @ts-ignore - Access private property
    expect(optimizer.thermalModel.K).toBe(result.newK);
  });
});
```

## Testing Procedures

1. **Coverage Measurement**:
   - Run Jest with coverage reporting
   - Verify coverage meets targets (80% for statements/functions/lines, 60% for branches)
   - Identify remaining coverage gaps

2. **Edge Case Testing**:
   - Test with extreme values (very high/low prices, temperatures)
   - Test with missing or invalid data
   - Test error handling paths

3. **Integration Testing**:
   - Run integration tests for key workflows
   - Verify all components work together correctly
   - Test end-to-end scenarios

## Expected Outcomes

1. Increased test coverage for critical components
2. Better detection of edge case bugs
3. More consistent and maintainable tests
4. Verification of end-to-end workflows

## Verification Steps

1. Run Jest with coverage reporting
2. Verify all tests pass
3. Check coverage metrics against targets
4. Identify any remaining coverage gaps for future improvement

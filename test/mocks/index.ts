import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';
import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { COPHelper } from '../../src/services/cop-helper';

// Mock logger
export const createMockLogger = () => ({
  log: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  api: jest.fn(),
  optimization: jest.fn(),
  notify: jest.fn().mockResolvedValue(undefined),
  marker: jest.fn(),
  sendToTimeline: jest.fn().mockResolvedValue(undefined),
  setLogLevel: jest.fn(),
  setTimelineLogging: jest.fn(),
  getLogLevel: jest.fn().mockReturnValue(1), // INFO level
  enableCategory: jest.fn(),
  disableCategory: jest.fn(),
  isCategoryEnabled: jest.fn().mockReturnValue(true),
  formatValue: jest.fn(value => typeof value === 'object' ? JSON.stringify(value) : String(value))
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
        'comfort_lower_occupied': 20,
        'comfort_upper_occupied': 21,
        'comfort_lower_away': 19,
        'comfort_upper_away': 20.5,
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
  env: {
    userDataPath: '/tmp/test-user-data'
  },
  id: 'com.melcloud.optimize',
  manifest: {
    version: '1.0.0'
  },
  version: '1.0.0',
  platform: 'local'
});

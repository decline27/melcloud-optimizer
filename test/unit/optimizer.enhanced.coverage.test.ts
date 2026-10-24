import { Optimizer } from '../../src/services/optimizer';
import { createMockLogger } from '../mocks';

const mockMel: any = {
  getEnhancedCOPData: jest.fn(),
  getDailyEnergyTotals: jest.fn(),
  getDeviceState: jest.fn(),
  setDeviceTemperature: jest.fn(),
  setZoneTemperature: jest.fn(),
  setTankTemperature: jest.fn()
};

const mockTibber: any = {
  getPrices: jest.fn()
};

describe('Optimizer hotwater & enhanced edge cases', () => {
  let optimizer: Optimizer;
  let logger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    mockMel.getEnhancedCOPData.mockResolvedValue({
      current: { heating: 1.2, hotWater: 0.8, outdoor: 5 },
      daily: { TotalHeatingConsumed: 0, TotalHotWaterConsumed: 0, CoP: [], AverageHeatingCOP: 0, AverageHotWaterCOP: 0 },
      trends: { heatingTrend: 'stable', hotWaterTrend: 'stable' },
      historical: { heating: 0, hotWater: 0 }
    });

    mockMel.getDeviceState.mockResolvedValue({
      RoomTemperature: 20,
      SetTemperature: 20,
      OutdoorTemperature: 5
    });
    mockMel.setZoneTemperature.mockResolvedValue(true);
    mockMel.setTankTemperature.mockResolvedValue(true);

    const nowIso = new Date().toISOString();
    mockTibber.getPrices.mockResolvedValue({
      current: { price: 0.5, time: nowIso },
      prices: new Array(24).fill(0).map((_, i) => ({ price: 0.5, time: new Date(Date.now() + i * 3600000).toISOString() })),
      priceLevel: 'CHEAP'
    });

    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any);
  });

  test('optimizeHotWaterScheduling handles missing metrics and returns maintain', async () => {
    // Access through the hotWaterOptimizer service
    const res = await (optimizer as any).hotWaterOptimizer.optimizeHotWaterScheduling(
      0.5,
      { current: { price: 0.5, time: new Date().toISOString() }, prices: new Array(24).fill({ price: 0.5, time: new Date().toISOString() }) },
      null, // No metrics
      null  // No last energy data
    );
    expect(res).toBeDefined();
    expect(['maintain', 'heat_now', 'delay']).toContain(res.action);
    expect(res.action).toBe('maintain'); // Should return maintain when no metrics
  });

  test('runOptimization returns no_change when difference below deadband', async () => {
    // Last energy data will be zeros -> metrics indicate summer -> small diff
    const result = await optimizer.runOptimization();
    expect(result).toBeDefined();
    expect(result.action).toMatch(/no_change|temperature_adjusted/);
  });

  test('runOptimization includes zone2 data when zone2 enabled', async () => {
    optimizer.setZone2TemperatureConstraints(true, 18, 22, 0.5);
    mockMel.getDeviceState.mockResolvedValue({
      RoomTemperature: 20,
      RoomTemperatureZone1: 20,
      SetTemperature: 20,
      SetTemperatureZone1: 20,
      OutdoorTemperature: 5,
      RoomTemperatureZone2: 19,
      SetTemperatureZone2: 21
    });

    const result = await optimizer.runOptimization();
    expect(result.zone2Data).toBeDefined();
  });

  test('Zone2 honors its own temperature step when rounding', async () => {
    optimizer.setZone2TemperatureConstraints(true, 18, 25, 0.5); // Zone2 step = 0.5
    // Set Zone 1 deadband to a value that won't block our step-limited changes
    (optimizer as any).constraintManager.setZone1Deadband(0.3);

    const inputs: any = {
      deviceState: {
        SetTemperatureZone2: 20,
        RoomTemperatureZone2: 20,
        RoomTemperature: 20,
        SetTemperature: 20,
        OutdoorTemperature: 5
      },
      currentTemp: 20,
      currentTarget: 20,
      outdoorTemp: 5,
      priceData: { current: { price: 0.5, time: new Date().toISOString() }, prices: [] },
      priceStats: { priceLevel: 'CHEAP' },
      priceClassification: { thresholds: {} },
      priceForecast: null,
      planningReferenceTime: new Date(),
      planningReferenceTimeMs: Date.now(),
      thermalResponse: 1,
      previousIndoorTemp: null,
      previousIndoorTempTs: null,
      constraintsBand: { minTemp: 18, maxTemp: 22 },
      safeCurrentTarget: 20
    };

    const zone1Result: any = {
      targetTemp: 21.44, // Zone2 will ramp-limit to +0.5°C per change, rounded to step
      weatherInfo: null,
      thermalStrategy: null,
      metrics: null
    };

    const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, jest.fn());

    // With maxDeltaPerChangeC = 0.5 (step size), change is limited from 20 -> 20.5
    const [, , issuedTarget] = mockMel.setZoneTemperature.mock.calls[0];
    expect(issuedTarget).toBeCloseTo(20.5, 2);
    expect(result.toTemp).toBeCloseTo(20.5, 2);
  });

  test('runOptimization includes tank data when tank control enabled', async () => {
    optimizer.setTankTemperatureConstraints(true, 40, 50, 1);
    mockMel.getDeviceState.mockResolvedValue({
      RoomTemperature: 20,
      RoomTemperatureZone1: 20,
      SetTemperature: 20,
      SetTemperatureZone1: 20,
      OutdoorTemperature: 5,
      SetTankWaterTemperature: 48
    });

    const result = await optimizer.runOptimization();
    expect(result.tankData).toBeDefined();
  });

  describe('heat-demand gate (Fix 4)', () => {
    // Prices that want a preheat: current hour cheapest, rest expensive -> target rises to band max.
    const preheatPrices = () => {
      const nowIso = new Date().toISOString();
      return {
        current: { price: 0.1, time: nowIso },
        prices: new Array(24).fill(0).map((_, i) => ({
          price: i === 0 ? 0.1 : 1.5,
          time: new Date(Date.now() + i * 3600000).toISOString()
        })),
        priceLevel: 'CHEAP'
      };
    };

    test('holds zone1 write when room is above the comfort band (no heat possible)', async () => {
      optimizer.setTemperatureConstraints(18, 22, 0.5);
      mockTibber.getPrices.mockResolvedValue(preheatPrices());
      mockMel.getDeviceState.mockResolvedValue({
        RoomTemperature: 26,           // well above band max 22 (solar gain)
        RoomTemperatureZone1: 26,
        SetTemperature: 20,
        SetTemperatureZone1: 20,
        OutdoorTemperature: 24,
        IdleZone1: true
      });

      const result = await optimizer.runOptimization();

      expect(mockMel.setDeviceTemperature).not.toHaveBeenCalled();
      expect(result.reason).toMatch(/above comfort band/i);
    });

    test('control: same price scenario DOES apply when room is within the band', async () => {
      optimizer.setTemperatureConstraints(18, 22, 0.5);
      mockTibber.getPrices.mockResolvedValue(preheatPrices());
      mockMel.getDeviceState.mockResolvedValue({
        RoomTemperature: 20,           // within band -> gate inert, heating possible
        RoomTemperatureZone1: 20,
        SetTemperature: 20,
        SetTemperatureZone1: 20,
        OutdoorTemperature: 5,
        IdleZone1: false
      });

      await optimizer.runOptimization();

      expect(mockMel.setDeviceTemperature).toHaveBeenCalled();
    });

    // Curve mode: the setpoint only switches the curve on or off. With the room well below both
    // the old and the new target, the raise changes nothing (live 2026-10-24: 23 <-> 24 all night
    // with the room at 21.5).
    const curveState = (operationModeZone1: number) => ({
      RoomTemperature: 18.5,
      RoomTemperatureZone1: 18.5,
      SetTemperature: 20,
      SetTemperatureZone1: 20,
      OutdoorTemperature: 5,
      OperationModeZone1: operationModeZone1,
      IdleZone1: false
    });

    test('Curve mode: holds a raise that leaves the thermostat on anyway', async () => {
      optimizer.setTemperatureConstraints(18, 22, 0.5);
      mockTibber.getPrices.mockResolvedValue(preheatPrices());
      mockMel.getDeviceState.mockResolvedValue(curveState(2));

      const result = await optimizer.runOptimization();

      expect(mockMel.setDeviceTemperature).not.toHaveBeenCalled();
      expect(result.reason).toMatch(/thermostat stays on either way/i);
    });

    test('Curve mode: a ramp toward a target across the room is not held at its first steps', async () => {
      // Review finding: the hold looked only at this run's ramp-limited step. Room 20 with the
      // target at 18 and the optimizer wanting ~21: every 0.5 °C step stays under the room (inert
      // on its own), so the target would never climb to where the thermostat switches on.
      optimizer.setTemperatureConstraints(18, 22, 0.5);
      mockTibber.getPrices.mockResolvedValue(preheatPrices());
      mockMel.getDeviceState.mockResolvedValue({
        ...curveState(2), RoomTemperature: 20, RoomTemperatureZone1: 20, SetTemperature: 18, SetTemperatureZone1: 18
      });

      await optimizer.runOptimization();

      expect(mockMel.setDeviceTemperature).toHaveBeenCalled();
    });

    test('Curve mode: a room that warms fast enough to reach the target this hour is not held', async () => {
      // Review finding: the deadband alone ignores how far the room moves before the next run.
      jest.spyOn(optimizer as any, 'learnedCurveWarmingPerHour').mockReturnValue(2);
      optimizer.setTemperatureConstraints(18, 22, 0.5);
      mockTibber.getPrices.mockResolvedValue(preheatPrices());
      mockMel.getDeviceState.mockResolvedValue(curveState(2));

      await optimizer.runOptimization();

      expect(mockMel.setDeviceTemperature).toHaveBeenCalled();
    });

    test('a held zone write books no baseline saving (the thermostat is on either way)', async () => {
      const calc = jest.fn().mockResolvedValue(1);
      (optimizer as any).savingsService.calculateRealHourlySavings = calc;
      const inputs: any = {
        currentTemp: 21.5, constraintsBand: { minTemp: 20, maxTemp: 24 }, priceStats: { currentPrice: 1 }
      };
      const zone1: any = { safeCurrentTarget: 23, targetTemp: 24, metrics: {}, thermostatHold: true };

      await (optimizer as any).calculateCombinedSavings(zone1, null, null, inputs, { zone1Applied: false });
      expect(calc).not.toHaveBeenCalled();

      await (optimizer as any).calculateCombinedSavings({ ...zone1, thermostatHold: false }, null, null, inputs, { zone1Applied: false });
      expect(calc).toHaveBeenCalled();
    });

    test('control: the same raise is written in Room mode', async () => {
      optimizer.setTemperatureConstraints(18, 22, 0.5);
      mockTibber.getPrices.mockResolvedValue(preheatPrices());
      mockMel.getDeviceState.mockResolvedValue(curveState(0));

      await optimizer.runOptimization();

      expect(mockMel.setDeviceTemperature).toHaveBeenCalled();
    });
  });

  test('persists tank lockout timestamp on a tank-only apply (zone1 not applied)', async () => {
    // Regression for DHW-3: in summer zone1 never applies, so the tank change must still be
    // persisted to settings or the anti-cycling lockout is lost on restart.
    const homey: any = {
      settings: {
        get: jest.fn().mockReturnValue(undefined),
        set: jest.fn()
      }
    };
    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);

    const zone1Result: any = {
      needsApply: false,        // zone1 holds (summer: room above band / no demand)
      lockoutActive: false,
      duplicateTarget: false,
      changed: false,
      targetTemp: 20,
      safeCurrentTarget: 20,
      tempDifference: 0
    };
    const tankResult: any = {
      needsApply: true,
      fromTemp: 48,
      toTemp: 46,
      evaluatedAtMs: 1700000000000
    };

    const changes = await (optimizer as any).applySetpointChanges(zone1Result, null, tankResult, jest.fn());

    expect(changes.tankApplied).toBe(true);
    expect(changes.zone1Applied).toBe(false);
    expect(mockMel.setTankTemperature).toHaveBeenCalledWith('device-1', 1, 46);
    // The fix: timestamp persisted even though zone1 did not apply.
    expect(homey.settings.set).toHaveBeenCalledWith('last_tank_setpoint_change_ms', 1700000000000);
  });

  test('runOptimization forwards device state to the hot water service collector', async () => {
    const collectData = jest.fn().mockResolvedValue(true);
    const getUsageStatistics = jest.fn().mockReturnValue({
      statistics: {
        usageByHourOfDay: new Array(24).fill(0),
        dataPointCount: 0
      }
    });
    const homey: any = {
      settings: {
        get: jest.fn(),
        set: jest.fn()
      },
      hotWaterService: {
        collectData,
        getUsageStatistics
      }
    };
    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);

    await optimizer.runOptimization();

    expect(collectData).toHaveBeenCalledWith(expect.objectContaining({
      RoomTemperature: 20,
      SetTemperature: 20,
      OutdoorTemperature: 5
    }));
  });

  test('optimizeTank does not pin maintain actions to the previous tank setpoint', async () => {
    const homey: any = {
      settings: {
        get: jest.fn(),
        set: jest.fn()
      },
      hotWaterService: {
        getUsageStatistics: jest.fn().mockReturnValue({
          statistics: {
            usageByHourOfDay: new Array(24).fill(0.5),
            dataPointCount: 24
          }
        }),
        getOptimalTankTemperature: jest.fn().mockReturnValue(48)
      }
    };
    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    optimizer.setTankTemperatureConstraints(true, 42, 53, 2);

    const result = await (optimizer as any).optimizeTank(
      {
        deviceState: { SetTankWaterTemperature: 52 },
        priceStats: {
          currentPrice: 1.12,
          priceLevel: 'NORMAL',
          pricePercentile: 84.6
        },
        priceClassification: {
          thresholds: {}
        }
      },
      {
        hotWaterAction: {
          action: 'maintain',
          reason: 'Predictive scheduling found no immediate action'
        }
      },
      jest.fn()
    );

    expect(homey.hotWaterService.getOptimalTankTemperature).toHaveBeenCalledWith(42, 53, 1.12, 'NORMAL');
    // 52 -> 48 in one move. The adaptive target has drifted 4°C from the current setpoint, which
    // clears the maintain hysteresis, and the tank ramp cap (4°C) is wide enough to arrive in a
    // single write rather than stepping there over several hours.
    expect(result.toTemp).toBe(48);
    expect(result.needsApply).toBe(true);
  });

  test('optimizeTank holds the current setpoint when the maintain target is within hysteresis', async () => {
    const homey: any = {
      settings: {
        get: jest.fn(),
        set: jest.fn()
      },
      hotWaterService: {
        getUsageStatistics: jest.fn().mockReturnValue({
          statistics: {
            usageByHourOfDay: new Array(24).fill(0.5),
            dataPointCount: 24
          }
        }),
        // Only 1°C away from the current 52°C setpoint — no strong signal.
        getOptimalTankTemperature: jest.fn().mockReturnValue(51)
      }
    };
    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    optimizer.setTankTemperatureConstraints(true, 42, 53, 2);

    const result = await (optimizer as any).optimizeTank(
      {
        deviceState: { SetTankWaterTemperature: 52 },
        priceStats: {
          currentPrice: 1.12,
          priceLevel: 'NORMAL',
          pricePercentile: 84.6
        },
        priceClassification: { thresholds: {} }
      },
      {
        hotWaterAction: {
          action: 'maintain',
          reason: 'Predictive scheduling found no immediate action'
        }
      },
      jest.fn()
    );

    // 'maintain' means no strong signal. Chasing a 1°C drift would write a new setpoint every
    // hour as the price level wanders across band-fraction boundaries, for no economic gain.
    expect(result.toTemp).toBe(52);
    expect(result.needsApply).toBe(false);
  });

  test('runOptimization prefers MELCloud daily hot water total over learner daily history', async () => {
    mockMel.getEnhancedCOPData.mockResolvedValue({
      current: { heating: 3.09, hotWater: 2.52, outdoor: 8 },
      daily: {
        TotalHeatingConsumed: 9.05,
        TotalHeatingProduced: 28.0,
        TotalHotWaterConsumed: 2.29,
        TotalHotWaterProduced: 5.78,
        CoP: [],
        AverageHeatingCOP: 3.09,
        AverageHotWaterCOP: 2.52
      },
      trends: { heatingTrend: 'stable', hotWaterTrend: 'stable' },
      historical: { heating: 3.09, hotWater: 2.52 }
    });

    const homey: any = {
      settings: {
        get: jest.fn(),
        set: jest.fn()
      },
      hotWaterService: {
        collectData: jest.fn().mockResolvedValue(true),
        getUsageStatistics: jest.fn().mockReturnValue({
          statistics: {
            avgDailyHotWaterEnergyProduced: 46.5,
            usageByHourOfDay: new Array(24).fill(0.5),
            dataPointCount: 24
          },
          patterns: {
            hourlyUsagePattern: new Array(24).fill(1),
            lastUpdated: new Date().toISOString(),
            confidence: 100
          }
        }),
        getOptimalTankTemperature: jest.fn().mockReturnValue(45)
      }
    };
    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);

    await optimizer.runOptimization();

    const learnerStateCall = (logger.log as jest.Mock).mock.calls.find(([message]) => message === 'Hot water learner state');
    expect(learnerStateCall).toBeDefined();
    expect(learnerStateCall[1]).toEqual(expect.objectContaining({
      estimatedDailyHotWaterKwh: 5.78,
      estimatedDailyHotWaterKwhSource: 'melcloud_daily_total',
      measuredDailyHotWaterKwh: 5.78,
      learnedDailyHotWaterKwh: 5.78,
      learnedDailyHotWaterKwhBeforeReconcile: 46.5,
      learnerReconciledToMeasured: true
    }));
  });

  test('calculateDailySavings falls back to non-price-aware calculation on Tibber error', async () => {
    mockTibber.getPrices.mockRejectedValueOnce(new Error('boom'));
    const projection = await optimizer.getSavingsService().calculateDailySavings(1);
    // On error, it falls back to the enhanced savings calculator which calculates based on
    // remaining hours in the day and applies clamping. The result should still be a positive number.
    expect(projection).toBeGreaterThan(0);
    expect(projection).toBeLessThanOrEqual(24); // Max possible with hourly savings of 1
  });

  test('thermal model cleanup helper returns safe defaults when service unavailable', () => {
    expect(optimizer.forceThermalDataCleanup()).toEqual({ success: false, message: 'Thermal model service not initialized' });
  });
});

describe('Tank reheat commitment', () => {
  const logger = createMockLogger();

  function makeHomey(storedReheatMs: number | null) {
    const store: Record<string, any> = { dhw_scheduled_reheat_ms: storedReheatMs };
    return {
      settings: {
        get: jest.fn((key: string) => store[key]),
        set: jest.fn((key: string, value: any) => { store[key] = value; })
      },
      __store: store
    } as any;
  }

  function makeInputs() {
    return {
      deviceState: { SetTankWaterTemperature: 45 },
      priceStats: { currentPrice: 0.9, priceLevel: 'EXPENSIVE', pricePercentile: 90 },
      priceClassification: { thresholds: {} }
    };
  }

  test('a delay with a scheduled time persists a reheat commitment', async () => {
    const homey = makeHomey(null);
    const opt: any = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    opt.setTankTemperatureConstraints(true, 40, 55, 1);

    const scheduledTime = new Date(Date.now() + 3 * 3600000).toISOString();
    await opt.optimizeTank(makeInputs(), {
      hotWaterAction: { action: 'delay', reason: 'price high', scheduledTime }
    }, jest.fn());

    expect(homey.__store.dhw_scheduled_reheat_ms).toBe(Date.parse(scheduledTime));
  });

  test('a due commitment forces heat_now even while the price still reads expensive', async () => {
    // Committed 10 minutes ago: within the grace window, so it should fire now.
    const homey = makeHomey(Date.now() - 10 * 60000);
    const opt: any = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    opt.setTankTemperatureConstraints(true, 40, 55, 1);

    const result = await opt.optimizeTank(makeInputs(), {
      hotWaterAction: { action: 'delay', reason: 'price high' }
    }, jest.fn());

    expect(result.toTemp).toBeGreaterThan(45);
    expect(result.reason).toContain('scheduled reheat');
    // Consumed, so it cannot fire twice.
    expect(homey.__store.dhw_scheduled_reheat_ms).toBeNull();
  });

  test('a stale commitment is discarded rather than acted on late', async () => {
    // 4 hours late - well past the 90 minute grace window.
    const homey = makeHomey(Date.now() - 4 * 3600000);
    const opt: any = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    opt.setTankTemperatureConstraints(true, 40, 55, 1);

    const result = await opt.optimizeTank(makeInputs(), {
      hotWaterAction: { action: 'delay', reason: 'price high' }
    }, jest.fn());

    expect(result.reason).not.toContain('scheduled reheat');
    expect(homey.__store.dhw_scheduled_reheat_ms).toBeNull();
  });

  test('a future commitment does not fire early', async () => {
    const homey = makeHomey(Date.now() + 2 * 3600000);
    const opt: any = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    opt.setTankTemperatureConstraints(true, 40, 55, 1);

    const result = await opt.optimizeTank(makeInputs(), {
      hotWaterAction: { action: 'delay', reason: 'price high' }
    }, jest.fn());

    expect(result.reason).not.toContain('scheduled reheat');
    expect(typeof homey.__store.dhw_scheduled_reheat_ms).toBe('number');
  });
});

describe('Low-tank kick', () => {
  const logger = createMockLogger();
  const homey = { settings: { get: jest.fn(), set: jest.fn() } } as any;

  function makeInputs(deviceState: Record<string, any>) {
    return {
      deviceState: { SetTankWaterTemperature: 42, ...deviceState },
      priceStats: { currentPrice: 3.5, priceLevel: 'VERY_EXPENSIVE', pricePercentile: 95 },
      priceClassification: { thresholds: {} }
    };
  }

  function makeOptimizer() {
    const opt: any = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    opt.setTankTemperatureConstraints(true, 42, 53, 2);
    return opt;
  }

  const delay = { hotWaterAction: { action: 'delay', reason: 'price high' } };

  test('a tank below the minimum gets the largest allowed raise even while prices are high', async () => {
    // Live case 2026-10-13: tank 23 °C, setpoint held at the 42 °C minimum, pump idle for hours.
    const result = await makeOptimizer().optimizeTank(makeInputs({ TankWaterTemperature: 23, OperationMode: 0 }), delay, jest.fn());

    // Ramp cap is max(step 2, 4) = 4: 42 -> 46 in one write (a 2 °C raise did not start the pump live).
    expect(result.toTemp).toBe(46);
    expect(result.needsApply).toBe(true);
    expect(result.reason).toContain('below minimum');
  });

  test('a reheat in progress is not cut short by a price delay', async () => {
    // Live 2026-10-16 19:00: tank 28 °C, reheat just started, target 46; the delay lowered it to
    // the 42 °C minimum and the tank stopped at 43.5 °C.
    const result = await makeOptimizer().optimizeTank(
      makeInputs({ SetTankWaterTemperature: 46, TankWaterTemperature: 28, OperationMode: 1 }), delay, jest.fn());

    expect(result.toTemp).toBe(46);
    expect(result.reason).toContain('holding setpoint');
  });

  test('no extra raise while a DHW run is already in progress', async () => {
    const result = await makeOptimizer().optimizeTank(makeInputs({ TankWaterTemperature: 30, OperationMode: 1 }), delay, jest.fn());

    expect(result.toTemp).toBe(42);
    expect(result.reason).not.toContain('below minimum');
  });

  test('no kick when the tank is at or above the minimum', async () => {
    const result = await makeOptimizer().optimizeTank(makeInputs({ TankWaterTemperature: 46, OperationMode: 0 }), delay, jest.fn());

    expect(result.toTemp).toBe(42);
    expect(result.reason).not.toContain('below minimum');
  });

  test('the kick never exceeds the user maximum', async () => {
    const result = await makeOptimizer().optimizeTank(
      makeInputs({ SetTankWaterTemperature: 52, TankWaterTemperature: 30, OperationMode: 0 }),
      { hotWaterAction: { action: 'maintain', reason: 'no signal' } },
      jest.fn()
    );

    expect(result.toTemp).toBeLessThanOrEqual(53);
  });
});

describe('Low-tank forced hot water', () => {
  const logger = createMockLogger();
  const delay = { hotWaterAction: { action: 'delay', reason: 'price high' } };

  function makeHomey(initial: Record<string, any> = {}) {
    const store: Record<string, any> = { ...initial };
    return {
      settings: {
        get: jest.fn((k: string) => store[k]),
        set: jest.fn((k: string, v: any) => { store[k] = v; }),
        unset: jest.fn((k: string) => { delete store[k]; })
      },
      __store: store
    } as any;
  }

  function makeOptimizer(homey: any) {
    const opt: any = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any, undefined, homey);
    opt.setTankTemperatureConstraints(true, 42, 53, 2);
    return opt;
  }

  const inputs = (deviceState: Record<string, any>) => ({
    deviceState: { SetTankWaterTemperature: 53, ...deviceState },
    priceStats: { currentPrice: 3.5, priceLevel: 'VERY_EXPENSIVE', pricePercentile: 95 },
    priceClassification: { thresholds: {} }
  });

  test('target already at the maximum: forced hot water instead of a raise', async () => {
    // Live 2026-10-18: target 53 = max, tank 48 -> 40 °C overnight, no reheat.
    const result = await makeOptimizer(makeHomey()).optimizeTank(
      inputs({ TankWaterTemperature: 40, OperationMode: 2, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(result.hotWaterMode).toBe('forced');
    expect(result.reason).toContain('forced hot water');
  });

  test('a fresh raise gets its chance first; after it fails, forced hot water', async () => {
    const homey = makeHomey();
    const fresh = await makeOptimizer(homey).optimizeTank(
      inputs({ SetTankWaterTemperature: 44, TankWaterTemperature: 38, OperationMode: 0, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(fresh.toTemp).toBe(48);
    expect(fresh.hotWaterMode).toBeUndefined();

    const later = makeHomey({ low_tank_kick_at: Date.now() - 55 * 60000 });
    const retry = await makeOptimizer(later).optimizeTank(
      inputs({ SetTankWaterTemperature: 48, TankWaterTemperature: 37, OperationMode: 0, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(retry.hotWaterMode).toBe('forced');
  });

  test('never while a reheat runs, and never twice', async () => {
    const opt = makeOptimizer(makeHomey());
    const running = await opt.optimizeTank(inputs({ TankWaterTemperature: 40, OperationMode: 1, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(running.hotWaterMode).toBeUndefined();
    const alreadyForced = await opt.optimizeTank(inputs({ TankWaterTemperature: 40, OperationMode: 2, ForcedHotWaterMode: true }), delay, jest.fn());
    expect(alreadyForced.hotWaterMode).toBeUndefined();
  });

  test('a forced run the app started returns to auto near the target; one the user started is left alone', async () => {
    const appStarted = await makeOptimizer(makeHomey({ low_tank_forced_at: Date.now() - 40 * 60000 })).optimizeTank(
      inputs({ TankWaterTemperature: 52.5, OperationMode: 0, ForcedHotWaterMode: true }), delay, jest.fn());
    expect(appStarted.hotWaterMode).toBe('auto');

    const userStarted = await makeOptimizer(makeHomey()).optimizeTank(
      inputs({ TankWaterTemperature: 52.5, OperationMode: 0, ForcedHotWaterMode: true }), delay, jest.fn());
    expect(userStarted.hotWaterMode).toBeUndefined();
  });

  test('no forced hot water when the tank is above the minimum', async () => {
    const result = await makeOptimizer(makeHomey()).optimizeTank(
      inputs({ TankWaterTemperature: 45, OperationMode: 0, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(result.hotWaterMode).toBeUndefined();
  });

  const noZoneChange: any = {
    needsApply: false, lockoutActive: false, duplicateTarget: true, changed: false,
    targetTemp: 23, safeCurrentTarget: 23, tempDifference: 0
  };

  test('the record of an app-started forced run is cleared once the unit has ended it', async () => {
    // Live 2026-10-24: forced at 00:00, reheat done by 00:55, record still set at 18:00. A forced
    // run the user starts later must not be mistaken for the app's and switched back to auto.
    const homey = makeHomey({ low_tank_forced_at: Date.now() - 60 * 60000 });
    const opt = makeOptimizer(homey);
    const ended = await opt.optimizeTank(
      inputs({ TankWaterTemperature: 51.5, OperationMode: 0, ForcedHotWaterMode: false }), delay, jest.fn());
    await opt.applySetpointChanges(noZoneChange, null, ended, jest.fn());
    expect(homey.__store.low_tank_forced_at).toBeUndefined();

    const userStarted = await opt.optimizeTank(
      inputs({ TankWaterTemperature: 52.5, OperationMode: 1, ForcedHotWaterMode: true }), delay, jest.fn());
    expect(userStarted.hotWaterMode).toBeUndefined();
  });

  test('the record is kept while the request is fresh (MELCloud may not show it yet)', async () => {
    const homey = makeHomey({ low_tank_forced_at: Date.now() - 10 * 60000 });
    const opt = makeOptimizer(homey);
    const result = await opt.optimizeTank(
      inputs({ TankWaterTemperature: 51.5, OperationMode: 0, ForcedHotWaterMode: false }), delay, jest.fn());
    await opt.applySetpointChanges(noZoneChange, null, result, jest.fn());
    expect(homey.__store.low_tank_forced_at).toBeDefined();
  });

  test('forced hot water that did not start a reheat is reported with the unit state', async () => {
    // Live 2026-10-23: forced at 21:00, 22:00 and 23:00 with the tank at 27 °C; no reheat until
    // 00:10, ten minutes after the room target dropped to the room temperature.
    const requestedAt = Date.now() - 60 * 60000;
    const homey = makeHomey({ low_tank_forced_at: requestedAt });
    homey.notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
    const opt = makeOptimizer(homey);
    mockMel.setHotWaterMode = jest.fn().mockResolvedValue(true);

    const result = await opt.optimizeTank(inputs({
      TankWaterTemperature: 27, OperationMode: 2, ForcedHotWaterMode: false,
      RoomTemperatureZone1: 22, SetTemperatureZone1: 23, IdleZone1: false
    }), delay, jest.fn());

    expect(result.hotWaterMode).toBe('forced');
    expect(result.forcedNotStarted).toEqual({
      requestedAtMs: requestedAt, tankC: 27, minC: 42, forcedFlag: false, unitMode: 2,
      roomC: 22, zoneTargetC: 23, zoneIdle: false, retrying: true
    });
    expect(result.reason).toContain('did not start a reheat');

    await opt.applySetpointChanges(noZoneChange, null, result, jest.fn());
    expect(homey.notifications.createNotification).toHaveBeenCalledTimes(1);
    const excerpt = homey.notifications.createNotification.mock.calls[0][0].excerpt;
    expect(excerpt).toContain('27');
    expect(excerpt).toMatch(/room 22.*target 23/);
    expect(mockMel.setHotWaterMode).toHaveBeenCalledWith('device-1', 1, true);
  });

  test('reported also while MELCloud shows forced mode on but no reheat runs', async () => {
    // Review finding: requiring the forced flag to be off hid the most likely failure, and made
    // the flag in the notice always read "off".
    const homey = makeHomey({ low_tank_forced_at: Date.now() - 60 * 60000 });
    homey.notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
    const opt = makeOptimizer(homey);
    const result = await opt.optimizeTank(
      inputs({ TankWaterTemperature: 27, OperationMode: 2, ForcedHotWaterMode: true }), delay, jest.fn());

    expect(result.forcedNotStarted).toMatchObject({ forcedFlag: true, retrying: false });
    expect(result.clearForcedRecord).toBe(false);
    await opt.applySetpointChanges(noZoneChange, null, result, jest.fn());
    const excerpt = homey.notifications.createNotification.mock.calls[0][0].excerpt;
    expect(excerpt).toContain('forced on');
    expect(excerpt).not.toContain('Trying again');
  });

  test('one notice per low-tank episode, not one per hour', async () => {
    const homey = makeHomey({ low_tank_forced_at: Date.now() - 60 * 60000 });
    homey.notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
    const opt = makeOptimizer(homey);
    mockMel.setHotWaterMode = jest.fn().mockResolvedValue(true);
    const cold = inputs({ TankWaterTemperature: 27, OperationMode: 2, ForcedHotWaterMode: false });

    await opt.applySetpointChanges(noZoneChange, null, await opt.optimizeTank(cold, delay, jest.fn()), jest.fn());
    homey.__store.low_tank_forced_at = Date.now() - 60 * 60000;
    await opt.applySetpointChanges(noZoneChange, null, await opt.optimizeTank(cold, delay, jest.fn()), jest.fn());
    expect(homey.notifications.createNotification).toHaveBeenCalledTimes(1);

    // The tank recovers; the next episode gets its own notice.
    const warm = inputs({ TankWaterTemperature: 50, OperationMode: 0, ForcedHotWaterMode: false });
    await opt.applySetpointChanges(noZoneChange, null, await opt.optimizeTank(warm, delay, jest.fn()), jest.fn());
    homey.__store.low_tank_forced_at = Date.now() - 60 * 60000;
    await opt.applySetpointChanges(noZoneChange, null, await opt.optimizeTank(cold, delay, jest.fn()), jest.fn());
    expect(homey.notifications.createNotification).toHaveBeenCalledTimes(2);
  });

  test('a record older than a forced run can last is cleared without a report', async () => {
    // Review finding: a leftover record from the day before read as "requested 1080 min ago".
    const opt = makeOptimizer(makeHomey({ low_tank_forced_at: Date.now() - 18 * 3600000 }));
    const result = await opt.optimizeTank(
      inputs({ TankWaterTemperature: 30, OperationMode: 2, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(result.forcedNotStarted).toBeUndefined();
    expect(result.clearForcedRecord).toBe(true);
  });

  test('no report while a reheat is running or before the request has had its chance', async () => {
    const opt = makeOptimizer(makeHomey({ low_tank_forced_at: Date.now() - 60 * 60000 }));
    const running = await opt.optimizeTank(
      inputs({ TankWaterTemperature: 30, OperationMode: 1, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(running.forcedNotStarted).toBeUndefined();

    const fresh = await makeOptimizer(makeHomey({ low_tank_forced_at: Date.now() - 10 * 60000 })).optimizeTank(
      inputs({ TankWaterTemperature: 30, OperationMode: 2, ForcedHotWaterMode: false }), delay, jest.fn());
    expect(fresh.forcedNotStarted).toBeUndefined();
  });
});


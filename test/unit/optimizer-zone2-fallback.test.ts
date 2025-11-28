import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { HomeyLogger } from '../../src/util/logger';

/**
 * Tests for Zone 2 fallback spam prevention
 * Verifies that proper constraint checking and error handling are applied
 */
describe('Optimizer -Zone 2 Fallback', () => {
    let optimizer: Optimizer;
    let mockMelCloud: jest.Mocked<MelCloudApi>;
    let mockLogger: jest.Mocked<HomeyLogger>;

    beforeEach(() => {
        // Mock MELCloud API
        mockMelCloud = {
            setZoneTemperature: jest.fn().mockResolvedValue(undefined),
            getDeviceState: jest.fn(),
            setDeviceTemperature: jest.fn(),
            setTankTemperature: jest.fn(),
            getEnergyData: jest.fn().mockResolvedValue([])
        } as any;

        // Mock Logger
        mockLogger = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            info: jest.fn()
        } as any;

        // Create optimizer with mocked dependencies (no homey, so we can manually configure)
        optimizer = new Optimizer(
            mockMelCloud,
            {} as any, // priceProvider - not needed for these tests
            '123',
            1,
            mockLogger
        );

        // Enable Zone 2 with proper constraints
        optimizer.setZone2TemperatureConstraints(true, 18, 24, 0.5);
        
        // Access constraint manager directly to set Zone 1 deadband
        (optimizer as any).constraintManager.setZone1Deadband(0.5);
        
        // Set min setpoint change minutes
        (optimizer as any).minSetpointChangeMinutes = 30;

        // Initialize the optimizer
        (optimizer as any).initialized = true;
    });

    describe('Missing Price Data Fallback', () => {
        it('should apply constraints and skip API call when target unchanged', async () => {
            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [] }, // Missing price data
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 21.0, // Zone 1 target matches current Zone 2 target
                safeCurrentTarget: 21
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should NOT call MELCloud API (target unchanged)
            expect(mockMelCloud.setZoneTemperature).not.toHaveBeenCalled();

            // Result should indicate no change
            expect(result?.changed).toBe(false);
            expect(result?.action).toBe('hold');
            expect(result?.reason).toContain('fallback');
        });

        it('should apply constraints and call API when target changed beyond deadband', async () => {
            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [] },
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 22.5, // Significantly different from current 21
                safeCurrentTarget: 21
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should call MELCloud API
            expect(mockMelCloud.setZoneTemperature).toHaveBeenCalledWith('123', 1, 22.5, 2);

            // Result should indicate change
            expect(result?.changed).toBe(true);
            expect(result?.success).toBe(true);
            expect(result?.toTemp).toBe(22.5);
        });

        it('should respect lockout and skip API call during lockout period', async () => {
            // Set recent Zone 2 change timestamp (10 minutes ago)
            const recentTimestamp = Date.now() - 10 * 60 * 1000;
            (optimizer as any).stateManager = {
                getZone2LastChange: () => ({ timestamp: recentTimestamp, setpoint: 21 }),
                recordZone2Change: jest.fn(),
                saveToSettings: jest.fn()
            };

            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [] },
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 22.5,
                safeCurrentTarget: 21
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should NOT call MELCloud API (lockout active - 30min minimum)
            expect(mockMelCloud.setZoneTemperature).not.toHaveBeenCalled();

            // Result should indicate lockout
            expect(result?.changed).toBe(false);
            expect(result?.reason).toContain('lockout');
        });

        it('should handle MELCloud API errors without aborting optimization', async () => {
            mockMelCloud.setZoneTemperature.mockRejectedValueOnce(new Error('API timeout'));

            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [] },
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 22.5,
                safeCurrentTarget: 21
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should attempt API call
            expect(mockMelCloud.setZoneTemperature).toHaveBeenCalled();

            // Should return error result but NOT throw
            expect(result).toBeDefined();
            expect(result?.success).toBe(false);
            expect(result?.reason).toContain('Error');
            expect(result?.reason).toContain('API timeout');

            // Should log error
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Zone2 fallback temperature change failed',
                expect.any(Error)
            );
        });

        it('should skip duplicate targets to prevent repeated commands', async () => {
            // Set Zone 2 state with same setpoint as proposed
            (optimizer as any).stateManager = {
                getZone2LastChange: () => ({ timestamp: 0, setpoint: 22.5 }),
                recordZone2Change: jest.fn(),
                saveToSettings: jest.fn()
            };

            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [] },
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 22.5, // Matches stored setpoint
                safeCurrentTarget: 21
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should NOT call MELCloud API (duplicate target)
            expect(mockMelCloud.setZoneTemperature).not.toHaveBeenCalled();

            // Result should indicate duplicate
            expect(result?.changed).toBe(false);
            expect(result?.reason).toContain('duplicate');
        });
    });

    describe('Null Optimizer Result Fallback', () => {
        it('should use same guarded fallback when optimizer returns null', async () => {
            // Mock zone optimizer to return null
            (optimizer as any).zoneOptimizer = {
                optimizeZone2: jest.fn().mockResolvedValue(null)
            };

            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [{ time: '2024-01-01T00:00:00Z', price: 1.0 }] }, // Has price data
                priceStats: { priceLevel: 'NORMAL' },
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 21.0, // Same as current
                safeCurrentTarget: 21,
                weatherInfo: null,
                thermalStrategy: null,
                metrics: null
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should NOT call MELCloud API (target unchanged)
            expect(mockMelCloud.setZoneTemperature).not.toHaveBeenCalled();

            // Result should indicate fallback
            expect(result?.reason).toContain('fallback');
            expect(result?.reason).toContain('optimizer returned null');
        });
    });

    describe('Constraint Application', () => {
        it('should clamp to min/max bounds', async () => {
            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [] },
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 30, // Way above max (24)
                safeCurrentTarget: 21
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should clamp to max and call API
            expect(mockMelCloud.setZoneTemperature).toHaveBeenCalledWith('123', 1, 24, 2);
            expect(result?.toTemp).toBe(24);
        });

        it('should round to temperature step', async () => {
            const inputs = {
                deviceState: {
                    SetTemperatureZone2: 21,
                    RoomTemperatureZone2: 20.5
                },
                priceData: { prices: [] },
                currentTemp: 20
            } as any;

            const zone1Result = {
                targetTemp: 22.37, // Should round to 22.5 (step = 0.5)
                safeCurrentTarget: 21
            } as any;

            const logger = jest.fn();

            const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, logger);

            // Should round to nearest 0.5°C step
            expect(mockMelCloud.setZoneTemperature).toHaveBeenCalledWith('123', 1, 22.5, 2);
            expect(result?.toTemp).toBe(22.5);
        });
    });
});

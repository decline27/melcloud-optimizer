import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';

// Mock dependencies
jest.mock('../../src/services/melcloud-api');
jest.mock('../../src/services/tibber-api');

describe('Optimizer Initialization Tests', () => {
    let mockMelCloud: jest.Mocked<MelCloudApi>;
    let mockTibber: jest.Mocked<TibberApi>;
    let mockLogger: any;

    beforeEach(() => {
        // Create mock MelCloud API
        mockMelCloud = new MelCloudApi() as jest.Mocked<MelCloudApi>;
        mockMelCloud.getEnhancedCOPData = jest.fn().mockResolvedValue({
            current: { heating: 3.5, hotWater: 3.2 },
            daily: { heatingCOP: 3.4, hotWaterCOP: 3.1, averageCOP: 3.3 },
            historical: { heating: 3.3, hotWater: 3.0 }
        });
        mockMelCloud.getEnergyData = jest.fn().mockResolvedValue([
            { Date: '2024-01-01', TotalHeatingConsumed: 15, TotalHotWaterConsumed: 5 },
            { Date: '2024-01-02', TotalHeatingConsumed: 16, TotalHotWaterConsumed: 4 }
        ]);

        // Create mock Tibber API
        mockTibber = new TibberApi('test-token') as jest.Mocked<TibberApi>;

        // Create mock logger
        mockLogger = {
            log: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };
    });

    describe('Constructor Async Operation Fix', () => {
        it('should not be initialized immediately after construction', () => {
            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger
            );

            expect(optimizer.isInitialized()).toBe(false);
        });

        it('should initialize successfully with valid data', async () => {
            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger
            );

            await optimizer.initialize();

            expect(optimizer.isInitialized()).toBe(true);
            expect(mockLogger.log).toHaveBeenCalledWith('Optimizer initialization complete');
        });

        it('should still work after initialization failure (with homey instance)', async () => {
            const mockHomey = {
                settings: {
                    get: jest.fn().mockReturnValue(null),
                    set: jest.fn()
                }
            };

            mockMelCloud.getEnergyData.mockRejectedValue(new Error('API Timeout'));

            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger,
                undefined,
                mockHomey as any
            );

            // Should not throw, initialization errors are caught
            await optimizer.initialize();

            // Should be initialized despite failure (non-fatal)
            expect(optimizer.isInitialized()).toBe(true);
            expect(mockLogger.log).toHaveBeenCalledWith(
                expect.stringContaining('Failed to initialize thermal mass'),
                expect.any(Error)
            );
        });

        it('should handle multiple initialize calls safely (with homey instance)', async () => {
            const mockHomey = {
                settings: {
                    get: jest.fn().mockReturnValue(null),
                    set: jest.fn()
                }
            };

            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger,
                undefined,
                mockHomey as any
            );

            // Call initialize multiple times in parallel
            await Promise.all([
                optimizer.initialize(),
                optimizer.initialize(),
                optimizer.initialize()
            ]);

            expect(optimizer.isInitialized()).toBe(true);
            // Should only fetch energy data once
            expect(mockMelCloud.getEnergyData).toHaveBeenCalledTimes(1);
        });

        it('should auto-initialize when runOptimization is called', async () => {
            mockMelCloud.getDeviceState = jest.fn().mockResolvedValue({
                DeviceID: 123,
                BuildingID: 456,
                RoomTemperature: 21.0,
                SetTemperature: 21.0,
                OutdoorTemperature: 5.0,
                IdleZone1: false
            });
            mockMelCloud.setDeviceTemperature = jest.fn().mockResolvedValue(true);
            mockTibber.getPrices = jest.fn().mockResolvedValue({
                current: { price: 0.15, time: new Date().toISOString() },
                prices: Array.from({ length: 24 }, (_, i) => ({
                    price: 0.10 + (i * 0.01),
                    time: new Date(Date.now() + i * 3600000).toISOString()
                }))
            });

            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger
            );

            // Don't call initialize() explicitly
            expect(optimizer.isInitialized()).toBe(false);

            // runOptimization should auto-initialize
            await optimizer.runOptimization();

            expect(optimizer.isInitialized()).toBe(true);
            expect(mockLogger.warn).toHaveBeenCalledWith('Optimizer not initialized, initializing now...');
        });

        it('should provide initialization status', async () => {
            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger
            );

            let status = optimizer.getInitializationStatus();
            expect(status.initialized).toBe(false);
            expect(status.servicesInitialized).toBe(true);

            await optimizer.initialize();

            status = optimizer.getInitializationStatus();
            expect(status.initialized).toBe(true);
            expect(status.servicesInitialized).toBe(true);
        });

        it('should return immediately on subsequent initialize() calls', async () => {
            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger
            );

            await optimizer.initialize();
            const callCountAfterFirst = mockMelCloud.getEnergyData.mock.calls.length;

            // Call initialize again
            await optimizer.initialize();

            // Should not call getEnergyData again
            expect(mockMelCloud.getEnergyData).toHaveBeenCalledTimes(callCountAfterFirst);
        });

        it('should construct without async operations in constructor', () => {
            const startTime = Date.now();

            const optimizer = new Optimizer(
                mockMelCloud,
                mockTibber,
                'test-device',
                123,
                mockLogger
            );

            const endTime = Date.now();

            // Constructor should complete quickly (< 100ms) since it's fully synchronous
            expect(endTime - startTime).toBeLessThan(100);

            // No API calls should have been made in constructor
            expect(mockMelCloud.getEnergyData).not.toHaveBeenCalled();
        });
    });
});

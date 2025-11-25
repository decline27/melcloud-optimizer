import { StateManager } from '../../src/services/state-manager';
import { HomeyLogger } from '../../src/util/logger';

describe('StateManager', () => {
    let stateManager: StateManager;
    let mockLogger: HomeyLogger;

    beforeEach(() => {
        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
        } as any;

        stateManager = new StateManager(mockLogger);
    });

    describe('Zone 1 State Management', () => {
        test('initializes with no previous changes', () => {
            const record = stateManager.getZone1LastChange();
            expect(record.setpoint).toBeNull();
            expect(record.timestamp).toBeNull();
        });

        test('records Zone 1 setpoint change', () => {
            const testTimestamp = Date.now();
            stateManager.recordZone1Change(21.5, testTimestamp);

            const record = stateManager.getZone1LastChange();
            expect(record.setpoint).toBe(21.5);
            expect(record.timestamp).toBe(testTimestamp);
        });

        test('uses current time if timestamp not provided', () => {
            const before = Date.now();
            stateManager.recordZone1Change(22);
            const after = Date.now();

            const record = stateManager.getZone1LastChange();
            expect(record.timestamp).toBeGreaterThanOrEqual(before);
            expect(record.timestamp).toBeLessThanOrEqual(after);
        });

        test('is not locked out with no previous change', () => {
            expect(stateManager.isZone1LockedOut(30)).toBe(false);
            expect(stateManager.getZone1LockoutRemaining(30)).toBe(0);
        });

        test('is locked out immediately after change', () => {
            stateManager.recordZone1Change(21, Date.now());
            expect(stateManager.isZone1LockedOut(30)).toBe(true);
        });

        test('is not locked out after lockout period expires', () => {
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            stateManager.recordZone1Change(21, oneHourAgo);
            expect(stateManager.isZone1LockedOut(30)).toBe(false);
            expect(stateManager.getZone1LockoutRemaining(30)).toBe(0);
        });

        test('calculates lockout remaining time correctly', () => {
            const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
            stateManager.recordZone1Change(21, tenMinutesAgo);

            const remaining = stateManager.getZone1LockoutRemaining(30);
            expect(remaining).toBeGreaterThan(19); // Should be around 20 minutes
            expect(remaining).toBeLessThanOrEqual(20);
        });
    });

    describe('Zone 2 State Management', () => {
        test('initializes with no previous changes', () => {
            const record = stateManager.getZone2LastChange();
            expect(record.setpoint).toBeNull();
            expect(record.timestamp).toBeNull();
        });

        test('records Zone 2 setpoint change', () => {
            const testTimestamp = Date.now();
            stateManager.recordZone2Change(20.5, testTimestamp);

            const record = stateManager.getZone2LastChange();
            expect(record.setpoint).toBe(20.5);
            expect(record.timestamp).toBe(testTimestamp);
        });

        test('manages lockout independently from Zone 1', () => {
            stateManager.recordZone1Change(21, Date.now());
            stateManager.recordZone2Change(20, Date.now() - (60 * 60 * 1000)); // 1 hour ago

            expect(stateManager.isZone1LockedOut(30)).toBe(true);
            expect(stateManager.isZone2LockedOut(30)).toBe(false);
        });
    });

    describe('Tank State Management', () => {
        test('initializes with no previous changes', () => {
            const record = stateManager.getTankLastChange();
            expect(record.setpoint).toBeNull();
            expect(record.timestamp).toBeNull();
        });

        test('records tank setpoint change', () => {
            const testTimestamp = Date.now();
            stateManager.recordTankChange(50, testTimestamp);

            const record = stateManager.getTankLastChange();
            expect(record.setpoint).toBe(50);
            expect(record.timestamp).toBe(testTimestamp);
        });

        test('manages lockout independently from zones', () => {
            stateManager.recordZone1Change(21, Date.now());
            stateManager.recordTankChange(50, Date.now() - (60 * 60 * 1000)); // 1 hour ago

            expect(stateManager.isZone1LockedOut(30)).toBe(true);
            expect(stateManager.isTankLockedOut(30)).toBe(false);
        });
    });

    describe('Persistence', () => {
        let mockHomey: any;

        beforeEach(() => {
            mockHomey = {
                settings: {
                    get: jest.fn(),
                    set: jest.fn()
                }
            };
        });

        test('saves Zone 1 state to settings', () => {
            const testTimestamp = 1234567890;
            stateManager.recordZone1Change(21.5, testTimestamp);
            stateManager.saveToSettings(mockHomey);

            expect(mockHomey.settings.set).toHaveBeenCalledWith('last_setpoint_change_ms', testTimestamp);
            expect(mockHomey.settings.set).toHaveBeenCalledWith('last_issued_setpoint_c', 21.5);
        });

        test('saves Zone 2 state to settings', () => {
            const testTimestamp = 1234567890;
            stateManager.recordZone2Change(20.5, testTimestamp);
            stateManager.saveToSettings(mockHomey);

            expect(mockHomey.settings.set).toHaveBeenCalledWith('last_zone2_setpoint_change_ms', testTimestamp);
            expect(mockHomey.settings.set).toHaveBeenCalledWith('last_zone2_issued_setpoint_c', 20.5);
        });

        test('saves tank state to settings', () => {
            const testTimestamp = 1234567890;
            stateManager.recordTankChange(50, testTimestamp);
            stateManager.saveToSettings(mockHomey);

            expect(mockHomey.settings.set).toHaveBeenCalledWith('last_tank_setpoint_change_ms', testTimestamp);
            expect(mockHomey.settings.set).toHaveBeenCalledWith('last_tank_issued_setpoint_c', 50);
        });

        test('loads Zone 1 state from settings', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'last_setpoint_change_ms') return 1234567890;
                if (key === 'last_issued_setpoint_c') return 21.5;
                return null;
            });

            stateManager.loadFromSettings(mockHomey);

            const record = stateManager.getZone1LastChange();
            expect(record.setpoint).toBe(21.5);
            expect(record.timestamp).toBe(1234567890);
        });

        test('loads Zone 2 state from settings', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'last_zone2_setpoint_change_ms') return 9876543210;
                if (key === 'last_zone2_issued_setpoint_c') return 20.5;
                return null;
            });

            stateManager.loadFromSettings(mockHomey);

            const record = stateManager.getZone2LastChange();
            expect(record.setpoint).toBe(20.5);
            expect(record.timestamp).toBe(9876543210);
        });

        test('loads tank state from settings', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'last_tank_setpoint_change_ms') return 1111111111;
                if (key === 'last_tank_issued_setpoint_c') return 50;
                return null;
            });

            stateManager.loadFromSettings(mockHomey);

            const record = stateManager.getTankLastChange();
            expect(record.setpoint).toBe(50);
            expect(record.timestamp).toBe(1111111111);
        });

        test('handles missing settings gracefully', () => {
            mockHomey.settings.get.mockReturnValue(null);

            expect(() => {
                stateManager.loadFromSettings(mockHomey);
            }).not.toThrow();

            const zone1 = stateManager.getZone1LastChange();
            expect(zone1.setpoint).toBeNull();
            expect(zone1.timestamp).toBeNull();
        });

        test('rejects invalid timestamps', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'last_setpoint_change_ms') return -1; // Invalid negative timestamp
                if (key === 'last_issued_setpoint_c') return 21.5;
                return null;
            });

            stateManager.loadFromSettings(mockHomey);

            const record = stateManager.getZone1LastChange();
            expect(record.timestamp).toBeNull(); // Should reject invalid timestamp
            expect(record.setpoint).toBe(21.5); // But still load valid setpoint
        });

        test('rejects non-numeric values', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'last_setpoint_change_ms') return 'invalid';
                if (key === 'last_issued_setpoint_c') return NaN;
                return null;
            });

            stateManager.loadFromSettings(mockHomey);

            const record = stateManager.getZone1LastChange();
            expect(record.timestamp).toBeNull();
            expect(record.setpoint).toBeNull();
        });

        test('handles save errors gracefully', () => {
            mockHomey.settings.set.mockImplementation(() => {
                throw new Error('Settings write failed');
            });

            stateManager.recordZone1Change(21);

            expect(() => {
                stateManager.saveToSettings(mockHomey);
            }).not.toThrow();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to save state to settings:',
                expect.any(Error)
            );
        });

        test('handles load errors gracefully', () => {
            mockHomey.settings.get.mockImplementation(() => {
                throw new Error('Settings read failed');
            });

            expect(() => {
                stateManager.loadFromSettings(mockHomey);
            }).not.toThrow();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to load state from settings:',
                expect.any(Error)
            );
        });
    });

    describe('Clear State', () => {
        test('clears all state', () => {
            stateManager.recordZone1Change(21);
            stateManager.recordZone2Change(20);
            stateManager.recordTankChange(50);

            stateManager.clearAllState();

            expect(stateManager.getZone1LastChange().setpoint).toBeNull();
            expect(stateManager.getZone2LastChange().setpoint).toBeNull();
            expect(stateManager.getTankLastChange().setpoint).toBeNull();
        });
    });
});

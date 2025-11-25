import { SettingsLoader } from '../../src/services/settings-loader';
import { HomeyLogger } from '../../src/util/logger';

describe('SettingsLoader', () => {
    let settingsLoader: SettingsLoader;
    let mockLogger: HomeyLogger;
    let mockHomey: any;

    beforeEach(() => {
        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
        } as any;

        mockHomey = {
            settings: {
                get: jest.fn(),
                set: jest.fn()
            }
        };

        settingsLoader = new SettingsLoader(mockHomey, mockLogger);
    });

    describe('Basic Getters', () => {
        test('returns default for missing setting', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const value = settingsLoader.getNumber('missing_key', 42);
            expect(value).toBe(42);
        });

        test('returns actual value when present', () => {
            mockHomey.settings.get.mockReturnValue(100);

            const value = settingsLoader.getNumber('test_key', 42);
            expect(value).toBe(100);
        });

        test('validates number ranges', () => {
            mockHomey.settings.get.mockReturnValue(150);

            const value = settingsLoader.getNumber('test_key', 50, { min: 0, max: 100 });
            expect(value).toBe(50); // Should return default when out of range
        });

        test('accepts values within range', () => {
            mockHomey.settings.get.mockReturnValue(75);

            const value = settingsLoader.getNumber('test_key', 50, { min: 0, max: 100 });
            expect(value).toBe(75);
        });

        test('rejects non-finite numbers', () => {
            mockHomey.settings.get.mockReturnValue(NaN);

            const value = settingsLoader.getNumber('test_key', 42);
            expect(value).toBe(42);
        });

        test('gets boolean values', () => {
            mockHomey.settings.get.mockReturnValue(true);

            const value = settingsLoader.getBoolean('test_key', false);
            expect(value).toBe(true);
        });

        test('gets string values', () => {
            mockHomey.settings.get.mockReturnValue('test_value');

            const value = settingsLoader.getString('test_key', 'default');
            expect(value).toBe('test_value');
        });

        test('returns default for non-string values', () => {
            mockHomey.settings.get.mockReturnValue(123);

            const value = settingsLoader.getString('test_key', 'default');
            expect(value).toBe('default');
        });
    });

    describe('COP Settings', () => {
        test('loads COP settings with defaults', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const settings = settingsLoader.loadCOPSettings();

            expect(settings.weight).toBe(0.3);
            expect(settings.autoSeasonalMode).toBe(true);
            expect(settings.summerMode).toBe(false);
        });

        test('loads COP settings from Homey', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'cop_weight') return 0.5;
                if (key === 'auto_seasonal_mode') return false;
                if (key === 'summer_mode') return true;
                return null;
            });

            const settings = settingsLoader.loadCOPSettings();

            expect(settings.weight).toBe(0.5);
            expect(settings.autoSeasonalMode).toBe(false);
            expect(settings.summerMode).toBe(true);
        });

        test('validates COP weight range', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'cop_weight') return 2.0; // Out of range
                return null;
            });

            const settings = settingsLoader.loadCOPSettings();
            expect(settings.weight).toBe(0.3); // Should use default
        });

        test('saves COP settings', () => {
            const copSettings = {
                weight: 0.4,
                autoSeasonalMode: false,
                summerMode: true
            };

            settingsLoader.saveCOPSettings(copSettings);

            expect(mockHomey.settings.set).toHaveBeenCalledWith('cop_weight', 0.4);
            expect(mockHomey.settings.set).toHaveBeenCalledWith('auto_seasonal_mode', false);
            expect(mockHomey.settings.set).toHaveBeenCalledWith('summer_mode', true);
        });
    });

    describe('Constraint Settings', () => {
        test('loads constraint settings with defaults', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const settings = settingsLoader.loadConstraintSettings();

            expect(settings.minSetpointChangeMinutes).toBe(30);
            expect(settings.deadband).toBe(0.5);
            expect(settings.tempStepMax).toBe(0.5);
        });

        test('loads constraint settings from Homey', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'min_setpoint_change_minutes') return 45;
                if (key === 'deadband_c') return 0.3;
                if (key === 'temp_step_max') return 1.0;
                return null;
            });

            const settings = settingsLoader.loadConstraintSettings();

            expect(settings.minSetpointChangeMinutes).toBe(45);
            expect(settings.deadband).toBe(0.3);
            expect(settings.tempStepMax).toBe(1.0);
        });

        test('validates constraint ranges', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'min_setpoint_change_minutes') return 200; // Out of range
                if (key === 'deadband_c') return 5.0; // Out of range
                return null;
            });

            const settings = settingsLoader.loadConstraintSettings();

            expect(settings.minSetpointChangeMinutes).toBe(30); // Default
            expect(settings.deadband).toBe(0.5); // Default
        });
    });

    describe('Price Settings', () => {
        test('loads price settings with defaults', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const settings = settingsLoader.loadPriceSettings();
            expect(settings.cheapPercentile).toBe(0.25);
        });

        test('loads price settings from Homey', () => {
            mockHomey.settings.get.mockReturnValue(0.3);

            const settings = settingsLoader.loadPriceSettings();
            expect(settings.cheapPercentile).toBe(0.3);
        });

        test('saves price settings', () => {
            settingsLoader.savePriceSettings({ cheapPercentile: 0.2 });

            expect(mockHomey.settings.set).toHaveBeenCalledWith('preheat_cheap_percentile', 0.2);
        });
    });

    describe('Timezone Settings', () => {
        test('loads timezone settings with defaults', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const settings = settingsLoader.loadTimezoneSettings();

            expect(settings.offset).toBe(1);
            expect(settings.useDST).toBe(false);
            expect(settings.name).toBeUndefined();
        });

        test('loads timezone settings from Homey', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'time_zone_offset') return 2;
                if (key === 'use_dst') return true;
                if (key === 'time_zone_name') return 'Europe/Oslo';
                return null;
            });

            const settings = settingsLoader.loadTimezoneSettings();

            expect(settings.offset).toBe(2);
            expect(settings.useDST).toBe(true);
            expect(settings.name).toBe('Europe/Oslo');
        });

        test('handles empty timezone name', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'time_zone_name') return '';
                return null;
            });

            const settings = settingsLoader.loadTimezoneSettings();
            expect(settings.name).toBeUndefined();
        });
    });

    describe('Occupancy Settings', () => {
        test('loads occupancy with default (occupied)', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const settings = settingsLoader.loadOccupancySettings();
            expect(settings.occupied).toBe(true);
        });

        test('loads occupancy from Homey', () => {
            mockHomey.settings.get.mockReturnValue(false);

            const settings = settingsLoader.loadOccupancySettings();
            expect(settings.occupied).toBe(false);
        });

        test('saves occupancy', () => {
            settingsLoader.saveOccupancy(false);

            expect(mockHomey.settings.set).toHaveBeenCalledWith('occupied', false);
        });
    });

    describe('Currency and Grid Fee', () => {
        test('gets currency from primary setting', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'currency') return 'EUR';
                return null;
            });

            const currency = settingsLoader.getCurrency();
            expect(currency).toBe('EUR');
        });

        test('gets currency from fallback setting', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'currency_code') return 'SEK';
                return null;
            });

            const currency = settingsLoader.getCurrency();
            expect(currency).toBe('SEK');
        });

        test('uses default currency when missing', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const currency = settingsLoader.getCurrency();
            expect(currency).toBe('NOK');
        });

        test('gets grid fee', () => {
            mockHomey.settings.get.mockReturnValue(0.5);

            const gridFee = settingsLoader.getGridFee();
            expect(gridFee).toBe(0.5);
        });

        test('returns 0 for missing grid fee', () => {
            mockHomey.settings.get.mockReturnValue(null);

            const gridFee = settingsLoader.getGridFee();
            expect(gridFee).toBe(0);
        });
    });

    describe('Load All Settings', () => {
        test('loads all settings together', () => {
            mockHomey.settings.get.mockImplementation((key: string) => {
                if (key === 'cop_weight') return 0.4;
                if (key === 'min_setpoint_change_minutes') return 45;
                if (key === 'preheat_cheap_percentile') return 0.3;
                if (key === 'time_zone_offset') return 2;
                if (key === 'occupied') return false;
                return null;
            });

            const allSettings = settingsLoader.loadAllSettings();

            expect(allSettings.cop.weight).toBe(0.4);
            expect(allSettings.constraints.minSetpointChangeMinutes).toBe(45);
            expect(allSettings.price.cheapPercentile).toBe(0.3);
            expect(allSettings.timezone.offset).toBe(2);
            expect(allSettings.occupancy.occupied).toBe(false);
        });
    });

    describe('Error Handling', () => {
        test('handles save errors', () => {
            mockHomey.settings.set.mockImplementation(() => {
                throw new Error('Save failed');
            });

            expect(() => {
                settingsLoader.saveSetting('test_key', 'value');
            }).toThrow('Save failed');

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});

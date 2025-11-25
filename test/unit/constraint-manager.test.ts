import { ConstraintManager } from '../../src/services/constraint-manager';
import { HomeyLogger } from '../../src/util/logger';

describe('ConstraintManager', () => {
    let constraintManager: ConstraintManager;
    let mockLogger: HomeyLogger;

    beforeEach(() => {
        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
        } as any;

        constraintManager = new ConstraintManager(mockLogger);
    });

    describe('Zone 1 Constraints', () => {
        test('initializes with default values', () => {
            const constraints = constraintManager.getZone1Constraints();

            expect(constraints.minTemp).toBe(18);
            expect(constraints.maxTemp).toBe(23);
            expect(constraints.tempStep).toBe(0.5);
            expect(constraints.deadband).toBe(0.5);
        });

        test('sets valid Zone 1 constraints', () => {
            constraintManager.setZone1Constraints(18, 24, 0.5);

            const constraints = constraintManager.getZone1Constraints();
            expect(constraints.minTemp).toBe(18);
            expect(constraints.maxTemp).toBe(24);
            expect(constraints.tempStep).toBe(0.5);
            expect(mockLogger.log).toHaveBeenCalledWith(
                expect.stringContaining('Zone 1 constraints updated')
            );
        });

        test('rejects invalid temperature range (max <= min)', () => {
            expect(() => {
                constraintManager.setZone1Constraints(22, 20, 0.5);
            }).toThrow('Invalid Zone 1 temperature range');
        });

        test('rejects out-of-bounds minimum temperature', () => {
            expect(() => {
                constraintManager.setZone1Constraints(5, 22, 0.5);
            }).toThrow();
        });

        test('rejects out-of-bounds maximum temperature', () => {
            expect(() => {
                constraintManager.setZone1Constraints(20, 35, 0.5);
            }).toThrow();
        });

        test('rejects invalid temperature step', () => {
            expect(() => {
                constraintManager.setZone1Constraints(20, 22, 2.0);
            }).toThrow();
        });

        test('applies Zone 1 constraints correctly', () => {
            constraintManager.setZone1Constraints(18, 24, 0.5);

            // Within range
            expect(constraintManager.applyZone1Constraints(20.3)).toBe(20.5);

            // Below minimum
            expect(constraintManager.applyZone1Constraints(15)).toBe(18);

            // Above maximum
            expect(constraintManager.applyZone1Constraints(30)).toBe(24);

            // Exact step
            expect(constraintManager.applyZone1Constraints(21.5)).toBe(21.5);
        });

        test('sets and gets deadband', () => {
            constraintManager.setZone1Deadband(0.5);

            const constraints = constraintManager.getZone1Constraints();
            expect(constraints.deadband).toBe(0.5);
        });

        test('rejects invalid deadband', () => {
            expect(() => {
                constraintManager.setZone1Deadband(3.0);
            }).toThrow();
        });
    });

    describe('Zone 2 Constraints', () => {
        test('initializes with default values (disabled)', () => {
            const constraints = constraintManager.getZone2Constraints();

            expect(constraints.enabled).toBe(false);
            expect(constraints.minTemp).toBe(18);
            expect(constraints.maxTemp).toBe(23);
            expect(constraints.tempStep).toBe(1.0);
        });

        test('sets valid Zone 2 constraints', () => {
            constraintManager.setZone2Constraints(true, 17, 23, 0.5);

            const constraints = constraintManager.getZone2Constraints();
            expect(constraints.enabled).toBe(true);
            expect(constraints.minTemp).toBe(17);
            expect(constraints.maxTemp).toBe(23);
            expect(constraints.tempStep).toBe(0.5);
        });

        test('rejects invalid Zone 2 temperature range', () => {
            expect(() => {
                constraintManager.setZone2Constraints(true, 23, 20, 0.5);
            }).toThrow('Invalid Zone 2 temperature range');
        });

        test('applies Zone 2 constraints correctly', () => {
            constraintManager.setZone2Constraints(true, 17, 23, 0.5);

            // Within range
            expect(constraintManager.applyZone2Constraints(20.3)).toBe(20.5);

            // Below minimum
            expect(constraintManager.applyZone2Constraints(15)).toBe(17);

            // Above maximum
            expect(constraintManager.applyZone2Constraints(25)).toBe(23);
        });

        test('allows larger step size for Zone 2', () => {
            constraintManager.setZone2Constraints(true, 17, 23, 1.0);

            const constraints = constraintManager.getZone2Constraints();
            expect(constraints.tempStep).toBe(1.0);

            expect(constraintManager.applyZone2Constraints(20.3)).toBe(20);
        });
    });

    describe('Tank Constraints', () => {
        test('initializes with default values (disabled)', () => {
            const constraints = constraintManager.getTankConstraints();

            expect(constraints.enabled).toBe(false);
            expect(constraints.minTemp).toBe(40);
            expect(constraints.maxTemp).toBe(60);
            expect(constraints.tempStep).toBe(1);
        });

        test('sets valid tank constraints', () => {
            constraintManager.setTankConstraints(true, 35, 60, 2);

            const constraints = constraintManager.getTankConstraints();
            expect(constraints.enabled).toBe(true);
            expect(constraints.minTemp).toBe(35);
            expect(constraints.maxTemp).toBe(60);
            expect(constraints.tempStep).toBe(2);
        });

        test('rejects invalid tank temperature range', () => {
            expect(() => {
                constraintManager.setTankConstraints(true, 60, 40, 1);
            }).toThrow('Invalid tank temperature range');
        });

        test('rejects out-of-bounds tank temperatures', () => {
            expect(() => {
                constraintManager.setTankConstraints(true, 20, 60, 1);
            }).toThrow();

            expect(() => {
                constraintManager.setTankConstraints(true, 40, 80, 1);
            }).toThrow();
        });

        test('applies tank constraints correctly', () => {
            constraintManager.setTankConstraints(true, 40, 60, 2);

            // Within range
            expect(constraintManager.applyTankConstraints(51)).toBe(52);

            // Below minimum
            expect(constraintManager.applyTankConstraints(35)).toBe(40);

            // Above maximum
            expect(constraintManager.applyTankConstraints(65)).toBe(60);
        });
    });

    describe('Comfort Band', () => {
        test('returns Zone 1 constraints when no settings provided', () => {
            constraintManager.setZone1Constraints(19, 23, 0.5);

            const band = constraintManager.getCurrentComfortBand(true);
            expect(band.minTemp).toBe(19);
            expect(band.maxTemp).toBe(23);
        });

        test('uses occupied comfort band when home', () => {
            const mockSettings = {
                get: jest.fn((key: string) => {
                    if (key === 'comfort_lower_occupied') return 20.5;
                    if (key === 'comfort_upper_occupied') return 21.5;
                    return null;
                })
            };

            const band = constraintManager.getCurrentComfortBand(true, mockSettings);
            expect(band.minTemp).toBe(20.5);
            expect(band.maxTemp).toBe(21.5);
        });

        test('uses away comfort band when away', () => {
            const mockSettings = {
                get: jest.fn((key: string) => {
                    if (key === 'comfort_lower_away') return 18.5;
                    if (key === 'comfort_upper_away') return 19.5;
                    return null;
                })
            };

            const band = constraintManager.getCurrentComfortBand(false, mockSettings);
            expect(band.minTemp).toBe(18.5);
            expect(band.maxTemp).toBe(19.5);
        });

        test('uses defaults for missing occupied settings', () => {
            const mockSettings = {
                get: jest.fn(() => null)
            };

            const band = constraintManager.getCurrentComfortBand(true, mockSettings);
            expect(band.minTemp).toBe(20.0);
            expect(band.maxTemp).toBe(21.0);
        });

        test('uses defaults for missing away settings', () => {
            const mockSettings = {
                get: jest.fn(() => null)
            };

            const band = constraintManager.getCurrentComfortBand(false, mockSettings);
            expect(band.minTemp).toBe(19.0);
            expect(band.maxTemp).toBe(20.5);
        });

        test('clamps comfort band to safe limits', () => {
            const mockSettings = {
                get: jest.fn((key: string) => {
                    if (key === 'comfort_lower_occupied') return 10; // Too low
                    if (key === 'comfort_upper_occupied') return 30; // Too high
                    return null;
                })
            };

            const band = constraintManager.getCurrentComfortBand(true, mockSettings);
            expect(band.minTemp).toBe(16); // Clamped to minimum
            expect(band.maxTemp).toBe(26); // Clamped to maximum
        });

        test('handles invalid settings gracefully', () => {
            const mockSettings = {
                get: jest.fn((key: string) => 'invalid')
            };

            const band = constraintManager.getCurrentComfortBand(true, mockSettings);
            expect(band.minTemp).toBe(20.0);
            expect(band.maxTemp).toBe(21.0);
        });
    });

    describe('Constraint Immutability', () => {
        test('returns copies of constraints, not references', () => {
            const constraints1 = constraintManager.getZone1Constraints();
            constraints1.minTemp = 999;

            const constraints2 = constraintManager.getZone1Constraints();
            expect(constraints2.minTemp).not.toBe(999);
            expect(constraints2.minTemp).toBe(18);
        });
    });
});

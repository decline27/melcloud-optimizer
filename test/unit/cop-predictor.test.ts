import { COPPredictor } from '../../src/services/cop-predictor';

describe('COPPredictor', () => {
    let copPredictor: COPPredictor;
    let mockHomey: any;
    let mockLogger: any;
    let settingsStore: any = {};

    beforeEach(() => {
        settingsStore = {};
        mockHomey = {
            settings: {
                get: (key: string) => settingsStore[key],
                set: (key: string, value: any) => { settingsStore[key] = value; }
            }
        };
        mockLogger = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
        copPredictor = new COPPredictor(mockHomey, mockLogger);
    });

    describe('predictCOP', () => {
        it('should calculate Carnot COP correctly', () => {
            // Flow 35°C, Outdoor 7°C -> Lift 28°C
            // T_sink = 308.15 K
            // Carnot = 308.15 / 28 = 11.005
            // With default efficiency 0.4 -> COP ~ 4.4
            const prediction = copPredictor.predictCOP(35, 7);
            expect(prediction.predictedCOP).toBeCloseTo(4.4, 1);
            expect(prediction.carnotCOP).toBeCloseTo(11.0, 1);
        });

        it('should handle low temperature lift', () => {
            // Flow 25°C, Outdoor 20°C -> Lift 5°C
            const prediction = copPredictor.predictCOP(25, 20);
            expect(prediction.predictedCOP).toBeGreaterThan(0);
            expect(prediction.confidence).toBeLessThan(1.0); // Should have lower confidence
        });

        it('should clamp COP to realistic bounds', () => {
            // Very high efficiency scenario
            // Flow 25°C, Outdoor 24°C -> Lift 1°C -> Carnot ~298
            // Predicted would be huge, should clamp to 6.0
            const prediction = copPredictor.predictCOP(25, 24);
            expect(prediction.predictedCOP).toBe(6.0);
        });
    });

    describe('calibration', () => {
        it('should calibrate efficiency from data points', () => {
            // Add data points consistent with efficiency 0.5
            // Point 1: Flow 35, Outdoor 7 (Lift 28, Carnot 11.0) -> Actual COP 5.5
            copPredictor.addCalibrationPoint(35, 7, 5.5);

            // Point 2: Flow 45, Outdoor 0 (Lift 45, Carnot 7.07) -> Actual COP 3.5
            copPredictor.addCalibrationPoint(45, 0, 3.53);

            // Need 7 points to calibrate
            for (let i = 0; i < 5; i++) {
                copPredictor.addCalibrationPoint(35, 7, 5.5);
            }

            const result = copPredictor.calibrate();
            expect(result).not.toBeNull();
            expect(result?.carnotEfficiency).toBeCloseTo(0.5, 1);
            expect(result?.sampleCount).toBe(7);
        });

        it('should save calibration to settings', () => {
            copPredictor.addCalibrationPoint(35, 7, 4.0);
            expect(settingsStore['cop_predictor_calibration_data']).toHaveLength(1);
        });
    });
});

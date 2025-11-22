import { Optimizer } from '../../src/services/optimizer';
import { createMockLogger } from '../mocks';

const mockMel: any = {
    getEnhancedCOPData: jest.fn(),
    getDailyEnergyTotals: jest.fn(),
    getDeviceState: jest.fn(),
    setDeviceTemperature: jest.fn(),
    setZoneTemperature: jest.fn(),
    setTankTemperature: jest.fn(),
    setFlowTemperature: jest.fn(),
    setCurveShift: jest.fn()
};

const mockTibber: any = {
    getPrices: jest.fn()
};

describe('Optimizer Adaptive COP Thresholds', () => {
    let optimizer: Optimizer;
    let logger = createMockLogger();

    beforeEach(() => {
        jest.clearAllMocks();
        logger = createMockLogger();

        // Setup mock device state
        mockMel.getDeviceState.mockResolvedValue({
            RoomTemperature: 20,
            SetTemperature: 20,
            OutdoorTemperature: 5,
            OperationModeZone1: 1, // Flow Mode
            HCControlType: 1,
            SetHeatFlowTemperatureZone1: 35
        });

        mockMel.setFlowTemperature.mockResolvedValue(true);

        // Setup mock prices (Cheap)
        const nowIso = new Date().toISOString();
        mockTibber.getPrices.mockResolvedValue({
            current: { price: 0.1, time: nowIso }, // Cheap
            prices: new Array(24).fill(0).map((_, i) => ({
                price: i < 4 ? 0.1 : 0.5, // Only 4 hours cheap (16%) -> CHEAP
                time: new Date(Date.now() + i * 3600000).toISOString()
            }))
        });

        optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any);
    });

    test('should apply efficiency boost when predicted COP is in top 25% of history', async () => {
        // 1. Seed history with low COP values (avg ~2.5)
        const lowCOPs = [2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9];
        lowCOPs.forEach(cop => (optimizer as any).updateCOPRange(cop));

        // 2. Mock COP Predictor
        const mockPredictor = {
            predictCOP: jest.fn().mockReturnValue({
                predictedCOP: 3.5,
                confidence: 0.9
            }),
            addCalibrationPoint: jest.fn()
        };
        (optimizer as any).copPredictor = mockPredictor;

        // 3. Run Optimization
        const result = await optimizer.runEnhancedOptimization();

        // 4. Verify Result
        expect(mockMel.setFlowTemperature).toHaveBeenCalledWith('device-1', 1, 44, 1);
        expect(result.reason).toContain('Eff. Boost');
    });

    test('should NOT apply efficiency boost if predicted COP is average', async () => {
        // 1. Seed history with high COP values
        const highCOPs = [4.0, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9];
        highCOPs.forEach(cop => (optimizer as any).updateCOPRange(cop));

        // 2. Mock COP Predictor
        const mockPredictor = {
            predictCOP: jest.fn().mockReturnValue({
                predictedCOP: 3.5,
                confidence: 0.9
            }),
            addCalibrationPoint: jest.fn()
        };
        (optimizer as any).copPredictor = mockPredictor;

        // 3. Run Optimization
        const result = await optimizer.runEnhancedOptimization();

        // 4. Verify Result
        expect(mockMel.setFlowTemperature).toHaveBeenCalledWith('device-1', 1, 43, 1);
        expect(result.reason).not.toContain('Eff. Boost');
    });
});

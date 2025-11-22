
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

describe('Optimizer Comfort Regression Investigation', () => {
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

        // Setup mock prices (Expensive)
        const nowIso = new Date().toISOString();
        mockTibber.getPrices.mockResolvedValue({
            current: { price: 1.0, time: nowIso }, // Expensive
            prices: new Array(24).fill(0).map((_, i) => ({
                price: i < 4 ? 1.0 : 0.5, // Mostly cheap, but current is expensive
                time: new Date(Date.now() + i * 3600000).toISOString()
            }))
        });

        optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any);

        // Seed history with "Poor" efficiency (COP ~2.5) so 4.5 is considered "Good"
        const lowCOPs = [2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9];
        lowCOPs.forEach(cop => (optimizer as any).updateCOPRange(cop));
    });

    test('should NOT aggressively cut temperature when efficiency is GOOD, even if price is EXPENSIVE', async () => {
        // Mock COP Predictor to return "Good" efficiency
        const mockPredictor = {
            predictCOP: jest.fn().mockReturnValue({
                predictedCOP: 4.5, // Good COP (vs 2.5 avg)
                confidence: 0.9
            }),
            addCalibrationPoint: jest.fn()
        };
        (optimizer as any).copPredictor = mockPredictor;

        // Run Optimization
        const result = await optimizer.runEnhancedOptimization();

        // Base Flow Calculation: 42 - (0.8 * 5) = 38°C
        // Price is VERY EXPENSIVE (1.0 vs 0.5) -> Shift -5°C
        // Comfort Protection (Good COP) -> +1°C
        // Result: 38 - 5 + 1 = 34°C

        expect(mockMel.setFlowTemperature).toHaveBeenCalledWith('device-1', 1, 34, 1);
        expect(result.reason).toContain('Comfort Prot.');
    });
});

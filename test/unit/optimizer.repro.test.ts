
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

describe('Optimizer Mode-Aware Logic', () => {
    let optimizer: Optimizer;
    let logger = createMockLogger();

    beforeEach(() => {
        jest.clearAllMocks();
        logger = createMockLogger();

        // Default to Room Mode (0)
        mockMel.getDeviceState.mockResolvedValue({
            RoomTemperature: 20,
            SetTemperature: 20,
            OutdoorTemperature: 5,
            OperationModeZone1: 0,
            HCControlType: 0
        });

        mockMel.setDeviceTemperature.mockResolvedValue(true);
        mockMel.setFlowTemperature.mockResolvedValue(true);
        mockMel.setCurveShift.mockResolvedValue(true);

        const nowIso = new Date().toISOString();
        mockTibber.getPrices.mockResolvedValue({
            current: { price: 0.5, time: nowIso },
            prices: new Array(24).fill(0).map((_, i) => ({ price: 0.5, time: new Date(Date.now() + i * 3600000).toISOString() }))
        });

        optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any);
        // Enable tank control for hot water checks
        optimizer.setTankTemperatureConstraints(true, 40, 60, 1);
    });

    test('Flow Mode: should call setFlowTemperature and NOT setDeviceTemperature', async () => {
        // Setup Flow Mode (1)
        mockMel.getDeviceState.mockResolvedValue({
            RoomTemperature: 20,
            SetTemperature: 20,
            OutdoorTemperature: 5,
            OperationModeZone1: 1, // Flow Mode
            HCControlType: 1
        });

        const result = await optimizer.runEnhancedOptimization();

        expect(mockMel.setFlowTemperature).toHaveBeenCalled();
        expect(mockMel.setDeviceTemperature).not.toHaveBeenCalled();
        expect(result.action).toBe('temperature_adjusted');
        expect(result.reason).toContain('[FLOW MODE]');
    });

    test('Curve Mode: should call setCurveShift and NOT setDeviceTemperature', async () => {
        // Setup Curve Mode (2)
        mockMel.getDeviceState.mockResolvedValue({
            RoomTemperature: 20,
            SetTemperature: 20,
            OutdoorTemperature: 5,
            OperationModeZone1: 2, // Curve Mode
            HCControlType: 2
        });

        const result = await optimizer.runEnhancedOptimization();

        expect(mockMel.setCurveShift).toHaveBeenCalled();
        expect(mockMel.setDeviceTemperature).not.toHaveBeenCalled();
        expect(result.action).toBe('temperature_adjusted');
        expect(result.reason).toContain('[CURVE MODE]');
    });

    test('Room Mode: should call setDeviceTemperature and NOT setFlowTemperature', async () => {
        // Setup Room Mode (0)
        mockMel.getDeviceState.mockResolvedValue({
            RoomTemperature: 20,
            SetTemperature: 20,
            OutdoorTemperature: 5,
            OperationModeZone1: 0, // Room Mode
            HCControlType: 0
        });

        // Make price cheap to force a temperature increase
        // We need variance in the prices array so min != max
        const prices = new Array(24).fill(0).map((_, i) => ({
            price: i % 2 === 0 ? 0.5 : 1.0, // Mix of 0.5 and 1.0
            time: new Date(Date.now() + i * 3600000).toISOString()
        }));

        mockTibber.getPrices.mockResolvedValue({
            current: { price: 0.1, time: new Date().toISOString() }, // Cheap (0.1 < 0.5)
            prices: prices
        });

        // Mock getDailyEnergyTotals to avoid errors
        mockMel.getDailyEnergyTotals.mockResolvedValue({
            TotalHeatingConsumed: 10,
            TotalHotWaterConsumed: 5
        });

        const result = await optimizer.runEnhancedOptimization();

        expect(mockMel.setDeviceTemperature).toHaveBeenCalled();
        expect(mockMel.setFlowTemperature).not.toHaveBeenCalled();
        expect(mockMel.setCurveShift).not.toHaveBeenCalled();
    });

    test('Hot Water: should be optimized regardless of mode', async () => {
        // Setup Flow Mode (1) - Heating should return early, but Hot Water should run first
        mockMel.getDeviceState.mockResolvedValue({
            RoomTemperature: 20,
            SetTemperature: 20,
            OutdoorTemperature: 5,
            OperationModeZone1: 1, // Flow Mode
            SetTankWaterTemperature: 45
        });

        // Mock getOptimalTankTemperature to return a new value
        (optimizer as any).homey = {
            hotWaterService: {
                getOptimalTankTemperature: jest.fn().mockReturnValue(55)
            },
            settings: {
                get: jest.fn(),
                set: jest.fn()
            }
        };

        const result = await optimizer.runEnhancedOptimization();

        // Check that tank temperature was set
        expect(mockMel.setTankTemperature).toHaveBeenCalledWith('device-1', 1, 55);

        // Check that flow temperature was ALSO set (since it's Flow Mode)
        expect(mockMel.setFlowTemperature).toHaveBeenCalled();
    });
});

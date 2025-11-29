
import { CalibrationService } from '../../src/services/calibration-service';

function makeLogger() {
    return {
        log: jest.fn(),
        error: jest.fn()
    };
}

function makeThermalController() {
    return {
        getThermalModel: jest.fn().mockReturnValue({ K: 1.0, S: 0.5 }),
        setThermalModel: jest.fn()
    } as any;
}

function makeThermalModelService() {
    return {
        getThermalCharacteristics: jest.fn().mockReturnValue({
            heatingRate: 0.5,
            coolingRate: 0.1,
            modelConfidence: 0.8,
            thermalMass: 0.5
        }),
        forceModelUpdate: jest.fn(),
        forceDataCleanup: jest.fn().mockReturnValue({ success: true, message: 'Cleaned up' })
    } as any;
}

describe('PR #10: History Cleanup', () => {
    it('should call forceDataCleanup during weekly calibration', async () => {
        const logger = makeLogger();
        const thermalController = makeThermalController();
        const thermalModelService = makeThermalModelService();

        const service = new CalibrationService(
            logger,
            thermalController,
            thermalModelService,
            null,
            true
        );

        // Run calibration
        await service.runWeeklyCalibration();

        // Verify cleanup was called
        expect(thermalModelService.forceDataCleanup).toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Running periodic optimization history cleanup'));
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('History cleanup successful'));
    });

    it('should handle cleanup errors gracefully', async () => {
        const logger = makeLogger();
        const thermalController = makeThermalController();
        const thermalModelService = makeThermalModelService();

        // Mock cleanup failure
        thermalModelService.forceDataCleanup.mockReturnValue({ success: false, message: 'Failed' });

        const service = new CalibrationService(
            logger,
            thermalController,
            thermalModelService,
            null,
            true
        );

        await service.runWeeklyCalibration();

        expect(thermalModelService.forceDataCleanup).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('History cleanup failed'));
    });

    it('should not crash if thermal model service is missing', async () => {
        const logger = makeLogger();
        const thermalController = makeThermalController();

        const service = new CalibrationService(
            logger,
            thermalController,
            null, // No thermal model service
            null,
            false
        );

        await service.runWeeklyCalibration();

        // Should complete without error
        expect(logger.log).not.toHaveBeenCalledWith(expect.stringContaining('Running periodic optimization history cleanup'));
    });
});

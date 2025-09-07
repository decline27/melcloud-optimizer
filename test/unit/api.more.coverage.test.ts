describe('Api additional coverage for edge cases', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('getMemoryUsage includes thermal model memory if available', async () => {
    jest.isolateModules(async () => {
      // Mock api.js to expose optimizer with thermalModelService
      jest.doMock('../../api.js', () => ({
        optimizer: {
          thermalModelService: {
            getMemoryUsage: jest.fn().mockReturnValue({
              points: 123,
              bytes: 45678,
            }),
          },
        },
      }));

      const { Api } = await import('../../src/api');

      const app: any = {
        log: jest.fn(),
        error: jest.fn(),
        homey: {},
      };

      const api = new Api(app);
      const res: any = await api.getMemoryUsage();

      expect(res.success).toBe(true);
      expect(res.processMemory).toBeDefined();
      expect(res.thermalModelMemory).toEqual({ points: 123, bytes: 45678 });
    });
  });

  test('getMemoryUsage handles require error path', async () => {
    jest.isolateModules(async () => {
      // Make require of ../../api.js throw when called inside method
      jest.doMock('../../api.js', () => {
        throw new Error('Injected require failure');
      });

      const { Api } = await import('../../src/api');

      const app: any = {
        log: jest.fn(),
        error: jest.fn(),
        homey: {},
      };

      const api = new Api(app);
      const res: any = await api.getMemoryUsage();
      expect(res.success).toBe(false);
      expect(res.message).toContain('Error getting memory usage');
    });
  });

  test('clearHotWaterData with clearAggregated=false', async () => {
    jest.isolateModules(async () => {
      const { Api } = await import('../../src/api');
      const app: any = {
        log: jest.fn(),
        error: jest.fn(),
        hotWaterService: { clearData: jest.fn().mockResolvedValue(undefined) },
      };
      const api = new Api(app);
      const res: any = await api.clearHotWaterData({ clearAggregated: false });
      expect(app.log).toHaveBeenCalledWith(
        'API method clearHotWaterData called (clearAggregated: false)'
      );
      expect(app.hotWaterService.clearData).toHaveBeenCalledWith(false);
      expect(res).toEqual({
        success: true,
        message: 'Hot water usage data has been cleared (kept aggregated data)',
      });
    });
  });
});


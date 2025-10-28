describe('Api additional coverage for edge cases', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
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

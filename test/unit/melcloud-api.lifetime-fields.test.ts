import { MelCloudApi } from '../../src/services/melcloud-api';

describe('MELCloud API EnergyCost/Report response structure', () => {
  it('should contain lifetime or accumulated total fields if present', async () => {
    // Mock logger
    const logger: any = { info: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const api = new MelCloudApi(logger);

    // Example mock response with possible lifetime/accumulated fields
    const mockApiResponse = {
      TotalHeatingConsumed: 12.34,
      TotalHeatingProduced: 56.78,
      TotalHotWaterConsumed: 9.87,
      TotalHotWaterProduced: 65.43,
      LifetimeHeatingConsumed: 1234.56, // hypothetical field
      LifetimeHeatingProduced: 5678.90, // hypothetical field
      AccumulatedHotWaterConsumed: 987.65, // hypothetical field
      AccumulatedHotWaterProduced: 6543.21 // hypothetical field
    };

    // Patch getEnergyData to return the mock response
    jest.spyOn(api as any, 'getEnergyData').mockResolvedValueOnce(mockApiResponse);

    const result = await api.getDailyEnergyTotals('1', 1);

    // Check for presence of lifetime/accumulated fields in the API response
    expect(result).toHaveProperty('LifetimeHeatingConsumed');
    expect(result).toHaveProperty('LifetimeHeatingProduced');
    expect(result).toHaveProperty('AccumulatedHotWaterConsumed');
    expect(result).toHaveProperty('AccumulatedHotWaterProduced');
  });
});

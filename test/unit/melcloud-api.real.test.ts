import { MelCloudApi } from '../../src/services/melcloud-api';

// Simplified test that doesn't use complex mocking to avoid stalling
describe('MelCloudApi', () => {
  let melCloudApi: MelCloudApi;

  beforeEach(() => {
    melCloudApi = new MelCloudApi();
    
    // Mock the logger to prevent errors
    (melCloudApi as any).logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      api: jest.fn()
    };

    // Mock the errorHandler to prevent errors
    (melCloudApi as any).errorHandler = {
      logError: jest.fn(),
      createAppError: jest.fn().mockReturnValue(new Error('Mock error'))
    };
  });

  afterEach(() => {
    if (melCloudApi && typeof melCloudApi.cleanup === 'function') {
      melCloudApi.cleanup();
    }
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      expect(melCloudApi).toBeInstanceOf(MelCloudApi);
    });
  });

  describe('cleanup', () => {
    it('should clean up resources without throwing', () => {
      expect(() => melCloudApi.cleanup()).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle not being logged in', async () => {
      // Ensure not logged in
      (melCloudApi as any).contextKey = null;

      // This should throw an error since we're not logged in
      await expect(melCloudApi.getDevices()).rejects.toThrow();
    });
  });
});

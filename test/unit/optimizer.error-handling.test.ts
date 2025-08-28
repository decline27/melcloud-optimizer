import { Optimizer } from '../../src/services/optimizer';

describe('Optimizer', () => {
  let optimizer: Optimizer;
  let logger: any;

  beforeEach(() => {
    logger = {
      error: jest.fn(),
      log: jest.fn(),
    };
  optimizer = new Optimizer({} as any, {} as any, 'deviceId', 1, logger as any);
  });

  describe('handleApiError', () => {
    it('should throw the original error in test environment', () => {
      process.env.NODE_ENV = 'test';
      const error = new Error('Test error');
      expect(() => (optimizer as any).handleApiError(error)).toThrow('Test error');
      expect(logger.error).toHaveBeenCalledWith('API error:', 'Test error');
    });

    it('should throw a wrapped error in non-test environment', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Prod error');
      expect(() => (optimizer as any).handleApiError(error)).toThrow('API error: Prod error');
      expect(logger.error).toHaveBeenCalledWith('API error:', 'Prod error');
    });

    it('should handle unknown error types', () => {
      process.env.NODE_ENV = 'production';
      expect(() => (optimizer as any).handleApiError('unknown')).toThrow('Unknown API error: unknown');
      expect(logger.error).toHaveBeenCalledWith('Unknown API error:', 'unknown');
    });
  });
});

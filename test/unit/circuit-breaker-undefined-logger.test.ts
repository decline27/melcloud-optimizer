import { CircuitBreaker, CircuitState } from '../../src/util/circuit-breaker';

describe('CircuitBreaker with undefined logger', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Mock console methods to track defensive logging
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('handles undefined logger gracefully during failures', async () => {
    // Create circuit breaker with undefined logger
    const cb = new CircuitBreaker('test-undefined-logger', undefined as any, {
      failureThreshold: 2,
      resetTimeout: 50,
      halfOpenSuccessThreshold: 1,
      timeout: 100,
      monitorInterval: 0,
    });

    // First failure - should not crash
    await expect(cb.execute(() => Promise.reject(new Error('fail1')))).rejects.toThrow('fail1');
    
    // Verify defensive logging was used
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[CircuitBreaker] test-undefined-logger failure: fail1')
    );

    // Second failure - should open circuit
    await expect(cb.execute(() => Promise.reject(new Error('fail2')))).rejects.toThrow('fail2');
    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Verify circuit opening was logged defensively
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[CircuitBreaker] test-undefined-logger OPENED')
    );

    cb.cleanup();
  });

  test('handles undefined logger gracefully during success in half-open state', async () => {
    const cb = new CircuitBreaker('test-success-undefined', undefined as any, {
      failureThreshold: 1,
      resetTimeout: 50,
      halfOpenSuccessThreshold: 1,
      timeout: 100,
      monitorInterval: 0,
      adaptiveThresholds: false, // Disable adaptive behavior for predictable test
    });

    // Cause failure to open circuit
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Advance time to trigger half-open (use longer time to account for exponential backoff)
    jest.advanceTimersByTime(150);
    
    // Flush any pending promises/timers
    await Promise.resolve();

    // Success in half-open should not crash (even though we can't verify debug logging easily)
    await expect(cb.execute(() => Promise.resolve('success'))).resolves.toBe('success');
    expect(cb.getState()).toBe(CircuitState.CLOSED);

    cb.cleanup();
  });

  test('handles undefined logger gracefully with monitoring', async () => {
    const cb = new CircuitBreaker('test-monitor-undefined', undefined as any, {
      failureThreshold: 5,
      resetTimeout: 50,
      halfOpenSuccessThreshold: 1,
      timeout: 100,
      monitorInterval: 100, // Enable monitoring
    });

    // Advance timer to trigger monitoring - should not crash
    jest.advanceTimersByTime(150);

    // No console output expected for debug level monitoring with undefined logger
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('state:')
    );

    cb.cleanup();
  });

  test('provides working logger should work normally', async () => {
    const mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
    };

    const cb = new CircuitBreaker('test-working-logger', mockLogger as any, {
      failureThreshold: 1,
      resetTimeout: 50,
      halfOpenSuccessThreshold: 1,
      timeout: 100,
      monitorInterval: 0,
    });

    // Should use proper logger, not console
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Circuit test-working-logger failure: fail')
    );
    expect(console.warn).not.toHaveBeenCalled();

    cb.cleanup();
  });
});
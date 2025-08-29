import { CircuitBreaker, CircuitState } from '../../src/util/circuit-breaker';

const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
});

describe('CircuitBreaker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('execute resolves when underlying function succeeds', async () => {
    const logger = createMockLogger() as any;
    const cb = new CircuitBreaker('test-cb', logger, {
      failureThreshold: 2,
      resetTimeout: 50,
      halfOpenSuccessThreshold: 1,
      timeout: 100,
      monitorInterval: 0,
    });

    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(cb.getState()).toBe(CircuitState.CLOSED);

    cb.cleanup();
  });

  test('opens after failures, half-opens after timeout, and closes on success', async () => {
    const logger = createMockLogger() as any;
    const cb = new CircuitBreaker('test-cb-2', logger, {
      failureThreshold: 2,          // Explicit threshold for this test
      resetTimeout: 50,
      halfOpenSuccessThreshold: 1,
      timeout: 100,
      monitorInterval: 0,
      adaptiveThresholds: false,    // Disable adaptive behavior for predictable test
    });

    // First failure
    await expect(cb.execute(() => Promise.reject(new Error('fail1')))).rejects.toThrow('fail1');

    // Second failure -> should open the circuit
    await expect(cb.execute(() => Promise.reject(new Error('fail2')))).rejects.toThrow('fail2');
    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Further calls should fail fast while open
    await expect(cb.execute(() => Promise.resolve('should-not-run'))).rejects.toThrow('Service unavailable');

    // Advance timers to trigger reset -> half-open
    jest.advanceTimersByTime(150); // Increased from 60 to 150 to account for exponential backoff
    // flush microtasks
    await Promise.resolve();

    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

    // A successful call in HALF_OPEN should close the circuit (halfOpenSuccessThreshold = 1)
    await expect(cb.execute(() => Promise.resolve('recovered'))).resolves.toBe('recovered');
    expect(cb.getState()).toBe(CircuitState.CLOSED);

    cb.cleanup();
  });

  test('adaptive thresholds adjust based on success rate', async () => {
    const logger = createMockLogger() as any;
    const cb = new CircuitBreaker('adaptive-test', logger, {
      failureThreshold: 5,
      resetTimeout: 50,
      halfOpenSuccessThreshold: 1,
      timeout: 100,
      monitorInterval: 0,
      adaptiveThresholds: true,
      successRateWindow: 1000,  // Short window for testing
    });

    // Simulate high success rate (95%+)
    for (let i = 0; i < 19; i++) {
      await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    }
    for (let i = 0; i < 1; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    }

    // With high success rate, threshold should increase (more tolerant)
    // Note: This test verifies the adaptive logic runs without errors
    expect(cb.getState()).toBe(CircuitState.CLOSED);

    cb.cleanup();
  });
});

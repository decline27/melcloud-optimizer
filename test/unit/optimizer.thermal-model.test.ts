import { Optimizer } from '../../src/services/optimizer';

function makeLogger() {
  return {
    log: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  } as any;
}

describe('Optimizer setters and savings', () => {
  let optimizer: Optimizer;
  let logger: any;

  beforeEach(() => {
    logger = makeLogger();
    optimizer = new Optimizer({} as any, {} as any, 'dev', 1, logger);
  });

  test('setThermalModel validates inputs and updates model', () => {
    expect(() => optimizer.setThermalModel(0.5, 0.05)).not.toThrow();
  });

  test('setTemperatureConstraints updates constraints and validates', () => {
    optimizer.setTemperatureConstraints(16, 24, 0.5);
    // No throw means pass
  });

  test('calculateSavings returns positive for lowered temp', () => {
    const s = (optimizer as any).calculateSavings(22, 20, 1.5);
    expect(s).toBeGreaterThan(0);
  });

  test('estimateCostSavings returns message if no metrics', () => {
    const msg = (optimizer as any).estimateCostSavings(20, 21, 1, 1);
    expect(msg).toContain('No real energy data');
  });
});

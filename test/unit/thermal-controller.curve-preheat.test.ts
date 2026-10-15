import { ThermalController } from '../../src/services/thermal-controller';
import { CopNormalizer } from '../../src/services/cop-normalizer';
import { PricePoint } from '../../src/types';

/**
 * In Curve mode a higher setpoint adds no heating power, so the preheat gate must size the heat
 * a cheap hour can store by what the curve actually delivers at this outdoor temperature.
 */

const HOUR = 3600000;
const makeLogger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;

function modelWith(curveWarming: Array<{ outdoorC: number; ratePerHour: number; samples: number }>) {
  return {
    getThermalCharacteristics: jest.fn().mockReturnValue({
      heatingRate: 0.5, coolingRate: 0.2, outdoorTempImpact: 0, windImpact: 0,
      thermalMass: 0.8, modelConfidence: 0.9, lastUpdated: new Date().toISOString(),
      curveWarming
    })
  } as any;
}

function cheapNowThenExpensive(reference: number): PricePoint[] {
  return Array.from({ length: 24 }).map((_, i) => ({
    time: new Date(reference + i * HOUR).toISOString(),
    price: i === 0 ? 0.2 : i < 7 ? 3.0 : 1.5
  }));
}

function run(roomTargetMode: boolean, outdoor: number, curveWarming: any[]) {
  const logger = makeLogger();
  const controller = new ThermalController(logger, modelWith(curveWarming), undefined, new CopNormalizer());
  const reference = Date.now();
  const strategy = controller.calculateThermalMassStrategy(
    21.5, 22, 0.2, cheapNowThenExpensive(reference),
    { heating: 3.5, hotWater: 2.5, outdoor },
    {} as any, 0.25, { minTemp: 21, maxTemp: 23 }, reference,
    { currentTargetC: 22, minC: 21, maxC: 23, stepC: 0.5, deadbandC: 0.3, minChangeMinutes: 0, maxDeltaPerChangeC: 1 },
    'VERY_CHEAP', undefined, roomTargetMode
  );
  const gateCalls = (logger.log as jest.Mock).mock.calls.filter(([m]) => m === 'Preheat cost-benefit gate');
  return { strategy, gate: gateCalls.length ? gateCalls[gateCalls.length - 1][1] : null };
}

describe('Curve-mode preheat gate', () => {
  test('blocks preheat when the curve only holds the room at this outdoor temperature', () => {
    const { strategy, gate } = run(false, 3, [{ outdoorC: 4, ratePerHour: -0.1, samples: 4 }]);
    expect(gate).toEqual(expect.objectContaining({ decision: 'block', reason: 'curve-cannot-store-heat' }));
    expect(strategy.action).not.toBe('preheat');
  });

  test('sizes the stored heat by the learned curve warming, not the setpoint gap', () => {
    const { gate } = run(false, 11, [{ outdoorC: 12, ratePerHour: 0.2, samples: 4 }]);
    expect(gate).not.toBeNull();
    expect(gate.reason).not.toBe('curve-cannot-store-heat');
    expect(gate.deltaUsed).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  test('without learned data near this temperature the gate keeps its old estimate', () => {
    const { gate } = run(false, -5, [{ outdoorC: 12, ratePerHour: 0.2, samples: 4 }]);
    expect(gate?.reason).not.toBe('curve-cannot-store-heat');
    if (gate?.deltaUsed !== undefined) expect(gate.deltaUsed).toBeGreaterThan(0.2);
  });

  test('Room mode ignores the curve profile', () => {
    const { gate } = run(true, 3, [{ outdoorC: 4, ratePerHour: -0.1, samples: 4 }]);
    expect(gate?.reason).not.toBe('curve-cannot-store-heat');
  });
});

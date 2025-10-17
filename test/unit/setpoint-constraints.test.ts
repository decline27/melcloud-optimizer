import { describe, expect, test } from '@jest/globals';
import { applySetpointConstraints } from '../../src/util/setpoint-constraints';

describe('applySetpointConstraints', () => {
  const baseInput = {
    currentTargetC: 21,
    minC: 18,
    maxC: 23,
    stepC: 0.5,
    deadbandC: 0.4,
    minChangeMinutes: 30,
    lastChangeMs: null as number | null
  };

  test('clamps to bounds when above maximum', () => {
    const result = applySetpointConstraints({
      ...baseInput,
      proposedC: 23.2
    });
    expect(result.constrainedC).toBe(23);
    expect(result.clampApplied).toBe(true);
    expect(result.changed).toBe(true);
  });

  test('rounds to discrete step size', () => {
    const result = applySetpointConstraints({
      ...baseInput,
      proposedC: 21.73
    });
    expect(result.constrainedC).toBe(21.5);
    expect(result.stepApplied).toBe(true);
  });

  test('deadband suppresses small adjustments', () => {
    const result = applySetpointConstraints({
      ...baseInput,
      proposedC: 21.2
    });
    expect(result.changed).toBe(false);
    expect(result.reason).toContain('below deadband');
  });

  test('lockout prevents change when dwell not met', () => {
    const now = Date.now();
    const result = applySetpointConstraints({
      ...baseInput,
      proposedC: 22,
      lastChangeMs: now - 5 * 60 * 1000,
      nowMs: now
    });
    expect(result.lockoutActive).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.reason).toContain('lockout');
  });
});

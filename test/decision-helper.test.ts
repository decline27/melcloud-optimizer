import { buildDecisionFromOptimization } from '../src/util/decision-helper';
import { AugmentedOptimizationResult } from '../src/types';

describe('decision-helper', () => {
  const basePrice = {
    current: 1,
    average: 1,
    min: 0.5,
    max: 1.5
  };

  it('maps maintain/no-change to HEAT_MAINTAIN_DEADBAND', () => {
    const result: AugmentedOptimizationResult = {
      success: true,
      action: 'no_change',
      fromTemp: 22,
      toTemp: 22,
      reason: 'Within deadband',
      priceData: basePrice
    };

    const decision = buildDecisionFromOptimization(result);
    expect(decision?.code).toBe('HEAT_MAINTAIN_DEADBAND');
    expect(decision?.headline).toContain('Holding');
  });

  it('maps upward change with cheap prices to HEAT_PREHEAT', () => {
    const result: AugmentedOptimizationResult = {
      success: true,
      action: 'temperature_adjusted',
      fromTemp: 21,
      toTemp: 22.5,
      reason: 'Preheating ahead of expensive window',
      priceData: {
        current: 0.6,
        average: 1.0,
        min: 0.4,
        max: 1.4
      }
    };

    const decision = buildDecisionFromOptimization(result);
    expect(decision?.code).toBe('HEAT_PREHEAT');
    expect(decision?.context?.priceTier).toBe('cheap');
  });

  it('maps DHW heat_now to DHW_HEAT_CHEAP_WINDOW', () => {
    const result: AugmentedOptimizationResult = {
      success: true,
      action: 'no_change',
      fromTemp: 21,
      toTemp: 21,
      reason: 'DHW cheap window',
      priceData: basePrice,
      hotWaterAction: {
        action: 'heat_now',
        reason: 'Cheap prices'
      }
    };

    const decision = buildDecisionFromOptimization(result);
    expect(decision?.code).toBe('DHW_HEAT_CHEAP_WINDOW');
    expect(decision?.context?.dhwAction).toBe('heat_now');
  });

  it('treats comfort violation signals as LEARNING_ADJUST', () => {
    const result: AugmentedOptimizationResult = {
      success: true,
      action: 'temperature_adjusted',
      fromTemp: 23,
      toTemp: 22,
      reason: 'Comfort violation detected, reducing aggressiveness',
      priceData: basePrice
    };

    const decision = buildDecisionFromOptimization(result);
    expect(decision?.code).toBe('LEARNING_ADJUST');
    expect(decision?.headline).toContain('Adjusting');
  });
});

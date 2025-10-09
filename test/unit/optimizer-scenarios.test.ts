import { describe, expect, test } from '@jest/globals';
import { runScenarioHarness } from '../../simulate';
import { scenarios, ScenarioRow } from '../fixtures/generate-scenarios';

interface MelCall {
  targetC: number;
  context: { idx: number; ts: string; flags?: string[] };
  attempt: number;
}

function createMelStub() {
  const calls: MelCall[] = [];
  const attempts = new Map<number, number>();
  return {
    calls,
    attempts,
    melCloud: {
      async setTarget(targetC: number, context: { idx: number; ts: string; flags?: string[] }) {
        const idx = context?.idx ?? -1;
        const attempt = (attempts.get(idx) ?? 0) + 1;
        attempts.set(idx, attempt);
        const flags = context?.flags ?? [];
        if (flags.includes('melcloud_429') && attempt === 1) {
          throw new Error('429 Too Many Requests');
        }
        calls.push({
          targetC,
          context,
          attempt
        });
      }
    }
  };
}

async function executeScenario(name: keyof typeof scenarios) {
  const timeline = scenarios[name]();
  const melStub = createMelStub();
  const result = await runScenarioHarness({
    scenarioName: name,
    timeline,
    seed: 42,
    melCloud: melStub.melCloud
  });
  return {
    result,
    melStub,
    timeline
  };
}

function violationsRatio(rows: any[], timeline: ScenarioRow[]) {
  const occupiedHours = timeline.filter((row) => row.occupied).length || 1;
  const violations = rows.filter((row) => row.comfort_violation).length;
  return violations / occupiedHours;
}

function maxSetpointChangesPerDay(metadata: any) {
  const map = metadata?.setpointChangesByDay || {};
  return Object.values(map).reduce((max: number, value: any) => {
    const num = typeof value === 'number' ? value : Number(value);
    return num > max ? num : max;
  }, 0);
}

describe('optimizer scenario harness', () => {
  test('cold front cheap night biases upward during trough', async () => {
    const { result, melStub, timeline } = await executeScenario('cold_front_cheap_night');

    const cheapHours = result.rows.filter((row: any) => {
      const hour = new Date(row.ts).getHours();
      return hour >= 0 && hour <= 5;
    });
    const maxBias = Math.max(...cheapHours.map((row: any) => row.bias_c));

    expect(result.rows).toHaveLength(48);
    expect(maxBias).toBeGreaterThan(0);
    expect(violationsRatio(result.rows, timeline)).toBeLessThanOrEqual(0.05);
    expect(maxSetpointChangesPerDay(result.metadata)).toBeLessThanOrEqual(12);
    expect(melStub.calls.length).toBe(result.summary.totalWrites);
  });

  test('warm spike expensive evening biases downward during peak', async () => {
    const { result, timeline } = await executeScenario('warm_spike_expensive_evening');

    const peakHours = result.rows.filter((row: any) => {
      const hour = new Date(row.ts).getHours();
      return hour >= 17 && hour <= 20;
    });
    const minBias = Math.min(...peakHours.map((row: any) => row.bias_c));

    expect(minBias).toBeLessThan(0);
    expect(violationsRatio(result.rows, timeline)).toBeLessThanOrEqual(0.05);
  });

  test('sawtooth prices maintain thrash control', async () => {
    const { result, timeline } = await executeScenario('sawtooth_prices_calm_weather');

    const diffs = result.rows.slice(1).map((row: any, idx: number) => {
      const prev = result.rows[idx];
      return Math.abs(row.applied - prev.applied);
    });

    diffs.forEach((delta: number) => {
      expect(Math.abs(delta / 0.5 - Math.round(delta / 0.5))).toBeLessThan(1e-6);
    });

    expect(maxSetpointChangesPerDay(result.metadata)).toBeLessThanOrEqual(12);
    expect(violationsRatio(result.rows, timeline)).toBeLessThanOrEqual(0.05);
  });

  test('price outage midday holds temperature with explicit reason', async () => {
    const { result, melStub } = await executeScenario('price_outage_midday');

    const outageRows = result.rows.filter((row: any) => {
      const hour = new Date(row.ts).getHours();
      return hour >= 10 && hour <= 14;
    });

    outageRows.forEach((row: any, idx: number) => {
      expect(row.reason.toLowerCase()).toContain('price outage');
      if (idx > 0) {
        expect(row.applied).toBe(outageRows[idx - 1].applied);
      }
    });

    const holds = result.summary.holdsByReason as Record<string, number>;
    expect((holds.price_outage ?? 0)).toBeGreaterThan(0);
    const writeIndices = new Set(melStub.calls.map((call) => call.context.idx));
    expect(writeIndices.size).toBe(melStub.calls.length);
  });

  test('dst transition maintains hourly cadence without duplicates', async () => {
    const { result } = await executeScenario('dst_transition_sunday');

    const timestamps = result.rows.map((row: any) => new Date(row.ts).getTime());
    const unique = new Set(timestamps);
    expect(unique.size).toBe(timestamps.length);

    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i] - timestamps[i - 1]).toBe(60 * 60 * 1000);
    }
  });

  test('melcloud rate limit is retried with single applied write', async () => {
    const { result, melStub } = await executeScenario('melcloud_rate_limit_burst');

    expect(result.summary.totalWrites).toBe(melStub.calls.length);
    const rateLimited = (result.metadata.rateLimitedWrites || []) as number[];
    const burstIdx = rateLimited[0];
    expect(typeof burstIdx).toBe('number');
    expect(melStub.attempts.get(burstIdx as number)).toBe(2);
  });

  test('high mass house maintains increased thermal response and positive bias', async () => {
    const { result } = await executeScenario('high_mass_house_cold');

    const avgBias = result.rows.reduce((sum: number, row: any) => sum + row.bias_c, 0) / result.rows.length;
    expect(avgBias).toBeGreaterThan(0);
    expect(result.metadata.lastThermalResponse).toBeGreaterThanOrEqual(1);
  });

  test('low mass house avoids over-preheat and keeps thermal response low', async () => {
    const { result } = await executeScenario('low_mass_house_windy');

    const avgBias = result.rows.reduce((sum: number, row: any) => sum + row.bias_c, 0) / result.rows.length;
    expect(avgBias).toBeLessThanOrEqual(0.2);
    expect(result.metadata.lastThermalResponse).toBeLessThanOrEqual(1);
  });
});

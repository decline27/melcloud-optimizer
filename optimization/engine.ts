/**
 * Optimization Engine (pure, DI-friendly)
 *
 * This module contains pure decision logic for space heating and DHW scheduling.
 * It does not perform I/O. Callers inject inputs (prices, temps, config) and
 * receive recommendations (targets, actions, reasons) that can be applied by
 * device adapters (e.g., MELCloud API) and orchestrators (e.g., Homey flows).
 */

// ----- Types -----

export interface PricePoint { time: string; price: number }

export interface WeatherSnapshot {
  outdoorC: number;
}

export interface TelemetrySnapshot {
  indoorC: number;
  targetC: number;
  tankC?: number;
}

export interface ComfortBand { lowerC: number; upperC: number }

export interface SafetyConfig {
  deadbandC: number;                // Hysteresis band around target
  minSetpointChangeMinutes: number; // Lockout to avoid frequent adjustments
  extremeWeatherMinC?: number;      // Guardrail for very low outdoor temperatures
}

export interface ThermalConfig {
  rThermal: number; // C*h/kW thermal resistance
  cThermal: number; // kWh/C thermal capacitance
}

export interface EngineConfig {
  comfortOccupied: ComfortBand;
  comfortAway: ComfortBand;
  minSetpointC: number;
  maxSetpointC: number;
  stepMinutes: number;
  preheat: {
    enable: boolean;
    horizonHours: number;
    cheapPercentile: number; // 0..1 (<= this is considered cheap)
  };
  safety: SafetyConfig;
  thermal: ThermalConfig;
}

export interface HeatingDecision {
  action: 'no_change' | 'set_target';
  fromC: number;
  toC: number;
  reason: string;
  comfortRisk: 'low' | 'medium' | 'high';
  expectedDeltaCostPerHourSEK: number; // sign indicates savings (<0) or extra cost (>0)
}

export interface DHWDecision {
  action: 'maintain' | 'heat_now' | 'delay' | 'set_tank_target';
  reason: string;
  scheduledHour?: number; // 0-23 when known
  tankTargetC?: number;   // optional tank setpoint recommendation
}

export interface EngineInputs {
  now: Date;
  occupied: boolean;
  prices: PricePoint[];       // day-ahead including current hour
  currentPrice: number;       // convenience
  telemetry: TelemetrySnapshot;
  weather: WeatherSnapshot;
  lastSetpointChangeMs?: number | null;
}

// ----- Helpers -----

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function pricePercentile(prices: PricePoint[], now: Date, horizonHours: number, currentPrice: number): number {
  const startIdx = prices.findIndex(p => Math.abs(new Date(p.time).getTime() - now.getTime()) < 60 * 60 * 1000);
  const idx = startIdx >= 0 ? startIdx : 0;
  const end = Math.min(prices.length, idx + Math.max(1, Math.round(horizonHours)));
  const slice = prices.slice(idx, end).map(p => p.price).sort((a, b) => a - b);
  if (!slice.length) return 0.5;
  let count = 0;
  for (const v of slice) if (v <= currentPrice) count++;
  return count / slice.length;
}

// ----- Decisions -----

export function computeHeatingDecision(cfg: EngineConfig, inp: EngineInputs): HeatingDecision {
  const band = inp.occupied ? cfg.comfortOccupied : cfg.comfortAway;
  const deadband = cfg.safety.deadbandC;
  const lastChangeAgeMin = inp.lastSetpointChangeMs ? (Date.now() - inp.lastSetpointChangeMs) / 60000 : Infinity;
  const lockout = lastChangeAgeMin < cfg.safety.minSetpointChangeMinutes;

  // Base target within band using price percentile (lower price => nearer upper band)
  const pctl = pricePercentile(inp.prices, inp.now, cfg.preheat.horizonHours, inp.currentPrice);
  let target = band.lowerC + (1 - pctl) * (band.upperC - band.lowerC);

  // Comfort recovery takes precedence
  if (inp.telemetry.indoorC < band.lowerC - deadband / 2) {
    target = Math.min(band.upperC + 0.2, cfg.maxSetpointC);
  }

  // Preheat when cheap and cold outside (build thermal buffer)
  const cheap = pctl <= cfg.preheat.cheapPercentile;
  if (cfg.preheat.enable && cheap && inp.weather.outdoorC < 5 && inp.telemetry.indoorC < band.upperC - 0.1) {
    target = Math.min(band.upperC + 0.25, cfg.maxSetpointC);
  }

  // Coast during very expensive hours if we have buffer
  if (pctl >= 0.7 && inp.telemetry.indoorC > band.lowerC + 0.5) {
    target = Math.max(band.lowerC + 0.1, cfg.minSetpointC);
  }

  // Extreme weather guardrail
  if (typeof cfg.safety.extremeWeatherMinC === 'number' && inp.weather.outdoorC <= -15) {
    target = Math.max(target, cfg.safety.extremeWeatherMinC);
  }

  // Clamp and smooth
  target = clamp(target, cfg.minSetpointC, cfg.maxSetpointC);
  const delta = target - inp.telemetry.targetC;
  const significant = Math.abs(delta) >= deadband;

  if (!significant || lockout) {
    return {
      action: 'no_change',
      fromC: inp.telemetry.targetC,
      toC: inp.telemetry.targetC,
      reason: lockout ? `Lockout ${cfg.safety.minSetpointChangeMinutes}m to prevent cycling` : `Within deadband ±${deadband}°C`,
      comfortRisk: 'low',
      expectedDeltaCostPerHourSEK: 0
    };
  }

  // Heuristic expected cost: 1 kWh/h at current price scaled by direction
  const expected = Math.sign(delta) * inp.currentPrice; // + = cost increase, - = saving
  return {
    action: 'set_target',
    fromC: inp.telemetry.targetC,
    toC: target,
    reason: delta > 0 ? 'Cheaper hour → raise within comfort' : 'Expensive hour → lower within comfort',
    comfortRisk: 'low',
    expectedDeltaCostPerHourSEK: expected
  };
}

export function computeDHWDecision(cfg: EngineConfig, inp: EngineInputs): DHWDecision {
  // Use same percentile logic, prefer heating when price is cheap
  const pctl = pricePercentile(inp.prices, inp.now, Math.max(12, cfg.preheat.horizonHours), inp.currentPrice);

  if (pctl <= 0.25) {
    return { action: 'heat_now', reason: 'Low price window (<= 25th percentile)' };
  }
  if (pctl >= 0.75) {
    return { action: 'delay', reason: 'High price window (>= 75th percentile)' };
  }
  return { action: 'maintain', reason: 'Moderate price; maintain schedule' };
}

// Example defaults (can be copied to JSON)
export const DefaultEngineConfig: EngineConfig = {
  comfortOccupied: { lowerC: 20.0, upperC: 21.0 },
  comfortAway: { lowerC: 19.0, upperC: 20.5 },
  minSetpointC: 18,
  maxSetpointC: 23,
  stepMinutes: 60,
  preheat: { enable: true, horizonHours: 12, cheapPercentile: 0.25 },
  safety: { deadbandC: 0.3, minSetpointChangeMinutes: 5, extremeWeatherMinC: 20 },
  thermal: { rThermal: 2.5, cThermal: 10 }
};


"use strict";
/**
 * Optimization Engine (pure, DI-friendly)
 *
 * This module contains pure decision logic for space heating and DHW scheduling.
 * It does not perform I/O. Callers inject inputs (prices, temps, config) and
 * receive recommendations (targets, actions, reasons) that can be applied by
 * device adapters (e.g., MELCloud API) and orchestrators (e.g., Homey flows).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultEngineConfig = void 0;
exports.computeHeatingDecision = computeHeatingDecision;
exports.computeDHWDecision = computeDHWDecision;
// ----- Helpers -----
function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}
function pricePercentile(prices, now, horizonHours, currentPrice) {
    // Get the relevant price window for analysis
    const startIdx = prices.findIndex(p => Math.abs(new Date(p.time).getTime() - now.getTime()) < 60 * 60 * 1000);
    const idx = startIdx >= 0 ? startIdx : 0;
    const end = Math.min(prices.length, idx + Math.max(1, Math.round(horizonHours)));
    const slice = prices.slice(idx, end);
    if (!slice.length)
        return 0.5;
    // Use the SAME method as the main system for consistency
    // Count how many prices are <= current price, divide by total
    const cheaperOrEqualCount = slice.filter(p => p.price <= currentPrice).length;
    return cheaperOrEqualCount / slice.length; // 0 = cheapest, 1 = most expensive
}
// ----- Decisions -----
function computeHeatingDecision(cfg, inp) {
    const band = inp.occupied ? cfg.comfortOccupied : cfg.comfortAway;
    const deadband = cfg.safety.deadbandC;
    const lastChangeAgeMin = inp.lastSetpointChangeMs ? (Date.now() - inp.lastSetpointChangeMs) / 60000 : Infinity;
    const lockout = lastChangeAgeMin < cfg.safety.minSetpointChangeMinutes;
    // Base target within band using price percentile (lower price => nearer upper band)
    const pctl = pricePercentile(inp.prices, inp.now, cfg.preheat.horizonHours, inp.currentPrice);
    console.log('Price percentile calculated:', (pctl * 100).toFixed(1) + '%');
    let target = band.lowerC + (1 - pctl) * (band.upperC - band.lowerC);
    console.log('Base target calculated:', target.toFixed(2) + '°C');
    // Comfort recovery takes precedence
    if (inp.telemetry.indoorC < band.lowerC - deadband / 2) {
        target = Math.min(band.upperC + 0.2, cfg.maxSetpointC);
    }
    // Preheat when cheap and cool/cold outside (build thermal buffer)
    const cheap = pctl <= cfg.preheat.cheapPercentile;
    console.log('Cheap electricity check:', (pctl * 100).toFixed(1) + '% <=', (cfg.preheat.cheapPercentile * 100) + '% =', cheap);
    console.log('Preheat condition check:');
    console.log('  - Preheat enabled:', cfg.preheat.enable);
    console.log('  - Cheap electricity:', cheap);
    console.log('  - Outdoor < 15°C:', inp.weather.outdoorC, '<', 15, '=', inp.weather.outdoorC < 15);
    console.log('  - Indoor < upper-0.1:', inp.telemetry.indoorC, '<', band.upperC - 0.1, '=', inp.telemetry.indoorC < band.upperC - 0.1);
    if (cfg.preheat.enable && cheap && inp.weather.outdoorC < 15 && inp.telemetry.indoorC < band.upperC - 0.1) {
      console.log('  → PREHEAT CONDITIONS MET');
        target = Math.min(band.upperC + 0.25, cfg.maxSetpointC);
      console.log('  → Setting preheat target:', target.toFixed(2) + '°C');
    }
    // Moderate preheating for moderately cheap periods (25th-50th percentile)
    const moderateCheap = pctl > cfg.preheat.cheapPercentile && pctl <= 0.50;
    if (cfg.preheat.enable && moderateCheap && inp.weather.outdoorC < 20 && inp.telemetry.indoorC < band.upperC - 0.3) {
        target = Math.min(band.lowerC + (band.upperC - band.lowerC) * 0.75, cfg.maxSetpointC);
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
    console.log('Final target before clamping:', target.toFixed(2) + '°C');
    const delta = target - inp.telemetry.targetC;
    console.log('Delta calculation:', target.toFixed(2), '-', inp.telemetry.targetC, '=', delta.toFixed(2) + '°C');
    const significant = Math.abs(delta) >= deadband;
    console.log('Significant check:', Math.abs(delta).toFixed(2), '>=', deadband, '=', significant);
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
function computeDHWDecision(cfg, inp) {
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
exports.DefaultEngineConfig = {
    comfortOccupied: { lowerC: 20.0, upperC: 23.0 }, // Expanded to match user settings capability
    comfortAway: { lowerC: 19.0, upperC: 21.0 }, // Reasonable away range
    minSetpointC: 18,
    maxSetpointC: 23,
    stepMinutes: 60,
    preheat: { enable: true, horizonHours: 12, cheapPercentile: 0.35 }, // More responsive to cheap periods
    safety: { deadbandC: 0.3, minSetpointChangeMinutes: 5, extremeWeatherMinC: 20 },
    thermal: { rThermal: 2.5, cThermal: 10 }
};

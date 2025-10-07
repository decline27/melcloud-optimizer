#!/usr/bin/env node

// Debug the engine calculation with your exact scenario
const { computeHeatingDecision, DefaultEngineConfig } = require('./.homeybuild/optimization/engine');

const config = {
  ...DefaultEngineConfig,
  comfortOccupied: { lowerC: 20.0, upperC: 23.0 }, // Your comfort band
  safety: { deadbandC: 0.3, minSetpointChangeMinutes: 5 },
  preheat: { enable: true, horizonHours: 12, cheapPercentile: 0.35 }
};

const inputs = {
  now: new Date(),
  occupied: true,
  prices: [
    { time: new Date().toISOString(), price: 0.602481 }, // Current: 23rd percentile
    { time: new Date(Date.now() + 3600000).toISOString(), price: 0.500125 }, // Next hour
    // Add some more prices to simulate 23rd percentile
    { time: new Date(Date.now() + 7200000).toISOString(), price: 1.5 },
    { time: new Date(Date.now() + 10800000).toISOString(), price: 2.0 },
    { time: new Date(Date.now() + 14400000).toISOString(), price: 3.0 },
  ],
  currentPrice: 0.602481,
  telemetry: { indoorC: 21.5, targetC: 20.0 }, // Your exact scenario
  weather: { outdoorC: 14.0 },
  lastSetpointChangeMs: null
};

console.log('=== ENGINE DEBUG ===');
console.log('Config:', JSON.stringify(config, null, 2));
console.log('Inputs:', JSON.stringify(inputs, null, 2));

const decision = computeHeatingDecision(config, inputs);

console.log('=== DECISION ===');
console.log(JSON.stringify(decision, null, 2));

// Manual calculation
const band = inputs.occupied ? config.comfortOccupied : config.comfortAway;
console.log('=== MANUAL CALCULATION ===');
console.log('Comfort band:', band);

// Price percentile calculation (simplified)
const sortedPrices = inputs.prices.map(p => p.price).sort((a, b) => a - b);
const currentPriceRank = sortedPrices.filter(p => p <= inputs.currentPrice).length;
const percentile = currentPriceRank / sortedPrices.length;
console.log('Price percentile:', percentile);

const target = band.lowerC + (1 - percentile) * (band.upperC - band.lowerC);
console.log('Calculated target:', target);

const delta = target - inputs.telemetry.targetC;
console.log('Delta:', delta);
console.log('Significant?', Math.abs(delta) >= config.safety.deadbandC);
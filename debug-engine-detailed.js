#!/usr/bin/env node

// Add detailed debugging to the engine to trace the exact execution path
const fs = require('fs');

// Read the original engine file
const engineCode = fs.readFileSync('./.homeybuild/optimization/engine.js', 'utf8');

// Create a debug version with console.log statements
const debugEngineCode = engineCode.replace(
  'export function computeHeatingDecision(cfg, inp) {',
  `export function computeHeatingDecision(cfg, inp) {
    console.log('\\n=== ENGINE EXECUTION TRACE ===');
    console.log('Config:', JSON.stringify({
      comfortOccupied: cfg.comfortOccupied,
      preheat: cfg.preheat,
      safety: cfg.safety
    }, null, 2));
    console.log('Inputs:', JSON.stringify({
      occupied: inp.occupied,
      currentPrice: inp.currentPrice,
      telemetry: inp.telemetry,
      weather: inp.weather
    }, null, 2));`
).replace(
  'const pctl = pricePercentile(inp.prices, inp.now, cfg.preheat.horizonHours, inp.currentPrice);',
  `const pctl = pricePercentile(inp.prices, inp.now, cfg.preheat.horizonHours, inp.currentPrice);
    console.log('Price percentile calculated:', (pctl * 100).toFixed(1) + '%');`
).replace(
  'let target = band.lowerC + (1 - pctl) * (band.upperC - band.lowerC);',
  `let target = band.lowerC + (1 - pctl) * (band.upperC - band.lowerC);
    console.log('Base target calculated:', target.toFixed(2) + '°C');`
).replace(
  'const cheap = pctl <= cfg.preheat.cheapPercentile;',
  `const cheap = pctl <= cfg.preheat.cheapPercentile;
    console.log('Cheap electricity check:', (pctl * 100).toFixed(1) + '% <=', (cfg.preheat.cheapPercentile * 100) + '% =', cheap);`
).replace(
  'if (cfg.preheat.enable && cheap && inp.weather.outdoorC < 15 && inp.telemetry.indoorC < band.upperC - 0.1) {',
  `console.log('Preheat condition check:');
    console.log('  - Preheat enabled:', cfg.preheat.enable);
    console.log('  - Cheap electricity:', cheap);
    console.log('  - Outdoor < 15°C:', inp.weather.outdoorC, '<', 15, '=', inp.weather.outdoorC < 15);
    console.log('  - Indoor < upper-0.1:', inp.telemetry.indoorC, '<', band.upperC - 0.1, '=', inp.telemetry.indoorC < band.upperC - 0.1);
    if (cfg.preheat.enable && cheap && inp.weather.outdoorC < 15 && inp.telemetry.indoorC < band.upperC - 0.1) {
      console.log('  → PREHEAT CONDITIONS MET');`
).replace(
  'target = Math.min(band.upperC + 0.25, cfg.maxSetpointC);',
  `target = Math.min(band.upperC + 0.25, cfg.maxSetpointC);
      console.log('  → Setting preheat target:', target.toFixed(2) + '°C');`
).replace(
  'const delta = target - inp.telemetry.targetC;',
  `console.log('Final target before clamping:', target.toFixed(2) + '°C');
    const delta = target - inp.telemetry.targetC;
    console.log('Delta calculation:', target.toFixed(2), '-', inp.telemetry.targetC, '=', delta.toFixed(2) + '°C');`
).replace(
  'const significant = Math.abs(delta) >= deadband;',
  `const significant = Math.abs(delta) >= deadband;
    console.log('Significant check:', Math.abs(delta).toFixed(2), '>=', deadband, '=', significant);`
);

// Write the debug version
fs.writeFileSync('./debug-engine.js', debugEngineCode);

// Load and test the debug version
const { computeHeatingDecision, DefaultEngineConfig } = require('./debug-engine.js');

// Generate mock prices for 24% percentile
function generateMockPricesFor24Percent() {
  const prices = [];
  const currentPrice = 0.602481;
  const minPrice = 0.434691;
  const maxPrice = 3.969715;
  
  // For 24% percentile out of 192 prices, about 46 should be cheaper
  const cheaperPrices = 46;
  const expensivePrices = 192 - cheaperPrices;
  
  for (let i = 0; i < cheaperPrices; i++) {
    const price = minPrice + (currentPrice - minPrice) * (i / cheaperPrices);
    prices.push({
      time: new Date(Date.now() + i * 3600000).toISOString(),
      price: price
    });
  }
  
  prices.push({
    time: new Date().toISOString(),
    price: currentPrice
  });
  
  for (let i = 0; i < expensivePrices - 1; i++) {
    const price = currentPrice + (maxPrice - currentPrice) * (i / (expensivePrices - 1));
    prices.push({
      time: new Date(Date.now() + (i + cheaperPrices + 1) * 3600000).toISOString(),
      price: price
    });
  }
  
  return prices;
}

const config = {
  ...DefaultEngineConfig,
  comfortOccupied: { lowerC: 20.0, upperC: 23.0 },
  safety: { deadbandC: 0.3, minSetpointChangeMinutes: 5 },
  preheat: { enable: true, horizonHours: 12, cheapPercentile: 0.35 }
};

const inputs = {
  now: new Date(),
  occupied: true,
  prices: generateMockPricesFor24Percent(),
  currentPrice: 0.602481,
  telemetry: { indoorC: 21.5, targetC: 20.0 },
  weather: { outdoorC: 14.0 },
  lastSetpointChangeMs: null
};

console.log('Running debug engine with your exact scenario...');
const decision = computeHeatingDecision(config, inputs);
console.log('\\n=== FINAL DECISION ===');
console.log(JSON.stringify(decision, null, 2));
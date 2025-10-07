#!/usr/bin/env node

// Debug the real optimization flow to find where the discrepancy occurs
const { computeHeatingDecision, DefaultEngineConfig } = require('./.homeybuild/optimization/engine');

// Mock the exact prices from your log (ENTSO-E with 192 hourly prices)
// We'll simulate the price percentile calculation that should result in 23%
function generateMockPrices() {
  const prices = [];
  const currentPrice = 0.602481;
  const avgPrice = 1.2840781875000002;
  const minPrice = 0.434691;
  const maxPrice = 3.969715;
  
  // Create a realistic price distribution
  // 23rd percentile means ~44 prices should be cheaper or equal
  const cheaperPrices = 44;  // 23% of 192
  const expensivePrices = 192 - cheaperPrices;
  
  // Generate cheaper prices (0.43 to 0.60)
  for (let i = 0; i < cheaperPrices; i++) {
    const price = minPrice + (currentPrice - minPrice) * (i / cheaperPrices);
    prices.push({
      time: new Date(Date.now() + i * 3600000).toISOString(),
      price: price
    });
  }
  
  // Add current price
  prices.push({
    time: new Date().toISOString(),
    price: currentPrice
  });
  
  // Generate expensive prices (0.60 to 3.97)
  for (let i = 0; i < expensivePrices - 1; i++) {
    const price = currentPrice + (maxPrice - currentPrice) * (i / (expensivePrices - 1));
    prices.push({
      time: new Date(Date.now() + (i + cheaperPrices + 1) * 3600000).toISOString(),
      price: price
    });
  }
  
  return prices;
}

// Test the engine with realistic price data
function testEngine() {
  console.log('=== DEBUGGING REAL OPTIMIZATION FLOW ===\n');
  
  const mockPrices = generateMockPrices();
  console.log(`Generated ${mockPrices.length} mock prices`);
  console.log(`Current price: ${mockPrices.find(p => p.price === 0.602481)?.price}`);
  
  // Calculate percentile manually
  const sortedPrices = mockPrices.map(p => p.price).sort((a, b) => a - b);
  const currentRank = sortedPrices.filter(p => p <= 0.602481).length;
  const percentile = currentRank / sortedPrices.length;
  console.log(`Manual percentile calculation: ${(percentile * 100).toFixed(1)}%\n`);
  
  const config = {
    ...DefaultEngineConfig,
    comfortOccupied: { lowerC: 20.0, upperC: 23.0 },
    safety: { deadbandC: 0.3, minSetpointChangeMinutes: 5 },
    preheat: { enable: true, horizonHours: 12, cheapPercentile: 0.35 }
  };
  
  const inputs = {
    now: new Date(),
    occupied: true,
    prices: mockPrices,
    currentPrice: 0.602481,
    telemetry: { indoorC: 21.5, targetC: 20.0 },
    weather: { outdoorC: 14.0 },
    lastSetpointChangeMs: null
  };
  
  console.log('=== ENGINE INPUTS ===');
  console.log(`Indoor: ${inputs.telemetry.indoorC}°C`);
  console.log(`Target: ${inputs.telemetry.targetC}°C`);
  console.log(`Outdoor: ${inputs.weather.outdoorC}°C`);
  console.log(`Current price: ${inputs.currentPrice}`);
  console.log(`Occupied: ${inputs.occupied}`);
  console.log(`Comfort band: ${config.comfortOccupied.lowerC}-${config.comfortOccupied.upperC}°C`);
  console.log(`Deadband: ±${config.safety.deadbandC}°C`);
  console.log(`Preheat enabled: ${config.preheat.enable}`);
  console.log(`Cheap percentile threshold: ${(config.preheat.cheapPercentile * 100)}%\n`);
  
  const decision = computeHeatingDecision(config, inputs);
  
  console.log('=== ENGINE DECISION ===');
  console.log(JSON.stringify(decision, null, 2));
  
  // Manual step-by-step calculation
  console.log('\n=== MANUAL STEP-BY-STEP ===');
  const band = inputs.occupied ? config.comfortOccupied : config.comfortAway;
  console.log(`1. Comfort band: ${band.lowerC}-${band.upperC}°C`);
  
  // This should match the engine's pricePercentile function
  const target = band.lowerC + (1 - percentile) * (band.upperC - band.lowerC);
  console.log(`2. Price percentile: ${(percentile * 100).toFixed(1)}%`);
  console.log(`3. Calculated target: ${band.lowerC} + (1 - ${percentile.toFixed(3)}) × (${band.upperC} - ${band.lowerC}) = ${target.toFixed(1)}°C`);
  
  const delta = target - inputs.telemetry.targetC;
  console.log(`4. Delta: ${target.toFixed(1)} - ${inputs.telemetry.targetC} = ${delta.toFixed(1)}°C`);
  console.log(`5. Significant? ${Math.abs(delta)} >= ${config.safety.deadbandC} = ${Math.abs(delta) >= config.safety.deadbandC}`);
  
  // Check preheat conditions
  const pctl = percentile;
  const cheap = pctl <= config.preheat.cheapPercentile;
  console.log(`6. Cheap electricity? ${(pctl * 100).toFixed(1)}% <= ${(config.preheat.cheapPercentile * 100)}% = ${cheap}`);
  
  if (cheap && inputs.weather.outdoorC < 15 && inputs.telemetry.indoorC < band.upperC - 0.1) {
    const preheatTarget = Math.min(band.upperC + 0.25, config.maxSetpointC);
    console.log(`7. Preheat conditions met - target should be: ${preheatTarget}°C`);
  }
  
  console.log('\n=== COMPARISON WITH YOUR LOG ===');
  console.log('Your log showed: "Engine: Within deadband ±0.3°C"');
  console.log(`Our calculation: "${decision.reason}"`);
  console.log(`Expected: Should increase to ~${target.toFixed(1)}°C during cheap period`);
}

testEngine();
#!/usr/bin/env node
// @ts-nocheck
/**
 * MELCloud Optimization Algorithm Simulator (self-contained)
 *
 * Usage:
 *   node simulate.js --data data/timeseries.csv --config data/config.yaml --output results/
 *
 * Notes:
 * - No external deps (avoids npm install). Minimal YAML/CSV parsing implemented inline.
 * - Implements two strategies: v1 (price→setpoint linear) and v2 (rule-based preheat/coast).
 * - RC thermal model: updates indoor temp and computes energy, cost, comfort, switches.
 */

const fs = require('fs');
const path = require('path');

// --- CLI args parsing (simple) ---
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

// --- Minimal YAML parser for known config structure ---
function parseSimpleYaml(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const root = {};
  const stack = [{indent: -1, obj: root}];
  function coerce(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (!isNaN(Number(val))) return Number(val);
    return val;
  }
  for (let raw of lines) {
    let line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const indent = raw.match(/^\s*/)[0].length;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const content = line.trimStart();
    const m = content.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val === '' || val === null) {
      parent[key] = {};
      stack.push({indent, obj: parent[key]});
    } else {
      parent[key] = coerce(val);
    }
  }
  return root;
}

// --- CSV helpers ---
function parseCsv(text) {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((h) => h.trim());
  return rows.map((row) => {
    if (!row.trim()) return null;
    const cols = row.split(',');
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i] === '' ? '' : cols[i]));
    return obj;
  }).filter(Boolean);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, {recursive: true});
}

// --- Data loading ---
function loadTimeseries(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  return rows.map((r) => ({
    ts: new Date(r.timestamp_utc),
    price: Number(r.price_sek_per_kwh),
    tempOut: Number(r.temp_out_c),
    tempIn: Number(r.temp_in_c),
    setpoint: r.setpoint_c ? Number(r.setpoint_c) : null,
    humidity: Number(r.humidity_in_pct),
    occupancy: Number(r.occupancy) || 0,
  }));
}

function loadDeviceLimits(file) {
  const row = parseCsv(fs.readFileSync(file, 'utf8'))[0];
  return {
    minSetpoint: Number(row.min_setpoint_c),
    maxSetpoint: Number(row.max_setpoint_c),
    maxRatePerStep: Number(row.max_rate_c_per_5min),
    minCycleMinutes: Number(row.min_cycle_minutes),
    maxStartsPerHour: Number(row.max_compressor_starts_per_hour),
    maxPowerKw: Number(row.max_power_kw),
  };
}

function loadCopCurve(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const table = rows.map((r) => ({
    tempOut: Number(r.temp_out_c),
    delta: Number(r.delta_c),
    cop: Number(r.cop),
  }));
  table.sort((a, b) => a.tempOut - b.tempOut || a.delta - b.delta);
  const deltas = Array.from(new Set(table.map((t) => t.delta))).sort((a, b) => a - b);
  return {table, deltas};
}

function nearest(arr, x) {
  return arr.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), arr[0]);
}

function copLookup(copData, tempOut, delta) {
  const d = nearest(copData.deltas, Math.max(1, Math.min(5, delta)));
  const rows = copData.table.filter((r) => r.delta === d);
  // linear interpolate on tempOut
  if (tempOut <= rows[0].tempOut) return rows[0].cop;
  if (tempOut >= rows[rows.length - 1].tempOut) return rows[rows.length - 1].cop;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (tempOut <= b.tempOut) {
      const t = (tempOut - a.tempOut) / (b.tempOut - a.tempOut);
      return a.cop + t * (b.cop - a.cop);
    }
  }
  return rows[rows.length - 1].cop;
}

// --- Price percentile helpers ---
function windowPercentile(prices, idx, horizonSteps, p) {
  const slice = prices.slice(idx, Math.min(prices.length, idx + horizonSteps));
  if (!slice.length) return 0.5;
  const sorted = [...slice].sort((a, b) => a - b);
  const k = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[k];
}

function priceToPercentile(prices, idx, horizonSteps, price) {
  const slice = prices.slice(idx, Math.min(prices.length, idx + horizonSteps)).sort((a, b) => a - b);
  if (!slice.length) return 0.5;
  let count = 0;
  for (const v of slice) if (v <= price) count++;
  return count / slice.length; // 0..1
}

// --- Setpoint strategies ---
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function bandFor(config, occupied) {
  const band = occupied ? config.comfort_band.occupied : config.comfort_band.away;
  return {lower: band.lower_c, upper: band.upper_c};
}

function nextSetpointV1(ctx) {
  const {config, limits, prices, idx} = ctx;
  const band = bandFor(config, ctx.occ === 1);
  const horizonSteps = Math.round((config.scheduler?.horizon_hours ?? 12) * 60 / (config.scheduler?.step_minutes ?? 5));
  const pctl = priceToPercentile(prices, idx, horizonSteps, ctx.price);
  const target = band.lower + (1 - pctl) * (band.upper - band.lower);
  const maxStep = limits.maxRatePerStep;
  const raw = isFinite(ctx.prevSetpoint) ? clamp(target, ctx.prevSetpoint - maxStep, ctx.prevSetpoint + maxStep) : clamp(target, limits.minSetpoint, limits.maxSetpoint);
  return clamp(raw, limits.minSetpoint, limits.maxSetpoint);
}

function nextSetpointV2(ctx) {
  const {config, limits, prices, idx, tempIn, tempOut} = ctx;
  const band = bandFor(config, ctx.occ === 1);
  const stepMin = config.scheduler?.step_minutes ?? 5;
  const horizonSteps = Math.round((config.preheat?.horizon_hours ?? 12) * 60 / stepMin);
  const pctl = priceToPercentile(prices, idx, horizonSteps, ctx.price); // 0 cheap .. 1 expensive
  const delta = Math.max(1, Math.abs((ctx.prevSetpoint ?? band.upper) - tempIn));
  const cop = ctx.copLookup(tempOut, delta);

  const cheapThresh = config.preheat?.cheap_percentile ?? 0.25;
  const deadband = config.safety?.deadband_c ?? 0.3;

  // Forward-looking price context
  const lookFwdSteps = Math.max(6, Math.min(horizonSteps, 12)); // ~1 hour
  const futurePrices = prices.slice(idx + 1, idx + 1 + lookFwdSteps);
  const futureAvg = futurePrices.length ? futurePrices.reduce((a,b)=>a+b,0) / futurePrices.length : ctx.price;
  const futureMoreExpensive = futureAvg > ctx.price * 1.15; // 15% higher avg ahead
  const future90 = futurePrices.length ? futurePrices.slice().sort((a,b)=>a-b)[Math.floor(0.9 * (futurePrices.length-1))] : ctx.price;

  let target = band.lower + (1 - pctl) * (band.upper - band.lower); // default maintain within band

  // Comfort recovery takes precedence
  if (tempIn < band.lower - deadband/2) {
    target = Math.min(band.upper + 0.2, limits.maxSetpoint);
  } else if (pctl <= cheapThresh && (cop >= 2.8) && ctx.occ === 1 && (config.preheat?.enable ?? true) && futureMoreExpensive && future90 > ctx.price * 1.3 && tempIn < band.upper - 0.1) {
    // Preheat when cheap, efficient, occupied, and pricier period is coming
    target = Math.min(band.upper + 0.25, limits.maxSetpoint);
  } else if (pctl >= 0.7 && tempIn > band.lower + 0.5) {
    // Coast when expensive and we have thermal buffer
    if (ctx.occ === 1) {
      target = Math.max(band.lower + 0.1, limits.minSetpoint); // never below lower when occupied
    } else {
      target = Math.max(band.lower - 0.1, limits.minSetpoint); // slight dip allowed when away
    }
  }

  // Extreme weather guardrail
  const extreme = config.safety?.extreme_weather_min_temp;
  if (typeof extreme === 'number' && tempOut <= -15) {
    target = Math.max(target, extreme);
  }

  // Comfort guardrail: if near/below lower, do not suggest below-band targets
  if (tempIn <= band.lower + deadband) {
    target = Math.max(target, band.lower + deadband);
  }

  // Mild smoothing to avoid jitter
  if (tempIn > band.upper + 0.2) {
    target = Math.min(target, band.upper);
  }
  if (isFinite(ctx.prevSetpoint)) {
    target = 0.85 * ctx.prevSetpoint + 0.15 * target;
  }

  const maxStep = limits.maxRatePerStep;
  const raw = isFinite(ctx.prevSetpoint) ? clamp(target, ctx.prevSetpoint - maxStep, ctx.prevSetpoint + maxStep) : clamp(target, limits.minSetpoint, limits.maxSetpoint);
  return clamp(raw, limits.minSetpoint, limits.maxSetpoint);
}

// --- Thermal model simulation ---
function simulateStrategy(name, series, prices, config, limits, copData, chooseSetpoint) {
  const stepMin = config.scheduler?.step_minutes ?? 5;
  const dt_h = stepMin / 60;
  const R = config.thermal_model?.r_thermal ?? 2.5; // C*h/kW
  const C = config.thermal_model?.c_thermal ?? 10.0; // kWh/C
  const deadband = config.safety?.deadband_c ?? 0.3;
  const minCycleMin = limits.minCycleMinutes ?? 10;
  const minCycleSteps = Math.ceil(minCycleMin / stepMin);

  let tempIn = series[0]?.tempIn ?? 20.0;
  let heating = false;
  let lastSwitchIdx = -9999;
  let lastSetpoint = clamp(series[0]?.setpoint ?? tempIn, limits.minSetpoint, limits.maxSetpoint);
  let switches = 0;
  let minutesOutsideComfort = 0;
  let totalEnergy = 0; // kWh
  let totalCost = 0; // SEK
  let energyWeightedCopNum = 0; // sum(cop * energy)
  let energyWeightedDen = 0; // sum(energy)

  const outRows = [];

  const pricesArr = prices;
  const copLookupFn = (to, d) => copLookup(copData, to, d);

  for (let i = 0; i < series.length; i++) {
    const rec = series[i];
    const price = rec.price;
    const tempOut = rec.tempOut;
    const occ = rec.occupancy;

    const setpoint = chooseSetpoint({
      config,
      limits,
      prices: pricesArr,
      idx: i,
      price,
      occ,
      tempIn,
      tempOut,
      prevSetpoint: lastSetpoint,
      copLookup: copLookupFn,
    });

    // Hysteresis on setpoint control
    let targetHeating = heating;
    if (tempIn < setpoint - deadband / 2) targetHeating = true;
    else if (tempIn > setpoint + deadband / 2) targetHeating = false;

    // Respect min cycle time
    if (targetHeating !== heating && i - lastSwitchIdx < minCycleSteps) {
      // forbid switch
      targetHeating = heating;
    }
    if (targetHeating !== heating) {
      heating = targetHeating;
      lastSwitchIdx = i;
      switches++;
    }

    // Heat loss through envelope
    const q_loss_kw = Math.max(0, (tempIn - tempOut) / R);

    // Heating power and COP
    let cop = 0;
    let p_elec_kw = 0;
    let q_in_kw = 0;
    if (heating) {
      const delta = Math.max(1, Math.abs(setpoint - tempIn));
      cop = clamp(copLookupFn(tempOut, delta), 1.2, 5.0);
      p_elec_kw = limits.maxPowerKw; // simple constant power when ON
      q_in_kw = p_elec_kw * cop;
    }

    // Net heat into thermal mass and update indoor temp
    const q_net_kw = Math.max(0, q_in_kw) - q_loss_kw;
    const dT = (q_net_kw * dt_h) / C;
    tempIn = tempIn + dT;

    // Track metrics
    const band = bandFor(config, occ === 1);
    if (tempIn < band.lower || tempIn > band.upper) minutesOutsideComfort += stepMin;
    const energy_kwh = p_elec_kw * dt_h;
    totalEnergy += energy_kwh;
    totalCost += energy_kwh * price;
    if (heating && energy_kwh > 0) {
      energyWeightedCopNum += cop * energy_kwh;
      energyWeightedDen += energy_kwh;
    }

    outRows.push({
      timestamp_utc: rec.ts.toISOString(),
      price_sek_per_kwh: price.toFixed(4),
      temp_out_c: tempOut.toFixed(2),
      temp_in_c: tempIn.toFixed(2),
      setpoint_c: setpoint.toFixed(2),
      heating: heating ? 1 : 0,
      power_kw: p_elec_kw.toFixed(3),
      cop: cop ? cop.toFixed(2) : '',
      occupancy: occ,
    });

    lastSetpoint = setpoint;
  }

  const avgCop = energyWeightedDen > 0 ? energyWeightedCopNum / energyWeightedDen : 0;
  const comfortWeight = config.weights?.comfort_penalty_per_minute ?? 0;
  const switchWeight = config.weights?.switch_penalty ?? 0;
  const composite = totalCost + comfortWeight * minutesOutsideComfort + switchWeight * switches;

  return {
    name,
    rows: outRows,
    metrics: {
      total_cost_sek: Number(totalCost.toFixed(4)),
      total_energy_kwh: Number(totalEnergy.toFixed(4)),
      minutes_outside_comfort: minutesOutsideComfort,
      compressor_switches: switches,
      average_cop: Number(avgCop.toFixed(3)),
      composite_score: Number(composite.toFixed(4)),
    },
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => String(r[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  const dataPath = args.data || 'data/timeseries.csv';
  const configPath = args.config || 'data/config.yaml';
  const outputDir = args.output || 'results';
  const deviceLimitsPath = 'data/device_limits.csv';
  const copCurvePath = 'data/cop_curve.csv';

  console.log('🔄 Loading simulation data...');
  const series = loadTimeseries(dataPath);
  const prices = series.map((r) => r.price);
  const limits = loadDeviceLimits(deviceLimitsPath);
  const config = parseSimpleYaml(fs.readFileSync(configPath, 'utf8'));
  // Basic validation
  if (!config.comfort_band || !config.comfort_band.occupied || !config.comfort_band.away) {
    console.error('⚠️ Parsed config looks unexpected. Parsed object:');
    try { console.error(JSON.stringify(config, null, 2)); } catch {}
    throw new Error('Invalid config: missing comfort_band.occupied/away');
  }
  const copData = loadCopCurve(copCurvePath);

  console.log(`📊 Simulating ${series.length} data points...`);

  const v1 = simulateStrategy('baseline', series, prices, config, limits, copData, nextSetpointV1);
  const v2 = simulateStrategy('v2', series, prices, config, limits, copData, nextSetpointV2);

  // Write outputs
  ensureDir(outputDir);
  const out1 = path.join(outputDir, 'baseline_decisions.csv');
  const out2 = path.join(outputDir, 'v2_decisions.csv');
  const metricsPath = path.join(outputDir, 'metrics.json');
  fs.writeFileSync(out1, toCsv(v1.rows));
  fs.writeFileSync(out2, toCsv(v2.rows));
  fs.writeFileSync(metricsPath, JSON.stringify({baseline: v1.metrics, v2: v2.metrics}, null, 2));

  console.log('\n🎯 Simulation Results:');
  function fmt(m) {
    return [
      `  Total Cost: ${m.total_cost_sek.toFixed(2)} SEK`,
      `  Total Energy: ${m.total_energy_kwh.toFixed(2)} kWh`,
      `  Minutes Outside Comfort: ${m.minutes_outside_comfort} min`,
      `  Compressor Switches: ${m.compressor_switches}`,
      `  Average COP: ${m.average_cop.toFixed(2)}`,
      `  Composite Score: ${m.composite_score.toFixed(2)} (lower is better)`,
    ].join('\n');
  }
  console.log('\nBaseline (Algorithm v1):\n' + fmt(v1.metrics));
  console.log('\nAlgorithm v2:\n' + fmt(v2.metrics));

  // Improvement summary
  const costDelta = v1.metrics.total_cost_sek - v2.metrics.total_cost_sek;
  const costPct = v1.metrics.total_cost_sek > 0 ? (costDelta / v1.metrics.total_cost_sek) * 100 : 0;
  const energyDelta = v1.metrics.total_energy_kwh - v2.metrics.total_energy_kwh;
  const energyPct = v1.metrics.total_energy_kwh > 0 ? (energyDelta / v1.metrics.total_energy_kwh) * 100 : 0;
  const comfortDelta = v1.metrics.minutes_outside_comfort - v2.metrics.minutes_outside_comfort;
  const switchesDelta = v1.metrics.compressor_switches - v2.metrics.compressor_switches;

  console.log('\n✨ Improvement Summary:');
  console.log(`  Cost: ${costDelta >= 0 ? '↓' : '↑'} ${Math.abs(costDelta).toFixed(2)} SEK (${costPct.toFixed(1)}%)`);
  console.log(`  Energy: ${energyDelta >= 0 ? '↓' : '↑'} ${Math.abs(energyDelta).toFixed(2)} kWh (${energyPct.toFixed(1)}%)`);
  console.log(`  Comfort: ${comfortDelta >= 0 ? '+' : ''}${comfortDelta} min within band`);
  console.log(`  Compressor cycles: ${switchesDelta >= 0 ? '-' : '+'}${Math.abs(switchesDelta)} changes`);

  console.log(`\n📁 Outputs saved to ${outputDir}/`);
}

main();

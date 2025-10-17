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
const { applySetpointConstraints } = require('./src/util/setpoint-constraints');
const { computePlanningBias, updateThermalResponse } = require('./src/services/planning-utils');
const { DefaultComfortConfig } = require('./src/config/comfort-defaults');

// Import the real optimizer that's actually used in production
const { Optimizer } = require('./src/services/optimizer');
const { TimeZoneHelper } = require('./src/util/time-zone-helper');

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

function makeSeededRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseScenarioCsv(text) {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((h) => h.trim());
  return rows
    .map((row) => {
      if (!row.trim()) return null;
      const cols = row.split(',');
      const obj = {};
      headers.forEach((h, i) => {
        const raw = cols[i] ?? '';
        if (raw === '') {
          obj[h] = null;
        } else if (!Number.isNaN(Number(raw))) {
          obj[h] = Number(raw);
        } else if (raw === 'true' || raw === 'false') {
          obj[h] = raw === 'true';
        } else {
          obj[h] = raw;
        }
      });
      return obj;
    })
    .filter(Boolean);
}

function loadScenarioTimeline(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const text = fs.readFileSync(filePath, 'utf8');
  if (ext === '.json') {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error(`Scenario input ${filePath} must be an array`);
    }
    return data;
  }
  if (ext === '.csv') {
    return parseScenarioCsv(text);
  }
  throw new Error(`Unsupported scenario input format for ${filePath}`);
}

function computePricePercentile(pricePoints, currentPrice) {
  const valid = pricePoints.filter((p) => Number.isFinite(p.price));
  if (!valid.length || !Number.isFinite(currentPrice)) return 0.5;
  const cheaperOrEqual = valid.filter((p) => p.price <= currentPrice).length;
  return cheaperOrEqual / valid.length;
}

function defaultScenarioLogger() {
  return {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
  };
}

function runScenarioHarness(options) {
  const {
    scenarioName = 'ad-hoc',
    timeline,
    seed = 1337,
    priceProvider,
    melCloud,
    logger = defaultScenarioLogger(),
    config = {
      comfortOccupied: DefaultComfortConfig.comfortOccupied,
      comfortAway: DefaultComfortConfig.comfortAway,
      minSetpointC: 18,
      maxSetpointC: 23,
      stepMinutes: 60,
      safety: { deadbandC: 0.3, minSetpointChangeMinutes: 30 }
    },
    thrashLimitPerDay = 12
  } = options || {};

  if (!Array.isArray(timeline) || timeline.length === 0) {
    throw new Error('Scenario timeline must be a non-empty array');
  }

  const sorted = timeline
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const ts = new Date(row.ts || row.timestamp || row.time);
      if (!Number.isFinite(ts.getTime())) return null;
      const priceRaw = row.price;
      let price = Number(priceRaw);
      if (
        priceRaw === null ||
        priceRaw === undefined ||
        priceRaw === '' ||
        (typeof priceRaw === 'string' && priceRaw.trim() === '') ||
        Number.isNaN(price)
      ) {
        price = NaN;
      }
      return {
        ts: ts.toISOString(),
        price,
        outdoor: Number(row.outdoor ?? row.outdoorTemp ?? row.tempOut ?? 0),
        indoorStart: row.indoor ?? row.indoorTempStart ?? row.tempIn,
        occupied: typeof row.occupied === 'boolean' ? row.occupied : Boolean(row.occupied ?? true),
        weatherTrend: Number(row.weatherTrend ?? 0),
        events: Array.isArray(row.events) ? row.events : [],
        metadata: row
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const pricePoints = sorted.map((entry) => ({
    time: entry.ts,
    price: entry.price
  }));

  let indoor = Number.isFinite(sorted[0].indoorStart) ? Number(sorted[0].indoorStart) : 20;
  let currentTarget = indoor;
  let thermalResponse = 1.0;
  let lastChangeMs = null;
  const rng = makeSeededRng(seed);
  const tzHelper = new TimeZoneHelper(
    {
      log: () => {},
      warn: () => {}
    },
    1,
    true,
    'Europe/Stockholm'
  );

  if (Number.isFinite(sorted[0]?.metadata?.thermalResponse)) {
    thermalResponse = clamp(Number(sorted[0].metadata.thermalResponse), 0.2, 2);
  }

  const toDayKey = (isoTs) => {
    const date = new Date(isoTs);
    try {
      const formatted = tzHelper.formatDate(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const match = formatted.match(/(\d{4}).?(\d{2}).?(\d{2})/);
      if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
      }
    } catch {
      // fall back below
    }
    return date.toISOString().slice(0, 10);
  };

  const setpointChangesByDay = new Map();
  const summary = {
    totalWrites: 0,
    holdsByReason: {},
    comfortViolationHours: 0,
    totalHours: sorted.length,
    occupiedHours: 0,
    comfortSquares: 0,
    savingsEstimate: 0,
    percentileBuckets: []
  };

  const rows = [];
  const melState = {
    rateLimited: false
  };

  const mel = melCloud || {
    async setTarget(targetC, context) {
      if (context && context.flags && context.flags.includes('melcloud_429') && !melState.rateLimited) {
        melState.rateLimited = true;
        throw new Error('429 Too Many Requests');
      }
      return Promise.resolve();
    }
  };

  const priceInfoPromise = priceProvider && typeof priceProvider.getPrices === 'function'
    ? priceProvider.getPrices()
    : Promise.resolve({ prices: pricePoints, current: { price: pricePoints[0]?.price ?? 0, time: pricePoints[0]?.time } });

  const seen429 = new Set();

  return Promise.resolve(priceInfoPromise)
    .then(async () => {
      for (let idx = 0; idx < sorted.length; idx++) {
        const entry = sorted[idx];
        const now = new Date(entry.ts);
      const price = entry.price;
      const outdoor = entry.outdoor;
      const occupied = entry.occupied;
      const comfortBand = occupied ? config.comfortOccupied : config.comfortAway;
      const flags = new Set(entry.events || []);
      const dayKey = toDayKey(entry.ts);
      const changesToday = setpointChangesByDay.get(dayKey) || 0;

        const percentile = computePricePercentile(pricePoints, price);

        let targetBefore = currentTarget;
        let decisionReason = 'hold';
        let planningBiasResult = { biasC: 0, hasCheap: false, hasExpensive: false, windowHours: 6 };
        let forcedHoldReason = null;

        if (!Number.isFinite(price)) {
          decisionReason = 'price outage';
          forcedHoldReason = 'price_outage';
        } else {
          // Use the actual advanced optimizer with all its sophisticated features
          try {
            // Create a mock price provider for the optimizer
            const mockPriceProvider = {
              getPrices: () => Promise.resolve({
                current: { price, time: now.toISOString() },
                prices: pricePoints.map(p => ({ price: p.price, time: p.time })),
                currencyCode: 'SEK'
              })
            };
            
            // Create a mock MELCloud API for the optimizer
            const mockMelCloud = {
              getDeviceState: () => Promise.resolve({
                RoomTemperature: indoor,
                SetTemperature: currentTarget,
                OutdoorTemperature: outdoor,
                IdleZone1: false
              }),
              setDeviceTemperature: (deviceId, buildingId, temp) => {
                // Capture the temperature decision from the advanced optimizer
                targetBefore = temp;
                return Promise.resolve();
              },
              getDailyEnergyTotals: () => Promise.resolve({
                TotalHeatingConsumed: 10,
                TotalHotWaterConsumed: 5,
                AverageHeatingCOP: 2.5,
                AverageHotWaterCOP: 2.0
              })
            };
            
            // Create a simple logger for the optimizer
            const mockLogger = {
              log: () => {},
              error: () => {},
              warn: () => {},
              info: () => {}
            };
            
            // Create optimizer instance with all advanced features:
            // - COP tracking, thermal learning, weather adjustments
            // - Home/Away optimization, adaptive parameters
            // - Enhanced savings calculations, hot water scheduling
            const optimizer = new Optimizer(
              mockMelCloud,
              mockPriceProvider,
              'sim-device',
              1,
              mockLogger
            );
            
            // Set occupancy state for home/away optimization
            optimizer.setOccupied(occupied);
            
            // Run the full advanced optimization with all features
            const result = await optimizer.runHourlyOptimization();
            targetBefore = result.targetTemp;
            decisionReason = result.reason;
            
          } catch (error) {
            // Fallback to basic price-based logic if advanced optimizer fails
            const band = occupied ? config.comfortOccupied : config.comfortAway;
            const prices = pricePoints.map(p => p.price).filter(p => Number.isFinite(p));
            const avgPrice = prices.length > 0 ? prices.reduce((sum, p) => sum + p, 0) / prices.length : price;
            
            if (price < avgPrice * 0.8) {
              targetBefore = Math.min(band.upperC, currentTarget + 0.5);
              decisionReason = 'cheap electricity → raise temp (fallback)';
            } else if (price > avgPrice * 1.2) {
              targetBefore = Math.max(band.lowerC, currentTarget - 0.5);
              decisionReason = 'expensive electricity → lower temp (fallback)';
            } else {
              targetBefore = currentTarget;
              decisionReason = 'moderate prices → maintain (fallback)';
            }
          }

          planningBiasResult = computePlanningBias(pricePoints, now, {
            windowHours: 6,
            lookaheadHours: 12,
            cheapPercentile: 25,
            expensivePercentile: 75,
            cheapBiasC: 0.5,
            expensiveBiasC: 0.3,
            maxAbsBiasC: 0.7
          });
        }

        const scaledBiasRaw = planningBiasResult.biasC * thermalResponse;
        const scaledBias = Number.isFinite(scaledBiasRaw)
          ? clamp(scaledBiasRaw, -0.7, 0.7)
          : 0;
        const targetAfter = targetBefore + scaledBias;

        const proposedTarget = occupied
          ? Math.max(targetAfter, comfortBand.lowerC + 0.3)
          : targetAfter;

        const constraints = applySetpointConstraints({
          proposedC: proposedTarget,
          currentTargetC: currentTarget,
          minC: config.minSetpointC,
          maxC: config.maxSetpointC,
          stepC: 0.5,
          deadbandC: config.safety.deadbandC,
          minChangeMinutes: config.safety.minSetpointChangeMinutes,
          lastChangeMs,
          nowMs: now.getTime()
        });

        let holdReason = forcedHoldReason
          ? forcedHoldReason
          : !constraints.changed
            ? 'deadband'
            : constraints.lockoutActive
              ? 'lockout'
              : 'ok';

        const pendingChange = constraints.changed ? 1 : 0;
        if (holdReason === 'ok' && changesToday + pendingChange > thrashLimitPerDay) {
          holdReason = 'thrash_limit';
        }

        if (holdReason !== 'ok') {
          summary.holdsByReason[holdReason] = (summary.holdsByReason[holdReason] || 0) + 1;
        }

        let finalTarget = currentTarget;
        let changeApplied = false;

        if (holdReason === 'ok' && Number.isFinite(price)) {
          const context = { flags: Array.from(flags), idx, ts: entry.ts };
          let attempts = 0;
          let succeeded = false;
          let lastError = null;

          while (attempts < 2 && !succeeded) {
            try {
              melState.latestCall = { idx, target: constraints.constrainedC, attempts: attempts + 1 };
              await mel.setTarget(constraints.constrainedC, context);
              succeeded = true;
            } catch (error) {
              lastError = error;
              const errMsg = (error && error.message) || String(error);
              if (errMsg.includes('429') && attempts === 0) {
                seen429.add(idx);
                const jitterMs = Math.round(rng() * 3000) + 500;
                logger.warn('[melcloud.rate_limit]', {
                  scenario: scenarioName,
                  idx,
                  jitterMs,
                  target: constraints.constrainedC
                });
                await new Promise((resolve) => setTimeout(resolve, Math.min(jitterMs, 50)));
                attempts += 1;
                continue;
              }
              break;
            }
          }

          if (succeeded) {
            finalTarget = constraints.constrainedC;
            currentTarget = finalTarget;
            lastChangeMs = now.getTime();
            summary.totalWrites += 1;
            changeApplied = true;
            const currentCount = setpointChangesByDay.get(dayKey) || 0;
            const newCount = Math.min(thrashLimitPerDay, currentCount + 1);
            setpointChangesByDay.set(dayKey, newCount);
          } else if (lastError) {
            const errMsg = (lastError && lastError.message) || String(lastError);
            if (errMsg.includes('429')) {
              summary.holdsByReason['rate_limit'] = (summary.holdsByReason['rate_limit'] || 0) + 1;
            } else {
              summary.holdsByReason['apply_error'] = (summary.holdsByReason['apply_error'] || 0) + 1;
            }
          }
        }

        if (!changeApplied) {
          finalTarget = currentTarget;
        }

        const comfortLower = comfortBand.lowerC - 0.1;
        const comfortUpper = comfortBand.upperC + 0.1;
        const comfortViolation = occupied && (indoor < comfortLower || indoor > comfortUpper);
        if (occupied) {
          summary.occupiedHours += 1;
          if (comfortViolation) {
            summary.comfortViolationHours += 1;
          }
          const comfortMid = (comfortBand.lowerC + comfortBand.upperC) / 2;
          summary.comfortSquares += Math.pow(indoor - comfortMid, 2);
        }
        summary.savingsEstimate += (targetBefore - finalTarget) * (Number.isFinite(price) ? price : 0) * 0.1;
        summary.percentileBuckets.push(percentile);

        const setpointChangesToday = setpointChangesByDay.get(dayKey) || 0;

        logger.log('[optimizer.planning.bias]', {
          scenario: scenarioName,
          idx,
          ts: entry.ts,
          rawBiasC: planningBiasResult.biasC,
          scaledBiasC: scaledBias,
          thermalResponse
        });

        logger.log('[constraints.setpoint]', {
          scenario: scenarioName,
          idx,
          ts: entry.ts,
          reason: constraints.reason,
          changed: constraints.changed,
          lockout: constraints.lockoutActive
        });

        const indoorNext = (() => {
          const targetDelta = finalTarget - indoor;
          const relaxation = clamp(targetDelta * (0.85 * thermalResponse), -2.5, 2.5);
          const envelopeLoss = Math.max(0, indoor - outdoor) * 0.008;
          const trendEffect = Number(entry.weatherTrend || 0) * 0.05;
          const projected = indoor + relaxation - envelopeLoss + trendEffect;
          let adjusted = clamp(projected, config.minSetpointC - 1, config.maxSetpointC + 1.5);
          if (occupied && adjusted < comfortBand.lowerC) {
            adjusted = comfortBand.lowerC;
          }
          if (occupied && adjusted > comfortBand.upperC + 0.3) {
            adjusted = comfortBand.upperC + 0.3;
          }
          return adjusted;
        })();

        const observedDelta = indoorNext - indoor;
        const expectedDelta = clamp((finalTarget - indoor) * 0.05 * thermalResponse, -0.6, 0.6);
        const updatedThermal = updateThermalResponse(thermalResponse, observedDelta, expectedDelta, {
          alpha: 0.1,
          min: 0.5,
          max: 1.5
        });

        if (Math.abs(updatedThermal - thermalResponse) > 1e-6) {
          logger.log('[optimizer.thermal.update]', {
            previous: thermalResponse,
            observedDelta,
            expectedDelta,
            updated: updatedThermal
          });
          thermalResponse = Number(updatedThermal.toFixed(4));
        }

        rows.push({
          ts: entry.ts,
          price: Number.isFinite(price) ? Number(price.toFixed(4)) : null,
          percentile: Number(percentile.toFixed(3)),
          outdoor: Number(outdoor.toFixed(2)),
          indoor: Number(indoor.toFixed(2)),
          target_before: Number(targetBefore.toFixed(2)),
          planning_bias_c: Number(planningBiasResult.biasC.toFixed(2)),
          bias_c: Number(scaledBias.toFixed(2)),
          target_after: Number(proposedTarget.toFixed(2)),
          applied: Number(finalTarget.toFixed(2)),
          reason: [decisionReason, constraints.reason].filter(Boolean).join(' | '),
          thermalResponse: Number(thermalResponse.toFixed(2)),
          setpoint_changes_today: setpointChangesToday,
          comfort_violation: comfortViolation ? 1 : 0
        });

        indoor = Number(indoorNext.toFixed(2));
      }

      const comfortRms = Math.sqrt(summary.comfortSquares / Math.max(1, summary.occupiedHours));
      const holdsByReason = summary.holdsByReason;
      const summaryOut = {
        totalWrites: summary.totalWrites,
        holdsByReason,
        comfortRms: Number(comfortRms.toFixed(3)),
        savingsEstimate: Number(summary.savingsEstimate.toFixed(2)),
        comfortViolationHours: summary.comfortViolationHours,
        occupiedHours: summary.occupiedHours,
        percentileAvg: summary.percentileBuckets.length
          ? summary.percentileBuckets.reduce((a, b) => a + b, 0) / summary.percentileBuckets.length
          : 0
      };

      return {
        rows,
        summary: summaryOut,
        metadata: {
          scenarioName,
          seed,
          setpointChangesByDay: Object.fromEntries(setpointChangesByDay.entries()),
          lastThermalResponse: thermalResponse,
          rateLimitedWrites: Array.from(seen429.values()),
          thrashLimitPerDay
        }
      };
    });
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

function percentile(values, fraction) {
  if (!values.length) return NaN;
  if (values.length === 1) return values[0];
  const idx = Math.max(0, Math.min(values.length - 1, Math.round(fraction * (values.length - 1))));
  return values[idx];
}

function computePlanningBiasSim(prices, startIndex, windowHours = 6, lookaheadHours = 12) {
  if (!Array.isArray(prices) || prices.length === 0) return 0;
  const future = [];
  for (let i = startIndex + 1; i < prices.length && future.length < lookaheadHours; i++) {
    const entry = prices[i];
    const price = Number(entry?.price);
    if (Number.isFinite(price)) {
      future.push(price);
    }
  }
  if (!future.length) return 0;
  const sorted = [...future].sort((a, b) => a - b);
  const cheapCut = percentile(sorted, 0.25);
  const expensiveCut = percentile(sorted, 0.75);
  if (!Number.isFinite(cheapCut) || !Number.isFinite(expensiveCut)) return 0;
  const windowSlice = future.slice(0, windowHours);
  const hasCheap = windowSlice.some(price => price < cheapCut);
  const hasExpensive = windowSlice.some(price => price > expensiveCut);
  let bias = 0;
  if (hasCheap) bias += 0.5;
  if (hasExpensive) bias -= 0.3;
  return Math.max(-0.7, Math.min(0.7, bias));
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

    const planningBias = computePlanningBiasSim(pricesArr, i);
    const setpointBiased = clamp(setpoint + planningBias, limits.minSetpoint, limits.maxSetpoint);

    // Hysteresis on setpoint control
    let targetHeating = heating;
    if (tempIn < setpointBiased - deadband / 2) targetHeating = true;
    else if (tempIn > setpointBiased + deadband / 2) targetHeating = false;

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
      const delta = Math.max(1, Math.abs(setpointBiased - tempIn));
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
      setpoint_c: setpointBiased.toFixed(2),
      planning_bias_c: planningBias.toFixed(2),
      heating: heating ? 1 : 0,
      power_kw: p_elec_kw.toFixed(3),
      cop: cop ? cop.toFixed(2) : '',
      occupancy: occ,
    });

    lastSetpoint = setpointBiased;
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
    lines.push(
      headers
        .map((h) => {
          const value = r[h];
          if (value === null || value === undefined) return '';
          return String(value);
        })
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.scenario) {
    const scenarioName = String(args.scenario);
    const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : 1337;
    const defaultInput = path.join('test', 'fixtures', `${scenarioName}.json`);
    const inputPath = path.resolve(process.cwd(), args.input ? String(args.input) : defaultInput);
    const outputDir = path.resolve(process.cwd(), args.output ? String(args.output) : 'artifacts');

    ensureDir(outputDir);

    let timeline;
    try {
      timeline = loadScenarioTimeline(inputPath);
    } catch (error) {
      console.error(`Failed to load scenario timeline for ${scenarioName}:`, error.message || error);
      process.exitCode = 1;
      return;
    }

    runScenarioHarness({
      scenarioName,
      timeline,
      seed
    })
      .then(({ rows, summary, metadata }) => {
        const csvOut = toCsv(rows);
        const csvPath = path.join(outputDir, `${scenarioName}.csv`);
        fs.writeFileSync(csvPath, csvOut);
        const summaryPath = path.join(outputDir, `${scenarioName}.summary.json`);
        fs.writeFileSync(summaryPath, JSON.stringify({ summary, metadata }, null, 2));

        console.log(`\nScenario '${scenarioName}' complete (seed ${seed}).`);
        console.log(`CSV: ${csvPath}`);
        console.log(`Summary: ${summaryPath}`);
        console.log('\nSummary metrics:');
        console.log(`  Total writes: ${summary.totalWrites}`);
        console.log(`  Holds by reason: ${JSON.stringify(summary.holdsByReason)}`);
        console.log(`  Comfort RMS: ${summary.comfortRms}`);
        console.log(`  Comfort violations (hours): ${summary.comfortViolationHours}`);
        console.log(`  Savings estimate: ${summary.savingsEstimate}`);
      })
      .catch((error) => {
        console.error('Scenario harness failed:', error);
        process.exitCode = 1;
      });
    return;
  }

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

export { runScenarioHarness };

if (require.main === module) {
  main();
}

module.exports = {
  runScenarioHarness
};

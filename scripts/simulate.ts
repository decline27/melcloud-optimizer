#!/usr/bin/env node
// @ts-nocheck
/**
 * Wrapper script to run the repository simulation harness and print KPIs.
 *
 * Usage:
 *   node scripts/simulate.js --data data/timeseries.csv --config data/config.yaml --output results/
 */

const { spawn } = require('child_process');
const path = require('path');

function run() {
  const args = process.argv.slice(2);
  const script = path.join(__dirname, '..', 'simulate.js');
  const proc = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
  proc.on('exit', (code) => process.exit(code));
}

run();

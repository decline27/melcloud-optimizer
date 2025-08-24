/* eslint-disable */
'use strict';

const path = require('path');

// Minimal wrapper that prefers a compiled/packaged API implementation.
// Order of preference: .homeybuild -> lib/dist -> src (for ts-jest). If none
// found, fall back to legacy api.legacy.js to avoid breaking older workflows.
// Order of preference for runtime API implementation. Keep compiled artifacts
// first for production, but allow loading the TypeScript source in test/dev
// environments when ts-node is available. This lets tests run against the
// TypeScript implementation without requiring a build step.
const candidates = [
  path.join(__dirname, '.homeybuild', 'api.js'),
  path.join(__dirname, 'lib', 'index.js'),
  path.join(__dirname, 'lib', 'api.js'),
  path.join(__dirname, 'dist', 'api.js'),
  path.join(__dirname, 'build', 'api.js')
];

// Prefer loading the TypeScript source in development when ts-node is
// available. Try registering ts-node whenever possible so running the app
// with the TypeScript source works without a build step. If ts-node is not
// installed, fall back to compiled candidates or the legacy shim.
try {
  // This will succeed only if ts-node is installed as a dependency.
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
  candidates.unshift(path.join(__dirname, 'src', 'api.ts'));
} catch (e) {
  // ts-node not available; continue with compiled candidates and legacy fallback
}

let impl = null;
for (const p of candidates) {
  try {
    impl = require(p);
    if (impl) break;
  } catch (e) {
    // ignore
  }
}

if (!impl) {
  // If we didn't find any compiled or source implementation, fall back to
  // the legacy API backup. This fallback is intentionally minimal; if you
  // expect the full API endpoints to be available during development, make
  // sure `ts-node` is installed so `src/api.ts` can be loaded.
  try {
    impl = require('./api.legacy.js');
    console.warn('Using legacy API fallback. If endpoints are missing, install ts-node or build the project so the TypeScript API implementation is available.');
  } catch (e) {
    throw new Error('Failed to locate API implementation (compiled or legacy): ' + e.message);
  }
}

const root = {};
if (impl && typeof impl === 'object') Object.assign(root, impl);
else if (impl) root.Api = impl;

// Forward __test if present on the implementation so existing tests keep working
if (impl && impl.__test) root.__test = impl.__test;

module.exports = root;

// Log exported API endpoint names for diagnostics so we can verify ManagerApi
// sees the expected functions at runtime. This is helpful when debugging
// settings page 'missing implementation' issues.
try {
  const exported = Object.keys(root).filter(k => typeof root[k] === 'function');
  console.log('[api.js] Exported API endpoints:', exported);
} catch (e) {
  // ignore logging errors
}

# Legacy Map — JS -> TS mapping

Generated: 2025-08-23

This file lists JavaScript files found in the repository and their corresponding TypeScript implementation (if detected). Use this to plan canonicalization and cleanup.

## Summary

- Total JS files identified: 9 (root + services + lib + wrappers)
- Prefer canonical implementation: `src/**/*.ts` (TypeScript) where available

## Mapping

- `api.js` -> possible canonical: `src/api.ts`
- `api-compiled.js` -> generated artifact (ignore/remove if build output is handled via `.homeybuild/`)
- `enhanced-savings-calculator-wrapper.js` -> related to `src/util/enhanced-savings-calculator.ts`
- `timeline-helper-wrapper.js` -> related to `src/util/timeline-helper.ts`
- `weather.js` -> related to `src/weather-compat` or `src` utilities (no direct TS mapping found)
- `weather-compat.js` -> compatibility shim (no TS mapping found)
- `services/cop-helper.js` -> related to `src/services/cop-helper.ts`
- `lib/services/melcloud-api.js` -> related to `src/services/melcloud-api.ts` (lib copy is empty)
- `lib/constants.js` -> no matching `src/constants.ts` found (file appears empty)

### Actual JS files discovered in repo (2025-08-23)

- `api.js` (root)
- `api-compiled.js` (root)
- `enhanced-savings-calculator-wrapper.js` (root)
- `timeline-helper-wrapper.js` (root)
- `weather.js` (root)
- `weather-compat.js` (root)
- `services/cop-helper.js` (services/)
- `lib/services/melcloud-api.js` (lib/services/)
- `lib/constants.js` (lib/)
- `jest.config.js` (root)

Note: some files are generated (`api-compiled.js`, `.homeybuild/`), some are compatibility wrappers, and some are legacy copies of TS services.

## Recommendations

1. Treat `src/**/*.ts` as canonical implementations where present (e.g., `src/api.ts`, `src/services/melcloud-api.ts`, `src/services/cop-helper.ts`).
2. Move or remove legacy wrappers once canonical TS versions are validated. Prefer creating minimal compatibility shims that require compiled TS outputs from `.homeybuild/` or `dist/` rather than maintaining duplicate logic.
3. Mark generated artifacts (`api-compiled.js`, `.homeybuild/`) as build outputs and exclude them from source control if not required.

## Next steps

Run a focused pass to:

- Confirm runtime usage of `api.js` and `api-compiled.js` (settings UI, build scripts, or external tooling).
- Create a compatibility shim `bin/compat-api.js` that exports from the compiled TS output instead of keeping legacy code.
- Add `DEPRECATION.md` describing the removal plan and timeline.

# Quickstart: Quarter-Hour Pricing for DHW & Planning Bias

## Run Checks

- Type check: `npm run lint`
- Unit tests: `npm run test:unit`

## Test Guidance

- Add/update unit tests under `test/unit/` for:
  - Tibber and ENTSO-E price parsing with 15m vs hourly cadence (including gap/misaligned cases).
  - DHW block selection using synthetic 15m price arrays (enforce ≥30m blocks, ramp/tank respected, fallback to hourly when data is dirty).
  - Planning bias risk detection when a 15m spike is >25% above the hourly average; verify no change when quarter-hour data is absent or stable.

## Data Inputs

- Use existing Tibber mocks and extend with quarter-hour fixtures; add ENTSO-E 15m fixtures if missing.
- Ensure interval metadata (`intervalMinutes`, `quarterHourly`) is present in provider outputs for tests.

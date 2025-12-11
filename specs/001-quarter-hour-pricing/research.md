# Research: Quarter-Hour Pricing for DHW & Planning Bias

## Decisions

- **Minimum DHW block duration: 30 minutes (2×15m)**  
  - **Rationale**: Captures short cheap dips while limiting cycling risk; tank/ramp constraints still apply.  
  - **Alternatives**: 60m (too rigid, may miss savings), 45m (still risks missing brief dips).

- **Risky hour spike threshold: >25% above hourly average**  
  - **Rationale**: Balances sensitivity and noise; flags pronounced spikes without over-triggering.  
  - **Alternatives**: 20% (more noise, could blunt preheat), 30% (may miss meaningful spikes).

- **Provider coverage: Tibber + ENTSO-E quarter-hour when available; fallback to hourly**  
  - **Rationale**: Both providers can deliver 15m; fallback maintains stability when cadence is missing or dirty.  
  - **Alternatives**: Tibber-only (miss ENTSO-E 15m), forced aggregation (loses intra-hour signal).

## Notes

- Validate cadence detection in `tibber-api.ts` and add equivalent interval handling to `entsoe-price-service.ts`.
- Preserve hourly-or-slower room setpoint cadence and existing constraint manager rules.

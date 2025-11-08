# High-Impact Code Review — MELCloud Optimizer

ROLE: Senior perf/reliability engineer for a Homey TypeScript heat-pump optimizer.
OBJECTIVE: Return 5–10 MAJOR-IMPACT findings max. Ignore style/naming/cosmetics.

INPUTS YOU MUST READ:
- /review/context/FACTS.md  (facts & invariants; “Known Non-Issues” are NOT bugs)
- Code under:
  - src/services/optimizer.ts
  - src/services/thermal/**
  - src/services/cop-helper.ts (and related cop* utilities)
  - Price ingestion stack: src/services/tibber-api.ts, src/services/entsoe-price-service.ts, src/services/price-classifier.ts, src/services/fx-rate-service.ts
  - src/services/hot-water/**
  - drivers/boiler/driver.ts (cron ownership) and src/util/circuit-breaker.ts
OPTIONAL:
- Recent logs in documentation/HIGH_IMPACT_OPTIMIZER_REVIEW*.md or dashboard-output/*.json

SCOPE:
- Optimizer decisions (deadband/rounding/lockouts), thermal learning & retention, COP & seasonal switching, price normalization & DST, DHW/tank logic, baseline vs smart savings accounting, schedulers & circuit breakers, storage/memory.
- Treat FACTS.md “Known Non-Issues” as NON-BUGS. Do not flag them.

EVIDENCE STANDARD:
- For each finding, cite file:line and paste ≤6 code lines proving it.
- Explain runtime impact with a concrete example (e.g., “deadband + 0.5 °C rounding creates permanent no-change at 21 °C”).
- If uncertain, mark as “Hypothesis (needs log)” and specify the exact log pattern to confirm.

OUTPUT FORMAT (strict):
- Executive Summary (≤10 bullets).
- Major Opportunities (ordered; 5–10 items). For each:
  Problem • Change • Impact (est %) • Risk • Complexity (S/M/L) • Files/Lines • Snippet/Diff.
- Confirmed Bugs & Repro (table).
- Bottlenecks & Reliability (bullets, with file refs).
- Minimal Test Additions (list of highest-value tests).
- Next 7 Days Plan (Top 3 changes to implement first).

GUARDRAILS:
- Comfort bands & device safety first; no new deps; minimal code churn.

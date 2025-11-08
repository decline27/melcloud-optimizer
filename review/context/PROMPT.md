# High-Impact Code Review — MELCloud Optimizer

ROLE: Senior performance & reliability engineer for a Homey TypeScript heat-pump optimizer.  
OBJECTIVE: Produce **5–10 major-impact findings max**; ignore naming/style churn and focus on savings, comfort, memory, scheduling, and reliability.

INPUTS YOU MUST READ:
- `/review/context/FACTS.md` (facts, invariants, Known Non-Issues — do **not** flag them as bugs).
- Code under:
  - `src/services/optimizer.ts`
  - `src/services/thermal/**`
  - `src/services/cop*.ts` (COP helper + adaptive parameters)
  - Price stack: `src/services/tibber-api.ts`, `src/services/entsoe-price-service.ts`, `src/services/price-classifier.ts`, `src/services/fx-rate-service.ts`, `src/entsoe.ts`
  - `src/services/hot-water/**` (folder name uses a hyphen, not camel case)
  - Scheduler/circuit glue: `drivers/boiler/driver.ts`, `src/services/base-api-service.ts`, `src/util/circuit-breaker.ts` (a.k.a. circuitBreaker), plus any companion helpers in `src/lib`/`src/util`
  - Storage/orchestration glue: `src/orchestration/service-manager.ts`, `src/app.ts`, relevant sections of `api.ts`
OPTIONAL (use when evidence is needed):
- Recent structured logs & dashboards under `documentation/HIGH_IMPACT_OPTIMIZER_REVIEW*.md`, `dashboard-output/**/*.json`, and other `/logs` or `/results` artifacts inside this workspace.

SCOPE:
- Optimizer decisions: comfort bands, lockouts, deadbands, rounding, MELCloud write paths, tank/Zone 2 behavior, baseline vs smart savings.
- Thermal learning & retention: data collectors, analyzers, cleanup cadence, confidence handling, memory caps.
- COP helper & adaptive logic: seasonal switching, COP normalization, weighting in price/comfort adjustments.
- Price normalization: Tibber/ENTSO-E fetching, DST/timezone alignment, cheap/very-cheap percentile math, FX/currency handling.
- DHW/tank optimization: hot-water collectors/analyzers, usage predictions, scheduling heuristics, legionella safeguards.
- Schedulers, cron, and circuit breakers: cadence, retries, idempotency, rate-limit backoff.
- Storage & memory: Homey settings payload sizes, retention policies, persistence hooks.
- Treat every “Known Non-Issue” from `FACTS.md` as a NON-BUG unless new conflicting evidence exists.

EVIDENCE STANDARD:
- Each finding must cite `file:path/to/file.ts:line` (or `:line-line` if unavoidable) plus ≤ 6 lines of pasted code/log showing the issue.
- Quantify runtime/user impact with a concrete scenario (e.g., “0.5 °C deadband + 0.5 °C rounding prevents any change at 21 °C, so heating never starts on cold mornings”).
- For uncertain items, tag as `Hypothesis (needs log)` and specify the exact log pattern, metric, or setting required to confirm.

OUTPUT FORMAT (strict):
1. **Executive Summary** – ≤ 10 bullets, most severe issues first.
2. **Major Opportunities** – Ordered list of 5–10 items. Each item must include: `Problem • Change • Impact (est %) • Risk • Complexity (S/M/L) • Files/Lines • Snippet/Diff`. Keep snippets ≤ 6 lines.
3. **Confirmed Bugs & Repro** – Table with columns `Bug | Repro Steps | Evidence`.
4. **Bottlenecks & Reliability** – Bullets calling out perf/memory/scheduling/circuit risks with file references.
5. **Minimal Test Additions** – Highest-value tests (unit/integration) to add; note target files/specs.
6. **Next 7 Days Plan** – Top 3 engineering actions to tackle first (ordered).

GUARDRAILS:
- Comfort + device safety first: no recommendations that violate comfort bands, tank safety ranges, or MELCloud command limits.
- Savings visibility: ensure baseline vs smart accounting stays accurate, even when no setpoint changes occur.
- DST-safe & idempotent: cron, price ingestion, and logging must remain timezone-aware and rate-limit friendly; no new dependencies or heavy refactors unless absolutely required.

# Contracts: Optimization Explainability & Widget Last Decision

- **API**: `GET /getModelConfidence`
  - **Adds**: `lastDecision` object to response payload with `code`, `headline`, `reason`, `timestamp`, and lightweight context (price tier/spike flag, from→to, DHW action if any).
  - **Fallback**: When no decision exists, returns a neutral placeholder `{ code: 'NONE', headline: 'Waiting for first optimization', ... }`.
  - **Validation**: Must tolerate legacy/missing history fields without throwing.

- **Storage**:
  - Extend historical optimization entries to optionally include `decision`.
  - Add bounded `last_decision` snapshot (overwrite only) for fast widget access; do not create new unbounded arrays.

If future external surfaces change (e.g., settings UI localization), update this file with request/response shapes and validation rules.


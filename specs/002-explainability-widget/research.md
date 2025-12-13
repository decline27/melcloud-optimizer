# Research: Optimization Explainability & Widget Last Decision

## Data Sources

- **Optimization result**: `AugmentedOptimizationResult` in `api.ts` includes `action`, `reason`, `fromTemp/toTemp`, `priceData`, `zone2Data`, `tankData`, `weather`, `savings`, `timestamp`.
- **Historical storage**: `recordOptimizationEntry` appends to `historicalData.optimizations` (capped at 168) and persists via `optimizer_historical_data`; entries currently store `action`, `reason`, `targetTemp`, `targetOriginal`, `priceNow`, `indoor/outdoor temps`, `zone2Data`, `tankData`, `savings`.
- **Widget data**: `getModelConfidence` composes savings + thermal confidence and reads `melcloud_historical_data` / `optimizer_historical_data` for price averages; widget fetches via `widgets/melcloud-data/public/model-confidence-shared.js`.
- **Placeholder behaviour**: Widget currently shows “Awaiting first update…” / “Loading model confidence…” state; no explicit “last action” block exists.

## Constraints & Guardrails

- Control must stay at room setpoints (no flow-temp forcing).  
- Comfort bands, anti-cycling, temp step limits enforced by constraint manager and settings loader.  
- Storage must remain bounded; historical list already trimmed to 168 entries.  
- Logging via `HomeyLogger` in app contexts; widget strings should stay concise/localizable.

## Open Points to Design

- Exact decision codes and friendly texts (should align with issue #54 examples).  
- Where to persist `last_decision` snapshot (likely Homey settings key; overwrite per optimization).  
- How to derive price context/spike flag for the decision without recalculating heavy analytics.  
- Localisation hook: widget currently uses inline strings; need lightweight fallback without new infra.


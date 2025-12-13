# Data Model: Optimization Explainability & Widget Last Decision

## Entities

- **Decision**
  - Attributes: `code` (stable enum string), `headline` (short friendly text), `reason` (one-liner context), `timestamp` (ISO), `fromTemp`, `toTemp`, `comfortBand` (min/max if available), `priceContext` (tier + spike flag), `dhwAction` (heat_now|delay|null), `zone` (z1/z2/tank), `source` (optimizer).
  - Notes: Strings must be concise and localizable; code is log/test-facing, headline/reason are user-facing.

- **DecisionSnapshot**
  - Attributes: `lastDecision` (Decision or placeholder), `updatedAt`.
  - Notes: Stored in Homey settings as an overwrite-only key (bounded).

- **OptimizationHistoryEntry (extended)**
  - Attributes: existing history fields + optional `decision` (Decision).
  - Notes: Keeps recent decisions aligned with timeline data; history remains capped at 168 entries.

## Relationships

- Each optimization produces one Decision.  
- DecisionSnapshot references the latest Decision for widget/API.  
- Historical entries may embed Decision for traceability/testing but list length remains unchanged.

## Validation & Constraints

- Code must be deterministic for a given optimization result.  
- Headline/reason length should be capped (implicit by phrasing) to avoid UI overflow.  
- Placeholder used when Decision is missing/invalid; must never throw in widget/API.  
- No new unbounded arrays; DecisionSnapshot overwrites previous value.


# Quickstart: Optimization Explainability & Widget Last Decision

## Run Checks

- Type check: `npm run lint`
- Unit tests: `npm run test:unit`

## Test Guidance

- Add unit tests for decision mapping covering:
  - Maintain at comfort band with deadband → maintain code/text.
  - Preheat before upcoming expensive spike → preheat code/text.
  - DHW heating in cheap window → DHW code/text.
  - Learning reacts to comfort violations → aggressiveness reduced code/text.
- Add API test ensuring `getModelConfidence` returns `lastDecision` when history exists and a safe placeholder when it does not.
- If adding widget rendering helpers, keep them deterministic and testable (pure functions where possible).

## Data Inputs

- Reuse existing optimizer result fixtures or build minimal mocks with `action`, `reason`, `fromTemp/toTemp`, `priceData`, `zone2Data`, `tankData`, `comfort band` info.  
- Use homey mock settings to simulate history presence vs absence for API tests.


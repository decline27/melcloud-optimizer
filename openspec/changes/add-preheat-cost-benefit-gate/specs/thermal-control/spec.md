## ADDED Requirements
### Requirement: Preheat Cost-Benefit Gate
The system SHALL gate preheat decisions using thermal-model savings vs immediate cost, only allowing preheat when modeled net benefit is positive and thermal-model confidence is sufficient.

#### Scenario: Positive net benefit allows preheat
- **WHEN** the thermal model has sufficient confidence and the modeled netBenefit (savedCostLater − extraCostNow) is positive for the constrained ΔT toward preheat
- **THEN** the system SHALL allow the preheat action and log the netBenefit inputs in a single debug entry

#### Scenario: Non-positive net benefit blocks preheat
- **WHEN** the thermal model has sufficient confidence but the modeled netBenefit for the constrained ΔT is zero or negative
- **THEN** the system SHALL skip preheat and retain the maintain/current heuristic path while logging the netBenefit inputs

#### Scenario: Missing data or low confidence falls back
- **WHEN** the price cadence cannot be normalized, COP/thermal model inputs are missing, or the thermal model confidence is below the gate threshold
- **THEN** the system SHALL bypass the cost-benefit gate and use the legacy thermal-controller heuristic without adding new user settings

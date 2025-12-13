# Feature Specification: Optimization Explainability & Widget Last Decision

**Feature Branch**: `explainability-widget`  
**Created**: 2025-12-12  
**Status**: Draft  
**Input**: GitHub issue #54 – “Improve explainability & add key behaviour tests”

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the last optimization decision at a glance (Priority: P1)

As a Homey user, I want the widget to show a short, clear explanation of what the optimizer just decided so I understand why temperatures or DHW were changed (or not).

**Independent Test**: With historical optimizations present, the widget displays a decision code and friendly text summarizing the latest action plus timestamp/context.

### User Story 2 - Safe empty state when no history exists (Priority: P1)

As a new user, I want the widget to show a neutral placeholder until the first optimization runs so the UI never looks broken or confusing.

**Independent Test**: With zero historical optimizations, the widget shows “Waiting for first optimization” (or equivalent) and no errors.

### User Story 3 - Maintain explainability quality over time (Priority: P2)

As a maintainer, I want tests that lock in key behaviours (maintain at band, preheat before spike, DHW cheap window, learning responds to comfort violations) so refactors do not regress user-facing explanations.

**Independent Test**: Unit/API tests fail if decision codes/text or learning reactions deviate from the documented behaviours.

### Edge Cases

- No optimization history yet → show neutral placeholder (no errors).  
- Partial/legacy history entries lacking price/comfort fields → still produce a code/text using available data.  
- DHW-only actions (no room change) → show DHW decision without implying room heating changed.  
- Multiple zones/tank present → choose a single “headline” decision but keep context concise.  
- Missing localization entries → fall back to English strings without crashing the widget.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each hourly optimization MUST derive a decision code and friendly text from the existing result (action, reason, comfort band, price context, DHW/zone2 data) without bypassing constraint manager or comfort rules.
- **FR-002**: The decision code/text MUST be persisted with historical optimization data and stored as a `last_decision` snapshot for quick widget access.
- **FR-003**: The API used by the widget (`getModelConfidence` payload) MUST return the latest decision code/text and timestamp; when no history exists it MUST return a safe placeholder.
- **FR-004**: The widget MUST render a “Last action” block showing the code, headline text, concise reason/context (price tier/spike, comfort band, from→to), DHW action if present, and an updated-at indicator.
- **FR-005**: All strings MUST be short and localizable; defaults MUST remain within existing storage limits (no unbounded arrays or verbose blobs).
- **FR-006**: The solution MUST keep room-temperature control via setpoints only and respect comfort bands, anti-cycling, temp step limits, and user safety constraints.
- **FR-007**: A neutral placeholder MUST be shown when data is missing, malformed, or not yet available, without surfacing errors to the user UI.
- **FR-008**: Tests MUST cover: maintaining at band with deadband, preheating before an expensive spike, DHW cheap-window heating, and learning reacting to comfort violations.
- **FR-009**: An API test MUST assert `getModelConfidence` includes `lastDecision` when history exists and a safe placeholder when it does not.

### Success Criteria *(mandatory)*

- **SC-001**: Widget shows decision code + friendly headline + timestamp for the latest optimization within 1s of fetch, using the same data the optimizer produced (no divergence).
- **SC-002**: With no history, widget renders the placeholder with zero JS errors and no empty/undefined strings.
- **SC-003**: Unit/API tests fail if decision code/text mapping changes for the four enumerated behaviours.
- **SC-004**: Storage growth remains bounded (decision snapshot replaces/overwrites; history entries remain capped as today).


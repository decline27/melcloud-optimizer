# Feature Specification: Quarter-Hour Pricing for DHW & Planning Bias

**Feature Branch**: `001-quarter-hour-pricing`  
**Created**: 2025-12-11  
**Status**: Draft  
**Input**: User description: "Add quarter-hour price support for Tibber and ENTSO-E for DHW scheduling and planning bias; keep room heating setpoints hourly (no extra room setpoint churn)."

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - DHW heats in cheapest quarter-hour blocks (Priority: P1)

Household hot water heating should automatically prefer the cheapest contiguous 15-minute price blocks when available, while respecting tank safety, ramp limits, and existing hourly scheduling cadence.

**Why this priority**: DHW can be shifted without comfort impact; capturing intra-hour dips yields direct savings.

**Independent Test**: Provide synthetic quarter-hour price data with clear cheap windows and confirm DHW heating selects those windows without increasing setpoint change frequency beyond the existing cadence.

**Acceptance Scenarios**:

1. **Given** quarter-hour prices include multiple cheap 15-minute slots forming at least one contiguous block, **When** DHW scheduling runs, **Then** it selects the block with the lowest average cost that satisfies minimum block length and tank constraints.
2. **Given** only hourly prices are available, **When** DHW scheduling runs, **Then** it behaves identically to current hourly-based scheduling with no regression in setpoint cadence.

---

### User Story 2 - Planning bias avoids risky intra-hour spikes (Priority: P2)

The planning bias logic should treat hours that contain expensive 15-minute spikes as risky, reducing aggressive preheat during those windows even if the hourly average looks cheap.

**Why this priority**: Prevents heating into hidden expensive spikes, preserving savings without compromising comfort.

**Independent Test**: Feed price data where an hour has a low average but a single high 15-minute spike; confirm planning bias dampens positive bias for that hour while still allowing normal bias when intra-hour profile is stable.

**Acceptance Scenarios**:

1. **Given** quarter-hour data shows a spike exceeding the configured spike threshold within an otherwise cheap hour, **When** planning bias is computed, **Then** it reduces or nullifies positive bias for that period.
2. **Given** quarter-hour data is absent or stable (no spikes beyond threshold), **When** planning bias is computed, **Then** it matches current hourly behavior with no added noise.

---

### User Story 3 - Provider-agnostic quarter-hour support with safe fallback (Priority: P3)

The system should use quarter-hour prices from either Tibber or ENTSO-E when present and gracefully fall back to hourly data without failures or behavior changes.

**Why this priority**: Ensures broad coverage across providers and resilience when finer cadence is missing.

**Independent Test**: Toggle inputs between Tibber quarter-hour, ENTSO-E quarter-hour, and hourly-only datasets; confirm consistent decisions and logging across providers with correct fallback.

**Acceptance Scenarios**:

1. **Given** ENTSO-E returns quarter-hour data, **When** optimization runs, **Then** both DHW scheduling and planning bias use it without increasing room-heating setpoint churn beyond hourly cadence.
2. **Given** a provider returns only hourly data or partial 15-minute series, **When** optimization runs, **Then** it reverts to hourly logic and logs the fallback without errors.

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

- Quarter-hour series is incomplete, misaligned, or crosses DST changes—system detects gaps and falls back to hourly without misclassifying spikes.
- Price cadence mixes 60-minute and 15-minute points—normalization avoids double-counting and respects the no-more-than-hourly room setpoint cadence.
- DHW tank at high temperature near max—cheap blocks are available but ramp constraints or legionella/comfort rules prevent over-heating; system must decline unnecessary heating.
- Extreme volatility (rapid alternating spikes/dips)—planning bias must cap its impact to avoid oscillation while maintaining safety constraints.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST ingest quarter-hour price data from Tibber and ENTSO-E when provided and preserve hourly ingestion as a fallback with identical behavior to current logic.
- **FR-002**: The system MUST group adjacent cheap 15-minute slots into candidate DHW heating blocks, select the lowest-cost block that satisfies minimum block duration and tank/ramp constraints, and execute heating without increasing DHW setpoint change cadence beyond the current design.
- **FR-003**: The system MUST ensure room-heating setpoint changes remain at most hourly (or less frequent), even when quarter-hour data is available.
- **FR-004**: The planning bias computation MUST consider intra-hour volatility when quarter-hour data exists, marking hours as risky when spike thresholds are exceeded and damping positive bias accordingly, while preserving legacy bias when quarter-hour data is absent or stable.
- **FR-005**: The system MUST log when quarter-hour data influences decisions (DHW block choice, planning bias risk flag) and when it falls back to hourly, in a way that is traceable for users.
- **FR-006**: The system MUST respect existing comfort bands, anti-cycling, temperature step limits, and tank safety constraints when applying any decision informed by quarter-hour data.
- **FR-007**: The system MUST handle mixed or partial quarter-hour series by validating cadence and defaulting to hourly logic when data quality is insufficient.
- **FR-008**: The system MUST support provider-specific currency/markup handling consistently across hourly and quarter-hour cadences so comparisons remain correct.
- **FR-009**: The system MUST treat DHW block minimum duration as 30 minutes (2×15-minute slots) to avoid short cycling while still capturing short cheap dips, subject to tank/ramp constraints.
- **FR-010**: The system MUST treat an hour as “risky” for planning bias when any 15-minute price exceeds the hour’s average by more than 25%, and cap bias impact to avoid oscillation.

### Key Entities *(include if feature involves data)*

- **Price Slot (15m/60m)**: Time-stamped price point with interval metadata (15 or 60 minutes) and currency context.
- **DHW Block Candidate**: Contiguous set of 15-minute slots meeting minimum duration and cost criteria; carries average/peak price and eligibility under tank/ramp rules.
- **Volatility Indicator**: Derived attributes for an hour (max, min, mean, spike ratio) used by planning bias to flag risky periods.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On synthetic price profiles with quarter-hour spikes, DHW scheduling chooses a block whose average price is at least X% (target ≥15%) lower than the hourly-only baseline while honoring tank/ramp constraints.
- **SC-002**: Room-heating setpoint change frequency does not exceed the current hourly cadence in any tested scenario (0 violations across regression suite).
- **SC-003**: Planning bias logs explicitly indicate intra-hour risk detection when spikes exceed the configured threshold in 100% of applicable test cases.
- **SC-004**: When quarter-hour data is missing or invalid, behavior matches current hourly-only outputs within tolerance (e.g., identical setpoint decisions and bias values across regression fixtures).
- **SC-005**: All decisions using quarter-hour data include traceable log entries showing data source (Tibber/ENTSO-E), cadence used, and fallback path where applicable.

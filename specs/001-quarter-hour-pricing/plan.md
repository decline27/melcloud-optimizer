# Implementation Plan: Quarter-Hour Pricing for DHW & Planning Bias

**Branch**: `001-quarter-hour-pricing` | **Date**: 2025-12-11 | **Spec**: specs/001-quarter-hour-pricing/spec.md
**Input**: Feature specification from `/specs/001-quarter-hour-pricing/spec.md`

**Note**: Filled per `/speckit.plan` workflow.

## Summary

Enable quarter-hour price awareness for both Tibber and ENTSO-E to guide DHW scheduling (choosing cheapest 15m blocks of at least 30 minutes) and planning bias (flagging hours with >25% intra-hour spikes as risky), while preserving hourly-or-slower room-heating setpoint cadence, safety constraints, and hourly fallbacks when 15m data is absent or dirty.

## Technical Context

**Language/Version**: TypeScript 5.8+, Node.js ≥16, Homey SDK 3.0  
**Primary Dependencies**: Homey CLI, luxon/moment-timezone, node-fetch, fast-xml-parser, jest/ts-jest  
**Storage**: Homey settings (price caches, learning state); no new storage expected  
**Testing**: jest (unit), `npm run test:unit`; type checks via `npm run lint`  
**Target Platform**: Homey hub (local execution)  
**Project Type**: Single backend app (Homey driver/app services)  
**Performance Goals**: No increase in room setpoint change frequency (>hourly is forbidden); avoid memory regressions (Homey ~50 MB envelope)  
**Constraints**: Respect comfort bands, anti-cycling, temp step limits; avoid flow-temp control; no network cadence increase beyond existing polling  
**Scale/Scope**: Single-household optimizer; quarter-hour horizon up to 192 slots per provider

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution file is placeholder; default gates not defined. Apply project guardrails instead (AGENTS.md, .github/copilot-instructions.md): respect comfort bands, constraint manager, no flow-temp forcing, keep room setpoints hourly-or-slower. Status: PASS (no violations planned).

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
specs/001-quarter-hour-pricing/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── checklists/requirements.md

src/
├── services/
│   ├── tibber-api.ts
│   ├── entsoe-price-service.ts
│   ├── planning-utils.ts
│   ├── hot-water-optimizer.ts
│   └── hot-water/ (analyzer, service)
├── orchestration/service-manager.ts
├── types/index.ts
└── util/ (time-zone-helper, logger, setpoint constraints)

test/
├── unit/ (tibber-api tests, others)
└── fixtures/
```

**Structure Decision**: Single backend Homey app; feature touches services (price providers, planning utils, hot water optimizer) and unit tests under `test/unit`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

## Phase 0 - Research

- Unknowns resolved via spec: DHW min block = 30 minutes; spike threshold = >25% above hour average; providers: Tibber + ENTSO-E; fallback: hourly. No open clarifications remain.
- Validate price cadence detection paths in `tibber-api.ts` and `entsoe-price-service.ts` to ensure interval metadata survives to consumers.
- Output: `specs/001-quarter-hour-pricing/research.md` summarizing decisions and any provider-specific nuances.

## Phase 1 - Design & Contracts

- Data model: Define Price Slot, DHW Block Candidate, Volatility Indicator and relationships in `data-model.md`.
- Contracts: No new external API; document “no contract changes” in `contracts/README.md` and note internal data flows (price payload shape, planning bias inputs).
- Quickstart: Steps to run unit tests and lint; how to feed sample quarter-hour data into tests.
- Agent context: rerun `.specify/scripts/bash/update-agent-context.sh codex` after filling plan details.

## Phase 2 - Implementation Steps

1) **Price ingestion & normalization**  
   - Ensure Tibber quarter-hour array flows to consumers unchanged; keep hourly aggregation as fallback.  
   - Add ENTSO-E quarter-hour parsing/interval detection; attach `quarterHourly` + `intervalMinutes`.  
   - Add data quality checks (cadence consistency, gaps, DST) and fallback to hourly with logging.

2) **DHW scheduling with 15m blocks**  
   - In hot-water optimizer/service, group contiguous cheap 15m slots; enforce ≥30m blocks; respect tank/ramp/legionella constraints.  
   - Select lowest-average-cost eligible block; keep DHW setpoint update cadence unchanged (hourly-or-slower).  
   - Log rationale (provider, cadence, chosen block, fallback).

3) **Planning bias intra-hour risk**  
   - In `planning-utils.ts`, when quarter-hour data exists, flag hours where max 15m price >25% above hour average; dampen positive bias; cap oscillation; keep negative-bias rules intact.  
   - Preserve legacy behavior when only hourly or stable quarter-hour data is present; add structured logging.

4) **Safeguards & constraints**  
   - Ensure comfort bands, anti-cycling, temp step limits remain enforced; no flow-temp control; room setpoints remain hourly-or-slower.  
   - Handle mixed cadence inputs without double-counting.

5) **Testing**  
   - Unit tests for Tibber/ENTSO-E price parsing (hourly vs quarter-hour, gaps).  
   - Unit tests for DHW block selection (cheap block choice, fallback to hourly, respects min 30m).  
   - Unit tests for planning bias spike handling (risky hour detection, no change when stable/missing).  
   - Lint/typecheck: `npm run lint`; unit: `npm run test:unit`.

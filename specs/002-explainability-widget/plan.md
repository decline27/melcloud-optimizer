# Implementation Plan: Optimization Explainability & Widget Last Decision

**Branch**: `explainability-widget` | **Date**: 2025-12-12 | **Spec**: specs/002-explainability-widget/spec.md  
**Input**: Issue #54 (“Improve explainability & add key behaviour tests”)

**Note**: Filled per `/speckit.plan` workflow.

## Summary

Add a small, stable decision model that turns each hourly optimization result into a decision code + friendly text, persist it with history, surface the latest snapshot through `getModelConfidence`, and render a “Last action” block in the widget with a safe placeholder when no history exists—all while respecting comfort bands, constraint manager, and setpoint-only control.

## Technical Context

**Language/Version**: TypeScript 5.8+, Node.js ≥16, Homey SDK 3.0  
**Primary Dependencies**: Homey CLI, luxon/moment-timezone, node-fetch, fast-xml-parser, jest/ts-jest  
**Storage**: Homey settings (historical optimizations, display_savings_history, etc.); keep additions bounded  
**Testing**: jest (unit) via `npm run test:unit`; lint via `npm run lint`  
**Platform**: Homey hub (local execution)  
**Constraints**: Control via room setpoints only; enforce comfort bands, anti-cycling, temp step limits; do not bypass constraint manager; no unbounded settings growth.

## Constitution Check

Guardrails: respect comfort bands/constraint manager, no flow-temp forcing, keep storage bounded, maintain existing cadence. Plan operates within these constraints. Status: PASS.

## Project Structure

```text
specs/002-explainability-widget/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── checklists/requirements.md

Source impact (planned):
api.ts                       # decision snapshot + API payload
src/types/index.ts           # API response type for lastDecision
widgets/melcloud-data/api.js # widget API proxy (if needed)
widgets/melcloud-data/public/index.html           # UI block
widgets/melcloud-data/public/model-confidence-shared.js # render logic
test/model-confidence-api.test.ts                 # API tests
test/... (new)                                     # decision mapper/unit tests
```

## Complexity Tracking

No constitution violations expected. Keep decision mapping as a small pure helper to avoid overgrowth in `api.ts`.

## Phase 0 - Research

- Locate where optimization results are persisted (`recordOptimizationEntry` in `api.ts`) and how history is capped.  
- Identify current widget data flow (`getModelConfidence`, `widgets/melcloud-data/public/model-confidence-shared.js`).  
- Confirm available fields in `AugmentedOptimizationResult` (action, reason, priceData, comfort band availability, DHW/zone2).
- Output: `research.md` with data sources, storage keys, and existing UI states/placeholders.

## Phase 1 - Design & Contracts

- Define the decision object shape (code, headline, reason, timestamp, context for price/comfort/DHW).  
- Decide mapping rules from optimization result → decision code/text (keep deterministic, short, localizable).  
- Determine storage keys: extend historical entry vs new `last_decision` snapshot (bounded size).  
- Document API contract update in `contracts/README.md`; ensure placeholder state defined.  
- Output: `data-model.md`, `contracts/README.md`, `quickstart.md` with test commands/fixtures.

## Phase 2 - Implementation Steps

1) **Decision mapper**: Add a pure helper to derive `Decision` from optimization result + price/comfort context (handle legacy fields; cap string length).  
2) **Persistence**: Store decision alongside historical optimization entry and a `last_decision` snapshot (overwrite only; keep cap). Ensure respects existing history trim.  
3) **API surface**: Extend `getModelConfidence` response with `lastDecision`, supplying placeholder when missing/invalid; update types.  
4) **Widget UI**: Add “Last action” block showing code pill, headline, one-line context (price tier/spike, comfort band, from→to, DHW), and updated-at indicator; handle empty state.  
5) **Tests**:  
   - Unit tests for decision mapper covering maintain-at-band, preheat-before-spike, DHW cheap window, learning comfort-violation reaction mapping.  
   - API test ensuring `getModelConfidence` returns `lastDecision` or placeholder appropriately.  
   - Update widget/shared JS tests if present (or add minimal rendering test).  
6) **Validation**: `npm run lint`, `npm run test:unit`; sanity-check storage keys and log outputs for traceability.


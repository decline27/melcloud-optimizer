# Model Confidence UI Implementation - Summary

## Overview
Added a **read-only "Live Model Confidence"** panel to the Settings page that displays the thermal model's learning state without modifying any optimizer logic, storage schemas, or services.

## Changes Made

### 1. API Endpoint (`api.ts`)
**Added new endpoint:** `getModelConfidence`

**Type Definition:**
```typescript
type GetModelConfidenceResponse = ApiResult<{
  thermalModel: {
    confidence: number | null;
    heatingRate: number | null;
    coolingRate: number | null;
    thermalMass: number | null;
    lastUpdated: string | null;
  };
  adaptiveParameters: {
    learningCycles: number | null;
    confidence: number | null;
    lastUpdated: string | null;
  };
  dataRetention: {
    thermalRawPoints: number;
    thermalAggPoints: number;
    rawKB: number;
    aggKB: number;
  };
}>;
```

**Handler Implementation (lines 2461-2556):**
- Reads `thermal_model_characteristics` from settings
- Reads `adaptive_business_parameters` from settings
- Reads `thermal_model_data` and `thermal_model_aggregated_data` for retention stats
- Calculates data sizes in KB
- Returns all data or null values if missing
- Handles JSON parse errors gracefully
- **No writes to storage** - read-only operation

### 2. Settings UI (`settings/index.html`)

**HTML Section (after Quick Start, before Electricity Price Source):**
- Added `<details>` section with ID `model_confidence_section`
- Includes:
  - Title: "Live Model Confidence"
  - Refresh button (manual, no polling)
  - Confidence percentage and status display
  - Thermal details grid (heating rate, cooling rate, thermal mass)
  - Learning details (last updated, learning cycles)
  - Data retention statistics (raw/agg points, KB)
  - Loading, empty, and error states

**JavaScript Functions (lines 1703-1905):**
- `getConfidenceStatus(pct)` - Maps confidence % to status label
  - 0-24%: "Learning"
  - 25-59%: "Improving"
  - 60-84%: "Reliable"
  - 85-100%: "Highly reliable"
- `fetchModelConfidence()` - Calls Homey API and updates UI
- Refresh button handler
- Auto-loads on page load (1 second delay)

**Styling:**
- Uses existing Homey CSS classes
- Responsive grid layout
- Accessible with `aria-live="polite"`
- Shows/hides sections based on data availability

### 3. Unit Tests (`test/model-confidence-api.test.ts`)
**9 comprehensive tests:**
1. ✅ Returns model confidence data successfully
2. ✅ Returns adaptive parameters data
3. ✅ Returns data retention statistics
4. ✅ Handles missing thermal characteristics gracefully
5. ✅ Handles missing adaptive parameters gracefully
6. ✅ Handles JSON parse errors gracefully
7. ✅ Calculates data size correctly
8. ✅ Does not write to any settings (read-only verification)
9. ✅ Handles errors gracefully

**All tests passed** ✓

## Data Sources (Read-Only)

### Existing Storage Keys Used:
1. `thermal_model_characteristics` - From `ThermalAnalyzer`
   - `modelConfidence` (0-1)
   - `heatingRate` (°C/h)
   - `coolingRate` (°C/h)
   - `thermalMass` (0-1)
   - `lastUpdated` (ISO timestamp)

2. `adaptive_business_parameters` - From `AdaptiveParametersLearner`
   - `learningCycles` (count)
   - `confidence` (0-1)
   - `lastUpdated` (ISO timestamp)

3. `thermal_model_data` - From `ThermalDataCollector`
   - Array of raw thermal data points
   - Used for point count and size calculation

4. `thermal_model_aggregated_data` - From `ThermalDataCollector`
   - Array of aggregated thermal data
   - Used for point count and size calculation

## Architecture Compliance

### ✅ Constraints Met:
- **UI-only change** - No modifications to learning algorithms, data collection, retention, or scheduling
- **Read-only** - No writes to storage or API mutations
- **No new dependencies** - Uses existing Homey UI system
- **Small and simple** - One API endpoint + HTML/JS component
- **Handles missing data** - Graceful fallbacks to "Learning…" state
- **No polling** - Manual refresh button only
- **No logic changes** - Services remain unchanged

### Integration Pattern:
```
Settings Page (HTML/JS)
    ↓ (Homey.api call)
API Endpoint (api.ts)
    ↓ (homey.settings.get)
Persistent Storage (Homey Settings)
    ← (Already written by)
Existing Services (ThermalAnalyzer, AdaptiveParametersLearner, ThermalDataCollector)
```

## User Experience

### Display States:
1. **Learning State** (0-24% confidence)
   - Shows "Confidence: X% — Learning"
   - Helper text: "Model builds confidence as your system runs normal heating cycles."

2. **Improving State** (25-59% confidence)
   - Shows thermal rates if available
   - Shows learning cycles

3. **Reliable State** (60-84% confidence)
   - Shows all available metrics
   - Shows data retention stats

4. **Highly Reliable State** (85-100% confidence)
   - Shows all metrics with high confidence indicator

5. **Empty State** (no data)
   - Shows "—" for confidence
   - Shows helper text

6. **Error State**
   - Displays error message
   - Refresh button allows retry

### Accessibility:
- Semantic HTML structure
- `aria-live="polite"` on confidence display
- Clear status labels
- Keyboard-accessible refresh button

## Files Modified
1. `/api.ts` - Added `GetModelConfidenceResponse` type and `getModelConfidence` handler
2. `/settings/index.html` - Added HTML section and JavaScript functions
3. `/test/model-confidence-api.test.ts` - New test file (9 tests, all passing)

## Validation
- ✅ TypeScript compilation: `npm run lint` passes
- ✅ Unit tests: 9/9 tests passing
- ✅ No existing functionality affected
- ✅ Read-only operations verified
- ✅ Error handling tested
- ✅ Missing data scenarios tested

## Future Enhancements (Optional)
- Add i18n support for status labels
- Add tooltips explaining each metric
- Add trend indicators (improving/declining)
- Add chart visualization of confidence over time
- Add export button for data scientists

## Notes
- This implementation follows the Homey app pattern (HTML/JS settings page, not React)
- Respects existing architecture constraints
- No breaking changes to existing functionality
- Safe to deploy - worst case is showing "—" values if data missing

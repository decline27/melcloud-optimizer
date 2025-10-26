# Live Model Confidence - UI Mockup

## Visual Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ▼ Live Model Confidence                            [Refresh]    │
├──────────────────────────────────────────────────────────────────┤
│  Read-only snapshot of the thermal model's learning state.       │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Confidence: 75% — Reliable                                │  │
│  │                                                            │  │
│  │  ─────────────────────────────────────────────────────────│  │
│  │  Heating rate: 1.20 °C/h      Cooling rate: 0.80 °C/h    │  │
│  │  Thermal mass: 0.65                                       │  │
│  │                                                            │  │
│  │  ─────────────────────────────────────────────────────────│  │
│  │  Last updated: 10/26/2025, 12:00:00 PM                   │  │
│  │  Learning cycles: 42                                      │  │
│  │                                                            │  │
│  │  ─────────────────────────────────────────────────────────│  │
│  │  Data: 156 raw / 45 agg • 123.45 KB                      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## State Examples

### 1. Learning State (< 25% confidence)
```
┌────────────────────────────────────────────────────────────┐
│  Confidence: 15% — Learning                                │
│                                                            │
│  Model builds confidence as your system runs normal       │
│  heating cycles.                                          │
└────────────────────────────────────────────────────────────┘
```

### 2. Improving State (25-59% confidence)
```
┌────────────────────────────────────────────────────────────┐
│  Confidence: 45% — Improving                               │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Heating rate: 1.15 °C/h      Cooling rate: 0.75 °C/h    │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Last updated: 10/26/2025, 10:30:00 AM                   │
│  Learning cycles: 18                                      │
└────────────────────────────────────────────────────────────┘
```

### 3. Reliable State (60-84% confidence)
```
┌────────────────────────────────────────────────────────────┐
│  Confidence: 72% — Reliable                                │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Heating rate: 1.20 °C/h      Cooling rate: 0.80 °C/h    │
│  Thermal mass: 0.65                                       │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Last updated: 10/26/2025, 12:00:00 PM                   │
│  Learning cycles: 42                                      │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Data: 156 raw / 45 agg • 123.45 KB                      │
└────────────────────────────────────────────────────────────┘
```

### 4. Highly Reliable State (85-100% confidence)
```
┌────────────────────────────────────────────────────────────┐
│  Confidence: 92% — Highly reliable                         │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Heating rate: 1.25 °C/h      Cooling rate: 0.82 °C/h    │
│  Thermal mass: 0.68                                       │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Last updated: 10/26/2025, 2:15:00 PM                    │
│  Learning cycles: 127                                     │
│                                                            │
│  ─────────────────────────────────────────────────────────│
│  Data: 824 raw / 132 agg • 387.92 KB                     │
└────────────────────────────────────────────────────────────┘
```

### 5. Empty State (no data available)
```
┌────────────────────────────────────────────────────────────┐
│  Confidence: — — Learning…                                 │
│                                                            │
│  Model builds confidence as your system runs normal       │
│  heating cycles.                                          │
└────────────────────────────────────────────────────────────┘
```

### 6. Loading State
```
┌────────────────────────────────────────────────────────────┐
│  Loading model confidence data...                          │
│                                                            │
│  [Content appears dimmed/semi-transparent]                │
└────────────────────────────────────────────────────────────┘
```

### 7. Error State
```
┌────────────────────────────────────────────────────────────┐
│  Confidence: — — Learning…                                 │
│                                                            │
│  ⚠ Failed to load model confidence: Storage error         │
│                                                            │
│  Model builds confidence as your system runs normal       │
│  heating cycles.                                          │
└────────────────────────────────────────────────────────────┘
```

## Interaction Flow

1. **Page Load**
   - Settings page loads
   - JavaScript initializes
   - After 1 second, automatically calls `fetchModelConfidence()`
   - Updates UI with current data

2. **Manual Refresh**
   - User clicks "Refresh" button
   - Button disabled and text changes to "Loading…"
   - API call made to `/getModelConfidence`
   - UI updates with new data
   - Button re-enabled

3. **Data Display Logic**
   ```
   if (error) {
     show error message
   } else if (no data) {
     show empty state
   } else {
     show confidence + status
     if (has thermal details) show thermal details
     if (has learning details) show learning details
     if (has retention data) show retention data
   }
   ```

## Styling Details

- **Card Background**: `#fafafa`
- **Card Border**: `1px solid #e0e0e0`
- **Border Radius**: `6px`
- **Padding**: `16px`
- **Grid Layout**: 2 columns for details
- **Font Sizes**:
  - Confidence value: `1.1em`
  - Details: `0.9em`
  - Retention: `0.85em`
- **Colors**:
  - Success/Valid: `#00aa44`
  - Error: `#d32f2f`
  - Muted text: `#666`
  - Status text: `italic`

## Responsive Behavior

- On desktop: 2-column grid for details
- On mobile: Grid collapses gracefully
- Button remains visible and accessible
- Text wraps appropriately

## Accessibility

- `aria-live="polite"` on confidence value for screen readers
- Semantic HTML structure (`<details>`, proper headings)
- High contrast ratios for all text
- Keyboard-accessible refresh button
- Focus indicators on interactive elements
- Meaningful status messages

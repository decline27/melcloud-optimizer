# Night Setback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional night setback feature that lowers the heating comfort band during sleeping hours, toggled on/off via the settings page.

**Architecture:** A pure `isNightHour()` utility handles the midnight-crossing time window. `SettingsLoader` reads the five new setting keys. `ConstraintManager.getCurrentComfortBand()` gains a `nightMode` parameter and returns the night band when active. The optimizer's private `getCurrentComfortBand()` wrapper — called from six places in `optimizer.ts` — is the single spot where night mode is resolved; no other callers need to change.

**Tech Stack:** TypeScript, Jest, Homey settings API (`homey.settings.get/set`), settings page HTML with vanilla JS.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/util/night-setback.ts` | Pure `isNightHour()` function + `NightSetbackSettings` type |
| Modify | `src/services/settings-loader.ts` | `loadNightSetbackSettings()` method |
| Modify | `src/services/constraint-manager.ts` | Add `nightMode?` param to `getCurrentComfortBand()` |
| Modify | `src/services/optimizer.ts` | Resolve night mode in private `getCurrentComfortBand()` (line 800) |
| Modify | `settings/index.html` | Night setback UI section + save/load JS |
| Create | `test/unit/night-setback.test.ts` | Tests for `isNightHour()` |
| Modify | `test/unit/constraint-manager.test.ts` | Tests for night mode in `getCurrentComfortBand()` |
| Modify | `test/unit/settings-loader.test.ts` | Tests for `loadNightSetbackSettings()` |

---

## Task 1: Pure `isNightHour` utility

**Files:**
- Create: `src/util/night-setback.ts`
- Create: `test/unit/night-setback.test.ts`

- [ ] **Step 1.1: Write the failing tests**

```typescript
// test/unit/night-setback.test.ts
import { isNightHour } from '../../src/util/night-setback';

describe('isNightHour', () => {
  // Normal midnight-crossing window: 22:00–06:00
  test('returns true for hour inside midnight-crossing window (start side)', () => {
    expect(isNightHour(23, 22, 6)).toBe(true);
  });

  test('returns true at exactly startHour', () => {
    expect(isNightHour(22, 22, 6)).toBe(true);
  });

  test('returns true for hour inside midnight-crossing window (end side)', () => {
    expect(isNightHour(3, 22, 6)).toBe(true);
  });

  test('returns false at exactly endHour (exclusive)', () => {
    expect(isNightHour(6, 22, 6)).toBe(false);
  });

  test('returns false for daytime hour outside window', () => {
    expect(isNightHour(12, 22, 6)).toBe(false);
  });

  test('returns false for hour just before start', () => {
    expect(isNightHour(21, 22, 6)).toBe(false);
  });

  // Same-day window: 01:00–05:00 (no midnight crossing)
  test('returns true inside same-day window', () => {
    expect(isNightHour(3, 1, 5)).toBe(true);
  });

  test('returns false before same-day window', () => {
    expect(isNightHour(0, 1, 5)).toBe(false);
  });

  test('returns false after same-day window', () => {
    expect(isNightHour(5, 1, 5)).toBe(false);
  });

  // Degenerate: startHour === endHour means no night window
  test('returns false when startHour equals endHour', () => {
    expect(isNightHour(6, 6, 6)).toBe(false);
  });

  // Edge: midnight
  test('returns true at midnight (hour 0) in crossing window', () => {
    expect(isNightHour(0, 22, 6)).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run to confirm failure**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npx jest test/unit/night-setback.test.ts --no-coverage 2>&1 | tail -10
```
Expected: `Cannot find module '../../src/util/night-setback'`

- [ ] **Step 1.3: Create the utility**

```typescript
// src/util/night-setback.ts

export interface NightSetbackSettings {
  enabled: boolean;
  /** Hour (0-23) when night setback begins. Default 22. */
  startHour: number;
  /** Hour (0-23, exclusive) when night setback ends. Default 6. */
  endHour: number;
  /** Night comfort band minimum temperature. Default 17.0°C. */
  minTemp: number;
  /** Night comfort band maximum temperature. Default 19.0°C. */
  maxTemp: number;
}

/**
 * Returns true if `currentHour` falls within the night setback window.
 *
 * Handles windows that cross midnight (e.g. startHour=22, endHour=6).
 * The window is [startHour, endHour) — startHour inclusive, endHour exclusive.
 * Returns false when startHour === endHour (degenerate: no window).
 */
export function isNightHour(currentHour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    // Same-day window, e.g. 01:00–05:00
    return currentHour >= startHour && currentHour < endHour;
  }
  // Crosses midnight, e.g. 22:00–06:00
  return currentHour >= startHour || currentHour < endHour;
}
```

- [ ] **Step 1.4: Run tests to confirm pass**

```bash
npx jest test/unit/night-setback.test.ts --no-coverage
```
Expected: 11 passing

- [ ] **Step 1.5: Commit**

```bash
git add src/util/night-setback.ts test/unit/night-setback.test.ts
git commit -m "feat: add isNightHour utility with midnight-crossing window support"
```

---

## Task 2: Load night setback settings

**Files:**
- Modify: `src/services/settings-loader.ts`
- Modify: `test/unit/settings-loader.test.ts`

- [ ] **Step 2.1: Write failing tests**

Add to `test/unit/settings-loader.test.ts` inside the existing `describe('SettingsLoader', ...)` block:

```typescript
describe('loadNightSetbackSettings', () => {
  test('returns defaults when no settings stored', () => {
    const mockHomey = { settings: { get: jest.fn().mockReturnValue(null) } } as any;
    const loader = new SettingsLoader(mockHomey, mockLogger);

    const result = loader.loadNightSetbackSettings();

    expect(result.enabled).toBe(false);
    expect(result.startHour).toBe(22);
    expect(result.endHour).toBe(6);
    expect(result.minTemp).toBe(17.0);
    expect(result.maxTemp).toBe(19.0);
  });

  test('returns stored values when all settings are present', () => {
    const stored: Record<string, unknown> = {
      night_setback_enabled: true,
      night_start_hour: 23,
      night_end_hour: 7,
      comfort_lower_night: 16.5,
      comfort_upper_night: 18.5,
    };
    const mockHomey = {
      settings: { get: jest.fn((key: string) => stored[key] ?? null) }
    } as any;
    const loader = new SettingsLoader(mockHomey, mockLogger);

    const result = loader.loadNightSetbackSettings();

    expect(result.enabled).toBe(true);
    expect(result.startHour).toBe(23);
    expect(result.endHour).toBe(7);
    expect(result.minTemp).toBe(16.5);
    expect(result.maxTemp).toBe(18.5);
  });

  test('clamps out-of-range hours to defaults', () => {
    const stored: Record<string, unknown> = {
      night_start_hour: 99,  // invalid
      night_end_hour: -1,    // invalid
    };
    const mockHomey = {
      settings: { get: jest.fn((key: string) => stored[key] ?? null) }
    } as any;
    const loader = new SettingsLoader(mockHomey, mockLogger);

    const result = loader.loadNightSetbackSettings();

    expect(result.startHour).toBe(22); // default
    expect(result.endHour).toBe(6);   // default
  });
});
```

- [ ] **Step 2.2: Run to confirm failure**

```bash
npx jest test/unit/settings-loader.test.ts --no-coverage 2>&1 | grep -E "FAIL|loadNight|not a function"
```
Expected: test failures for `loadNightSetbackSettings`

- [ ] **Step 2.3: Add `loadNightSetbackSettings` to SettingsLoader**

Add import at top of `src/services/settings-loader.ts`:
```typescript
import { NightSetbackSettings } from '../util/night-setback';
```

Add method after `loadOccupancySettings()`:
```typescript
/**
 * Load night setback settings
 */
loadNightSetbackSettings(): NightSetbackSettings {
    const enabled = this.getBoolean('night_setback_enabled', false);
    const startHour = this.getNumber('night_start_hour', 22, { min: 0, max: 23 });
    const endHour = this.getNumber('night_end_hour', 6, { min: 0, max: 23 });
    const minTemp = this.getNumber('comfort_lower_night', 17.0, { min: 14, max: 22 });
    const maxTemp = this.getNumber('comfort_upper_night', 19.0, { min: 15, max: 23 });
    return { enabled, startHour, endHour, minTemp, maxTemp };
}
```

- [ ] **Step 2.4: Run tests**

```bash
npx jest test/unit/settings-loader.test.ts --no-coverage
```
Expected: all passing

- [ ] **Step 2.5: Commit**

```bash
git add src/services/settings-loader.ts src/util/night-setback.ts test/unit/settings-loader.test.ts
git commit -m "feat: add loadNightSetbackSettings to SettingsLoader"
```

---

## Task 3: Night mode in ConstraintManager

**Files:**
- Modify: `src/services/constraint-manager.ts`
- Modify: `test/unit/constraint-manager.test.ts`

- [ ] **Step 3.1: Write failing tests**

Add to `test/unit/constraint-manager.test.ts` inside the `describe('getCurrentComfortBand', ...)` block (or create it if it doesn't exist yet):

```typescript
describe('getCurrentComfortBand - night mode', () => {
  let cm: ConstraintManager;

  beforeEach(() => {
    cm = new ConstraintManager(mockLogger);
  });

  const makeSettings = (overrides: Record<string, unknown> = {}) => ({
    get: (key: string) => ({
      comfort_lower_occupied: 20,
      comfort_upper_occupied: 21,
      comfort_lower_away: 19,
      comfort_upper_away: 20.5,
      comfort_lower_night: 17,
      comfort_upper_night: 19,
      ...overrides,
    }[key] ?? null)
  });

  test('returns night band when occupied=true and nightMode=true', () => {
    const band = cm.getCurrentComfortBand(true, makeSettings(), true);
    expect(band.minTemp).toBe(17);
    expect(band.maxTemp).toBe(19);
  });

  test('returns occupied band when nightMode=false', () => {
    const band = cm.getCurrentComfortBand(true, makeSettings(), false);
    expect(band.minTemp).toBe(20);
    expect(band.maxTemp).toBe(21);
  });

  test('returns occupied band when nightMode undefined (backward compat)', () => {
    const band = cm.getCurrentComfortBand(true, makeSettings());
    expect(band.minTemp).toBe(20);
    expect(band.maxTemp).toBe(21);
  });

  test('returns away band even when nightMode=true (away overrides night)', () => {
    // When user is away, use away band regardless of night mode
    const band = cm.getCurrentComfortBand(false, makeSettings(), true);
    expect(band.minTemp).toBe(19);
    expect(band.maxTemp).toBe(20.5);
  });

  test('clamps night temps to safe range (14-23)', () => {
    const band = cm.getCurrentComfortBand(true, makeSettings({
      comfort_lower_night: 10,  // below 14 → clamped to 14
      comfort_upper_night: 30,  // above 23 → clamped to 23
    }), true);
    expect(band.minTemp).toBe(14);
    expect(band.maxTemp).toBe(23);
  });

  test('uses defaults when night settings are missing', () => {
    const settingsWithoutNight = {
      get: (key: string) => ({
        comfort_lower_occupied: 20,
        comfort_upper_occupied: 21,
      }[key] ?? null)
    };
    const band = cm.getCurrentComfortBand(true, settingsWithoutNight, true);
    expect(band.minTemp).toBe(17.0); // default
    expect(band.maxTemp).toBe(19.0); // default
  });
});
```

- [ ] **Step 3.2: Run to confirm failure**

```bash
npx jest test/unit/constraint-manager.test.ts --no-coverage 2>&1 | grep -E "FAIL|night|● "
```
Expected: failures for night mode tests

- [ ] **Step 3.3: Extend `getCurrentComfortBand` in ConstraintManager**

In `src/services/constraint-manager.ts`, update the signature and add the night branch. The full updated method (replace the existing `getCurrentComfortBand`):

```typescript
/**
 * Get current comfort band based on occupancy and night state.
 * Priority: away > night (occupied only) > occupied (day).
 * @param occupied Whether home is occupied
 * @param settings Settings object with comfort band values
 * @param nightMode Whether night setback is currently active
 * @returns Comfort band with min/max temperatures
 */
getCurrentComfortBand(occupied: boolean, settings?: {
    get(key: string): unknown;
}, nightMode?: boolean): ComfortBand {
    if (!settings) {
        return {
            minTemp: this.zone1.minTemp,
            maxTemp: this.zone1.maxTemp
        };
    }

    const toNumber = (value: unknown): number | null => {
        if (value === null || value === undefined) return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    if (!occupied) {
        // Away band — night mode does not override away
        const comfortLowerAway = toNumber(settings.get('comfort_lower_away')) ?? 19.0;
        const comfortUpperAway = toNumber(settings.get('comfort_upper_away')) ?? 20.5;
        return {
            minTemp: Math.max(comfortLowerAway, 16),
            maxTemp: Math.min(comfortUpperAway, 26)
        };
    }

    if (nightMode) {
        // Night setback band — only when occupied
        const nightMin = toNumber(settings.get('comfort_lower_night')) ?? 17.0;
        const nightMax = toNumber(settings.get('comfort_upper_night')) ?? 19.0;
        return {
            minTemp: Math.max(nightMin, 14),
            maxTemp: Math.min(nightMax, 23)
        };
    }

    // Occupied daytime band
    const comfortLowerOccupied = toNumber(settings.get('comfort_lower_occupied')) ?? 20.0;
    const comfortUpperOccupied = toNumber(settings.get('comfort_upper_occupied')) ?? 21.0;
    return {
        minTemp: Math.max(comfortLowerOccupied, 16),
        maxTemp: Math.min(comfortUpperOccupied, 26)
    };
}
```

- [ ] **Step 3.4: Run tests**

```bash
npx jest test/unit/constraint-manager.test.ts --no-coverage
```
Expected: all passing

- [ ] **Step 3.5: Run full suite to check no regressions**

```bash
npx jest --no-coverage 2>&1 | tail -15
```
Expected: no new failures

- [ ] **Step 3.6: Commit**

```bash
git add src/services/constraint-manager.ts test/unit/constraint-manager.test.ts
git commit -m "feat: add night mode support to ConstraintManager.getCurrentComfortBand"
```

---

## Task 4: Wire night mode into the Optimizer

**Files:**
- Modify: `src/services/optimizer.ts` (line 800 — private `getCurrentComfortBand`)
- Create: `test/unit/optimizer.night-setback.test.ts`

- [ ] **Step 4.1: Write failing integration test**

```typescript
// test/unit/optimizer.night-setback.test.ts
import { ConstraintManager } from '../../src/services/constraint-manager';
import { isNightHour } from '../../src/util/night-setback';

// Unit test for the composed night-mode resolution logic
// (the optimizer's private method is tested indirectly via constraint manager + isNightHour)
describe('Night setback integration', () => {
  let cm: ConstraintManager;
  const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;

  beforeEach(() => {
    cm = new ConstraintManager(mockLogger);
  });

  const makeSettings = (extra: Record<string, unknown> = {}) => ({
    get: (key: string) => ({
      comfort_lower_occupied: 20,
      comfort_upper_occupied: 21,
      comfort_lower_away: 19,
      comfort_upper_away: 20.5,
      comfort_lower_night: 17,
      comfort_upper_night: 19,
      night_setback_enabled: true,
      night_start_hour: 22,
      night_end_hour: 6,
      ...extra,
    }[key] ?? null)
  });

  test('resolves to night band at 23:00 when enabled', () => {
    const settings = makeSettings();
    const nightMode = isNightHour(23, 22, 6); // true
    const band = cm.getCurrentComfortBand(true, settings, nightMode);
    expect(band.minTemp).toBe(17);
    expect(band.maxTemp).toBe(19);
  });

  test('resolves to daytime band at 12:00 even when enabled', () => {
    const settings = makeSettings();
    const nightMode = isNightHour(12, 22, 6); // false
    const band = cm.getCurrentComfortBand(true, settings, nightMode);
    expect(band.minTemp).toBe(20);
    expect(band.maxTemp).toBe(21);
  });

  test('resolves to daytime band at 23:00 when disabled (enabled=false)', () => {
    const settings = makeSettings({ night_setback_enabled: false });
    const nightMode = false; // disabled overrides time check
    const band = cm.getCurrentComfortBand(true, settings, nightMode);
    expect(band.minTemp).toBe(20);
    expect(band.maxTemp).toBe(21);
  });
});
```

- [ ] **Step 4.2: Run to confirm tests pass (they test the utility already built)**

```bash
npx jest test/unit/optimizer.night-setback.test.ts --no-coverage
```
Expected: all 3 passing (these test the already-implemented pieces)

- [ ] **Step 4.3: Update optimizer's `getCurrentComfortBand` wrapper**

In `src/services/optimizer.ts`, add the import near the top with the other utility imports:
```typescript
import { isNightHour } from '../util/night-setback';
```

Replace the existing private method at line ~800:
```typescript
private getCurrentComfortBand(): { minTemp: number; maxTemp: number } {
  const nightSettings = this.settingsLoader.loadNightSetbackSettings();
  const nightMode = nightSettings.enabled && isNightHour(
    new Date().getHours(),
    nightSettings.startHour,
    nightSettings.endHour
  );
  return this.constraintManager.getCurrentComfortBand(
    this.occupied,
    this.homey ? this.homey.settings : undefined,
    nightMode
  );
}
```

- [ ] **Step 4.4: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -15
```
Expected: no new failures

- [ ] **Step 4.5: Commit**

```bash
git add src/services/optimizer.ts test/unit/optimizer.night-setback.test.ts
git commit -m "feat: resolve night setback in optimizer comfort band"
```

---

## Task 5: Settings page UI

**Files:**
- Modify: `settings/index.html`

This task has no automated tests — the settings page uses the Homey web API. After the change, manually verify in the Homey app's device settings.

- [ ] **Step 5.1: Add HTML controls after the away band section (after line ~550)**

Find this comment anchor in `settings/index.html`:
```html
        </div>
      </div>

      <div class="homey-form-group">
        <label class="homey-form-label">Price‑Aware Preheating</label>
```

Insert the night setback group between these two `<div class="homey-form-group">` blocks:

```html
      <div class="homey-form-group">
        <label class="homey-form-label">Night Setback</label>
        <div class="homey-form-row">
          <div class="homey-form-col">
            <label class="homey-form-checkbox">
              <input type="checkbox" id="night_setback_enabled" />
              <span>Enable night setback</span>
            </label>
            <p class="homey-form-helper">Lower the heating target during sleeping hours. Only applies when home is occupied. Suggested default: <b>Disabled</b>.</p>
          </div>
        </div>
        <div id="night-setback-controls">
          <div class="homey-form-row">
            <div class="homey-form-col">
              <label class="homey-form-label" for="night_start_hour">Night start hour (0–23)</label>
              <input class="homey-form-input" id="night_start_hour" type="number" min="0" max="23" step="1" value="22" />
              <p class="homey-form-helper">Hour when night setback begins. Suggested default: <b>22</b> (10 PM).</p>
            </div>
            <div class="homey-form-col">
              <label class="homey-form-label" for="night_end_hour">Night end hour (0–23)</label>
              <input class="homey-form-input" id="night_end_hour" type="number" min="0" max="23" step="1" value="6" />
              <p class="homey-form-helper">Hour when daytime band resumes. Suggested default: <b>6</b> (6 AM).</p>
            </div>
          </div>
          <div class="homey-form-row">
            <div class="homey-form-col">
              <label class="homey-form-label" for="comfort_lower_night">Night Lower (°C)</label>
              <input class="homey-form-input" id="comfort_lower_night" type="number" min="14" max="22" step="0.5" value="17" />
              <p class="homey-form-helper">Suggested default: <b>17.0°C</b>.</p>
            </div>
            <div class="homey-form-col">
              <label class="homey-form-label" for="comfort_upper_night">Night Upper (°C)</label>
              <input class="homey-form-input" id="comfort_upper_night" type="number" min="15" max="23" step="0.5" value="19" />
              <p class="homey-form-helper">Suggested default: <b>19.0°C</b>. Keep 1–2°C below daytime upper.</p>
            </div>
          </div>
        </div>
      </div>
```

- [ ] **Step 5.2: Add element variables in the JS section**

Find the block where comfort band elements are declared (near line ~2042):
```javascript
const comfortLowerOccElement = document.getElementById("comfort_lower_occupied");
```

Add after the existing comfort band element declarations:
```javascript
const nightSetbackEnabledElement = document.getElementById("night_setback_enabled");
const nightStartHourElement = document.getElementById("night_start_hour");
const nightEndHourElement = document.getElementById("night_end_hour");
const comfortLowerNightElement = document.getElementById("comfort_lower_night");
const comfortUpperNightElement = document.getElementById("comfort_upper_night");
const nightSetbackControls = document.getElementById("night-setback-controls");
```

- [ ] **Step 5.3: Add show/hide toggle for controls**

Find where other checkboxes drive visibility (e.g. the `preheat_enable` toggle pattern) and add after the element declarations:
```javascript
function updateNightSetbackVisibility() {
  if (nightSetbackControls) {
    nightSetbackControls.style.opacity = nightSetbackEnabledElement.checked ? '1' : '0.5';
    nightSetbackControls.style.pointerEvents = nightSetbackEnabledElement.checked ? '' : 'none';
  }
}
if (nightSetbackEnabledElement) {
  nightSetbackEnabledElement.addEventListener('change', updateNightSetbackVisibility);
  updateNightSetbackVisibility();
}
```

- [ ] **Step 5.4: Load settings from Homey on page open**

Find the block where comfort band values are loaded (near line ~2300):
```javascript
Homey.get("comfort_lower_occupied", function (err, value) { if (hasValidValue(err, value)) comfortLowerOccElement.value = value; });
```

Add after the existing comfort band loads:
```javascript
Homey.get("night_setback_enabled", function (err, value) { if (hasValidValue(err, value) && nightSetbackEnabledElement) { nightSetbackEnabledElement.checked = value; updateNightSetbackVisibility(); } });
Homey.get("night_start_hour", function (err, value) { if (hasValidValue(err, value) && nightStartHourElement) nightStartHourElement.value = value; });
Homey.get("night_end_hour", function (err, value) { if (hasValidValue(err, value) && nightEndHourElement) nightEndHourElement.value = value; });
Homey.get("comfort_lower_night", function (err, value) { if (hasValidValue(err, value) && comfortLowerNightElement) comfortLowerNightElement.value = value; });
Homey.get("comfort_upper_night", function (err, value) { if (hasValidValue(err, value) && comfortUpperNightElement) comfortUpperNightElement.value = value; });
```

- [ ] **Step 5.5: Save settings on save button click**

Find the block where comfort band values are saved (near line ~3066):
```javascript
Homey.set("comfort_lower_occupied", clo, function (err) { ... });
```

Add after the existing comfort band saves:
```javascript
const nightEnabled = nightSetbackEnabledElement ? nightSetbackEnabledElement.checked : false;
Homey.set("night_setback_enabled", nightEnabled, function (err) { if (err) console.error('Error saving night_setback_enabled:', err); });
const nsh = nightStartHourElement ? parseInt(nightStartHourElement.value, 10) : 22;
Homey.set("night_start_hour", nsh, function (err) { if (err) console.error('Error saving night_start_hour:', err); });
const neh = nightEndHourElement ? parseInt(nightEndHourElement.value, 10) : 6;
Homey.set("night_end_hour", neh, function (err) { if (err) console.error('Error saving night_end_hour:', err); });
const cln = comfortLowerNightElement ? parseFloat(comfortLowerNightElement.value) : 17.0;
Homey.set("comfort_lower_night", cln, function (err) { if (err) console.error('Error saving comfort_lower_night:', err); });
const cun = comfortUpperNightElement ? parseFloat(comfortUpperNightElement.value) : 19.0;
Homey.set("comfort_upper_night", cun, function (err) { if (err) console.error('Error saving comfort_upper_night:', err); });
```

- [ ] **Step 5.6: Add night keys to the validation/dirty-check list**

Find the array near line ~3331:
```javascript
['comfort_lower_occupied','comfort_upper_occupied','comfort_lower_away','comfort_upper_away', ...]
```

Add the night keys to that array:
```javascript
'night_setback_enabled','night_start_hour','night_end_hour','comfort_lower_night','comfort_upper_night'
```

- [ ] **Step 5.7: Run full test suite to confirm no regressions**

```bash
npx jest --no-coverage 2>&1 | tail -15
```
Expected: all existing tests still passing

- [ ] **Step 5.8: Commit**

```bash
git add settings/index.html
git commit -m "feat: add night setback settings UI with toggle and comfort band inputs"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `isNightHour` handles midnight-crossing windows (Task 1)
- ✅ Settings can be loaded with defaults (Task 2)
- ✅ Night band applied when occupied=true + nightMode=true (Task 3)
- ✅ Away mode still overrides night mode (Task 3)
- ✅ Single change point in optimizer — all 6 call sites pick up night mode (Task 4)
- ✅ UI toggle enables/disables controls (Task 5)
- ✅ Settings are saved and loaded correctly (Task 5)
- ✅ Feature is off by default (`night_setback_enabled` defaults to `false`) — no behavior change for existing users

**Placeholder scan:** None found.

**Type consistency:**
- `NightSetbackSettings` defined in `src/util/night-setback.ts`, imported by `settings-loader.ts`
- `getCurrentComfortBand(occupied, settings?, nightMode?)` signature used consistently in constraint-manager + optimizer
- All hour values 0-23 (number), all temps in °C (number)

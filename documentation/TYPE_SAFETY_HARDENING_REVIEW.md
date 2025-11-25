## Type Safety Hardening Review

### Executive Summary
- Zone 2 fallbacks now fire MELCloud writes without deadband/lockout guards or error handling when price data is missing, risking hourly command spam and aborts (src/services/optimizer.ts:1988-2004, 2031-2036).
- Savings projection inflates early-day numbers by forcing a 24× multiplier of the latest hour even with no history, masking low/negative hours (src/util/enhanced-savings-calculator.ts:311-330).
- COP parsing drops `{hour,value}` entries, so hourly COP arrays from MELCloud are lost (src/services/optimizer.ts:1082-1084).
- Typed settings accessor rejects stringly stored numbers/booleans, silently reverting comfort/occupancy to defaults if legacy settings are stringified (src/util/settings-accessor.ts:9-48).
- Positives: COP/price/constraint typing improved; tank constraints now persist via `ConstraintManager`; weather/price logging is clearer.

### Findings (ordered)
1) **Zone 2 fallback spams writes on missing prices**  
   - `src/services/optimizer.ts:1988-2004`  
   - Issues: ignores deadband/min-change; unguarded `await setZoneTemperature`; always marks `changed=true`. If Tibber/ENTSO-E is down, this runs hourly and can throw, aborting optimization.  
   - Snippet:  
     ```ts
     if (!inputs.priceData.prices || inputs.priceData.prices.length === 0) {
       const fallbackTarget = Math.round(clampedTarget / constraints.tempStep) * constraints.tempStep;
       await this.melCloud.setZoneTemperature(this.deviceId, this.buildingId, fallbackTarget, 2);
       return { ...changed: true };
     }
     ```
   - Fix: apply zone2 constraints + deadband/lockout, skip if target unchanged, wrap MELCloud call in try/catch and log.

2) **Zone 2 null-result fallback repeats unguarded writes**  
   - `src/services/optimizer.ts:2031-2036`  
   - Same risks as above when `zoneOptimizer` returns null; can double-send in one run.  
   - Fix: reuse guarded path and honor lockout/duplicate detection.

3) **Daily savings projection overstates early hours**  
   - `src/util/enhanced-savings-calculator.ts:311-330`  
   - Baseline set to `currentHourSavings * 24` and forced via `Math.max(...)`, so a single good hour at 0.5 SEK projects 12 SEK/day even with zero/negative history.  
   - Fix: when no history, cap projection (e.g., 1–2 hours ahead) or use rolling average; when history exists, don’t clamp to 24× of the latest hour.

4) **Hourly COP objects discarded**  
   - `src/services/optimizer.ts:1082-1084`  
   - Filters `energyData.CoP` to numbers only; MELCloud can return `{ hour, value }` objects, which then vanish and can’t be averaged.  
   - Fix: normalize objects to numbers (e.g., map `value`) or preserve raw entries for downstream averages.

5) **Settings type strictness drops user values** (Hypothesis – needs settings dump)  
   - `src/util/settings-accessor.ts:9-48`  
   - `getNumber/getBoolean` return defaults on type mismatch; legacy Homey settings often store numbers/booleans as strings. Comfort bands/occupied may silently reset to defaults.  
   - Fix: accept numeric/boolean strings or add migration before enforcing types.

### Rating
- Overall: **6/10** – Typing and constraint plumbing improved, but new fallbacks and projections introduce correctness/reliability risks.

### Quick Wins
- Guard Zone 2 fallbacks with deadband/lockout and error handling before any MELCloud writes.
- Rebase compounded savings on history/rolling averages rather than a 24× multiplier of the latest hour.
- Normalize COP arrays that contain objects and preserve them for averaging.
- Relax or migrate settings parsing to avoid discarding legacy user values.

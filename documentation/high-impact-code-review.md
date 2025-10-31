# High-Impact Code Review — MELCloud Optimizer

## Executive Summary
- Hot-water pattern scheduling currently skips next-day morning peaks when the optimizer runs after noon, leaving tanks cold and costing morning comfort (`src/services/optimizer.ts:1072`).
- Thermal mass preheat math assumes a fixed 20 °C baseline, overestimating savings and driving needless 1–2 °C overshoots (`src/services/optimizer.ts:854`).
- Price ingestion lacks guards for empty/malformed feeds, so a transient Tibber/ENTSO-E gap can crash the whole hourly run (`src/services/optimizer.ts:1995`).
- Manual-DST handling in `TimeZoneHelper` is hard-coded to April–October, so schedules drift by +/‑1 h for weeks around real DST switches (`src/util/time-zone-helper.ts:245`).
- Hot-water COP logic delays to the absolute cheapest hour even if that slot is 18–20 h away, risking tank depletion and missed cheap windows (`src/services/optimizer.ts:1625`).
- Hourly thermal retention persists the full dataset on every point, triggering the “high memory pressure” seen in logs (`src/services/thermal-model/data-collector.ts:884`).
- Assumed context: hot water pattern path is active (`dataPoints ≥ 14`) and Homey installs without IANA timezones default to manual offset+DST.

## Major Opportunities (ordered)

1. **Hot-water pattern scheduler ignores next-day peaks after noon**  
   - **Problem**: `validHours` only admits hours ≥ `currentHour`, so morning peaks vanish for 10–12 h runs.  
   - **Change**: Compute relative offsets modulo 24 and admit offsets > 0 within the 12 h planning window.  
   - **Impact (est.)**: +3–6 % hot-water savings and removes overnight comfort misses.  
   - **Risk**: Low.  
   - **Complexity**: Medium.  
   - **Files/Lines**: `src/services/optimizer.ts:1072`.  
   - **Snippet**:
     ```ts
     const candidates: { hour: number; offset: number }[] = [];
     for (let i = 0; i < 4; i++) {
       const hour = (peakHour - i + 24) % 24;
       const offset = (hour - currentHour + 24) % 24;
       if (offset > 0 && offset <= 12 && offset < next24h.length) {
         candidates.push({ hour, offset });
       }
     }
     ```

2. **Thermal mass preheat uses fixed 20 °C baseline**  
   - **Problem**: `calculatePreheatingValue` treats every preheat as `(target − 20)`°, overstating gains.  
   - **Change**: Pass actual indoor temperature, clamp `tempLift = max(0, target − currentTemp)`, reuse in boost path.  
   - **Impact (est.)**: Avoids 1–2 °C unnecessary preheats, +4–7 % winter shoulder savings.  
   - **Risk**: Low.  
   - **Complexity**: Medium.  
   - **Files/Lines**: `src/services/optimizer.ts:763`, `854`.  
   - **Snippet**:
     ```ts
     const tempLift = Math.max(0, preheatingTarget - currentTemp);
     const extraEnergy = tempLift * this.thermalMassModel.thermalCapacity;
     ```

3. **Price ingestion crashes on empty data**  
   - **Problem**: `priceData.prices.reduce` and `priceData.current.price` are used without validation.  
   - **Change**: Short-circuit when prices are missing, log, and return a hold response.  
   - **Impact (est.)**: Prevents 100 % of optimizer aborts during feed outages.  
   - **Risk**: Low.  
   - **Complexity**: Small.  
   - **Files/Lines**: `src/services/optimizer.ts:1995`.  
   - **Snippet**:
     ```ts
     if (!priceData?.prices?.length || typeof priceData.current?.price !== 'number') {
       return { success: true, action: 'no_change', reason: 'Price data missing; holding', ... };
     }
     ```

4. **Manual DST window causes 1 h drift**  
   - **Problem**: Offset-based DST adds +60 min for all months April–October regardless of real switch dates.  
   - **Change**: When `useDST` is true and no IANA zone exists, derive last-Sunday windows per year or map offset to IANA first.  
   - **Impact (est.)**: Eliminates 1 h misalignment for ~5 weeks/year, preserving 2–4 % shifting gains.  
   - **Risk**: Medium.  
   - **Complexity**: Medium.  
   - **Files/Lines**: `src/util/time-zone-helper.ts:245`.  
   - **Snippet**:
     ```ts
     if (this.useDST) {
       const mapped = this.timeZoneName ?? TimeZoneHelper.offsetToIANA(this.timeZoneOffset);
       if (mapped) {
         // derive offset via formatter
       } else {
         if (!this.manualDstWindow || this.manualDstWindow.year !== date.getUTCFullYear()) {
           this.manualDstWindow = this.computeLastSundayWindow(date.getUTCFullYear());
         }
         if (this.manualDstWindow.isInRange(date)) offsetMinutes += 60;
       }
     }
     ```

5. **Hot-water delay picks distant cheapest slot**  
   - **Problem**: `cheapestHours[0]` is sorted only by price, so actions can defer 18–20 h.  
   - **Change**: Sort by time offset first, guard for empty results.  
   - **Impact (est.)**: +1–3 % hot-water cost reduction, fewer cold-tank incidents.  
   - **Risk**: Low.  
   - **Complexity**: Small.  
   - **Files/Lines**: `src/services/optimizer.ts:1625`.  
   - **Snippet**:
     ```ts
     const nextCheapHour = cheapestHours
       .map(p => ({ ...p, offsetMs: Math.max(0, Date.parse(p.time) - nowMs) }))
       .sort((a, b) => a.offsetMs - b.offsetMs || a.price - b.price)[0];
     ```

6. **Thermal retention rewrite on every data point**  
   - **Problem**: `saveData('add-data-point')` stringifies entire history each point; triggers memory spikes.  
   - **Change**: Batch pending writes and flush on timer/threshold before serialization.  
   - **Impact (est.)**: 30–40 MB heap relief, fewer GC stalls.  
   - **Risk**: Medium.  
   - **Complexity**: Medium.  
   - **Files/Lines**: `src/services/thermal-model/data-collector.ts:884`, `1034`.  
   - **Snippet**:
     ```ts
     this.pendingWrites.push(point);
     if (!this.flushTimer) {
       this.flushTimer = setTimeout(() => this.flushPending('hourly'), 5000);
     }
     ```

## Bugs & Repro

| Bug | Reproduction | Evidence |
| --- | --- | --- |
| Hot-water pattern skips tomorrow morning | Set `peakHours = [7]`, run at 14:00, `schedulePoints` empty because future modulo not handled. | `src/services/optimizer.ts:1072` |
| Thermal mass preheat overestimates delta | Indoor 21.5 °C, target 21.7 °C → `calculatePreheatingValue` uses `(21.7 − 20)`°, triggering overshoot. | `src/services/optimizer.ts:854` |
| Empty price array crashes run | Price provider returns `{ prices: [] }`; reduce throws, hourly cron aborts. | `src/services/optimizer.ts:1995` |

## Bottlenecks & Reliability
- `src/services/optimizer.ts:1660` still dereferences `cheapestHours[0]` without null guard—add defensive checks after reordering.
- `src/services/optimizer.ts:1186` reads price slots via absolute hour index; align by relative offset for accurate savings analytics.
- `src/services/thermal-model/data-collector.ts:937` re-stringifies aggregated data immediately after retention—consider diff-based persistence.
- `src/services/optimizer.ts:2033` assumes `priceData.current.time` parses; maintain fallback and propagate to percentile calculations.

## Minimal Test Additions
- Unit test: `optimizeHotWaterSchedulingByPattern` run at 14:00 still schedules a 07:00 peak via modulo offsets.
- Unit test: `calculatePreheatingValue` scales with `currentTemp`, preventing hard-coded 20 °C deltas.
- Integration test: empty `prices` array yields `no_change` result without throwing.
- Property test: manual offset + DST path returns correct hour around real DST switch boundaries.

## Next 7 Days Plan
1. Patch hot-water scheduling modulo logic and nearby COP delay sorting, add regression coverage.
2. Guard price ingestion and add tests for empty/malformed feeds before the next build.
3. Correct thermal mass savings math, update DST handling, and prototype batched thermal retention flush before rolling to users.

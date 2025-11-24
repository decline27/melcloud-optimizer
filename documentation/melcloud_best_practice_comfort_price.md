# MELCloud Optimizer – Best Practice for Comfort & Price Control
Version: 0.1

## Goal
Design all control logic around:
- **Maximizing COP (efficiency)**
- **Maintaining high comfort (stable indoor temp)**
- **Optimizing for dynamic electricity prices**
- **Avoiding compressor stress and short cycling**

This document defines **non‑negotiable best practices** for how the agent should control Mitsubishi ATW (Ecodan) systems via MELCloud.

---

## Core Principle

> **Always control via “desired comfort level” (room target temperature / curve offset), _not_ via raw flow temperature.**

### In practice
- Prefer changing:
  - `SetTemperatureZone1` / `SetTemperatureZone2`
  - or **curve/compensation offset** (when exposed)
- Avoid directly forcing:
  - `SetHeatFlowTemperatureZone1`
  - `SetHeatFlowTemperatureZone2`

---

## Why Room/Curve-Based Control Is Preferred

### 1. Better COP (efficiency)
- Heat pumps are most efficient when:
  - Flow temperature is as **low as possible**
  - Compressor runs **slow and steady**
- When we raise **room setpoint** or **curve offset**, the **heat pump itself computes** the *minimum* required flow temperature to reach that comfort level under current outdoor conditions.
- This preserves COP and reduces energy consumption for the same perceived comfort.

### 2. Better stability & comfort
- Room/curve-based control:
  - Produces **long, stable heating cycles**
  - Avoids aggressive overshoot
  - Keeps indoor temperature within a smooth comfort band

- Directly forcing flow temperature:
  - Risks **overshooting** room temperature
  - Can cause the compressor to ramp to high Hz
  - Increases risk of **short cycling** and unstable behavior

### 3. Better alignment with built‑in Mitsubishi logic
- Mitsubishi’s control logic is designed to:
  - Take outdoor temperature
  - Take desired comfort (curve + room target)
  - Compute flow temperature internally
- By respecting this design, we **cooperate** with the controller instead of fighting it.

---

## When *Not* to Use Flow Temperature Control

The agent **must not** use direct flow temperature control as the default strategy.

### Do **NOT**:
- Use `SetHeatFlowTemperatureZone1/2` for normal comfort control.
- Continuously “chase” a target by adjusting flow temp every few minutes.
- Use high flow temps as the primary method for preheating before expensive price periods.

These patterns:
- Reduce COP significantly.
- Increase mechanical stress.
- Create unstable temperatures and poor user experience.

---

## Allowed Use of Flow Temperature (Exception Cases)

Flow temperature control is allowed **only** in exceptional cases and must be implemented conservatively.

### Valid exceptional scenarios
1. **Fast preheat during extremely cheap hours**  
   - When:
     - Price is extremely low,
     - There is insufficient time left in the cheap window,
     - House temperature is below the lower comfort band.
   - Then the agent **may**:
     - Temporarily nudge flow temperature **slightly up** (+2–4°C max above what curve would produce).
     - Strictly limit duration.
     - Monitor room temperature to avoid overshoot.

2. **Emergency response**
   - E.g. very rapid outdoor temperature drop, user manually changed comfort expectations, or recovery from large setback.

### Rules when using flow temp
- Increase in **small steps only** (2°C increments).
- Limit how often flow temp is touched.
- Always reset back to curve‑driven behavior afterward.
- Never use flow temp as a replacement for curve/room control.

---

## Recommended Control Strategy

### 1. Base heating mode
- Use **Weather Compensation / Curve mode** as the **foundation**.
- Set a sensible default curve for the building.
- Let HP compute flow temp from:
  - Outdoor temperature
  - Curve parameters
  - Room targets

### 2. Comfort band
- Define a **comfort band** per zone, e.g.:
  - 20.5–21.5°C
- The agent should:
  - Keep room temperature inside this band.
  - Use **setpoint adjustments** (room temp) or **curve offsets** as the primary tool.

### 3. Price‑based optimization

#### During cheap hours
- Slightly **raise comfort level**, not flow:
  - Increase `SetTemperatureZone1`/`Zone2` by +0.5 to +2.0°C **within a safe upper limit**.
  - Or apply a **positive curve offset** (+2 to +5°C) if supported.
- Aim is to **pre‑heat the building mass**, not to spike flow temperature.

#### During expensive hours
- Slightly **reduce comfort level** (within agreed min comfort):
  - Lower `SetTemperatureZoneX` by 0.5–1.5°C, or
  - Apply a small negative curve offset.
- Let the building “coast” while staying inside the comfort band.

### 4. DHW (domestic hot water)
- Use **normal DHW scheduling**.
- Concentrate DHW heating in **cheaper hours** where possible:
  - Force DHW “Heat Now” only during cheap periods.
- Avoid storing water significantly hotter than necessary at all times.

---

## Explicit Rules for the Coding Agent

The coding agent **must follow** these rules when designing or modifying control logic:

1. **Default control lever**  
   - Use **room target temperatures** and **curve/compensation offsets** as primary control parameters.

2. **Forbidden default pattern**  
   - Do **not** use raw flow temperature as the main control variable.

3. **Flow temp usage constraints**  
   - If flow temperature is used:
     - It must be inside a clearly defined **exception branch**.
     - It must be **time‑limited** and **bounded in amplitude**.
     - It must revert back to curve‑controlled behavior automatically.

4. **Always protect COP**  
   - All optimization routines must aim to keep flow temperature **as low as possible** while meeting comfort constraints.

5. **Respect comfort limits**  
   - Never push comfort beyond configured min/max limits to chase price savings.

6. **Logging requirements**  
   - All changes to:
     - Room temperature targets,
     - Curve/offset settings,
     - Flow temperatures,
   - must be logged with:
     - Reason (cheap/expensive, preheat, correction, emergency)
     - Old value, new value
     - Price context

---

## Suggested Abstractions (TypeScript / Homey SDK 3.0)

Define explicit notions of “comfort control” vs “low‑level control”.

```ts
export interface ComfortBand {
  min: number; // e.g. 20.5
  max: number; // e.g. 21.5
}

export interface ZoneComfortConfig {
  preferred: number;   // nominal comfort temperature, e.g. 21.0
  band: ComfortBand;
}

export interface PriceSignal {
  isCheap: boolean;
  isExpensive: boolean;
  normalizedPrice: number; // 0..1
}
```

### High‑level control API (preferred)

```ts
export interface ComfortControlCommand {
  zone1TargetDelta?: number;   // +0.5, -1.0, etc.
  zone2TargetDelta?: number;
  curveOffsetDelta?: number;   // if supported
}

export interface ComfortController {
  applyComfortStrategy(
    state: AtwDeviceState,
    price: PriceSignal,
    config: ZoneComfortConfig
  ): ComfortControlCommand;
}
```

### Low‑level flow temp (exception)

```ts
export interface FlowOverrideCommand {
  zone1FlowOverride?: number; // °C, small limited nudge
  zone2FlowOverride?: number;
  durationMinutes: number;    // must always be bounded
  reason: string;             // "fast_preheat", "emergency", etc.
}
```

The system should use `ComfortControlCommand` for **all normal decisions** and only occasionally emit a `FlowOverrideCommand` under documented exception rules.

---

## Summary

- **Always think in terms of room comfort and curve, not raw flow temp.**
- Curve + room targets = best **COP**, best **comfort**, best **stability**.
- Flow temp control is a **sharp tool** – use it rarely, carefully, and only in well‑defined scenarios.
- Any new optimization logic must be checked against this best‑practice document before implementation.

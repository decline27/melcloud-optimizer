# MELCloud API Reference & Best Practices

> Complete reference for MELCloud ATW (Air-to-Water) heat pump integration.

**Last Updated:** December 4, 2025

---

## Part 1: API Reference

### Base URL & Headers

```
https://app.melcloud.com/Mitsubishi.Wifi.Client
```

**Common headers:**
```http
Content-Type: application/json
X-MitsContextKey: <ContextKey>
User-Agent: <your app name>
```

### Authentication

**Login:**
```
POST /Login/ClientLogin
```
```json
{
  "AppVersion": "1.19.3.0",
  "Language": "7",
  "CaptchaChallenge": "",
  "CaptchaResponse": "",
  "Persist": true,
  "Email": "user@example.com",
  "Password": "password"
}
```
Response contains `LoginData.ContextKey` used for all API calls.

### Device Discovery

```
GET /User/ListDevices?id=<userId>&buildingID=<buildingId>
```
Returns structures → buildings → devices. ATW heat pumps = `DeviceType = 1`.

### Device State

```
GET /Device/Get?id=<deviceId>&buildingId=<buildingId>
```

**Key response fields:**
- `TankWaterTemperature`, `SetTankWaterTemperature`
- `FlowTemperature`, `OutdoorTemperature`
- `RoomTemperatureZone1` / `Zone2`
- `OperationMode`
- Daily energy stats

### Update Device (SetAtw)

```
POST /Device/SetAtw
```
```json
{
  "DeviceID": 59132691,
  "BuildingID": 111111,
  "Power": true,
  "OperationMode": 2,
  "SetTemperatureZone1": 21.0,
  "SetTankWaterTemperature": 50.0,
  "EffectiveFlags": 0
}
```

**EffectiveFlags Bitmask:**

| Field | Mask |
|-------|------|
| Power | `1` |
| OperationMode | `2` |
| OperationModeZone1 | `8` |
| OperationModeZone2 | `16` |
| SetTankWaterTemperature | `32` |
| SetTemperatureZone1 | `8589934720` |
| SetTemperatureZone2 | `34359738880` |

Combine using bitwise OR.

### Operation Modes

| Value | Mode |
|-------|------|
| 0 | IDLE |
| 1 | HOT WATER |
| 2 | HEATING ZONES |
| 3 | COOLING |
| 4 | HOT WATER STORAGE |
| 6 | LEGIONELLA |
| 7 | HEATING ECO |
| 11 | HEATING UP |

### Zone Operation Modes

| Value | Mode |
|-------|------|
| 0 | HEAT THERMOSTAT |
| 1 | HEAT FLOW |
| 2 | HEAT CURVE |
| 3 | COOL THERMOSTAT |
| 4 | COOL FLOW |
| 5 | FLOOR DRYUP |
| 6 | IDLE |

### Energy Reporting

```
POST /EnergyCost/Report
```
```json
{
  "DeviceId": 59132691,
  "FromDate": "2025-11-15",
  "ToDate": "2025-11-22"
}
```

### Error Codes

| Code | Meaning |
|------|---------|
| 401 | Invalid/expired ContextKey |
| 429 | Rate-limited (common on energy endpoint) |

Always check for `"ErrorId" != null` even on 200 responses.

---

## Part 2: Best Practices for Comfort & Price Control

### Core Principle

> **Always control via room target temperature or curve offset, NOT via raw flow temperature.**

**Preferred controls:**
- `SetTemperatureZone1` / `SetTemperatureZone2`
- Curve/compensation offset (when exposed)

**Avoid directly forcing:**
- `SetHeatFlowTemperatureZone1` / `Zone2`

### Why Room/Curve-Based Control

**1. Better COP (Efficiency)**
- Heat pumps are most efficient with lowest possible flow temperature
- When we raise room setpoint, the HP computes the *minimum* required flow temperature

**2. Better Stability & Comfort**
- Produces long, stable heating cycles
- Avoids aggressive overshoot
- Keeps indoor temperature within smooth comfort band

**3. Aligns with Mitsubishi Logic**
- Mitsubishi's controller is designed to compute optimal flow from:
  - Outdoor temperature
  - Desired comfort (curve + room target)

### Price-Based Optimization Strategy

**During cheap hours:**
- Slightly raise comfort level (+0.5 to +2.0°C within safe upper limit)
- Or apply positive curve offset (+2 to +5°C)
- Goal: Pre-heat building mass, not spike flow temperature

**During expensive hours:**
- Reduce comfort level by 0.5–1.5°C
- Or apply small negative curve offset
- Let building "coast" while staying inside comfort band

### Flow Temperature Exceptions

Flow temperature control is allowed **only** in exceptional cases:

1. **Fast preheat during extremely cheap hours**
   - Price is extremely low
   - Insufficient time in cheap window
   - House below lower comfort band
   - Limit to +2–4°C above curve, short duration

2. **Emergency response**
   - Rapid outdoor temperature drop
   - Recovery from large setback

**Rules when using flow temp:**
- Increase in small steps only (2°C increments)
- Always reset back to curve-driven behavior
- Never as replacement for room control

### DHW (Domestic Hot Water)

- Use normal DHW scheduling
- Concentrate DHW heating in cheaper hours
- Force DHW "Heat Now" only during cheap periods
- Avoid storing water significantly hotter than necessary

---

## TypeScript Interfaces

```typescript
export interface AtwDeviceState {
  deviceId: number;
  buildingId: number;
  name: string;
  online: boolean;
  power: boolean;
  operationMode: number;
  tankWaterTemperature: number;
  setTankWaterTemperature: number;
  outdoorTemperature: number;
  zone1?: {
    roomTemperature: number | null;
    setTemperature: number | null;
    operationMode: number | null;
  };
  zone2?: {
    roomTemperature: number | null;
    setTemperature: number | null;
    operationMode: number | null;
  };
}

export interface ComfortBand {
  min: number; // e.g. 20.5
  max: number; // e.g. 21.5
}

export interface PriceSignal {
  isCheap: boolean;
  isExpensive: boolean;
  normalizedPrice: number; // 0..1
}
```

---

## See Also

- [SERVICES_REFERENCE.md](./SERVICES_REFERENCE.md) - MelCloudApi service details
- [SETTINGS_REFERENCE.md](./SETTINGS_REFERENCE.md) - Configuration parameters
- [USER_GUIDE.md](./USER_GUIDE.md) - End-user documentation

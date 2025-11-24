# MELCloud Unofficial API – Water Heat Pump (ATW)
Version: 0.1-unofficial

## 1. Base URL & Headers
Base URL:
```
https://app.melcloud.com/Mitsubishi.Wifi.Client
```

Common headers:
```http
Content-Type: application/json
X-MitsContextKey: <ContextKey>
User-Agent: <your app name>
```

## 2. Authentication
### 2.1 Login
```
POST /Login/ClientLogin
```
Body:
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

Response contains `LoginData.ContextKey` used for all calls.

## 3. Device Discovery
### 3.1 List Devices
```
GET /User/ListDevices?id=<userId>&buildingID=<buildingId>
```

Returns structures → buildings → devices. ATW heat pumps typically `DeviceType = 1`.

## 4. Device State
### 4.1 Get State
```
GET /Device/Get?id=<deviceId>&buildingId=<buildingId>
```

Returns full state JSON with fields like:
- TankWaterTemperature
- SetTankWaterTemperature
- FlowTemperature
- OutdoorTemperature
- RoomTemperatureZone1 / Zone2
- OperationMode
- Daily energy stats

## 5. Write State – SetAtw
```
POST /Device/SetAtw
```

Example:
```json
{
  "DeviceID": 59132691,
  "BuildingID": 111111,
  "Power": true,
  "OperationMode": 2,
  "SetTemperatureZone1": 21.0,
  "SetTankWaterTemperature": 50.0,
  "ForceDhw": 0,
  "HolidayMode": 0,
  "OperationModeZone1": 0,
  "EffectiveFlags": 0
}
```

### EffectiveFlags Bitmask
| Field | Mask |
|-------|------|
| Power | `1` |
| OperationMode | `2` |
| OperationModeZone1 | `8` |
| OperationModeZone2 | `16` |
| SetTankWaterTemperature | `32` |
| SetTemperatureZone1 | `8589934720` |
| SetTemperatureZone2 | `34359738880` |
| SetHeatFlowTemperatureZone1 | `281474976710656` |

Combine using bitwise OR.

## 6. Enums
### OperationMode
- 0 = IDLE
- 1 = HOT WATER
- 2 = HEATING ZONES
- 3 = COOLING
- 4 = HOT WATER STORAGE
- 6 = LEGIONELLA
- 7 = HEATING ECO
- 11 = HEATING UP

### ZoneOperation
- 0 = HEAT THERMOSTAT
- 1 = HEAT FLOW
- 2 = HEAT CURVE
- 3 = COOL THERMOSTAT
- 4 = COOL FLOW
- 5 = FLOOR DRYUP
- 6 = IDLE

## 7. Energy Reporting
```
POST /EnergyCost/Report
```
Body:
```json
{
  "DeviceId": 59132691,
  "FromDate": "2025-11-15",
  "ToDate": "2025-11-22"
}
```

Returns aggregated and raw energy data.

## 8. Error Handling
- 401 = invalid or expired ContextKey
- 429 = rate-limited (common on energy endpoint)
- Always check for `"ErrorId" != null` even on 200

## 9. Suggested TypeScript Interfaces (Homey SDK 3.0)
```ts
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

export interface AtwPatch {
  power?: boolean;
  operationMode?: number;
  setTankWaterTemperature?: number;
  setTemperatureZone1?: number;
  setTemperatureZone2?: number;
  operationModeZone1?: number;
  operationModeZone2?: number;
}
```

Save this as documentation for coders integrating MELCloud into Homey SDK 3.0.

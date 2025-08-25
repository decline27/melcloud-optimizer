# API Reference

> **REST API documentation for MELCloud Optimizer**

## Base URL

All API endpoints are relative to your Homey's base URL:
```
https://[homey-ip]/api/app/com.melcloud.optimize/
```

## Authentication

API calls require a valid Homey API token. Include it in the Authorization header:
```http
Authorization: Bearer [homey-api-token]
```

## Endpoints

### Optimization Control

#### `GET /runHourlyOptimizer`

Triggers manual hourly optimization.

**Response:**
```json
{
  "success": true,
  "targetTemp": 21.5,
  "reason": "Price below average, increasing temperature",
  "priceNow": 0.12,
  "priceAvg": 0.15,
  "savings": 0.025,
  "comfort": 1,
  "timestamp": "2025-08-25T14:30:00.000Z"
}
```

#### `GET /runWeeklyCalibration`

Runs thermal model calibration.

**Response:**
```json
{
  "success": true,
  "oldK": 0.3,
  "newK": 0.35,
  "oldS": 0.1,
  "newS": 0.12,
  "method": "thermal_learning",
  "confidence": 0.85,
  "timestamp": "2025-08-25T14:30:00.000Z"
}
```

### Device Management

#### `GET /getDeviceList`

Retrieves list of available MELCloud devices.

**Response:**
```json
{
  "success": true,
  "devices": [
    {
      "id": "123456",
      "name": "Main Heat Pump",
      "buildingId": 789012,
      "type": 1,
      "online": true,
      "currentTemp": 21.5,
      "targetTemp": 21.0
    }
  ]
}
```

#### `GET /updateOptimizerSettings`

Updates optimizer configuration with current Homey settings.

**Response:**
```json
{
  "success": true,
  "message": "Optimizer settings updated successfully"
}
```

### Data & Analytics

#### `GET /getCOPData`

Retrieves Coefficient of Performance data.

**Response:**
```json
{
  "success": true,
  "current": {
    "heating": 3.5,
    "hotWater": 3.2,
    "overall": 3.4
  },
  "daily": {
    "heating": 3.4,
    "hotWater": 3.1,
    "overall": 3.3
  },
  "weekly": {
    "heating": 3.3,
    "hotWater": 3.0,
    "overall": 3.2
  }
}
```

#### `GET /getWeeklyAverageCOP`

Gets weekly average COP values.

**Response:**
```json
{
  "success": true,
  "weekStart": "2025-08-18",
  "weekEnd": "2025-08-25",
  "heating": 3.4,
  "hotWater": 3.1,
  "overall": 3.3,
  "dataPoints": 168
}
```

#### `GET /getThermalModelData`

Returns thermal model status and data.

**Response:**
```json
{
  "success": true,
  "model": {
    "K": 0.35,
    "S": 0.12,
    "confidence": 0.85,
    "dataPoints": 2847,
    "lastUpdate": "2025-08-25T14:30:00.000Z"
  },
  "characteristics": {
    "heatingRate": 0.25,
    "coolingRate": 0.15,
    "thermalMass": 0.35,
    "modelConfidence": 0.85
  }
}
```

### System Management

#### `GET /getMemoryUsage`

Returns system memory usage information.

**Response:**
```json
{
  "success": true,
  "process": {
    "heapUsed": 45234176,
    "heapTotal": 67108864,
    "external": 1234567,
    "rss": 89012345
  },
  "thermalModel": {
    "dataPoints": 2847,
    "memoryUsage": 5234567
  },
  "summary": {
    "totalMB": 85.1,
    "thermalModelMB": 5.0,
    "status": "normal"
  }
}
```

#### `GET /runSystemHealthCheck`

Performs comprehensive system health check.

**Response:**
```json
{
  "success": true,
  "healthy": true,
  "issues": [],
  "melcloud": {
    "connected": true,
    "deviceCount": 1,
    "lastUpdate": "2025-08-25T14:29:30.000Z"
  },
  "tibber": {
    "connected": true,
    "priceDataAge": 300,
    "lastUpdate": "2025-08-25T14:25:00.000Z"
  },
  "cronJobs": {
    "hourly": {
      "running": true,
      "nextRun": "2025-08-25T15:05:00.000Z"
    },
    "weekly": {
      "running": true,
      "nextRun": "2025-09-01T03:05:00.000Z"
    }
  }
}
```

#### `GET /runThermalDataCleanup`

Triggers thermal model data cleanup.

**Response:**
```json
{
  "success": true,
  "recordsProcessed": 3000,
  "recordsRemoved": 153,
  "memoryFreedMB": 2.5,
  "cleanupType": "normal"
}
```

### Service Status

#### `GET /getMelCloudStatus`

Checks MELCloud API connection status.

**Response:**
```json
{
  "success": true,
  "connected": true,
  "deviceCount": 1,
  "responseTime": 245,
  "lastError": null,
  "lastUpdate": "2025-08-25T14:29:30.000Z"
}
```

#### `GET /getTibberStatus`

Checks Tibber API connection status.

**Response:**
```json
{
  "success": true,
  "connected": true,
  "currentPrice": 0.125,
  "priceCount": 24,
  "responseTime": 180,
  "lastError": null,
  "lastUpdate": "2025-08-25T14:25:00.000Z"
}
```

### Cron Job Management

#### `GET /getStartCronJobs`

Initializes or restarts cron jobs.

**Response:**
```json
{
  "success": true,
  "hourlyJob": {
    "running": true,
    "nextRun": "2025-08-25T15:05:00.000Z",
    "pattern": "0 5 * * * *"
  },
  "weeklyJob": {
    "running": true,
    "nextRun": "2025-09-01T03:05:00.000Z", 
    "pattern": "0 5 2 * * 0"
  }
}
```

#### `GET /getUpdateCronStatus`

Updates cron job status in settings.

**Response:**
```json
{
  "success": true,
  "message": "Cron status updated in settings"
}
```

#### `GET /getCheckCronStatus`

Retrieves current cron job status.

**Response:**
```json
{
  "success": true,
  "hourlyJob": {
    "running": true,
    "nextRun": "2025-08-25T15:05:00.000Z"
  },
  "weeklyJob": {
    "running": true,
    "nextRun": "2025-09-01T03:05:00.000Z"
  },
  "lastHourlyRun": "2025-08-25T14:05:12.000Z",
  "lastWeeklyRun": "2025-08-18T03:05:08.000Z"
}
```

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Detailed error message",
  "code": "ERROR_CODE",
  "timestamp": "2025-08-25T14:30:00.000Z"
}
```

### Common Error Codes

- `INVALID_CREDENTIALS`: MELCloud or Tibber credentials invalid
- `DEVICE_NOT_FOUND`: Specified device ID not found
- `API_TIMEOUT`: External API call timed out
- `INSUFFICIENT_DATA`: Not enough data for operation
- `MEMORY_LIMIT`: Memory usage too high
- `CONFIGURATION_ERROR`: Invalid app configuration

## Rate Limits

- **General**: 60 requests per minute per Homey
- **Optimization**: 1 manual optimization per minute
- **Health Checks**: 10 requests per minute
- **Data Queries**: 30 requests per minute

## WebSocket Events

The app also emits real-time events via Homey's WebSocket API:

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://[homey-ip]/api/realtime');

// Listen for optimization events
ws.on('message', (data) => {
  const event = JSON.parse(data);
  if (event.type === 'app.com.melcloud.optimize.optimization_complete') {
    console.log('Optimization completed:', event.data);
  }
});
```

### Event Types

- `optimization_complete`: Hourly optimization finished
- `calibration_complete`: Weekly calibration finished  
- `device_state_change`: Heat pump state updated
- `cop_update`: COP values changed significantly
- `memory_warning`: Memory usage above threshold

## SDK Integration

For Homey app developers, you can integrate with the optimizer:

```javascript
// Get the MELCloud Optimizer app
const optimizerApp = this.homey.apps.getApp('com.melcloud.optimize');

// Call API methods directly
const result = await optimizerApp.api.runHourlyOptimizer({
  homey: this.homey
});

// Listen for events
optimizerApp.on('optimization_complete', (data) => {
  this.log('Optimization completed:', data);
});
```

---

This API provides comprehensive access to all MELCloud Optimizer functionality for advanced automation and integration scenarios.
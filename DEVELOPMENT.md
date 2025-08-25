# Development Guide

> **Developer documentation for MELCloud Optimizer**

## 🏗️ Architecture Overview

### Technology Stack

- **Runtime**: Node.js 12+, Homey SDK 3.0
- **Language**: TypeScript 5.8 (migrated from JavaScript)
- **Build System**: TypeScript compiler + Homey CLI
- **Testing**: Jest with TypeScript support
- **APIs**: RESTful endpoints, WebSocket integration

### Project Structure

```
com.melcloud.optimize/
├── src/                          # TypeScript source code
│   ├── app.ts                    # Main Homey app entry point
│   ├── api-core.ts               # Core API implementations
│   ├── api-compat.ts             # Compatibility layer
│   ├── services/                 # Business logic services
│   │   ├── melcloud-api.ts       # MELCloud integration
│   │   ├── tibber-api.ts         # Tibber price API
│   │   ├── optimizer.ts          # Core optimization engine
│   │   ├── cop-helper.ts         # COP calculations
│   │   ├── thermal-model/        # Thermal modeling system
│   │   └── hot-water/            # Hot water optimization
│   ├── util/                     # Shared utilities
│   └── types/                    # TypeScript type definitions
├── drivers/                      # Homey device drivers
├── settings/                     # App settings UI
├── test/                         # Test suites
└── api.js                        # Legacy compatibility wrapper
```

## 🚀 Development Setup

### Prerequisites

```bash
# Install dependencies
npm install

# Global tools
npm install -g @athombv/homey-cli
npm install -g typescript
```

### Building

```bash
# TypeScript compilation
npm run build:ts

# Full Homey app build
npm run build

# Development mode
npm run dev
```

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Specific test suites
npm run test:unit
npm run test:integration
```

## 📡 API Architecture

### Core Services

#### MelCloudApi (`src/services/melcloud-api.ts`)

```typescript
class MelCloudApi extends BaseApiService {
  async login(email: string, password: string): Promise<void>
  async getDevices(): Promise<MelCloudDevice[]>
  async getDeviceState(deviceId: string, buildingId: number): Promise<MelCloudDevice>
  async setDeviceTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean>
  async getDailyEnergyTotals(deviceId: string, date: string): Promise<EnergyTotals>
}
```

#### TibberApi (`src/services/tibber-api.ts`)

```typescript
class TibberApi extends BaseApiService {
  async getPrices(): Promise<TibberPriceInfo>
  private formatPriceData(data: any): TibberPriceInfo
}
```

#### Optimizer (`src/services/optimizer.ts`)

```typescript
class Optimizer {
  async runHourlyOptimization(): Promise<OptimizationResult>
  async runWeeklyCalibration(): Promise<CalibrationResult>
  private calculateOptimalTemperature(...): Promise<number>
  private applySafeTemperatureConstraints(...): number
}
```

### Thermal Learning System

The thermal model learns your home's characteristics:

```typescript
// Data Collection
interface ThermalDataPoint {
  timestamp: Date;
  indoorTemp: number;
  outdoorTemp: number;
  targetTemp: number;
  powerConsumption: number;
  weatherData?: WeatherData;
}

// Model Analysis
interface ThermalCharacteristics {
  heatingRate: number;      // °C/hour
  coolingRate: number;      // °C/hour
  thermalMass: number;      // Heat capacity
  modelConfidence: number;  // 0-1 reliability score
}
```

## 🧪 Testing Strategy

### Test Structure

```
test/
├── unit/                    # Unit tests for individual components
│   ├── services/            # Service layer tests
│   ├── util/                # Utility function tests
│   └── app.test.ts          # Main app tests
├── integration/             # End-to-end workflow tests
└── fixtures/                # Test data and mocks
```

### Key Test Categories

1. **Unit Tests**: Individual service and utility testing
2. **Integration Tests**: Complete optimization workflows
3. **API Tests**: External service integration
4. **Error Handling**: Graceful degradation testing

### Example Test

```typescript
describe('Optimizer', () => {
  it('should optimize temperature based on price', async () => {
    // Given
    const mockPriceData = createMockPriceData({ current: 0.10, average: 0.15 });
    const mockDevice = createMockDevice({ currentTemp: 21.0 });
    
    // When
    const result = await optimizer.runHourlyOptimization();
    
    // Then
    expect(result.targetTemp).toBeGreaterThan(21.0); // Higher temp for low price
    expect(result.reason).toContain('price below average');
  });
});
```

## 🔧 Configuration

### Environment Variables

```bash
NODE_ENV=development          # Development mode
LOG_LEVEL=debug              # Verbose logging
HOMEY_DEV_MODE=true          # Homey development features
```

### App Settings

Settings are managed through Homey's settings system:

```typescript
// Reading settings
const melcloudEmail = homey.settings.get('melcloud_email');
const tibberToken = homey.settings.get('tibber_token');

// Settings validation
const requiredSettings = [
  'melcloud_email',
  'melcloud_password', 
  'tibber_token',
  'device_id',
  'building_id'
];
```

## 📊 Performance Monitoring

### Memory Management

The app includes comprehensive memory monitoring:

```typescript
// Memory usage tracking
interface MemoryUsageInfo {
  process: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  thermalModel?: {
    dataPoints: number;
    memoryUsage: number;
  };
}
```

### Performance Metrics

- **Response time**: API calls typically <200ms
- **Memory usage**: ~50MB normal, ~100MB peak
- **CPU usage**: <1% average
- **Network calls**: Minimal, only when needed

## 🛡️ Error Handling

### Error Categories

1. **Network Errors**: External API failures
2. **Authentication Errors**: Invalid credentials
3. **Validation Errors**: Invalid input data
4. **System Errors**: Memory, disk, or runtime issues

### Error Recovery

```typescript
// Circuit breaker pattern
class CircuitBreaker {
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      throw new Error('Circuit breaker is open');
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

## 🔍 Debugging

### Logging

The app uses structured logging:

```typescript
// Log levels: error, warn, info, debug
logger.info('Optimization started', {
  deviceId,
  currentPrice,
  targetTemp
});

logger.debug('Thermal model calculation', {
  heatingRate,
  thermalMass,
  confidence
});
```

### Debug Endpoints

Development endpoints for debugging:

```http
GET /getMemoryUsage        # Memory and performance stats
GET /runSystemHealthCheck  # Comprehensive system status
GET /getThermalModelData   # Thermal learning model status
```

### Common Issues

1. **API Rate Limits**: Implement backoff strategies
2. **Memory Leaks**: Monitor thermal model data retention
3. **TypeScript Errors**: Strict mode catches issues early
4. **Network Timeouts**: Circuit breaker prevents cascading failures

## 🚢 Deployment

### Pre-deployment Checklist

- [ ] All tests passing
- [ ] TypeScript compilation successful
- [ ] No linting errors
- [ ] Memory usage within limits
- [ ] API credentials configured
- [ ] Version number updated

### Build Process

```bash
# Clean build
npm run clean
npm run build

# Validation
npm run validate
npm test

# Package for distribution
homey app build
```

### Homey App Store

The app is distributed through the Homey App Store:

1. Build and test locally
2. Submit for review
3. Automated validation
4. Release to users

## 🤝 Contributing

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Enforced style guidelines
- **Prettier**: Automated formatting
- **Comments**: JSDoc for public APIs

### Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit PR with clear description

### Commit Convention

```bash
feat: add new optimization algorithm
fix: resolve memory leak in thermal model
docs: update API documentation
test: add integration tests for COP calculation
```

## 🔗 External Dependencies

### APIs Used

- **MELCloud API**: Device control and monitoring
- **Tibber GraphQL API**: Real-time electricity prices
- **Met.no Weather API**: Weather data for optimization

### Rate Limits

- MELCloud: ~1 request/minute per device
- Tibber: 100 requests/hour
- Met.no: No strict limits, but be reasonable

### Fallback Strategies

- Cache recent data for offline operation
- Graceful degradation when APIs unavailable
- Manual override capabilities for users

---

This development guide provides the foundation for contributing to and maintaining the MELCloud Optimizer codebase. For specific implementation details, refer to the inline code documentation and test files.
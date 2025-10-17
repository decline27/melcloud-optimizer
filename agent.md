# AI Agent Instructions for MELCloud Heat Pump Optimizer

## Project Overview

This is a **Homey SDK 3.0 TypeScript app** that optimizes Mitsubishi Electric heat pumps via MELCloud API using dynamic electricity pricing. The system reduces energy costs by 5-30% through intelligent scheduling based on real-time price data and thermal modeling.

## Architecture

### Entry Points
- **Main App**: `index.ts` → `src/app.ts` (Homey app class)
- **API Layer**: `src/api.ts` (HTTP endpoints for settings UI)
- **Device Driver**: `drivers/boiler/driver.ts` (device management)

### Key Services
- **MELCloud API**: `src/services/melcloud-api.ts` (heat pump control)
- **Price Services**: Tibber GraphQL (`src/services/tibber-api.ts`) & ENTSO-E REST (`src/entsoe.ts`)
- **Optimization Engine**: `src/services/optimizer.ts` (decision logic)
- **Thermal Modeling**: `src/services/thermal-model.ts` (house heat loss modeling)
- **COP Tracking**: `src/services/cop-helper.ts` (efficiency monitoring)

### Configuration
- **Settings UI**: `settings/index.html` (user configuration interface)
- **Flow Cards**: `.homeycompose/flow/` (app-level) & `drivers/boiler/driver.flow.compose.json` (device-level)
- **Capabilities**: Custom capabilities for home automation integration

### Learning and Adaptation System

This system is NOT a static rule-based optimizer. It features sophisticated machine learning capabilities:

#### Thermal Learning (`src/services/thermal-model/`)
- **ThermalModelService**: Updates house thermal characteristics every 6 hours using real MELCloud data
- **ThermalAnalyzer**: Calculates house-specific parameters (heating/cooling rates, outdoor temp impact, wind effects, thermal mass)
- **Continuous Learning**: Uses 80% new data + 20% historical for stability, learning from actual house behavior

#### Adaptive Parameter Learning (`src/services/adaptive-parameters.ts`)
- **Seasonal Price Sensitivity**: Adjusts price weight factors based on actual savings performance
- **COP Efficiency Bonuses**: Learns optimal efficiency thresholds from real heat pump performance
- **Dynamic Strategy Adaptation**: Modifies optimization parameters based on measured outcomes

#### Hot Water Usage Learning
- **Pattern Recognition**: Learns household hot water usage patterns over time
- **Demand Prediction**: Anticipates hot water needs based on historical usage
- **Efficiency Optimization**: Adapts heating schedules to actual consumption patterns

#### Impact on "Hardcoded" Values
Many apparent "hardcoded" thresholds in the optimizer are actually **decision boundaries operating on learned, house-specific parameters**:
- Price level calculations use learned thermal characteristics, not fixed assumptions
- Temperature adjustment rates are based on measured house heating/cooling performance
- Efficiency thresholds adapt to actual heat pump COP measurements
- Safety margins adjust based on learned thermal mass and response times

**Key Insight**: The system combines user-configurable price sensitivity (e.g., `preheat_cheap_percentile`) with sophisticated ML adaptation. "Hardcoded" values are often decision logic operating on learned, house-specific data rather than fixed assumptions.

## Development Guidelines

### Platform Requirements
- **Homey SDK 3.0 ONLY** - Do not suggest SDK 2.x patterns or methods
- **TypeScript Required** - All new code must be TypeScript (.ts files)
- **No Hardcoded Values** - Always use user input from settings page (`homey.settings.get()`)
- **Settings-Driven Configuration** - All parameters must be configurable via `settings/index.html`

### Build System
```bash
npm run build       # Full build (TypeScript → JavaScript → .homeyapp)
npm run build:ts    # TypeScript compilation only
npm run lint        # Type checking
npm run dev         # Development with debug output
```

### Testing
- **Unit Tests**: `npm run test:unit` (uses mocks in `test/mocks/`)
- **Integration Tests**: `npm run test` (requires `test/config.json` with real API credentials)

### Critical Patterns

#### Memory Management
This app has memory leak issues. Always clean up resources:
```typescript
private cleanupInterval?: NodeJS.Timeout;

cleanup() {
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = undefined;
  }
}
```

#### Service Coordination
Use the service manager pattern for dependency injection:
```typescript
// Good: Use service manager
const serviceState = getServiceState();
const optimizer = serviceState.optimizer;

// Bad: Direct instantiation
const optimizer = new Optimizer(/* deps */);
```

#### Settings-Driven Development
Always use user settings, never hardcode values:
```typescript
// Good: User-configurable
const minTemp = Number(this.homey.settings.get('comfort_lower_occupied'));
const maxTemp = Number(this.homey.settings.get('comfort_upper_occupied'));
const priceSource = this.homey.settings.get('price_source') || 'tibber';
const preheatCheapPercentile = Number(this.homey.settings.get('preheat_cheap_percentile')) || 0.25;

// Bad: Hardcoded values (FIXED!)
const minTemp = 20; // Don't do this! - Use getCurrentComfortBand() instead
const maxTemp = 23; // User can't configure this - Use getCurrentComfortBand() instead  
const threshold = 0.3; // Should be user-configurable!
```

#### Understanding "Hardcoded" vs Learned Parameters
Distinguish between true hardcoded values (bad) and learned parameters (acceptable):
```typescript
// Bad: Truly hardcoded assumption
const houseHeatLossCoeff = 2.5; // Every house is different!

// Good: Learned parameter with reasonable default
const houseHeatLossCoeff = this.thermalModel.getHeatLossCoefficient() || 2.5;

// Acceptable: Decision boundary on learned data
const isSignificantPriceChange = (priceRatio > 1.3); // Logic threshold, not house assumption

// FIXED: Temperature limits now use user-configurable comfort bands
const comfortBand = this.getCurrentComfortBand(); // Uses comfort_lower_occupied, etc.
const minTemp = comfortBand.minTemp; // ✅ Now user-configurable!
const maxTemp = comfortBand.maxTemp; // ✅ Now user-configurable!
```

#### Flow Card Registration
- **App Flow Cards**: Register in `src/app.ts`
- **Device Flow Cards**: Register in `drivers/boiler/driver.ts`

### Common Gotchas

1. **Mixed JS/TS**: Some files use `.js` extensions for compatibility
2. **Homey Platform Limits**: Strict memory limits, cron job idempotency required
3. **API Rate Limits**: All external APIs (MELCloud, Tibber, ENTSO-E) have rate limiting
4. **Timezone Handling**: Use `TimeZoneHelper` for all time operations
5. **Anti-Cycling**: Heat pumps need minimum time between setpoint changes
6. **Settings Priority**: NEVER hardcode values - always read from `homey.settings.get(key)`
7. **SDK Version**: Only use Homey SDK 3.0 methods and patterns
8. **User Configuration**: All behavior must be user-configurable through settings page
9. **Learning System**: Understand the difference between hardcoded assumptions (bad) and learned parameters operating through decision boundaries (acceptable)
10. **Thermal Awareness**: The system learns house-specific thermal characteristics - don't assume fixed heating/cooling rates

### Environment Setup
- **Development**: `env.json` (copy from `env.json.example`)
- **Integration Tests**: `test/config.json` (real API credentials)
- **VS Code**: Extensions for TypeScript, Homey development recommended

### File Structure Notes
- `src/`: TypeScript source code
- `drivers/`: Homey device drivers
- `.homeycompose/`: Build-time configuration (compiled to `app.json`)
- `assets/settings/`: Settings page assets
- `test/`: Unit and integration tests
- `documentation/`: Technical documentation and migration guides

## Quick Reference

### Key APIs
- **MELCloud**: Heat pump control and telemetry
- **Tibber**: Real-time electricity pricing (GraphQL)
- **ENTSO-E**: European day-ahead electricity prices (XML REST)

### Custom Capabilities
- `occupied`: Home/away status for optimization
- `holiday_mode`: Extended away mode
- `legionella_now`: Hot water sanitization trigger
- `heating_cop`: Heating coefficient of performance
- `hotwater_cop`: Hot water coefficient of performance

### Settings Categories
- **Quick Start**: MELCloud credentials and device selection
- **Temperature Control**: Comfort bands and constraints
- **Pricing**: Electricity price source configuration
- **Advanced**: Thermal modeling and COP parameters

This structure provides context for AI assistants while keeping specific implementation details accessible through the codebase exploration.
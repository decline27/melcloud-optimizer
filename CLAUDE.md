# MELCloud Heat Pump Optimizer

## Overview

The MELCloud Heat Pump Optimizer is a sophisticated Homey app that optimizes Mitsubishi Electric air-to-water heat pump units controlled through MELCloud. The system combines real-time electricity pricing, thermal modeling, and machine learning to reduce energy costs by 5-30% while maintaining comfort levels.

**Current Version**: 12.5.0  
**Target Platform**: Homey SDK 3.0  
**Languages**: TypeScript, Node.js (≥16.0.0)  
**License**: See LICENSE file

The application implements intelligent heating and hot water scheduling based on dynamic electricity prices from Tibber or ENTSO-E, real-time thermal modeling, and adaptive learning algorithms. It prevents harmful short-cycling while optimizing energy consumption during low-price periods.

## Architecture

### Core Components

#### 1. **Orchestration Layer** (`src/orchestration/`)
- **ServiceManager**: Coordinates all optimization services
- **CronScheduler**: Manages periodic optimization tasks
- **Memory Management**: Monitors and optimizes memory usage

#### 2. **Services Layer** (`src/services/`)
- **Optimizer**: Main optimization logic and decision engine
- **MELCloud API**: Interface with Mitsubishi Electric cloud services
- **Tibber API**: Electricity price data from Tibber
- **ENTSO-E Service**: European day-ahead electricity prices
- **Hot Water Service**: Domestic hot water optimization
- **Thermal Model**: Building thermal characteristics modeling
- **COP Helper**: Coefficient of Performance calculations

#### 3. **Optimization Engine** (`optimization/`)
- **Decision Engine**: Core optimization algorithms
- **Thermal Mass Modeling**: Strategic heating based on building characteristics
- **Price-aware Scheduling**: Time-shifted consumption optimization

#### 4. **Utilities** (`src/util/`)
- **Enhanced Savings Calculator**: Advanced savings computation with baseline comparison
- **Fixed Baseline Calculator**: Models non-optimized operation for comparison
- **Circuit Breaker**: Fault tolerance for external API calls
- **Timeline Helper**: Event logging and user notifications
- **Memory Management**: Advanced memory monitoring and optimization

## Setup & Installation

### Prerequisites
```bash
node --version  # ≥16.0.0 required
npm --version   # Latest recommended
```

### Installation Steps

1. **Clone and Install Dependencies**
```bash
git clone https://github.com/decline27/melcloud-optimizer.git
cd melcloud-optimizer
npm install
```

2. **Environment Configuration**
```bash
cp env.json.example env.json
# Edit env.json with your configuration
```

3. **Build the Application**
```bash
npm run build        # Full build (TypeScript + Homey)
npm run build:ts     # TypeScript only
npm run build:homey  # Homey packaging only
```

4. **Configure Price Provider**
Choose between Tibber (requires API token) or ENTSO-E (built-in European day-ahead prices):
- **Tibber**: Set `tibber_api_token` in Homey settings
- **ENTSO-E**: Configure `entsoe_area_eic` using the settings UI

5. **Set Up MELCloud Integration**
- Obtain MELCloud credentials
- Configure in Homey app settings
- Verify device connectivity

## Development Workflow

### Available Scripts

```bash
npm run start         # Run in development mode
npm run dev          # Run with debug output
npm run lint         # TypeScript type checking
npm run validate     # Homey app validation

# Testing
npm run test         # Run all tests
npm run test:unit    # Unit tests only
npm run test:watch   # Watch mode for development
npm run test:coverage # Generate coverage reports
npm run test:ci      # CI-compatible test run

# Simulation & Analysis
npm run simulate     # Run energy simulation with test data
npm run clean        # Clean build artifacts
```

### Development Environment

The project uses:
- **TypeScript 5.8+** for type safety
- **Jest 29.7+** for testing with ts-jest
- **Homey SDK 3.0** for Homey integration
- **ESLint** for code quality (optional)

### Testing Strategy

- **Unit Tests**: `/test/unit/` - Component-level testing
- **Integration Tests**: `/test/integration/` - End-to-end workflows
- **Simulation Tests**: Validate optimization algorithms with historical data
- **Coverage Target**: >80% for core optimization logic

## API Documentation

### Core Endpoints

#### `/api/optimizer/run`
Executes hourly optimization cycle
- **Method**: POST
- **Authentication**: Homey app context
- **Response**: Optimization results with savings calculation

#### `/api/savings/enhanced`
Calculate enhanced savings with baseline comparison
- **Method**: GET
- **Response**: Detailed savings breakdown including:
  - Real-time optimization savings
  - Baseline comparison savings
  - Total cost reduction
  - Confidence metrics

#### `/api/entsoe/prices`
Fetch ENTSO-E day-ahead electricity prices
- **Method**: GET
- **Parameters**: `zone`, `start`, `end`, `currency`
- **Response**: Hourly price array with metadata

#### `/api/device/status`
Get current heat pump status and telemetry
- **Method**: GET
- **Response**: Device state, temperature readings, energy consumption

### Flow Actions (Homey)

#### "Fetch ENTSO-E day-ahead prices"
Homey flow action that returns price data as JSON token
- **Input**: Price zone (country code or EIC)
- **Output**: Hourly prices array for flow logic

#### "Run optimization cycle"
Trigger immediate optimization run
- **Output**: Success/failure status and savings estimate

## Recent Updates (Updated: 2024-10-04)

### Major Features Added

#### 1. **ENTSO-E Integration** (v12.5.0)
- **Complete European price support**: Day-ahead electricity prices for all EU bidding zones
- **Standalone ENTSO-E client**: No external dependencies, built-in authentication
- **Advanced settings UI**: Interactive zone selection with country detection
- **Multi-currency support**: EUR, SEK with configurable exchange rates
- **Intelligent caching**: 6-hour cache for identical requests
- **New flow action**: "Fetch ENTSO-E day-ahead prices" for Homey flows

#### 2. **Enhanced Baseline Comparison System**
- **Fixed baseline calculator**: Models traditional thermostat operation without user configuration
- **Intelligent defaults**: European comfort standards (21°C heating, 60°C hot water)
- **Weather-aware modeling**: Accounts for outdoor temperature in baseline calculations
- **COP-adjusted estimates**: Realistic efficiency assumptions for non-optimized operation
- **Automatic pattern learning**: Discovers usage patterns for accurate comparison

#### 3. **Advanced Memory Management**
- **Memory monitoring**: Real-time memory usage tracking and alerts
- **Automatic cleanup**: Proactive garbage collection during low-activity periods
- **Memory leak detection**: Identifies and reports potential memory issues
- **Performance optimization**: Dynamic resource allocation based on system load

#### 4. **Comprehensive Timezone Handling**
- **Global timezone support**: Correct handling across all European timezones
- **DST transitions**: Automatic daylight saving time adjustments
- **Price data alignment**: Ensures price and optimization data temporal consistency
- **Timeline corrections**: Historical data properly timezone-adjusted

#### 5. **Hot Water System Improvements**
- **Pattern recognition**: Learns household hot water usage patterns
- **Demand prediction**: Forecasts hot water needs based on historical data
- **Legionella protection**: Maintains health-safe temperatures while optimizing costs
- **Integration with pricing**: Coordinates with electricity price optimization

### Configuration Enhancements

#### New Settings Structure
```json
{
  "price_provider": "entsoe|tibber",
  "entsoe_area_eic": "10Y1001A1001A44P",
  "entsoe_token": "optional-custom-token",
  "baseline_comparison_enabled": true,
  "memory_monitoring_enabled": true,
  "timezone_override": "Europe/Stockholm"
}
```

#### ENTSO-E Zone Configuration
The app includes comprehensive EIC (Energy Identification Code) mapping:
- **110+ supported zones**: All European bidding zones
- **Country detection**: Automatic locale-based zone suggestion  
- **Search functionality**: Find zones by country name or code
- **Visual interface**: Web-based settings with real-time preview

### Performance Improvements

- **Memory usage reduced by 40%**: Through advanced cleanup algorithms
- **API response time improved**: Caching and connection pooling
- **Price data reliability**: Fallback mechanisms and stale data handling
- **Thermal model accuracy**: Enhanced building characteristic learning

### Bug Fixes & Stability

- **MELCloud authentication recovery**: Automatic token refresh and error handling
- **Quarter-hour Tibber pricing**: Improved granularity for better optimization
- **Circuit breaker resilience**: Better handling of external API failures
- **Timezone consistency**: Fixed DST transition edge cases
- **Memory leak prevention**: Eliminated several potential memory issues

## File Structure

```
├── src/                           # Main source code
│   ├── app.ts                    # Main Homey app class
│   ├── api.ts                    # API endpoint handlers
│   ├── entsoe.ts                 # ENTSO-E price service
│   ├── services/                 # Business logic services
│   │   ├── optimizer.ts          # Core optimization engine
│   │   ├── melcloud-api.ts       # MELCloud integration
│   │   ├── tibber-api.ts         # Tibber price integration
│   │   ├── entsoe-price-service.ts # ENTSO-E price service
│   │   ├── hot-water/            # Hot water optimization
│   │   └── thermal-model.ts      # Building thermal modeling
│   ├── orchestration/            # Service coordination
│   │   └── service-manager.ts    # Main orchestrator
│   ├── util/                     # Utility functions
│   │   ├── enhanced-savings-calculator.ts # Advanced savings computation
│   │   ├── fixed-baseline-calculator.ts   # Baseline modeling
│   │   ├── memory.ts             # Memory management
│   │   ├── circuit-breaker.ts    # Fault tolerance
│   │   └── timeline-helper.ts    # Event logging
│   └── types/                    # TypeScript definitions
├── optimization/                 # Optimization algorithms
│   └── engine.ts                # Core decision engine
├── test/                        # Test suites
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── mocks/                   # Test data and mocks
├── assets/                      # Static assets
│   ├── settings/index.html      # ENTSO-E settings UI
│   └── entsoe_area_map.json     # EIC zone mappings
├── documentation/               # Technical documentation
├── scripts/                     # Utility scripts
│   └── generate_entsoe_area_map.py # Zone mapping generator
├── .homeycompose/              # Homey app configuration
│   ├── flow/actions/           # Flow card definitions
│   └── settings/               # App settings schemas
└── data/                       # Simulation and test data
```

### Key Configuration Files

- **`package.json`**: Dependencies, scripts, and metadata
- **`tsconfig.json`**: TypeScript compilation settings
- **`jest.config.js`**: Test configuration
- **`app.json`**: Homey app manifest (generated from .homeycompose/)
- **`env.json.example`**: Environment variable template
- **`entsoe_area_map.json`**: European electricity zone mappings

## Important Notes

### Development Considerations

1. **Memory Management**: The app implements advanced memory monitoring due to Homey's resource constraints. Monitor memory usage during development and use the built-in cleanup mechanisms.

2. **API Rate Limits**: 
   - ENTSO-E: 400 requests/minute per IP
   - Tibber: Rate limits per API token
   - MELCloud: Avoid excessive polling to prevent account lockout

3. **Timezone Handling**: Always use the TimeZoneHelper utility for date/time operations. Direct Date() usage can cause DST-related bugs.

4. **Error Handling**: All external API calls use CircuitBreaker pattern. Implement proper fallbacks for service unavailability.

5. **Testing**: Run full test suite before commits. Integration tests require actual API credentials (use test environment).

### Production Deployment

1. **Environment Variables**: Set production tokens in `env.json`
2. **Memory Monitoring**: Enable memory alerts for production instances
3. **Logging**: Configure appropriate log levels for production
4. **Backup Settings**: Implement user settings backup/restore capability

### Known Limitations

- **MELCloud API**: Subject to rate limiting and occasional outages
- **Price Data**: Dependent on external services (Tibber/ENTSO-E availability)
- **Thermal Modeling**: Requires learning period for accurate building characteristics
- **Memory Constraints**: Homey platform has limited memory resources

### Security Considerations

- **API Tokens**: Stored securely in Homey settings (encrypted)
- **External Communications**: All HTTPS with certificate validation
- **Data Privacy**: No personal data transmitted beyond required API calls
- **Local Processing**: All optimization calculations performed locally

---

**Repository**: https://github.com/decline27/melcloud-optimizer  
**Issues**: Report issues on GitHub Issues page  
**Documentation**: See `/documentation/` folder for detailed technical docs  
**Support**: Community support via GitHub Discussions
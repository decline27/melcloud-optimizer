# MELCloud Optimizer - Services Reference

> Technical reference for all extracted services in the MELCloud Heat Pump Optimizer.

**Last Updated:** December 4, 2025

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│              Optimizer                   │
│           (Orchestrator)                 │
└─────────────┬───────────────────────────┘
              │
    ┌─────────┼─────────┬────────────┐
    │         │         │            │
    ▼         ▼         ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Temp   │ │Savings │ │Calibra-│ │ Zone   │
│Optimi- │ │Service │ │tion    │ │Optimi- │
│zer     │ │        │ │Service │ │zer     │
└────────┘ └────────┘ └────────┘ └────────┘
    │
    ▼
┌────────┐
│  COP   │
│Normali-│
│zer     │
└────────┘
```

---

## Core Services

### Optimizer

**File:** [`src/services/optimizer.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/optimizer.ts)  
**Lines:** ~2,350

**Purpose:** Main orchestrator that coordinates all optimization components.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `runOptimization()` | Main hourly optimization cycle |
| `initialize()` | Async initialization (call after constructor) |
| `isInitialized()` | Check if ready for optimization |
| `cleanup()` | Resource cleanup on shutdown |

**Dependencies:**
- `PriceAnalyzer`, `ThermalController`, `MelCloudApi`, `WeatherApi`
- `TemperatureOptimizer`, `SavingsService`, `CalibrationService`
- `ZoneOptimizer`, `HotWaterOptimizer`, `CopNormalizer`

---

### CalibrationService

**File:** [`src/services/calibration-service.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/calibration-service.ts)  
**Lines:** ~270

**Purpose:** Weekly thermal model calibration and learning from optimization outcomes.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `runWeeklyCalibration()` | Update thermal model K/S factors |
| `learnFromOptimizationOutcome()` | Adaptive parameter learning |
| `cleanupOptimizationHistory()` | 30-day history cleanup |

**Dependencies:** `ThermalController`, `ThermalModelService`, `AdaptiveParametersLearner`

---

### SavingsService

**File:** [`src/services/savings-service.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/savings-service.ts)  
**Lines:** ~430

**Purpose:** All savings calculations (hourly, daily, baseline comparison).

**Key Methods:**
| Method | Description |
|--------|-------------|
| `calculateSavings()` | Simple temperature-based savings |
| `calculateRealHourlySavings()` | Savings using real energy metrics |
| `calculateEnhancedDailySavingsWithBaseline()` | Full baseline comparison |

**Dependencies:** `EnhancedSavingsCalculator`, `PriceAnalyzer`, `TimeZoneHelper`

---

### TemperatureOptimizer

**File:** [`src/services/temperature-optimizer.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/temperature-optimizer.ts)  
**Lines:** ~250

**Purpose:** Core temperature calculations with COP and seasonal adjustments.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `calculateOptimalTemperatureWithRealData()` | Full optimization with COP |
| `calculateOptimalTemperature()` | Basic price-based optimization |
| `applySeasonalAdjustments()` | Season-specific modifications |

**Dependencies:** `CopNormalizer`, `AdaptiveParametersLearner`, `COPHelper`

---

### CopNormalizer

**File:** [`src/services/cop-normalizer.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/cop-normalizer.ts)  
**Lines:** ~90

**Purpose:** Adaptive COP normalization with outlier guards.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `normalize()` | Normalize COP value to 0-1 range |
| `updateRange()` | Add new COP observation (with filtering) |
| `getRange()` | Get current min/max observed COP |

**Features:**
- Percentile-based filtering (5th-95th)
- Outlier rejection (0.5-6.0 valid range)
- State persistence to settings

---

### ThermalController

**File:** [`src/services/thermal-controller.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/thermal-controller.ts)  
**Lines:** ~210

**Purpose:** Thermal mass calculations and strategies.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `calculateThermalMassStrategy()` | Choose preheat/coast/maintain/boost |
| `setThermalModel()` | Update K/S factors |
| `getThermalModel()` | Get current thermal model |
| `calculatePreheatingValue()` | Savings from preheating |
| `calculateCoastingSavings()` | Savings from coasting |

**Dependencies:** `ThermalModelService`, `AdaptiveParametersLearner`

---

### PriceAnalyzer

**File:** [`src/services/price-analyzer.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/price-analyzer.ts)  
**Lines:** ~100

**Purpose:** Price data analysis and classification.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `getPriceLevel()` | Classify price (VERY_CHEAP to VERY_EXPENSIVE) |
| `getCurrentPrice()` | Get current electricity price |
| `getCheapPercentile()` | Get cheap threshold |
| `setThresholds()` | Update price thresholds |

---

### ZoneOptimizer

**File:** [`src/services/zone-optimizer.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/zone-optimizer.ts)  
**Lines:** ~170

**Purpose:** Zone 2 optimization coordinated with Zone 1.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `optimizeZone2()` | Calculate Zone 2 target based on Zone 1 |

---

### HotWaterOptimizer

**File:** [`src/services/hot-water-optimizer.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/hot-water-optimizer.ts)  
**Lines:** ~350

**Purpose:** Hot water tank scheduling optimization.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `optimizeHotWaterSchedulingByPattern()` | Pattern-based scheduling |
| `calculatePatternSavings()` | Savings from scheduling |

**Dependencies:** `HotWaterUsageLearner`, `PriceAnalyzer`

---

### AccountingService

**File:** [`src/services/accounting-service.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/accounting-service.ts)  
**Lines:** ~320

**Purpose:** Savings tracking and history.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `recordOptimization()` | Record optimization event |
| `getTodaysSavings()` | Current day savings |
| `getWeeklySavings()` | 7-day savings breakdown |
| `getSavingsHistory()` | Historical data |

---

## Support Services

### SettingsLoader

**File:** [`src/services/settings-loader.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/settings-loader.ts)

**Purpose:** Type-safe settings access with validation.

---

### ConstraintManager

**File:** [`src/services/constraint-manager.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/constraint-manager.ts)

**Purpose:** Apply temperature constraints (min/max, step, deadband, anti-cycling).

---

### StateManager

**File:** [`src/services/state-manager.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/state-manager.ts)

**Purpose:** Track zone states and last setpoint changes.

---

## External API Services

### MelCloudApi

**File:** [`src/services/melcloud-api.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/melcloud-api.ts)

**Purpose:** MELCloud device control and state retrieval.

---

### TibberApi

**File:** [`src/services/tibber-api.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/tibber-api.ts)

**Purpose:** Tibber GraphQL API for electricity prices.

---

### EntsoePriceService

**File:** [`src/services/entsoe-price-service.ts`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/entsoe-price-service.ts)

**Purpose:** ENTSO-E day-ahead prices with consumer markup.

---

## See Also

- [ARCHITECTURE.md](../ARCHITECTURE.md) - System overview
- [SETTINGS_REFERENCE.md](./SETTINGS_REFERENCE.md) - Configuration parameters
- [ALGORITHM_REFERENCE.md](./ALGORITHM_REFERENCE.md) - Optimization logic details

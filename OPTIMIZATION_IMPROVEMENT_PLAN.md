# Heat Pump Optimization Improvement Plan

## Executive Summary
This plan addresses critical issues in the current heat pump optimization algorithm and leverages the available MELCloud COP data to create a more effective and efficient optimization system.

## Current Issues Identified

### 🔴 Critical Issues
1. **Backwards COP Logic**: System increases temperature when COP is high (inefficient)
2. **Limited COP Range**: Normalization assumes COP 1-5, but modern heat pumps achieve COP >6
3. **No System-Level Optimization**: Heating and hot water compete without coordination
4. **Limited Thermal Mass Strategy**: Doesn't effectively use home's thermal storage capacity

### 🟡 Medium Priority Issues
1. **Hot Water Scheduling**: Only considers 24-hour window, no usage pattern learning
2. **Weather Integration**: Limited use of outdoor temperature for COP prediction
3. **Seasonal Transitions**: Abrupt switching between summer/winter modes

## Phase 1: Fix Critical COP Logic (Immediate - Week 1)

### 1.1 Correct COP Optimization Logic
**Current (WRONG):**
```typescript
const copAdjustment = (normalizedCOP - 0.5) * tempRange * this.copWeight;
targetTemp += copAdjustment; // Higher COP = Higher temperature ❌
```

**New (CORRECT):**
```typescript
// Use high COP periods for efficient operation at comfort temperatures
// Use low COP periods with reduced comfort expectations
const copEfficiencyFactor = Math.min(seasonalCOP / 3.0, 1.0); // Normalize to 0-1
const baseComfortTemp = midTemp;

if (copEfficiencyFactor > 0.8) {
  // Excellent COP: Maintain comfort at normal temps
  targetTemp = baseComfortTemp + priceAdjustment;
} else if (copEfficiencyFactor > 0.5) {
  // Good COP: Small comfort reduction during expensive periods
  targetTemp = baseComfortTemp + (priceAdjustment * 0.7) - 0.3;
} else {
  // Poor COP: Significant comfort reduction to save energy
  targetTemp = baseComfortTemp + (priceAdjustment * 0.5) - 0.8;
}
```

### 1.2 Implement Adaptive COP Range
```typescript
// Track observed COP range over time
interface COPRange {
  minObserved: number;
  maxObserved: number;
  updateCount: number;
}

private copRange: COPRange = { minObserved: 1, maxObserved: 5, updateCount: 0 };

private updateCOPRange(cop: number): void {
  if (cop > 0) {
    this.copRange.minObserved = Math.min(this.copRange.minObserved, cop);
    this.copRange.maxObserved = Math.max(this.copRange.maxObserved, cop);
    this.copRange.updateCount++;
  }
}

private normalizeCOP(cop: number): number {
  const range = this.copRange.maxObserved - this.copRange.minObserved;
  if (range <= 0) return 0.5;
  
  return Math.min(Math.max(
    (cop - this.copRange.minObserved) / range, 0
  ), 1);
}
```

### 1.3 Enhanced Seasonal Mode Detection
```typescript
private determineSeasonalMode(heatingConsumption: number, hotWaterConsumption: number, outdoorTemp: number): 'summer' | 'winter' | 'transition' {
  const month = new Date().getMonth(); // 0-11
  const isWinterMonth = month <= 2 || month >= 10; // Nov-Mar
  const isSummerMonth = month >= 5 && month <= 8; // Jun-Sep
  
  // Energy-based detection (more reliable than calendar)
  if (heatingConsumption < hotWaterConsumption * 0.3) {
    return 'summer';
  } else if (heatingConsumption > hotWaterConsumption * 2) {
    return 'winter';
  } else {
    // Consider outdoor temperature for transition
    if (outdoorTemp < 10 && isWinterMonth) return 'winter';
    if (outdoorTemp > 20 && isSummerMonth) return 'summer';
    return 'transition';
  }
}
```

## Phase 2: Enhanced COP Data Integration (Week 2)

### 2.1 Real-Time COP Prediction Model
```typescript
interface COPPredictionModel {
  heatingCOPByOutdoorTemp: Map<number, number>; // Temp -> COP
  hotWaterCOPHistory: number[];
  lastUpdated: Date;
}

private buildCOPPredictionModel(copData: any[]): COPPredictionModel {
  const model: COPPredictionModel = {
    heatingCOPByOutdoorTemp: new Map(),
    hotWaterCOPHistory: [],
    lastUpdated: new Date()
  };
  
  // Analyze COP vs outdoor temperature correlation
  copData.forEach(dataPoint => {
    if (dataPoint.outdoorTemp && dataPoint.heatingCOP) {
      const tempBucket = Math.round(dataPoint.outdoorTemp);
      const existingCOP = model.heatingCOPByOutdoorTemp.get(tempBucket);
      
      if (existingCOP) {
        // Average with existing data
        model.heatingCOPByOutdoorTemp.set(tempBucket, (existingCOP + dataPoint.heatingCOP) / 2);
      } else {
        model.heatingCOPByOutdoorTemp.set(tempBucket, dataPoint.heatingCOP);
      }
    }
    
    if (dataPoint.hotWaterCOP) {
      model.hotWaterCOPHistory.push(dataPoint.hotWaterCOP);
    }
  });
  
  return model;
}

private predictCOP(outdoorTemp: number, mode: 'heating' | 'hotwater'): number {
  if (mode === 'heating') {
    // Find closest temperature match
    const tempBucket = Math.round(outdoorTemp);
    let bestMatch = this.copPredictionModel.heatingCOPByOutdoorTemp.get(tempBucket);
    
    if (!bestMatch) {
      // Find nearest temperature
      let minDiff = Infinity;
      for (const [temp, cop] of this.copPredictionModel.heatingCOPByOutdoorTemp) {
        const diff = Math.abs(temp - tempBucket);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = cop;
        }
      }
    }
    
    return bestMatch || 2.5; // Default fallback
  } else {
    // Hot water COP is less temperature dependent
    const history = this.copPredictionModel.hotWaterCOPHistory;
    if (history.length > 0) {
      return history.slice(-10).reduce((sum, cop) => sum + cop, 0) / Math.min(history.length, 10);
    }
    return 3.0; // Default fallback
  }
}
```

### 2.2 System-Level Optimization
```typescript
interface SystemOptimization {
  heatingTarget: number;
  hotWaterAction: 'heat_now' | 'delay' | 'maintain';
  reasoning: string;
  conflictResolution?: string;
}

private optimizeSystemLevel(
  currentPrice: number,
  priceData: any,
  outdoorTemp: number,
  heatingCOP: number,
  hotWaterCOP: number
): SystemOptimization {
  
  // Check for system conflicts
  const isHeatingDemand = outdoorTemp < 15;
  const isHotWaterDemand = this.needsHotWater(); // Implement based on usage patterns
  
  if (isHeatingDemand && isHotWaterDemand) {
    // Conflict: Both heating and hot water needed
    
    if (heatingCOP > hotWaterCOP + 0.5) {
      // Heating is much more efficient
      return {
        heatingTarget: this.calculateOptimalHeatingTemp(currentPrice, heatingCOP, outdoorTemp),
        hotWaterAction: 'delay',
        reasoning: 'Prioritizing heating due to higher COP',
        conflictResolution: `Heating COP ${heatingCOP.toFixed(2)} > Hot Water COP ${hotWaterCOP.toFixed(2)}`
      };
    } else if (hotWaterCOP > heatingCOP + 0.5) {
      // Hot water is much more efficient
      return {
        heatingTarget: this.minTemp + 0.5, // Minimal heating
        hotWaterAction: 'heat_now',
        reasoning: 'Prioritizing hot water due to higher COP',
        conflictResolution: `Hot Water COP ${hotWaterCOP.toFixed(2)} > Heating COP ${heatingCOP.toFixed(2)}`
      };
    } else {
      // Similar efficiency: Use price strategy
      const cheapPeriod = this.isInCheapPeriod(currentPrice, priceData);
      
      if (cheapPeriod) {
        return {
          heatingTarget: this.calculateOptimalHeatingTemp(currentPrice, heatingCOP, outdoorTemp),
          hotWaterAction: 'heat_now',
          reasoning: 'Cheap electricity: Running both systems',
          conflictResolution: 'Low prices override COP differences'
        };
      } else {
        // Expensive period: Prioritize essential heating
        return {
          heatingTarget: this.minTemp + 1.0,
          hotWaterAction: 'delay',
          reasoning: 'Expensive electricity: Essential heating only',
          conflictResolution: 'High prices require conservation'
        };
      }
    }
  }
  
  // No conflict: Optimize independently
  return {
    heatingTarget: this.calculateOptimalHeatingTemp(currentPrice, heatingCOP, outdoorTemp),
    hotWaterAction: this.optimizeHotWater(currentPrice, priceData, hotWaterCOP),
    reasoning: 'Independent optimization: No system conflicts'
  };
}
```

## Phase 3: Thermal Mass Optimization (Week 3)

### 3.1 Enhanced Thermal Model
```typescript
interface ThermalMassModel {
  thermalCapacity: number;      // kWh/°C - How much energy to heat 1°C
  heatLossRate: number;         // °C/hour - Temperature loss rate
  maxPreheatingTemp: number;    // Maximum safe preheat temperature
  preheatingEfficiency: number; // Efficiency of preheat strategy
}

private calculateThermalMassStrategy(
  currentTemp: number,
  targetTemp: number,
  currentPrice: number,
  futurePrices: any[],
  copData: any
): ThermalStrategy {
  
  const cheap24h = futurePrices
    .slice(0, 24)
    .sort((a, b) => a.price - b.price)
    .slice(0, 6); // 6 cheapest hours
  
  const currentPricePercentile = futurePrices
    .filter(p => p.price <= currentPrice).length / futurePrices.length;
  
  if (currentPricePercentile <= 0.3 && copData.current > 2.5) {
    // Very cheap + good COP: Aggressive preheating
    const preheatingTarget = Math.min(
      targetTemp + 2.0,
      this.thermalMassModel.maxPreheatingTemp
    );
    
    return {
      action: 'preheat',
      targetTemp: preheatingTarget,
      reasoning: `Preheating to ${preheatingTarget}°C during cheap period (COP: ${copData.current.toFixed(2)})`,
      estimatedSavings: this.calculatePreheatingValue(preheatingTarget, cheap24h, copData)
    };
  } else if (currentPricePercentile >= 0.7) {
    // Expensive period: Use stored thermal energy
    const minComfortTemp = Math.max(targetTemp - 1.5, this.minTemp);
    
    return {
      action: 'coast',
      targetTemp: minComfortTemp,
      reasoning: `Using thermal mass during expensive period`,
      estimatedSavings: this.calculateCoastingSavings(currentPrice, copData)
    };
  }
  
  return {
    action: 'maintain',
    targetTemp: targetTemp,
    reasoning: 'Normal operation'
  };
}
```

### 3.2 Predictive Hot Water Scheduling
```typescript
interface HotWaterUsagePattern {
  hourlyDemand: number[];      // 24-hour demand pattern
  peakHours: number[];         // Hours with high demand
  minimumBuffer: number;       // Minimum hot water to maintain
  lastLearningUpdate: Date;
}

private learnHotWaterUsage(usageHistory: any[]): HotWaterUsagePattern {
  const hourlyDemand = new Array(24).fill(0);
  const hourlyCount = new Array(24).fill(0);
  
  usageHistory.forEach(usage => {
    const hour = new Date(usage.timestamp).getHours();
    hourlyDemand[hour] += usage.amount;
    hourlyCount[hour]++;
  });
  
  // Calculate average demand per hour
  for (let i = 0; i < 24; i++) {
    if (hourlyCount[i] > 0) {
      hourlyDemand[i] = hourlyDemand[i] / hourlyCount[i];
    }
  }
  
  // Identify peak hours (above 80th percentile)
  const sortedDemand = [...hourlyDemand].sort((a, b) => b - a);
  const peakThreshold = sortedDemand[Math.floor(sortedDemand.length * 0.2)];
  const peakHours = hourlyDemand
    .map((demand, hour) => ({ demand, hour }))
    .filter(h => h.demand >= peakThreshold)
    .map(h => h.hour);
  
  return {
    hourlyDemand,
    peakHours,
    minimumBuffer: Math.max(...hourlyDemand) * 1.2, // 20% safety margin
    lastLearningUpdate: new Date()
  };
}

private optimizeHotWaterScheduling(
  currentHour: number,
  priceData: any[],
  hotWaterCOP: number,
  usagePattern: HotWaterUsagePattern
): HotWaterSchedule {
  
  const next24h = priceData.slice(0, 24);
  
  // Find required heating times before peak demand
  const schedulePoints: SchedulePoint[] = [];
  
  usagePattern.peakHours.forEach(peakHour => {
    // Calculate when to start heating for this peak
    const heatingDuration = 2; // Hours needed to heat water
    const startHour = (peakHour - heatingDuration + 24) % 24;
    
    // Find cheapest price in the valid heating window
    const validHours = this.getValidHeatingHours(startHour, peakHour, currentHour);
    const cheapestHour = validHours.reduce((min, hour) => 
      next24h[hour].price < next24h[min].price ? hour : min
    );
    
    schedulePoints.push({
      hour: cheapestHour,
      reason: `Prepare for peak demand at ${peakHour}:00`,
      priority: usagePattern.hourlyDemand[peakHour],
      cop: hotWaterCOP
    });
  });
  
  return {
    schedulePoints: schedulePoints.sort((a, b) => b.priority - a.priority),
    currentAction: this.determineCurrentAction(currentHour, schedulePoints, hotWaterCOP),
    reasoning: `Predictive scheduling based on usage pattern (peaks: ${usagePattern.peakHours.join(', ')}h)`
  };
}
```

## Phase 4: API Integration Enhancement (Week 4)

### 4.1 Enhanced MELCloud COP Data Usage
```typescript
// Add to melcloud-api.ts
public async getEnhancedCOPData(deviceId: string, buildingId: number): Promise<EnhancedCOPData> {
  try {
    // Get both daily COP data and current device state
    const [copData, deviceState, energyTotals] = await Promise.all([
      this.getCOPData(deviceId, buildingId),
      this.getDeviceState(deviceId, buildingId),
      this.getDailyEnergyTotals(deviceId, buildingId)
    ]);
    
    // Calculate real-time COP if possible
    const currentHeatingCOP = this.calculateCurrentCOP(
      deviceState,
      'heating'
    );
    
    const currentHotWaterCOP = this.calculateCurrentCOP(
      deviceState,
      'hotwater'
    );
    
    return {
      current: {
        heating: currentHeatingCOP,
        hotWater: currentHotWaterCOP,
        outdoor: deviceState.OutdoorTemperature,
        timestamp: new Date()
      },
      daily: energyTotals,
      historical: copData,
      trends: this.analyzeCOPTrends(copData),
      predictions: this.predictNextHourCOP(copData, deviceState.OutdoorTemperature)
    };
  } catch (error) {
    this.logger.error('Error getting enhanced COP data:', error);
    throw error;
  }
}

private calculateCurrentCOP(deviceState: any, mode: 'heating' | 'hotwater'): number {
  // Use instantaneous power readings if available
  if (mode === 'heating') {
    const powerConsumed = deviceState.CurrentHeatingPowerConsumption || 0;
    const powerProduced = deviceState.CurrentHeatingPowerProduction || 0;
    
    if (powerConsumed > 0) {
      return powerProduced / powerConsumed;
    }
  } else {
    const powerConsumed = deviceState.CurrentHotWaterPowerConsumption || 0;
    const powerProduced = deviceState.CurrentHotWaterPowerProduction || 0;
    
    if (powerConsumed > 0) {
      return powerProduced / powerConsumed;
    }
  }
  
  // Fallback to daily averages
  return this.calculateDailyCOP(deviceState, mode);
}
```

### 4.2 Updated Optimizer Integration
```typescript
// Update optimizer.ts to use enhanced COP data
private async getEnhancedCOPMetrics(): Promise<EnhancedCOPMetrics> {
  try {
    const copData = await this.melCloud.getEnhancedCOPData(this.deviceId, this.buildingId);
    
    // Update our COP range tracking
    this.updateCOPRange(copData.current.heating);
    this.updateCOPRange(copData.current.hotWater);
    
    // Update prediction model
    this.updateCOPPredictionModel(copData);
    
    return {
      current: copData.current,
      predicted: copData.predictions,
      efficiency: {
        heating: this.normalizeCOP(copData.current.heating),
        hotWater: this.normalizeCOP(copData.current.hotWater)
      },
      trends: copData.trends,
      recommendations: this.generateCOPRecommendations(copData)
    };
  } catch (error) {
    this.logger.error('Error getting enhanced COP metrics:', error);
    return this.getDefaultCOPMetrics();
  }
}
```

## Implementation Priority

### Week 1 (Critical Fixes)
- [ ] Fix backwards COP logic
- [ ] Implement adaptive COP range
- [ ] Enhanced seasonal mode detection
- [ ] Basic system conflict detection

### Week 2 (COP Enhancement)  
- [ ] COP prediction model
- [ ] System-level optimization
- [ ] Enhanced MELCloud COP integration
- [ ] Real-time COP calculation

### Week 3 (Thermal Mass)
- [ ] Thermal mass modeling
- [ ] Preheating strategy
- [ ] Hot water usage pattern learning
- [ ] Predictive scheduling

### Week 4 (Integration & Testing)
- [ ] Complete API integration
- [ ] Performance monitoring
- [ ] Energy savings validation
- [ ] User interface updates

## Expected Improvements

### Efficiency Gains
- **15-25%** improvement in COP utilization
- **10-20%** reduction in energy consumption
- **20-30%** better thermal mass utilization
- **5-15%** cost savings through better scheduling

### System Intelligence
- Real-time COP-based optimization
- Predictive hot water scheduling
- Conflict-aware system coordination
- Adaptive learning from usage patterns

## Success Metrics

1. **COP Utilization**: Average daily COP should increase by 10-20%
2. **Energy Efficiency**: kWh per degree-hour should decrease by 15%
3. **Cost Optimization**: Energy costs during expensive periods should decrease by 20%
4. **User Comfort**: Temperature variance should remain within ±0.5°C of target
5. **System Reliability**: Optimization success rate >95%

## Risks & Mitigation

### Technical Risks
- **COP data availability**: Implement fallbacks to historical averages
- **API changes**: Version control and backward compatibility
- **Performance impact**: Implement caching and async processing

### User Experience Risks  
- **Comfort changes**: Gradual optimization rollout with user controls
- **Complexity**: Maintain simple user interface despite complex backend
- **Learning period**: Set expectations for 2-4 week optimization learning

This plan transforms the current optimization from a simple price-responsive system to an intelligent, COP-aware, thermal-mass-utilizing optimization engine that should deliver significant improvements in both efficiency and cost savings.

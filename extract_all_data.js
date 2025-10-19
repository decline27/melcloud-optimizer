#!/usr/bin/env node

const fs = require('fs');

// Read the data dump file
const filePath = '/Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/API_MIGRATION_TEMPERATURE_FIX.md';
const rawData = fs.readFileSync(filePath, 'utf8');

try {
  // Parse the JSON data
  const data = JSON.parse(rawData);
  
  // Extract all optimization decisions
  const optimizations = data.thermalModelData.rawData.optimizations || [];
  
  console.log(`Found ${optimizations.length} optimization decisions`);
  
  // Process all optimization data
  const processedData = {
    metadata: {
      totalDecisions: optimizations.length,
      timeRange: {
        start: optimizations.length > 0 ? optimizations[0].timestamp : null,
        end: optimizations.length > 0 ? optimizations[optimizations.length - 1].timestamp : null
      },
      dataSizeKB: data.metadata.dataSizeKB,
      timezone: data.configuration.time_zone_name
    },
    
    allOptimizationDecisions: optimizations.map((opt, index) => ({
      index: index,
      timestamp: opt.timestamp,
      date: opt.timestamp.split('T')[0],
      hour: parseInt(opt.timestamp.split('T')[1].split(':')[0]),
      action: opt.action,
      reason: opt.reason,
      targetTemp: opt.targetTemp,
      targetOriginal: opt.targetOriginal,
      indoorTemp: opt.indoorTemp,
      outdoorTemp: opt.outdoorTemp,
      priceNow: opt.priceNow,
      priceLevel: opt.priceData?.level,
      pricePercentile: opt.priceData?.percentile,
      priceMin: opt.priceData?.min,
      priceMax: opt.priceData?.max,
      priceAverage: opt.priceData?.average,
      savings: opt.savings,
      comfort: opt.comfort,
      weatherTemp: opt.weather?.current?.temperature,
      weatherSymbol: opt.weather?.current?.symbol,
      weatherAdjustment: opt.weather?.adjustment?.adjustment,
      hotWaterFromTemp: opt.tankData?.fromTemp,
      hotWaterToTemp: opt.tankData?.toTemp,
      hotWaterChanged: opt.tankData?.changed,
      hotWaterReason: opt.tankData?.reason
    })),
    
    // Extract hot water data
    hotWaterData: data.hotWaterData,
    
    // Extract adaptive parameters
    adaptiveParameters: data.adaptiveParameters,
    
    // Extract thermal characteristics
    thermalCharacteristics: data.thermalModelData.rawData.lastCalibration?.thermalCharacteristics,
    
    // Extract aggregated patterns
    aggregatedData: data.thermalModelData.aggregatedData,
    
    // System configuration
    systemConfig: {
      priceSource: data.configuration.price_data_source,
      comfortRange: {
        lower: data.configuration.comfort_lower_away,
        upper: data.configuration.comfort_upper_away
      },
      cheapPercentile: data.configuration.preheat_cheap_percentile,
      timezone: data.configuration.time_zone_name
    }
  };
  
  // Calculate some analytics
  const analytics = {
    actionTypes: {},
    priceLevels: {},
    savingsStats: {
      total: 0,
      positive: 0,
      negative: 0,
      count: 0
    },
    temperatureStats: {
      targetMin: Math.min(...optimizations.map(o => o.targetTemp).filter(t => t)),
      targetMax: Math.max(...optimizations.map(o => o.targetTemp).filter(t => t)),
      indoorMin: Math.min(...optimizations.map(o => o.indoorTemp).filter(t => t)),
      indoorMax: Math.max(...optimizations.map(o => o.indoorTemp).filter(t => t)),
      outdoorMin: Math.min(...optimizations.map(o => o.outdoorTemp).filter(t => t)),
      outdoorMax: Math.max(...optimizations.map(o => o.outdoorTemp).filter(t => t))
    },
    priceStats: {
      min: Math.min(...optimizations.map(o => o.priceNow).filter(p => p)),
      max: Math.max(...optimizations.map(o => o.priceNow).filter(p => p)),
      average: optimizations.reduce((sum, o) => sum + (o.priceNow || 0), 0) / optimizations.length
    }
  };
  
  // Count action types
  optimizations.forEach(opt => {
    analytics.actionTypes[opt.action] = (analytics.actionTypes[opt.action] || 0) + 1;
    if (opt.priceData?.level) {
      analytics.priceLevels[opt.priceData.level] = (analytics.priceLevels[opt.priceData.level] || 0) + 1;
    }
    if (opt.savings !== null && opt.savings !== undefined) {
      analytics.savingsStats.total += opt.savings;
      analytics.savingsStats.count++;
      if (opt.savings > 0) analytics.savingsStats.positive++;
      if (opt.savings < 0) analytics.savingsStats.negative++;
    }
  });
  
  processedData.analytics = analytics;
  
  // Write the complete processed data
  fs.writeFileSync(
    '/Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/complete_data_for_visualization.json',
    JSON.stringify(processedData, null, 2)
  );
  
  console.log('Analytics:');
  console.log(`- Total decisions: ${analytics.actionTypes.temperature_adjusted + analytics.actionTypes.no_change || 0}`);
  console.log(`- Action types:`, analytics.actionTypes);
  console.log(`- Price levels:`, analytics.priceLevels);
  console.log(`- Temperature range: ${analytics.temperatureStats.targetMin}°C - ${analytics.temperatureStats.targetMax}°C`);
  console.log(`- Price range: ${analytics.priceStats.min.toFixed(4)} - ${analytics.priceStats.max.toFixed(4)} SEK/kWh`);
  console.log(`- Total savings: ${analytics.savingsStats.total.toFixed(4)} SEK`);
  console.log('Complete data written to complete_data_for_visualization.json');
  
} catch (error) {
  console.error('Error processing data:', error.message);
}
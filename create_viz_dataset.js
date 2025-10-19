#!/usr/bin/env node

const fs = require('fs');

// Read the complete processed data
const completeData = JSON.parse(fs.readFileSync('/Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/complete_data_for_visualization.json', 'utf8'));

// Create streamlined visualization dataset
const visualizationData = {
  summary: {
    totalDecisions: completeData.metadata.totalDecisions,
    timeRange: completeData.metadata.timeRange,
    analytics: completeData.analytics
  },
  
  // All optimization decisions in a clean format
  timeSeries: completeData.allOptimizationDecisions.map(decision => ({
    timestamp: decision.timestamp,
    date: decision.date,
    hour: decision.hour,
    
    // Temperature data
    targetTemp: decision.targetTemp,
    indoorTemp: decision.indoorTemp,
    outdoorTemp: decision.outdoorTemp,
    
    // Price data
    price: decision.priceNow,
    priceLevel: decision.priceLevel,
    pricePercentile: decision.pricePercentile,
    
    // Optimization results
    action: decision.action,
    savings: decision.savings,
    
    // Hot water data
    hotWaterFrom: decision.hotWaterFromTemp,
    hotWaterTo: decision.hotWaterToTemp,
    hotWaterChanged: decision.hotWaterChanged,
    
    // Weather
    weatherTemp: decision.weatherTemp,
    weatherSymbol: decision.weatherSymbol
  })),
  
  // Daily aggregations for easier charting
  dailyAggregations: {},
  
  // Hourly patterns
  hourlyPatterns: {},
  
  // Hot water patterns from the full dataset
  hotWaterPatterns: completeData.hotWaterData?.patterns ? JSON.parse(completeData.hotWaterData.patterns) : null,
  
  // Adaptive learning parameters
  adaptiveParams: completeData.adaptiveParameters?.parameters ? JSON.parse(completeData.adaptiveParameters.parameters) : null,
  
  // Visualization recommendations
  chartRecommendations: [
    {
      type: "line",
      title: "Price and Temperature Over Time",
      data: "timeSeries",
      x: "timestamp",
      y: ["price", "targetTemp", "outdoorTemp"],
      colorBy: "priceLevel"
    },
    {
      type: "scatter",
      title: "Savings vs Price Level",
      data: "timeSeries", 
      x: "price",
      y: "savings",
      colorBy: "action"
    },
    {
      type: "bar",
      title: "Action Types by Price Level",
      data: "aggregated",
      description: "Count of temperature_adjusted vs no_change by price level"
    },
    {
      type: "heatmap",
      title: "Hot Water Optimization by Hour/Day",
      data: "hotWaterPatterns.hourlyByDayUsagePattern",
      description: "Shows learned usage patterns"
    },
    {
      type: "timeline",
      title: "Temperature Adjustments Timeline",
      data: "timeSeries filtered by action = temperature_adjusted",
      showEvents: ["targetTemp changes", "priceLevel", "savings"]
    }
  ]
};

// Calculate daily aggregations
const dailyGroups = {};
completeData.allOptimizationDecisions.forEach(decision => {
  const date = decision.date;
  if (!dailyGroups[date]) {
    dailyGroups[date] = {
      date: date,
      decisions: [],
      tempAdjustments: 0,
      totalSavings: 0,
      avgPrice: 0,
      minPrice: Infinity,
      maxPrice: -Infinity,
      avgTargetTemp: 0,
      hotWaterChanges: 0
    };
  }
  
  const day = dailyGroups[date];
  day.decisions.push(decision);
  
  if (decision.action === 'temperature_adjusted') day.tempAdjustments++;
  if (decision.savings) day.totalSavings += decision.savings;
  if (decision.priceNow) {
    day.avgPrice += decision.priceNow;
    day.minPrice = Math.min(day.minPrice, decision.priceNow);
    day.maxPrice = Math.max(day.maxPrice, decision.priceNow);
  }
  if (decision.targetTemp) day.avgTargetTemp += decision.targetTemp;
  if (decision.hotWaterChanged) day.hotWaterChanges++;
});

// Finalize daily aggregations
Object.keys(dailyGroups).forEach(date => {
  const day = dailyGroups[date];
  const count = day.decisions.length;
  day.avgPrice = count > 0 ? day.avgPrice / count : 0;
  day.avgTargetTemp = count > 0 ? day.avgTargetTemp / count : 0;
  if (day.minPrice === Infinity) day.minPrice = 0;
});

visualizationData.dailyAggregations = Object.values(dailyGroups);

// Calculate hourly patterns
const hourlyGroups = {};
for (let hour = 0; hour < 24; hour++) {
  hourlyGroups[hour] = {
    hour: hour,
    decisions: [],
    avgPrice: 0,
    avgTargetTemp: 0,
    tempAdjustments: 0,
    totalSavings: 0
  };
}

completeData.allOptimizationDecisions.forEach(decision => {
  const hour = decision.hour;
  const hourGroup = hourlyGroups[hour];
  hourGroup.decisions.push(decision);
  
  if (decision.action === 'temperature_adjusted') hourGroup.tempAdjustments++;
  if (decision.savings) hourGroup.totalSavings += decision.savings;
  if (decision.priceNow) hourGroup.avgPrice += decision.priceNow;
  if (decision.targetTemp) hourGroup.avgTargetTemp += decision.targetTemp;
});

// Finalize hourly patterns
Object.keys(hourlyGroups).forEach(hour => {
  const hourGroup = hourlyGroups[hour];
  const count = hourGroup.decisions.length;
  hourGroup.avgPrice = count > 0 ? hourGroup.avgPrice / count : 0;
  hourGroup.avgTargetTemp = count > 0 ? hourGroup.avgTargetTemp / count : 0;
});

visualizationData.hourlyPatterns = Object.values(hourlyGroups);

// Write the visualization-ready data
fs.writeFileSync(
  '/Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/all_data_for_visualization.json',
  JSON.stringify(visualizationData, null, 2)
);

console.log('Visualization dataset created with:');
console.log(`- ${visualizationData.timeSeries.length} time-series data points`);
console.log(`- ${visualizationData.dailyAggregations.length} daily aggregations`);
console.log(`- 24 hourly pattern aggregations`);
console.log(`- ${visualizationData.chartRecommendations.length} chart recommendations`);
console.log('Written to: all_data_for_visualization.json');
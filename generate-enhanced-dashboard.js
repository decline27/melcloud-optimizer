#!/usr/bin/env node

/**
 * MELCloud Enhanced Manual Data Import & Dashboard Generator
 * 
 * Comprehensive dashboard with all available data points:
 * - Price analysis and correlation
 * - Hot water optimization tracking
 * - Weather impact analysis
 * - Hourly and seasonal patterns
 * - Comfort analysis
 * - Energy efficiency metrics
 * - Advanced analytics and insights
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

// Configuration
const CONFIG = {
    serverPort: 8080,
    outputDir: './dashboard-output',
    dataFile: 'melcloud-data.json',
    dashboardFile: 'enhanced-dashboard.html',
    historicalDataFile: 'melcloud-historical-data.json',
    backupDir: './dashboard-output/backups',
    maxBackups: 30,
    dataRetentionDays: 365,
    deduplicationWindowHours: 2
};

class MELCloudEnhancedDashboard {
    constructor() {
        this.outputPath = path.resolve(CONFIG.outputDir);
        this.backupPath = path.resolve(CONFIG.backupDir);
        this.dataPath = path.join(this.outputPath, CONFIG.dataFile);
        this.historicalPath = path.join(this.outputPath, CONFIG.historicalDataFile);
        this.dashboardPath = path.join(this.outputPath, CONFIG.dashboardFile);
        this.currentDate = new Date().toISOString().split('T')[0];
    }

    async run() {
        console.log('🚀 MELCloud Enhanced Manual Dashboard Generator');
        console.log('=' .repeat(55));
        
        try {
            await this.setupDirectories();
            console.log('📚 Loading existing historical data...');
            const historicalData = await this.loadHistoricalData();
            
            console.log('📄 Loading new data...');
            const newRawData = await this.loadNewData();
            
            if (!newRawData) {
                console.log('❌ No new data provided. Usage examples:');
                console.log('  node generate-enhanced-dashboard.js data.json');
                console.log('  node generate-enhanced-dashboard.js < clipboard.json');
                return;
            }
            
            console.log('🔄 Processing new data...');
            const newProcessedData = await this.processData(newRawData);
            
            if (!newProcessedData) {
                console.log('❌ No valid optimization data found in input');
                return;
            }
            
            console.log('🔗 Merging with historical data...');
            const mergedData = await this.mergeHistoricalData(historicalData, newProcessedData);
            
            console.log('🧹 Applying data retention...');
            const cleanedData = await this.applyDataRetention(mergedData);
            
            console.log('💾 Creating backup...');
            await this.createBackup(cleanedData);
            
            console.log('💾 Saving updated historical data...');
            await this.saveHistoricalData(cleanedData);
            
            console.log('📊 Generating enhanced dashboard...');
            await this.generateEnhancedDashboard(cleanedData);
            
            console.log('🌐 Starting dashboard server...');
            await this.startServer();
            
            console.log('✅ Enhanced dashboard generated successfully!');
            this.printSummary(cleanedData);
            
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    }

    async setupDirectories() {
        [this.outputPath, this.backupPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
        });
    }

    async loadNewData() {
        const inputFile = process.argv[2];
        
        if (inputFile) {
            if (!fs.existsSync(inputFile)) {
                throw new Error(`Input file not found: ${inputFile}`);
            }
            console.log(`📄 Reading data from file: ${inputFile}`);
            const content = fs.readFileSync(inputFile, 'utf8');
            return JSON.parse(content);
        } else {
            console.log('📄 Waiting for data from stdin...');
            return new Promise((resolve, reject) => {
                let input = '';
                process.stdin.setEncoding('utf8');
                
                process.stdin.on('readable', () => {
                    const chunk = process.stdin.read();
                    if (chunk !== null) {
                        input += chunk;
                    }
                });
                
                process.stdin.on('end', () => {
                    if (input.trim()) {
                        try {
                            resolve(JSON.parse(input));
                        } catch (error) {
                            reject(new Error(`Invalid JSON input: ${error.message}`));
                        }
                    } else {
                        resolve(null);
                    }
                });
                
                setTimeout(() => resolve(null), 30000);
            });
        }
    }

    async loadHistoricalData() {
        if (!fs.existsSync(this.historicalPath)) {
            console.log('📝 No existing historical data found. Starting fresh.');
            return this.getEmptyHistoricalData();
        }

        try {
            const data = JSON.parse(fs.readFileSync(this.historicalPath, 'utf8'));
            console.log(`📚 Loaded historical data: ${data.timeSeries.length} decisions over ${data.metadata.dataCollectionDays} days`);
            return data;
        } catch (error) {
            console.log('⚠️  Error loading historical data, starting fresh:', error.message);
            return this.getEmptyHistoricalData();
        }
    }

    getEmptyHistoricalData() {
        return {
            metadata: {
                firstDataPoint: null,
                lastDataPoint: null,
                totalDecisions: 0,
                dataCollectionDays: 0,
                lastUpdated: new Date().toISOString(),
                importSessions: 0
            },
            timeSeries: [],
            dailyAggregations: [],
            monthlyAggregations: [],
            hourlyPatterns: [],
            priceAnalysis: {},
            weatherAnalysis: {},
            hotWaterAnalysis: {},
            comfortAnalysis: {},
            seasonalAnalysis: {},
            analytics: {},
            systemConfig: {}
        };
    }

    async processData(rawData) {
        // Look for optimization data in various locations
        let optimizations = null;
        
        if (rawData.thermalModelData?.rawData?.optimizations) {
            optimizations = rawData.thermalModelData.rawData.optimizations;
        } else if (rawData.optimizations) {
            optimizations = rawData.optimizations;
        } else if (rawData.timeSeries) {
            optimizations = rawData.timeSeries;
        } else if (rawData.decisions) {
            optimizations = rawData.decisions;
        } else {
            // Look for arrays that might contain optimization data
            Object.keys(rawData).forEach(key => {
                const value = rawData[key];
                if (Array.isArray(value) && value.length > 0) {
                    const firstItem = value[0];
                    if (firstItem && typeof firstItem === 'object' && 
                        (firstItem.timestamp || firstItem.action || firstItem.targetTemp)) {
                        optimizations = value;
                        console.log(`🔍 Found optimization data in ${key}: ${optimizations.length} decisions`);
                    }
                }
            });
        }
        
        if (!optimizations || !Array.isArray(optimizations) || optimizations.length === 0) {
            console.log('❌ No optimization data found');
            console.log('🔍 Available keys:', Object.keys(rawData));
            return null;
        }

        console.log(`🔄 Processing ${optimizations.length} optimization decisions`);
        
        // Enhanced data processing with all available fields
        const processedData = {
            metadata: {
                totalDecisions: optimizations.length,
                timeRange: {
                    start: optimizations.length > 0 ? optimizations[0].timestamp : null,
                    end: optimizations.length > 0 ? optimizations[optimizations.length - 1].timestamp : null
                },
                timezone: rawData.configuration?.time_zone_name || 'Unknown',
                importedAt: new Date().toISOString(),
                dataSource: 'manual_import'
            },
            
            systemConfig: {
                priceSource: rawData.configuration?.price_data_source,
                comfortRange: {
                    lower: rawData.configuration?.comfort_lower_away,
                    upper: rawData.configuration?.comfort_upper_away
                },
                cheapPercentile: rawData.configuration?.preheat_cheap_percentile,
                timezone: rawData.configuration?.time_zone_name
            },
            
            timeSeries: optimizations.map((opt, index) => ({
                id: `${opt.timestamp}_${index}`,
                timestamp: opt.timestamp,
                date: opt.timestamp.split('T')[0],
                hour: parseInt(opt.timestamp.split('T')[1].split(':')[0]),
                action: opt.action,
                reason: opt.reason,
                
                // Temperature data
                targetTemp: opt.targetTemp,
                targetOriginal: opt.targetOriginal,
                indoorTemp: opt.indoorTemp,
                outdoorTemp: opt.outdoorTemp,
                
                // Price data (multiple possible field names)
                priceNow: opt.priceNow || opt.price,
                priceLevel: opt.priceData?.level || opt.priceLevel,
                pricePercentile: opt.priceData?.percentile || opt.pricePercentile,
                priceMin: opt.priceData?.min,
                priceMax: opt.priceData?.max,
                priceAverage: opt.priceData?.average,
                
                // Savings and comfort
                savings: opt.savings,
                comfort: opt.comfort,
                
                // Weather data
                weatherTemp: opt.weather?.current?.temperature || opt.weatherTemp,
                weatherSymbol: opt.weather?.current?.symbol || opt.weatherSymbol,
                weatherAdjustment: opt.weather?.adjustment?.adjustment,
                
                // Hot water data
                hotWaterFromTemp: opt.tankData?.fromTemp || opt.hotWaterFrom,
                hotWaterToTemp: opt.tankData?.toTemp || opt.hotWaterTo,
                hotWaterChanged: opt.tankData?.changed || opt.hotWaterChanged,
                hotWaterReason: opt.tankData?.reason,
                
                addedToHistorical: new Date().toISOString()
            })),
            
            hotWaterData: rawData.hotWaterData,
            adaptiveParameters: rawData.adaptiveParameters,
            thermalCharacteristics: rawData.thermalModelData?.rawData?.lastCalibration?.thermalCharacteristics
        };

        return processedData;
    }

    async mergeHistoricalData(historicalData, newData) {
        if (!newData) {
            return historicalData;
        }

        console.log(`🔗 Merging ${newData.timeSeries.length} new decisions with ${historicalData.timeSeries.length} historical decisions`);

        const existingIds = new Set(historicalData.timeSeries.map(d => d.id || `${d.timestamp}_${d.index || 0}`));
        const newUniqueData = newData.timeSeries.filter(decision => {
            const id = decision.id || `${decision.timestamp}_${decision.index || 0}`;
            return !existingIds.has(id);
        });

        console.log(`✨ Found ${newUniqueData.length} new unique decisions after deduplication`);

        const mergedTimeSeries = [...historicalData.timeSeries, ...newUniqueData];
        mergedTimeSeries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const firstDataPoint = mergedTimeSeries.length > 0 ? mergedTimeSeries[0].timestamp : null;
        const lastDataPoint = mergedTimeSeries.length > 0 ? mergedTimeSeries[mergedTimeSeries.length - 1].timestamp : null;
        
        let dataCollectionDays = 0;
        if (firstDataPoint && lastDataPoint) {
            const daysDiff = (new Date(lastDataPoint) - new Date(firstDataPoint)) / (1000 * 60 * 60 * 24);
            dataCollectionDays = Math.ceil(daysDiff);
        }

        const mergedData = {
            metadata: {
                firstDataPoint,
                lastDataPoint,
                totalDecisions: mergedTimeSeries.length,
                dataCollectionDays,
                lastUpdated: new Date().toISOString(),
                newDecisionsAdded: newUniqueData.length,
                importSessions: (historicalData.metadata.importSessions || 0) + 1,
                lastImportSource: 'manual_copy_paste'
            },
            timeSeries: mergedTimeSeries,
            systemConfig: { ...historicalData.systemConfig, ...newData.systemConfig },
            hotWaterData: newData.hotWaterData || historicalData.hotWaterData,
            adaptiveParameters: newData.adaptiveParameters || historicalData.adaptiveParameters,
            thermalCharacteristics: newData.thermalCharacteristics || historicalData.thermalCharacteristics
        };

        // Calculate enhanced aggregations
        mergedData.dailyAggregations = this.calculateDailyAggregations(mergedData.timeSeries);
        mergedData.monthlyAggregations = this.calculateMonthlyAggregations(mergedData.timeSeries);
        mergedData.hourlyPatterns = this.calculateHourlyPatterns(mergedData.timeSeries);
        mergedData.priceAnalysis = this.calculatePriceAnalysis(mergedData.timeSeries);
        mergedData.weatherAnalysis = this.calculateWeatherAnalysis(mergedData.timeSeries);
        mergedData.hotWaterAnalysis = this.calculateHotWaterAnalysis(mergedData.timeSeries);
        mergedData.comfortAnalysis = this.calculateComfortAnalysis(mergedData.timeSeries);
        mergedData.seasonalAnalysis = this.calculateSeasonalAnalysis(mergedData.timeSeries);
        mergedData.analytics = this.calculateEnhancedAnalytics(mergedData.timeSeries);

        return mergedData;
    }

    // Enhanced calculation methods
    calculateMonthlyAggregations(timeSeries) {
        const monthlyGroups = {};
        
        timeSeries.forEach(decision => {
            const month = decision.date.substring(0, 7); // YYYY-MM
            if (!monthlyGroups[month]) {
                monthlyGroups[month] = {
                    month: month,
                    totalDecisions: 0,
                    tempAdjustments: 0,
                    totalSavings: 0,
                    avgPrice: 0,
                    avgTargetTemp: 0,
                    days: new Set()
                };
            }
            
            const monthData = monthlyGroups[month];
            monthData.totalDecisions++;
            monthData.days.add(decision.date);
            
            if (decision.action === 'temperature_adjusted') monthData.tempAdjustments++;
            if (decision.savings) monthData.totalSavings += decision.savings;
            if (decision.priceNow) monthData.avgPrice += decision.priceNow;
            if (decision.targetTemp) monthData.avgTargetTemp += decision.targetTemp;
        });

        // Finalize calculations
        Object.keys(monthlyGroups).forEach(month => {
            const monthData = monthlyGroups[month];
            const count = monthData.totalDecisions;
            monthData.avgPrice = count > 0 ? monthData.avgPrice / count : 0;
            monthData.avgTargetTemp = count > 0 ? monthData.avgTargetTemp / count : 0;
            monthData.daysWithData = monthData.days.size;
            delete monthData.days; // Remove Set for JSON serialization
        });

        return Object.values(monthlyGroups).sort((a, b) => a.month.localeCompare(b.month));
    }

    calculateDailyAggregations(timeSeries) {
        const dailyGroups = {};
        
        timeSeries.forEach(decision => {
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
                    avgIndoorTemp: 0,
                    avgOutdoorTemp: 0,
                    hotWaterChanges: 0,
                    comfortGap: 0,
                    priceVolatility: 0
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
            if (decision.indoorTemp) day.avgIndoorTemp += decision.indoorTemp;
            if (decision.outdoorTemp) day.avgOutdoorTemp += decision.outdoorTemp;
            if (decision.hotWaterChanged) day.hotWaterChanges++;
            if (decision.targetTemp && decision.indoorTemp) {
                day.comfortGap += Math.abs(decision.targetTemp - decision.indoorTemp);
            }
        });

        Object.keys(dailyGroups).forEach(date => {
            const day = dailyGroups[date];
            const count = day.decisions.length;
            if (count > 0) {
                day.avgPrice = day.avgPrice / count;
                day.avgTargetTemp = day.avgTargetTemp / count;
                day.avgIndoorTemp = day.avgIndoorTemp / count;
                day.avgOutdoorTemp = day.avgOutdoorTemp / count;
                day.comfortGap = day.comfortGap / count;
                day.priceVolatility = day.maxPrice - day.minPrice;
            }
            if (day.minPrice === Infinity) day.minPrice = 0;
        });

        return Object.values(dailyGroups).sort((a, b) => a.date.localeCompare(b.date));
    }

    calculateHourlyPatterns(timeSeries) {
        const hourlyGroups = Array.from({length: 24}, (_, hour) => ({
            hour,
            totalDecisions: 0,
            tempAdjustments: 0,
            avgSavings: 0,
            avgPrice: 0,
            optimizationRate: 0
        }));

        timeSeries.forEach(decision => {
            const hourData = hourlyGroups[decision.hour];
            hourData.totalDecisions++;
            if (decision.action === 'temperature_adjusted') hourData.tempAdjustments++;
            if (decision.savings) hourData.avgSavings += decision.savings;
            if (decision.priceNow) hourData.avgPrice += decision.priceNow;
        });

        hourlyGroups.forEach(hour => {
            if (hour.totalDecisions > 0) {
                hour.avgSavings = hour.avgSavings / hour.totalDecisions;
                hour.avgPrice = hour.avgPrice / hour.totalDecisions;
                hour.optimizationRate = hour.tempAdjustments / hour.totalDecisions;
            }
        });

        return hourlyGroups;
    }

    calculatePriceAnalysis(timeSeries) {
        const priceData = timeSeries.filter(d => d.priceNow);
        const priceLevels = {};
        const priceVsActions = {};

        priceData.forEach(decision => {
            // Price level analysis
            const level = decision.priceLevel || 'unknown';
            if (!priceLevels[level]) {
                priceLevels[level] = { count: 0, adjustments: 0, avgSavings: 0 };
            }
            priceLevels[level].count++;
            if (decision.action === 'temperature_adjusted') priceLevels[level].adjustments++;
            if (decision.savings) priceLevels[level].avgSavings += decision.savings;

            // Price vs action correlation
            const priceRange = this.getPriceRange(decision.priceNow);
            if (!priceVsActions[priceRange]) {
                priceVsActions[priceRange] = { count: 0, adjustments: 0 };
            }
            priceVsActions[priceRange].count++;
            if (decision.action === 'temperature_adjusted') priceVsActions[priceRange].adjustments++;
        });

        // Calculate averages
        Object.keys(priceLevels).forEach(level => {
            const data = priceLevels[level];
            data.optimizationRate = data.adjustments / data.count;
            data.avgSavings = data.avgSavings / data.count;
        });

        return {
            priceLevels,
            priceVsActions,
            priceRange: {
                min: Math.min(...priceData.map(d => d.priceNow)),
                max: Math.max(...priceData.map(d => d.priceNow)),
                average: priceData.reduce((sum, d) => sum + d.priceNow, 0) / priceData.length
            }
        };
    }

    calculateWeatherAnalysis(timeSeries) {
        const weatherData = timeSeries.filter(d => d.outdoorTemp);
        const tempRanges = {};
        const weatherSymbols = {};

        weatherData.forEach(decision => {
            // Temperature range analysis
            const tempRange = this.getTempRange(decision.outdoorTemp);
            if (!tempRanges[tempRange]) {
                tempRanges[tempRange] = { count: 0, adjustments: 0, avgSavings: 0 };
            }
            tempRanges[tempRange].count++;
            if (decision.action === 'temperature_adjusted') tempRanges[tempRange].adjustments++;
            if (decision.savings) tempRanges[tempRange].avgSavings += decision.savings;

            // Weather symbol analysis
            if (decision.weatherSymbol) {
                const symbol = decision.weatherSymbol;
                if (!weatherSymbols[symbol]) {
                    weatherSymbols[symbol] = { count: 0, adjustments: 0 };
                }
                weatherSymbols[symbol].count++;
                if (decision.action === 'temperature_adjusted') weatherSymbols[symbol].adjustments++;
            }
        });

        return { tempRanges, weatherSymbols };
    }

    calculateHotWaterAnalysis(timeSeries) {
        const hotWaterData = timeSeries.filter(d => d.hotWaterChanged);
        const analysis = {
            totalChanges: hotWaterData.length,
            avgTempIncrease: 0,
            hourlyPattern: Array.from({length: 24}, () => 0)
        };

        hotWaterData.forEach(decision => {
            if (decision.hotWaterFromTemp && decision.hotWaterToTemp) {
                analysis.avgTempIncrease += (decision.hotWaterToTemp - decision.hotWaterFromTemp);
            }
            analysis.hourlyPattern[decision.hour]++;
        });

        if (hotWaterData.length > 0) {
            analysis.avgTempIncrease = analysis.avgTempIncrease / hotWaterData.length;
        }

        return analysis;
    }

    calculateComfortAnalysis(timeSeries) {
        const comfortData = timeSeries.filter(d => d.targetTemp && d.indoorTemp);
        const analysis = {
            avgComfortGap: 0,
            comfortViolations: 0,
            targetTempRange: { min: Infinity, max: -Infinity },
            indoorTempRange: { min: Infinity, max: -Infinity }
        };

        comfortData.forEach(decision => {
            const gap = Math.abs(decision.targetTemp - decision.indoorTemp);
            analysis.avgComfortGap += gap;
            if (gap > 2) analysis.comfortViolations++; // Assume 2°C is comfort threshold
            
            analysis.targetTempRange.min = Math.min(analysis.targetTempRange.min, decision.targetTemp);
            analysis.targetTempRange.max = Math.max(analysis.targetTempRange.max, decision.targetTemp);
            analysis.indoorTempRange.min = Math.min(analysis.indoorTempRange.min, decision.indoorTemp);
            analysis.indoorTempRange.max = Math.max(analysis.indoorTempRange.max, decision.indoorTemp);
        });

        if (comfortData.length > 0) {
            analysis.avgComfortGap = analysis.avgComfortGap / comfortData.length;
            analysis.comfortViolationRate = analysis.comfortViolations / comfortData.length;
        }

        return analysis;
    }

    calculateSeasonalAnalysis(timeSeries) {
        const seasons = { winter: [], spring: [], summer: [], autumn: [] };
        
        timeSeries.forEach(decision => {
            const month = parseInt(decision.date.split('-')[1]);
            let season;
            if (month >= 12 || month <= 2) season = 'winter';
            else if (month >= 3 && month <= 5) season = 'spring';
            else if (month >= 6 && month <= 8) season = 'summer';
            else season = 'autumn';
            
            seasons[season].push(decision);
        });

        const analysis = {};
        Object.keys(seasons).forEach(season => {
            const data = seasons[season];
            analysis[season] = {
                decisions: data.length,
                optimizations: data.filter(d => d.action === 'temperature_adjusted').length,
                totalSavings: data.reduce((sum, d) => sum + (d.savings || 0), 0),
                avgTargetTemp: data.length > 0 ? 
                    data.reduce((sum, d) => sum + (d.targetTemp || 0), 0) / data.length : 0
            };
        });

        return analysis;
    }

    calculateEnhancedAnalytics(timeSeries) {
        return {
            actionTypes: this.countByProperty(timeSeries, 'action'),
            priceLevels: this.countByProperty(timeSeries, 'priceLevel'),
            hourlyDistribution: this.countByProperty(timeSeries, 'hour'),
            weekdayPatterns: this.calculateWeekdayPatterns(timeSeries),
            efficiencyMetrics: this.calculateEfficiencyMetrics(timeSeries),
            savingsStats: this.calculateSavingsStats(timeSeries)
        };
    }

    // Helper methods
    countByProperty(timeSeries, property) {
        const counts = {};
        timeSeries.forEach(decision => {
            const value = decision[property] || 'unknown';
            counts[value] = (counts[value] || 0) + 1;
        });
        return counts;
    }

    getPriceRange(price) {
        if (price < 0.5) return 'very_cheap';
        if (price < 1.0) return 'cheap';
        if (price < 1.5) return 'normal';
        if (price < 2.0) return 'expensive';
        return 'very_expensive';
    }

    getTempRange(temp) {
        if (temp < -10) return 'very_cold';
        if (temp < 0) return 'cold';
        if (temp < 10) return 'cool';
        if (temp < 20) return 'mild';
        return 'warm';
    }

    calculateWeekdayPatterns(timeSeries) {
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const patterns = {};
        
        timeSeries.forEach(decision => {
            const dayOfWeek = weekdays[new Date(decision.timestamp).getDay()];
            if (!patterns[dayOfWeek]) {
                patterns[dayOfWeek] = { count: 0, adjustments: 0 };
            }
            patterns[dayOfWeek].count++;
            if (decision.action === 'temperature_adjusted') patterns[dayOfWeek].adjustments++;
        });

        return patterns;
    }

    calculateEfficiencyMetrics(timeSeries) {
        const validDecisions = timeSeries.filter(d => d.targetTemp && d.indoorTemp && d.outdoorTemp);
        
        return {
            avgTemperatureDelta: validDecisions.length > 0 ? 
                validDecisions.reduce((sum, d) => sum + Math.abs(d.indoorTemp - d.outdoorTemp), 0) / validDecisions.length : 0,
            heatingEfficiency: this.calculateHeatingEfficiency(validDecisions),
            optimizationEffectiveness: this.calculateOptimizationEffectiveness(timeSeries)
        };
    }

    calculateHeatingEfficiency(decisions) {
        // Simple efficiency calculation based on indoor/outdoor temp difference
        return decisions.length > 0 ? 
            decisions.reduce((sum, d) => sum + (d.indoorTemp / (d.indoorTemp - d.outdoorTemp + 20)), 0) / decisions.length : 0;
    }

    calculateOptimizationEffectiveness(timeSeries) {
        const optimizedDecisions = timeSeries.filter(d => d.action === 'temperature_adjusted');
        const totalSavings = optimizedDecisions.reduce((sum, d) => sum + (d.savings || 0), 0);
        return optimizedDecisions.length > 0 ? totalSavings / optimizedDecisions.length : 0;
    }

    calculateSavingsStats(timeSeries) {
        const savingsData = timeSeries.filter(d => d.savings !== null && d.savings !== undefined);
        
        return {
            total: savingsData.reduce((sum, d) => sum + d.savings, 0),
            positive: savingsData.filter(d => d.savings > 0).length,
            negative: savingsData.filter(d => d.savings < 0).length,
            count: savingsData.length,
            average: savingsData.length > 0 ? savingsData.reduce((sum, d) => sum + d.savings, 0) / savingsData.length : 0,
            best: savingsData.length > 0 ? Math.max(...savingsData.map(d => d.savings)) : 0,
            worst: savingsData.length > 0 ? Math.min(...savingsData.map(d => d.savings)) : 0
        };
    }

    // Reuse other methods from the basic version (applyDataRetention, createBackup, etc.)
    async applyDataRetention(data) {
        const retentionDate = new Date();
        retentionDate.setDate(retentionDate.getDate() - CONFIG.dataRetentionDays);
        
        const beforeCount = data.timeSeries.length;
        data.timeSeries = data.timeSeries.filter(decision => 
            new Date(decision.timestamp) >= retentionDate
        );
        const afterCount = data.timeSeries.length;
        
        if (beforeCount !== afterCount) {
            console.log(`🧹 Removed ${beforeCount - afterCount} old decisions (retention: ${CONFIG.dataRetentionDays} days)`);
        }

        return data;
    }

    async createBackup(data) {
        const backupFile = path.join(this.backupPath, `backup-${this.currentDate}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
        console.log(`💾 Backup created`);
    }

    async saveHistoricalData(data) {
        fs.writeFileSync(this.historicalPath, JSON.stringify(data, null, 2));
        console.log(`💾 Historical data saved`);
    }

    async generateEnhancedDashboard(data) {
        const dashboardTemplate = this.getEnhancedDashboardTemplate();
        const dashboardHtml = dashboardTemplate.replace('{{DATA_PLACEHOLDER}}', JSON.stringify(data, null, 2));
        
        fs.writeFileSync(this.dashboardPath, dashboardHtml);
        console.log(`📊 Enhanced dashboard generated: ${this.dashboardPath}`);
    }

    getEnhancedDashboardTemplate() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MELCloud Enhanced Analytics Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/date-fns@2.29.3/index.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f7fa; color: #333; }
        .container { max-width: 1800px; margin: 0 auto; padding: 20px; }
        
        .header { text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                  color: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .header p { font-size: 1.2em; opacity: 0.9; }
        
        .data-info { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin-top: 20px; }
        .data-info strong { display: inline-block; margin-right: 15px; }
        
        .nav-tabs { display: flex; background: white; border-radius: 10px; padding: 5px; margin-bottom: 30px; box-shadow: 0 5px 15px rgba(0,0,0,0.08); }
        .nav-tab { flex: 1; padding: 15px; text-align: center; cursor: pointer; border-radius: 8px; transition: all 0.3s; }
        .nav-tab:hover { background: #f8f9fa; }
        .nav-tab.active { background: #667eea; color: white; }
        
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: white; padding: 25px; border-radius: 15px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.08); transition: transform 0.3s; }
        .stat-card:hover { transform: translateY(-5px); }
        .stat-value { font-size: 2.2em; font-weight: bold; margin-bottom: 8px; }
        .stat-label { color: #666; font-size: 0.95em; }
        .stat-positive { color: #4CAF50; }
        .stat-negative { color: #f44336; }
        .stat-neutral { color: #2196F3; }
        
        .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
        .chart-container { background: white; padding: 25px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.08); }
        .chart-container.full-width { grid-column: 1 / -1; }
        .chart-title { font-size: 1.3em; font-weight: 600; margin-bottom: 20px; color: #333; display: flex; align-items: center; }
        .chart-title::before { content: '📊'; margin-right: 10px; }
        canvas { max-height: 400px; }
        
        .insights-section { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.08); }
        .insights-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .insight-card { background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 4px solid #667eea; }
        .insight-title { font-weight: 600; margin-bottom: 10px; color: #667eea; }
        
        @media (max-width: 768px) {
            .charts-grid { grid-template-columns: 1fr; }
            .nav-tabs { flex-direction: column; }
            .container { padding: 10px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏠 MELCloud Enhanced Analytics Dashboard</h1>
            <p>Comprehensive heat pump optimization analysis with all data points</p>
            <div class="data-info" id="dataInfo"></div>
        </div>

        <div class="nav-tabs">
            <div class="nav-tab active" onclick="showTab('overview')">📊 Overview</div>
            <div class="nav-tab" onclick="showTab('price')">💰 Price Analysis</div>
            <div class="nav-tab" onclick="showTab('weather')">🌡️ Weather & Comfort</div>
            <div class="nav-tab" onclick="showTab('patterns')">⏰ Patterns</div>
            <div class="nav-tab" onclick="showTab('hotwater')">🚿 Hot Water</div>
            <div class="nav-tab" onclick="showTab('efficiency')">⚡ Efficiency</div>
        </div>

        <!-- Overview Tab -->
        <div id="overview" class="tab-content active">
            <div class="stats-grid" id="overviewStats"></div>
            <div class="charts-grid">
                <div class="chart-container full-width">
                    <div class="chart-title">Daily Savings & Optimization Activity</div>
                    <canvas id="dailyOverviewChart"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-title">Action Type Distribution</div>
                    <canvas id="actionTypesChart"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-title">Monthly Trends</div>
                    <canvas id="monthlyTrendsChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Price Analysis Tab -->
        <div id="price" class="tab-content">
            <div class="stats-grid" id="priceStats"></div>
            <div class="charts-grid">
                <div class="chart-container">
                    <div class="chart-title">Price Level Distribution</div>
                    <canvas id="priceLevelsChart"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-title">Price vs Optimization Rate</div>
                    <canvas id="priceOptimizationChart"></canvas>
                </div>
                <div class="chart-container full-width">
                    <div class="chart-title">Price Trends vs Savings</div>
                    <canvas id="priceSavingsChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Weather & Comfort Tab -->
        <div id="weather" class="tab-content">
            <div class="stats-grid" id="weatherStats"></div>
            <div class="charts-grid">
                <div class="chart-container">
                    <div class="chart-title">Temperature Ranges vs Optimization</div>
                    <canvas id="tempRangesChart"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-title">Indoor vs Outdoor Temperature</div>
                    <canvas id="temperatureCorrelationChart"></canvas>
                </div>
                <div class="chart-container full-width">
                    <div class="chart-title">Comfort Analysis</div>
                    <canvas id="comfortAnalysisChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Patterns Tab -->
        <div id="patterns" class="tab-content">
            <div class="stats-grid" id="patternsStats"></div>
            <div class="charts-grid">
                <div class="chart-container">
                    <div class="chart-title">Hourly Optimization Patterns</div>
                    <canvas id="hourlyPatternsChart"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-title">Weekday Patterns</div>
                    <canvas id="weekdayPatternsChart"></canvas>
                </div>
                <div class="chart-container full-width">
                    <div class="chart-title">Seasonal Analysis</div>
                    <canvas id="seasonalChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Hot Water Tab -->
        <div id="hotwater" class="tab-content">
            <div class="stats-grid" id="hotWaterStats"></div>
            <div class="charts-grid">
                <div class="chart-container">
                    <div class="chart-title">Hot Water Hourly Patterns</div>
                    <canvas id="hotWaterHourlyChart"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-title">Hot Water Temperature Changes</div>
                    <canvas id="hotWaterTempChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Efficiency Tab -->
        <div id="efficiency" class="tab-content">
            <div class="stats-grid" id="efficiencyStats"></div>
            <div class="charts-grid">
                <div class="chart-container">
                    <div class="chart-title">Optimization Effectiveness</div>
                    <canvas id="optimizationEffectivenessChart"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-title">Efficiency Metrics</div>
                    <canvas id="efficiencyMetricsChart"></canvas>
                </div>
            </div>
        </div>

        <div class="insights-section">
            <h2>🧠 Smart Insights & Recommendations</h2>
            <div class="insights-grid" id="smartInsights"></div>
        </div>
    </div>

    <script>
        const data = {{DATA_PLACEHOLDER}};
        let currentTab = 'overview';

        function showTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
            
            // Show selected tab
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
            
            currentTab = tabName;
            
            // Load tab-specific content if not already loaded
            loadTabContent(tabName);
        }

        function loadTabContent(tabName) {
            switch(tabName) {
                case 'overview': createOverviewTab(); break;
                case 'price': createPriceTab(); break;
                case 'weather': createWeatherTab(); break;
                case 'patterns': createPatternsTab(); break;
                case 'hotwater': createHotWaterTab(); break;
                case 'efficiency': createEfficiencyTab(); break;
            }
        }

        function createOverviewTab() {
            // Create overview stats
            const stats = [
                { label: 'Total Decisions', value: data.metadata.totalDecisions.toLocaleString(), class: 'stat-neutral' },
                { label: 'Collection Period', value: \`\${data.metadata.dataCollectionDays} days\`, class: 'stat-neutral' },
                { label: 'Total Savings', value: \`\${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK\`, class: data.analytics.savingsStats.total >= 0 ? 'stat-positive' : 'stat-negative' },
                { label: 'Optimization Rate', value: \`\${((data.analytics.actionTypes.temperature_adjusted || 0) / data.metadata.totalDecisions * 100).toFixed(1)}%\`, class: 'stat-neutral' },
                { label: 'Avg Daily Savings', value: \`\${((data.analytics.savingsStats.total || 0) / data.metadata.dataCollectionDays).toFixed(2)} SEK\`, class: 'stat-positive' },
                { label: 'Import Sessions', value: data.metadata.importSessions, class: 'stat-neutral' }
            ];

            document.getElementById('overviewStats').innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value \${stat.class}">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');

            // Create charts
            createDailyOverviewChart();
            createActionTypesChart();
            createMonthlyTrendsChart();
        }

        function createPriceTab() {
            const priceAnalysis = data.priceAnalysis || {};
            const stats = [
                { label: 'Price Range', value: \`\${(priceAnalysis.priceRange?.min || 0).toFixed(2)} - \${(priceAnalysis.priceRange?.max || 0).toFixed(2)} SEK/kWh\`, class: 'stat-neutral' },
                { label: 'Average Price', value: \`\${(priceAnalysis.priceRange?.average || 0).toFixed(2)} SEK/kWh\`, class: 'stat-neutral' },
                { label: 'Best Price Level', value: 'cheap', class: 'stat-positive' },
                { label: 'Price Volatility', value: \`\${(((priceAnalysis.priceRange?.max || 0) - (priceAnalysis.priceRange?.min || 0)) * 100).toFixed(0)}%\`, class: 'stat-neutral' }
            ];

            document.getElementById('priceStats').innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value \${stat.class}">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');

            createPriceLevelsChart();
            createPriceOptimizationChart();
            createPriceSavingsChart();
        }

        function createWeatherTab() {
            const comfortAnalysis = data.comfortAnalysis || {};
            const stats = [
                { label: 'Avg Comfort Gap', value: \`\${(comfortAnalysis.avgComfortGap || 0).toFixed(1)}°C\`, class: 'stat-neutral' },
                { label: 'Comfort Violations', value: \`\${((comfortAnalysis.comfortViolationRate || 0) * 100).toFixed(1)}%\`, class: 'stat-negative' },
                { label: 'Target Temp Range', value: \`\${(comfortAnalysis.targetTempRange?.min || 0).toFixed(1)}°C - \${(comfortAnalysis.targetTempRange?.max || 0).toFixed(1)}°C\`, class: 'stat-neutral' },
                { label: 'Indoor Temp Range', value: \`\${(comfortAnalysis.indoorTempRange?.min || 0).toFixed(1)}°C - \${(comfortAnalysis.indoorTempRange?.max || 0).toFixed(1)}°C\`, class: 'stat-neutral' }
            ];

            document.getElementById('weatherStats').innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value \${stat.class}">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');

            createTempRangesChart();
            createTemperatureCorrelationChart();
            createComfortAnalysisChart();
        }

        function createPatternsTab() {
            const hourlyPatterns = data.hourlyPatterns || [];
            const weekdayPatterns = data.analytics.weekdayPatterns || {};
            
            const stats = [
                { label: 'Peak Optimization Hour', value: \`\${hourlyPatterns.reduce((max, hour) => hour.optimizationRate > max.optimizationRate ? hour : max, {hour: 0, optimizationRate: 0}).hour}:00\`, class: 'stat-neutral' },
                { label: 'Most Active Day', value: Object.keys(weekdayPatterns).reduce((max, day) => weekdayPatterns[day].adjustments > (weekdayPatterns[max]?.adjustments || 0) ? day : max, 'Monday'), class: 'stat-neutral' }
            ];

            document.getElementById('patternsStats').innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value \${stat.class}">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');

            createHourlyPatternsChart();
            createWeekdayPatternsChart();
            createSeasonalChart();
        }

        function createHotWaterTab() {
            const hotWaterAnalysis = data.hotWaterAnalysis || {};
            
            const stats = [
                { label: 'Hot Water Changes', value: hotWaterAnalysis.totalChanges || 0, class: 'stat-neutral' },
                { label: 'Avg Temp Increase', value: \`\${(hotWaterAnalysis.avgTempIncrease || 0).toFixed(1)}°C\`, class: 'stat-positive' }
            ];

            document.getElementById('hotWaterStats').innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value \${stat.class}">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');

            createHotWaterHourlyChart();
            createHotWaterTempChart();
        }

        function createEfficiencyTab() {
            const efficiencyMetrics = data.analytics.efficiencyMetrics || {};
            
            const stats = [
                { label: 'Heating Efficiency', value: \`\${(efficiencyMetrics.heatingEfficiency || 0).toFixed(2)}\`, class: 'stat-positive' },
                { label: 'Optimization Effectiveness', value: \`\${(efficiencyMetrics.optimizationEffectiveness || 0).toFixed(2)} SEK/action\`, class: 'stat-positive' }
            ];

            document.getElementById('efficiencyStats').innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value \${stat.class}">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');

            createOptimizationEffectivenessChart();
            createEfficiencyMetricsChart();
        }

        // Chart creation functions (implement based on data structure)
        function createDailyOverviewChart() {
            const ctx = document.getElementById('dailyOverviewChart').getContext('2d');
            const dailyData = data.dailyAggregations || [];
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dailyData.map(d => d.date),
                    datasets: [
                        {
                            label: 'Daily Savings (SEK)',
                            data: dailyData.map(d => d.totalSavings),
                            borderColor: '#4CAF50',
                            backgroundColor: 'rgba(76, 175, 80, 0.1)',
                            yAxisID: 'savings'
                        },
                        {
                            label: 'Temperature Adjustments',
                            data: dailyData.map(d => d.tempAdjustments),
                            borderColor: '#2196F3',
                            backgroundColor: 'rgba(33, 150, 243, 0.1)',
                            yAxisID: 'adjustments'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        savings: { type: 'linear', display: true, position: 'left' },
                        adjustments: { type: 'linear', display: true, position: 'right' }
                    }
                }
            });
        }

        function createActionTypesChart() {
            const ctx = document.getElementById('actionTypesChart').getContext('2d');
            const actionTypes = data.analytics.actionTypes || {};
            
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(actionTypes),
                    datasets: [{
                        data: Object.values(actionTypes),
                        backgroundColor: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7']
                    }]
                },
                options: { responsive: true }
            });
        }

        function createMonthlyTrendsChart() {
            const ctx = document.getElementById('monthlyTrendsChart').getContext('2d');
            const monthlyData = data.monthlyAggregations || [];
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: monthlyData.map(m => m.month),
                    datasets: [
                        {
                            label: 'Monthly Savings (SEK)',
                            data: monthlyData.map(m => m.totalSavings),
                            backgroundColor: '#4CAF50',
                            yAxisID: 'savings'
                        },
                        {
                            label: 'Temperature Adjustments',
                            data: monthlyData.map(m => m.tempAdjustments),
                            backgroundColor: '#2196F3',
                            yAxisID: 'adjustments'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        savings: { type: 'linear', display: true, position: 'left' },
                        adjustments: { type: 'linear', display: true, position: 'right' }
                    }
                }
            });
        }

        function createPriceLevelsChart() {
            const ctx = document.getElementById('priceLevelsChart').getContext('2d');
            const priceLevels = data.analytics.priceLevels || {};
            
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(priceLevels),
                    datasets: [{
                        data: Object.values(priceLevels),
                        backgroundColor: ['#4CAF50', '#FFC107', '#FF9800', '#F44336', '#9C27B0']
                    }]
                },
                options: { responsive: true }
            });
        }

        function createPriceOptimizationChart() {
            const ctx = document.getElementById('priceOptimizationChart').getContext('2d');
            const priceAnalysis = data.priceAnalysis || {};
            const priceLevels = priceAnalysis.priceLevels || {};
            
            const labels = Object.keys(priceLevels);
            const optimizationRates = labels.map(level => (priceLevels[level].optimizationRate || 0) * 100);
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Optimization Rate (%)',
                        data: optimizationRates,
                        backgroundColor: '#2196F3'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { 
                            beginAtZero: true,
                            max: 100,
                            title: { display: true, text: 'Optimization Rate (%)' }
                        }
                    }
                }
            });
        }

        function createPriceSavingsChart() {
            const ctx = document.getElementById('priceSavingsChart').getContext('2d');
            const dailyData = data.dailyAggregations || [];
            
            new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Price vs Savings',
                        data: dailyData.map(d => ({
                            x: d.avgPrice,
                            y: d.totalSavings
                        })),
                        backgroundColor: '#FF6B6B'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { title: { display: true, text: 'Average Price (SEK/kWh)' } },
                        y: { title: { display: true, text: 'Daily Savings (SEK)' } }
                    }
                }
            });
        }

        function createTempRangesChart() {
            const ctx = document.getElementById('tempRangesChart').getContext('2d');
            const weatherAnalysis = data.weatherAnalysis || {};
            const tempRanges = weatherAnalysis.tempRanges || {};
            
            const labels = Object.keys(tempRanges);
            const optimizationRates = labels.map(range => (tempRanges[range].adjustments / tempRanges[range].count * 100) || 0);
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Optimization Rate (%)',
                        data: optimizationRates,
                        backgroundColor: '#4ECDC4'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { 
                            beginAtZero: true,
                            title: { display: true, text: 'Optimization Rate (%)' }
                        }
                    }
                }
            });
        }

        function createTemperatureCorrelationChart() {
            const ctx = document.getElementById('temperatureCorrelationChart').getContext('2d');
            const recentData = data.timeSeries.slice(-168); // Last week
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: recentData.map((d, i) => i), // Use indices for x-axis
                    datasets: [
                        {
                            label: 'Indoor Temperature (°C)',
                            data: recentData.map(d => d.indoorTemp),
                            borderColor: '#FF6B6B',
                            backgroundColor: 'rgba(255, 107, 107, 0.1)',
                            yAxisID: 'temp'
                        },
                        {
                            label: 'Outdoor Temperature (°C)',
                            data: recentData.map(d => d.outdoorTemp),
                            borderColor: '#4ECDC4',
                            backgroundColor: 'rgba(78, 205, 196, 0.1)',
                            yAxisID: 'temp'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        temp: { 
                            type: 'linear', 
                            display: true, 
                            title: { display: true, text: 'Temperature (°C)' }
                        }
                    }
                }
            });
        }

        function createComfortAnalysisChart() {
            const ctx = document.getElementById('comfortAnalysisChart').getContext('2d');
            const dailyData = data.dailyAggregations || [];
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dailyData.map(d => d.date),
                    datasets: [
                        {
                            label: 'Comfort Gap (°C)',
                            data: dailyData.map(d => d.comfortGap || 0),
                            borderColor: '#FF9800',
                            backgroundColor: 'rgba(255, 152, 0, 0.1)'
                        },
                        {
                            label: 'Average Target Temp (°C)',
                            data: dailyData.map(d => d.avgTargetTemp),
                            borderColor: '#9C27B0',
                            backgroundColor: 'rgba(156, 39, 176, 0.1)'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { title: { display: true, text: 'Temperature (°C)' } }
                    }
                }
            });
        }

        function createHourlyPatternsChart() {
            const ctx = document.getElementById('hourlyPatternsChart').getContext('2d');
            const hourlyPatterns = data.hourlyPatterns || [];
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: hourlyPatterns.map(h => \`\${h.hour}:00\`),
                    datasets: [
                        {
                            label: 'Optimization Rate (%)',
                            data: hourlyPatterns.map(h => h.optimizationRate * 100),
                            borderColor: '#2196F3',
                            backgroundColor: 'rgba(33, 150, 243, 0.1)',
                            yAxisID: 'rate'
                        },
                        {
                            label: 'Average Savings (SEK)',
                            data: hourlyPatterns.map(h => h.avgSavings),
                            borderColor: '#4CAF50',
                            backgroundColor: 'rgba(76, 175, 80, 0.1)',
                            yAxisID: 'savings'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        rate: { type: 'linear', display: true, position: 'left', max: 100 },
                        savings: { type: 'linear', display: true, position: 'right' }
                    }
                }
            });
        }

        function createWeekdayPatternsChart() {
            const ctx = document.getElementById('weekdayPatternsChart').getContext('2d');
            const weekdayPatterns = data.analytics.weekdayPatterns || {};
            
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            const adjustments = weekdays.map(day => weekdayPatterns[day]?.adjustments || 0);
            const totals = weekdays.map(day => weekdayPatterns[day]?.count || 1);
            const rates = adjustments.map((adj, i) => (adj / totals[i]) * 100);
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: weekdays,
                    datasets: [{
                        label: 'Optimization Rate (%)',
                        data: rates,
                        backgroundColor: '#673AB7'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { 
                            beginAtZero: true,
                            title: { display: true, text: 'Optimization Rate (%)' }
                        }
                    }
                }
            });
        }

        function createSeasonalChart() {
            const ctx = document.getElementById('seasonalChart').getContext('2d');
            const seasonalAnalysis = data.seasonalAnalysis || {};
            
            const seasons = ['winter', 'spring', 'summer', 'autumn'];
            const seasonLabels = ['Winter', 'Spring', 'Summer', 'Autumn'];
            const optimizations = seasons.map(season => seasonalAnalysis[season]?.optimizations || 0);
            const totalSavings = seasons.map(season => seasonalAnalysis[season]?.totalSavings || 0);
            
            new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: seasonLabels,
                    datasets: [
                        {
                            label: 'Optimizations',
                            data: optimizations,
                            borderColor: '#FF6B6B',
                            backgroundColor: 'rgba(255, 107, 107, 0.2)'
                        },
                        {
                            label: 'Total Savings (SEK)',
                            data: totalSavings,
                            borderColor: '#4CAF50',
                            backgroundColor: 'rgba(76, 175, 80, 0.2)'
                        }
                    ]
                },
                options: { responsive: true }
            });
        }

        function createHotWaterHourlyChart() {
            const ctx = document.getElementById('hotWaterHourlyChart').getContext('2d');
            const hotWaterAnalysis = data.hotWaterAnalysis || {};
            const hourlyPattern = hotWaterAnalysis.hourlyPattern || Array(24).fill(0);
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Array.from({length: 24}, (_, i) => \`\${i}:00\`),
                    datasets: [{
                        label: 'Hot Water Changes',
                        data: hourlyPattern,
                        backgroundColor: '#00BCD4'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { 
                            beginAtZero: true,
                            title: { display: true, text: 'Number of Changes' }
                        }
                    }
                }
            });
        }

        function createHotWaterTempChart() {
            const ctx = document.getElementById('hotWaterTempChart').getContext('2d');
            const hotWaterData = data.timeSeries.filter(d => d.hotWaterChanged);
            
            new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Temperature Change',
                        data: hotWaterData.map((d, i) => ({
                            x: i,
                            y: (d.hotWaterToTemp || 0) - (d.hotWaterFromTemp || 0)
                        })),
                        backgroundColor: '#FF9800'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { title: { display: true, text: 'Hot Water Event' } },
                        y: { title: { display: true, text: 'Temperature Increase (°C)' } }
                    }
                }
            });
        }

        function createOptimizationEffectivenessChart() {
            const ctx = document.getElementById('optimizationEffectivenessChart').getContext('2d');
            const dailyData = data.dailyAggregations || [];
            
            const effectiveness = dailyData.map(d => {
                const adjustments = d.tempAdjustments || 1;
                return (d.totalSavings || 0) / adjustments;
            });
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dailyData.map(d => d.date),
                    datasets: [{
                        label: 'Savings per Adjustment (SEK)',
                        data: effectiveness,
                        borderColor: '#8BC34A',
                        backgroundColor: 'rgba(139, 195, 74, 0.1)'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { title: { display: true, text: 'SEK per Adjustment' } }
                    }
                }
            });
        }

        function createEfficiencyMetricsChart() {
            const ctx = document.getElementById('efficiencyMetricsChart').getContext('2d');
            const efficiencyMetrics = data.analytics.efficiencyMetrics || {};
            
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Heating Efficiency', 'Optimization Effectiveness', 'Temperature Delta'],
                    datasets: [{
                        data: [
                            efficiencyMetrics.heatingEfficiency || 0,
                            efficiencyMetrics.optimizationEffectiveness || 0,
                            efficiencyMetrics.avgTemperatureDelta || 0
                        ],
                        backgroundColor: ['#E91E63', '#9C27B0', '#673AB7']
                    }]
                },
                options: { responsive: true }
            });
        }

        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            // Update header info
            const startDate = new Date(data.metadata.firstDataPoint).toLocaleDateString();
            const endDate = new Date(data.metadata.lastDataPoint).toLocaleDateString();
            
            document.getElementById('dataInfo').innerHTML = \`
                <strong>📅 Period:</strong> \${startDate} to \${endDate} |
                <strong>📊 Decisions:</strong> \${data.metadata.totalDecisions.toLocaleString()} |
                <strong>💾 Sessions:</strong> \${data.metadata.importSessions} |
                <strong>🔄 Updated:</strong> \${new Date(data.metadata.lastUpdated).toLocaleString()}
            \`;

            // Load initial tab
            createOverviewTab();

            // Create smart insights
            createSmartInsights();
        });

        function createSmartInsights() {
            const insights = [
                \`📊 Analyzed \${data.metadata.totalDecisions.toLocaleString()} optimization decisions over \${data.metadata.dataCollectionDays} days\`,
                \`💰 Total savings of \${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK with \${((data.analytics.actionTypes.temperature_adjusted || 0) / data.metadata.totalDecisions * 100).toFixed(1)}% optimization rate\`,
                \`🌡️ Maintained temperature control with \${(data.comfortAnalysis?.avgComfortGap || 0).toFixed(1)}°C average comfort gap\`,
                \`⚡ System shows \${(data.analytics.efficiencyMetrics?.heatingEfficiency || 0).toFixed(2)} heating efficiency rating\`,
                \`📈 Best optimization effectiveness: \${(data.analytics.efficiencyMetrics?.optimizationEffectiveness || 0).toFixed(2)} SEK per action\`,
                \`🔄 Data imported \${data.metadata.importSessions} times, latest update: \${new Date(data.metadata.lastUpdated).toLocaleDateString()}\`
            ];

            document.getElementById('smartInsights').innerHTML = insights.map(insight => \`
                <div class="insight-card">
                    <div class="insight-title">Smart Analysis</div>
                    <div>\${insight}</div>
                </div>
            \`).join('');
        }
    </script>
</body>
</html>`;
    }

    async startServer() {
        const server = http.createServer((req, res) => {
            let filePath = path.join(this.outputPath, req.url === '/' ? CONFIG.dashboardFile : req.url);
            
            if (!filePath.startsWith(this.outputPath)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('File not found');
                    return;
                }

                const ext = path.extname(filePath);
                const contentType = {
                    '.html': 'text/html',
                    '.js': 'text/javascript',
                    '.css': 'text/css',
                    '.json': 'application/json'
                }[ext] || 'text/plain';

                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            });
        });

        server.listen(CONFIG.serverPort, () => {
            console.log(`🌐 Server running at http://localhost:${CONFIG.serverPort}`);
            console.log(`📊 Enhanced Dashboard: http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
            
            this.openBrowser(`http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
        });
    }

    openBrowser(url) {
        const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
        spawn(start, [url], { detached: true, stdio: 'ignore' });
    }

    printSummary(data) {
        console.log('\\n📊 Enhanced Dashboard Summary:');
        console.log(`📅 Collection Period: ${data.metadata.dataCollectionDays} days`);
        console.log(`🔢 Total Decisions: ${data.metadata.totalDecisions.toLocaleString()}`);
        console.log(`💰 Total Savings: ${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK`);
        console.log(`📊 Enhanced Dashboard: http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
        console.log('\\n✨ Enhanced features: Price analysis, weather correlation, hourly patterns, hot water tracking, efficiency metrics');
    }
}

if (require.main === module) {
    const generator = new MELCloudEnhancedDashboard();
    generator.run().catch(console.error);
}

module.exports = MELCloudEnhancedDashboard;
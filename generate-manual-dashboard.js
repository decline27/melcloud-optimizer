#!/usr/bin/env node

/**
 * MELCloud Manual Data Import & Historical Dashboard Generator
 * 
 * This system works with copy-paste data from Homey settings page:
 * 1. Copy data from Homey settings "Data Dump" button
 * 2. Paste into a JSON file (or provide via stdin)
 * 3. Automatically merges with historical data
 * 4. Generates comprehensive long-term dashboard
 * 
 * Usage:
 *   node generate-manual-dashboard.js data.json
 *   node generate-manual-dashboard.js < clipboard.json
 *   echo '{"data": "..."}' | node generate-manual-dashboard.js
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

// Configuration for manual data import system
const CONFIG = {
    serverPort: 8080,
    outputDir: './dashboard-output',
    dataFile: 'melcloud-data.json',
    dashboardFile: 'dashboard.html',
    historicalDataFile: 'melcloud-historical-data.json',
    backupDir: './dashboard-output/backups',
    maxBackups: 30,
    dataRetentionDays: 365,
    deduplicationWindowHours: 2
};

class MELCloudManualDashboard {
    constructor() {
        this.outputPath = path.resolve(CONFIG.outputDir);
        this.backupPath = path.resolve(CONFIG.backupDir);
        this.dataPath = path.join(this.outputPath, CONFIG.dataFile);
        this.historicalPath = path.join(this.outputPath, CONFIG.historicalDataFile);
        this.dashboardPath = path.join(this.outputPath, CONFIG.dashboardFile);
        this.currentDate = new Date().toISOString().split('T')[0];
    }

    async run() {
        console.log('🚀 MELCloud Manual Data Import & Historical Dashboard');
        console.log('=' .repeat(60));
        
        try {
            // Step 1: Setup directories
            await this.setupDirectories();
            
            // Step 2: Load existing historical data
            console.log('📚 Loading existing historical data...');
            const historicalData = await this.loadHistoricalData();
            
            // Step 3: Get new data (from file or stdin)
            console.log('📄 Loading new data...');
            const newRawData = await this.loadNewData();
            
            if (!newRawData) {
                console.log('❌ No new data provided. Use one of these methods:');
                console.log('  1. node generate-manual-dashboard.js data.json');
                console.log('  2. node generate-manual-dashboard.js < clipboard.json');
                console.log('  3. Copy data from Homey settings and save to a JSON file');
                return;
            }
            
            // Step 4: Process new data
            console.log('🔄 Processing new data...');
            const newProcessedData = await this.processData(newRawData);
            
            if (!newProcessedData) {
                console.log('❌ No valid optimization data found in input');
                console.log('💡 Make sure you copied the complete data from Homey settings page');
                return;
            }
            
            // Step 5: Merge with historical data
            console.log('🔗 Merging with historical data...');
            const mergedData = await this.mergeHistoricalData(historicalData, newProcessedData);
            
            // Step 6: Apply data retention and cleanup
            console.log('🧹 Applying data retention policies...');
            const cleanedData = await this.applyDataRetention(mergedData);
            
            // Step 7: Create backup
            console.log('💾 Creating backup...');
            await this.createBackup(cleanedData);
            
            // Step 8: Save updated historical data
            console.log('💾 Saving updated historical data...');
            await this.saveHistoricalData(cleanedData);
            
            // Step 9: Generate enhanced dashboard
            console.log('📊 Generating historical dashboard...');
            await this.generateHistoricalDashboard(cleanedData);
            
            // Step 10: Start server
            console.log('🌐 Starting dashboard server...');
            await this.startServer();
            
            console.log('✅ Historical dashboard generated successfully!');
            this.printSummary(cleanedData);
            
        } catch (error) {
            console.error('❌ Error:', error.message);
            console.log('\n🔧 Troubleshooting:');
            console.log('- Make sure the JSON data is valid (check syntax)');
            console.log('- Verify you copied the complete data from Homey settings');
            console.log('- Check disk space for historical data storage');
            console.log('- Try saving the data to a file first, then run with file argument');
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
            // Load from file
            if (!fs.existsSync(inputFile)) {
                throw new Error(`Input file not found: ${inputFile}`);
            }
            console.log(`📄 Reading data from file: ${inputFile}`);
            const content = fs.readFileSync(inputFile, 'utf8');
            return JSON.parse(content);
        } else {
            // Try to read from stdin
            console.log('📄 Waiting for data from stdin (paste your data and press Ctrl+D)...');
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
                
                // Timeout after 30 seconds if no input
                setTimeout(() => {
                    resolve(null);
                }, 30000);
            });
        }
    }

    async loadHistoricalData() {
        if (!fs.existsSync(this.historicalPath)) {
            console.log('📝 No existing historical data found. Starting fresh.');
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
                analytics: {},
                systemConfig: {}
            };
        }

        try {
            const data = JSON.parse(fs.readFileSync(this.historicalPath, 'utf8'));
            console.log(`📚 Loaded historical data: ${data.timeSeries.length} decisions over ${data.metadata.dataCollectionDays} days`);
            return data;
        } catch (error) {
            console.log('⚠️  Error loading historical data, starting fresh:', error.message);
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
                analytics: {},
                systemConfig: {}
            };
        }
    }

    async processData(rawData) {
        // Look for optimization data in various possible locations
        let optimizations = null;
        
        // Try different possible data structures
        if (rawData.thermalModelData?.rawData?.optimizations) {
            optimizations = rawData.thermalModelData.rawData.optimizations;
            console.log(`🔍 Found optimizations in thermalModelData.rawData: ${optimizations.length} decisions`);
        } else if (rawData.optimizations) {
            optimizations = rawData.optimizations;
            console.log(`🔍 Found optimizations in root: ${optimizations.length} decisions`);
        } else if (rawData.optimizationData) {
            optimizations = rawData.optimizationData;
            console.log(`🔍 Found optimizations in optimizationData: ${optimizations.length} decisions`);
        } else if (rawData.decisions) {
            optimizations = rawData.decisions;
            console.log(`🔍 Found optimizations in decisions: ${optimizations.length} decisions`);
        } else {
            // Look for arrays that might contain optimization data
            Object.keys(rawData).forEach(key => {
                const value = rawData[key];
                if (Array.isArray(value) && value.length > 0) {
                    const firstItem = value[0];
                    if (firstItem && typeof firstItem === 'object' && 
                        (firstItem.timestamp || firstItem.action || firstItem.targetTemp)) {
                        optimizations = value;
                        console.log(`🔍 Found potential optimizations in ${key}: ${optimizations.length} decisions`);
                    }
                }
            });
        }
        
        if (!optimizations || !Array.isArray(optimizations) || optimizations.length === 0) {
            console.log('❌ No optimization data found in the provided data');
            console.log('🔍 Available top-level keys:', Object.keys(rawData));
            return null;
        }

        console.log(`🔄 Processing ${optimizations.length} optimization decisions`);
        
        // Process optimization data
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
                id: `${opt.timestamp}_${index}`, // Unique ID for deduplication
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
            console.log('ℹ️  No new data to merge, returning existing historical data');
            return historicalData;
        }

        console.log(`🔗 Merging ${newData.timeSeries.length} new decisions with ${historicalData.timeSeries.length} historical decisions`);

        // Create a set of existing IDs for deduplication
        const existingIds = new Set(historicalData.timeSeries.map(d => d.id || `${d.timestamp}_${d.index || 0}`));
        
        // Filter out duplicates from new data
        const newUniqueData = newData.timeSeries.filter(decision => {
            const id = decision.id || `${decision.timestamp}_${decision.index || 0}`;
            return !existingIds.has(id);
        });

        console.log(`✨ Found ${newUniqueData.length} new unique decisions after deduplication`);

        // Merge time series data
        const mergedTimeSeries = [...historicalData.timeSeries, ...newUniqueData];
        
        // Sort by timestamp
        mergedTimeSeries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Calculate updated metadata
        const firstDataPoint = mergedTimeSeries.length > 0 ? mergedTimeSeries[0].timestamp : null;
        const lastDataPoint = mergedTimeSeries.length > 0 ? mergedTimeSeries[mergedTimeSeries.length - 1].timestamp : null;
        
        let dataCollectionDays = 0;
        if (firstDataPoint && lastDataPoint) {
            const daysDiff = (new Date(lastDataPoint) - new Date(firstDataPoint)) / (1000 * 60 * 60 * 24);
            dataCollectionDays = Math.ceil(daysDiff);
        }

        // Build merged dataset
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

        // Recalculate aggregations
        mergedData.dailyAggregations = this.calculateDailyAggregations(mergedData.timeSeries);
        mergedData.monthlyAggregations = this.calculateMonthlyAggregations(mergedData.timeSeries);
        mergedData.analytics = this.calculateHistoricalAnalytics(mergedData.timeSeries);

        return mergedData;
    }

    // Reuse the same calculation methods from the historical dashboard
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

        // Finalize calculations
        Object.keys(dailyGroups).forEach(date => {
            const day = dailyGroups[date];
            const count = day.decisions.length;
            day.avgPrice = count > 0 ? day.avgPrice / count : 0;
            day.avgTargetTemp = count > 0 ? day.avgTargetTemp / count : 0;
            if (day.minPrice === Infinity) day.minPrice = 0;
        });

        return Object.values(dailyGroups).sort((a, b) => a.date.localeCompare(b.date));
    }

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

    calculateHistoricalAnalytics(timeSeries) {
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
                targetMin: Math.min(...timeSeries.map(o => o.targetTemp).filter(t => t)),
                targetMax: Math.max(...timeSeries.map(o => o.targetTemp).filter(t => t)),
                indoorMin: Math.min(...timeSeries.map(o => o.indoorTemp).filter(t => t)),
                indoorMax: Math.max(...timeSeries.map(o => o.indoorTemp).filter(t => t)),
                outdoorMin: Math.min(...timeSeries.map(o => o.outdoorTemp).filter(t => t)),
                outdoorMax: Math.max(...timeSeries.map(o => o.outdoorTemp).filter(t => t))
            },
            priceStats: {
                min: Math.min(...timeSeries.map(o => o.priceNow).filter(p => p)),
                max: Math.max(...timeSeries.map(o => o.priceNow).filter(p => p)),
                average: timeSeries.reduce((sum, o) => sum + (o.priceNow || 0), 0) / timeSeries.length
            }
        };

        // Count action types and calculate savings
        timeSeries.forEach(opt => {
            analytics.actionTypes[opt.action] = (analytics.actionTypes[opt.action] || 0) + 1;
            if (opt.priceLevel) {
                analytics.priceLevels[opt.priceLevel] = (analytics.priceLevels[opt.priceLevel] || 0) + 1;
            }
            if (opt.savings !== null && opt.savings !== undefined) {
                analytics.savingsStats.total += opt.savings;
                analytics.savingsStats.count++;
                if (opt.savings > 0) analytics.savingsStats.positive++;
                if (opt.savings < 0) analytics.savingsStats.negative++;
            }
        });

        return analytics;
    }

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
            
            // Recalculate metadata
            data.metadata.totalDecisions = afterCount;
            if (data.timeSeries.length > 0) {
                data.metadata.firstDataPoint = data.timeSeries[0].timestamp;
                data.metadata.lastDataPoint = data.timeSeries[data.timeSeries.length - 1].timestamp;
            }
        }

        return data;
    }

    async createBackup(data) {
        const backupFile = path.join(this.backupPath, `backup-${this.currentDate}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
        console.log(`💾 Backup created: ${backupFile}`);

        // Clean up old backups
        const backupFiles = fs.readdirSync(this.backupPath)
            .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
            .sort()
            .reverse();

        if (backupFiles.length > CONFIG.maxBackups) {
            const filesToDelete = backupFiles.slice(CONFIG.maxBackups);
            filesToDelete.forEach(file => {
                fs.unlinkSync(path.join(this.backupPath, file));
                console.log(`🗑️  Removed old backup: ${file}`);
            });
        }
    }

    async saveHistoricalData(data) {
        fs.writeFileSync(this.historicalPath, JSON.stringify(data, null, 2));
        console.log(`💾 Historical data saved: ${this.historicalPath}`);
    }

    async generateHistoricalDashboard(data) {
        // Use the same dashboard template as the historical version
        const dashboardTemplate = this.getDashboardTemplate();
        const dashboardHtml = dashboardTemplate.replace('{{DATA_PLACEHOLDER}}', JSON.stringify(data, null, 2));
        
        fs.writeFileSync(this.dashboardPath, dashboardHtml);
        console.log(`📊 Dashboard generated: ${this.dashboardPath}`);
    }

    getDashboardTemplate() {
        // Simplified dashboard template
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MELCloud Manual Import Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { text-align: center; background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 20px; border-radius: 10px; text-align: center; }
        .stat-value { font-size: 2em; font-weight: bold; color: #2196F3; }
        .stat-label { color: #666; margin-top: 5px; }
        .chart-container { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .chart-title { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; }
        canvas { max-height: 400px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 MELCloud Manual Import Dashboard</h1>
            <p>Historical data from copy-paste imports</p>
            <div id="dataInfo"></div>
        </div>

        <div class="stats-grid" id="statsGrid"></div>
        
        <div class="chart-container">
            <div class="chart-title">📈 Daily Savings Trend</div>
            <canvas id="dailySavingsChart"></canvas>
        </div>

        <div class="chart-container">
            <div class="chart-title">🌡️ Temperature Control</div>
            <canvas id="temperatureChart"></canvas>
        </div>

        <div class="chart-container">
            <div class="chart-title">💰 Price vs Action Analysis</div>
            <canvas id="priceActionChart"></canvas>
        </div>
    </div>

    <script>
        const data = {{DATA_PLACEHOLDER}};
        
        document.addEventListener('DOMContentLoaded', function() {
            createDashboard(data);
        });

        function createDashboard(data) {
            // Update header info
            const startDate = new Date(data.metadata.firstDataPoint).toLocaleDateString();
            const endDate = new Date(data.metadata.lastDataPoint).toLocaleDateString();
            
            document.getElementById('dataInfo').innerHTML = \`
                <strong>Collection Period:</strong> \${startDate} to \${endDate}<br>
                <strong>Total Decisions:</strong> \${data.metadata.totalDecisions.toLocaleString()} | 
                <strong>Import Sessions:</strong> \${data.metadata.importSessions} |
                <strong>Last Updated:</strong> \${new Date(data.metadata.lastUpdated).toLocaleString()}
            \`;

            // Create stats
            const stats = [
                { label: 'Collection Days', value: \`\${data.metadata.dataCollectionDays} days\` },
                { label: 'Total Savings', value: \`\${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK\` },
                { label: 'Avg Daily Savings', value: \`\${((data.analytics.savingsStats.total || 0) / data.metadata.dataCollectionDays).toFixed(2)} SEK/day\` },
                { label: 'Optimization Rate', value: \`\${((data.analytics.actionTypes.temperature_adjusted || 0) / data.metadata.totalDecisions * 100).toFixed(1)}%\` },
                { label: 'Temperature Range', value: \`\${(data.analytics.temperatureStats.targetMin || 0).toFixed(1)}°C - \${(data.analytics.temperatureStats.targetMax || 0).toFixed(1)}°C\` },
                { label: 'Price Range', value: \`\${(data.analytics.priceStats.min || 0).toFixed(2)} - \${(data.analytics.priceStats.max || 0).toFixed(2)} SEK/kWh\` }
            ];

            document.getElementById('statsGrid').innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');

            // Create charts
            createDailySavingsChart(data);
            createTemperatureChart(data);
            createPriceActionChart(data);
        }

        function createDailySavingsChart(data) {
            const ctx = document.getElementById('dailySavingsChart').getContext('2d');
            const dailyData = data.dailyAggregations || [];
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dailyData.map(d => d.date),
                    datasets: [{
                        label: 'Daily Savings (SEK)',
                        data: dailyData.map(d => d.totalSavings),
                        borderColor: '#4CAF50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { 
                            title: { display: true, text: 'Savings (SEK)' },
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        function createTemperatureChart(data) {
            const ctx = document.getElementById('temperatureChart').getContext('2d');
            const recentData = data.timeSeries; // Show all available data instead of limiting to last week
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: recentData.map(d => new Date(d.timestamp).toLocaleDateString()),
                    datasets: [
                        {
                            label: 'Target Temperature (°C)',
                            data: recentData.map(d => d.targetTemp),
                            borderColor: '#FF6B6B',
                            backgroundColor: 'rgba(255, 107, 107, 0.1)'
                        },
                        {
                            label: 'Indoor Temperature (°C)',
                            data: recentData.map(d => d.indoorTemp),
                            borderColor: '#4ECDC4',
                            backgroundColor: 'rgba(78, 205, 196, 0.1)'
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

        function createPriceActionChart(data) {
            const ctx = document.getElementById('priceActionChart').getContext('2d');
            const actionCounts = data.analytics.actionTypes;
            
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(actionCounts),
                    datasets: [{
                        data: Object.values(actionCounts),
                        backgroundColor: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
    </script>
</body>
</html>`;
    }

    async startServer() {
        const server = http.createServer((req, res) => {
            let filePath = path.join(this.outputPath, req.url === '/' ? CONFIG.dashboardFile : req.url);
            
            // Security check
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
            console.log(`📊 Dashboard: http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
            
            // Auto-open browser
            this.openBrowser(`http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
        });
    }

    openBrowser(url) {
        const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
        spawn(start, [url], { detached: true, stdio: 'ignore' });
    }

    printSummary(data) {
        console.log('\n📊 Manual Import Summary:');
        console.log(`📅 Collection Period: ${data.metadata.dataCollectionDays} days`);
        console.log(`🔢 Total Decisions: ${data.metadata.totalDecisions.toLocaleString()}`);
        console.log(`📥 New Decisions Added: ${data.metadata.newDecisionsAdded || 0}`);
        console.log(`📂 Import Sessions: ${data.metadata.importSessions}`);
        console.log(`💰 Total Savings: ${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK`);
        console.log(`📊 Dashboard: http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
        
        console.log('\n💡 Next time: Copy data from Homey settings and run:');
        console.log('   node generate-manual-dashboard.js your-data.json');
    }
}

// Run the manual dashboard generator
if (require.main === module) {
    const generator = new MELCloudManualDashboard();
    generator.run().catch(console.error);
}

module.exports = MELCloudManualDashboard;
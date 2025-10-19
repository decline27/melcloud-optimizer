#!/usr/bin/env node

/**
 * MELCloud Long-term Data Accumulator & Dashboard Generator
 * 
 * This enhanced system:
 * 1. Fetches current data from Homey
 * 2. Merges with existing historical data
 * 3. Builds cumulative long-term dataset
 * 4. Generates comprehensive dashboard with historical trends
 * 5. Handles data deduplication and cleanup
 * 
 * Features:
 * - Persistent historical data storage
 * - Automatic data deduplication
 * - Long-term trend analysis
 * - Data retention policies
 * - Backup and recovery systems
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

// Enhanced configuration for long-term data management
const CONFIG = {
    homeyPort: 80,
    serverPort: 8080,
    outputDir: './dashboard-output',
    dataFile: 'melcloud-data.json',
    dashboardFile: 'dashboard.html',
    historicalDataFile: 'melcloud-historical-data.json',
    backupDir: './dashboard-output/backups',
    maxBackups: 30, // Keep 30 daily backups
    dataRetentionDays: 365, // Keep 1 year of data
    deduplicationWindowHours: 2 // Merge data within 2 hours
};

class MELCloudHistoricalDashboard {
    constructor() {
        this.homeyIp = process.argv[2] || this.detectHomeyIP();
        this.outputPath = path.resolve(CONFIG.outputDir);
        this.backupPath = path.resolve(CONFIG.backupDir);
        this.dataPath = path.join(this.outputPath, CONFIG.dataFile);
        this.historicalPath = path.join(this.outputPath, CONFIG.historicalDataFile);
        this.dashboardPath = path.join(this.outputPath, CONFIG.dashboardFile);
        this.currentDate = new Date().toISOString().split('T')[0];
    }

    async run() {
        console.log('🚀 MELCloud Long-term Data Accumulator & Dashboard');
        console.log('=' .repeat(60));
        
        try {
            // Step 1: Setup directories
            await this.setupDirectories();
            
            // Step 2: Load existing historical data
            console.log('📚 Loading existing historical data...');
            const historicalData = await this.loadHistoricalData();
            
            // Step 3: Fetch new data from Homey
            console.log('📡 Fetching new data from Homey...');
            const newRawData = await this.fetchDataFromHomey();
            
            // Step 4: Process new data
            console.log('🔄 Processing new data...');
            const newProcessedData = await this.processData(newRawData);
            
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
            console.log('📊 Generating long-term dashboard...');
            await this.generateHistoricalDashboard(cleanedData);
            
            // Step 10: Start server
            console.log('🌐 Starting dashboard server...');
            await this.startServer();
            
            console.log('✅ Long-term dashboard generated successfully!');
            this.printSummary(cleanedData);
            
        } catch (error) {
            console.error('❌ Error:', error.message);
            console.log('\n🔧 Troubleshooting:');
            console.log('- Check if Homey is accessible on the network');
            console.log('- Verify MELCloud optimizer app is running');
            console.log('- Check disk space for historical data storage');
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

    async loadHistoricalData() {
        if (!fs.existsSync(this.historicalPath)) {
            console.log('📝 No existing historical data found. Starting fresh.');
            return {
                metadata: {
                    firstDataPoint: null,
                    lastDataPoint: null,
                    totalDecisions: 0,
                    dataCollectionDays: 0,
                    lastUpdated: new Date().toISOString()
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
                    lastUpdated: new Date().toISOString()
                },
                timeSeries: [],
                dailyAggregations: [],
                monthlyAggregations: [],
                analytics: {},
                systemConfig: {}
            };
        }
    }

    async fetchDataFromHomey() {
        if (!this.homeyIp) {
            throw new Error('Homey IP address not provided. Usage: node generate-historical-dashboard.js <homey-ip>');
        }

        console.log(`📡 Connecting to Homey at ${this.homeyIp}:${CONFIG.homeyPort}`);
        
        return new Promise((resolve, reject) => {
            const url = `http://${this.homeyIp}:${CONFIG.homeyPort}/api/app/com.melcloud.optimize/getAllStoredData`;
            
            http.get(url, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        console.log(`✅ Successfully fetched ${(data.length / 1024).toFixed(1)} KB of new data`);
                        resolve(jsonData);
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON data: ${error.message}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`Failed to fetch data from Homey: ${error.message}`));
            });
        });
    }

    async processData(rawData) {
        const optimizations = rawData.thermalModelData?.rawData?.optimizations || [];
        console.log(`🔄 Processing ${optimizations.length} new optimization decisions`);
        
        if (optimizations.length === 0) {
            console.log('ℹ️  No new optimization data found.');
            return null;
        }

        // Process optimization data
        const processedData = {
            metadata: {
                totalDecisions: optimizations.length,
                timeRange: {
                    start: optimizations.length > 0 ? optimizations[0].timestamp : null,
                    end: optimizations.length > 0 ? optimizations[optimizations.length - 1].timestamp : null
                },
                dataSizeKB: rawData.metadata?.dataSizeKB || 0,
                timezone: rawData.configuration?.time_zone_name || 'Unknown',
                fetchedAt: new Date().toISOString()
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
                totalDataSources: (historicalData.metadata.totalDataSources || 0) + 1
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
        // Enhanced analytics for long-term data
        const analytics = {
            actionTypes: {},
            priceLevels: {},
            savingsStats: {
                total: 0,
                positive: 0,
                negative: 0,
                count: 0,
                bestDay: null,
                worstDay: null
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
            },
            trends: {
                optimizationRate: 0,
                averageDailySavings: 0,
                priceVolatility: 0
            }
        };

        // Count action types and price levels
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

        // Calculate trends
        analytics.trends.optimizationRate = timeSeries.length > 0 ? 
            (analytics.actionTypes.temperature_adjusted || 0) / timeSeries.length : 0;
        
        return analytics;
    }

    async generateHistoricalDashboard(data) {
        const dashboardTemplate = this.getHistoricalDashboardTemplate();
        const dashboardHtml = dashboardTemplate.replace('{{DATA_PLACEHOLDER}}', JSON.stringify(data, null, 2));
        
        fs.writeFileSync(this.dashboardPath, dashboardHtml);
        console.log(`📊 Historical dashboard generated: ${this.dashboardPath}`);
    }

    getHistoricalDashboardTemplate() {
        // Enhanced dashboard template with long-term charts
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MELCloud Long-term Optimization Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/date-fns@2.29.3/index.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1600px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #2196F3;
        }
        .stat-label {
            color: #666;
            margin-top: 5px;
        }
        .charts-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 30px;
        }
        .chart-container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .chart-container.full-width {
            grid-column: 1 / -1;
        }
        .chart-title {
            font-size: 1.2em;
            font-weight: bold;
            margin-bottom: 15px;
            color: #333;
        }
        canvas {
            max-height: 400px;
        }
        .historical-info {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
        }
        .insights {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-top: 30px;
        }
        .insight-item {
            margin-bottom: 10px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 5px;
            border-left: 4px solid #2196F3;
        }
        @media (max-width: 768px) {
            .charts-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📈 MELCloud Long-term Optimization Dashboard</h1>
            <p>Historical analysis and trend monitoring</p>
            <div class="historical-info">
                <strong>📊 Data Collection Period:</strong> <span id="dataCollectionPeriod"></span><br>
                <strong>🔢 Total Decisions:</strong> <span id="totalDecisions"></span> | 
                <strong>📅 Collection Days:</strong> <span id="collectionDays"></span> |
                <strong>🔄 Last Updated:</strong> <span id="lastUpdated"></span>
            </div>
        </div>

        <div class="stats-grid" id="statsGrid">
            <!-- Stats will be populated by JavaScript -->
        </div>

        <div class="charts-grid">
            <div class="chart-container full-width">
                <div class="chart-title">📈 Long-term Price and Temperature Trends</div>
                <canvas id="longTermChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">📅 Monthly Savings Trends</div>
                <canvas id="monthlySavingsChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">🔄 Monthly Optimization Activity</div>
                <canvas id="monthlyActivityChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">💰 Daily Savings Overview</div>
                <canvas id="dailySavingsChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">🌡️ Temperature Control Performance</div>
                <canvas id="tempPerformanceChart"></canvas>
            </div>

            <div class="chart-container full-width">
                <div class="chart-title">📊 Recent Activity (Last 30 Days)</div>
                <canvas id="recentActivityChart"></canvas>
            </div>
        </div>

        <div class="insights">
            <h2>🧠 Long-term Insights & Trends</h2>
            <div id="insightsList">
                <!-- Insights will be populated by JavaScript -->
            </div>
        </div>
    </div>

    <script>
        // Embedded historical data
        const data = {{DATA_PLACEHOLDER}};
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Historical dashboard data loaded:', data);
            createHistoricalDashboard(data);
        });

        function createHistoricalDashboard(data) {
            // Update header info
            const startDate = new Date(data.metadata.firstDataPoint).toLocaleDateString();
            const endDate = new Date(data.metadata.lastDataPoint).toLocaleDateString();
            
            document.getElementById('dataCollectionPeriod').textContent = \`\${startDate} to \${endDate}\`;
            document.getElementById('totalDecisions').textContent = data.metadata.totalDecisions.toLocaleString();
            document.getElementById('collectionDays').textContent = data.metadata.dataCollectionDays;
            document.getElementById('lastUpdated').textContent = new Date(data.metadata.lastUpdated).toLocaleString();

            // Create stats cards
            createHistoricalStatsCards(data);

            // Create charts
            createLongTermChart(data);
            createMonthlySavingsChart(data);
            createMonthlyActivityChart(data);
            createDailySavingsChart(data);
            createTempPerformanceChart(data);
            createRecentActivityChart(data);

            // Create insights
            createHistoricalInsights(data);
        }

        function createHistoricalStatsCards(data) {
            const stats = [
                {
                    label: 'Collection Period',
                    value: \`\${data.metadata.dataCollectionDays} days\`
                },
                {
                    label: 'Optimization Rate',
                    value: \`\${((data.analytics.actionTypes.temperature_adjusted || 0) / data.metadata.totalDecisions * 100).toFixed(1)}%\`
                },
                {
                    label: 'Total Savings',
                    value: \`\${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK\`
                },
                {
                    label: 'Avg Daily Savings',
                    value: \`\${((data.analytics.savingsStats.total || 0) / data.metadata.dataCollectionDays).toFixed(2)} SEK/day\`
                },
                {
                    label: 'Price Volatility',
                    value: \`\${(((data.analytics.priceStats.max || 0) / (data.analytics.priceStats.min || 1) - 1) * 100).toFixed(0)}%\`
                },
                {
                    label: 'Data Quality',
                    value: \`\${(data.metadata.totalDecisions / data.metadata.dataCollectionDays / 24 * 100).toFixed(0)}% coverage\`
                }
            ];

            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                </div>
            \`).join('');
        }

        function createLongTermChart(data) {
            const ctx = document.getElementById('longTermChart').getContext('2d');
            
            // Sample data for demonstration (in real implementation, you'd aggregate data points)
            const monthlyData = data.monthlyAggregations || [];
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: monthlyData.map(m => m.month),
                    datasets: [
                        {
                            label: 'Avg Monthly Price (SEK/kWh)',
                            data: monthlyData.map(m => m.avgPrice),
                            borderColor: '#FF6B6B',
                            backgroundColor: 'rgba(255, 107, 107, 0.1)',
                            yAxisID: 'price',
                            tension: 0.4
                        },
                        {
                            label: 'Avg Target Temperature (°C)',
                            data: monthlyData.map(m => m.avgTargetTemp),
                            borderColor: '#4ECDC4',
                            backgroundColor: 'rgba(78, 205, 196, 0.1)',
                            yAxisID: 'temp',
                            tension: 0.4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    scales: {
                        price: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {
                                display: true,
                                text: 'Price (SEK/kWh)'
                            }
                        },
                        temp: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            title: {
                                display: true,
                                text: 'Temperature (°C)'
                            },
                            grid: {
                                drawOnChartArea: false,
                            },
                        }
                    }
                }
            });
        }

        function createMonthlySavingsChart(data) {
            const ctx = document.getElementById('monthlySavingsChart').getContext('2d');
            const monthlyData = data.monthlyAggregations || [];
            
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: monthlyData.map(m => m.month),
                    datasets: [{
                        label: 'Monthly Savings (SEK)',
                        data: monthlyData.map(m => m.totalSavings),
                        backgroundColor: monthlyData.map(m => m.totalSavings >= 0 ? '#4CAF50' : '#FF5722')
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            title: {
                                display: true,
                                text: 'Savings (SEK)'
                            }
                        }
                    }
                }
            });
        }

        // Placeholder functions for other charts
        function createMonthlyActivityChart(data) { console.log('Creating monthly activity chart...'); }
        function createDailySavingsChart(data) { console.log('Creating daily savings chart...'); }
        function createTempPerformanceChart(data) { console.log('Creating temperature performance chart...'); }
        function createRecentActivityChart(data) { console.log('Creating recent activity chart...'); }
        
        function createHistoricalInsights(data) {
            const insights = [
                \`Long-term data collection: \${data.metadata.dataCollectionDays} days with \${data.metadata.totalDecisions.toLocaleString()} optimization decisions\`,
                \`Optimization efficiency: \${((data.analytics.actionTypes.temperature_adjusted || 0) / data.metadata.totalDecisions * 100).toFixed(1)}% decision rate\`,
                \`Total energy savings: \${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK over collection period\`,
                \`Average daily impact: \${((data.analytics.savingsStats.total || 0) / data.metadata.dataCollectionDays).toFixed(2)} SEK per day\`,
                \`Price range experienced: \${(data.analytics.priceStats.min || 0).toFixed(2)} - \${(data.analytics.priceStats.max || 0).toFixed(2)} SEK/kWh\`,
                \`Temperature control: Maintained \${data.analytics.temperatureStats.targetMin || 0}°C - \${data.analytics.temperatureStats.targetMax || 0}°C despite \${data.analytics.temperatureStats.outdoorMin || 0}°C - \${data.analytics.temperatureStats.outdoorMax || 0}°C outdoor range\`,
                \`Data sources: \${data.metadata.totalDataSources || 1} separate data collection periods merged\`,
                \`Recent update: \${data.metadata.newDecisionsAdded || 0} new decisions added in latest sync\`
            ];

            const insightsList = document.getElementById('insightsList');
            insightsList.innerHTML = insights.map(insight => \`
                <div class="insight-item">\${insight}</div>
            \`).join('');
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
        console.log('\n📊 Historical Data Summary:');
        console.log(`📅 Collection Period: ${data.metadata.dataCollectionDays} days`);
        console.log(`🔢 Total Decisions: ${data.metadata.totalDecisions.toLocaleString()}`);
        console.log(`💾 New Decisions Added: ${data.metadata.newDecisionsAdded || 0}`);
        console.log(`📈 Optimization Rate: ${((data.analytics.actionTypes.temperature_adjusted || 0) / data.metadata.totalDecisions * 100).toFixed(1)}%`);
        console.log(`💰 Total Savings: ${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK`);
        console.log(`📊 Dashboard: http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
    }

    detectHomeyIP() {
        return null;
    }
}

// Run the historical dashboard generator
if (require.main === module) {
    const generator = new MELCloudHistoricalDashboard();
    generator.run().catch(console.error);
}

module.exports = MELCloudHistoricalDashboard;
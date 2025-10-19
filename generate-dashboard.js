#!/usr/bin/env node

/**
 * MELCloud Data Dump & Dashboard Generator
 * 
 * This script automates the complete process:
 * 1. Fetches data from Homey app via API
 * 2. Processes and cleans the data
 * 3. Generates visualization dashboard
 * 4. Starts local server to view results
 * 
 * Usage: node generate-dashboard.js [homey-ip-address]
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

// Configuration
const CONFIG = {
    homeyPort: 80,
    serverPort: 8080,
    outputDir: './dashboard-output',
    dataFile: 'melcloud-data.json',
    dashboardFile: 'dashboard.html'
};

class MELCloudDashboardGenerator {
    constructor() {
        this.homeyIp = process.argv[2] || this.detectHomeyIP();
        this.outputPath = path.resolve(CONFIG.outputDir);
        this.dataPath = path.join(this.outputPath, CONFIG.dataFile);
        this.dashboardPath = path.join(this.outputPath, CONFIG.dashboardFile);
    }

    async run() {
        console.log('🚀 MELCloud Data Dump & Dashboard Generator');
        console.log('='.repeat(50));
        
        try {
            // Step 1: Setup output directory
            await this.setupOutputDirectory();
            
            // Step 2: Fetch data from Homey
            console.log('📡 Fetching data from Homey...');
            const rawData = await this.fetchDataFromHomey();
            
            // Step 3: Process and clean data
            console.log('🔄 Processing and cleaning data...');
            const processedData = await this.processData(rawData);
            
            // Step 4: Generate dashboard
            console.log('📊 Generating interactive dashboard...');
            await this.generateDashboard(processedData);
            
            // Step 5: Start server and open dashboard
            console.log('🌐 Starting local server...');
            await this.startServer();
            
            console.log('✅ Dashboard generated successfully!');
            console.log(`📁 Output directory: ${this.outputPath}`);
            console.log(`🌐 Dashboard URL: http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
            
        } catch (error) {
            console.error('❌ Error:', error.message);
            console.log('\n🔧 Troubleshooting:');
            console.log('- Check if Homey is accessible on the network');
            console.log('- Verify MELCloud optimizer app is running');
            console.log('- Ensure the data dump API endpoint is available');
            process.exit(1);
        }
    }

    async setupOutputDirectory() {
        if (!fs.existsSync(this.outputPath)) {
            fs.mkdirSync(this.outputPath, { recursive: true });
            console.log(`📁 Created output directory: ${this.outputPath}`);
        }
    }

    async fetchDataFromHomey() {
        if (!this.homeyIp) {
            throw new Error('Homey IP address not provided. Usage: node generate-dashboard.js <homey-ip>');
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
                        console.log(`✅ Successfully fetched ${(data.length / 1024).toFixed(1)} KB of data`);
                        
                        // Save raw data for backup
                        fs.writeFileSync(path.join(this.outputPath, 'raw-data-backup.json'), data);
                        
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
        console.log('🔄 Processing optimization data...');
        
        // Extract all optimization decisions
        const optimizations = rawData.thermalModelData?.rawData?.optimizations || [];
        console.log(`📊 Found ${optimizations.length} optimization decisions`);
        
        if (optimizations.length === 0) {
            throw new Error('No optimization data found. Ensure the MELCloud optimizer has been running and collecting data.');
        }

        // Process all optimization data
        const processedData = {
            metadata: {
                totalDecisions: optimizations.length,
                timeRange: {
                    start: optimizations.length > 0 ? optimizations[0].timestamp : null,
                    end: optimizations.length > 0 ? optimizations[optimizations.length - 1].timestamp : null
                },
                dataSizeKB: rawData.metadata?.dataSizeKB || 0,
                timezone: rawData.configuration?.time_zone_name || 'Unknown',
                generatedAt: new Date().toISOString()
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
            
            hotWaterData: rawData.hotWaterData,
            adaptiveParameters: rawData.adaptiveParameters,
            thermalCharacteristics: rawData.thermalModelData?.rawData?.lastCalibration?.thermalCharacteristics
        };

        // Calculate analytics
        const analytics = this.calculateAnalytics(optimizations);
        processedData.analytics = analytics;

        // Calculate daily and hourly aggregations
        processedData.dailyAggregations = this.calculateDailyAggregations(processedData.timeSeries);
        processedData.hourlyPatterns = this.calculateHourlyPatterns(processedData.timeSeries);

        // Save processed data
        fs.writeFileSync(this.dataPath, JSON.stringify(processedData, null, 2));
        console.log(`💾 Processed data saved to ${this.dataPath}`);

        return processedData;
    }

    calculateAnalytics(optimizations) {
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

        // Count action types and price levels
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

        return analytics;
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

        return Object.values(dailyGroups);
    }

    calculateHourlyPatterns(timeSeries) {
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

        timeSeries.forEach(decision => {
            const hour = decision.hour;
            const hourGroup = hourlyGroups[hour];
            hourGroup.decisions.push(decision);
            
            if (decision.action === 'temperature_adjusted') hourGroup.tempAdjustments++;
            if (decision.savings) hourGroup.totalSavings += decision.savings;
            if (decision.priceNow) hourGroup.avgPrice += decision.priceNow;
            if (decision.targetTemp) hourGroup.avgTargetTemp += decision.targetTemp;
        });

        // Finalize calculations
        Object.keys(hourlyGroups).forEach(hour => {
            const hourGroup = hourlyGroups[hour];
            const count = hourGroup.decisions.length;
            hourGroup.avgPrice = count > 0 ? hourGroup.avgPrice / count : 0;
            hourGroup.avgTargetTemp = count > 0 ? hourGroup.avgTargetTemp / count : 0;
        });

        return Object.values(hourlyGroups);
    }

    async generateDashboard(data) {
        const dashboardTemplate = this.getDashboardTemplate();
        const dashboardHtml = dashboardTemplate.replace('{{DATA_PLACEHOLDER}}', JSON.stringify(data, null, 2));
        
        fs.writeFileSync(this.dashboardPath, dashboardHtml);
        console.log(`📊 Dashboard generated: ${this.dashboardPath}`);
    }

    getDashboardTemplate() {
        // Return the complete dashboard HTML template
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MELCloud Heat Pump Optimization Dashboard</title>
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
            max-width: 1400px;
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
        .generation-info {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
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
            <h1>🏠 MELCloud Heat Pump Optimization Dashboard</h1>
            <p>Automated data analysis and visualization</p>
            <div class="generation-info">
                <strong>Generated:</strong> <span id="generationTime"></span> | 
                <strong>Data Period:</strong> <span id="dateRange"></span> | 
                <strong>Total Decisions:</strong> <span id="totalDecisions"></span>
            </div>
        </div>

        <div class="stats-grid" id="statsGrid">
            <!-- Stats will be populated by JavaScript -->
        </div>

        <div class="charts-grid">
            <div class="chart-container full-width">
                <div class="chart-title">📈 Price and Temperature Timeline</div>
                <canvas id="timelineChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">💰 Savings vs Price Level</div>
                <canvas id="savingsChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">🔄 Action Types by Price Level</div>
                <canvas id="actionChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">📅 Daily Temperature Adjustments</div>
                <canvas id="dailyChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">🕐 Hourly Optimization Patterns</div>
                <canvas id="hourlyChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">🌡️ Temperature Distribution</div>
                <canvas id="tempDistChart"></canvas>
            </div>

            <div class="chart-container">
                <div class="chart-title">💧 Hot Water Optimization</div>
                <canvas id="hotWaterChart"></canvas>
            </div>
        </div>

        <div class="insights">
            <h2>🧠 Key Insights</h2>
            <div id="insightsList">
                <!-- Insights will be populated by JavaScript -->
            </div>
        </div>
    </div>

    <script>
        // Embedded data
        const data = {{DATA_PLACEHOLDER}};
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Dashboard data loaded:', data);
            createDashboard(data);
        });

        function createDashboard(data) {
            // Update header info
            document.getElementById('generationTime').textContent = new Date(data.metadata.generatedAt).toLocaleString();
            document.getElementById('dateRange').textContent = 
                \`\${data.metadata.timeRange.start.split('T')[0]} to \${data.metadata.timeRange.end.split('T')[0]}\`;
            document.getElementById('totalDecisions').textContent = data.metadata.totalDecisions;

            // Create stats cards
            createStatsCards(data);

            // Create charts
            createTimelineChart(data);
            createSavingsChart(data);
            createActionChart(data);
            createDailyChart(data);
            createHourlyChart(data);
            createTempDistChart(data);
            createHotWaterChart(data);

            // Create insights
            createInsights(data);
        }

        function createStatsCards(data) {
            const stats = [
                {
                    label: 'Temperature Adjustments',
                    value: data.analytics.actionTypes.temperature_adjusted || 0,
                    total: data.metadata.totalDecisions
                },
                {
                    label: 'Total Savings',
                    value: (data.analytics.savingsStats.total || 0).toFixed(2) + ' SEK'
                },
                {
                    label: 'Price Range',
                    value: \`\${(data.analytics.priceStats.min || 0).toFixed(2)} - \${(data.analytics.priceStats.max || 0).toFixed(2)}\`
                },
                {
                    label: 'Avg Price',
                    value: (data.analytics.priceStats.average || 0).toFixed(2) + ' SEK/kWh'
                },
                {
                    label: 'Temp Range',
                    value: \`\${data.analytics.temperatureStats.targetMin || 0}°C - \${data.analytics.temperatureStats.targetMax || 0}°C\`
                },
                {
                    label: 'Outdoor Range',
                    value: \`\${data.analytics.temperatureStats.outdoorMin || 0}°C - \${data.analytics.temperatureStats.outdoorMax || 0}°C\`
                }
            ];

            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = stats.map(stat => \`
                <div class="stat-card">
                    <div class="stat-value">\${stat.value}</div>
                    <div class="stat-label">\${stat.label}</div>
                    \${stat.total ? \`<div class="stat-label">(\${((stat.value / stat.total) * 100).toFixed(1)}%)</div>\` : ''}
                </div>
            \`).join('');
        }

        // Chart creation functions would go here (similar to previous dashboard)
        // ... (including all chart functions from the previous dashboard)
        
        function createTimelineChart(data) {
            const ctx = document.getElementById('timelineChart').getContext('2d');
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Electricity Price (SEK/kWh)',
                            data: data.timeSeries.map(d => ({
                                x: d.timestamp,
                                y: d.priceNow
                            })).filter(d => d.y),
                            borderColor: '#FF6B6B',
                            backgroundColor: 'rgba(255, 107, 107, 0.1)',
                            yAxisID: 'price',
                            tension: 0.4
                        },
                        {
                            label: 'Target Temperature (°C)',
                            data: data.timeSeries.map(d => ({
                                x: d.timestamp,
                                y: d.targetTemp
                            })).filter(d => d.y),
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
                        x: {
                            type: 'time',
                            time: {
                                displayFormats: {
                                    hour: 'MMM dd HH:mm'
                                }
                            }
                        },
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
        
        // Placeholder functions for other charts
        function createSavingsChart(data) { console.log('Creating savings chart...'); }
        function createActionChart(data) { console.log('Creating action chart...'); }
        function createDailyChart(data) { console.log('Creating daily chart...'); }
        function createHourlyChart(data) { console.log('Creating hourly chart...'); }
        function createTempDistChart(data) { console.log('Creating temperature distribution chart...'); }
        function createHotWaterChart(data) { console.log('Creating hot water chart...'); }
        
        function createInsights(data) {
            const insights = [
                \`System made \${data.analytics.actionTypes.temperature_adjusted || 0} temperature adjustments out of \${data.metadata.totalDecisions} total decisions\`,
                \`Price range: \${(data.analytics.priceStats.min || 0).toFixed(2)} - \${(data.analytics.priceStats.max || 0).toFixed(2)} SEK/kWh\`,
                \`Temperature maintained: \${data.analytics.temperatureStats.targetMin || 0}°C - \${data.analytics.temperatureStats.targetMax || 0}°C\`,
                \`Total savings: \${(data.analytics.savingsStats.total || 0).toFixed(2)} SEK\`,
                \`Data collected over \${data.dailyAggregations.length} days\`
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
            
            // Auto-open browser (optional)
            this.openBrowser(`http://localhost:${CONFIG.serverPort}/${CONFIG.dashboardFile}`);
        });
    }

    openBrowser(url) {
        const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
        spawn(start, [url], { detached: true, stdio: 'ignore' });
    }

    detectHomeyIP() {
        // Try to detect Homey IP from common patterns or return null
        // This could be enhanced with network discovery
        return null;
    }
}

// Run the generator
if (require.main === module) {
    const generator = new MELCloudDashboardGenerator();
    generator.run().catch(console.error);
}

module.exports = MELCloudDashboardGenerator;
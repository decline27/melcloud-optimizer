# MELCloud Historical Data Dashboard

## 📈 Long-term Data Accumulation System

This enhanced dashboard system automatically accumulates historical data over time, preserving optimization decisions even when Homey data gets cleaned out. Perfect for long-term trend analysis and performance monitoring.

## 🚀 Quick Start

### One-Command Launch

**Linux/macOS:**
```bash
./launch-historical-dashboard.sh <your-homey-ip>
```

**Windows:**
```powershell
.\launch-historical-dashboard.ps1 <your-homey-ip>
```

Example:
```bash
./launch-historical-dashboard.sh 192.168.1.100
```

The system will:
1. 📡 Fetch current data from Homey
2. 🔗 Merge with existing historical data
3. 📊 Generate comprehensive long-term dashboard
4. 🌐 Launch server at http://localhost:8080
5. 🖥️ Automatically open dashboard in browser

## 📊 Historical Data Features

### Automatic Data Accumulation
- **Persistent Storage**: Data survives Homey cleanups and app restarts
- **Deduplication**: Automatically removes duplicate optimization decisions
- **Long-term Trends**: Builds comprehensive historical dataset over months/years
- **Data Retention**: Configurable retention period (default: 365 days)

### Enhanced Analytics
- **Monthly Aggregations**: Track performance trends over time
- **Seasonal Analysis**: Compare winter vs summer optimization patterns  
- **Long-term Savings**: Cumulative savings calculation across all time periods
- **Performance Metrics**: Optimization rate, temperature control, price volatility

### Data Management
- **Automatic Backups**: Daily backups with 30-day retention
- **Data Validation**: Ensures data integrity and consistency
- **Memory Management**: Efficient storage with compression and cleanup
- **Export Options**: Full data export for external analysis

## 🔄 Regular Data Collection

### Manual Collection
Run the launcher script whenever you want to update your historical data:
```bash
./launch-historical-dashboard.sh 192.168.1.100
```

### Automated Collection (Recommended)

**Linux/macOS Cron Job:**
```bash
# Edit crontab
crontab -e

# Add line for daily 6 AM collection
0 6 * * * cd /path/to/melcloud && ./launch-historical-dashboard.sh 192.168.1.100
```

**Windows Scheduled Task:**
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger: Daily at 6:00 AM
4. Action: Start a program
5. Program: `powershell.exe`
6. Arguments: `-File "C:\path\to\launch-historical-dashboard.ps1" 192.168.1.100`

## 📁 File Structure

```
dashboard-output/
├── dashboard.html              # Generated historical dashboard
├── melcloud-data.json         # Latest data from Homey
├── melcloud-historical-data.json  # Accumulated historical dataset
└── backups/                   # Automatic daily backups
    ├── backup-2024-10-19.json
    ├── backup-2024-10-18.json
    └── ... (up to 30 days)
```

## ⚙️ Configuration

### Data Retention
Edit `generate-historical-dashboard.js` to customize:
```javascript
const CONFIG = {
    dataRetentionDays: 365,     // Keep 1 year of data
    maxBackups: 30,             // Keep 30 daily backups
    deduplicationWindowHours: 2 // Merge data within 2 hours
};
```

### Dashboard Settings
- **Server Port**: Default 8080, change in CONFIG.serverPort
- **Output Directory**: Default './dashboard-output'
- **Backup Policy**: Automatic daily backups with cleanup

## 📊 Dashboard Components

### Long-term Charts
- **Price & Temperature Trends**: Multi-month price and temperature correlation
- **Monthly Savings**: Month-over-month savings comparison
- **Optimization Activity**: Decision frequency and effectiveness over time
- **Temperature Performance**: Indoor climate maintenance vs outdoor conditions

### Key Metrics
- **Collection Period**: Total days of data collection
- **Optimization Rate**: Percentage of decisions that adjusted temperature
- **Total Savings**: Cumulative savings across all time periods
- **Data Quality**: Coverage percentage (decisions per hour)
- **Price Volatility**: Price variation over collection period

### Historical Insights
- Long-term performance trends
- Seasonal optimization patterns
- Price impact analysis
- System efficiency evolution
- Data collection statistics

## 🔧 Troubleshooting

### Common Issues

**"No historical data found"**
- Normal on first run - data will accumulate over time
- Previous data in `melcloud-historical-data.json` if exists

**"Failed to fetch data from Homey"**
- Check Homey IP address and network connectivity
- Verify MELCloud optimizer app is running
- Ensure Homey is powered on and accessible

**"Data merge conflicts"**
- System automatically handles deduplication
- Check logs for specific merge issues
- Backup files preserved in case of problems

**Large file sizes**
- Data automatically cleaned based on retention policy
- Backups managed with automatic cleanup
- Monitor disk space if collecting for extended periods

### Data Recovery
If historical data becomes corrupted:
1. Check backup files in `dashboard-output/backups/`
2. Copy most recent backup to `melcloud-historical-data.json`
3. Run dashboard generator to verify integrity

### Performance Optimization
For systems with extensive historical data:
- Increase retention cleanup frequency
- Reduce backup retention period
- Monitor memory usage during processing

## 🚀 Advanced Usage

### Custom Analysis
Export historical data for external analysis:
```bash
# Export full dataset
cp dashboard-output/melcloud-historical-data.json my-analysis/

# Extract specific time periods
jq '.timeSeries[] | select(.date >= "2024-01-01" and .date <= "2024-03-31")' melcloud-historical-data.json > q1-2024.json
```

### Integration with Other Tools
The JSON data format is compatible with:
- Python pandas for data science analysis
- R for statistical analysis
- Excel for business reporting
- Grafana for real-time monitoring

### API Access
Access raw data via local API when server is running:
- `http://localhost:8080/melcloud-historical-data.json` - Full historical dataset
- `http://localhost:8080/melcloud-data.json` - Latest Homey data

## 📈 Long-term Benefits

### Performance Monitoring
- Track optimization effectiveness over seasons
- Identify long-term trends and patterns
- Monitor system performance degradation
- Validate configuration changes

### Cost Analysis
- Calculate annual savings projections
- Compare different optimization strategies
- Analyze ROI of system improvements
- Track energy cost trends

### System Optimization
- Identify optimal settings for different seasons
- Fine-tune comfort vs savings balance
- Optimize based on historical weather patterns
- Improve predictions with larger datasets

---

**💡 Pro Tip**: Set up automated daily collection to build a comprehensive dataset. The more data you collect, the better insights you'll get about your heat pump optimization performance!

For support or questions, check the troubleshooting section above or review the dashboard logs for detailed error information.
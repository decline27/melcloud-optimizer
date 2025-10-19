# MELCloud Manual Data Import Dashboard

## 📋 Copy-Paste Historical Data System

This system is designed to work with **manual copy-paste data** from your Homey settings page, making it perfect when direct API access isn't available. It builds long-term historical datasets by accumulating data from multiple imports over time.

## 🚀 Quick Start

### Step 1: Get Your Data from Homey
1. Open Homey mobile app or web interface
2. Navigate to **MELCloud optimizer app settings**
3. Click the **"Data Dump"** button
4. **Copy the entire JSON data** that appears

### Step 2: Import Your Data

**Option A: Save to file and import**
```bash
# Save the copied data to a file (e.g., homey-data.json)
./launch-manual-dashboard.sh homey-data.json
```

**Option B: Direct paste (interactive)**
```bash
# Run without arguments, then paste when prompted
./launch-manual-dashboard.sh
# Paste your JSON data and press Ctrl+D (Mac/Linux) or Ctrl+Z+Enter (Windows)
```

**Option C: Pipe from file**
```bash
cat homey-data.json | ./launch-manual-dashboard.sh
```

### Windows Users:
```powershell
# File import
.\launch-manual-dashboard.ps1 homey-data.json

# Interactive mode
.\launch-manual-dashboard.ps1

# Pipeline
Get-Content homey-data.json | .\launch-manual-dashboard.ps1
```

## 📈 How It Works

### First Import
- Creates new historical dataset
- Processes all optimization decisions from your data
- Generates dashboard with initial analysis
- Starts server at http://localhost:8080

### Subsequent Imports
- **Automatically merges** new data with existing historical data
- **Deduplicates** overlapping decisions (no double counting)
- **Preserves** long-term trends across imports
- **Updates** dashboard with comprehensive historical view

### Data Persistence
- **Historical data**: Stored in `dashboard-output/melcloud-historical-data.json`
- **Daily backups**: Automatic backups in `dashboard-output/backups/`
- **Data retention**: Configurable (default: 365 days)
- **Import tracking**: Counts import sessions and tracks data sources

## 📊 Dashboard Features

### Overview Statistics
- **Collection Period**: Total days of data accumulated
- **Total Savings**: Cumulative savings across all imports
- **Optimization Rate**: Percentage of decisions that adjusted temperature
- **Import Sessions**: Number of times you've imported data

### Historical Charts
- **Daily Savings Trend**: Track savings performance over time
- **Temperature Control**: Indoor/outdoor temperature correlation
- **Price vs Action Analysis**: How price levels influence decisions
- **Monthly Aggregations**: Long-term trend analysis

### Smart Analytics
- **Seasonal Patterns**: Compare winter vs summer performance
- **Price Impact**: How electricity prices affect optimization
- **Temperature Efficiency**: Indoor climate maintenance effectiveness
- **Long-term ROI**: Total energy cost savings over time

## 🔄 Regular Data Collection Workflow

### Recommended Schedule
1. **Weekly imports** during initial setup (first month)
2. **Bi-weekly imports** for ongoing monitoring
3. **Monthly imports** for long-term trend tracking

### Best Practices
1. **Save your data dumps** with descriptive filenames:
   ```
   homey-data-2024-10-19.json
   homey-data-2024-10-26.json
   homey-data-2024-11-02.json
   ```

2. **Import regularly** to build comprehensive historical data:
   ```bash
   # Weekly import example
   ./launch-manual-dashboard.sh homey-data-$(date +%Y-%m-%d).json
   ```

3. **Keep backups** of your historical data (automatic daily backups included)

## 📁 File Structure

```
dashboard-output/
├── dashboard.html                    # Generated dashboard
├── melcloud-data.json               # Latest imported data
├── melcloud-historical-data.json    # Accumulated historical dataset
└── backups/                         # Automatic daily backups
    ├── backup-2024-10-19.json
    ├── backup-2024-10-18.json
    └── ...
```

## 🔧 Advanced Usage

### Batch Import Multiple Files
```bash
# Import multiple data dumps at once
for file in homey-data-*.json; do
    echo "Importing $file..."
    ./launch-manual-dashboard.sh "$file"
    sleep 2
done
```

### Data Validation
The system automatically:
- ✅ **Validates JSON format** before processing
- ✅ **Checks for optimization data** in multiple locations
- ✅ **Deduplicates decisions** based on timestamp + index
- ✅ **Handles different data structures** (various MELCloud versions)

### Export Historical Data
```bash
# Export complete historical dataset
cp dashboard-output/melcloud-historical-data.json my-analysis/

# Extract specific time periods with jq
jq '.timeSeries[] | select(.date >= "2024-01-01" and .date <= "2024-03-31")' \
   dashboard-output/melcloud-historical-data.json > q1-2024.json
```

## 🔍 Troubleshooting

### "No optimization data found"
**Possible causes:**
- Incomplete copy from Homey settings (make sure you copy ALL the JSON)
- MELCloud app hasn't been running long enough to collect data
- Different data structure than expected

**Solutions:**
1. Copy the **complete JSON output** from Homey settings
2. Verify the JSON is valid (check brackets, quotes, commas)
3. Make sure MELCloud optimizer has been running and collecting data

### "Invalid JSON input"
**Solutions:**
1. Check for missing commas, brackets, or quotes
2. Use a JSON validator online to check syntax
3. Save data to file first, then import from file

### "File not found"
**Solutions:**
1. Check file path and spelling
2. Make sure you're in the correct directory
3. Use absolute file paths if needed

### Large File Sizes
**Management:**
- Historical data is automatically cleaned based on retention policy
- Backups are managed with automatic cleanup
- Use data retention settings to control size

## 📊 Data Structure Support

The system automatically detects optimization data in multiple locations:
- `thermalModelData.rawData.optimizations` (standard location)
- `optimizations` (root level)
- `optimizationData`
- `decisions`
- Any array containing objects with `timestamp`, `action`, or `targetTemp`

## 🎯 Perfect For...

✅ **Manual data management** - No need for direct Homey API access  
✅ **Long-term analysis** - Build datasets over months/years  
✅ **Regular monitoring** - Easy weekly/monthly data imports  
✅ **Data preservation** - Survive Homey data cleanups  
✅ **Offline analysis** - Work with exported data anytime  
✅ **Flexible import** - Multiple input methods supported  

## 🚀 Next Steps

1. **First Import**: Get your data from Homey settings and import it
2. **Regular Schedule**: Set up weekly/monthly imports to build history
3. **Analysis**: Use the dashboard to track long-term trends and savings
4. **Optimization**: Use insights to improve your heat pump settings

---

**💡 Pro Tip**: The more data you import over time, the better insights you'll get! Start importing regularly to build a comprehensive view of your heat pump optimization performance.
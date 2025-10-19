# MELCloud Enhanced Analytics Dashboard

## 🚀 **Comprehensive Data Analysis System**

The enhanced dashboard includes **ALL available data points** from your MELCloud optimization system, providing deep insights into heat pump performance, price correlation, weather impact, and system efficiency.

## 📊 **Complete Data Points Included**

### **✅ Temperature Data**
- **Target Temperature**: Set by optimization system
- **Indoor Temperature**: Actual measured indoor temperature  
- **Outdoor Temperature**: Weather-based outdoor temperature
- **Temperature Differentials**: Indoor vs outdoor, target vs actual
- **Comfort Analysis**: Temperature gaps and comfort violations

### **✅ Price & Economic Data**  
- **Current Price** (`priceNow`/`price`): Real-time electricity price
- **Price Level** (`priceLevel`): Categorized price levels (cheap, normal, expensive)
- **Price Percentile** (`pricePercentile`): Price ranking vs historical data
- **Price Ranges**: Min, max, average price analysis
- **Price Volatility**: Daily and hourly price variation
- **Savings Calculations**: Economic impact of optimization decisions

### **✅ Weather Integration**
- **Weather Temperature** (`weatherTemp`): External weather service data  
- **Weather Symbol** (`weatherSymbol`): Weather condition indicators
- **Weather Adjustments**: How weather impacts optimization decisions
- **Seasonal Analysis**: Winter, spring, summer, autumn patterns

### **✅ Hot Water Optimization**
- **Hot Water Changes** (`hotWaterChanged`): When hot water heating occurs
- **Temperature From/To** (`hotWaterFrom`/`hotWaterTo`): Water temperature changes
- **Hot Water Patterns**: Hourly usage patterns and optimization
- **Energy Impact**: Hot water heating cost and efficiency

### **✅ System Performance**
- **Optimization Actions**: Temperature adjustments, holds, boosts
- **Action Reasons**: Why each optimization decision was made
- **Savings Tracking**: Positive and negative savings per decision
- **Efficiency Metrics**: System performance and effectiveness

### **✅ Temporal Patterns** 
- **Hourly Patterns**: 24-hour optimization cycles
- **Daily Aggregations**: Day-by-day performance summaries
- **Weekly Patterns**: Monday-Sunday optimization trends
- **Monthly Trends**: Long-term seasonal analysis
- **Date/Time Stamps**: Precise timing of all decisions

### **✅ Historical Data Management**
- **Data Accumulation**: Builds long-term datasets over time
- **Deduplication**: Prevents double-counting of decisions
- **Import Tracking**: Sessions, sources, update timestamps
- **Data Retention**: Configurable historical data preservation
- **Backup System**: Automatic daily backups with recovery

## 📈 **Dashboard Sections**

### **1. 📊 Overview Tab**
- **Key Statistics**: Total decisions, savings, optimization rate, collection period
- **Daily Overview Chart**: Combined savings and optimization activity trends  
- **Action Distribution**: Pie chart of optimization action types
- **Monthly Trends**: Long-term performance aggregation

### **2. 💰 Price Analysis Tab**
- **Price Statistics**: Range, average, volatility metrics
- **Price Level Distribution**: Cheap/normal/expensive price frequency
- **Price vs Optimization**: Correlation between price levels and actions
- **Price Trends vs Savings**: How price changes affect economic outcomes

### **3. 🌡️ Weather & Comfort Tab**
- **Comfort Metrics**: Temperature gaps, comfort violations, ranges
- **Temperature Range Analysis**: Optimization behavior at different outdoor temperatures
- **Indoor vs Outdoor Correlation**: Temperature relationship analysis
- **Comfort Gap Tracking**: Target vs actual temperature differences

### **4. ⏰ Patterns Tab**
- **Hourly Optimization Patterns**: 24-hour activity cycles
- **Weekday Analysis**: Monday-Sunday optimization differences  
- **Seasonal Comparison**: Winter vs summer vs spring vs autumn performance
- **Peak Activity Identification**: When optimization happens most

### **5. 🚿 Hot Water Tab**
- **Hot Water Statistics**: Total changes, average temperature increases
- **Hourly Hot Water Patterns**: When hot water heating occurs
- **Temperature Change Analysis**: How much hot water temperature increases
- **Energy Impact**: Hot water contribution to overall system performance

### **6. ⚡ Efficiency Tab**
- **Efficiency Metrics**: Heating efficiency ratings and calculations
- **Optimization Effectiveness**: Economic return per optimization action
- **Performance Tracking**: System efficiency over time
- **ROI Analysis**: Return on investment for optimization decisions

### **7. 🧠 Smart Insights**
- **AI-Powered Analysis**: Automated insights from comprehensive data
- **Performance Recommendations**: Suggestions based on data patterns
- **Trend Identification**: Key patterns and performance indicators
- **System Health**: Overall optimization system effectiveness

## 🔄 **Data Processing Features**

### **Smart Data Detection**
The system automatically finds optimization data in multiple possible locations:
- `thermalModelData.rawData.optimizations` (standard location)
- `timeSeries` (your data format)  
- `optimizations` (root level)
- `decisions` (alternative naming)
- Auto-detection of arrays with timestamp/action/targetTemp fields

### **Field Mapping**
Handles multiple field name variations:
- Price: `priceNow`, `price`
- Hot water: `hotWaterFrom`/`hotWaterTo`, `tankData.fromTemp`/`tankData.toTemp` 
- Weather: `weatherTemp`, `weather.current.temperature`
- And many more field variations for maximum compatibility

### **Enhanced Analytics**
- **Correlation Analysis**: Price vs optimization, weather vs efficiency
- **Pattern Recognition**: Identifies hourly, daily, seasonal trends
- **Performance Metrics**: Calculates efficiency and effectiveness scores
- **Comparative Analysis**: Compares different time periods and conditions

## 🚀 **Usage**

### **Quick Start**
```bash
./launch-enhanced-dashboard.sh your-data.json
```

### **Interactive Mode**  
```bash
./launch-enhanced-dashboard.sh
# Paste your JSON data when prompted
```

### **Pipeline Mode**
```bash  
cat homey-data.json | ./launch-enhanced-dashboard.sh
```

## 📊 **Dashboard Features**

### **Interactive Navigation**
- **Tabbed Interface**: Easy navigation between analysis sections
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Real-time Charts**: Interactive Chart.js visualizations
- **Data Export**: Access raw data via JSON endpoints

### **Visual Analytics**
- **Line Charts**: Trends over time (savings, temperature, prices)
- **Bar Charts**: Comparative analysis (monthly, seasonal, hourly)
- **Pie Charts**: Distribution analysis (actions, price levels)
- **Correlation Charts**: Multi-axis analysis (price vs optimization)
- **Heatmaps**: Pattern visualization (hourly, weekly)

### **Statistical Analysis**
- **Descriptive Statistics**: Means, ranges, distributions
- **Correlation Analysis**: Relationship between variables
- **Trend Analysis**: Time-series pattern identification  
- **Performance Metrics**: Efficiency and effectiveness calculations

## 💾 **Data Management**

### **Historical Accumulation**
- Preserves data across Homey cleanups
- Builds comprehensive long-term datasets
- Automatic deduplication prevents double-counting
- Configurable retention policies (default: 365 days)

### **Backup & Recovery** 
- Daily automatic backups (30-day retention)
- Full data export capabilities
- Recovery from backup files
- Data integrity validation

### **Import Tracking**
- Counts import sessions
- Tracks data sources and timestamps
- Monitors data quality and completeness
- Validates data consistency

## 🎯 **Perfect For**

✅ **Comprehensive Analysis** - Every available data point included  
✅ **Long-term Trending** - Historical data accumulation over months/years  
✅ **Performance Optimization** - Identify best settings and patterns  
✅ **Cost Analysis** - Detailed economic impact assessment  
✅ **System Monitoring** - Health and efficiency tracking  
✅ **Pattern Discovery** - Hourly, daily, seasonal insights  
✅ **Weather Correlation** - Temperature and weather impact analysis  
✅ **Hot Water Optimization** - Dedicated hot water analysis  

## 🔍 **Data Insights Available**

- **When does optimization happen most?** (hourly patterns)
- **What price levels trigger optimization?** (price correlation)  
- **How does weather affect efficiency?** (temperature analysis)
- **What's the economic impact?** (savings tracking)
- **Are there seasonal differences?** (seasonal analysis)
- **How effective is hot water optimization?** (hot water patterns)
- **Is the system maintaining comfort?** (comfort gap analysis)
- **What's the long-term trend?** (historical aggregation)

---

**🎉 This enhanced dashboard includes EVERY data point from your MELCloud system, providing the most comprehensive heat pump optimization analysis available!**

**Ready to use:** `./launch-enhanced-dashboard.sh your-data.json`
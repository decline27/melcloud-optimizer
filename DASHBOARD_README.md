# 📊 MELCloud Automated Dashboard Generator

An all-in-one system that automatically dumps data from your MELCloud Heat Pump Optimizer and generates beautiful interactive dashboards.

## 🚀 Quick Start

### Prerequisites
- **Node.js** (version 14 or higher) - [Download here](https://nodejs.org/)
- **Homey device** on your local network with MELCloud Optimizer app installed
- **Network access** to your Homey device

### 🏃‍♂️ One-Command Launch

#### On macOS/Linux:
```bash
./launch-dashboard.sh <your-homey-ip>
```

#### On Windows (PowerShell):
```powershell
.\launch-dashboard.ps1 -HomeyIP <your-homey-ip>
```

#### Direct Node.js:
```bash
node generate-dashboard.js <your-homey-ip>
```

### 🔍 Finding Your Homey IP Address

1. **Homey Mobile App:**
   - Open Homey app → Settings → General → Network
   - Note the IP address (e.g., `192.168.1.100`)

2. **Router Admin Panel:**
   - Log into your router
   - Look for connected devices
   - Find "Homey" in the device list

3. **Network Scanner:**
   - Use tools like `nmap` or "Network Analyzer" apps
   - Scan your local network for Homey

## 📋 What It Does

### 🔄 Automated Process:
1. **Data Fetch** - Connects to Homey and fetches all optimization data via API
2. **Data Processing** - Cleans and analyzes the raw data
3. **Dashboard Generation** - Creates interactive visualizations
4. **Server Launch** - Starts local web server and opens dashboard
5. **Real-time Access** - Provides live dashboard at `http://localhost:8080`

### 📊 Generated Visualizations:
- **📈 Price & Temperature Timeline** - Shows price responsiveness over time
- **💰 Savings Analysis** - Correlation between prices and energy savings
- **🔄 Action Distribution** - When system makes temperature adjustments
- **📅 Daily Patterns** - Optimization activity by day
- **🕐 Hourly Trends** - Peak activity times and price patterns
- **🌡️ Temperature Distribution** - Comfort range maintenance
- **💧 Hot Water Optimization** - Price-responsive hot water heating

### 📈 Analytics Included:
- Total optimization decisions and success rate
- Price volatility and responsiveness metrics
- Temperature comfort maintenance statistics
- Energy savings and cost impact analysis
- Learning system confidence levels
- Peak usage and optimization periods

## 📁 Output Structure

```
dashboard-output/
├── dashboard.html          # Interactive dashboard (main file)
├── melcloud-data.json     # Processed visualization data
└── raw-data-backup.json   # Raw data backup
```

## ⚙️ Configuration

Edit `dashboard-config.json` to customize:

```json
{
  "homey": {
    "ip": "",                    # Your Homey IP
    "port": 80                   # Homey port (usually 80)
  },
  "server": {
    "port": 8080,               # Dashboard server port
    "autoOpen": true            # Auto-open browser
  },
  "output": {
    "directory": "./dashboard-output",
    "backupRawData": true       # Keep raw data backup
  }
}
```

## 🔧 Advanced Usage

### Manual Steps:
```bash
# 1. Fetch data only
node generate-dashboard.js <homey-ip> --data-only

# 2. Generate dashboard from existing data
node generate-dashboard.js --dashboard-only

# 3. Start server for existing dashboard
cd dashboard-output && python3 -m http.server 8080
```

### 🔄 Continuous Monitoring:
```bash
# Run every hour
while true; do
  node generate-dashboard.js <homey-ip>
  sleep 3600
done
```

### 📊 Data Export:
- **JSON Format**: `dashboard-output/melcloud-data.json`
- **Raw Backup**: `dashboard-output/raw-data-backup.json`
- **CSV Export**: Use data processing scripts

## 🛠️ Troubleshooting

### ❌ Common Issues:

#### "Cannot connect to Homey"
- ✅ Verify Homey IP address
- ✅ Check network connectivity: `ping <homey-ip>`
- ✅ Ensure Homey is on same network
- ✅ Check firewall settings

#### "No optimization data found"
- ✅ MELCloud Optimizer app must be running
- ✅ Wait for app to collect data (may take hours/days)
- ✅ Check app settings and operation

#### "Port already in use"
- ✅ Kill existing server: `lsof -ti:8080 | xargs kill`
- ✅ Use different port: `node generate-dashboard.js <ip> --port 8081`

#### "Node.js not found"
- ✅ Install Node.js from [nodejs.org](https://nodejs.org/)
- ✅ Restart terminal after installation
- ✅ Verify with: `node --version`

### 🔍 Debug Mode:
```bash
DEBUG=1 node generate-dashboard.js <homey-ip>
```

## 📚 Understanding Your Data

### 🎯 Key Metrics:

- **Optimization Rate**: % of decisions that adjust temperature
- **Price Responsiveness**: More activity during extreme price periods
- **Comfort Maintenance**: Temperature stays within set range
- **Learning Progress**: System confidence in different areas

### 📈 Interpreting Charts:

- **High price volatility** = More optimization opportunities
- **Temperature adjustments during cheap periods** = Good price response
- **Stable comfort range** = Effective temperature control
- **Negative savings during learning** = Normal initial behavior

### 🧠 System Learning:

- **Hot Water**: Usually reaches 100% confidence quickly
- **Thermal Model**: Takes weeks to build confidence
- **Adaptive Parameters**: Learns from every optimization cycle

## 🚀 Integration Ideas

### 📱 Home Assistant:
```yaml
# automation.yaml
- alias: "Generate MELCloud Dashboard"
  trigger:
    - platform: time
      at: "06:00:00"
  action:
    - service: shell_command.melcloud_dashboard
```

### 🐳 Docker:
```dockerfile
FROM node:16-alpine
COPY . /app
WORKDIR /app
CMD ["node", "generate-dashboard.js"]
```

### ☁️ Cloud Hosting:
- Deploy to **Heroku**, **Vercel**, or **Netlify**
- Set up automated data fetching
- Create public dashboard URLs

## 📝 License & Support

- **License**: Same as MELCloud Optimizer project
- **Issues**: Report via GitHub issues
- **Contributions**: PRs welcome!

## 🎉 What's Next?

- 🔄 **Auto-refresh** dashboards
- 📧 **Email reports** with insights
- 📱 **Mobile-optimized** views
- 🤖 **AI-powered** recommendations
- 📊 **Export to Excel/PDF**
- 🌐 **Multi-device** monitoring

---

**Happy optimizing! 🏠⚡💡**
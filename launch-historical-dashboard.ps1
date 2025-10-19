# MELCloud Historical Dashboard Launcher (PowerShell)
# This script launches the long-term data accumulation system

Write-Host "🚀 MELCloud Historical Dashboard Launcher" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# Check if Homey IP is provided
if ($args.Length -eq 0) {
    Write-Host "❌ Error: Homey IP address required" -ForegroundColor Red
    Write-Host "Usage: .\launch-historical-dashboard.ps1 <homey-ip>" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Example: .\launch-historical-dashboard.ps1 192.168.1.100" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "💡 Tips:" -ForegroundColor Cyan
    Write-Host "- Find your Homey IP in the Homey mobile app under Settings > Network"
    Write-Host "- Make sure you're on the same network as your Homey"
    Write-Host "- The script will accumulate data over time, preserving history"
    exit 1
}

$HomeyIP = $args[0]

# Validate IP format
if ($HomeyIP -notmatch '^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$') {
    Write-Host "❌ Error: Invalid IP address format" -ForegroundColor Red
    Write-Host "Please provide a valid IP address like 192.168.1.100" -ForegroundColor Yellow
    exit 1
}

# Check if Node.js is available
try {
    $NodeVersion = node --version
    Write-Host "✅ Node.js detected: $NodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Node.js is not installed" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check if historical dashboard generator exists
if (!(Test-Path "generate-historical-dashboard.js")) {
    Write-Host "❌ Error: generate-historical-dashboard.js not found" -ForegroundColor Red
    Write-Host "Please make sure you're running this script from the correct directory" -ForegroundColor Yellow
    exit 1
}

Write-Host "🔍 Connecting to Homey at $HomeyIP..." -ForegroundColor Blue
Write-Host "📊 Generating historical dashboard with data accumulation..." -ForegroundColor Blue
Write-Host ""

# Launch the historical dashboard generator
& node generate-historical-dashboard.js $HomeyIP

# Check exit status
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Historical dashboard launched successfully!" -ForegroundColor Green
    Write-Host "🌐 Access your dashboard at: http://localhost:8080" -ForegroundColor Cyan
    Write-Host "📈 Historical data is automatically preserved between runs" -ForegroundColor Cyan
    Write-Host "🔄 Run this script regularly to build long-term trends" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "💡 Pro tip: Set up a scheduled task to automatically update your historical data:" -ForegroundColor Yellow
    Write-Host "   Use Task Scheduler to run this script daily at 6 AM" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "❌ Dashboard generation failed. Check the error messages above." -ForegroundColor Red
    Write-Host "🔧 Troubleshooting tips:" -ForegroundColor Yellow
    Write-Host "- Verify Homey is powered on and connected to network"
    Write-Host "- Check if MELCloud optimizer app is running on Homey"
    Write-Host "- Ensure sufficient disk space for historical data storage"
    Write-Host "- Try restarting the MELCloud optimizer app on Homey"
}
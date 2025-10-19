#!/bin/bash

# MELCloud Historical Dashboard Launcher
# This script launches the long-term data accumulation system

echo "🚀 MELCloud Historical Dashboard Launcher"
echo "=========================================="

# Check if Homey IP is provided
if [ -z "$1" ]; then
    echo "❌ Error: Homey IP address required"
    echo "Usage: $0 <homey-ip>"
    echo ""
    echo "Example: $0 192.168.1.100"
    echo ""
    echo "💡 Tips:"
    echo "- Find your Homey IP in the Homey mobile app under Settings > Network"
    echo "- Make sure you're on the same network as your Homey"
    echo "- The script will accumulate data over time, preserving history"
    exit 1
fi

HOMEY_IP="$1"

# Validate IP format
if ! [[ $HOMEY_IP =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
    echo "❌ Error: Invalid IP address format"
    echo "Please provide a valid IP address like 192.168.1.100"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Show Node.js version
NODE_VERSION=$(node --version)
echo "✅ Node.js detected: $NODE_VERSION"

# Check if historical dashboard generator exists
if [ ! -f "generate-historical-dashboard.js" ]; then
    echo "❌ Error: generate-historical-dashboard.js not found"
    echo "Please make sure you're running this script from the correct directory"
    exit 1
fi

echo "🔍 Connecting to Homey at $HOMEY_IP..."
echo "📊 Generating historical dashboard with data accumulation..."
echo ""

# Launch the historical dashboard generator
node generate-historical-dashboard.js "$HOMEY_IP"

# Check exit status
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Historical dashboard launched successfully!"
    echo "🌐 Access your dashboard at: http://localhost:8080"
    echo "📈 Historical data is automatically preserved between runs"
    echo "🔄 Run this script regularly to build long-term trends"
    echo ""
    echo "💡 Pro tip: Set up a daily cron job to automatically update your historical data:"
    echo "   0 6 * * * cd $(pwd) && ./launch-historical-dashboard.sh $HOMEY_IP"
else
    echo ""
    echo "❌ Dashboard generation failed. Check the error messages above."
    echo "🔧 Troubleshooting tips:"
    echo "- Verify Homey is powered on and connected to network"
    echo "- Check if MELCloud optimizer app is running on Homey"
    echo "- Ensure sufficient disk space for historical data storage"
    echo "- Try restarting the MELCloud optimizer app on Homey"
fi
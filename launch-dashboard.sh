#!/bin/bash

# MELCloud Dashboard Generator Launcher
# Automated data dump and visualization generator

echo "🚀 MELCloud Heat Pump Dashboard Generator"
echo "========================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Download from: https://nodejs.org/"
    exit 1
fi

# Check if Homey IP is provided
if [ -z "$1" ]; then
    echo "❌ Please provide your Homey IP address"
    echo "Usage: ./launch-dashboard.sh <homey-ip-address>"
    echo ""
    echo "Example: ./launch-dashboard.sh 192.168.1.100"
    echo ""
    echo "🔍 To find your Homey IP:"
    echo "   1. Open Homey app on your phone"
    echo "   2. Go to Settings > General > Network"
    echo "   3. Look for the IP address"
    echo ""
    exit 1
fi

HOMEY_IP=$1

echo "📡 Target Homey IP: $HOMEY_IP"
echo "🔄 Starting automated data dump and dashboard generation..."
echo ""

# Run the dashboard generator
node generate-dashboard.js $HOMEY_IP

echo ""
echo "✅ Dashboard generation complete!"
echo "📝 Files generated in ./dashboard-output/"
echo "🌐 Server should be running on http://localhost:8080"
echo ""
echo "💡 Tips:"
echo "   - Keep this terminal open to maintain the server"
echo "   - Press Ctrl+C to stop the server"
echo "   - Refresh the page to see updated data"
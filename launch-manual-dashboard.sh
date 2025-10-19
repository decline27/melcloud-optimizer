#!/bin/bash

# MELCloud Manual Dashboard Launcher
# This script makes it easy to import copy-paste data from Homey settings

echo "🚀 MELCloud Manual Dashboard Launcher"
echo "====================================="
echo ""
echo "This tool builds long-term historical data from manual copy-paste imports"
echo "from your Homey settings page data dump button."
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Show usage options
echo "📋 Usage Options:"
echo ""
echo "1️⃣  Import from JSON file:"
echo "   $0 data.json"
echo ""
echo "2️⃣  Import from clipboard (paste data when prompted):"
echo "   $0"
echo ""
echo "3️⃣  Import via pipe:"
echo "   cat data.json | $0"
echo ""

# Check if file argument provided
if [ "$1" ]; then
    if [ ! -f "$1" ]; then
        echo "❌ Error: File '$1' not found"
        echo ""
        echo "💡 How to get the data:"
        echo "1. Open Homey mobile app or web interface"
        echo "2. Go to MELCloud optimizer app settings"
        echo "3. Click 'Data Dump' button"
        echo "4. Copy the JSON data and save to a file"
        echo "5. Run: $0 yourfile.json"
        exit 1
    fi
    
    echo "📄 Using data file: $1"
    echo ""
    node generate-manual-dashboard.js "$1"
    
elif [ -t 0 ]; then
    # Terminal input (interactive mode)
    echo "📋 Interactive Mode - Paste your JSON data"
    echo "=========================================="
    echo ""
    echo "💡 Steps:"
    echo "1. Copy data from Homey settings page (Data Dump button)"
    echo "2. Paste the JSON data below"
    echo "3. Press Ctrl+D when done"
    echo ""
    echo "Waiting for JSON data..."
    echo ""
    
    node generate-manual-dashboard.js
    
else
    # Pipe input
    echo "📥 Reading data from pipe..."
    echo ""
    node generate-manual-dashboard.js
fi

# Check exit status
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Dashboard generated successfully!"
    echo "🌐 Access your dashboard at: http://localhost:8080"
    echo "📈 Historical data is automatically preserved between imports"
    echo ""
    echo "💡 Pro tip: Save your data dumps as dated files for easy re-import:"
    echo "   homey-data-2024-10-19.json"
    echo "   homey-data-2024-10-26.json"
    echo "   etc."
else
    echo ""
    echo "❌ Dashboard generation failed. Check the error messages above."
    echo ""
    echo "🔧 Troubleshooting:"
    echo "- Make sure you copied the complete JSON from Homey settings"
    echo "- Check that the JSON is valid (proper brackets, quotes, etc.)"
    echo "- Verify the data contains optimization decisions"
    echo "- Try saving to a file first, then running with file argument"
fi
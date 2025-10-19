#!/bin/bash

# MELCloud Enhanced Dashboard Launcher
# Comprehensive analytics with all data points

echo "🚀 MELCloud Enhanced Analytics Dashboard"
echo "========================================"
echo ""
echo "This enhanced dashboard includes comprehensive analysis of:"
echo "📊 Overview & trends         💰 Price analysis & correlation"
echo "🌡️ Weather & comfort        ⏰ Hourly & seasonal patterns"  
echo "🚿 Hot water optimization   ⚡ Efficiency metrics"
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Show usage
if [ -z "$1" ]; then
    echo "📋 Usage Options:"
    echo "  $0 data.json                    # Import from file"
    echo "  $0                              # Interactive paste mode"
    echo "  cat data.json | $0              # Pipe mode"
    echo ""
    echo "💡 Get data from Homey settings → MELCloud optimizer → Data Dump button"
    echo ""
fi

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
    
    echo "📄 Processing data file: $1"
    echo "🔄 Generating enhanced dashboard with comprehensive analytics..."
    echo ""
    node generate-enhanced-dashboard.js "$1"
    
elif [ -t 0 ]; then
    echo "📋 Interactive Mode - Enhanced Analytics"
    echo "======================================="
    echo ""
    echo "💡 Steps:"
    echo "1. Copy complete JSON data from Homey settings (Data Dump button)"
    echo "2. Paste the data below"
    echo "3. Press Ctrl+D when done"
    echo ""
    echo "🔄 Generating enhanced dashboard..."
    echo ""
    
    node generate-enhanced-dashboard.js
    
else
    echo "📥 Processing piped data..."
    echo "🔄 Generating enhanced dashboard..."
    echo ""
    node generate-enhanced-dashboard.js
fi

# Check exit status
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Enhanced dashboard generated successfully!"
    echo "🌐 Access your comprehensive dashboard at: http://localhost:8080"
    echo ""
    echo "📊 Enhanced Features Available:"
    echo "   • 📈 Overview: Daily trends, monthly analysis, action distribution"
    echo "   • 💰 Price Analysis: Price levels, correlations, savings impact"  
    echo "   • 🌡️ Weather & Comfort: Temperature ranges, comfort analysis"
    echo "   • ⏰ Patterns: Hourly optimization, weekday trends, seasonal analysis"
    echo "   • 🚿 Hot Water: Usage patterns, temperature tracking"
    echo "   • ⚡ Efficiency: Performance metrics, optimization effectiveness"
    echo "   • 🧠 Smart Insights: AI-powered recommendations and analysis"
    echo ""
    echo "💾 Historical data is preserved between imports for long-term analysis"
    echo ""
    echo "💡 Pro tip: Import data regularly to build comprehensive trends!"
else
    echo ""
    echo "❌ Enhanced dashboard generation failed."
    echo ""
    echo "🔧 Troubleshooting:"
    echo "- Ensure you copied the complete JSON from Homey settings"
    echo "- Verify JSON syntax is valid (proper brackets, quotes, commas)"
    echo "- Check that the data contains optimization decisions"
    echo "- Try saving to a file first, then running with file argument"
    echo "- Make sure you have sufficient disk space"
fi
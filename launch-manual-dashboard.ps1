# MELCloud Manual Dashboard Launcher (PowerShell)
# This script makes it easy to import copy-paste data from Homey settings

Write-Host "🚀 MELCloud Manual Dashboard Launcher" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "This tool builds long-term historical data from manual copy-paste imports" -ForegroundColor Cyan
Write-Host "from your Homey settings page data dump button." -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is available
try {
    $NodeVersion = node --version
    Write-Host "✅ Node.js detected: $NodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Node.js is not installed" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Show usage options
Write-Host "📋 Usage Options:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1️⃣  Import from JSON file:" -ForegroundColor White
Write-Host "   .\launch-manual-dashboard.ps1 data.json" -ForegroundColor Gray
Write-Host ""
Write-Host "2️⃣  Import from clipboard (paste data when prompted):" -ForegroundColor White
Write-Host "   .\launch-manual-dashboard.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "3️⃣  Import via pipe:" -ForegroundColor White
Write-Host "   Get-Content data.json | .\launch-manual-dashboard.ps1" -ForegroundColor Gray
Write-Host ""

# Check if file argument provided
if ($args.Length -gt 0) {
    $inputFile = $args[0]
    
    if (!(Test-Path $inputFile)) {
        Write-Host "❌ Error: File '$inputFile' not found" -ForegroundColor Red
        Write-Host ""
        Write-Host "💡 How to get the data:" -ForegroundColor Cyan
        Write-Host "1. Open Homey mobile app or web interface"
        Write-Host "2. Go to MELCloud optimizer app settings"
        Write-Host "3. Click 'Data Dump' button"
        Write-Host "4. Copy the JSON data and save to a file"
        Write-Host "5. Run: .\launch-manual-dashboard.ps1 yourfile.json"
        exit 1
    }
    
    Write-Host "📄 Using data file: $inputFile" -ForegroundColor Blue
    Write-Host ""
    & node generate-manual-dashboard.js $inputFile
    
} else {
    # Check if we have pipeline input
    if ($input) {
        Write-Host "📥 Reading data from pipeline..." -ForegroundColor Blue
        Write-Host ""
        $input | & node generate-manual-dashboard.js
    } else {
        # Interactive mode
        Write-Host "📋 Interactive Mode - Paste your JSON data" -ForegroundColor Yellow
        Write-Host "==========================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "💡 Steps:" -ForegroundColor Cyan
        Write-Host "1. Copy data from Homey settings page (Data Dump button)"
        Write-Host "2. Paste the JSON data when prompted"
        Write-Host "3. Press Ctrl+Z then Enter when done (Windows)"
        Write-Host ""
        Write-Host "Starting interactive input..." -ForegroundColor Blue
        Write-Host ""
        
        & node generate-manual-dashboard.js
    }
}

# Check exit status
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Dashboard generated successfully!" -ForegroundColor Green
    Write-Host "🌐 Access your dashboard at: http://localhost:8080" -ForegroundColor Cyan
    Write-Host "📈 Historical data is automatically preserved between imports" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "💡 Pro tip: Save your data dumps as dated files for easy re-import:" -ForegroundColor Yellow
    Write-Host "   homey-data-2024-10-19.json"
    Write-Host "   homey-data-2024-10-26.json"
    Write-Host "   etc."
} else {
    Write-Host ""
    Write-Host "❌ Dashboard generation failed. Check the error messages above." -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "- Make sure you copied the complete JSON from Homey settings"
    Write-Host "- Check that the JSON is valid (proper brackets, quotes, etc.)"
    Write-Host "- Verify the data contains optimization decisions"
    Write-Host "- Try saving to a file first, then running with file argument"
}
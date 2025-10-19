# MELCloud Dashboard Generator Launcher (Windows PowerShell)
param(
    [Parameter(Mandatory=$true)]
    [string]$HomeyIP
)

Write-Host "🚀 MELCloud Heat Pump Dashboard Generator" -ForegroundColor Green
Write-Host "========================================"

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed. Please install Node.js first." -ForegroundColor Red
    Write-Host "   Download from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

Write-Host "📡 Target Homey IP: $HomeyIP" -ForegroundColor Cyan
Write-Host "🔄 Starting automated data dump and dashboard generation..." -ForegroundColor Yellow
Write-Host ""

# Run the dashboard generator
node generate-dashboard.js $HomeyIP

Write-Host ""
Write-Host "✅ Dashboard generation complete!" -ForegroundColor Green
Write-Host "📝 Files generated in ./dashboard-output/" -ForegroundColor Cyan
Write-Host "🌐 Server should be running on http://localhost:8080" -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 Tips:" -ForegroundColor Yellow
Write-Host "   - Keep this terminal open to maintain the server" -ForegroundColor White
Write-Host "   - Press Ctrl+C to stop the server" -ForegroundColor White
Write-Host "   - Refresh the page to see updated data" -ForegroundColor White
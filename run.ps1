# choose-me — one-click launcher.
# Uses the portable Node install and serves the built client from the Express
# server on port 3001. On your phone (same Wi-Fi) open http://<this-pc-ip>:3001
#
# Usage:  right-click > Run with PowerShell   (or:  ./run.ps1)

$ErrorActionPreference = "Stop"
$nodeDir = "C:\Users\guyts\nodejs-portable\node-v20.18.1-win-x64"
if (-not (Test-Path "$nodeDir\node.exe")) {
  Write-Host "Portable Node not found at $nodeDir" -ForegroundColor Red
  Write-Host "Install Node.js (https://nodejs.org) or re-run setup." -ForegroundColor Yellow
  exit 1
}
$env:Path = "$nodeDir;" + $env:Path

# Build the client if it hasn't been built yet.
if (-not (Test-Path "$PSScriptRoot\client\dist\index.html")) {
  Write-Host "Building client (first run)..." -ForegroundColor Cyan
  Set-Location "$PSScriptRoot\client"
  cmd /c "npm install --no-audit --no-fund"
  cmd /c "npm run build"
}

# Show LAN IPs so you know what to type on phones.
Write-Host "`nOpen on this PC:  http://localhost:3001" -ForegroundColor Green
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
foreach ($ip in $ips) {
  Write-Host ("Open on phones:   http://{0}:3001" -f $ip.IPAddress) -ForegroundColor Green
}
Write-Host ""

Set-Location "$PSScriptRoot\server"
node index.js

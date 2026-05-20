# NeuroTrack - Final Diagnostic Launch Script
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  NeuroTrack Mobile Diagnostic Launcher" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# 1. Activate venv
if (!(Test-Path "venv")) {
    Write-Host "ERROR: venv not found. Please run setup.bat first!" -ForegroundColor Red
    pause; exit
}

# 2. Get IP Info
$localIP = (ipconfig | Select-String "IPv4 Address" | Select-String "192.168").ToString().Split(":")[-1].Trim()
$publicIP = (Invoke-RestMethod -Uri "https://api.ipify.org")

# 3. Terminate old processes
Write-Host "[*] Cleaning up old processes..." -ForegroundColor Gray
Stop-Process -Name "python" -ErrorAction SilentlyContinue
Stop-Process -Name "npx" -ErrorAction SilentlyContinue

# 4. Start Unified System
Write-Host "[*] Starting System on port 8000..." -ForegroundColor DarkCyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; ..\venv\Scripts\activate.ps1; uvicorn main:app --host 0.0.0.0 --port 8000"

# 5. Start Secure Tunnel (Magic Link)
Write-Host "[*] Generating Cloudflare Magic Link (HTTPS)..." -ForegroundColor Yellow
Write-Host "Please wait ~15 seconds..." -ForegroundColor Gray

# Start the tunnel in the background
Start-Process -FilePath "venv\Scripts\python.exe" -ArgumentList "cf_tunnel.py" -WindowStyle Hidden

# Wait for the magic URL file to be created (Max 25 seconds)
$timeout = 25
while (!(Test-Path "MAGIC_URL.txt") -and ($timeout -gt 0)) {
    Start-Sleep -Seconds 1
    $timeout--
}


# Read the URL directly from the file written by cf_tunnel.py
$url = ""
if (Test-Path "MAGIC_URL.txt") {
    $url = Get-Content "MAGIC_URL.txt" -Raw
}

Write-Host "`n================================================" -ForegroundColor White
$cleanUrl = ""
if ($url -match "https://") {
    $cleanUrl = $url.Trim()
    Write-Host "🚀 PATIENT ACCESS (Magic Link)" -ForegroundColor Green
    Write-Host "URL: $cleanUrl" -ForegroundColor White
    Write-Host "(No password required!)" -ForegroundColor Cyan
    & venv\Scripts\python.exe backend\qr_gen.py $cleanUrl
} else {
    Write-Host "❌ Magic Link Failed to generate." -ForegroundColor Red
}

Write-Host "`n================================================" -ForegroundColor White
Write-Host "⚠️ IF MAGIC LINK SAYS 'DNS CANNOT BE REACHED':" -ForegroundColor Yellow
Write-Host "Your phone's internet provider is blocking Cloudflare. Use this WiFi method:" -ForegroundColor Gray
Write-Host "  1. Connect your phone to the SAME WiFi as this laptop." -ForegroundColor White
Write-Host "  2. Open Chrome on your phone and go to: chrome://flags" -ForegroundColor White
Write-Host "  3. Search for 'Insecure origins treated as secure'." -ForegroundColor White
Write-Host "  4. Enable it and enter exactly: http://$localIP:8000" -ForegroundColor White
Write-Host "  5. Restart Chrome and go to: http://$localIP:8000" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor White

Write-Host "Keep this window open during testing." -ForegroundColor Gray
pause

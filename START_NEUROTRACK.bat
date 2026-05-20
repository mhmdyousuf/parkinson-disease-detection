@echo off
title NeuroTrack - Starting...
color 0B

echo.
echo  ============================================
echo    NeuroTrack - Parkinson Tremor Screening
echo  ============================================
echo.

:: Kill old processes
echo  [1/4] Cleaning up old servers...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: Check if venv exists, if not run setup
if not exist venv (
    echo  [!] Virtual environment not found. Running setup...
    call setup.bat
)

:: Clear old URL file
if exist MAGIC_URL.txt del /F /Q MAGIC_URL.txt
if exist CF_URL.txt del /F /Q CF_URL.txt
if exist tunnel_url.txt del /F /Q tunnel_url.txt

:: Start the backend server in a new window
echo  [2/4] Starting NeuroTrack backend (port 8000)...
start "NeuroTrack Backend" cmd /k "call venv\Scripts\activate.bat && cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000"

:: Wait for backend to be ready
echo  [3/4] Waiting for backend to start...
timeout /t 5 /nobreak >nul

:: Start Cloudflare tunnel in a new window
echo  [4/4] Starting Cloudflare tunnel (Magic Link)...
start "NeuroTrack Tunnel" cmd /k "call venv\Scripts\activate.bat && python cf_tunnel.py"

:: Wait for tunnel URL to appear (max 30 seconds)
echo.
echo  Waiting for public URL (up to 30 seconds)...
set /a tries=0
:wait_loop
    timeout /t 2 /nobreak >nul
    set /a tries+=1
    if exist MAGIC_URL.txt goto url_ready
    if %tries% GEQ 30 goto timeout_error
    echo  Still waiting... (%tries%/30)
goto wait_loop

:url_ready
echo  URL file detected! Finalizing...
timeout /t 2 /nobreak >nul
set /p MAGIC_URL=<MAGIC_URL.txt
echo.
echo  ============================================
echo   SUCCESS! Magic Link ready.
echo.
echo   PUBLIC URL (for phone):
echo   %MAGIC_URL%
echo.
echo   1. Open laptop browser to: http://localhost:8000
echo   2. Enter patient details and click "Start Session"
echo   3. Click "Generate QR Code" - scan with phone
echo   4. Phone will auto-load and start the test
echo  ============================================
echo.
echo  Keep this window open while testing.
echo.
pause
goto end

:timeout_error
echo.
echo  WARNING: Tunnel URL not detected in time.
echo  The system runs locally only (same WiFi needed).
echo.
echo  Open: http://localhost:8000 on laptop
echo.
pause

:end

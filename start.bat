@echo off
echo ================================================
echo  NeuroTrack - Parkinson Tremor Detection System
echo ================================================

echo.
echo Activating virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: venv not found. Please run setup.bat first!
    pause
    exit /b 1
)

echo.
echo Starting NeuroTrack Server on port 8000...
start "NeuroTrack Server" cmd /k "call venv\Scripts\activate.bat && cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000"

echo.
echo ================================================
echo  System Started Successfully!
echo.
echo  1. Connect your phone to the same Wi-Fi.
echo  2. Find your PC's IPv4 address below.
echo  3. Open this on your phone: http://[YOUR_IP]:8000
echo.
echo  YOUR LOCAL IP ADDRESS:
ipconfig | findstr "IPv4"
echo.
echo  TIP for Android: Open chrome://flags and enable
echo  "#unsafely-treat-insecure-origin-as-secure" 
echo  for http://[YOUR_IP]:8000 to allow sensors.
echo ================================================
pause

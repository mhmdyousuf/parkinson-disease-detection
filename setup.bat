@echo off
title NeuroTrack Setup
color 0A

echo.
echo  ============================================
echo    NeuroTrack - Project Setup
echo  ============================================
echo.

:: Check for Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.9 or higher from python.org
    pause
    exit /b 1
)

:: Create Virtual Environment
echo [1/3] Creating virtual environment...
if exist venv (
    echo Virtual environment already exists. Skipping...
) else (
    python -m venv venv
)

:: Install Dependencies
echo [2/3] Installing dependencies...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

:: Final Check
echo [3/3] Verifying installation...
if exist venv\Scripts\python.exe (
    echo.
    echo  ============================================
    echo   SUCCESS! Setup is complete.
    echo.
    echo   To run the project:
    echo   1. Double-click START_NEUROTRACK.bat
    echo  ============================================
) else (
    echo [ERROR] Setup failed. Please check your internet connection.
)

pause

@echo off
title E.Y.E.S. Development Server Runner
echo ============================================================
echo Starting E.Y.E.S. Development Servers...
echo ============================================================
python run.py
if %ERRORLEVEL% neq 0 (
    echo.
    echo [Error] Failed to start. Make sure Python is installed and added to PATH.
    pause
)

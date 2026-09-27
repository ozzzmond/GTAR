@echo off
title GTA WebApp [DEV SERVER]
color 0B
echo ===================================================
echo       GTA WEBAPP - DEVELOPMENT ENVIRONMENT
echo ===================================================
echo.
cd /d "%~dp0"

if not exist node_modules (
    echo [INFO] node_modules not found. Running npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

echo [INFO] Starting Vite Development Server on http://localhost:5173 ...
echo [INFO] Press Ctrl+C to stop the dev server.
echo.
call npm run dev
pause
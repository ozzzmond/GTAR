@echo off
title GTAR WebApp [PROD PREVIEW]
color 0A

:: Lumipat sa mismong folder kung nasaan ang script na ito
cd /d "%~dp0"

:: Kung nasa desktop ang script, ilagay ang full exact path:
:: cd /d "E:\AntiGravity Codes\GTAR\web"

echo [1/2] Building production bundle (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Production build failed!
    pause
    exit /b 1
)

echo.
echo [2/2] Launching Production Preview Server on http://localhost:4173 ...
echo [INFO] Serving optimized production bundle (port 4173).
echo [INFO] Press Ctrl+C to stop the server.
echo.
call npm run preview -- --port 4173
pause
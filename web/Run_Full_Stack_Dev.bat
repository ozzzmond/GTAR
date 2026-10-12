@echo off
title GTAR [FULL STACK DEV]
color 0A
echo ===================================================
echo       GTAR - FULL STACK DEV (VITE + CLOUDFLARE)
echo ===================================================
echo.
cd /d "%~dp0"

echo [INFO] Applying/verifying LOCAL D1 migrations...
echo y | call npx wrangler d1 migrations apply DB --local
if errorlevel 1 (
    echo.
    echo [ERROR] Local D1 migration failed.
    echo [SAFETY] Stopping startup. No remote D1 fallback.
    pause
    exit /b 1
)

echo [PASS] Local D1 migrations completed.
echo.
echo [INFO] Launching Local Cloudflare API Backend...
start "GTAR API Backend [8788]" cmd /k call Run_API_Dev.bat

echo [INFO] Verifying canonical Vite port 5173 availability...
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [ERROR] Port 5173 is already in use.
    echo [ACTION] Close the conflicting process.
    pause
    exit /b 1
)

echo [INFO] Launching Vite on http://localhost:5173 ...
echo.
call npm run dev
if errorlevel 1 (
    echo.
    echo [ERROR] Vite dev server exited with an error.
    pause
    exit /b 1
)
pause

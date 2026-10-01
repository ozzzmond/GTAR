@echo off
title GTAR [FULL STACK DEV]
color 0A
echo ===================================================
echo       GTAR - FULL STACK DEV (VITE + CLOUDFLARE)
echo ===================================================
echo.
cd /d "%~dp0"

echo [INFO] Applying/verifying local D1 migrations...
echo y | call npx wrangler d1 migrations apply DB --local
echo.
echo [INFO] Launching Local Cloudflare API Backend in companion window...
start "GTAR API Backend [8788]" cmd /k call Run_API_Dev.bat
echo [INFO] Verifying canonical Vite port 5173 availability...
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [ERROR] Port 5173 is already in use by another process.
    echo [ERROR] Vite strictPort is enforced to guarantee canonical Google OAuth origin:
    echo         http://localhost:5173
    echo [ACTION] Please terminate the process occupying port 5173 or close conflicting terminals.
    echo.
    pause
    exit /b 1
)

echo [INFO] Launching Vite Development Server on http://localhost:5173 ...
echo.
call npm run dev
if errorlevel 1 (
    echo.
    echo [ERROR] Vite dev server exited with an error. Ensure port 5173 remains free.
    pause
    exit /b 1
)
pause

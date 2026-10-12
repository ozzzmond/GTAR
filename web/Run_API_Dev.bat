@echo off
title GTAR API [LOCAL BACKEND]
color 0E
echo ===================================================
echo       GTAR API - LOCAL CLOUDFLARE BACKEND
echo ===================================================
echo.
cd /d "%~dp0"

echo [INFO] Applying/verifying LOCAL D1 migrations...
echo y | call npx wrangler d1 migrations apply DB --local
if errorlevel 1 (
    echo.
    echo [ERROR] Local D1 migration failed.
    echo [SAFETY] API startup blocked. No remote D1 fallback.
    pause
    exit /b 1
)

echo [PASS] Local D1 migrations completed.
echo.
echo [INFO] Starting Cloudflare Pages Functions on http://localhost:8788 ...
echo [INFO] Press Ctrl+C to stop.
echo.
call npm run dev:api
if errorlevel 1 (
    echo.
    echo [ERROR] Local API server exited with an error.
    pause
    exit /b 1
)
pause

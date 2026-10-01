@echo off
title GTAR API [LOCAL BACKEND]
color 0E
echo ===================================================
echo       GTAR API - LOCAL CLOUDFLARE BACKEND
echo ===================================================
echo.
cd /d "%~dp0"

echo [INFO] Applying/verifying local D1 migrations...
echo y | call npx wrangler d1 migrations apply DB --local
echo.
echo [INFO] Starting Cloudflare Pages Functions server on http://localhost:8788 ...
echo [INFO] Press Ctrl+C to stop the API server.
echo.
call npm run dev:api
pause

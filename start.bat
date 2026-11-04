@echo off
title Apex Engineering Platform
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install
)

echo.
echo   Apex Engineering Platform
echo   Opening http://localhost:5173
echo   Leave this window open. Press Ctrl+C to stop.
echo.
call npm run dev
goto end

:nonode
echo Node.js not found - serving the prebuilt preview instead.
cd preview
start "" http://localhost:8080
python -m http.server 8080

:end
pause

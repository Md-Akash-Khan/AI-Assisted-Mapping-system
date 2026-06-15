@echo off
setlocal EnableExtensions
title Map Zone Intelligence V3 - Portable Node Runner

echo ======================================================
echo   Map Zone Intelligence V3 - Portable Node Runner
echo ======================================================
echo.
echo This runner works with either:
echo   1. Normal installed Node.js, or
echo   2. Portable Node.js ZIP folder containing node.exe
echo.

REM ------------------------------------------------------
REM Resolve project/backend directory.
REM This BAT can be placed either in project root OR backend folder.
REM ------------------------------------------------------
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%"
set "BACKEND_DIR=%SCRIPT_DIR%backend"

if exist "%SCRIPT_DIR%server.js" (
  set "BACKEND_DIR=%SCRIPT_DIR%"
  for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_DIR=%%~fI"
)

if not exist "%BACKEND_DIR%\server.js" (
  echo ERROR: Could not find backend\server.js.
  echo.
  echo Put this file either here:
  echo   map-zone-intelligence-v3\START_WITH_PORTABLE_NODE.bat
  echo or here:
  echo   map-zone-intelligence-v3\backend\START_WITH_PORTABLE_NODE.bat
  echo.
  pause
  exit /b 1
)

REM ------------------------------------------------------
REM Node setup.
REM If system node exists, user can press Enter.
REM Otherwise user pastes folder where node.exe exists.
REM ------------------------------------------------------
where node >nul 2>nul
if %errorlevel%==0 (
  echo System Node.js detected:
  node -v
  echo.
  set /p "NODE_DIR=Press Enter to use system Node, or paste portable node.exe FOLDER path: "
) else (
  echo System Node.js not detected.
  echo Paste the FULL FOLDER path where node.exe exists.
  echo Example: C:\Users\TN-991036\Downloads\node-v24.16.0-win-x64
  echo.
  set /p "NODE_DIR=Node folder path: "
)

if not "%NODE_DIR%"=="" (
  set "NODE_DIR=%NODE_DIR:"=%"
  if exist "%NODE_DIR%\node.exe" (
    set "PATH=%NODE_DIR%;%PATH%"
  ) else (
    echo.
    echo ERROR: node.exe not found in:
    echo %NODE_DIR%
    echo.
    echo Please paste the FOLDER path, not node.exe file path.
    echo Example:
    echo C:\Users\TN-991036\Downloads\node-v24.16.0-win-x64
    echo.
    pause
    exit /b 1
  )
)

where node >nul 2>nul
if not %errorlevel%==0 (
  echo ERROR: Node.js still not found.
  pause
  exit /b 1
)

echo.
echo Node version:
node -v

REM ------------------------------------------------------
REM Start backend directly. No npm install required.
REM ------------------------------------------------------
cd /d "%BACKEND_DIR%"
echo.
echo Starting Map Zone Intelligence backend...
echo Backend folder: %BACKEND_DIR%
echo Dashboard: http://localhost:3000/dashboard
echo.
echo Keep this window open while using the dashboard.
echo Press Ctrl+C to stop the server.
echo.
node server.js

echo.
echo Server stopped.
pause
BAT
zip -j /mnt/data/START_WITH_PORTABLE_NODE.zip /mnt/data/START_WITH_PORTABLE_NODE.bat >/dev/null
ls -l /mnt/data/START_WITH_PORTABLE_NODE.*

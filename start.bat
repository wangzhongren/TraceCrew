@echo off
title CodeAtlas
setlocal enabledelayedexpansion

set ROOT=%~dp0
set BACKEND_DIR=%ROOT%backend
set FRONTEND_DIR=%ROOT%frontend
set PORT=19850
set LOCK_FILE=%ROOT%.codeatlas.lock

echo ============================================
echo   CodeAtlas Launcher
echo ============================================
echo.

:: ── Singleton check ──────────────────────────────

if exist "%LOCK_FILE%" (
    set /p OLD_PID=<"%LOCK_FILE%"
    echo [!] Previous launcher PID: !OLD_PID! — cleaning up...
    taskkill /F /PID !OLD_PID! 2>nul
    del "%LOCK_FILE%" 2>nul
)
echo %PID% > "%LOCK_FILE%"

:: ── Kill old processes ───────────────────────────

echo [1/4] Cleaning old processes...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING" 2^>nul') do (
    echo [!] Port %PORT% occupied by PID %%a — killing...
    taskkill /F /PID %%a 2>nul
)
timeout /t 1 /nobreak >nul

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING" 2^>nul') do (
    echo [!] Port 5173 occupied by PID %%a — killing...
    taskkill /F /PID %%a 2>nul
)
timeout /t 1 /nobreak >nul

echo.

:: ── Start Backend ────────────────────────────────

echo [2/4] Starting backend (port %PORT%)...
start "CodeAtlas-Backend" cmd /c "cd /d %BACKEND_DIR% && python -m uvicorn main:app --port %PORT%"

timeout /t 3 /nobreak >nul
echo [3/4] Starting Electron app...
cd /d %FRONTEND_DIR%
set ELECTRON_RUN_AS_NODE=
npm run electron:dev

:: ── Cleanup ──────────────────────────────────────

del "%LOCK_FILE%" 2>nul

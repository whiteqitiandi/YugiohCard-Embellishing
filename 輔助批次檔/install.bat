@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"

if /I "%~1"=="--help" goto show_help
if /I "%~1"=="/?" goto show_help

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd not found. Install Node.js 24 or newer first.
  exit /b 1
)

if not exist "%PROJECT_ROOT%\package.json" (
  echo [ERROR] Project package.json is missing: "%PROJECT_ROOT%\package.json"
  exit /b 1
)

pushd "%PROJECT_ROOT%" >nul
echo [INFO] Installing dependencies in "%PROJECT_ROOT%"...
call npm.cmd install
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

if not "%EXIT_CODE%"=="0" (
  echo [ERROR] npm install failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo [OK] Install complete. Run run.bat next.
exit /b 0

:show_help
echo Usage: %~nx0
echo Installs the dependencies required by Arcana Archive.
exit /b 0

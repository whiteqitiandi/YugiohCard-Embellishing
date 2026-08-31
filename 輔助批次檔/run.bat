@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
set "LOCAL_ELECTRON=%PROJECT_ROOT%\node_modules\electron\dist\electron.exe"
set "ELECTRON_WRAPPER=%PROJECT_ROOT%\node_modules\.bin\electron.cmd"
set "WAR3_ELECTRON=C:\War3ModelElectron\node_modules\electron\dist\electron.exe"

if /I "%~1"=="--help" (
  echo Usage: %~nx0
  echo Builds and starts the Arcana Archive Electron preview.
  echo Prefers this project's Electron and can reuse the existing War3 Electron as a fallback.
  exit /b 0
)
if /I "%~1"=="/?" (
  echo Usage: %~nx0
  echo Builds and starts the Arcana Archive Electron preview.
  echo Prefers this project's Electron and can reuse the existing War3 Electron as a fallback.
  exit /b 0
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd not found. Install Node.js 24 or newer first.
  exit /b 1
)

if not exist "%ELECTRON_WRAPPER%" (
  echo [ERROR] Local Electron is missing.
  echo [INFO] Run install.bat first.
  exit /b 1
)

if exist "%LOCAL_ELECTRON%" (
  set "ELECTRON_LAUNCH=%LOCAL_ELECTRON%"
  echo [INFO] Using this project's Electron runtime.
) else if exist "%WAR3_ELECTRON%" (
  set "ELECTRON_LAUNCH=%WAR3_ELECTRON%"
  echo [INFO] This project's Electron binary is not cached yet.
  echo [INFO] Reusing the existing War3ModelElectron runtime for this preview only.
) else (
  set "ELECTRON_LAUNCH=%ELECTRON_WRAPPER%"
  echo [INFO] Electron binary is not cached. The first launch may download it.
)

pushd "%PROJECT_ROOT%" >nul
echo [INFO] Building Arcana Archive preview...
call npm.cmd run build
if errorlevel 1 (
  set "EXIT_CODE=%ERRORLEVEL%"
  popd >nul
  echo [ERROR] Preview build failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo [INFO] Starting Arcana Archive...
call "%ELECTRON_LAUNCH%" . %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul
exit /b %EXIT_CODE%

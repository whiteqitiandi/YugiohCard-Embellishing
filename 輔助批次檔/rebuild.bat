@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"

if /I "%~1"=="--help" (
  echo Usage: %~nx0
  echo Runs TypeScript checks and creates the Electron production bundle.
  exit /b 0
)
if /I "%~1"=="/?" (
  echo Usage: %~nx0
  echo Runs TypeScript checks and creates the Electron production bundle.
  exit /b 0
)

if not exist "%PROJECT_ROOT%\node_modules\.bin\electron-vite.cmd" (
  echo [ERROR] Dependencies are missing. Run install.bat first.
  exit /b 1
)

pushd "%PROJECT_ROOT%" >nul
echo [INFO] Type-checking and rebuilding Electron assets...
call npm.cmd run build
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Build failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo [OK] Build complete. Output: "%PROJECT_ROOT%\out"
exit /b 0

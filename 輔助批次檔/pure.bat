@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
set "APP_DATA=%APPDATA%\ArcanaArchive"
set "DRY_RUN=0"
set "PURGE_LOCKFILES=0"
set "PURGE_APP_DATA=0"
set "AUTO_CONFIRM=0"
set /a FOUND=0
set /a REMOVED=0

goto parse_args

:show_help
echo Usage: %~nx0 [--dry-run] [--lockfiles] [--app-data] [--yes]
echo.
echo   --dry-run   Preview exact cleanup targets without deleting anything.
echo   --lockfiles Also delete package-lock.json.
echo   --app-data  Also delete the local catalog and cached media databases.
echo   --yes       Skip the confirmation prompt.
exit /b 0

:parse_args
if "%~1"=="" goto validate_root
if /I "%~1"=="--dry-run" set "DRY_RUN=1" & shift & goto parse_args
if /I "%~1"=="/n" set "DRY_RUN=1" & shift & goto parse_args
if /I "%~1"=="--lockfiles" set "PURGE_LOCKFILES=1" & shift & goto parse_args
if /I "%~1"=="--app-data" set "PURGE_APP_DATA=1" & shift & goto parse_args
if /I "%~1"=="--yes" set "AUTO_CONFIRM=1" & shift & goto parse_args
if /I "%~1"=="-y" set "AUTO_CONFIRM=1" & shift & goto parse_args
if /I "%~1"=="--help" goto show_help
if /I "%~1"=="/?" goto show_help
echo [ERROR] Unknown option: %~1
exit /b 1

:validate_root
if not exist "%PROJECT_ROOT%\package.json" (
  echo [ERROR] Refusing cleanup: project package.json is missing.
  exit /b 1
)
findstr /C:"\"name\": \"arcana-archive\"" "%PROJECT_ROOT%\package.json" >nul
if errorlevel 1 (
  echo [ERROR] Refusing cleanup: package identity did not match Arcana Archive.
  exit /b 1
)

echo Project root: "%PROJECT_ROOT%"
echo Cleanup targets: node_modules, out, dist, .vite, .cache, coverage, *.tsbuildinfo, debug logs
if "%PURGE_LOCKFILES%"=="1" echo Extra target: "%PROJECT_ROOT%\package-lock.json"
if "%PURGE_APP_DATA%"=="1" echo EXTRA DESTRUCTIVE TARGET: "%APP_DATA%"
echo.

if "%DRY_RUN%"=="1" (
  echo [INFO] Dry-run mode. Nothing will be deleted.
) else if not "%AUTO_CONFIRM%"=="1" (
  choice /M "Continue with the exact targets shown above"
  if errorlevel 2 exit /b 0
)

call :remove_dir "%PROJECT_ROOT%\node_modules"
call :remove_dir "%PROJECT_ROOT%\out"
call :remove_dir "%PROJECT_ROOT%\dist"
call :remove_dir "%PROJECT_ROOT%\.vite"
call :remove_dir "%PROJECT_ROOT%\.cache"
call :remove_dir "%PROJECT_ROOT%\coverage"
call :remove_file "%PROJECT_ROOT%\.eslintcache"
call :remove_file "%PROJECT_ROOT%\tsconfig.node.tsbuildinfo"
call :remove_file "%PROJECT_ROOT%\tsconfig.web.tsbuildinfo"
call :remove_file "%PROJECT_ROOT%\npm-debug.log"
call :remove_file "%PROJECT_ROOT%\yarn-error.log"
if "%PURGE_LOCKFILES%"=="1" call :remove_file "%PROJECT_ROOT%\package-lock.json"
if "%PURGE_APP_DATA%"=="1" call :remove_dir "%APP_DATA%"

echo.
if "%DRY_RUN%"=="1" (
  echo [OK] Dry run complete. %FOUND% existing targets matched.
) else (
  echo [OK] Cleanup complete. %REMOVED% targets removed.
)
exit /b 0

:remove_dir
set "TARGET=%~1"
if not exist "%TARGET%" (
  echo [SKIP] dir  "%TARGET%"
  goto :eof
)
set /a FOUND+=1
if "%DRY_RUN%"=="1" (
  echo [PLAN] dir  "%TARGET%"
  goto :eof
)
rd /s /q "%TARGET%" >nul 2>nul
if exist "%TARGET%" (
  echo [FAIL] dir  "%TARGET%"
) else (
  set /a REMOVED+=1
  echo [DONE] dir  "%TARGET%"
)
goto :eof

:remove_file
set "TARGET=%~1"
if not exist "%TARGET%" (
  echo [SKIP] file "%TARGET%"
  goto :eof
)
set /a FOUND+=1
if "%DRY_RUN%"=="1" (
  echo [PLAN] file "%TARGET%"
  goto :eof
)
del /f /q "%TARGET%" >nul 2>nul
if exist "%TARGET%" (
  echo [FAIL] file "%TARGET%"
) else (
  set /a REMOVED+=1
  echo [DONE] file "%TARGET%"
)
goto :eof


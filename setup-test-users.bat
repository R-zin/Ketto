@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer, then run this again.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Run start.bat first to initialise the local configuration.
  pause
  exit /b 1
)
if not exist "server\dist\testing.js" (
  call npm.cmd run build -w server
  if errorlevel 1 exit /b 1
)
node --env-file=.env scripts\setup-test-users.mjs %*
if errorlevel 1 (
  pause
  exit /b 1
)
pause
endlocal

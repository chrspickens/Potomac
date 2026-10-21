@echo off
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: reset-playtest.bat ^<playtest-id^>
  pause
  exit /b 2
)
node scripts/local-launch.mjs reset-playtest "%~1"
pause

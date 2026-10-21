@echo off
cd /d "%~dp0"
node scripts/local-launch.mjs start
if errorlevel 1 pause

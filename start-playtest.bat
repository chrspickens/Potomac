@echo off
cd /d "%~dp0"
node scripts/local-launch.mjs playtest
if errorlevel 1 pause

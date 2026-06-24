@echo off
cd /d "%~dp0"
if exist ".git\index.lock" del ".git\index.lock"
if exist ".git\HEAD.lock" del ".git\HEAD.lock"
if exist ".git\refs\heads\main.lock" del ".git\refs\heads\main.lock"
git add -A
git commit -m "feat: roster page overhaul — remove double-listing, add bye/injury indicators, Drop+IR buttons on bench"
git push origin main
pause

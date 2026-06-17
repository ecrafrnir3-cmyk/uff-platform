@echo off
del /f ".git\index.lock" 2>nul
git add -A
git -c user.email="ecrafrnir3@gmail.com" -c user.name="Nate" commit -m "Fix: password reset redirect, DraftRoom polling guard, MatchupView Realtime guard, text-zinc-600 contrast sweep"
git push
echo.
echo Done! Press any key to close.
pause

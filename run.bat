@echo off
rem Double-click: starts a local web server for this folder and opens the garden in the default browser.
cd /d "%~dp0"
where npx >nul 2>nul || (echo Node.js is required: https://nodejs.org & pause & exit /b 1)

set URL=http://localhost:4173/tree-demo.html
rem Server runs in its own window; close that window to stop it.
start "Portfolio Garden server (close to stop)" cmd /k npx -y http-server . -p 4173 -c-1

rem Wait until the server answers (first run downloads http-server), at most ~30 s.
set /a tries=0
:wait
curl -s -o nul "%URL%" && goto open
set /a tries+=1
if %tries% geq 30 goto open
timeout /t 1 /nobreak >nul
goto wait

:open
start "" "%URL%"

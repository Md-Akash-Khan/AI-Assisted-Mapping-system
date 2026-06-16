@echo off
cd /d "%~dp0backend"
echo Starting Map Zone Intelligence Backend...
echo Dashboard: http://localhost:3000/dashboard
node -v
npm start
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo Первый запуск: ставлю зависимости...
  call npm install
)
start "" node_modules\electron\dist\electron.exe .

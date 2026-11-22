@echo off
REM Roda o painel so no seu PC (sem senha, apenas 127.0.0.1).
cd /d "%~dp0"
start "" http://127.0.0.1:7777
node server.js

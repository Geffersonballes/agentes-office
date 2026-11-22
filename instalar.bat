@echo off
REM Instala o hook do Escritorio de Agentes no Claude Code deste PC.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nao encontrado. Instale em https://nodejs.org ^(versao LTS^) e rode de novo. & pause & exit /b 1)
node install.js --url=https://agentes.ballestech.com.br --detalhe=minimo
echo.
node install.js --testar
echo.
echo Pronto. Feche e abra de novo o Claude Code.
pause

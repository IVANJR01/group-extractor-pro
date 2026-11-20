@echo off
title Group Extractor Pro - Robô Multi-Chip WhatsApp
cd /d "%~dp0"
echo ===================================================
echo   Iniciando Group Extractor Pro...
echo   Painel com Robô Multi-Chip e Anti-Ban
echo ===================================================
echo Abrindo navegador em http://localhost:5173/ ...
start http://localhost:5173/
npm run dev
pause

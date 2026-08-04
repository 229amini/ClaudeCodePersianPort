@echo off
chcp 65001 >nul
title Claude Persian - Setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause

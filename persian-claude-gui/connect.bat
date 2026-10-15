@echo off
rem Open the Persian Claude window for a Linux server over SSH. See connect.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0connect.ps1" %*
if errorlevel 1 pause

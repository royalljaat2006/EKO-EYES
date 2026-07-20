@echo off
title Deploying to RACK Server
echo Starting Deployment...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
pause

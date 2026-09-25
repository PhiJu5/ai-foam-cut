@echo off
setlocal
cd /d "%~dp0"
title AI Foam Cut - Build-Tool (Electron)
where py >nul 2>&1
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% build_tool_electron.py %*
if %errorlevel% neq 0 pause

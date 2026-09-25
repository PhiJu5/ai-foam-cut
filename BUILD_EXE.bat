@echo off
setlocal
cd /d "%~dp0"
title AI Foam Cut - EXE bauen
echo.
echo  ==============================================
echo   AI Foam Cut - EXE bauen
echo  ==============================================
echo.
echo  Alle .js-Dateien + HTML werden automatisch eingebuendelt.
echo  Versionsnummer leer lassen = naechste Nummer automatisch.
echo.
set /p VER="Versionsnummer (z.B. 1.25) oder Enter: "
echo.

where py >nul 2>&1
if %errorlevel%==0 (set PY=py -3) else (set PY=python)

%PY% build_exe.py %VER%
set RC=%errorlevel%
echo.
if %RC% neq 0 (
  echo  *** BUILD FEHLGESCHLAGEN - siehe Meldungen oben ***
) else (
  echo  Die exe liegt im Ordner dist\
  explorer dist
)
echo.
pause

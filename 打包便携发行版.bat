@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python "%~dp0launcher.py" --pack
    goto :end
)

if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" "%~dp0launcher.py" --pack
    goto :end
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" --pack

:end
if "%1"=="--no-pause" goto :eof
echo.
pause

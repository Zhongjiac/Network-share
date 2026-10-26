@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python "%~dp0launcher.py" --setup-firewall
    goto :end
)

if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" "%~dp0launcher.py" --setup-firewall
    goto :end
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" --setup-firewall

:end
if errorlevel 1 (
    echo.
    echo Process exited with error code %ERRORLEVEL%.
    pause
)

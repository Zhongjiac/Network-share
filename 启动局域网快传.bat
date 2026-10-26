@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python "%~dp0launcher.py" %*
    goto :end
)

if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" "%~dp0launcher.py" %*
    goto :end
)

where powershell >nul 2>&1
if %ERRORLEVEL% equ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" %*
    goto :end
)

"%~dp0bin\dufs.exe" "%~dp0shared_files" -A -b 0.0.0.0 -p 5000 --assets "%~dp0web"

:end
if errorlevel 1 (
    echo.
    echo Process exited with error code %ERRORLEVEL%.
    pause
)

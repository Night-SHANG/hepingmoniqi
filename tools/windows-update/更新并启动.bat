@echo off
setlocal DisableDelayedExpansion
set "NATIVE_UPDATE_ROOT=%~dp0"
powershell.exe -NoProfile -Command "try { $root = $env:NATIVE_UPDATE_ROOT; $script = Join-Path $root 'update-native.ps1'; & ([scriptblock]::Create([IO.File]::ReadAllText($script))) -RootPath $root; exit 0 } catch { Write-Host $_; exit 1 }"
set "NATIVE_UPDATE_EXIT=%ERRORLEVEL%"
if not "%NATIVE_UPDATE_EXIT%"=="0" if not "%NATIVE_UPDATE_NONINTERACTIVE%"=="1" pause
exit /b %NATIVE_UPDATE_EXIT%

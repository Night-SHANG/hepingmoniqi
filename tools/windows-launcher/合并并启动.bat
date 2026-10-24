@echo off
setlocal
set "NATIVE_ASSEMBLY_ROOT=%~dp0"
powershell.exe -NoProfile -Command "try { $root = $env:NATIVE_ASSEMBLY_ROOT; $script = Join-Path $root 'assemble-native.ps1'; & ([scriptblock]::Create([IO.File]::ReadAllText($script))) $root; exit 0 } catch { Write-Host $_; exit 1 }"
set "NATIVE_ASSEMBLY_EXIT=%ERRORLEVEL%"
if not "%NATIVE_ASSEMBLY_EXIT%"=="0" if not "%NATIVE_ASSEMBLY_NONINTERACTIVE%"=="1" pause
exit /b %NATIVE_ASSEMBLY_EXIT%

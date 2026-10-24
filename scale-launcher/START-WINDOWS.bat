@echo off
setlocal
cd /d "%~dp0"
py -3 --version >nul 2>&1
if not errorlevel 1 (
  py -3 "serve.py"
  goto done
)
python --version >nul 2>&1
if not errorlevel 1 (
  python "serve.py"
  goto done
)
echo Python 3 is required to start this local game server.
echo Install Python 3 from https://www.python.org/downloads/windows/ and try again.
echo Directly opening index.html is not supported for this 3D build.
:done
echo The game server has stopped.
pause

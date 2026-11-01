@echo off
REM FLUX.2 Studio launcher for Windows. Double-click this file.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Get it from https://www.python.org/downloads/
  echo During install, tick "Add python.exe to PATH". Then double-click start.bat again.
  pause
  exit /b 1
)

if not exist .venv (
  echo First run: setting up, this takes a minute...
  python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
findstr /b /i "FLUX_MODE=local" .env >nul 2>nul && pip install --quiet -r requirements-local.txt

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo Created a settings file called .env
  echo Opening it in Notepad: paste your BFL API key after BFL_API_KEY= then save and close.
  notepad .env
  echo Now double-click start.bat again.
  pause
  exit /b 0
)

python app.py
pause

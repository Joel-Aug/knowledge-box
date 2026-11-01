#!/usr/bin/env bash
# FLUX.2 Studio launcher for macOS / Linux. Run:  ./start.sh
set -e
cd "$(dirname "$0")"

PY=python3
command -v $PY >/dev/null 2>&1 || PY=python
if ! command -v $PY >/dev/null 2>&1; then
  echo "Python is not installed. Get it from https://www.python.org/downloads/ and try again."
  exit 1
fi

if [ ! -d .venv ]; then
  echo "First run: setting up (this takes a minute)..."
  $PY -m venv .venv
fi
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
if grep -qiE '^FLUX_MODE=local' .env 2>/dev/null; then
  pip install --quiet -r requirements-local.txt
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo
  echo "Created a settings file called .env"
  echo "Open it in a text editor, paste your BFL API key after BFL_API_KEY=, save, and run ./start.sh again."
  exit 0
fi

python app.py

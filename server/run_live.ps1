# Starts the optional live generation server on http://localhost:8000 (see server/LIVE.md).
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File server\run_live.ps1
$ErrorActionPreference = "Stop"
$server = $PSScriptRoot                  # the server/ folder
Set-Location (Split-Path -Parent $server) # the repo root, so .env (HF_HOME) is found
. "$server\.venv\Scripts\Activate.ps1"
# Load the models and build one throwaway pack before taking requests, so the first visitor
# doesn't wait for model loading. /health reports busy until this is done (about 30 s).
$env:GHOSTLINES_WARMUP = "1"
uvicorn api:app --app-dir server --host 127.0.0.1 --port 8000

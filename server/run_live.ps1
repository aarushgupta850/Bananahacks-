# Starts the optional live generation server on http://localhost:8000 (see server/LIVE.md).
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File server\run_live.ps1
$ErrorActionPreference = "Stop"
$server = $PSScriptRoot                  # the server/ folder
Set-Location (Split-Path -Parent $server) # the repo root, so .env (HF_HOME) is found
. "$server\.venv\Scripts\Activate.ps1"
# Load the models and build one throwaway pack before taking requests, so the first visitor
# doesn't wait for model loading. /health reports busy until this is done (about 30 s).
$env:GHOSTLINES_WARMUP = "1"
# Also log every request, with the time, to server\out\live.log (the window only keeps its last few screens).
$env:GHOSTLINES_LOG = "1"
# If the server stops (it exits by itself when a GPU job hangs, see STUCK_S in api.py), start it again.
# Close this window, or press Ctrl+C, to stop it for good.
while ($true) {
    uvicorn api:app --app-dir server --host 127.0.0.1 --port 8000
    Write-Host "The live server stopped (exit code $LASTEXITCODE). Restarting in 3 seconds..."
    Start-Sleep -Seconds 3
}

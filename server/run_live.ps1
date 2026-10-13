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
# Better drawings (see server/LIVE.md, "Better drawings"). The first three are on: tested on Oct 13, they drew the
# cleanest monkeys and the only usable basketballs, in about 15 s a lesson instead of 21. Put a # back to turn one off.
$env:GHOSTLINES_LIGHTNING_STEPS = "8"   # cleaner, more even lines; about twice as long per draft (download it first)
$env:GHOSTLINES_PROMPT = "icon_even"    # asks for smooth, symmetrical curves (balls, faces)
$env:GHOSTLINES_PREFER_SYMMETRY = "1"   # of near-equally clean drafts, keep the most mirror-symmetric one
# $env:GHOSTLINES_LIVE_CANDIDATES = "3"   # drafts per live lesson (default: 3, or 2 with 8 steps)
# Draw with OpenAI's image model instead of SDXL (see server/LIVE.md, "Drawing with OpenAI"). Needs OPENAI_API_KEY
# in .env (never committed). Costs money per picture. Remove the # to turn it on.
# $env:GHOSTLINES_IMAGE_MODEL = "openai"

# If the server stops (it exits by itself when a GPU job hangs, see STUCK_S in api.py), start it again.
# Close this window, or press Ctrl+C, to stop it for good.
while ($true) {
    uvicorn api:app --app-dir server --host 127.0.0.1 --port 8000
    Write-Host "The live server stopped (exit code $LASTEXITCODE). Restarting in 3 seconds..."
    Start-Sleep -Seconds 3
}

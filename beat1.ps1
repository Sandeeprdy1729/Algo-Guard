# =====================================================================
# AgentGuard -- beat1.ps1
# HAPPY PATH -- small paid call, policy allows, x402 settles.
# =====================================================================

$ErrorActionPreference = 'Stop'
$Repo        = $PSScriptRoot
$BackendUrl  = 'http://localhost:4021'

# Backend must be up -- bail loudly if not.
try {
    $health = Invoke-RestMethod -Uri "$BackendUrl/health" -TimeoutSec 3
    if ($health.status -ne 'ok') { throw "health.status = $($health.status)" }
} catch {
    Write-Host ''
    Write-Host 'ERROR: backend not reachable at http://localhost:4021.' -ForegroundColor Red
    Write-Host '       run  .\demo.ps1  first.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Cyan
Write-Host '  BEAT 1 -- HAPPY PATH  (POST /llm/summarize @ $0.01)' -ForegroundColor Cyan
Write-Host '=====================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  what to watch:' -ForegroundColor Yellow
Write-Host '    terminal   -> "status = 200" + "paid via <txid>" + summary body'
Write-Host '    dashboard  -> Overview: a green "settled" row appears live'
Write-Host '                 click the "tx ^" link -> Lora shows the real USDC transfer'
Write-Host ''
Write-Host '  running scenario...' -ForegroundColor Gray
Write-Host ''

Set-Location "$Repo\apps\demo-agent"
& node_modules\.bin\tsx src\index.ts happy
$exit = $LASTEXITCODE

Write-Host ''
if ($exit -eq 0) {
    Write-Host '  beat 1 finished. Show the dashboard now.' -ForegroundColor Green
} else {
    Write-Host "  beat 1 exited with code $exit -- inspect output above." -ForegroundColor Red
}
Write-Host ''

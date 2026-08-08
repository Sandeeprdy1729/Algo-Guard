# =====================================================================
# AgentGuard -- beat2.ps1
# RUNAWAY AGENT -- 20 rapid-fire calls; the daily cap kicks in mid-burst
# and every remaining request is refused by the policy engine.
#
# Uses whatever policy is currently committed. demo.ps1 sets daily=$0.10
# which is what makes the cap visibly trip; if you've raised the cap
# (e.g. after beat 3) re-run demo.ps1 first to reset.
# =====================================================================

$ErrorActionPreference = 'Stop'
$Repo        = $PSScriptRoot
$BackendUrl  = 'http://localhost:4021'

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
Write-Host '  BEAT 2 -- RUNAWAY AGENT  (20x POST /llm/summarize)' -ForegroundColor Cyan
Write-Host '=====================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  what to watch:' -ForegroundColor Yellow
Write-Host '    terminal   -> first few lines "#N 200 paid ..." (settled)'
Write-Host '                 then "#N 403 Daily cap 0.10 USDC would be exceeded"'
Write-Host '    dashboard  -> Audit -> click the "blocked_policy" filter pill'
Write-Host '                 hover a red row to see the exact reason'
Write-Host '                 Overview: Blocked counter jumps + live rows go red'
Write-Host ''
Write-Host '  running scenario...' -ForegroundColor Gray
Write-Host ''

Set-Location "$Repo\apps\demo-agent"
& node_modules\.bin\tsx src\index.ts risky
$exit = $LASTEXITCODE

Write-Host ''
if ($exit -eq 0) {
    Write-Host '  beat 2 finished.' -ForegroundColor Green
    Write-Host '  voice-over line:' -ForegroundColor Cyan
    Write-Host '    "We do not ask the agent to obey the budget.' -ForegroundColor White
    Write-Host '     AgentGuard enforces the spending limit outside the agent."' -ForegroundColor White
} else {
    Write-Host "  beat 2 exited with code $exit -- inspect output above." -ForegroundColor Red
}
Write-Host ''

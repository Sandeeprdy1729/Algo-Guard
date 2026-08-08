# =====================================================================
# AgentGuard -- beat3.ps1
# HUMAN APPROVAL -- $0.50 render is above the human threshold but under
# the (raised) daily cap. Agent gets a 403 with an escalation intent,
# waits, human clicks Approve in the dashboard, agent retries + settles.
#
# This script:
#   1. Bumps the daily cap to $1.00 so the render doesn't trip DAILY_CAP.
#   2. Runs the escalate scenario.
#   3. Does NOT auto-approve. The presenter clicks Approve in the UI.
# =====================================================================

$ErrorActionPreference = 'Stop'
$Repo        = $PSScriptRoot
$BackendUrl  = 'http://localhost:4021'
$AppUrl      = 'http://localhost:3000/approvals'

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
Write-Host '  BEAT 3 -- HUMAN APPROVAL  (POST /gpu/render @ $0.50)' -ForegroundColor Cyan
Write-Host '=====================================================' -ForegroundColor Cyan

# -- Bump the daily cap so escalation branch is reachable --------------
Write-Host ''
Write-Host '  raising daily cap to $1.00 (threshold stays $0.05)...' -ForegroundColor Yellow

try {
    $agentsResp = Invoke-RestMethod -Uri "$BackendUrl/api/agents" -TimeoutSec 5
    if (-not $agentsResp.agents -or $agentsResp.agents.Count -eq 0) {
        throw 'no agents registered'
    }
    $agent   = $agentsResp.agents[0]
    $agentId = $agent.id

    $policyBody = @{
        policy = @{
            agentAddress             = $agent.algoAddress
            dailyCapMicroUsdc        = 1000000
            monthlyCapMicroUsdc      = 5000000
            humanThresholdMicroUsdc  = 50000
            allowedRoutes            = @('POST /llm/summarize', 'POST /gpu/render')
            riskThreshold            = 70
            frozen                   = $false
        }
    } | ConvertTo-Json -Depth 5

    Invoke-RestMethod -Uri "$BackendUrl/api/policies/$agentId/commit" `
        -Method Post -ContentType 'application/json' -Body $policyBody | Out-Null
    Write-Host '  policy committed.'
} catch {
    Write-Host 'ERROR: could not commit policy.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '  presenter actions during this scenario:' -ForegroundColor Yellow
Write-Host "    1. wait for the terminal to print `"escalated: intent <id>`""
Write-Host "    2. open  $AppUrl"
Write-Host "    3. click the green [Approve] button on the pending card"
Write-Host "    4. return here -- retry will settle within ~2 s"
Write-Host ''
Write-Host '  running scenario...' -ForegroundColor Gray
Write-Host ''

Set-Location "$Repo\apps\demo-agent"
& node_modules\.bin\tsx src\index.ts escalate
$exit = $LASTEXITCODE

Write-Host ''
if ($exit -eq 0) {
    Write-Host '  beat 3 finished. Show the audit trail on the dashboard.' -ForegroundColor Green
    Write-Host '  voice-over line:' -ForegroundColor Cyan
    Write-Host '    "AgentGuard allows autonomous agents to transact within programmable' -ForegroundColor White
    Write-Host '     limits, blocks runaway spending, and brings a human into the loop' -ForegroundColor White
    Write-Host '     when a transaction exceeds the configured approval threshold."' -ForegroundColor White
} else {
    Write-Host "  beat 3 exited with code $exit -- inspect output above." -ForegroundColor Red
}
Write-Host ''

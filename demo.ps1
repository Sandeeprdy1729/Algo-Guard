# =====================================================================
# AgentGuard -- demo.ps1
# One-shot startup + reset for the hackathon final demo.
#
# What this does:
#   1. Kills any stale process on ports 4021 / 8000 / 3000.
#   2. Boots AI service, backend server, and dashboard in new windows.
#   3. Waits for the backend /health to respond.
#   4. Looks up the existing demo agent via the live API.
#   5. Commits the Beat 1 / Beat 2 policy (daily $0.10, threshold $0.05).
#   6. Denies any stale pending approvals so Beat 3 starts clean.
#   7. Prints URLs + agent id.
#
# What this does NOT do:
#   - Run any demo scenario. Presenter runs beat1/2/3.ps1 by hand.
#   - Touch .env files, secrets, or wallets. All creds stay in .env.
# =====================================================================

$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot

$BackendUrl   = 'http://localhost:4021'
$AiUrl        = 'http://localhost:8000'
$DashboardUrl = 'http://localhost:3000'

function Kill-Port([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            try {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop
                Write-Host "  killed pid $($_.OwningProcess) on :$Port"
            } catch {}
        }
}

function Start-InNewWindow([string]$Title, [string]$WorkDir, [string]$Command) {
    $body = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $Command"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-Command', $body
    ) | Out-Null
}

function Wait-ForUrl([string]$Url, [int]$TimeoutSec = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($r.StatusCode -eq 200) { return $true }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    return $false
}

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Cyan
Write-Host '  AgentGuard demo -- startup & reset' -ForegroundColor Cyan
Write-Host '=====================================================' -ForegroundColor Cyan

Write-Host ''
Write-Host '[1/6] killing stale processes on 4021 / 8000 / 3000...' -ForegroundColor Yellow
Kill-Port 4021
Kill-Port 8000
Kill-Port 3000
Start-Sleep -Seconds 2

Write-Host ''
Write-Host '[2/6] launching AI service (new window)...' -ForegroundColor Yellow
Start-InNewWindow 'AgentGuard AI :8000' "$Repo\apps\ai-service" `
    'python -m uvicorn main:app --port 8000'

Write-Host '[3/6] launching backend server (new window)...' -ForegroundColor Yellow
Start-InNewWindow 'AgentGuard Server :4021' "$Repo\apps\server" `
    '$env:LOG_PRETTY=1; node_modules\.bin\tsx src\index.ts'

Write-Host '[4/6] launching dashboard (new window)...' -ForegroundColor Yellow
Start-InNewWindow 'AgentGuard Dashboard :3000' "$Repo\apps\dashboard" `
    'node_modules\.bin\next dev -p 3000'

Write-Host ''
Write-Host '[5/6] waiting for backend /health...' -ForegroundColor Yellow
if (-not (Wait-ForUrl "$BackendUrl/health" 60)) {
    Write-Host ''
    Write-Host 'ERROR: backend did not respond within 60 s.' -ForegroundColor Red
    Write-Host '       check the "AgentGuard Server :4021" window for errors.' -ForegroundColor Red
    exit 1
}
Write-Host '  backend is up.'

Write-Host ''
Write-Host '[6/6] configuring demo policy + clearing stale approvals...' -ForegroundColor Yellow

try {
    $agentsResp = Invoke-RestMethod -Uri "$BackendUrl/api/agents" -Method Get -TimeoutSec 10
} catch {
    Write-Host 'ERROR: could not query /api/agents.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

if (-not $agentsResp.agents -or $agentsResp.agents.Count -eq 0) {
    Write-Host 'ERROR: no agents registered on the backend.' -ForegroundColor Red
    Write-Host '       run:  python contracts/register_agent.py' -ForegroundColor Red
    Write-Host '       and register the agent via the dashboard first.' -ForegroundColor Red
    exit 1
}

$agent    = $agentsResp.agents[0]
$agentId  = $agent.id
$agentAdr = $agent.algoAddress

$policyBody = @{
    policy = @{
        agentAddress             = $agentAdr
        dailyCapMicroUsdc        = 100000
        monthlyCapMicroUsdc      = 5000000
        humanThresholdMicroUsdc  = 50000
        allowedRoutes            = @('POST /llm/summarize', 'POST /gpu/render')
        riskThreshold            = 70
        frozen                   = $false
    }
} | ConvertTo-Json -Depth 5

try {
    Invoke-RestMethod -Uri "$BackendUrl/api/policies/$agentId/commit" `
        -Method Post -ContentType 'application/json' -Body $policyBody | Out-Null
    Write-Host '  policy committed  (daily $0.10, monthly $5, threshold $0.05)'
} catch {
    Write-Host 'ERROR: policy commit failed.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

try {
    $pending = (Invoke-RestMethod -Uri "$BackendUrl/api/approvals?status=pending" -TimeoutSec 5).approvals
    foreach ($a in $pending) {
        Invoke-RestMethod -Uri "$BackendUrl/api/approvals/$($a.id)/decision" `
            -Method Post -ContentType 'application/json' `
            -Body '{"decision":"denied"}' | Out-Null
    }
    Write-Host "  cleared $($pending.Count) stale pending approval(s)"
} catch {
    Write-Host "  (skipping approvals cleanup: $($_.Exception.Message))" -ForegroundColor DarkYellow
}

Write-Host ''
Write-Host '=====================================================' -ForegroundColor Green
Write-Host '  demo is READY.' -ForegroundColor Green
Write-Host '=====================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Dashboard  : $DashboardUrl" -ForegroundColor White
Write-Host "  Backend    : $BackendUrl" -ForegroundColor White
Write-Host "  AI service : $AiUrl" -ForegroundColor White
Write-Host "  Agent      : $($agent.name)  ($agentAdr)"
Write-Host "  Agent ID   : $agentId" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Next steps:' -ForegroundColor Cyan
Write-Host '    .\beat1.ps1     # happy path -- small paid call'
Write-Host '    .\beat2.ps1     # runaway loop -- daily cap kicks in'
Write-Host '    .\beat3.ps1     # $0.50 render -- human approval required'
Write-Host ''

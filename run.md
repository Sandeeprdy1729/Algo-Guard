PowerShell version — copy-paste ready.

## First — kill anything on the ports (one PowerShell window)

```powershell
@(4021,8000,3000) | ForEach-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force } catch {} } }
```

## Boot the 3 services (3 separate PowerShell windows, in order)

**Terminal 1 — AI service**
```powershell
cd D:\Hackathon\apps\ai-service
python -m uvicorn main:app --port 8000
```

**Terminal 2 — Backend server**
```powershell
cd D:\Hackathon\apps\server
$env:LOG_PRETTY=1
node_modules\.bin\tsx src\index.ts
```

**Terminal 3 — Dashboard**
```powershell
cd D:\Hackathon\apps\dashboard
node_modules\.bin\next dev -p 3000
```

Open browser: **http://localhost:3000**

---

## Reset policy for demo (Terminal 4)

```powershell
$AGENT_ID = (curl.exe -s http://localhost:4021/api/agents | ConvertFrom-Json).agents[0].id
$AGENT_ID
```

Now push the demo policy (daily $0.10, threshold $0.05):

```powershell
$body = @'
{"policy":{"agentAddress":"IUHZA64HKSAEUPAOCPXZ5WCAJU6HHYUZY4MQHHEEEWSKGYFP6ACBKIOEFQ","dailyCapMicroUsdc":100000,"monthlyCapMicroUsdc":5000000,"humanThresholdMicroUsdc":50000,"allowedRoutes":["POST /llm/summarize","POST /gpu/render"],"riskThreshold":70,"frozen":false}}
'@
curl.exe -sS -X POST "http://localhost:4021/api/policies/$AGENT_ID/commit" -H "content-type: application/json" -d $body
```

Clear any stale pending approvals from prior runs:

```powershell
$pending = (Invoke-RestMethod "http://localhost:4021/api/approvals?status=pending").approvals
foreach ($a in $pending) {
  curl.exe -sS -X POST "http://localhost:4021/api/approvals/$($a.id)/decision" -H "content-type: application/json" -d '{"decision":"denied"}' | Out-Null
}
"cleared $($pending.Count) stale approval(s)"
```

---

## 🎬 DEMO COMMANDS (Terminal 4)

```powershell
cd D:\Hackathon\apps\demo-agent
```

### Beat 1 — Happy path
```powershell
node_modules\.bin\tsx src\index.ts happy
```
→ Wait for `status = 200` + `paid via <txid>`. Switch to dashboard → **Overview** → green row appears live. Click **tx ↗** to show Lora.

### Beat 2 — Runaway (daily cap)
```powershell
node_modules\.bin\tsx src\index.ts risky
```
→ 20 calls; first ~8 green, rest red with `Daily cap 0.10 USDC would be exceeded`. Switch to dashboard → **Audit** → click **blocked_policy** filter pill.

### Beat 3 — Human approval

**Bump the cap first** so the $0.50 render escalates instead of getting cap-blocked:

```powershell
$body = @'
{"policy":{"agentAddress":"IUHZA64HKSAEUPAOCPXZ5WCAJU6HHYUZY4MQHHEEEWSKGYFP6ACBKIOEFQ","dailyCapMicroUsdc":1000000,"monthlyCapMicroUsdc":5000000,"humanThresholdMicroUsdc":50000,"allowedRoutes":["POST /llm/summarize","POST /gpu/render"],"riskThreshold":70,"frozen":false}}
'@
curl.exe -sS -X POST "http://localhost:4021/api/policies/$AGENT_ID/commit" -H "content-type: application/json" -d $body
```

Then run escalate:

```powershell
node_modules\.bin\tsx src\index.ts escalate
```

→ Terminal shows `escalated: intent <id>` and starts polling.
→ **Switch to dashboard → click "Approvals" nav → click the green "Approve" button on the pending card.**
→ Within 2 seconds terminal shows `decision = approved` → `retry status = 200` + a real render URL.

---

## If it breaks mid-demo

**Agent says `UNKNOWN_AGENT`** — re-register:
```powershell
$body = @'
{"userEmail":"demo@agentguard.dev","adminAddress":"IUHZA64HKSAEUPAOCPXZ5WCAJU6HHYUZY4MQHHEEEWSKGYFP6ACBKIOEFQ","name":"Pera main","algoAddress":"IUHZA64HKSAEUPAOCPXZ5WCAJU6HHYUZY4MQHHEEEWSKGYFP6ACBKIOEFQ"}
'@
curl.exe -sS -X POST http://localhost:4021/api/agents -H "content-type: application/json" -d $body
```
Then re-run the policy reset command above.

**Escalate hangs forever** — old approvals stuck in queue. Re-run the "clear stale approvals" `foreach` block above, then re-run escalate.

**Total network death** — open in the browser:
```
https://lora.algokit.io/testnet/application/768730271
```
Say: "The contract is still live on chain — here are our SPND events."

Go win it.
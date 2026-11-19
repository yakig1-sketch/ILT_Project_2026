# ILT beta readiness check (Phase 6b-prime). Run on NucBox, in a normal PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\Users\Yaki\Documents\GitHub\ILT_Project_2026\infra\beta\check-beta.ps1
# It only reads: it changes nothing in the beta, its data or Cloudflare. Every line says PASS, WARN or FAIL.

$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 would otherwise try an old TLS version, which Cloudflare refuses.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$beta = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $beta
$script:fails = 0
$script:warns = 0

function Check([bool]$ok, [string]$what, [string]$fix = '') {
  if ($ok) { Write-Host "PASS  $what" -ForegroundColor Green }
  else {
    $script:fails++
    Write-Host "FAIL  $what" -ForegroundColor Red
    if ($fix) { Write-Host "      -> $fix" -ForegroundColor Yellow }
  }
}
function Warn([bool]$ok, [string]$what, [string]$note) {
  if ($ok) { Write-Host "PASS  $what" -ForegroundColor Green }
  else { $script:warns++; Write-Host "WARN  $what" -ForegroundColor Yellow; Write-Host "      -> $note" -ForegroundColor Yellow }
}
function Num($s) { $n = 0; [void][int]::TryParse("$s".Trim(), [ref]$n); return $n }
function Compose { docker compose --env-file beta.env -f compose.beta.yml @args 2>$null }
function Sql([string]$q) { (Compose exec -T db psql -U ilt_owner -d ilt -At -c $q | Out-String).Trim() }
# One HTTP request that does not follow redirects, so a Cloudflare sign-in shows as 302. (Invoke-WebRequest
# in Windows PowerShell 5.1 throws on a redirect it may not follow, and the status code is lost.)
function Fetch([string]$url) {
  $resp = $null
  $script:fetchError = ''
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.AllowAutoRedirect = $false
    $req.Timeout = 15000
    $resp = $req.GetResponse()
  }
  catch {
    # PowerShell wraps the .NET error; an HTTP error status (4xx, 5xx) still carries the response.
    $e = $PSItem.Exception
    while ($e -and -not ($e -is [System.Net.WebException])) { $e = $e.InnerException }
    if ($e) { $resp = $e.Response; $script:fetchError = $e.Message } else { $script:fetchError = $PSItem.Exception.Message }
  }
  if (-not $resp) { return @{ code = 0; body = ''; error = $script:fetchError } }
  $code = [int]$resp.StatusCode
  $body = ''
  try { $reader = New-Object System.IO.StreamReader($resp.GetResponseStream()); $body = $reader.ReadToEnd(); $reader.Close() } catch { }
  $resp.Close()
  return @{ code = $code; body = $body; error = '' }
}

Write-Host "`nILT beta readiness check  $(Get-Date -Format 'yyyy-MM-dd HH:mm')`n"

# 1. Docker and the beta stack
docker info *> $null
Check ($LASTEXITCODE -eq 0) 'Docker Desktop is running' 'Start Docker Desktop and wait until it says "Engine running", then run this check again'
Check (Test-Path (Join-Path $beta 'beta.env')) 'beta.env exists' 'README, First install, step 1'
$running = @(Compose ps --services --status running)
foreach ($svc in 'db', 's3', 'gateway', 'analytics', 'web') {
  Check ($running -contains $svc) "Container '$svc' is running" 'docker compose --env-file beta.env -f compose.beta.yml up -d'
}
$health = (docker inspect -f '{{.State.Health.Status}}' ilt-beta-gateway-1 2>$null)
Check ($health -eq 'healthy') "Gateway health: $health" 'docker compose --env-file beta.env -f compose.beta.yml logs --tail 50 gateway'
$ports = (docker port ilt-beta-web-1 2>$null | Out-String)
Check ($ports -match '127\.0\.0\.1:8088') 'The beta listens on 127.0.0.1:8088 only' 'Check BETA_PORT in beta.env and compose.beta.yml'
$hello = @(docker ps -a --filter name=ilt-beta-hello --format '{{.Names}}')
Check ($hello.Count -eq 0) 'The Cloudflare placeholder (ilt-beta-hello) is removed' 'docker rm -f ilt-beta-hello'

# 2. The beta answers on NucBox
$h = Fetch 'http://127.0.0.1:8088/api/v1/health'
Check ($h.code -eq 200 -and $h.body -match '"db":true' -and $h.body -match '"s3":true') "API health (database and storage): HTTP $($h.code)" 'Look at the gateway logs (see above)'
$a = Fetch 'http://127.0.0.1:8088/analytics/api/v1/health'
Check ($a.code -eq 200) "Analytics health: HTTP $($a.code)" 'docker compose --env-file beta.env -f compose.beta.yml logs --tail 50 analytics'
$l = Fetch 'http://127.0.0.1:8088/'
Check ($l.code -eq 200 -and $l.body -match 'Invented Letter Task') "Landing page at /: HTTP $($l.code)" 'Rebuild the web image (it carries apps/landing), then up -d'
foreach ($app in 'cockpit', 'tablet', 'analyst') {
  $p = Fetch "http://127.0.0.1:8088/$app/"
  Check ($p.code -eq 200) "/$app/ loads: HTTP $($p.code)" 'Rebuild: docker compose --env-file beta.env -f compose.beta.yml build, then up -d'
}

# 3. The database
$last = Sql 'SELECT max(name) FROM schema_migrations'
Check ($last -like '0014*') "Database migrations up to date: $last" 'docker compose --env-file beta.env -f compose.beta.yml run --rm ops src/migrate.ts'
$canvases = Sql "SELECT count(*) FROM canvases WHERE status = 'ACTIVE' AND canvas_type IN ('ILT_GRID', 'NOTEBOOK')"
Check ((Num $canvases) -ge 4) "Reference data loaded ($canvases active ILT and notebook canvases)" 'docker compose --env-file beta.env -f compose.beta.yml run --rm ops src/seed.ts'
$videos = Sql "SELECT count(*) FROM instruction_videos WHERE status = 'ACTIVE'"
Warn ((Num $videos) -ge 2) "Instruction videos loaded ($videos)" 'Run git lfs pull, rebuild, then the seed again (README, step 5); sessions still run, video steps are skipped'
$admins = Sql "SELECT count(*) FROM users WHERE is_active AND role = 'ADMIN'"
Check ((Num $admins) -ge 1) "An active System Administrator account ($admins)" 'README, First install, step 6'
$dev = Sql "SELECT count(*) FROM users WHERE email LIKE '%@ilt.local'"
Check ((Num $dev) -eq 0) 'No development accounts (@ilt.local)' 'Deactivate them under Admin, Users'
$testers = Sql "SELECT count(*) FROM users WHERE is_active AND role <> 'ADMIN'"
Warn ((Num $testers) -ge 1) "Tester accounts ($testers active evaluators, researchers or analysts)" 'Create them under Admin, Users before inviting testers'
$ja = Sql "SELECT count(*) FROM languages WHERE code = 'ja'"
Check ((Num $ja) -eq 0) 'Japanese is not installed in the beta (as asked)' 'The beta was built or seeded from the Japanese branch: tell Claude'

# 4. Cloudflare
$svc = Get-Service cloudflared -ErrorAction SilentlyContinue
Check ($svc -and $svc.Status -eq 'Running') "cloudflared service: $(if ($svc) { $svc.Status } else { 'not installed' })" 'Administrator PowerShell: Start-Service cloudflared'
Check ($svc -and $svc.StartType -eq 'Automatic') 'cloudflared starts with Windows' 'Administrator PowerShell: Set-Service cloudflared -StartupType Automatic'
$cf = Fetch 'https://beta.ilt.network/cockpit/'
Check ($cf.code -eq 302) "https://beta.ilt.network asks for the Cloudflare sign-in: HTTP $($cf.code) $($cf.error)" 'Check the tunnel route and the ILT Beta Access application in Zero Trust'
$cfh = Fetch 'https://beta.ilt.network/'
Check ($cfh.code -eq 302) "The landing page (https://beta.ilt.network/) also asks for the Cloudflare sign-in: HTTP $($cfh.code) $($cfh.error)" 'The Access application must cover the whole address beta.ilt.network, with Path empty'

# 5. NucBox stays awake
$sleep = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC Power Setting Index' | Out-String)
Warn ($sleep -match '0x00000000') 'NucBox never sleeps when plugged in' 'Settings, System, Power: when plugged in, sleep after Never'

Write-Host ''
if ($script:fails -eq 0) {
  Write-Host "READY: no failures ($($script:warns) warnings). Last step: sign in from a phone on mobile data at https://beta.ilt.network/cockpit/" -ForegroundColor Green
} else {
  Write-Host "NOT READY: $($script:fails) failure(s), $($script:warns) warning(s). Fix the FAIL lines from the top, then run this again." -ForegroundColor Red
}

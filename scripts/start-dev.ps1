# One-command local development launcher for CampusAI on Windows (WSL PostgreSQL + API + AI + Web).
# Usage (from repo root):  powershell -NoProfile -File scripts/start-dev.ps1
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..").Path

Write-Host "[1/4] Starting WSL PostgreSQL 16 + pgvector (keepalive)..." -ForegroundColor Cyan
$wslPath = ($root -replace '^([A-Za-z]):', { '/mnt/' + $_.Groups[1].Value.ToLower() }) -replace '\\', '/'
$pg = Start-Process -FilePath "wsl" -ArgumentList "-d", "Ubuntu", "-u", "root", "--", "bash", "-c", "bash $wslPath/infra/scripts/wsl-postgres.sh >/dev/null 2>&1; exec sleep infinity" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

Write-Host "[2/4] Starting FastAPI AI Service (http://127.0.0.1:8000)..." -ForegroundColor Cyan
$ai = Start-Process -FilePath "$root\services\ai\.venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "campusai_ai.api.main:app", "--host", "127.0.0.1", "--port", "8000" -WorkingDirectory "$root\services\ai" -PassThru

Write-Host "[3/4] Starting Spring Boot API (http://127.0.0.1:8080)..." -ForegroundColor Cyan
$api = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-File", "$root\scripts\start-api.ps1" -WorkingDirectory $root -PassThru

Write-Host "[4/4] Starting Vite Frontend (http://127.0.0.1:5173)..." -ForegroundColor Cyan
$web = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev -- --host 127.0.0.1 --port 5173" -WorkingDirectory "$root\apps\web" -PassThru

Write-Host "`nCampusAI is launching! Open http://127.0.0.1:5173 in your browser." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop all services." -ForegroundColor Yellow

try {
  Wait-Process -Id $web.Id
} finally {
  foreach ($p in @($web, $api, $ai, $pg)) {
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  }
}

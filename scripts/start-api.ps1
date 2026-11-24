# Starts Postgres is NOT handled here. Loads .env into the environment, then starts the Spring API (port 8080).
# Usage (from repo root):  powershell -File scripts/start-api.ps1
Get-Content "$PSScriptRoot\..\.env" | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2
  if ($v) { [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), 'Process') }
}
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Java\jdk-21' }
Set-Location "$PSScriptRoot\..\services\api"
if (-not (Test-Path target\campusai-api-1.0.0.jar)) { mvn -B -q -DskipTests package }
& "$env:JAVA_HOME\bin\java.exe" -jar target\campusai-api-1.0.0.jar

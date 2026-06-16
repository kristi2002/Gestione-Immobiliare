# Load demo data into the Docker database for UI/stress testing.
param(
    [switch]$Fresh,
    [int]$Scale = 1
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root 'Dockerfile'))) {
    $Root = Get-Location
}

$args = @('php', '/var/www/html/scripts/seed_demo.php')
if ($Fresh) { $args += '--fresh' }
if ($Scale -gt 1) { $args += "--scale=$Scale" }

Write-Host "Running demo seed (scale=$Scale, fresh=$($Fresh.IsPresent))…"
docker exec gestioneimmobiliare-app-1 @args
exit $LASTEXITCODE

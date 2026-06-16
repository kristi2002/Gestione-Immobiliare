# Syncs project to a local (non-OneDrive) folder, then runs Docker Compose.
# OneDrive reparse points break `docker build` when using the project folder directly.

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ComposeArgs = @('up', '--build')
)

$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Src 'Dockerfile'))) {
    $Src = Get-Location
}

$Dst = Join-Path $env:LOCALAPPDATA 'gestionale-docker-build'

Write-Host "Syncing to $Dst ..."

$null = robocopy $Src $Dst /MIR /XD .git .claude uploads backups node_modules mcps .cursor `
    /XF .env .env.docker .setup_complete `
    /NFL /NDL /NJH /NJS /nc /ns /np

if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

$env:GESTIONALE_BUILD_CONTEXT = $Dst

Push-Location $Src
try {
    & docker compose @ComposeArgs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}

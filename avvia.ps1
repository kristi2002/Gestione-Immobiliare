# ============================================================
# avvia.ps1 — Avvia il gestionale completo
# Uso: tasto destro → "Esegui con PowerShell"
#      oppure da terminale: .\avvia.ps1
# ============================================================

$projectDir = $PSScriptRoot
Set-Location $projectDir

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Gestionale Immobiliare — Avvio completo" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Build & start containers ─────────────────────────────
Write-Host "[1/4] Build immagine Docker..." -ForegroundColor Yellow
docker compose build app
if ($LASTEXITCODE -ne 0) { Write-Host "ERRORE nel build!" -ForegroundColor Red; Read-Host "Premi Invio"; exit 1 }

Write-Host ""
Write-Host "[2/4] Avvio containers (app + db)..." -ForegroundColor Yellow
docker compose up -d --force-recreate app
if ($LASTEXITCODE -ne 0) { Write-Host "ERRORE nell'avvio!" -ForegroundColor Red; Read-Host "Premi Invio"; exit 1 }

# Aspetta che il DB sia healthy
Write-Host "      In attesa che il database sia pronto..." -ForegroundColor Gray
$attempts = 0
do {
    Start-Sleep -Seconds 3
    $status = docker inspect --format='{{.State.Health.Status}}' gestioneimmobiliare-db-1 2>$null
    $attempts++
} while ($status -ne "healthy" -and $attempts -lt 20)

if ($status -ne "healthy") {
    Write-Host "ERRORE: Database non risponde." -ForegroundColor Red
    Read-Host "Premi Invio"; exit 1
}
Write-Host "      Database pronto." -ForegroundColor Green

# ── 2. Run migrations ────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Esecuzione migrazioni e seed..." -ForegroundColor Yellow

# Migrations in order
$migrations = @(
    "database/migrations/phase18_frequencies_automations.sql",
    "database/migrations/phase19_reminders_maintenance_cols.sql"
)
foreach ($migration in $migrations) {
    if (Test-Path "$projectDir\$migration") {
        $sql = Get-Content "$projectDir\$migration" -Raw
        $result = echo $sql | docker exec -i gestioneimmobiliare-db-1 mysql -u root -proot gestione_immobiliare 2>&1
        if ($result -match "ERROR") {
            Write-Host "  Migrazione ${migration}: $result" -ForegroundColor Gray
        } else {
            Write-Host "  OK: $migration" -ForegroundColor Green
        }
    }
}

# Seed
$seedFile = "database/seeds/seed_all.sql"
if (Test-Path "$projectDir\$seedFile") {
    $sql = Get-Content "$projectDir\$seedFile" -Raw
    $result = echo $sql | docker exec -i gestioneimmobiliare-db-1 mysql -u root -proot gestione_immobiliare 2>&1
    if ($result -match "ERROR 1146|ERROR 1054") {
        Write-Host "  Seed: alcune tabelle mancanti (schema incompleto)" -ForegroundColor Yellow
    } else {
        Write-Host "  OK: seed_all.sql" -ForegroundColor Green
    }
}

# Fix portal passwords via PHP inside container
Write-Host "      Generazione password portale inquilini..." -ForegroundColor Gray
$phpScript = @'
<?php
require_once "/var/www/html/config/db.php";
$db = getDB();
$hash = password_hash("Portale123!", PASSWORD_DEFAULT);
$stmt = $db->prepare("UPDATE tenant_users SET password_hash = ? WHERE tenant_id <= 8");
$stmt->execute([$hash]);
echo "Password aggiornate: " . $stmt->rowCount() . " inquilini\n";
'@
$phpScript | docker exec -i gestioneimmobiliare-app-1 php 2>&1 | Write-Host -ForegroundColor Green

# ── 3. Start ngrok ───────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] Avvio ngrok..." -ForegroundColor Yellow
docker compose up -d ngrok
Start-Sleep -Seconds 5

try {
    $tunnels = (Invoke-WebRequest -Uri "http://localhost:4040/api/tunnels" -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
    $url = $tunnels.tunnels[0].public_url
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "  APPLICAZIONE AVVIATA!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Locale:   http://localhost:8090" -ForegroundColor White
    Write-Host "  Pubblico: $url" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Dashboard ngrok: http://localhost:4040" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "  Locale:   http://localhost:8090" -ForegroundColor White
    Write-Host "  ngrok:    vedi http://localhost:4040 per URL pubblico" -ForegroundColor Gray
    Write-Host ""
}

Read-Host "Premi Invio per chiudere"

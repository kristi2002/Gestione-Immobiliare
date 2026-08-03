<?php
/**
 * Portale Inquilino — le azioni che non riguardano l'account.
 *
 * POST { action: 'message',  body }
 * POST { action: 'reading',  meter_id, value, date }
 * POST { action: 'privacy',  kind: 'export'|'erasure', reason? }
 *
 * Stanno insieme perche' condividono la stessa porta: sessione inquilino,
 * token CSRF, tetto per IP, e nessun identificativo di proprieta' che arrivi
 * dal browser — l'inquilino e' sempre quello della sessione.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/csrf.php';
require_once __DIR__ . '/../config/rate_limit.php';

initTenantSession();

header('Content-Type: application/json; charset=utf-8');

function actOut(bool $ok, $payload, int $code = 200): never
{
    http_response_code($code);
    exit(json_encode($ok ? ['success' => true, 'data' => $payload]
                         : ['success' => false, 'error' => $payload]));
}

if (!isTenantLoggedIn())                   actOut(false, 'Non autorizzato.', 401);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') actOut(false, 'Metodo non consentito.', 405);

$body = json_decode((string) file_get_contents('php://input'), true) ?: [];
$sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($body['csrf_token'] ?? '');
if ($sent === '' || !hash_equals(getCsrfToken(), (string) $sent)) {
    actOut(false, 'Token CSRF non valido.', 403);
}

$tenantId = getCurrentTenantId();
$db       = getDB();
$action   = (string) ($body['action'] ?? '');

/** Il contratto in corso: da qui vengono immobile e proprietario. */
$contract   = getTenantCurrentContract($db, $tenantId);
$propertyId = (int) ($contract['property_id'] ?? 0);

// ─────────────────────────────────────────────────────────────────────────────
// Messaggio nel filo diretto
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'message') {
    checkRateLimit('tenant_message', 30, 900);

    $text = trim((string) ($body['body'] ?? ''));
    if ($text === '')            actOut(false, 'Scrivi un messaggio.', 400);
    if (mb_strlen($text) > 4000) actOut(false, 'Messaggio troppo lungo (massimo 4000 caratteri).', 400);

    // `direction = received` perche' e' l'AGENZIA a riceverlo: il verso e'
    // sempre raccontato dal punto di vista del gestionale, non del portale.
    // Il canale 'portale' (phase98) tiene questi messaggi distinti dalle email
    // e dalle note interne — vedi la nota su comunicazioni phase67.
    $stmt = $db->prepare(
        "INSERT INTO communications
            (tenant_id, client_id, property_id, direction, channel, subject, body, status, created_at)
         VALUES (:tid, :cid, :pid, 'received', 'portale', :subj, :body, 'received', NOW())"
    );
    $stmt->execute([
        'tid'  => $tenantId,
        // Il proprietario si porta dietro solo come contesto per l'agenzia:
        // il perimetro di LETTURA del portale resta `tenant_id`.
        'cid'  => $contract['property_client_id'] ?? null,
        'pid'  => $propertyId ?: null,
        'subj' => 'Messaggio dal portale inquilino',
        'body' => $text,
    ]);

    actOut(true, ['message' => 'Messaggio inviato.', 'id' => (int) $db->lastInsertId()]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Autolettura di un contatore
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'reading') {
    checkRateLimit('tenant_reading', 20, 900);

    $meterId = (int) ($body['meter_id'] ?? 0);
    $rawVal  = str_replace(',', '.', trim((string) ($body['value'] ?? '')));
    $date    = trim((string) ($body['date'] ?? ''));

    // Il contatore deve stare NELL'IMMOBILE che l'inquilino abita. Senza questo
    // controllo, cambiando il numero nel browser si scriverebbe una lettura
    // sul contatore di casa d'altri.
    $chk = $db->prepare(
        'SELECT meter_type FROM meters WHERE id = :m AND property_id = :p AND is_active = 1 LIMIT 1'
    );
    $chk->execute(['m' => $meterId, 'p' => $propertyId]);
    $meterType = $chk->fetchColumn();
    if (!$meterType) actOut(false, 'Contatore non trovato.', 404);

    if ($rawVal === '' || !is_numeric($rawVal)) actOut(false, 'Inserisci un valore numerico.', 400);
    $value = (float) $rawVal;
    if ($value < 0)         actOut(false, 'Il valore non può essere negativo.', 400);
    if ($value > 99999999)  actOut(false, 'Valore fuori scala.', 400);

    // Una lettura nel futuro non esiste: si legge quello che il contatore
    // segna adesso.
    $ts = $date !== '' ? strtotime($date) : time();
    if ($ts === false)   actOut(false, 'Data non valida.', 400);
    if ($ts > time() + 86400) actOut(false, 'La data della lettura non può essere nel futuro.', 400);
    $readingDate = date('Y-m-d', $ts);

    // Resta NON verificata (`verified_at` nullo): e' una dichiarazione finche'
    // l'agenzia non la conferma. Vedi phase98.
    $stmt = $db->prepare(
        "INSERT INTO meter_readings
            (property_id, meter_id, meter_type, reading_value, reading_date, notes,
             source, submitted_by_tenant_id, created_at)
         VALUES (:pid, :mid, :mtype, :val, :rdate, :notes, 'tenant', :tid, NOW())"
    );
    $stmt->execute([
        'pid'   => $propertyId,
        'mid'   => $meterId,
        'mtype' => $meterType,
        'val'   => $value,
        'rdate' => $readingDate,
        'notes' => 'Autolettura dal portale inquilino',
        'tid'   => $tenantId,
    ]);

    actOut(true, ['message' => 'Lettura inviata. L\'agenzia la verificherà.']);
}

// ─────────────────────────────────────────────────────────────────────────────
// Richieste privacy (GDPR)
//
// `data_export_requests` ed `erasure_requests` avevano gia' `subject_type`
// con il valore 'tenant': mancava solo la porta dal lato dell'interessato.
// Qui si REGISTRA la richiesta, non si esegue: l'esecuzione resta all'agenzia,
// che deve poter verificare l'identita' e valutare gli obblighi di legge (una
// cancellazione non puo' portarsi via le scritture contabili obbligatorie).
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'privacy') {
    checkRateLimit('tenant_privacy', 5, 3600);

    $kind = (string) ($body['kind'] ?? '');
    if (!in_array($kind, ['export', 'erasure'], true)) {
        actOut(false, 'Tipo di richiesta non valido.', 400);
    }

    $agencyStmt = $db->prepare('SELECT agency_id FROM tenants WHERE id = :id');
    $agencyStmt->execute(['id' => $tenantId]);
    $agencyId = (int) ($agencyStmt->fetchColumn() ?: 1);

    $table = $kind === 'export' ? 'data_export_requests' : 'erasure_requests';

    // Una richiesta identica gia' in coda non si duplica: chi non vede subito
    // un effetto ripreme il pulsante, ed e' giusto che non produca dieci righe.
    $dup = $db->prepare(
        "SELECT id FROM $table
          WHERE subject_type = 'tenant' AND subject_id = :tid AND status = 'pending'
          LIMIT 1"
    );
    $dup->execute(['tid' => $tenantId]);
    if ($dup->fetchColumn()) {
        actOut(true, ['message' => 'Hai già una richiesta in corso: l\'agenzia la sta gestendo.']);
    }

    if ($kind === 'export') {
        $db->prepare(
            "INSERT INTO data_export_requests (agency_id, subject_type, subject_id, status, created_at)
             VALUES (:aid, 'tenant', :tid, 'pending', NOW())"
        )->execute(['aid' => $agencyId, 'tid' => $tenantId]);
    } else {
        $reason = mb_substr(trim((string) ($body['reason'] ?? '')), 0, 255);
        $db->prepare(
            "INSERT INTO erasure_requests
                (agency_id, subject_type, subject_id, reason, status, method, created_at)
             VALUES (:aid, 'tenant', :tid, :reason, 'pending', 'anonymize', NOW())"
        )->execute([
            'aid'    => $agencyId,
            'tid'    => $tenantId,
            'reason' => $reason !== '' ? $reason : null,
        ]);
    }

    actOut(true, ['message' => 'Richiesta registrata. L\'agenzia ti risponderà entro 30 giorni.']);
}

actOut(false, 'Azione non riconosciuta.', 400);

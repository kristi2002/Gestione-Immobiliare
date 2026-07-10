<?php
/**
 * GDPR admin API (super_admin only — data-protection actions).
 *
 *  GET  ?action=export&subject_type=client|tenant&subject_id=N   — data-subject export (Art. 15/20)
 *  GET  ?action=log&subject_type=&subject_id=                    — data-access audit trail for a subject
 *  GET  ?action=consents&subject_type=&subject_id=               — consent ledger for a subject
 *  GET  ?action=requests                                         — recent export + erasure requests
 *  POST ?action=consent   {subject_type,subject_id,purpose,legal_basis,granted,consent_text}
 *  POST ?action=erase     {subject_type,subject_id,reason,confirm}  — request or perform erasure
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/gdpr.php';

apiHandleOptions();

// Data-protection actions are restricted to super_admin (the DPO role).
requireRole('super_admin');

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');

    if ($method === 'GET' && $action === 'export') {
        exportSubject($db);
    } elseif ($method === 'GET' && $action === 'log') {
        subjectLog($db);
    } elseif ($method === 'GET' && $action === 'consents') {
        subjectConsents($db);
    } elseif ($method === 'GET' && $action === 'requests') {
        listRequests($db);
    } elseif ($method === 'POST' && $action === 'consent') {
        recordConsent($db);
    } elseif ($method === 'POST' && $action === 'erase') {
        eraseSubject($db);
    } else {
        apiError('Azione non valida.', 400);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------

function readSubject(): array
{
    $type = trim($_GET['subject_type'] ?? ($_POST['subject_type'] ?? ''));
    $id   = (int) ($_GET['subject_id'] ?? ($_POST['subject_id'] ?? 0));
    if (!in_array($type, ['client', 'tenant'], true) || $id <= 0) {
        apiError('subject_type (client|tenant) e subject_id obbligatori.');
    }
    return [$type, $id];
}

function exportSubject(PDO $db): void
{
    [$type, $id] = readSubject();
    $data = gdprExportSubject($db, $type, $id);
    if (!$data) {
        apiError('Soggetto non trovato.', 404);
    }

    // Record the request and the access.
    $db->prepare(
        "INSERT INTO data_export_requests (subject_type, subject_id, requested_by, status, completed_at)
         VALUES (:t, :id, :by, 'completed', NOW())"
    )->execute(['t' => $type, 'id' => $id, 'by' => getCurrentAdminId() ?: null]);

    logDataAccessAdmin('export', $type, $id, $type, $id, 'Data-subject export');

    apiSuccess($data);
}

function subjectLog(PDO $db): void
{
    [$type, $id] = readSubject();
    $stmt = $db->prepare(
        "SELECT id, actor_type, actor_label, action, entity_type, entity_id, detail, ip_address, created_at
           FROM data_processing_log
          WHERE subject_type = :t AND subject_id = :id
          ORDER BY created_at DESC
          LIMIT 500"
    );
    $stmt->execute(['t' => $type, 'id' => $id]);
    apiSuccess($stmt->fetchAll());
}

function subjectConsents(PDO $db): void
{
    [$type, $id] = readSubject();
    $stmt = $db->prepare(
        "SELECT * FROM consent_records
          WHERE subject_type = :t AND subject_id = :id
          ORDER BY created_at DESC"
    );
    $stmt->execute(['t' => $type, 'id' => $id]);
    apiSuccess($stmt->fetchAll());
}

function listRequests(PDO $db): void
{
    $exports = $db->query(
        "SELECT 'export' AS kind, id, subject_type, subject_id, status, created_at, completed_at AS resolved_at
           FROM data_export_requests ORDER BY created_at DESC LIMIT 100"
    )->fetchAll();
    $erasures = $db->query(
        "SELECT 'erasure' AS kind, id, subject_type, subject_id, status, created_at, processed_at AS resolved_at
           FROM erasure_requests ORDER BY created_at DESC LIMIT 100"
    )->fetchAll();
    apiSuccess(['exports' => $exports, 'erasures' => $erasures]);
}

function recordConsent(PDO $db): void
{
    $data = apiGetJsonBody();
    $type = trim($data['subject_type'] ?? '');
    $id   = (int) ($data['subject_id'] ?? 0);
    if (!in_array($type, ['client', 'tenant'], true) || $id <= 0) {
        apiError('subject_type e subject_id obbligatori.');
    }
    $purpose = trim($data['purpose'] ?? '');
    if ($purpose === '') {
        apiError('purpose obbligatorio.');
    }
    $legalBasis = trim($data['legal_basis'] ?? 'consent');
    $granted    = !empty($data['granted']) ? 1 : 0;

    $ip = $_SERVER['REMOTE_ADDR'] ?? null;
    $db->prepare(
        "INSERT INTO consent_records
            (subject_type, subject_id, purpose, legal_basis, granted, consent_text, source, ip_address)
         VALUES (:t, :id, :purpose, :basis, :granted, :text, 'admin_form', :ip)"
    )->execute([
        't'       => $type,
        'id'      => $id,
        'purpose' => $purpose,
        'basis'   => in_array($legalBasis, ['consent','contract','legal_obligation','legitimate_interest','vital_interest','public_task'], true) ? $legalBasis : 'consent',
        'granted' => $granted,
        'text'    => trim($data['consent_text'] ?? '') ?: null,
        'ip'      => $ip,
    ]);

    // Mirror the primary consent onto the subject row for quick display.
    if ($purpose === 'privacy' || $purpose === 'marketing') {
        $col   = $purpose === 'privacy' ? 'privacy_consent_at' : 'marketing_consent_at';
        $table = $type === 'client' ? 'clients' : 'tenants';
        $val   = $granted ? 'NOW()' : 'NULL';
        $db->prepare("UPDATE {$table} SET {$col} = {$val} WHERE id = :id")->execute(['id' => $id]);
    }

    logDataAccessAdmin('update', $type, $id, 'consent', null, "Consenso '{$purpose}' = " . ($granted ? 'sì' : 'no'));
    apiSuccess(['message' => 'Consenso registrato.']);
}

function eraseSubject(PDO $db): void
{
    $data    = apiGetJsonBody();
    $type    = trim($data['subject_type'] ?? '');
    $id      = (int) ($data['subject_id'] ?? 0);
    $confirm = !empty($data['confirm']);
    $reason  = trim($data['reason'] ?? '') ?: null;

    if (!in_array($type, ['client', 'tenant'], true) || $id <= 0) {
        apiError('subject_type e subject_id obbligatori.');
    }

    $table = $type === 'client' ? 'clients' : 'tenants';
    $chk = $db->prepare("SELECT id FROM {$table} WHERE id = :id");
    $chk->execute(['id' => $id]);
    if (!$chk->fetch()) {
        apiError('Soggetto non trovato.', 404);
    }

    if (!$confirm) {
        // Record a pending erasure request for review.
        $db->prepare(
            "INSERT INTO erasure_requests (subject_type, subject_id, requested_by, reason, status, method)
             VALUES (:t, :id, :by, :reason, 'pending', 'anonymize')"
        )->execute(['t' => $type, 'id' => $id, 'by' => getCurrentAdminId() ?: null, 'reason' => $reason]);
        logDataAccessAdmin('update', $type, $id, 'erasure_request', null, 'Richiesta di cancellazione registrata');
        apiSuccess(['message' => 'Richiesta di cancellazione registrata (in attesa di conferma).', 'pending' => true]);
        return;
    }

    // Confirmed — anonymise now, inside a transaction.
    $db->beginTransaction();
    try {
        gdprAnonymizeSubject($db, $type, $id);
        $db->prepare(
            "INSERT INTO erasure_requests (subject_type, subject_id, requested_by, reason, status, method, processed_at, processed_by)
             VALUES (:t, :id, :by, :reason, 'completed', 'anonymize', NOW(), :by2)"
        )->execute([
            't' => $type, 'id' => $id, 'by' => getCurrentAdminId() ?: null,
            'reason' => $reason, 'by2' => getCurrentAdminId() ?: null,
        ]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }

    logDataAccessAdmin('anonymize', $type, $id, $type, $id, 'Soggetto anonimizzato (diritto all\'oblio)');
    apiSuccess(['message' => 'Soggetto anonimizzato con successo.', 'anonymized' => true]);
}

<?php
/**
 * GDPR helpers — data-access audit logging, data-subject export, and
 * anonymisation (right to erasure). Used by api/gdpr.php, the document download
 * endpoints, and cron/gdpr_retention.php.
 */

require_once __DIR__ . '/db.php';

/**
 * Append a row to the data-access / processing audit log. Best-effort: never
 * throw into the caller's flow (auditing must not break a download/export).
 */
function logDataAccess(
    string  $action,
    ?string $subjectType = null,
    ?int    $subjectId   = null,
    string  $actorType   = 'admin',
    ?int    $actorId     = null,
    ?string $actorLabel  = null,
    ?string $entityType  = null,
    ?int    $entityId    = null,
    ?string $detail      = null
): void {
    try {
        $ip = $_SERVER['HTTP_CF_CONNECTING_IP']
            ?? ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['REMOTE_ADDR'] ?? null));
        if ($ip !== null && str_contains($ip, ',')) {
            $ip = trim(explode(',', $ip)[0]);
        }

        getDB()->prepare(
            "INSERT INTO data_processing_log
                (agency_id, actor_type, actor_id, actor_label, action,
                 subject_type, subject_id, entity_type, entity_id, detail, ip_address)
             VALUES
                (:agency, :atype, :aid, :alabel, :action,
                 :stype, :sid, :etype, :eid, :detail, :ip)"
        )->execute([
            'agency'  => function_exists('currentAgencyId') ? currentAgencyId() : 1,
            'atype'   => $actorType,
            'aid'     => $actorId,
            'alabel'  => $actorLabel,
            'action'  => $action,
            'stype'   => $subjectType,
            'sid'     => $subjectId,
            'etype'   => $entityType,
            'eid'     => $entityId,
            'detail'  => $detail !== null ? mb_substr($detail, 0, 255) : null,
            'ip'      => $ip,
        ]);
    } catch (Throwable $e) {
        // Auditing is best-effort; never break the caller, but log the failure.
        error_log('[gdpr audit] failed to write data_processing_log: ' . $e->getMessage());
    }
}

/** Convenience: log an action performed by the logged-in admin. */
function logDataAccessAdmin(
    string  $action,
    ?string $subjectType = null,
    ?int    $subjectId   = null,
    ?string $entityType  = null,
    ?int    $entityId    = null,
    ?string $detail      = null
): void {
    $aid   = function_exists('getCurrentAdminId') ? ((int) getCurrentAdminId() ?: null) : null;
    $label = function_exists('getCurrentUsername') ? getCurrentUsername() : null;
    logDataAccess($action, $subjectType, $subjectId, 'admin', $aid, $label, $entityType, $entityId, $detail);
}

/** PII columns per data-subject type (used by export + anonymise). */
function gdprPiiColumns(string $subjectType): array
{
    return $subjectType === 'client'
        ? ['name', 'surname', 'codice_fiscale', 'phone', 'email', 'internal_notes', 'portal_email']
        : ['name', 'surname', 'email', 'phone', 'notes'];
}

/**
 * Build a full data-subject export (Art. 15 / 20). Returns a structured array of
 * the subject's own record plus every related record that references them.
 */
function gdprExportSubject(PDO $db, string $subjectType, int $subjectId): array
{
    $table = $subjectType === 'client' ? 'clients' : 'tenants';

    $stmt = $db->prepare("SELECT * FROM {$table} WHERE id = :id");
    $stmt->execute(['id' => $subjectId]);
    $subject = $stmt->fetch();
    if (!$subject) {
        return [];
    }
    unset($subject['portal_password_hash']); // never export secrets

    $export = [
        'exported_at'  => date('c'),
        'subject_type' => $subjectType,
        'subject'      => $subject,
        'related'      => [],
    ];

    $related = $subjectType === 'client'
        ? [
            'properties'     => ['SELECT * FROM properties WHERE client_id = :id', 'id'],
            'contracts'      => ['SELECT * FROM contracts WHERE client_id = :id', 'id'],
            'documents'      => ['SELECT id, doc_type, original_name, created_at FROM documents WHERE client_id = :id', 'id'],
            'communications' => ['SELECT * FROM communications WHERE client_id = :id', 'id'],
            'invoices'       => ['SELECT * FROM invoices WHERE client_id = :id', 'id'],
            'consent'        => ["SELECT * FROM consent_records WHERE subject_type='client' AND subject_id = :id", 'id'],
        ]
        : [
            'contracts'      => ['SELECT * FROM contracts WHERE tenant_id = :id', 'id'],
            'payments'       => ['SELECT * FROM payments WHERE tenant_id = :id', 'id'],
            'documents'      => ['SELECT DISTINCT d.id, d.doc_type, d.original_name, d.created_at
                                    FROM documents d
                                    JOIN contracts ct ON ct.property_id = d.property_id
                                   WHERE ct.tenant_id = :id', 'id'],
            'consent'        => ["SELECT * FROM consent_records WHERE subject_type='tenant' AND subject_id = :id", 'id'],
        ];

    foreach ($related as $key => [$sql, $_]) {
        try {
            $s = $db->prepare($sql);
            $s->execute(['id' => $subjectId]);
            $export['related'][$key] = $s->fetchAll();
        } catch (Throwable) {
            $export['related'][$key] = [];
        }
    }

    return $export;
}

/**
 * Anonymise a data subject in place (right to erasure). PII columns are
 * overwritten with non-identifying placeholders and portal access is revoked;
 * the row itself is retained so financial/contractual history stays consistent.
 * Returns true on success.
 */
function gdprAnonymizeSubject(PDO $db, string $subjectType, int $subjectId): bool
{
    $table = $subjectType === 'client' ? 'clients' : 'tenants';
    $token = 'ANON-' . strtoupper(substr(hash('sha256', $subjectType . $subjectId . microtime()), 0, 10));

    $sets = [
        'name'    => 'Anonimizzato',
        'surname' => $token,
        'email'   => null,
        'phone'   => null,
    ];
    if ($subjectType === 'client') {
        $sets['codice_fiscale'] = null;
        $sets['internal_notes'] = null;
        $sets['portal_email']   = null;
    } else {
        $sets['notes'] = null;
    }

    $assignments = [];
    foreach ($sets as $col => $_) {
        $assignments[] = "{$col} = :{$col}";
    }
    $assignments[] = 'anonymized_at = NOW()';
    if ($subjectType === 'client') {
        $assignments[] = 'portal_password_hash = NULL';
    }

    $sql = "UPDATE {$table} SET " . implode(', ', $assignments) . ' WHERE id = :id';
    $params = $sets;
    $params['id'] = $subjectId;

    $db->prepare($sql)->execute($params);

    // Withdraw any standing consents.
    $db->prepare(
        "UPDATE consent_records SET granted = 0, withdrawn_at = NOW()
          WHERE subject_type = :t AND subject_id = :id AND withdrawn_at IS NULL"
    )->execute(['t' => $subjectType, 'id' => $subjectId]);

    return true;
}

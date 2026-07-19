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
 *
 * Each related entry is [sql, params]. Most link by the subject's numeric id,
 * but records with no FK to the subject (leads, e-sign requests) are matched by
 * the subject's own email / codice fiscale — so they're still surfaced. Every
 * query is best-effort: a table absent on this schema version (e.g. aml_records
 * pre-phase37) yields [] rather than breaking the whole export.
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

    // The subject's own identifiers, for tables that aren't FK-linked.
    $email = trim((string) ($subject['email'] ?? '')) ?: null;
    $cf    = trim((string) ($subject['codice_fiscale'] ?? '')) ?: null;

    $export = [
        'exported_at'  => date('c'),
        'subject_type' => $subjectType,
        'subject'      => $subject,
        'related'      => [],
    ];

    $byId = ['id' => $subjectId];

    if ($subjectType === 'client') {
        $related = [
            'properties'          => ['SELECT * FROM properties WHERE client_id = :id', $byId],
            'contracts'           => ['SELECT * FROM contracts WHERE client_id = :id', $byId],
            'documents'           => ['SELECT id, doc_type, original_name, created_at FROM documents WHERE client_id = :id', $byId],
            'communications'      => ['SELECT * FROM communications WHERE client_id = :id', $byId],
            'whatsapp_messages'   => ['SELECT * FROM whatsapp_messages WHERE client_id = :id', $byId],
            'invoices'            => ['SELECT * FROM invoices WHERE client_id = :id', $byId],
            'expenses'            => ['SELECT * FROM expenses WHERE client_id = :id', $byId],
            'appointments'        => ['SELECT * FROM appointments WHERE client_id = :id', $byId],
            'aml_records'         => ['SELECT id, subject_name, codice_fiscale, verification_type, verification_date, retention_until, status FROM aml_records WHERE client_id = :id', $byId],
            'payment_reminders'   => ['SELECT * FROM payment_reminder_log WHERE client_id = :id', $byId],
            'consent'             => ["SELECT * FROM consent_records WHERE subject_type='client' AND subject_id = :id", $byId],
        ];
    } else {
        $related = [
            'contracts'           => ['SELECT * FROM contracts WHERE tenant_id = :id', $byId],
            'payments'            => ['SELECT * FROM payments WHERE tenant_id = :id', $byId],
            'documents'           => ['SELECT DISTINCT d.id, d.doc_type, d.original_name, d.created_at
                                         FROM documents d
                                         JOIN contracts ct ON ct.property_id = d.property_id
                                        WHERE ct.tenant_id = :id', $byId],
            'whatsapp_messages'   => ['SELECT * FROM whatsapp_messages WHERE tenant_id = :id', $byId],
            'payment_reminders'   => ['SELECT * FROM payment_reminder_log WHERE tenant_id = :id', $byId],
            'consent'             => ["SELECT * FROM consent_records WHERE subject_type='tenant' AND subject_id = :id", $byId],
        ];
    }

    // Not-FK-linked records, matched on the subject's own identifiers.
    if ($email !== null) {
        $related['esign_requests'] = ['SELECT id, document_id, contract_id, signer_name, signer_email, status, signed_at, created_at FROM esign_requests WHERE signer_email = :email', ['email' => $email]];
    }
    if ($email !== null || $cf !== null) {
        // A person may also exist as a lead (pre-conversion). Match on either
        // identifier; an unset one contributes nothing (its *_set flag is 0).
        $related['leads'] = [
            'SELECT * FROM leads WHERE (:email_set = 1 AND email = :email) OR (:cf_set = 1 AND codice_fiscale = :cf)',
            ['email_set' => $email !== null ? 1 : 0, 'email' => $email ?? '', 'cf_set' => $cf !== null ? 1 : 0, 'cf' => $cf ?? ''],
        ];
    }

    foreach ($related as $key => [$sql, $params]) {
        try {
            $s = $db->prepare($sql);
            $s->execute($params);
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

    // `tenants.email` is NOT NULL (and email columns may be UNIQUE), so we cannot
    // null the address — overwrite it with a per-subject placeholder on an
    // invalid TLD. It carries no PII and can never route real mail.
    $anonEmail = strtolower($token) . '@anonimizzato.invalid';

    $sets = [
        'name'    => 'Anonimizzato',
        'surname' => $token,
        'email'   => $anonEmail,
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

    // Read the subject's email BEFORE overwriting it — needed to reach records
    // that link by email rather than by FK (e-sign requests).
    $pre = $db->prepare("SELECT email FROM {$table} WHERE id = :id");
    $pre->execute(['id' => $subjectId]);
    $subjectEmail = trim((string) ($pre->fetchColumn() ?: '')) ?: null;

    $sql = "UPDATE {$table} SET " . implode(', ', $assignments) . ' WHERE id = :id';
    $params = $sets;
    $params['id'] = $subjectId;

    $db->prepare($sql)->execute($params);

    // Withdraw any standing consents.
    $db->prepare(
        "UPDATE consent_records SET granted = 0, withdrawn_at = NOW()
          WHERE subject_type = :t AND subject_id = :id AND withdrawn_at IS NULL"
    )->execute(['t' => $subjectType, 'id' => $subjectId]);

    // -----------------------------------------------------------------------
    // Scrub free-text PII in RELATED records. Anonymising only the subject row
    // leaves names/emails/phone numbers/message bodies scattered across linked
    // tables — a real erasure has to clear those too.
    //
    // These are best-effort inside the caller's transaction: a table absent on
    // this schema version (e.g. whatsapp_messages) must not abort the erasure.
    // A MySQL "table doesn't exist" (1146) does NOT poison an open transaction,
    // so we catch-and-continue. What is DELIBERATELY left intact — because law
    // requires retaining it, and GDPR erasure yields to a legal-obligation
    // basis (Art. 17(3)(b)): aml_records (10-yr antiriciclaggio retention),
    // documents/contracts/invoices/payments/expenses (fiscal retention). The
    // subject's directly-identifying fields are already gone from those via the
    // client/tenant row; the financial/legal records keep only amounts + dates.
    // -----------------------------------------------------------------------
    $scrub = static function (PDO $db, string $sql, array $params): void {
        try {
            $db->prepare($sql)->execute($params);
        } catch (Throwable $e) {
            error_log('[gdpr anonymize] related scrub skipped: ' . $e->getMessage());
        }
    };

    if ($subjectType === 'client') {
        $scrub($db,
            "UPDATE communications
                SET from_email = NULL, to_email = NULL,
                    subject = '[anonimizzato]', body = '[anonimizzato]'
              WHERE client_id = :id", ['id' => $subjectId]);
        $scrub($db,
            "UPDATE whatsapp_messages
                SET from_number = '[anon]', to_number = '[anon]',
                    body = '[anonimizzato]', media_url = NULL
              WHERE client_id = :id", ['id' => $subjectId]);
        $scrub($db,
            "UPDATE appointments SET notes = NULL WHERE client_id = :id", ['id' => $subjectId]);
    } else { // tenant
        $scrub($db,
            "UPDATE whatsapp_messages
                SET from_number = '[anon]', to_number = '[anon]',
                    body = '[anonimizzato]', media_url = NULL
              WHERE tenant_id = :id", ['id' => $subjectId]);
        // Revoke the portal login without deleting the row (keeps FK history).
        $scrub($db,
            "UPDATE tenant_users SET password_hash = '', last_login_at = NULL
              WHERE tenant_id = :id", ['id' => $subjectId]);
    }

    // E-sign requests link by signer_email, not by FK. signer_email is NOT NULL,
    // so overwrite it with a non-identifying placeholder rather than NULL.
    if ($subjectEmail !== null) {
        $scrub($db,
            "UPDATE esign_requests
                SET signer_name = 'Anonimizzato', signer_email = 'anonimizzato@invalid', ip_address = NULL
              WHERE signer_email = :email", ['email' => $subjectEmail]);
    }

    return true;
}

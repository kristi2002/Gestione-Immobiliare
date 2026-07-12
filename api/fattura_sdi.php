<?php
/**
 * FatturaPA / SdI transmission lifecycle.
 *
 * GET  /api/fattura_sdi.php?action=list                      — all transmissions (dashboard)
 * GET  /api/fattura_sdi.php?invoice_id={id}                  — status for one invoice
 * GET  /api/fattura_sdi.php?action=download&id={ft_id}       — download the persisted XML
 * POST /api/fattura_sdi.php?action=generate                  {invoice_id}     — build+persist XML, state=generato
 * POST /api/fattura_sdi.php?action=transmit                  {invoice_id}     — send via configured intermediary
 * POST /api/fattura_sdi.php?action=record_receipt            {id, receipt_type, sdi_identificativo?, message?, ne_outcome?}
 *
 * Admin+ only. See lib/sdi_sender.php for the pluggable intermediary.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../lib/FatturaPA.php';
require_once __DIR__ . '/../lib/sdi_sender.php';
require_once __DIR__ . '/../config/upload_guard.php';

apiHandleOptions();

if (!in_array(getCurrentRole(), ['admin', 'super_admin'], true)) {
    apiError('Permesso negato.', 403);
}

const FT_RECEIPT_MAP = [
    'RC' => 'consegnato',            // Ricevuta di consegna
    'MC' => 'messa_a_disposizione',  // Mancata consegna
    'NS' => 'scartato',              // Notifica di scarto
    'DT' => 'accettato',             // Decorrenza termini (deemed accepted)
    'AT' => 'messa_a_disposizione',  // Attestazione trasmissione con impossibilità recapito
    'NE' => null,                    // Notifica esito — outcome supplied separately
];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');

    if ($method === 'GET') {
        if ($action === 'list') {
            listTransmissions($db);
        } elseif ($action === 'download') {
            downloadXml($db, (int) ($_GET['id'] ?? 0));
        } else {
            statusForInvoice($db, (int) ($_GET['invoice_id'] ?? 0));
        }
    } elseif ($method === 'POST') {
        $data = apiGetJsonBody();
        switch ($action) {
            case 'generate':       generateFattura($db, (int) ($data['invoice_id'] ?? 0)); break;
            case 'transmit':       transmitFattura($db, (int) ($data['invoice_id'] ?? 0)); break;
            case 'record_receipt': recordReceipt($db, $data); break;
            default: apiError('Azione non valida.');
        }
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------

function loadInvoice(PDO $db, int $invoiceId): array
{
    if ($invoiceId <= 0) apiError('invoice_id mancante.');
    $stmt = $db->prepare(
        "SELECT i.*, c.name AS client_name, c.surname AS client_surname, c.codice_fiscale AS client_cf,
                l.name AS lead_name, l.surname AS lead_surname, l.codice_fiscale AS lead_cf
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN leads l ON l.id = i.lead_id
         WHERE i.id = :id"
    );
    $stmt->execute(['id' => $invoiceId]);
    $inv = $stmt->fetch();
    if (!$inv) apiError('Fattura non trovata.', 404);
    return $inv;
}

function agencyFromSettings(): array
{
    return [
        'piva'           => getSetting('agency_piva', ''),
        'cf'             => getSetting('agency_cf', ''),
        'denominazione'  => getSetting('agency_denominazione', '') ?: getSetting('agency_name', ''),
        'regime_fiscale' => getSetting('agency_regime_fiscale', 'RF01'),
        'indirizzo'      => getSetting('agency_indirizzo', '') ?: getSetting('agency_address', ''),
        'cap'            => getSetting('agency_cap', ''),
        'comune'         => getSetting('agency_comune', ''),
        'provincia'      => getSetting('agency_provincia', ''),
        'pec'            => getSetting('agency_pec', ''),
    ];
}

function customerFromInvoice(array $inv): array
{
    if (!empty($inv['client_id'])) {
        return ['nome' => $inv['client_name'] ?? '', 'cognome' => $inv['client_surname'] ?? '', 'cf' => $inv['client_cf'] ?? ''];
    }
    return ['nome' => $inv['lead_name'] ?? '', 'cognome' => $inv['lead_surname'] ?? '', 'cf' => $inv['lead_cf'] ?? ''];
}

function getTransmission(PDO $db, int $invoiceId): ?array
{
    $stmt = $db->prepare('SELECT * FROM fattura_transmissions WHERE invoice_id = :id');
    $stmt->execute(['id' => $invoiceId]);
    return $stmt->fetch() ?: null;
}

function generateFattura(PDO $db, int $invoiceId): void
{
    $inv     = loadInvoice($db, $invoiceId);
    $agency  = agencyFromSettings();
    $missing = fatturaPaMissingAgencyFields($agency);
    if (!empty($missing)) {
        apiError('Completa i dati agenzia in Impostazioni → Fatturazione: ' . implode(', ', $missing));
    }

    $progressivo = (int) $invoiceId;
    $xml = fatturaPaBuildXml($inv, $agency, customerFromInvoice($inv), $progressivo);

    $sender   = preg_replace('/\D/', '', (string) ($agency['piva'] ?: $agency['cf'] ?: '00000000000'));
    $filename = 'IT' . ($sender ?: '00000000000') . '_' . str_pad((string) $progressivo, 5, '0', STR_PAD_LEFT) . '.xml';

    // Persist into the protected uploads tree (never public).
    $dir = dirname(__DIR__) . '/uploads/documents/fatture';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        apiError('Cartella uploads/documents/fatture non scrivibile.', 500);
    }
    $relPath = 'uploads/documents/fatture/' . $filename;
    if (file_put_contents(dirname(__DIR__) . '/' . $relPath, $xml) === false) {
        apiError('Impossibile salvare il file XML.', 500);
    }

    // A scartato invoice can be regenerated; only block once it's been accepted/delivered.
    $existing = getTransmission($db, $invoiceId);
    if ($existing && in_array($existing['status'], ['consegnato', 'accettato', 'messa_a_disposizione'], true)) {
        apiError('La fattura risulta già trasmessa e accettata dallo SdI; non rigenerare.');
    }

    $stmt = $db->prepare(
        "INSERT INTO fattura_transmissions (invoice_id, status, progressivo, xml_filename, xml_path, created_by)
         VALUES (:invoice_id, 'generato', :progressivo, :xml_filename, :xml_path, :created_by)
         ON DUPLICATE KEY UPDATE
            status = 'generato', progressivo = VALUES(progressivo),
            xml_filename = VALUES(xml_filename), xml_path = VALUES(xml_path),
            receipt_type = NULL, receipt_message = NULL, sent_at = NULL, delivered_at = NULL"
    );
    $stmt->execute([
        'invoice_id'   => $invoiceId,
        'progressivo'  => (string) $progressivo,
        'xml_filename' => $filename,
        'xml_path'     => $relPath,
        'created_by'   => getCurrentAdminId() ?: null,
    ]);

    logActivity('create', 'fattura_sdi', $invoiceId, 'XML FatturaPA generato per fattura #' . $invoiceId);
    statusForInvoice($db, $invoiceId);
}

function transmitFattura(PDO $db, int $invoiceId): void
{
    $ft = getTransmission($db, $invoiceId);
    if (!$ft) apiError('Genera prima il file XML.');
    if (in_array($ft['status'], ['consegnato', 'accettato', 'messa_a_disposizione'], true)) {
        apiError('Fattura già trasmessa e accettata dallo SdI.');
    }

    $abs = $ft['xml_path'] ? safeUploadRealPath($ft['xml_path']) : null;
    if ($abs === null) apiError('File XML non disponibile: rigeneralo.');
    $xml = file_get_contents($abs);

    $result = sdiTransmit((string) $xml, (string) $ft['xml_filename']);

    if (empty($result['ok'])) {
        $db->prepare(
            "UPDATE fattura_transmissions SET status = 'errore_invio', channel = :ch, receipt_message = :msg WHERE invoice_id = :id"
        )->execute(['ch' => $result['channel'] ?? null, 'msg' => $result['message'] ?? null, 'id' => $invoiceId]);
        apiError($result['message'] ?? 'Invio non riuscito.', 502);
    }

    // Manual channel: the XML is ready but not auto-sent. Keep an explicit state.
    $newStatus = !empty($result['manual']) ? 'generato' : 'trasmesso';
    $db->prepare(
        "UPDATE fattura_transmissions
         SET status = :status, channel = :channel, sdi_identificativo = COALESCE(:sdi, sdi_identificativo),
             sent_at = CASE WHEN :is_manual = 0 THEN NOW() ELSE sent_at END,
             receipt_message = :msg
         WHERE invoice_id = :id"
    )->execute([
        'status'    => $newStatus,
        'channel'   => $result['channel'] ?? null,
        'sdi'       => $result['sdi_identificativo'] ?? null,
        'is_manual' => !empty($result['manual']) ? 1 : 0,
        'msg'       => $result['message'] ?? null,
        'id'        => $invoiceId,
    ]);

    // Mark the invoice as 'sent' once it's actually gone to the SdI.
    if (empty($result['manual'])) {
        $db->prepare("UPDATE invoices SET status = 'sent' WHERE id = :id AND status = 'draft'")->execute(['id' => $invoiceId]);
    }

    logActivity('update', 'fattura_sdi', $invoiceId, 'FatturaPA ' . ($result['manual'] ? 'pronta (canale manuale)' : 'trasmessa'));
    statusForInvoice($db, $invoiceId);
}

function recordReceipt(PDO $db, array $data): void
{
    $invoiceId = (int) ($data['invoice_id'] ?? 0);
    $ft = $invoiceId > 0 ? getTransmission($db, $invoiceId) : null;
    if (!$ft) apiError('Trasmissione non trovata.', 404);

    $type = strtoupper(trim($data['receipt_type'] ?? ''));
    if (!array_key_exists($type, FT_RECEIPT_MAP)) {
        apiError('Tipo ricevuta non valido (RC, MC, NS, NE, DT, AT).');
    }

    $status = FT_RECEIPT_MAP[$type];
    if ($type === 'NE') {
        $outcome = strtolower(trim($data['ne_outcome'] ?? ''));
        $status  = $outcome === 'rifiutato' ? 'rifiutato' : 'accettato';
    }

    $delivered = in_array($status, ['consegnato', 'accettato'], true);
    $db->prepare(
        "UPDATE fattura_transmissions
         SET status = :status, receipt_type = :rt,
             sdi_identificativo = COALESCE(:sdi, sdi_identificativo),
             receipt_message = :msg,
             delivered_at = CASE WHEN :delivered = 1 THEN NOW() ELSE delivered_at END
         WHERE invoice_id = :id"
    )->execute([
        'status'    => $status,
        'rt'        => $type,
        'sdi'       => trim($data['sdi_identificativo'] ?? '') ?: null,
        'msg'       => trim($data['message'] ?? '') ?: null,
        'delivered' => $delivered ? 1 : 0,
        'id'        => $invoiceId,
    ]);

    logActivity('update', 'fattura_sdi', $invoiceId, 'Ricevuta SdI ' . $type . ' registrata (' . $status . ')');
    statusForInvoice($db, $invoiceId);
}

function statusForInvoice(PDO $db, int $invoiceId): void
{
    if ($invoiceId <= 0) apiError('invoice_id mancante.');
    $ft = getTransmission($db, $invoiceId);
    apiSuccess([
        'invoice_id'  => $invoiceId,
        'exists'      => $ft !== null,
        'automatic'   => sdiIsAutomatic(),
        'provider'    => sdiProvider(),
        'transmission'=> $ft,
    ]);
}

function listTransmissions(PDO $db): void
{
    $pagination = apiGetPagination();
    $status     = trim($_GET['status'] ?? '');
    $where  = 'WHERE 1=1';
    $params = [];
    if ($status !== '') { $where .= ' AND ft.status = :status'; $params['status'] = $status; }

    $countSql = "SELECT COUNT(*) FROM fattura_transmissions ft $where";
    $dataSql  = "SELECT ft.*, i.invoice_number, i.total,
                    TRIM(CONCAT(COALESCE(c.name,''),' ',COALESCE(c.surname,''))) AS client_name
                 FROM fattura_transmissions ft
                 JOIN invoices i ON i.id = ft.invoice_id
                 LEFT JOIN clients c ON c.id = i.client_id
                 $where ORDER BY ft.updated_at DESC";
    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);

    $pages = $total > 0 ? (int) ceil($total / $pagination['limit']) : 0;
    apiSuccess(['items' => $items, 'total' => $total, 'page' => $pagination['page'], 'limit' => $pagination['limit'], 'pages' => $pages]);
}

function downloadXml(PDO $db, int $ftId): void
{
    if ($ftId <= 0) apiError('ID mancante.');
    $stmt = $db->prepare('SELECT xml_path, xml_filename FROM fattura_transmissions WHERE id = :id');
    $stmt->execute(['id' => $ftId]);
    $row = $stmt->fetch();
    if (!$row) apiError('Trasmissione non trovata.', 404);

    $abs = $row['xml_path'] ? safeUploadRealPath($row['xml_path']) : null;
    if ($abs === null) apiError('File XML non disponibile.', 404);

    apiDiscardBufferedOutput();
    header('Content-Type: application/xml; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . ($row['xml_filename'] ?: 'fattura.xml') . '"');
    header('X-Content-Type-Options: nosniff');
    readfile($abs);
    exit;
}

<?php
/**
 * Owner fiscal-year statement (Prospetto fiscale locazioni — supporto 730/Redditi).
 *
 * POST /api/owner_fiscal_statement.php  { client_id, year }
 *
 * For each property of the owner, reports the RENT ACTUALLY RECEIVED in the
 * fiscal year (payments with status = paid) plus the tax regime (cedolare secca
 * vs ordinario) and the cadastral identifiers — the data an owner's accountant
 * needs for the annual return. Not tax advice; the commercialista confirms.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/pdf.php';

apiHandleOptions();
requireWriteAccess();

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        apiError('Metodo non consentito.', 405);
    }

    $data     = apiGetJsonBody();
    $clientId = (int) ($data['client_id'] ?? 0);
    $year     = (int) ($data['year'] ?? date('Y'));
    if ($clientId <= 0) apiError('client_id obbligatorio.');
    if ($year < 2000 || $year > 2100) apiError('Anno non valido.');

    $db = getDB();
    $stmt = $db->prepare('SELECT * FROM clients WHERE id = :id');
    $stmt->execute(['id' => $clientId]);
    $client = $stmt->fetch();
    if (!$client) apiError('Proprietario non trovato.', 404);

    $start = sprintf('%04d-01-01', $year);
    $end   = sprintf('%04d-12-31', $year);

    // Properties of the owner with their cadastral data.
    $propStmt = $db->prepare(
        "SELECT id, address, city, cadastral_comune, cadastral_foglio, cadastral_particella,
                cadastral_subalterno, cadastral_category, cadastral_rendita
         FROM properties WHERE client_id = :cid ORDER BY city, address"
    );
    $propStmt->execute(['cid' => $clientId]);
    $properties = $propStmt->fetchAll();

    $totalReceived = 0.0;
    $totalCedolare = 0.0;
    $totalOrdinario = 0.0;
    $blocks = [
        ['type' => 'h2', 'text' => 'Proprietario'],
        ['type' => 'kv', 'pairs' => [
            ['Nominativo',      trim($client['name'] . ' ' . $client['surname'])],
            ['Codice fiscale',  $client['codice_fiscale'] ?: '—'],
            ['Anno d\'imposta', (string) $year],
        ]],
    ];

    $anyRent = false;
    foreach ($properties as $p) {
        // Rent received (paid) in the fiscal year for this property.
        $rStmt = $db->prepare(
            "SELECT COALESCE(SUM(amount), 0) AS received, COUNT(*) AS n
             FROM payments
             WHERE property_id = :pid AND status = 'paid'
               AND COALESCE(paid_date, due_date) BETWEEN :start AND :end"
        );
        $rStmt->execute(['pid' => $p['id'], 'start' => $start, 'end' => $end]);
        $rec = $rStmt->fetch();
        $received = (float) $rec['received'];

        if ($received <= 0) continue;
        $anyRent = true;

        // Regime from the property's most recent locazione contract.
        $cStmt = $db->prepare(
            "SELECT cedolare_secca, contract_subtype, registration_number
             FROM contracts
             WHERE property_id = :pid AND contract_type = 'locazione'
             ORDER BY start_date DESC, id DESC LIMIT 1"
        );
        $cStmt->execute(['pid' => $p['id']]);
        $contract = $cStmt->fetch();
        $cedolare = $contract && (int) $contract['cedolare_secca'] === 1;

        $totalReceived += $received;
        if ($cedolare) $totalCedolare += $received; else $totalOrdinario += $received;

        $catasto = array_filter([
            $p['cadastral_comune'] ? 'Comune ' . $p['cadastral_comune'] : null,
            $p['cadastral_foglio'] ? 'Fg. ' . $p['cadastral_foglio'] : null,
            $p['cadastral_particella'] ? 'Part. ' . $p['cadastral_particella'] : null,
            $p['cadastral_subalterno'] ? 'Sub. ' . $p['cadastral_subalterno'] : null,
            $p['cadastral_category'] ? 'Cat. ' . $p['cadastral_category'] : null,
        ]);

        $blocks[] = ['type' => 'h2', 'text' => $p['address'] . ', ' . $p['city']];
        $blocks[] = ['type' => 'kv', 'pairs' => [
            ['Dati catastali',    $catasto ? implode(' · ', $catasto) : '—'],
            ['Rendita catastale', $p['cadastral_rendita'] !== null ? '€ ' . number_format((float) $p['cadastral_rendita'], 2, ',', '.') : '—'],
            ['Regime fiscale',    $cedolare ? 'Cedolare secca' : 'Ordinario (IRPEF)'],
            ['Estremi registrazione', $contract['registration_number'] ?? '—'],
            ['Canone incassato ' . $year, '€ ' . number_format($received, 2, ',', '.') . ' (' . (int) $rec['n'] . ' rate)'],
        ]];
    }

    if (!$anyRent) {
        $blocks[] = ['type' => 'paragraph', 'text' => 'Nessun canone risulta incassato nell\'anno ' . $year . ' per gli immobili di questo proprietario.'];
    }

    $blocks[] = ['type' => 'divider'];
    $blocks[] = ['type' => 'h2', 'text' => 'Riepilogo fiscale ' . $year];
    $blocks[] = ['type' => 'kv', 'pairs' => [
        ['Totale canoni incassati',        '€ ' . number_format($totalReceived, 2, ',', '.')],
        ['di cui in cedolare secca',       '€ ' . number_format($totalCedolare, 2, ',', '.')],
        ['di cui in regime ordinario',     '€ ' . number_format($totalOrdinario, 2, ',', '.')],
    ]];
    $blocks[] = ['type' => 'spacer', 'height' => 4];
    $blocks[] = ['type' => 'paragraph', 'text' =>
        'Prospetto di supporto alla dichiarazione dei redditi (730/Redditi PF), generato il '
        . date('d/m/Y') . '. I valori si basano sui pagamenti registrati come incassati. '
        . 'Non costituisce documento fiscale né consulenza: la determinazione dell\'imponibile spetta al commercialista.'];

    $docTitle = 'Prospetto fiscale ' . trim($client['surname'] . ' ' . $client['name']) . ' — ' . $year;
    $pdf    = SimplePdf::fromBlocks($docTitle, $blocks, pdfDocOpts($docTitle, ['meta' => 'Anno ' . $year]));
    $result = persistPdf($db, 'report', $docTitle, $pdf, $clientId, null, null, getCurrentAdminId());

    apiSuccess($result);
} catch (Throwable $e) {
    apiError('Errore generazione prospetto fiscale.', 500);
}

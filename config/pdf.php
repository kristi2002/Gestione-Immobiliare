<?php
/**
 * PDF contract and report generation.
 */

require_once __DIR__ . '/../lib/SimplePdf.php';
require_once __DIR__ . '/settings.php';

/**
 * Build the shared banner/footer options for every styled PDF, based on the
 * agency branding in settings (name, address, phone, email, logo, colour).
 */
function pdfDocOpts(string $title, array $extra = []): array
{
    $agency = getSetting('agency_name', 'Gestionale Immobiliare');
    $addr   = getSetting('agency_address', '');
    $phone  = getSetting('agency_phone', '');
    $email  = getSetting('agency_email', '');

    $opts = [
        'banner'   => true,
        'brand'    => getSetting('primary_color', '#2563eb'),
        'agency'   => $agency,
        'subtitle' => implode('  ·  ', array_filter([$addr, $phone ? 'Tel. ' . $phone : ''])),
        'title'    => $title,
        'meta2'    => date('d/m/Y'),
        'author'   => $agency,
        'footer'   => $agency . ($email ? '  ·  ' . $email : '') . '  ·  Documento generato il ' . date('d/m/Y H:i'),
    ];

    $logo = getSetting('logo_path', '');
    if ($logo) {
        $logoFull = dirname(__DIR__) . '/' . ltrim($logo, '/');
        if (is_file($logoFull)) {
            $opts['logo'] = $logoFull;
        }
    }

    return array_merge($opts, $extra);
}

function generateContractPdf(PDO $db, array $params, int $adminId): array
{
    $clientId   = (int) ($params['client_id'] ?? 0);
    $propertyId = (int) ($params['property_id'] ?? 0);
    $tenantId   = (int) ($params['tenant_id'] ?? 0);
    $rent       = $params['monthly_rent'] ?? null;
    $startDate  = $params['lease_start'] ?? date('Y-m-d');
    $endDate    = $params['lease_end'] ?? '';

    $client = $clientId ? fetchRow($db, 'clients', $clientId) : null;
    $property = $propertyId ? fetchRow($db, 'properties', $propertyId) : null;
    $tenant = $tenantId ? fetchTenant($db, $tenantId) : null;

    $title = 'Contratto di locazione';

    $rentValue = $rent ?? ($tenant['monthly_rent'] ?? null);
    $rentText  = ($rentValue !== null && $rentValue !== '')
        ? '€ ' . number_format((float) $rentValue, 2, ',', '.')
        : '—';

    $blocks = [
        ['type' => 'h2', 'text' => 'Locatore / Proprietario'],
        ['type' => 'kv', 'pairs' => [
            ['Nominativo', $client ? trim($client['name'] . ' ' . $client['surname']) : '—'],
            ['Email',      $client['email'] ?? '—'],
            ['Telefono',   $client['phone'] ?? '—'],
        ]],
        ['type' => 'h2', 'text' => 'Immobile'],
        ['type' => 'kv', 'pairs' => [
            ['Indirizzo',  $property ? trim($property['address'] . ', ' . $property['city'] . ' ' . ($property['cap'] ?? '')) : '—'],
            ['Superficie', $property && $property['sqm'] ? rtrim(rtrim(number_format((float) $property['sqm'], 2, ',', '.'), '0'), ',') . ' mq' : '—'],
        ]],
        ['type' => 'h2', 'text' => 'Conduttore / Inquilino'],
        ['type' => 'kv', 'pairs' => [
            ['Nominativo', $tenant ? trim($tenant['name'] . ' ' . $tenant['surname']) : ($params['tenant_name'] ?? '—')],
            ['Email',      $tenant['email'] ?? ($params['tenant_email'] ?? '—')],
        ]],
        ['type' => 'h2', 'text' => 'Condizioni economiche'],
        ['type' => 'price', 'label' => 'Canone mensile', 'value' => $rentText, 'note' => 'Locazione'],
        ['type' => 'kv', 'pairs' => [
            ['Decorrenza', formatDateIt($startDate)],
            ['Scadenza',   $endDate ? formatDateIt($endDate) : 'Da definire'],
        ]],
        ['type' => 'spacer', 'height' => 6],
        ['type' => 'paragraph', 'text' => 'Il presente documento è generato automaticamente dal gestionale immobiliare e ha valore di bozza fino alla sottoscrizione delle parti.'],
        ['type' => 'signatures', 'items' => ['Firma del locatore', 'Firma del conduttore']],
    ];

    $pdf = SimplePdf::fromBlocks($title, $blocks, pdfDocOpts($title));

    // Pass NULL (not 0) for missing links so the pdf_documents FKs aren't violated.
    return persistPdf($db, 'contract', $title, $pdf, $clientId ?: null, $propertyId ?: null, $tenantId ?: null, $adminId);
}

function generatePropertyReportPdf(PDO $db, int $propertyId, int $adminId): array
{
    $property = fetchRow($db, 'properties', $propertyId);
    if (!$property) {
        return ['success' => false, 'error' => 'Immobile non trovato.'];
    }

    $client = fetchRow($db, 'clients', (int) $property['client_id']);

    // Maps for human-readable labels.
    $statusLabels = [
        'available' => 'Disponibile',
        'rented'    => 'Affittato',
        'sold'      => 'Venduto',
        'archived'  => 'Archiviato',
    ];
    $typeLabels = [
        'appartamento' => 'Appartamento', 'villa' => 'Villa', 'ufficio' => 'Ufficio',
        'negozio' => 'Negozio', 'box' => 'Box / Garage', 'terreno' => 'Terreno', 'altro' => 'Altro',
    ];

    $priceType   = $property['price_type'] ?? 'vendita';
    $isRent      = $priceType === 'affitto';
    $listingWord = $isRent ? 'Affitto' : 'Vendita';

    // ---- Banner / header --------------------------------------------------
    $opts = pdfDocOpts('Scheda Immobile — ' . $listingWord, [
        'meta' => 'Rif. #' . str_pad((string) $propertyId, 4, '0', STR_PAD_LEFT),
    ]);

    $blocks = [];

    // ---- Cover photo (JPEG only; silently skipped otherwise) --------------
    if (!empty($property['cover_media_id'])) {
        $stmt = $db->prepare('SELECT file_path, mime_type FROM property_media WHERE id = :id AND property_id = :pid');
        $stmt->execute(['id' => (int) $property['cover_media_id'], 'pid' => $propertyId]);
        $cover = $stmt->fetch();
        if ($cover && !empty($cover['file_path'])) {
            $coverFull = dirname(__DIR__) . '/' . ltrim($cover['file_path'], '/');
            $isJpeg = stripos((string) ($cover['mime_type'] ?? ''), 'jpeg') !== false
                || preg_match('/\.jpe?g$/i', $cover['file_path']);
            if ($isJpeg && is_file($coverFull)) {
                $blocks[] = ['type' => 'image', 'path' => $coverFull, 'maxHeight' => 235];
            }
        }
    }

    // ---- Title line of the property --------------------------------------
    $blocks[] = ['type' => 'spacer', 'height' => 2];

    // ---- Price highlight --------------------------------------------------
    if (!empty($property['price']) && (float) $property['price'] > 0) {
        $priceFmt = '€ ' . number_format((float) $property['price'], 0, ',', '.') . ($isRent ? ' / mese' : '');
        $blocks[] = [
            'type'  => 'price',
            'label' => $isRent ? 'Canone richiesto' : 'Prezzo richiesto',
            'value' => $priceFmt,
            'note'  => $listingWord,
        ];
    }

    // ---- Property data grid ----------------------------------------------
    $addressFull = $property['address']
        . ', ' . $property['city']
        . ($property['cap'] ? ' ' . $property['cap'] : '')
        . (!empty($property['province']) ? ' (' . $property['province'] . ')' : '');

    $blocks[] = ['type' => 'h2', 'text' => 'Dati immobile'];
    $blocks[] = ['type' => 'kv', 'pairs' => [
        ['Indirizzo',  $property['address'] ?: '—'],
        ['Località',   trim($property['city'] . ' ' . ($property['cap'] ?? '')) ?: '—'],
        ['Tipologia',  $typeLabels[$property['property_type'] ?? ''] ?? '—'],
        ['Stato',      $statusLabels[$property['status'] ?? ''] ?? ($property['status'] ?? '—')],
        ['Superficie', !empty($property['sqm']) ? rtrim(rtrim(number_format((float) $property['sqm'], 2, ',', '.'), '0'), ',') . ' mq' : '—'],
        ['Locali',     $property['rooms'] !== null && $property['rooms'] !== '' ? (string) $property['rooms'] : '—'],
        ['Bagni',      $property['bathrooms'] !== null && $property['bathrooms'] !== '' ? (string) $property['bathrooms'] : '—'],
        ['Piano',      $property['floor'] ?: '—'],
    ]];

    // ---- Owner ------------------------------------------------------------
    $blocks[] = ['type' => 'h2', 'text' => 'Proprietario'];
    $blocks[] = ['type' => 'kv', 'pairs' => [
        ['Nominativo', $client ? trim($client['name'] . ' ' . $client['surname']) : '—'],
        ['Email',      $client['email'] ?? '—'],
        ['Telefono',   $client['phone'] ?? '—'],
        ['Indirizzo',  $addressFull],
    ]];

    // ---- Description ------------------------------------------------------
    if (!empty(trim((string) ($property['description'] ?? '')))) {
        $blocks[] = ['type' => 'h2', 'text' => 'Descrizione'];
        $blocks[] = ['type' => 'paragraph', 'text' => $property['description']];
    }

    // ---- Features ---------------------------------------------------------
    if (!empty(trim((string) ($property['additional_features'] ?? '')))) {
        $blocks[] = ['type' => 'h2', 'text' => 'Caratteristiche'];
        $features = preg_split('/\r\n|\r|\n|,|;|•/', (string) $property['additional_features']);
        $features = array_values(array_filter(array_map('trim', $features), fn($f) => $f !== ''));
        if (count($features) > 1) {
            $blocks[] = ['type' => 'bullets', 'items' => $features];
        } else {
            $blocks[] = ['type' => 'paragraph', 'text' => $property['additional_features']];
        }
    }

    $pdf = SimplePdf::fromBlocks('Scheda immobile #' . $propertyId, $blocks, $opts);

    return persistPdf($db, 'report', 'Scheda immobile #' . $propertyId, $pdf, (int) $property['client_id'], $propertyId, null, $adminId);
}

function generateMandatoPdf(PDO $db, array $params, int $adminId): array
{
    $clientId   = (int) ($params['client_id'] ?? 0);
    $propertyId = (int) ($params['property_id'] ?? 0);

    $client   = $clientId ? fetchRow($db, 'clients', $clientId) : null;
    $property = $propertyId ? fetchRow($db, 'properties', $propertyId) : null;

    if (!$client || !$property) {
        return ['success' => false, 'error' => 'Proprietario e immobile obbligatori per il mandato.'];
    }

    $agency      = getSetting('agency_name', 'Gestionale Immobiliare');
    $commission  = $params['commission_pct'] ?? getSetting('default_commission_pct', '3');
    $isRent      = ($property['price_type'] ?? 'vendita') === 'affitto';
    $mandateType = $isRent ? 'locazione' : 'vendita';
    $priceText   = (!empty($property['price']) && (float) $property['price'] > 0)
        ? '€ ' . number_format((float) $property['price'], 0, ',', '.') . ($isRent ? ' / mese' : '')
        : '—';
    $title = 'Mandato di agenzia — ' . ucfirst($mandateType);

    $clauses = [
        "Il Mandante conferisce all'Agenzia incarico di promuovere la {$mandateType} dell'immobile sopra descritto.",
        'Durata del mandato: 12 mesi dalla data di sottoscrizione, rinnovabile tacitamente salvo disdetta.',
        'Provvigione dovuta all\'Agenzia in caso di conclusione dell\'affare: ' . $commission . '%.',
        'Il Mandante dichiara di essere legittimo proprietario dell\'immobile e di averne la piena disponibilità.',
        'Documentazione catastale e conformità urbanistica: da esibire su richiesta dell\'Agenzia.',
        'Il presente mandato è redatto ai sensi della normativa vigente in materia di intermediazione immobiliare (D.Lgs. 122/2005 e s.m.i.).',
    ];

    $blocks = [
        ['type' => 'paragraph', 'text' => 'Oggetto: incarico di ' . $mandateType . ' immobiliare.'],
        ['type' => 'h2', 'text' => 'Il Mandante (proprietario)'],
        ['type' => 'kv', 'pairs' => [
            ['Nominativo', trim($client['name'] . ' ' . $client['surname'])],
            ['Email',      $client['email'] ?? '—'],
            ['Telefono',   $client['phone'] ?? '—'],
        ]],
        ['type' => 'h2', 'text' => "L'immobile"],
        ['type' => 'kv', 'pairs' => [
            ['Indirizzo',  trim($property['address'] . ', ' . $property['city'] . ' ' . ($property['cap'] ?? ''))],
            ['Superficie', $property['sqm'] ? rtrim(rtrim(number_format((float) $property['sqm'], 2, ',', '.'), '0'), ',') . ' mq' : '—'],
        ]],
        ['type' => 'price', 'label' => $isRent ? 'Canone richiesto' : 'Prezzo richiesto', 'value' => $priceText, 'note' => ucfirst($mandateType)],
        ['type' => 'h2', 'text' => "L'incaricato (agenzia)"],
        ['type' => 'kv', 'pairs' => [
            ['Agenzia', $agency],
        ]],
        ['type' => 'h2', 'text' => 'Clausole'],
        ['type' => 'bullets', 'items' => $clauses],
        ['type' => 'signatures', 'items' => ['Firma del Mandante', 'Firma dell\'Agenzia']],
    ];

    $pdf = SimplePdf::fromBlocks($title, $blocks, pdfDocOpts($title));

    return persistPdf($db, 'mandato', $title, $pdf, $clientId, $propertyId, null, $adminId);
}

function savePdf(PDO $db, string $type, string $title, array $lines, ?int $clientId, ?int $propertyId, ?int $tenantId, int $adminId): array
{
    $pdf = SimplePdf::fromText($title, $lines, getSetting('agency_name', 'Gestionale'));
    return persistPdf($db, $type, $title, $pdf, $clientId, $propertyId, $tenantId, $adminId);
}

function persistPdf(PDO $db, string $type, string $title, SimplePdf $pdf, ?int $clientId, ?int $propertyId, ?int $tenantId, int $adminId): array
{
    $dir = dirname(__DIR__) . '/uploads/documents/generated';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['success' => false, 'error' => 'Cartella uploads non scrivibile sul server. Controlla i permessi della cartella uploads/.'];
    }

    $filename = $type . '_' . date('Ymd_His') . '_' . uniqid() . '.pdf';
    $fullPath = $dir . '/' . $filename;
    $relative = 'uploads/documents/generated/' . $filename;

    if (@file_put_contents($fullPath, $pdf->output()) === false) {
        return ['success' => false, 'error' => 'Impossibile salvare il PDF: la cartella uploads/ non è scrivibile sul server.'];
    }

    $stmt = $db->prepare(
        'INSERT INTO pdf_documents (doc_type, title, client_id, property_id, tenant_id, file_path, created_by)
         VALUES (:type, :title, :client_id, :property_id, :tenant_id, :path, :created_by)'
    );
    $stmt->execute([
        'type'        => $type,
        'title'       => $title,
        'client_id'   => $clientId,
        'property_id' => $propertyId,
        'tenant_id'   => $tenantId,
        'path'        => $relative,
        'created_by'  => $adminId,
    ]);

    return [
        'success'   => true,
        'id'        => (int) $db->lastInsertId(),
        'title'     => $title,
        'file_path' => $relative,
        'download'  => 'api/download_pdf.php?id=' . $db->lastInsertId(),
    ];
}

function fetchRow(PDO $db, string $table, int $id): ?array
{
    $allowed = ['clients', 'properties'];
    if (!in_array($table, $allowed, true)) {
        return null;
    }
    $stmt = $db->prepare("SELECT * FROM {$table} WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function fetchTenant(PDO $db, int $id): ?array
{
    $stmt = $db->prepare('SELECT * FROM tenants WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function formatDateIt(?string $date): string
{
    if (!$date) return '—';
    $ts = strtotime($date);
    return $ts ? date('d/m/Y', $ts) : $date;
}

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

/**
 * Come si chiama e come si legge un contratto, per tipo.
 *
 * Prima esisteva un solo esito possibile — «Contratto di locazione» con la voce
 * «Canone mensile» — qualunque cosa fosse il contratto: da una compravendita
 * usciva un documento intestato alla locazione, con il canone vuoto e nessun
 * prezzo. Era il PDF che l'agente consegna al cliente.
 */
const CONTRACT_PDF_SHAPES = [
    'locazione' => [
        'title'       => 'Contratto di locazione',
        'amount_from' => 'monthly_rent',
        'amount_label' => 'Canone mensile',
        'amount_note' => 'Locazione',
        'deposit_label' => 'Deposito cauzionale',
        'parties'     => ['Locatore / Proprietario', 'Conduttore / Inquilino'],
        'signatures'  => ['Firma del locatore', 'Firma del conduttore'],
    ],
    'compravendita' => [
        'title'       => 'Contratto di compravendita',
        'amount_from' => 'sale_price',
        'amount_label' => 'Prezzo di vendita',
        'amount_note' => 'Compravendita',
        'deposit_label' => 'Caparra confirmatoria',
        'parties'     => ['Parte venditrice', 'Parte acquirente'],
        'signatures'  => ['Firma del venditore', 'Firma dell\'acquirente'],
    ],
    'preliminare' => [
        'title'       => 'Contratto preliminare di compravendita',
        'amount_from' => 'sale_price',
        'amount_label' => 'Prezzo pattuito',
        'amount_note' => 'Preliminare',
        'deposit_label' => 'Caparra confirmatoria',
        'parties'     => ['Promittente venditore', 'Promissario acquirente'],
        'signatures'  => ['Firma del promittente venditore', 'Firma del promissario acquirente'],
    ],
    'altro' => [
        'title'       => 'Contratto',
        'amount_from' => 'monthly_rent',
        'amount_label' => 'Importo',
        'amount_note' => '',
        'deposit_label' => 'Deposito',
        'parties'     => ['Prima parte', 'Seconda parte'],
        'signatures'  => ['Firma della prima parte', 'Firma della seconda parte'],
    ],
];

function pdfMoneyText($value): string
{
    return ($value !== null && $value !== '' && (float) $value != 0.0)
        ? '€ ' . number_format((float) $value, 2, ',', '.')
        : '—';
}

function generateContractPdf(PDO $db, array $params, int $adminId): array
{
    // Il contratto e' la fonte di verita', non i campi sciolti del chiamante:
    // senza rileggerlo non si puo' sapere nemmeno di che tipo di contratto si
    // tratta. `contract_id` resta facoltativo per non rompere i vecchi
    // chiamanti, che continuano a ottenere il comportamento di prima.
    $contractId = (int) ($params['contract_id'] ?? 0);
    $contract   = $contractId ? fetchRow($db, 'contracts', $contractId) : null;

    if ($contract && $contract['contract_type'] === 'mandato') {
        // Il mandato ha gia' il suo generatore, con le clausole di incarico.
        return generateMandatoPdf($db, [
            'client_id'   => $contract['client_id'],
            'property_id' => $contract['property_id'],
        ] + $params, $adminId);
    }

    $clientId   = (int) ($contract['client_id']   ?? $params['client_id']   ?? 0);
    $propertyId = (int) ($contract['property_id'] ?? $params['property_id'] ?? 0);
    $tenantId   = (int) ($contract['tenant_id']   ?? $params['tenant_id']   ?? 0);
    $startDate  = $contract['start_date'] ?? $params['lease_start'] ?? date('Y-m-d');
    $endDate    = $contract['end_date']   ?? $params['lease_end']   ?? '';

    $client   = $clientId ? fetchRow($db, 'clients', $clientId) : null;
    $property = $propertyId ? fetchRow($db, 'properties', $propertyId) : null;
    $tenant   = $tenantId ? fetchTenant($db, $tenantId) : null;

    $type  = $contract['contract_type'] ?? 'locazione';
    $shape = CONTRACT_PDF_SHAPES[$type] ?? CONTRACT_PDF_SHAPES['locazione'];

    $title = $shape['title'];
    // Un sottotipo dichiarato (transitorio, concordato, studenti...) va nel
    // titolo: e' cio' che distingue un 4+4 da un contratto per studenti.
    if (!empty($contract['contract_subtype'])) {
        $title .= ' (' . $contract['contract_subtype'] . ')';
    }

    $amount = $contract
        ? ($contract[$shape['amount_from']] ?? null)
        : ($params['monthly_rent'] ?? $tenant['monthly_rent'] ?? null);

    $economics = [
        ['type' => 'price', 'label' => $shape['amount_label'], 'value' => pdfMoneyText($amount), 'note' => $shape['amount_note']],
    ];

    $terms = [
        ['Decorrenza', formatDateIt($startDate)],
        ['Scadenza',   $endDate ? formatDateIt($endDate) : 'Da definire'],
    ];
    if ($contract && $contract['deposit'] !== null && (float) $contract['deposit'] != 0.0) {
        $terms[] = [$shape['deposit_label'], pdfMoneyText($contract['deposit'])];
    }
    if ($contract && !empty($contract['registration_number'])) {
        $terms[] = ['Registrazione', trim($contract['registration_number']
            . ($contract['registration_date'] ? ' del ' . formatDateIt($contract['registration_date']) : '')
            . ($contract['registration_office'] ? ' — ' . $contract['registration_office'] : ''))];
    }
    if ($contract && !empty($contract['cedolare_secca'])) {
        $terms[] = ['Regime fiscale', 'Cedolare secca'];
    }
    $economics[] = ['type' => 'kv', 'pairs' => $terms];

    $blocks = [
        ['type' => 'h2', 'text' => $shape['parties'][0]],
        ['type' => 'kv', 'pairs' => $client ? mandantePairs($client) : [['Nominativo', '—']]],
        ['type' => 'h2', 'text' => 'Immobile'],
        ['type' => 'kv', 'pairs' => [
            ['Indirizzo',  $property ? trim($property['address'] . ', ' . $property['city'] . ' ' . ($property['cap'] ?? '')) : '—'],
            ['Superficie', $property && $property['sqm'] ? rtrim(rtrim(number_format((float) $property['sqm'], 2, ',', '.'), '0'), ',') . ' mq' : '—'],
            // Legally required in the contract (D.Lgs 192/2005 art. 6).
            ['Classe energetica', $property && !empty($property['energy_class']) ? $property['energy_class'] : 'n.d.'],
        ]],
        ['type' => 'h2', 'text' => $shape['parties'][1]],
        ['type' => 'kv', 'pairs' => $tenant ? mandantePairs($tenant) : [
            ['Nominativo', $params['tenant_name'] ?? '—'],
            ['Email',      $params['tenant_email'] ?? '—'],
        ]],
        ['type' => 'h2', 'text' => 'Condizioni economiche'],
    ];
    array_push($blocks, ...$economics);

    if ($type === 'locazione' && $contract && !empty($contract['istat_update_enabled'])) {
        $blocks[] = ['type' => 'paragraph', 'text' => 'Il canone è soggetto ad aggiornamento annuale secondo la variazione dell\'indice ISTAT FOI, nella misura di legge.'];
    }

    $blocks[] = ['type' => 'spacer', 'height' => 6];
    $blocks[] = ['type' => 'paragraph', 'text' => 'Il presente documento è generato automaticamente dal gestionale immobiliare e ha valore di bozza fino alla sottoscrizione delle parti.'];
    $blocks[] = ['type' => 'signatures', 'items' => $shape['signatures']];

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
    // "Prezzo su richiesta" mirrors the public listing: the figure is withheld
    // even on the scheda handout, so it can't contradict what's advertised.
    if (!empty($property['price_on_request'])) {
        $blocks[] = [
            'type'  => 'price',
            'label' => $isRent ? 'Canone' : 'Prezzo',
            'value' => 'Prezzo su richiesta',
            'note'  => $listingWord,
        ];
    } elseif (!empty($property['price']) && (float) $property['price'] > 0) {
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

    // immobiliare.it "Tipologia" (typology) is finer than the legacy group;
    // prefer it, fall back to the group label.
    $typologyLabel = !empty($property['typology'])
        ? $property['typology']
        : ($typeLabels[$property['property_type'] ?? ''] ?? '—');

    $blocks[] = ['type' => 'h2', 'text' => 'Dati immobile'];
    $blocks[] = ['type' => 'kv', 'pairs' => [
        ['Indirizzo',  $property['address'] ?: '—'],
        ['Località',   trim($property['city'] . ' ' . ($property['cap'] ?? '')) ?: '—'],
        ['Tipologia',  $typologyLabel],
        ['Stato',      $statusLabels[$property['status'] ?? ''] ?? ($property['status'] ?? '—')],
        ['Superficie', !empty($property['sqm']) ? rtrim(rtrim(number_format((float) $property['sqm'], 2, ',', '.'), '0'), ',') . ' mq' : '—'],
        ['Classe energetica', !empty($property['energy_class']) ? $property['energy_class'] : 'n.d.'],
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

    // ---- Composizione e dotazioni (scheda immobiliare.it) -----------------
    // Single source of truth: the structured fields, not the retired
    // additional_features free-text. Selects render as key/value; the Sì/No
    // amenity flags become a checklist of what the property has.
    $pretty = static function ($v): ?string {
        $v = trim((string) $v);
        return $v === '' ? null : ucfirst(str_replace('_', ' ', $v));
    };

    $detailPairs = [];
    foreach ([
        ['kitchen_type', 'Cucina'], ['furnished', 'Arredamento'], ['garden', 'Giardino'],
        ['garage_type', 'Box auto'], ['window_frames', 'Infissi esterni'],
        ['tv_system', 'Impianto TV'], ['concierge', 'Portineria'],
        ['property_class', 'Classe immobile'], ['condition_state', 'Stato'],
        ['overlooking', 'Affaccio'], ['heating', 'Riscaldamento'],
        ['heating_system', 'Tipo impianto'], ['heating_fuel', 'Alimentazione'],
        ['air_conditioning', 'Climatizzazione'], ['air_conditioning_type', 'Tipo clima'],
    ] as [$col, $label]) {
        $val = $pretty($property[$col] ?? null);
        if ($val !== null) {
            $detailPairs[] = [$label, $val];
        }
    }
    if ($detailPairs) {
        $blocks[] = ['type' => 'h2', 'text' => 'Composizione e impianti'];
        $blocks[] = ['type' => 'kv', 'pairs' => $detailPairs];
    }

    $amenities = [];
    foreach ([
        ['elevator', 'Ascensore'], ['disabled_access', 'Accesso disabili'],
        ['wardrobes', 'Armadi a muro'], ['cellar', 'Cantina'], ['attic_room', 'Mansarda'],
        ['tavern', 'Taverna'], ['armored_door', 'Porta blindata'],
        ['alarm_system', "Impianto d'allarme"], ['electric_gate', 'Cancello elettrico'],
        ['video_intercom', 'Videocitofono'], ['optical_fiber', 'Fibra ottica'],
        ['fireplace', 'Camino'], ['jacuzzi', 'Idromassaggio'], ['pool', 'Piscina'],
        ['tennis_court', 'Campo da tennis'],
    ] as [$col, $label]) {
        if ((int) ($property[$col] ?? 0) === 1) {
            $amenities[] = $label;
        }
    }
    if ($amenities) {
        $blocks[] = ['type' => 'h2', 'text' => 'Dotazioni'];
        $blocks[] = ['type' => 'bullets', 'items' => $amenities];
    }

    $pdf = SimplePdf::fromBlocks('Scheda immobile #' . $propertyId, $blocks, $opts);

    return persistPdf($db, 'report', 'Scheda immobile #' . $propertyId, $pdf, (int) $property['client_id'], $propertyId, null, $adminId);
}

/**
 * Key/value pairs identifying the Mandante (proprietario) on a mandate.
 * Uses the extended anagrafica (phase59) when present so the document holds the
 * data a real mandate needs — CF, nascita, residenza, and for a persona
 * giuridica the ragione sociale + P.IVA — falling back gracefully when a field
 * is empty on older/thin records.
 */
function mandantePairs(array $client): array
{
    $isCompany = ($client['person_type'] ?? 'fisica') === 'giuridica';

    $resParts = [];
    if (!empty($client['address'])) {
        $resParts[] = $client['address'];
    }
    $line2 = trim(($client['cap'] ?? '') . ' ' . ($client['city'] ?? ''));
    if (!empty($client['province'])) {
        $line2 = trim($line2 . ' (' . $client['province'] . ')');
    }
    if ($line2 !== '') {
        $resParts[] = $line2;
    }
    $residence = implode(', ', $resParts);

    $pairs = [];
    if ($isCompany && !empty($client['company_name'])) {
        $pairs[] = ['Ragione sociale', $client['company_name']];
        $pairs[] = ['Legale rappr.',   trim($client['name'] . ' ' . $client['surname'])];
    } else {
        $pairs[] = ['Nominativo', trim($client['name'] . ' ' . $client['surname'])];
    }
    if (!$isCompany && (!empty($client['birth_place']) || !empty($client['birth_date']))) {
        $bp = $client['birth_place'] ?? '';
        $bd = !empty($client['birth_date']) ? date('d/m/Y', strtotime($client['birth_date'])) : '';
        $pairs[] = ['Nato/a', trim($bp . ($bd ? ' il ' . $bd : ''))];
    }
    if (!empty($client['codice_fiscale'])) {
        $pairs[] = ['Codice fiscale', $client['codice_fiscale']];
    }
    if ($isCompany && !empty($client['vat_number'])) {
        $pairs[] = ['Partita IVA', $client['vat_number']];
    }
    if ($residence !== '') {
        $pairs[] = [$isCompany ? 'Sede legale' : 'Residenza', $residence];
    }
    $pairs[] = ['Email', $client['email'] ?? '—'];
    if (!empty($client['pec_email'])) {
        $pairs[] = ['PEC', $client['pec_email']];
    }
    $pairs[] = ['Telefono', $client['phone'] ?? '—'];

    return $pairs;
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
        ['type' => 'kv', 'pairs' => mandantePairs($client)],
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
    // 'contracts' serve a generateContractPdf per sapere che tipo di contratto
    // sta stampando. La lista resta chiusa: il nome tabella finisce in SQL.
    $allowed = ['clients', 'properties', 'contracts'];
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

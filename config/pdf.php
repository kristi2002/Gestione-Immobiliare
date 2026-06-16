<?php
/**
 * PDF contract and report generation.
 */

require_once __DIR__ . '/../lib/SimplePdf.php';
require_once __DIR__ . '/settings.php';

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

    $agency = getSetting('agency_name', 'Gestionale Immobiliare');
    $title  = 'Contratto di locazione';

    $lines = [
        strtoupper($agency),
        $title,
        str_repeat('-', 60),
        'Data: ' . date('d/m/Y'),
        '',
        'LOCATORE / PROPRIETARIO',
        $client ? ($client['name'] . ' ' . $client['surname']) : '—',
        $client['email'] ?? '',
        '',
        'IMMOBILE',
        $property ? ($property['address'] . ', ' . $property['city']) : '—',
        $property ? ('Superficie: ' . ($property['sqm'] ?? '—') . ' mq') : '',
        '',
        'CONDUTTORE / INQUILINO',
        $tenant ? ($tenant['name'] . ' ' . $tenant['surname']) : ($params['tenant_name'] ?? '—'),
        $tenant['email'] ?? ($params['tenant_email'] ?? ''),
        '',
        'CONDIZIONI ECONOMICHE',
        'Canone mensile: EUR ' . ($rent ?? $tenant['monthly_rent'] ?? '—'),
        'Decorrenza: ' . formatDateIt($startDate),
        'Scadenza: ' . ($endDate ? formatDateIt($endDate) : 'da definire'),
        '',
        'Il presente documento è generato dal gestionale immobiliare.',
        'Firma locatore: _________________________',
        'Firma conduttore: _______________________',
    ];

    return savePdf($db, 'contract', $title, $lines, $clientId, $propertyId, $tenantId, $adminId);
}

function generatePropertyReportPdf(PDO $db, int $propertyId, int $adminId): array
{
    $property = fetchRow($db, 'properties', $propertyId);
    if (!$property) {
        return ['success' => false, 'error' => 'Immobile non trovato.'];
    }

    $client = fetchRow($db, 'clients', (int) $property['client_id']);
    $agency = getSetting('agency_name', 'Gestionale Immobiliare');

    $lines = [
        strtoupper($agency),
        'SCHEDA IMMOBILE',
        str_repeat('-', 60),
        'Indirizzo: ' . $property['address'],
        'Città: ' . $property['city'] . ' ' . ($property['cap'] ?? ''),
        'Superficie: ' . ($property['sqm'] ?? '—') . ' mq',
        'Locali: ' . ($property['rooms'] ?? '—'),
        'Bagni: ' . ($property['bathrooms'] ?? '—'),
        'Piano: ' . ($property['floor'] ?? '—'),
        'Stato: ' . $property['status'],
        '',
        'Proprietario: ' . ($client ? $client['name'] . ' ' . $client['surname'] : '—'),
        '',
        'Descrizione:',
        wordwrap($property['description'] ?? '—', 70, "\n", true),
        '',
        'Caratteristiche:',
        wordwrap($property['additional_features'] ?? '—', 70, "\n", true),
        '',
        'Generato il ' . date('d/m/Y H:i'),
    ];

    return savePdf($db, 'report', 'Scheda immobile #' . $propertyId, $lines, (int) $property['client_id'], $propertyId, null, $adminId);
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

    $agency    = getSetting('agency_name', 'Gestionale Immobiliare');
    $agencyAddr = getSetting('agency_address', '');
    $agencyPhone = getSetting('agency_phone', '');
    $commission = $params['commission_pct'] ?? getSetting('default_commission_pct', '3');
    $mandateType = ($property['price_type'] ?? 'vendita') === 'affitto' ? 'locazione' : 'vendita';
    $price     = $property['price'] ?? '—';
    $title     = 'Mandato di agenzia — ' . $mandateType;

    $lines = [
        strtoupper($agency),
        $agencyAddr,
        $agencyPhone ? 'Tel: ' . $agencyPhone : '',
        '',
        'MANDATO DI AGENZIA IMMOBILIARE',
        'Oggetto: incarico di ' . $mandateType,
        str_repeat('-', 60),
        'Data: ' . date('d/m/Y'),
        '',
        'IL MANDANTE (proprietario)',
        $client['name'] . ' ' . $client['surname'],
        $client['email'] ?? '',
        $client['phone'] ?? '',
        '',
        'L\'IMMOBILE',
        $property['address'] . ', ' . $property['city'] . ' ' . ($property['cap'] ?? ''),
        'Superficie: ' . ($property['sqm'] ?? '—') . ' mq',
        'Prezzo richiesto: EUR ' . $price . ' (' . ($property['price_type'] ?? 'vendita') . ')',
        '',
        'L\'INCARICATO (agenzia)',
        $agency,
        '',
        'CLAUSOLE',
        '1. Il Mandante conferisce all\'Agenzia mandato esclusivo/non esclusivo di promuovere',
        '   la ' . $mandateType . ' dell\'immobile sopra descritto.',
        '2. Durata del mandato: 12 mesi dalla data di sottoscrizione, rinnovabile.',
        '3. Provvigione dovuta all\'Agenzia in caso di conclusione dell\'affare: ' . $commission . '%.',
        '4. Il Mandante dichiara di essere legittimo proprietario dell\'immobile.',
        '5. Documentazione catastale e conformità urbanistica: da esibire su richiesta.',
        '',
        'Il presente mandato è redatto ai sensi della normativa vigente in materia',
        'di intermediazione immobiliare (D.Lgs. 122/2005 e s.m.i.).',
        '',
        'Firma del Mandante: _________________________    Data: ___/___/______',
        '',
        'Firma dell\'Agenzia: _________________________    Data: ___/___/______',
    ];

    return savePdf($db, 'mandato', $title, $lines, $clientId, $propertyId, null, $adminId);
}

function savePdf(PDO $db, string $type, string $title, array $lines, ?int $clientId, ?int $propertyId, ?int $tenantId, int $adminId): array
{
    $dir = dirname(__DIR__) . '/uploads/documents/generated';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $filename = $type . '_' . date('Ymd_His') . '_' . uniqid() . '.pdf';
    $fullPath = $dir . '/' . $filename;
    $relative = 'uploads/documents/generated/' . $filename;

    $pdf = SimplePdf::fromText($title, $lines, getSetting('agency_name', 'Gestionale'));
    file_put_contents($fullPath, $pdf->output());

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

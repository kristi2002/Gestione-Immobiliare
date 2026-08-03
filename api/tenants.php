<?php
/**
 * Tenants (inquilini) CRUD API.
 *
 * A tenant is a person. WHERE they live and on what lease terms is recorded
 * in CONTRACTS (tenant_id + property_id), not on the tenant row itself — this
 * lets the same person be re-rented to a different property later without
 * losing or overwriting their previous lease history. See getTenantCurrentContract()
 * in config/db.php for how "current property" is resolved (active contract,
 * falling back to the most recent one).
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/auth.php';
require_once __DIR__ . '/../config/consent.php';
// La locazione che nasce da qui passa dalle stesse guardie del modulo Contratti.
require_once __DIR__ . '/../lib/contract_lifecycle.php';

apiHandleOptions();
requireViewAccess('tenants');

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    if ($method === 'GET') {
        if (($_GET['action'] ?? '') === 'stats') {
            tenantStats($db);
        }
        $id ? getTenant($db, $id) : listTenants($db);
    } elseif ($method === 'POST') {
        requireWriteAccess();
        createTenant($db);
    } elseif ($method === 'PUT' && $id) {
        requireWriteAccess();
        updateTenant($db, $id);
    } elseif ($method === 'DELETE' && $id) {
        requireWriteAccess();
        archiveTenant($db, $id);
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function tenantStats(PDO $db): void
{
    $total  = (int) $db->query("SELECT COUNT(*) FROM tenants WHERE status != 'archived'")->fetchColumn();
    $active = (int) $db->query("SELECT COUNT(*) FROM tenants WHERE status = 'active'")->fetchColumn();
    $withContract = (int) $db->query(
        "SELECT COUNT(DISTINCT c.tenant_id) FROM contracts c
         JOIN tenants t ON t.id = c.tenant_id AND t.status != 'archived'
         WHERE (c.end_date IS NULL OR c.end_date >= CURDATE())"
    )->fetchColumn();
    $expiring = (int) $db->query(
        "SELECT COUNT(DISTINCT c.tenant_id) FROM contracts c
         JOIN tenants t ON t.id = c.tenant_id AND t.status != 'archived'
         WHERE c.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)"
    )->fetchColumn();

    apiSuccess([
        'total'         => $total,
        'active'        => $active,
        'with_contract' => $withContract,
        'expiring'      => $expiring,
    ]);
}

/**
 * Shared derived-table join that resolves each tenant's current contract
 * (preferring an active one, else their most recent) in a single bulk query.
 */
function currentContractJoinSql(): string
{
    return "LEFT JOIN (
                SELECT * FROM (
                    SELECT c.tenant_id, c.id AS contract_id, c.property_id,
                           c.start_date AS lease_start, c.end_date AS lease_end, c.monthly_rent,
                           ROW_NUMBER() OVER (
                               PARTITION BY c.tenant_id
                               ORDER BY (c.end_date IS NULL OR c.end_date >= CURDATE()) DESC, c.start_date DESC, c.id DESC
                           ) AS rn
                    FROM contracts c
                    WHERE c.tenant_id IS NOT NULL
                ) ranked WHERE rn = 1
            ) cc ON cc.tenant_id = t.id
            LEFT JOIN properties p ON p.id = cc.property_id";
}

function listTenants(PDO $db): void
{
    // Stesso motivo di clients.php: le tendine "Inquilino" caricano l'elenco
    // completo con limit=500 in una richiesta sola, e col tetto a 100 gli
    // inquilini oltre il centesimo sparivano dai form senza alcun segnale.
    $pagination = apiGetPagination(25, 500);
    $search = trim($_GET['search'] ?? '');
    $where = "WHERE t.status != 'archived'";
    $params = [];
    if ($search !== '') {
        $where .= ' AND (t.name LIKE :s OR t.surname LIKE :s OR t.email LIKE :s OR t.codice_fiscale LIKE :s OR p.address LIKE :s)';
        $params['s'] = '%' . $search . '%';
    }

    $join = currentContractJoinSql();

    $countSql = "SELECT COUNT(*) FROM tenants t $join $where";

    $dataSql = "SELECT t.*, cc.contract_id, cc.property_id, cc.lease_start, cc.lease_end, cc.monthly_rent,
                   p.address AS property_address, p.city AS property_city,
                   IF((SELECT COUNT(*) FROM tenant_users tu WHERE tu.tenant_id = t.id) > 0, 1, 0) AS has_portal_access
            FROM tenants t
            $join
            $where
            ORDER BY t.surname, t.name";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getTenant(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM tenants WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) {
        apiError('Inquilino non trovato.', 404);
    }

    $contract = getTenantCurrentContract($db, $id);
    $row['contract_id']      = $contract['contract_id'] ?? null;
    $row['property_id']      = $contract['property_id'] ?? null;
    $row['property_address'] = $contract['address'] ?? null;
    $row['property_city']    = $contract['city'] ?? null;
    $row['lease_start']      = $contract['lease_start'] ?? null;
    $row['lease_end']        = $contract['lease_end'] ?? null;
    $row['monthly_rent']     = $contract['monthly_rent'] ?? null;
    $row['has_portal_access'] = tenantHasPortal($db, $id);
    // Letto dal registro, non dalla colonna: una revoca dal link di
    // disiscrizione vive lì, e la scheda deve mostrarla.
    $row['marketing_consent'] = consentGranted($db, 'tenant', $id);
    apiSuccess($row);
}

function createTenant(PDO $db): void
{
    $data       = apiGetJsonBody();
    $propertyId = (int) ($data['property_id'] ?? 0);
    $name       = trim($data['name'] ?? '');
    $surname    = trim($data['surname'] ?? '');
    $email      = trim($data['email'] ?? '');
    $phone      = trim($data['phone'] ?? '');
    $cf         = strtoupper(trim($data['codice_fiscale'] ?? ''));
    $password   = $data['portal_password'] ?? '';

    if ($propertyId <= 0 || $name === '' || $surname === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiError('property_id, nome, cognome e email valida sono obbligatori.');
    }
    if ($phone === '') {
        apiError('Il telefono è obbligatorio.');
    }
    assertValidTenantCf($cf, $data);

    $propStmt = $db->prepare('SELECT client_id FROM properties WHERE id = :id');
    $propStmt->execute(['id' => $propertyId]);
    $prop = $propStmt->fetch();
    if (!$prop) {
        apiError('Immobile non trovato.');
    }

    // La doppia locazione si controlla PRIMA di scrivere l'inquilino: il
    // contratto nasce poche righe piu' sotto, e rifiutarlo a quel punto
    // lascerebbe in anagrafica una persona senza contratto.
    assertLeaseFree($db, $propertyId, leaseTermsFromInput($data));

    $cols = [
        'name'    => $name,
        'surname' => $surname,
        'email'   => $email,
        'codice_fiscale' => $cf,
        'phone'   => $phone,
        'notes'   => trim($data['notes'] ?? '') ?: null,
        'iban'            => trim($data['iban'] ?? '') ?: null,
        'sdd_mandate_ref' => trim($data['sdd_mandate_ref'] ?? '') ?: null,
        'sdd_mandate_date'=> (trim($data['sdd_mandate_date'] ?? '') ?: null),
    ];
    // Extended anagrafica (phase60): person_type, nascita, residenza, giuridica.
    $cols = array_merge($cols, tenantAnagraficaFields($data));

    $names = array_keys($cols);
    $stmt = $db->prepare(
        'INSERT INTO tenants (' . implode(', ', $names) . ')
         VALUES (:' . implode(', :', $names) . ')'
    );
    $stmt->execute($cols);

    $tenantId = (int) $db->lastInsertId();

    // Property + lease info goes into a CONTRACTS row, not onto the tenant.
    createOrUpdateLeaseContract($db, $tenantId, $propertyId, (int) $prop['client_id'], $data);

    if ($password !== '' && strlen($password) >= 8) {
        createTenantPortalUser($tenantId, $password);
    }

    consentApplyFromInput($db, 'tenant', $tenantId, $data);
    logActivity('create', 'tenant', $tenantId, 'Inquilino creato: ' . $name . ' ' . $surname);
    getTenant($db, $tenantId);
}

function updateTenant(PDO $db, int $id): void
{
    $data = apiGetJsonBody();
    $existing = $db->prepare('SELECT id FROM tenants WHERE id = :id');
    $existing->execute(['id' => $id]);
    if (!$existing->fetch()) {
        apiError('Inquilino non trovato.', 404);
    }

    // CF resta obbligatorio anche in modifica se il campo viene inviato: non
    // deve poter essere svuotato una volta impostato (serve per l'RLI).
    if (array_key_exists('codice_fiscale', $data)) {
        $cf = strtoupper(trim((string) $data['codice_fiscale']));
        assertValidTenantCf($cf, $data);
        $data['codice_fiscale'] = $cf;
    }
    if (array_key_exists('phone', $data) && trim((string) $data['phone']) === '') {
        apiError('Il telefono è obbligatorio.');
    }

    $fields = [];
    $params = ['id' => $id];
    foreach (['name', 'surname', 'email', 'codice_fiscale', 'phone', 'notes', 'status', 'iban', 'sdd_mandate_ref', 'sdd_mandate_date'] as $f) {
        if (array_key_exists($f, $data)) {
            $fields[] = "{$f} = :{$f}";
            $params[$f] = ($data[$f] === '' ? null : $data[$f]);
        }
    }
    // Extended anagrafica (phase60), normalized/validated for any key present.
    foreach (tenantAnagraficaFields($data) as $col => $val) {
        $fields[] = "{$col} = :{$col}";
        $params[$col] = $val;
    }
    if ($fields) {
        $db->prepare('UPDATE tenants SET ' . implode(', ', $fields) . ' WHERE id = :id')->execute($params);
    }

    // A property_id in the payload means the lease/property was edited from
    // the tenant form — reflect it as a contract change, not a tenant column.
    if (!empty($data['property_id'])) {
        $propertyId = (int) $data['property_id'];
        $propStmt = $db->prepare('SELECT client_id FROM properties WHERE id = :id');
        $propStmt->execute(['id' => $propertyId]);
        $prop = $propStmt->fetch();
        if (!$prop) {
            apiError('Immobile non trovato.');
        }
        createOrUpdateLeaseContract($db, $id, $propertyId, (int) $prop['client_id'], $data);
    }

    if (!empty($data['portal_password']) && strlen($data['portal_password']) >= 8) {
        createTenantPortalUser($id, $data['portal_password']);
    }

    consentApplyFromInput($db, 'tenant', $id, $data);
    logActivity('update', 'tenant', $id, 'Inquilino aggiornato #' . $id);
    getTenant($db, $id);
}

/**
 * Reflects a property/lease assignment as a CONTRACTS row.
 * - Same property as the tenant's current contract → update that contract's
 *   lease terms in place (this is just editing an existing lease).
 * - Different property (or no contract yet) → insert a NEW contract, leaving
 *   any previous one untouched as history.
 */
function createOrUpdateLeaseContract(PDO $db, int $tenantId, int $propertyId, int $clientId, array $data): void
{
    $terms   = leaseTermsFromInput($data);
    $current = getTenantCurrentContract($db, $tenantId);

    if ($current && (int) $current['property_id'] === $propertyId) {
        // Stesso immobile: si stanno correggendo i termini di una locazione che
        // esiste gia'. Il controllo di sovrapposizione esclude il contratto
        // stesso, altrimenti si bloccherebbe da solo.
        $contractId = (int) $current['contract_id'];
        assertLeaseFree($db, $propertyId, $terms, $contractId);

        $db->prepare(
            'UPDATE contracts SET start_date = :start_date, end_date = :end_date, monthly_rent = :monthly_rent WHERE id = :id'
        )->execute([
            'start_date'   => $terms['start_date'],
            'end_date'     => $terms['end_date'],
            'monthly_rent' => $terms['monthly_rent'],
            'id'           => $contractId,
        ]);

        // Prorogare la locazione da qui deve produrre le rate dei mesi aggiunti,
        // come dal modulo Contratti: prima questa via spostava end_date e basta,
        // e il canone dei mesi in piu' non veniva mai chiesto a nessuno.
        autoGeneratePaymentSchedule($db, $contractId);
        contractSyncOccupancyForContract($db, $contractId);
        return;
    }

    $propStmt = $db->prepare('SELECT address, city FROM properties WHERE id = :id');
    $propStmt->execute(['id' => $propertyId]);
    $prop  = $propStmt->fetch();
    $title = 'Locazione ' . ($prop ? $prop['address'] . ', ' . $prop['city'] : "immobile #$propertyId");

    // Passa dalle stesse guardie del modulo Contratti: doppia locazione
    // rifiutata, scadenzario generato, immobile portato ad "affittato" e
    // annunci ritirati dai portali.
    try {
        contractCreateLease($db, [
            'property_id'  => $propertyId,
            'tenant_id'    => $tenantId,
            'client_id'    => $clientId,
            'title'        => $title,
            'start_date'   => $terms['start_date'],
            'end_date'     => $terms['end_date'],
            'monthly_rent' => $terms['monthly_rent'],
            'created_by'   => getCurrentAdminId() ?: null,
        ]);
    } catch (LeaseOverlapException $e) {
        apiError($e->getMessage(), 409);
    }
}

/**
 * Il codice fiscale del conduttore, obbligatorio per la registrazione del
 * contratto (RLI).
 *
 * Una PERSONA FISICA ha 16 caratteri alfanumerici. Una persona GIURIDICA ha
 * un codice fiscale numerico di 11 cifre, che di norma coincide con la partita
 * IVA — alcune societa' ne hanno comunque uno a 16.
 *
 * Prima la regola era 16 caratteri e basta, su entrambe le vie: il modulo
 * offriva "persona giuridica" (person_type e' una colonna vera, phase60) ma un
 * conduttore societa' era impossibile da salvare. Offrire una scelta che poi
 * si rifiuta e' peggio che non offrirla.
 *
 * La validazione resta volutamente permissiva sulla forma — scarta i refusi
 * evidenti, non i codici insoliti o esteri.
 */
function assertValidTenantCf(string $cf, array $data): void
{
    $isCompany = trim((string) ($data['person_type'] ?? '')) === 'giuridica';

    if ($isCompany) {
        // 11 cifre (CF numerico / partita IVA) oppure 16 alfanumerici.
        if (!preg_match('/^(\d{11}|[A-Z0-9]{16})$/', $cf)) {
            apiError(
                'Codice Fiscale non valido per una persona giuridica: '
                . 'sono ammessi 11 cifre (codice fiscale o partita IVA) oppure 16 caratteri.'
            );
        }
        return;
    }

    if (!preg_match('/^[A-Z0-9]{16}$/', $cf)) {
        apiError('Codice Fiscale non valido: sono richiesti 16 caratteri (obbligatorio per la registrazione del contratto).');
    }
}

/**
 * Termini della locazione cosi' come li manda il modulo Inquilino.
 *
 * @return array{start_date:?string, end_date:?string, monthly_rent:?float}
 */
function leaseTermsFromInput(array $data): array
{
    return [
        'start_date'   => trim($data['lease_start'] ?? '') ?: null,
        'end_date'     => trim($data['lease_end'] ?? '') ?: null,
        'monthly_rent' => isset($data['monthly_rent']) && $data['monthly_rent'] !== ''
            ? (float) $data['monthly_rent'] : null,
    ];
}

/**
 * Rifiuta con 409 se l'immobile ha gia' una locazione in vigore su quelle date.
 */
function assertLeaseFree(PDO $db, int $propertyId, array $terms, ?int $excludeId = null): void
{
    $conflict = leaseOverlapConflict($db, [
        'contract_type' => 'locazione',
        'status'        => 'signed',
        'property_id'   => $propertyId,
        'start_date'    => $terms['start_date'],
        'end_date'      => $terms['end_date'],
    ], $excludeId);

    if ($conflict) {
        apiError((new LeaseOverlapException($conflict))->getMessage(), 409);
    }
}

/**
 * Parse + validate the extended anagrafica fields (phase60), shared by create
 * and update. Returns normalized column=>value for every key PRESENT in $data
 * (empty strings become NULL). Throws apiError on invalid input. Mirrors the
 * proprietario rules in api/clients.php.
 */
function tenantAnagraficaFields(array $data): array
{
    $out = [];

    $isCompany = null;
    if (array_key_exists('person_type', $data)) {
        $pt = trim((string) $data['person_type']);
        $out['person_type'] = in_array($pt, ['fisica', 'giuridica'], true) ? $pt : 'fisica';
        $isCompany = $out['person_type'] === 'giuridica';
    }
    if (array_key_exists('company_name', $data)) {
        $out['company_name'] = trim((string) $data['company_name']) ?: null;
    }
    if (array_key_exists('vat_number', $data)) {
        $v = strtoupper(trim((string) $data['vat_number'])) ?: null;
        if ($v !== null && !preg_match('/^[A-Z0-9]{8,16}$/', $v)) {
            apiError('Partita IVA non valida (8-16 caratteri alfanumerici).');
        }
        $out['vat_number'] = $v;
    }
    if (array_key_exists('birth_place', $data)) {
        $out['birth_place'] = trim((string) $data['birth_place']) ?: null;
    }
    if (array_key_exists('birth_date', $data)) {
        $bd = trim((string) $data['birth_date']) ?: null;
        if ($bd !== null) {
            $d = DateTime::createFromFormat('Y-m-d', $bd);
            if (!$d || $d->format('Y-m-d') !== $bd) {
                apiError('Data di nascita non valida.');
            }
        }
        $out['birth_date'] = $bd;
    }
    if (array_key_exists('pec_email', $data)) {
        $pec = trim((string) $data['pec_email']) ?: null;
        if ($pec !== null && !filter_var($pec, FILTER_VALIDATE_EMAIL)) {
            apiError('Indirizzo PEC non valido.');
        }
        $out['pec_email'] = $pec;
    }
    if (array_key_exists('address', $data))  $out['address']  = trim((string) $data['address']) ?: null;
    if (array_key_exists('city', $data))     $out['city']     = trim((string) $data['city']) ?: null;
    if (array_key_exists('cap', $data))      $out['cap']      = trim((string) $data['cap']) ?: null;
    if (array_key_exists('province', $data)) $out['province'] = strtoupper(trim((string) $data['province'])) ?: null;

    // Ragione sociale obbligatoria quando il conduttore è una persona giuridica.
    if ($isCompany === true && ($out['company_name'] ?? null) === null) {
        apiError('La ragione sociale è obbligatoria per le persone giuridiche.');
    }

    return $out;
}

function archiveTenant(PDO $db, int $id): void
{
    $db->prepare("UPDATE tenants SET status = 'archived' WHERE id = :id")->execute(['id' => $id]);
    logActivity('delete', 'tenant', $id, 'Inquilino archiviato #' . $id);
    apiSuccess(['archived' => true]);
}

function tenantHasPortal(PDO $db, int $tenantId): bool
{
    $stmt = $db->prepare('SELECT id FROM tenant_users WHERE tenant_id = :id');
    $stmt->execute(['id' => $tenantId]);
    return (bool) $stmt->fetch();
}

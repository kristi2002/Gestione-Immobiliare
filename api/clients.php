<?php
/**
 * Clients (Proprietari) CRUD API.
 *
 * GET    /api/clients.php              — list (search, status filter)
 * GET    /api/clients.php?id={id}      — single client
 * POST   /api/clients.php              — create
 * PUT    /api/clients.php?id={id}      — update
 * DELETE /api/clients.php?id={id}      — archive (soft delete)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/consent.php';

apiHandleOptions();

const CLIENT_STATUSES = ['active', 'inactive', 'archived'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            if (($_GET['format'] ?? '') === 'csv') {
                exportClientsCsv($db);
            }
            if (($_GET['action'] ?? '') === 'stats') {
                clientStats($db);
            }
            if (($_GET['action'] ?? '') === 'agents') {
                listAgents($db);
            }
            if (($_GET['action'] ?? '') === 'check_duplicate') {
                checkDuplicate($db);
            }
            $id ? getClient($db, $id) : listClients($db);
            break;
        case 'POST':
            if (($_GET['action'] ?? '') === 'import') {
                importClients($db);
            }
            if (($_GET['action'] ?? '') === 'merge') {
                mergeClients($db);
            }
            createClient($db);
            break;
        case 'PUT':
            if (!$id) {
                apiError('ID proprietario mancante.');
            }
            updateClient($db, $id);
            break;
        case 'DELETE':
            if (!$id) {
                apiError('ID proprietario mancante.');
            }
            deleteClient($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        if (str_contains($e->getMessage(), 'uq_clients_cf')) {
            apiError('Esiste già un proprietario con questo codice fiscale.');
        }
        apiError('Operazione non consentita: esistono record collegati a questo proprietario. Rimuoverli prima di procedere.', 409);
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function clientStats(PDO $db): void
{
    $total = (int) $db->query("SELECT COUNT(*) FROM clients WHERE status != 'archived'")->fetchColumn();
    $withProperties = (int) $db->query(
        "SELECT COUNT(DISTINCT c.id) FROM clients c
         JOIN properties p ON p.client_id = c.id AND p.status != 'archived'
         WHERE c.status != 'archived'"
    )->fetchColumn();
    $newMonth = (int) $db->query(
        "SELECT COUNT(*) FROM clients
         WHERE status != 'archived'
           AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"
    )->fetchColumn();
    $active = (int) $db->query("SELECT COUNT(*) FROM clients WHERE status = 'active'")->fetchColumn();

    apiSuccess([
        'total'           => $total,
        'with_properties' => $withProperties,
        'new_month'       => $newMonth,
        'active'          => $active,
    ]);
}

function listClients(PDO $db): void
{
    // Tetto a 500 come properties.php/leads.php, e non per simmetria estetica:
    // questo endpoint alimenta anche le TENDINE "Proprietario" (contratto,
    // fattura, spesa, immobile, edificio... dodici viste in tutto), che chiedono
    // limit=500 in una sola richiesta. Col tetto di default a 100, un'agenzia con
    // piu' di cento anagrafiche non riusciva piu' a selezionare i proprietari
    // oltre il centesimo in ordine alfabetico: non un errore, semplicemente
    // assenti dall'elenco. La lista paginata continua a chiedere 25 per pagina.
    $pagination = apiGetPagination(25, 500);
    $search = trim($_GET['search'] ?? '');
    $status = trim($_GET['status'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $frag = apiWordSearch($search, ['c.name', 'c.surname', 'c.email', 'c.phone', 'c.codice_fiscale', 'c.internal_notes'], $params);
        if ($frag) $where .= " AND $frag";
    }

    if (isset($_GET['assigned_agent_id']) && (int) $_GET['assigned_agent_id'] > 0) {
        $where .= ' AND c.assigned_agent_id = :assigned_agent_id';
        $params['assigned_agent_id'] = (int) $_GET['assigned_agent_id'];
    }
    if ($status !== '' && in_array($status, CLIENT_STATUSES, true)) {
        $where .= ' AND c.status = :status';
        $params['status'] = $status;
    } else {
        $where .= " AND c.status != 'archived'";
    }

    $countSql = "SELECT COUNT(*) FROM clients c $where";

    $dataSql = "SELECT c.id, c.name, c.surname, c.codice_fiscale, c.phone, c.email,
                   c.internal_notes, c.creation_date, c.status, c.assigned_agent_id,
                   a.username AS agent_name,
                   COUNT(p.id) AS property_count
            FROM clients c
            LEFT JOIN properties p ON p.client_id = c.id AND p.status != 'archived'
            LEFT JOIN admin_users a ON a.id = c.assigned_agent_id
            $where
            GROUP BY c.id ORDER BY c.surname ASC, c.name ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getClient(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT c.*, a.username AS agent_name, COUNT(p.id) AS property_count
         FROM clients c
         LEFT JOIN properties p ON p.client_id = c.id AND p.status != 'archived'
         LEFT JOIN admin_users a ON a.id = c.assigned_agent_id
         WHERE c.id = :id
         GROUP BY c.id"
    );
    $stmt->execute(['id' => $id]);
    $client = $stmt->fetch();

    if (!$client) {
        apiError('Proprietario non trovato.', 404);
    }

    // `SELECT c.*` porta con sé anche portal_password_hash. Finché nessun
    // proprietario ha un accesso al portale il campo è NULL e non si nota, ma
    // appena se ne attiva uno quell'hash argon2id parte verso il browser a ogni
    // apertura della scheda — leggibile da chiunque possa aprirla, ruoli agent e
    // readonly compresi, e attaccabile con comodo fuori linea. Alla scheda serve
    // sapere SE l'accesso esiste, non com'è fatto.
    $client['portal_enabled'] = !empty($client['portal_password_hash']);
    unset($client['portal_password_hash']);

    // Il form ragiona per sì/no, la tabella conserva una data. La verità sta nel
    // registro dei consensi (una revoca dal link di disiscrizione la scrive lì),
    // quindi il valore mostrato si legge da lì e non dalla colonna.
    $client['marketing_consent'] = consentGranted($db, 'client', $id);

    apiSuccess($client);
}

function createClient(PDO $db): void
{
    $data = apiGetJsonBody();
    $validated = validateClientInput($db, $data);

    $stmt = $db->prepare(
        "INSERT INTO clients
            (name, surname, person_type, company_name, vat_number, codice_fiscale,
             birth_place, birth_date, phone, email, pec_email,
             address, city, cap, province, internal_notes, status, assigned_agent_id)
         VALUES
            (:name, :surname, :person_type, :company_name, :vat_number, :codice_fiscale,
             :birth_place, :birth_date, :phone, :email, :pec_email,
             :address, :city, :cap, :province, :internal_notes, :status, :assigned_agent_id)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    consentApplyFromInput($db, 'client', $newId, $data);
    logActivity('create', 'client', $newId, 'Proprietario creato: ' . trim(($validated['name'] ?? '') . ' ' . ($validated['surname'] ?? '')));
    getClient($db, $newId);
}

function updateClient(PDO $db, int $id): void
{
    $existing = fetchClientById($db, $id);
    if (!$existing) {
        apiError('Proprietario non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateClientInput($db, $data);

    $sql = "UPDATE clients
         SET name = :name, surname = :surname, person_type = :person_type,
             company_name = :company_name, vat_number = :vat_number, codice_fiscale = :codice_fiscale,
             birth_place = :birth_place, birth_date = :birth_date,
             phone = :phone, email = :email, pec_email = :pec_email,
             address = :address, city = :city, cap = :cap, province = :province,
             internal_notes = :internal_notes, status = :status, assigned_agent_id = :assigned_agent_id";
    $params = array_merge($validated, ['id' => $id]);

    // `portal_email` non fa parte dell'anagrafica: si imposta dalla scheda del
    // proprietario, riquadro "Portale". Il pulsante "Salva indirizzo" lo mandava
    // gia', ma questa UPDATE non lo elencava: la chiamata rispondeva success,
    // la scheda diceva "Indirizzo del portale salvato" e in tabella non
    // cambiava niente — l'accesso al portale restava sul vecchio indirizzo.
    //
    // Non basta aggiungerlo all'elenco fisso: questo endpoint sovrascrive per
    // intero le colonne che nomina, e il modulo del proprietario
    // (assets/js/client_edit.js) NON manda portal_email. Finirebbe azzerato a
    // ogni salvataggio dell'anagrafica, cioe' un utente perderebbe l'accesso al
    // portale per aver corretto un numero di telefono. Si aggiorna quindi solo
    // se la chiave e' presente nel corpo della richiesta.
    if (array_key_exists('portal_email', $data)) {
        $portalEmail = trim((string) ($data['portal_email'] ?? ''));

        if ($portalEmail === '') {
            $portalEmail = null;
        } elseif (!filter_var($portalEmail, FILTER_VALIDATE_EMAIL)) {
            apiError('Indirizzo del portale non valido.');
        } else {
            // owner/auth.php:66 autentica con `WHERE portal_email = :email` e
            // prende la prima riga: su un indirizzo condiviso l'accesso sarebbe
            // ambiguo e finirebbe nella scheda del proprietario sbagliato.
            // Non c'e' un indice unico in tabella, quindi il controllo va qui.
            $dup = $db->prepare(
                "SELECT id FROM clients
                  WHERE portal_email = :email AND id != :id AND status != 'archived'
                  LIMIT 1"
            );
            $dup->execute(['email' => $portalEmail, 'id' => $id]);
            if ($dup->fetch()) {
                apiError('Questo indirizzo è già usato per l\'accesso al portale da un altro proprietario.', 409);
            }
        }

        $sql .= ", portal_email = :portal_email";
        $params['portal_email'] = $portalEmail;
    }

    $sql .= " WHERE id = :id";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    consentApplyFromInput($db, 'client', $id, $data);
    logActivity('update', 'client', $id, 'Proprietario aggiornato #' . $id);
    getClient($db, $id);
}

function deleteClient(PDO $db, int $id): void
{
    $existing = fetchClientById($db, $id);
    if (!$existing) {
        apiError('Proprietario non trovato.', 404);
    }

    // Soft-delete: archive the client
    $stmt = $db->prepare("UPDATE clients SET status = 'archived' WHERE id = :id");
    $stmt->execute(['id' => $id]);

    logActivity('delete', 'client', $id, 'Proprietario archiviato #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Proprietario archiviato.']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateClientInput(PDO $db, array $data): array
{
    $name    = trim($data['name'] ?? '');
    $surname = trim($data['surname'] ?? '');
    $cf      = strtoupper(trim($data['codice_fiscale'] ?? '')) ?: null;
    $phone   = trim($data['phone'] ?? '') ?: null;
    $email   = trim($data['email'] ?? '') ?: null;
    $notes   = trim($data['internal_notes'] ?? '') ?: null;
    $status  = trim($data['status'] ?? 'active');

    // Anagrafica estesa (phase59): natura del soggetto, nascita, residenza.
    $personType  = trim($data['person_type'] ?? 'fisica');
    if (!in_array($personType, ['fisica', 'giuridica'], true)) {
        $personType = 'fisica';
    }
    $companyName = trim($data['company_name'] ?? '') ?: null;
    $vat         = strtoupper(trim($data['vat_number'] ?? '')) ?: null;
    $pec         = trim($data['pec_email'] ?? '') ?: null;
    $birthPlace  = trim($data['birth_place'] ?? '') ?: null;
    $birthDate   = trim($data['birth_date'] ?? '') ?: null;
    $address     = trim($data['address'] ?? '') ?: null;
    $city        = trim($data['city'] ?? '') ?: null;
    $cap         = trim($data['cap'] ?? '') ?: null;
    $province    = strtoupper(trim($data['province'] ?? '')) ?: null;

    $agentId = $data['assigned_agent_id'] ?? null;
    if ($agentId === '' || $agentId === 0 || $agentId === '0') {
        $agentId = null;
    }
    if ($agentId !== null) {
        $agentId = (int) $agentId;
        $chk = $db->prepare(
            "SELECT 1 FROM admin_users
             WHERE id = :id AND is_active = 1 AND role IN ('super_admin','admin','agent')"
        );
        $chk->execute(['id' => $agentId]);
        if (!$chk->fetchColumn()) {
            apiError('Agente di riferimento non valido.');
        }
    }

    if ($name === '') {
        apiError('Il nome è obbligatorio.');
    }
    if ($surname === '') {
        apiError('Il cognome è obbligatorio.');
    }
    if ($cf === null) {
        apiError('Il codice fiscale è obbligatorio.');
    }
    if (!preg_match('/^[A-Z0-9]{11,16}$/', $cf)) {
        apiError('Codice fiscale non valido (11-16 caratteri alfanumerici).');
    }
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiError('Indirizzo email non valido.');
    }
    if (!in_array($status, CLIENT_STATUSES, true)) {
        apiError('Stato non valido.');
    }
    if ($personType === 'giuridica' && $companyName === null) {
        apiError('La ragione sociale è obbligatoria per le persone giuridiche.');
    }
    if ($pec !== null && !filter_var($pec, FILTER_VALIDATE_EMAIL)) {
        apiError('Indirizzo PEC non valido.');
    }
    if ($vat !== null && !preg_match('/^[A-Z0-9]{8,16}$/', $vat)) {
        apiError('Partita IVA non valida (8-16 caratteri alfanumerici).');
    }
    if ($birthDate !== null) {
        $d = DateTime::createFromFormat('Y-m-d', $birthDate);
        if (!$d || $d->format('Y-m-d') !== $birthDate) {
            apiError('Data di nascita non valida.');
        }
    }

    return [
        'name'              => $name,
        'surname'           => $surname,
        'person_type'       => $personType,
        'company_name'      => $companyName,
        'vat_number'        => $vat,
        'codice_fiscale'    => $cf,
        'birth_place'       => $birthPlace,
        'birth_date'        => $birthDate,
        'phone'             => $phone,
        'email'             => $email,
        'pec_email'         => $pec,
        'address'           => $address,
        'city'              => $city,
        'cap'               => $cap,
        'province'          => $province,
        'internal_notes'    => $notes,
        'status'            => $status,
        'assigned_agent_id' => $agentId,
    ];
}

/**
 * Active agents (admin_users) selectable as an owner's "Agente Ref.".
 */
function listAgents(PDO $db): void
{
    $rows = $db->query(
        "SELECT id, username, role FROM admin_users
         WHERE is_active = 1 AND role IN ('super_admin','admin','agent')
         ORDER BY username ASC"
    )->fetchAll();
    apiSuccess($rows);
}

// ---------------------------------------------------------------------------
// Anti-duplicati
// ---------------------------------------------------------------------------

/**
 * GET ?action=check_duplicate&name=&surname=&email=&phone=&codice_fiscale=&exclude_id=
 *
 * Cerca anagrafiche che potrebbero essere la stessa persona PRIMA di crearne
 * un'altra. Serve perché l'unicità del codice fiscale non basta: i record
 * storici (e le righe importate da CSV, che il CF non ce l'hanno proprio)
 * possono duplicare la stessa persona all'infinito, e ogni duplicato si porta
 * dietro i suoi immobili, contratti e comunicazioni — che è esattamente come
 * lo stesso proprietario finisce elencato tre volte in Comunicazioni.
 *
 * Non blocca nulla: restituisce i candidati, la decisione resta all'agente.
 */
function checkDuplicate(PDO $db): void
{
    $name      = trim($_GET['name'] ?? '');
    $surname   = trim($_GET['surname'] ?? '');
    $email     = trim($_GET['email'] ?? '');
    $phone     = preg_replace('/\D+/', '', trim($_GET['phone'] ?? ''));
    $cf        = strtoupper(trim($_GET['codice_fiscale'] ?? ''));
    $excludeId = (int) ($_GET['exclude_id'] ?? 0);

    $clauses = [];
    $params  = [];

    if ($cf !== '') {
        $clauses[] = 'c.codice_fiscale = :cf';
        $params['cf'] = $cf;
    }
    if ($email !== '') {
        $clauses[] = 'LOWER(c.email) = LOWER(:email)';
        $params['email'] = $email;
    }
    if (strlen($phone) >= 6) {
        // Confronto sulle ultime 9 cifre: +39 335..., 0039 335..., 335... sono
        // lo stesso numero scritto in tre modi.
        $clauses[] = "RIGHT(REGEXP_REPLACE(COALESCE(c.phone,''), '[^0-9]', ''), 9) = :phone9";
        $params['phone9'] = substr($phone, -9);
    }
    if ($name !== '' && $surname !== '') {
        $clauses[] = '(LOWER(c.name) = LOWER(:dname) AND LOWER(c.surname) = LOWER(:dsurname))';
        $params['dname']    = $name;
        $params['dsurname'] = $surname;
    }

    if (!$clauses) {
        apiSuccess(['matches' => []]);
    }

    $where = '(' . implode(' OR ', $clauses) . ')';
    if ($excludeId > 0) {
        $where .= ' AND c.id <> :exclude_id';
        $params['exclude_id'] = $excludeId;
    }

    $stmt = $db->prepare(
        "SELECT c.id, c.name, c.surname, c.email, c.phone, c.codice_fiscale, c.status,
                COUNT(p.id) AS property_count
           FROM clients c
           LEFT JOIN properties p ON p.client_id = c.id AND p.status != 'archived'
          WHERE $where
          GROUP BY c.id
          ORDER BY c.status = 'archived', c.surname ASC, c.name ASC
          LIMIT 10"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Motivo della corrispondenza: senza questo l'agente vede un nome e non sa
    // se è un omonimo o davvero lo stesso contatto.
    foreach ($rows as &$row) {
        $reasons = [];
        if ($cf !== '' && strtoupper((string) $row['codice_fiscale']) === $cf) {
            $reasons[] = 'codice fiscale';
        }
        if ($email !== '' && strcasecmp((string) $row['email'], $email) === 0) {
            $reasons[] = 'email';
        }
        $rowPhone = preg_replace('/\D+/', '', (string) $row['phone']);
        if (strlen($phone) >= 6 && $rowPhone !== '' && substr($rowPhone, -9) === substr($phone, -9)) {
            $reasons[] = 'telefono';
        }
        if ($name !== '' && $surname !== ''
            && strcasecmp((string) $row['name'], $name) === 0
            && strcasecmp((string) $row['surname'], $surname) === 0) {
            $reasons[] = 'nome e cognome';
        }
        $row['match_reasons'] = $reasons;
    }
    unset($row);

    apiSuccess(['matches' => $rows]);
}

/**
 * POST ?action=merge  { source_id, target_id }
 *
 * Unisce due anagrafiche duplicate: TUTTE le righe che puntano a source_id
 * vengono riassegnate a target_id, i campi vuoti del target vengono riempiti
 * con quelli del source, e il source viene archiviato (mai cancellato: la
 * cronologia di chi ha fatto cosa resta leggibile).
 *
 * Le tabelle da riassegnare NON sono una lista scritta a mano: vengono lette
 * da information_schema, così una futura tabella con una FK verso clients
 * viene inclusa automaticamente invece di lasciare righe orfane.
 */
function mergeClients(PDO $db): void
{
    requireRole('super_admin', 'admin');

    $data     = apiGetJsonBody();
    $sourceId = (int) ($data['source_id'] ?? 0);
    $targetId = (int) ($data['target_id'] ?? 0);

    if ($sourceId <= 0 || $targetId <= 0) {
        apiError('Servono sia il proprietario da unire sia quello di destinazione.');
    }
    if ($sourceId === $targetId) {
        apiError('Non è possibile unire un proprietario con se stesso.');
    }

    $stmt = $db->prepare("SELECT * FROM clients WHERE id IN (:a, :b)");
    $stmt->execute(['a' => $sourceId, 'b' => $targetId]);
    $found = [];
    foreach ($stmt->fetchAll() as $row) {
        $found[(int) $row['id']] = $row;
    }
    if (!isset($found[$sourceId]) || !isset($found[$targetId])) {
        apiError('Proprietario non trovato.', 404);
    }

    $source = $found[$sourceId];
    $target = $found[$targetId];

    // Tabelle referenzianti, lette dallo schema (non da input utente).
    $fkStmt = $db->prepare(
        "SELECT TABLE_NAME, COLUMN_NAME
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND REFERENCED_TABLE_NAME = 'clients'
            AND REFERENCED_COLUMN_NAME = 'id'"
    );
    $fkStmt->execute();
    $refs = $fkStmt->fetchAll();

    $moved = [];

    try {
        $db->beginTransaction();

        foreach ($refs as $ref) {
            $table  = (string) $ref['TABLE_NAME'];
            $column = (string) $ref['COLUMN_NAME'];
            // Cintura e bretelle: i nomi arrivano dallo schema, ma finiscono
            // interpolati nella query, quindi vanno comunque validati.
            if (!preg_match('/^[A-Za-z0-9_]+$/', $table) || !preg_match('/^[A-Za-z0-9_]+$/', $column)) {
                continue;
            }
            if ($table === 'clients') {
                continue;
            }

            $upd = $db->prepare("UPDATE `{$table}` SET `{$column}` = :target WHERE `{$column}` = :source");
            $upd->execute(['target' => $targetId, 'source' => $sourceId]);
            if ($upd->rowCount() > 0) {
                $moved[$table] = ($moved[$table] ?? 0) + $upd->rowCount();
            }
        }

        // Il duplicato viene archiviato PRIMA di travasarne i dati, non dopo:
        // il codice fiscale ha un indice unico, quindi copiarlo sul superstite
        // mentre il duplicato lo detiene ancora fa scattare un 1062 e annulla
        // l'intera unione (verificato: "Duplicate entry ... for uq_clients_cf").
        $db->prepare(
            "UPDATE clients
                SET status = 'archived', codice_fiscale = NULL,
                    internal_notes = CONCAT(COALESCE(internal_notes, ''), :note)
              WHERE id = :id"
        )->execute([
            'note' => "\nUnito nel proprietario #" . $targetId . ' il ' . date('d/m/Y') . '.',
            'id'   => $sourceId,
        ]);

        // Il target eredita i dati che gli mancano, così unire non perde
        // l'email o il telefono che erano solo sul duplicato. I valori vengono
        // dallo snapshot $source letto all'inizio, non dalla riga appena
        // archiviata.
        $fillable = [
            'codice_fiscale', 'phone', 'email', 'pec_email', 'vat_number', 'company_name',
            'birth_place', 'birth_date', 'address', 'city', 'cap', 'province', 'assigned_agent_id',
        ];
        $sets   = [];
        $params = ['id' => $targetId];
        foreach ($fillable as $field) {
            if (!array_key_exists($field, $target)) {
                continue; // colonna non presente su installazioni non migrate
            }
            $targetVal = $target[$field];
            $sourceVal = $source[$field] ?? null;
            if (($targetVal === null || $targetVal === '') && $sourceVal !== null && $sourceVal !== '') {
                $sets[] = "`{$field}` = :{$field}";
                $params[$field] = $sourceVal;
            }
        }

        $noteLine = 'Unito il ' . date('d/m/Y') . ' con il proprietario duplicato #' . $sourceId
            . ' (' . trim(($source['name'] ?? '') . ' ' . ($source['surname'] ?? '')) . ').';
        $sourceNotes = trim((string) ($source['internal_notes'] ?? ''));
        $mergedNotes = trim((string) ($target['internal_notes'] ?? ''));
        $mergedNotes = trim($mergedNotes . "\n" . $noteLine . ($sourceNotes !== '' ? "\nNote dal duplicato: " . $sourceNotes : ''));
        $sets[] = '`internal_notes` = :internal_notes';
        $params['internal_notes'] = $mergedNotes;

        $db->prepare('UPDATE clients SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);

        $db->commit();
    } catch (PDOException $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        if ($e->getCode() === '23000') {
            apiError('Unione annullata: un vincolo di unicità impedisce di spostare tutte le righe (probabilmente un record collegato a entrambi i proprietari). Nessuna modifica è stata salvata.', 409);
        }
        throw $e;
    }

    $summary = [];
    foreach ($moved as $table => $count) {
        $summary[] = "{$table}: {$count}";
    }
    logActivity('update', 'client', $targetId,
        "Unione proprietari: #{$sourceId} → #{$targetId}" . ($summary ? ' (' . implode(', ', $summary) . ')' : ''));

    apiSuccess([
        'target_id' => $targetId,
        'source_id' => $sourceId,
        'moved'     => $moved,
        'message'   => 'Proprietari uniti. Il duplicato #' . $sourceId . ' è stato archiviato.',
    ]);
}

function fetchClientById(PDO $db, int $id): ?array
{
    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------

function exportClientsCsv(PDO $db): void
{
    $sql    = "SELECT name, surname, phone, email, status
               FROM clients WHERE status != 'archived'";
    $params = [];

    // Optional selection: ?ids=1,2,3 exports only those rows (bulk "Esporta
    // selezionati"). Without it, export the full non-archived owner list.
    $idsRaw = trim($_GET['ids'] ?? '');
    if ($idsRaw !== '') {
        $ids = array_values(array_filter(array_map('intval', explode(',', $idsRaw)), fn($i) => $i > 0));
        if (!empty($ids)) {
            $sql   .= ' AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
            $params = $ids;
        }
    }

    $sql .= ' ORDER BY surname ASC, name ASC';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="proprietari_' . date('Ymd') . '.csv"');

    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel
    csvRow($out, ['nome', 'cognome', 'telefono', 'email', 'stato']);
    foreach ($rows as $r) {
        csvRow($out, [$r['name'], $r['surname'], $r['phone'], $r['email'], $r['status']]);
    }
    fclose($out);
    exit;
}

function importClients(PDO $db): void
{
    $data = apiGetJsonBody();
    $rows = $data['rows'] ?? [];
    if (!is_array($rows) || empty($rows)) {
        apiError('Nessuna riga da importare.');
    }

    // Import "forzato": l'agente ha visto l'elenco degli scarti e conferma che
    // sono persone diverse (due fratelli allo stesso indirizzo email di casa).
    $force = !empty($data['force']);

    $imported = 0;
    $errors   = [];
    $skipped  = [];
    $stmt = $db->prepare(
        "INSERT INTO clients (name, surname, phone, email, status)
         VALUES (:name, :surname, :phone, :email, :status)"
    );

    // Questo percorso non passa da validateClientInput e non scrive il codice
    // fiscale, quindi l'indice unico uq_clients_cf non lo protegge: senza il
    // controllo qui sotto, reimportare due volte lo stesso file crea due copie
    // di ogni proprietario. È l'origine più probabile dei duplicati esistenti.
    $dupStmt = $db->prepare(
        "SELECT id, name, surname FROM clients
          WHERE (LOWER(name) = LOWER(:name) AND LOWER(surname) = LOWER(:surname))
             OR (:email <> '' AND LOWER(email) = LOWER(:email))
             OR (:phone9 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', ''), 9) = :phone9)
          LIMIT 1"
    );

    // Anche i doppioni interni al file vanno intercettati: capita spesso che lo
    // stesso contatto compaia due volte nell'export del gestionale precedente.
    $seen = [];

    foreach ($rows as $i => $row) {
        $name    = trim((string) ($row['nome'] ?? ''));
        $surname = trim((string) ($row['cognome'] ?? ''));
        $phone   = trim((string) ($row['telefono'] ?? '')) ?: null;
        $email   = trim((string) ($row['email'] ?? '')) ?: null;
        $status  = trim((string) ($row['stato'] ?? 'active'));

        if ($name === '' || $surname === '') {
            $errors[] = 'Riga ' . ($i + 1) . ': nome/cognome mancante.';
            continue;
        }
        if (!in_array($status, CLIENT_STATUSES, true)) {
            $status = 'active';
        }
        if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $email = null;
        }

        if (!$force) {
            $key = mb_strtolower($surname . '|' . $name);
            if (isset($seen[$key])) {
                $skipped[] = 'Riga ' . ($i + 1) . ": {$name} {$surname} — duplicato all'interno del file stesso.";
                continue;
            }
            $seen[$key] = true;

            $phone9 = substr(preg_replace('/\D+/', '', (string) $phone), -9);
            $dupStmt->execute([
                'name'    => $name,
                'surname' => $surname,
                'email'   => (string) $email,
                'phone9'  => strlen($phone9) >= 6 ? $phone9 : '',
            ]);
            $existing = $dupStmt->fetch();
            if ($existing) {
                $skipped[] = 'Riga ' . ($i + 1) . ": {$name} {$surname} — già presente come #{$existing['id']}.";
                continue;
            }
        }

        $stmt->execute([
            'name' => $name, 'surname' => $surname,
            'phone' => $phone, 'email' => $email, 'status' => $status,
        ]);
        $imported++;
    }

    apiSuccess([
        'imported' => $imported,
        'errors'   => $errors,
        'skipped'  => $skipped,
    ]);
}

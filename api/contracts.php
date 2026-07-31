<?php
/**
 * Contracts (Contratti) CRUD API — lifecycle management.
 *
 * GET    /api/contracts.php                       — list (property_id, status, type)
 * GET    /api/contracts.php?id={id}               — single contract
 * POST   /api/contracts.php                       — create
 * PUT    /api/contracts.php?id={id}               — update
 * DELETE /api/contracts.php?id={id}               — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
requireViewAccess('contracts');

const CONTRACT_TYPES    = ['locazione', 'compravendita', 'preliminare', 'mandato', 'altro'];
const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'expired', 'cancelled'];

/**
 * Il tipo di contratto decide QUALE campo economico ha senso, e i due non
 * convivono mai: un canone mensile su una compravendita e' sempre un errore di
 * inserimento, un prezzo di vendita su una locazione pure.
 *
 * `mandato` sta con le vendite perche' l'incarico porta il prezzo richiesto;
 * `altro` non sta in nessuno dei due gruppi di proposito — e' la casella per i
 * casi che non abbiamo previsto, e li' l'agente deve poter compilare entrambi
 * senza che il sistema decida al posto suo.
 */
const CONTRACT_RENTAL_TYPES = ['locazione'];
const CONTRACT_SALE_TYPES   = ['compravendita', 'preliminare', 'mandato'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $action = trim($_GET['action'] ?? '');
            if ($action === 'istat_adjustment') {
                if (!$id) apiError('ID contratto mancante.');
                istatAdjustment($db, $id);
            } elseif ($id) {
                getContract($db, $id);
            } else {
                listContracts($db);
            }
            break;
        case 'POST':
            $action = trim($_GET['action'] ?? '');
            if ($action === 'generate_payments') {
                if (!$id) apiError('ID contratto mancante.');
                generatePayments($db, $id);
            } else {
                createContract($db);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID contratto mancante.');
            if (trim($_GET['action'] ?? '') === 'set_status') {
                setContractStatus($db, $id);
            } else {
                updateContract($db, $id);
            }
            break;
        case 'DELETE':
            if (!$id) apiError('ID contratto mancante.');
            deleteContract($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    // SQLSTATE 23000 is "integrity constraint violation" — which covers foreign
    // keys BUT ALSO NOT NULL (1048) and duplicate keys (1062). Reporting all of
    // them as "esistono record collegati" is what hid the Automatico bug for so
    // long: a NULL-into-NOT-NULL insert was reported as a foreign-key problem,
    // pointing at the wrong cause entirely. Split on the driver error code.
    if ($e->getCode() === '23000') {
        $driverCode = (int) ($e->errorInfo[1] ?? 0);
        if ($driverCode === 1451 || $driverCode === 1452) {
            apiError('Operazione non consentita: esistono record collegati a questo contratto. Rimuoverli prima di procedere.', 409);
        }
        if ($driverCode === 1062) {
            apiError('Esiste già un contratto con questi dati.', 409);
        }
        if ($driverCode === 1048) {
            apiError('Dati incompleti: un campo obbligatorio del contratto è vuoto.', 400);
        }
        apiError('Operazione non consentita: vincolo di integrità violato.', 409);
    }
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listContracts(PDO $db): void
{
    $pagination = apiGetPagination();
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $clientId   = isset($_GET['client_id'])   ? (int) $_GET['client_id']   : null;
    $tenantId   = isset($_GET['tenant_id'])   ? (int) $_GET['tenant_id']   : null;
    $status     = trim($_GET['status'] ?? '');
    $type       = trim($_GET['type'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($propertyId) {
        $where .= ' AND ct.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }
    if ($clientId) {
        $where .= ' AND ct.client_id = :client_id';
        $params['client_id'] = $clientId;
    }
    if ($tenantId) {
        $where .= ' AND ct.tenant_id = :tenant_id';
        $params['tenant_id'] = $tenantId;
    }
    if ($search !== '') {
        $frag = apiWordSearch($search, ['p.address', 'p.city', 't.name', 't.surname', 'c.name', 'c.surname', 'ct.title'], $params);
        if ($frag) $where .= " AND $frag";
    }
    if ($status !== '' && in_array($status, CONTRACT_STATUSES, true)) {
        $where .= ' AND ct.status = :status';
        $params['status'] = $status;
        // Time-aware state: a contract past its end date counts as "Scaduto", so it
        // should NOT show under draft/sent/signed — only under the "Scaduti" filter.
        if ($status !== 'cancelled' && $status !== 'expired') {
            $where .= " AND (ct.end_date IS NULL OR ct.end_date >= CURDATE())";
        }
    }
    if ($type !== '' && in_array($type, CONTRACT_TYPES, true)) {
        $where .= ' AND ct.contract_type = :type';
        $params['type'] = $type;
    }
    // Dedicated "Scaduti" filter: contracts past their end date (not cancelled).
    // (ct.status can be NULL for "Automatico" contracts, so guard the != comparison.)
    if (($_GET['expired'] ?? '') === '1') {
        $where .= " AND ct.end_date IS NOT NULL AND ct.end_date < CURDATE()
                    AND (ct.status IS NULL OR ct.status <> 'cancelled')";
    }
    // "Attivi" filter: in force today — Automatico (NULL) or Firmato, within the
    // date range (or open-ended) and not yet past the end date, and not cancelled.
    if (($_GET['active'] ?? '') === '1') {
        $where .= " AND (ct.status IS NULL OR ct.status = 'signed')
                    AND (ct.end_date IS NULL OR ct.end_date >= CURDATE())";
    }

    $countSql = "SELECT COUNT(*) FROM contracts ct
                 INNER JOIN properties p ON p.id = ct.property_id
                 LEFT JOIN tenants t ON t.id = ct.tenant_id
                 LEFT JOIN clients c ON c.id = ct.client_id
                 $where";

    $dataSql = "SELECT ct.*, p.address AS property_address, p.city AS property_city,
                   t.name AS tenant_name, t.surname AS tenant_surname,
                   c.name AS client_name, c.surname AS client_surname
            FROM contracts ct
            INNER JOIN properties p ON p.id = ct.property_id
            LEFT JOIN tenants t ON t.id = ct.tenant_id
            LEFT JOIN clients c ON c.id = ct.client_id
            $where
            ORDER BY ct.created_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getContract(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT ct.*, p.address AS property_address, p.city AS property_city,
                t.name AS tenant_name, t.surname AS tenant_surname,
                c.name AS client_name, c.surname AS client_surname
         FROM contracts ct
         INNER JOIN properties p ON p.id = ct.property_id
         LEFT JOIN tenants t ON t.id = ct.tenant_id
         LEFT JOIN clients c ON c.id = ct.client_id
         WHERE ct.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Contratto non trovato.', 404);
    }

    apiSuccess($row);
}

function createContract(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateContractInput($data);
    assertNoOverlappingLease($db, $validated);
    $validated['created_by'] = getCurrentAdminId() ?: null;

    $stmt = $db->prepare(
        "INSERT INTO contracts
            (property_id, tenant_id, client_id, title, contract_type, contract_subtype, status,
             start_date, end_date, monthly_rent, sale_price, deposit, notes,
             registration_number, registration_date, registration_office, cedolare_secca,
             registration_tax_annual, stamp_duty, imposta_registro_due_date,
             istat_update_enabled, istat_baseline_index, istat_baseline_month, last_istat_update, created_by)
         VALUES
            (:property_id, :tenant_id, :client_id, :title, :contract_type, :contract_subtype, :status,
             :start_date, :end_date, :monthly_rent, :sale_price, :deposit, :notes,
             :registration_number, :registration_date, :registration_office, :cedolare_secca,
             :registration_tax_annual, :stamp_duty, :imposta_registro_due_date,
             :istat_update_enabled, :istat_baseline_index, :istat_baseline_month, :last_istat_update, :created_by)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'contract', $newId, 'Contratto creato: ' . $validated['title']);

    // A signed lease with rent + dates gets its scadenzario immediately; without
    // this the contract exists but the payments module knows nothing about it
    // until someone remembers to press "Genera scadenzario".
    autoGeneratePaymentSchedule($db, $newId);
    syncPropertyOccupancy($db, $newId);

    getContract($db, $newId);
}

function updateContract(PDO $db, int $id): void
{
    if (!contractExists($db, $id)) {
        apiError('Contratto non trovato.', 404);
    }

    $data      = apiGetJsonBody();
    $validated = validateContractInput($data);
    assertNoOverlappingLease($db, $validated, $id);

    $stmt = $db->prepare(
        "UPDATE contracts
         SET property_id = :property_id, tenant_id = :tenant_id, client_id = :client_id,
             title = :title, contract_type = :contract_type, contract_subtype = :contract_subtype,
             status = :status,
             start_date = :start_date, end_date = :end_date, monthly_rent = :monthly_rent,
             sale_price = :sale_price, deposit = :deposit, notes = :notes,
             registration_number = :registration_number, registration_date = :registration_date,
             registration_office = :registration_office, cedolare_secca = :cedolare_secca,
             registration_tax_annual = :registration_tax_annual, stamp_duty = :stamp_duty,
             imposta_registro_due_date = :imposta_registro_due_date,
             istat_update_enabled = :istat_update_enabled, istat_baseline_index = :istat_baseline_index,
             istat_baseline_month = :istat_baseline_month, last_istat_update = :last_istat_update
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    logActivity('update', 'contract', $id, 'Contratto aggiornato #' . $id . ' (' . $validated['status'] . ')');

    // Covers the common path where a lease is drafted first and signed later: at
    // creation it wasn't in force yet, so nothing was generated. insertPaymentSchedule
    // is a no-op when a schedule already exists, so repeated saves are harmless.
    autoGeneratePaymentSchedule($db, $id);
    syncPropertyOccupancy($db, $id);

    getContract($db, $id);
}

/**
 * Cambia SOLO lo stato del contratto.
 *
 * Esiste perche' "Avanza stato" e' un pulsante da un clic sull'elenco, mentre
 * updateContract() scrive 24 colonne. Il chiamante ne mandava 11 (titolo, tipo,
 * stato, immobile, inquilino, proprietario, date, canone, deposito, note) e le
 * altre 13 venivano riscritte con i valori di ripiego del validatore:
 *
 *   sale_price, contract_subtype, registration_number, registration_date,
 *   registration_office, cedolare_secca, registration_tax_annual, stamp_duty,
 *   imposta_registro_due_date, istat_update_enabled, istat_baseline_index,
 *   istat_baseline_month, last_istat_update
 *
 * Cioe': il prezzo di una compravendita, tutta la registrazione RLI con la
 * cedolare secca, e la base ISTAT da cui si calcola l'adeguamento del canone.
 * Un clic per portare il contratto da "inviato" a "firmato" — il momento in cui
 * quei dati contano di piu' — li azzerava tutti, senza un errore e senza che
 * niente in pagina lo facesse sospettare.
 *
 * Qui l'UPDATE tocca una colonna sola: quello che non viene mandato non puo'
 * essere cancellato.
 */
function setContractStatus(PDO $db, int $id): void
{
    if (!contractExists($db, $id)) {
        apiError('Contratto non trovato.', 404);
    }

    $data   = apiGetJsonBody();
    $status = trim((string) ($data['status'] ?? ''));

    if ($status === '') {
        apiError('Stato mancante.');
    }
    if (!in_array($status, CONTRACT_STATUSES, true)) {
        apiError('Stato non valido: ' . $status);
    }

    $db->prepare("UPDATE contracts SET status = :status WHERE id = :id")
       ->execute(['status' => $status, 'id' => $id]);

    logActivity('update', 'contract', $id, 'Stato contratto #' . $id . ' -> ' . $status);

    // Le due conseguenze che dipendono davvero dallo stato: una locazione che
    // entra in vigore genera lo scadenzario e segna l'immobile come affittato.
    // Restano qui, altrimenti cambiare stato da questa via avrebbe effetti
    // diversi dal salvataggio completo.
    autoGeneratePaymentSchedule($db, $id);
    syncPropertyOccupancy($db, $id);

    getContract($db, $id);
}

function deleteContract(PDO $db, int $id): void
{
    // Deleting a contract is permanent and removes legal/financial history —
    // restrict to admin+ (same convention as admin_users.php, backup_trigger.php, etc.).
    // Agents can still create/update contracts via requireWriteAccess() above.
    requireRole('super_admin', 'admin');

    if (!contractExists($db, $id)) {
        apiError('Contratto non trovato.', 404);
    }

    $rel = contractRelatedRecords($db, $id);

    // Anything already "settled" is history and blocks the delete outright:
    // collected rent, paid commissions, a completed signature. phase25/phase48
    // set the house rule — an entity is never hard-deleted out from under its
    // financial or legal record.
    $blockers = [];
    if ($rel['payments']['settled'] > 0) {
        $n = $rel['payments']['settled'];
        $blockers[] = "$n pagament" . ($n === 1 ? 'o incassato' : 'i incassati');
    }
    if ($rel['commissions']['settled'] > 0) {
        $n = $rel['commissions']['settled'];
        $blockers[] = "$n provvigion" . ($n === 1 ? 'e liquidata' : 'i liquidate');
    }
    if ($rel['esign']['settled'] > 0) {
        $n = $rel['esign']['settled'];
        $blockers[] = "$n firm" . ($n === 1 ? 'a elettronica raccolta' : 'e elettroniche raccolte');
    }
    // Documents are never auto-deleted: the row owns a FILE on disk, which may be
    // a signed contract scan or an identity document under legal retention. We
    // will not unlink one as a side effect of deleting a contract — the agent has
    // to decide about each file explicitly.
    if ($rel['documents']['total'] > 0) {
        $n = $rel['documents']['total'];
        $blockers[] = "$n document" . ($n === 1 ? 'o allegato' : 'i allegati');
    }
    if ($rel['snapshots']['settled'] > 0) {
        $n = $rel['snapshots']['settled'];
        $blockers[] = "$n verbal" . ($n === 1 ? 'e di consegna firmato' : 'i di consegna firmati');
    }

    if ($blockers) {
        apiError(
            'Impossibile eliminare: il contratto ha ' . implode(', ', $blockers)
            . '. Questi record non possono essere cancellati insieme al contratto — '
            . 'scollegali o annulla il contratto invece di eliminarlo.',
            409
        );
    }

    // What remains is forecast, not history: an unpaid rent schedule, a commission
    // still pending, an unsigned/expired signature request. Those go with the
    // contract. The FKs are RESTRICT (phase70/phase71) so children must be removed
    // first, and it all happens in one transaction — never a contract whose
    // schedule has already been deleted.
    $db->beginTransaction();
    try {
        // inventory_snapshots prima di tutto: i suoi items sono in CASCADE su di
        // esso, quindi cancellare il verbale in bozza porta via anche le righe.
        $db->prepare("DELETE FROM inventory_snapshots WHERE contract_id = :cid AND status <> 'locked'")
           ->execute(['cid' => $id]);

        foreach (['payments', 'agent_commissions', 'esign_requests'] as $table) {
            $del = $db->prepare("DELETE FROM $table WHERE contract_id = :cid");
            $del->execute(['cid' => $id]);
        }

        $stmt = $db->prepare("DELETE FROM contracts WHERE id = :id");
        $stmt->execute(['id' => $id]);

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    $removed = [
        'payments'    => $rel['payments']['unsettled'],
        'commissions' => $rel['commissions']['unsettled'],
        'esign'       => $rel['esign']['unsettled'],
        'snapshots'   => $rel['snapshots']['unsettled'],
    ];
    $plural = static fn(int $n, string $one, string $many): string => "$n " . ($n === 1 ? $one : $many);

    $parts = [];
    if ($removed['payments'])    $parts[] = $plural($removed['payments'], 'rata non incassata', 'rate non incassate');
    if ($removed['commissions']) $parts[] = $plural($removed['commissions'], 'provvigione non liquidata', 'provvigioni non liquidate');
    if ($removed['esign'])       $parts[] = $plural($removed['esign'], 'richiesta di firma non completata', 'richieste di firma non completate');
    if ($removed['snapshots'])   $parts[] = $plural($removed['snapshots'], 'verbale in bozza', 'verbali in bozza');

    logActivity('delete', 'contract', $id, 'Contratto eliminato #' . $id
        . ($parts ? ' (rimosse: ' . implode(', ', $parts) . ')' : ''));

    apiSuccess([
        'id'      => $id,
        'removed' => $removed,
        'message' => 'Contratto eliminato.'
            . ($parts ? ' Rimosse anche ' . implode(', ', $parts) . '.' : ''),
    ]);
}

/**
 * Records hanging off a contract, split into settled (history — blocks deletion)
 * and unsettled (forecast — removed with the contract).
 *
 * Documents are counted whole: they own a file on disk and are never removed
 * automatically, so the settled/unsettled split does not apply to them.
 */
function contractRelatedRecords(PDO $db, int $id): array
{
    $count = function (string $sql) use ($db, $id): array {
        $stmt = $db->prepare($sql);
        $stmt->execute(['cid' => $id]);
        $row = $stmt->fetch() ?: [];
        return [
            'settled'   => (int) ($row['settled'] ?? 0),
            'unsettled' => (int) ($row['unsettled'] ?? 0),
        ];
    };

    return [
        'payments' => $count(
            "SELECT SUM(status = 'paid' OR paid_date IS NOT NULL)      AS settled,
                    SUM(NOT (status = 'paid' OR paid_date IS NOT NULL)) AS unsettled
             FROM payments WHERE contract_id = :cid"
        ),
        'commissions' => $count(
            "SELECT SUM(status = 'paid' OR paid_at IS NOT NULL)      AS settled,
                    SUM(NOT (status = 'paid' OR paid_at IS NOT NULL)) AS unsettled
             FROM agent_commissions WHERE contract_id = :cid"
        ),
        // A signed request is evidence of a signature ceremony (it stores signer,
        // timestamp and IP). Pending/expired ones prove nothing.
        'esign' => $count(
            "SELECT SUM(status = 'signed' OR signed_at IS NOT NULL)      AS settled,
                    SUM(NOT (status = 'signed' OR signed_at IS NOT NULL)) AS unsettled
             FROM esign_requests WHERE contract_id = :cid"
        ),
        'documents' => ['total' => (int) (function () use ($db, $id) {
            $stmt = $db->prepare("SELECT COUNT(*) FROM documents WHERE contract_id = :cid");
            $stmt->execute(['cid' => $id]);
            return $stmt->fetchColumn();
        })()],
        // Verbali di consegna (phase78). Un verbale `locked` e' congelato con
        // content_hash, locked_at e spesso una firma: e' il documento con cui si
        // discute una trattenuta sulla cauzione, quindi e' prova come una rata
        // incassata. Un `draft` non lo e'. Fino a phase85 la FK era in CASCADE e
        // nessuno li contava: sparivano in silenzio insieme al contratto.
        'snapshots' => $count(
            "SELECT SUM(status = 'locked')      AS settled,
                    SUM(NOT (status = 'locked')) AS unsettled
             FROM inventory_snapshots WHERE contract_id = :cid"
        ),
    ];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateContractInput(array $data): array
{
    $propertyId   = (int) ($data['property_id'] ?? 0);
    $tenantId     = !empty($data['tenant_id']) ? (int) $data['tenant_id'] : null;
    $clientId     = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $title        = trim($data['title'] ?? '');
    $contractType = trim($data['contract_type'] ?? 'locazione');
    // Empty status = "Automatico" (state derived from the dates). Stored as NULL.
    $statusRaw    = trim($data['status'] ?? '');
    $status       = ($statusRaw === '' || $statusRaw === 'auto') ? null : $statusRaw;
    $startDate    = trim($data['start_date'] ?? '') ?: null;
    $endDate      = trim($data['end_date'] ?? '') ?: null;
    $monthlyRent  = isset($data['monthly_rent']) && $data['monthly_rent'] !== '' ? (float) $data['monthly_rent'] : null;
    $salePrice    = isset($data['sale_price']) && $data['sale_price'] !== '' ? (float) $data['sale_price'] : null;
    $deposit      = isset($data['deposit']) && $data['deposit'] !== '' ? (float) $data['deposit'] : null;
    $notes        = trim($data['notes'] ?? '') ?: null;

    // Fiscal registration (RLI), cedolare secca, imposta di registro, ISTAT
    $dateOrNull = static function ($v) {
        $v = isset($v) ? trim((string) $v) : '';
        return $v !== '' && DateTime::createFromFormat('Y-m-d', $v) ? $v : null;
    };
    $strOrNull  = static fn($v) => isset($v) && trim((string) $v) !== '' ? trim((string) $v) : null;
    $contractSubtype     = $strOrNull($data['contract_subtype'] ?? null);
    $registrationNumber  = $strOrNull($data['registration_number'] ?? null);
    $registrationDate    = $dateOrNull($data['registration_date'] ?? null);
    $registrationOffice  = $strOrNull($data['registration_office'] ?? null);
    $cedolareSecca       = !empty($data['cedolare_secca']) ? 1 : 0;
    $registrationTax     = isset($data['registration_tax_annual']) && $data['registration_tax_annual'] !== '' ? (float) $data['registration_tax_annual'] : null;
    $stampDuty           = isset($data['stamp_duty']) && $data['stamp_duty'] !== '' ? (float) $data['stamp_duty'] : null;
    $registroDueDate     = $dateOrNull($data['imposta_registro_due_date'] ?? null);
    $istatEnabled        = !empty($data['istat_update_enabled']) ? 1 : 0;
    $istatBaselineIndex  = isset($data['istat_baseline_index']) && $data['istat_baseline_index'] !== '' ? (float) $data['istat_baseline_index'] : null;
    $istatBaselineMonth  = $strOrNull($data['istat_baseline_month'] ?? null);
    $lastIstatUpdate     = $dateOrNull($data['last_istat_update'] ?? null);

    if ($propertyId <= 0) {
        apiError('Seleziona un immobile.');
    }
    if ($title === '') {
        apiError('Il titolo è obbligatorio.');
    }
    if (!in_array($contractType, CONTRACT_TYPES, true)) {
        apiError('Tipo contratto non valido.');
    }
    if ($status !== null && !in_array($status, CONTRACT_STATUSES, true)) {
        apiError('Stato non valido.');
    }
    if ($startDate !== null && !DateTime::createFromFormat('Y-m-d', $startDate)) {
        apiError('Data inizio non valida.');
    }
    if ($endDate !== null && !DateTime::createFromFormat('Y-m-d', $endDate)) {
        apiError('Data fine non valida.');
    }
    // Ordine delle date. Senza questo controllo un periodo rovesciato si salvava
    // senza un fiato, e il danno arrivava dopo e altrove: `effectiveStatus()`
    // mostrava il contratto gia' "Scaduto" il giorno della firma, e soprattutto
    // "Genera scadenzario" rispondeva «0 pagamenti creati» con l'aria di essere
    // andato a buon fine — il ciclo esce alla prima iterazione perche' la prima
    // scadenza cade gia' oltre `end`. Un canone che non viene mai richiesto e'
    // il tipo di errore che si scopre a fine anno guardando i conti.
    // Confronto tra stringhe: il formato Y-m-d e' gia' validato sopra ed e'
    // ordinabile lessicograficamente, quindi non serve costruire due DateTime.
    if ($startDate !== null && $endDate !== null && $endDate < $startDate) {
        apiError('La data di fine non può precedere la data di inizio.');
    }

    // Campo economico coerente col tipo. Si azzera in silenzio invece di dare
    // errore perche' il caso normale non e' un utente che sbaglia, e' un cambio
    // di tipo su un contratto gia' compilato: il form nasconde il campo non
    // pertinente, e senza questa riga il vecchio valore resterebbe in tabella,
    // invisibile nella scheda ma ben presente in elenco («€ 700,00/mese» su una
    // compravendita). L'UPDATE riscrive comunque tutte le colonne, quindi qui
    // "non passato" e "da azzerare" sono la stessa cosa e non si perde nulla che
    // il form non abbia gia' nascosto.
    if (in_array($contractType, CONTRACT_SALE_TYPES, true)) {
        $monthlyRent = null;
    }
    if (in_array($contractType, CONTRACT_RENTAL_TYPES, true)) {
        $salePrice = null;
    }

    return [
        'property_id'   => $propertyId,
        'tenant_id'     => $tenantId,
        'client_id'     => $clientId,
        'title'         => $title,
        'contract_type' => $contractType,
        'status'        => $status,
        'start_date'    => $startDate,
        'end_date'      => $endDate,
        'monthly_rent'  => $monthlyRent,
        'sale_price'    => $salePrice,
        'deposit'       => $deposit,
        'notes'         => $notes,
        'contract_subtype'          => $contractSubtype,
        'registration_number'       => $registrationNumber,
        'registration_date'         => $registrationDate,
        'registration_office'       => $registrationOffice,
        'cedolare_secca'            => $cedolareSecca,
        'registration_tax_annual'   => $registrationTax,
        'stamp_duty'                => $stampDuty,
        'imposta_registro_due_date' => $registroDueDate,
        'istat_update_enabled'      => $istatEnabled,
        'istat_baseline_index'      => $istatBaselineIndex,
        'istat_baseline_month'      => $istatBaselineMonth,
        'last_istat_update'         => $lastIstatUpdate,
    ];
}

/**
 * Double-booking guard: refuse to save an in-force lease (locazione, status
 * Automatico/NULL or signed) whose date range overlaps another in-force lease
 * on the same property. Draft/sent/cancelled contracts never block and are
 * never blocked — only contracts that actually occupy the property count.
 */
function assertNoOverlappingLease(PDO $db, array $v, ?int $excludeId = null): void
{
    $inForce = $v['status'] === null || $v['status'] === 'signed';
    if ($v['contract_type'] !== 'locazione' || !$inForce || $v['start_date'] === null) {
        return;
    }

    // Inclusive range overlap; a NULL end_date means open-ended (occupied forever).
    $sql = "SELECT id, title, start_date, end_date
              FROM contracts
             WHERE property_id = :property_id
               AND contract_type = 'locazione'
               AND (status IS NULL OR status = 'signed')
               AND start_date IS NOT NULL
               AND (:new_end IS NULL OR start_date <= :new_end2)
               AND (end_date IS NULL OR end_date >= :new_start)";
    $params = [
        'property_id' => $v['property_id'],
        'new_end'     => $v['end_date'],
        'new_end2'    => $v['end_date'],
        'new_start'   => $v['start_date'],
    ];
    if ($excludeId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $params['exclude_id'] = $excludeId;
    }

    $stmt = $db->prepare($sql . ' LIMIT 1');
    $stmt->execute($params);
    $conflict = $stmt->fetch();

    if ($conflict) {
        $range = $conflict['start_date'] . ' → ' . ($conflict['end_date'] ?: 'aperto');
        apiError(
            "Doppia prenotazione: l'immobile ha già un contratto di locazione in vigore che si sovrappone alle date indicate "
            . "(#{$conflict['id']} «{$conflict['title']}», {$range}). Modifica le date oppure annulla l'altro contratto.",
            409
        );
    }
}

/**
 * Compute the proposed ISTAT rent adjustment for a lease contract.
 * GET /api/contracts.php?action=istat_adjustment&id={id}[&target_year=YYYY]
 */
function istatAdjustment(PDO $db, int $id): void
{
    require_once __DIR__ . '/../lib/istat.php';

    $stmt = $db->prepare('SELECT * FROM contracts WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $c = $stmt->fetch();
    if (!$c) apiError('Contratto non trovato.', 404);

    $rent = isset($c['monthly_rent']) ? (float) $c['monthly_rent'] : 0.0;
    if ($rent <= 0) apiError('Il contratto non ha un canone mensile impostato.');

    $baselineIndex = ($c['istat_baseline_index'] ?? null) !== null && $c['istat_baseline_index'] !== ''
        ? (float) $c['istat_baseline_index'] : null;

    // Periodo base: prima il campo «Mese indice base» del contratto — che fino a
    // phase80 veniva salvato e mai letto — poi, se vuoto, il mese di decorrenza.
    // Il MESE conta: una locazione che parte a marzo si adegua sull'indice di
    // marzo, non sulla media annua, e per anni qui e' stato usato il solo anno.
    $baselinePeriod = istatParsePeriod($c['istat_baseline_month'] ?? null);
    if ($baselinePeriod === null && !empty($c['start_date'])) {
        $start = (string) $c['start_date'];
        $baselinePeriod = ['year' => (int) substr($start, 0, 4), 'month' => (int) substr($start, 5, 2)];
    }
    if ($baselinePeriod === null) {
        apiError('Manca il periodo di riferimento: compila «Mese indice base» oppure la data di inizio del contratto.');
    }

    // Bersaglio: quello chiesto, altrimenti l'ultimo indice pubblicato che
    // abbiamo in tabella. Puntare a `date('Y')` come prima significava chiedere
    // un indice che a gennaio non esiste ancora.
    $target = istatParsePeriod($_GET['target_period'] ?? ($_GET['target_year'] ?? ''))
        ?? istatLatestPeriod($db);
    if ($target === null) {
        apiError('Nessun indice ISTAT disponibile. Importa gli indici da Impostazioni → Indici ISTAT.');
    }

    $result = istatComputeAdjustment(
        $db,
        $rent,
        ['year' => $baselinePeriod['year'], 'month' => $baselinePeriod['month'], 'index' => $baselineIndex],
        $target
    );
    if (empty($result['ok'])) {
        apiError($result['message'] ?? 'Calcolo ISTAT non riuscito.');
    }

    $result['contract_id'] = $id;
    $result['note'] = 'Adeguamento pari al ' . (int) round($result['share'] * 100) . '% della variazione FOI '
        . $result['baseline_period'] . ' → ' . $result['target_period'] . '.';
    apiSuccess($result);
}

/**
 * Allinea lo stato dell'immobile al contratto appena salvato.
 *
 * Va chiamata DOPO la scrittura, con il contratto riletto dal database: quello
 * che conta e' cosa c'e' scritto adesso, non cosa e' arrivato nel payload.
 *
 * Il ritiro dai portali era gia' implementato ma inarrivabile: nessuno portava
 * l'immobile ad "affittato", quindi `property.status_changed` non veniva mai
 * emesso e l'annuncio restava online a pagamento (vedi lib/contract_lifecycle.php).
 */
function syncPropertyOccupancy(PDO $db, int $contractId): void
{
    require_once __DIR__ . '/../lib/contract_lifecycle.php';

    $stmt = $db->prepare('SELECT * FROM contracts WHERE id = :id');
    $stmt->execute(['id' => $contractId]);
    $contract = $stmt->fetch();
    if (!$contract || !contractOccupiesProperty($contract)) {
        return;
    }

    $result = contractSyncPropertyOccupancy($db, (int) $contract['property_id']);
    if ($result['changed']) {
        logActivity(
            'update',
            'property',
            (int) $contract['property_id'],
            'Immobile passato ad affittato: contratto #' . $contractId . ' in vigore'
            . ($result['retired'] > 0 ? ' — ' . $result['retired'] . ' pubblicazioni ritirate dai portali' : '')
        );
    }
}

/**
 * Why a contract cannot have a rent schedule generated. Empty array = eligible.
 *
 * Shared by the manual "Genera scadenzario" button (which surfaces the reason to
 * the agent) and the automatic generation on save (which just stays quiet).
 *
 * @return string[]
 */
function paymentScheduleBlockers(array $contract): array
{
    $blockers = [];
    if (($contract['contract_type'] ?? '') !== 'locazione')
        $blockers[] = 'La generazione dello scadenzario è disponibile solo per contratti di locazione.';
    if (empty($contract['tenant_id']))
        $blockers[] = 'Il contratto non ha un inquilino associato.';
    if (empty($contract['monthly_rent']))
        $blockers[] = 'Il contratto non ha un canone mensile.';
    if (empty($contract['start_date']))
        $blockers[] = 'Il contratto non ha una data di inizio.';
    if (empty($contract['end_date']))
        $blockers[] = 'Il contratto non ha una data di fine.';
    return $blockers;
}

/**
 * A contract is "in force" when it is signed or left on Automatico (NULL status)
 * — the same rule the "Attivi" list filter uses. Drafts and cancelled contracts
 * must NOT auto-generate a schedule: that would fill the payments module with
 * rent rows for a lease nobody has signed yet.
 */
function contractIsInForce(array $contract): bool
{
    $status = $contract['status'] ?? null;
    return $status === null || $status === '' || $status === 'signed';
}

/**
 * Insert the full rent schedule for a contract.
 *
 * @return int rows created, or -1 when a schedule already exists (caller decides
 *             whether that is an error or a no-op).
 */
function insertPaymentSchedule(PDO $db, array $contract): int
{
    $id = (int) $contract['id'];

    // Run the whole generation inside a transaction and lock the contract row so
    // two concurrent "genera scadenzario" requests can't both pass the guard and
    // create a duplicate schedule.
    $db->beginTransaction();
    try {
        // Re-read + lock the contract row.
        $lock = $db->prepare("SELECT id FROM contracts WHERE id = :id FOR UPDATE");
        $lock->execute(['id' => $id]);

        $existStmt = $db->prepare("SELECT COUNT(*) FROM payments WHERE contract_id = :cid");
        $existStmt->execute(['cid' => $id]);
        if ((int) $existStmt->fetchColumn() > 0) {
            $db->rollBack();
            return -1;
        }

        $start = new DateTime($contract['start_date']);
        $end   = new DateTime($contract['end_date']);
        // Anchor on the lease start day-of-month; clamp to each month's length so
        // an end-of-month start (e.g. the 31st) does NOT roll over into the next
        // month. `DateTime::modify('+1 month')` overflows (Jan 31 -> Mar 3), which
        // previously skipped/shifted months — this computes each due date directly.
        $anchorDay  = (int) $start->format('j');
        $monthStart = (clone $start)->modify('first day of this month');

        $insert = $db->prepare(
            "INSERT INTO payments (contract_id, tenant_id, property_id, amount, due_date, status)
             VALUES (:contract_id, :tenant_id, :property_id, :amount, :due_date, 'pending')"
        );

        $count = 0;
        for ($i = 0; ; $i++) {
            $month       = (clone $monthStart)->modify("+$i month");
            $daysInMonth = (int) $month->format('t');
            $day         = min($anchorDay, $daysInMonth);
            // '!Y-m-d' resets the time to 00:00:00 (createFromFormat otherwise
            // inherits the current time-of-day, which would push an end-date match
            // past `end` and drop the final payment).
            $due         = DateTime::createFromFormat('!Y-m-d', $month->format('Y-m-') . sprintf('%02d', $day));

            if ($due < $start || $due > $end) {
                // Before the lease start (only possible at i=0 if start day was clamped
                // upward, which cannot happen) or past the end — stop.
                if ($due > $end) break;
                continue;
            }

            $insert->execute([
                'contract_id' => $id,
                'tenant_id'   => $contract['tenant_id'],
                'property_id' => $contract['property_id'],
                'amount'      => $contract['monthly_rent'],
                'due_date'    => $due->format('Y-m-d'),
            ]);
            $count++;

            // Safety valve: a lease longer than 50 years is certainly bad data.
            if ($i > 600) break;
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    return $count;
}

function generatePayments(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $contract = $stmt->fetch();
    if (!$contract) apiError('Contratto non trovato.', 404);

    $blockers = paymentScheduleBlockers($contract);
    if ($blockers) apiError($blockers[0]);

    $count = insertPaymentSchedule($db, $contract);
    if ($count === -1) {
        apiError('Esiste già uno scadenzario per questo contratto. Elimina i pagamenti esistenti prima di rigenerarlo.');
    }

    logActivity('create', 'contract', $id, "Scadenzario generato: $count pagamenti per contratto #$id");
    apiSuccess(['contract_id' => $id, 'payments_created' => $count, 'message' => "$count pagamenti creati."]);
}

/**
 * Generate the rent schedule automatically when a lease is saved in force.
 *
 * Before this, a contract saved without clicking "Genera scadenzario" was
 * invisible to the entire payments module — no rows, no KPI contribution, no
 * overdue reminders. Silent by design: an ineligible or already-scheduled
 * contract is simply skipped, and a failure here must never take down the save
 * the agent actually asked for.
 *
 * @return int rows created (0 when skipped)
 */
function autoGeneratePaymentSchedule(PDO $db, int $id): int
{
    try {
        $stmt = $db->prepare("SELECT * FROM contracts WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $contract = $stmt->fetch();

        if (!$contract) return 0;
        if (!contractIsInForce($contract)) return 0;
        if (paymentScheduleBlockers($contract)) return 0;

        $count = insertPaymentSchedule($db, $contract);
        if ($count > 0) {
            logActivity('create', 'contract', $id, "Scadenzario generato automaticamente: $count pagamenti per contratto #$id");
        }
        return max(0, $count);
    } catch (Throwable $e) {
        error_log('autoGeneratePaymentSchedule failed for contract #' . $id . ': ' . $e->getMessage());
        return 0;
    }
}

function contractExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

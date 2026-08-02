<?php
/**
 * Reminders (Promemoria) CRUD API.
 *
 * GET    /api/reminders.php              — list (search, status, frequency, due_soon,
 *                                          exclude_status=a,b per togliere stati)
 * GET    /api/reminders.php?id={id}      — single reminder
 * GET    /api/reminders.php?action=contacts — rubrica unificata per il picker
 * GET    /api/reminders.php?action=agents   — agenti a cui assegnare
 * POST   /api/reminders.php              — create
 * PUT    /api/reminders.php?id={id}      — update
 * PATCH  /api/reminders.php?id={id}      — quick status update (?action=complete|cancel)
 * DELETE /api/reminders.php?id={id}      — elimina (le occorrenze della serie e
 *                                          il registro invii vanno in cascata).
 *                                          Per sospendere senza perdere:
 *                                          PATCH ?action=cancel
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/reminders.php';
require_once __DIR__ . '/../config/automation_events.php';
require_once __DIR__ . '/../config/automation_presets.php';

apiHandleOptions();

const REMINDER_STATUSES = ['pending', 'completed', 'cancelled'];

/**
 * Valori ammessi per `request_type`. La colonna e' un varchar libero (phase
 * originaria) ma la bacheca cerca esattamente 'maintenance': una stringa
 * qualunque creerebbe un intervento che nessuna schermata mostra.
 */
const REMINDER_REQUEST_TYPES = ['maintenance'];

/** enum reminders.maintenance_status. */
const REMINDER_MAINTENANCE_STATUSES = ['aperta', 'in_lavorazione', 'completata', 'chiusa'];

/** `priority` e' varchar libero, ma la bacheca colora solo questi. */
const REMINDER_PRIORITIES = ['bassa', 'media', 'alta', 'urgente'];

/** Regola del giorno: dom:<1-31|last>, nth:<1-4|last>:<1-7>, dow:<1-7>. */
const REMINDER_DAY_RULE_PATTERN = '/^(dom:(last|[1-9]|[12]\d|3[01])|nth:(last|[1-4]):[1-7]|dow:[1-7])$/';

/** Il contatto di un promemoria può essere un proprietario, un lead o un inquilino. */
const REMINDER_CONTACT_TYPES = ['client' => 'client_id', 'lead' => 'lead_id', 'tenant' => 'tenant_id'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = trim($_GET['action'] ?? '');

    switch ($method) {
        case 'GET':
            if ($action === 'contacts') {
                listContacts($db);
            } elseif ($action === 'agents') {
                listAgents($db);
            } elseif ($action === 'tokens') {
                listAutomationVocabulary();
            } elseif ($action === 'dispatch_log') {
                if (!$id) apiError('ID automazione mancante.');
                listDispatchLog($db, $id);
            } elseif ($id) {
                getReminder($db, $id);
            } else {
                listReminders($db);
            }
            break;
        case 'POST':
            if ($action === 'test_send') {
                sendAutomationTestEmail($db);
            } else {
                createReminder($db);
            }
            break;
        case 'PUT':
            if (!$id) apiError('ID promemoria mancante.');
            updateReminder($db, $id);
            break;
        case 'PATCH':
            if (!$id) apiError('ID promemoria mancante.');
            patchReminder($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID promemoria mancante.');
            deleteReminder($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    // Il messaggio all'utente resta generico (un errore SQL non si mostra a chi
    // sta lavorando), ma finora non finiva NEMMENO nei log: un 500 senza
    // nessuna traccia da nessuna parte, impossibile da diagnosticare se non
    // rimettendo le mani nel codice.
    error_log('reminders.php: ' . $e->getMessage());
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listReminders(PDO $db): void
{
    $pagination = apiGetPagination();
    $search   = trim($_GET['search'] ?? '');
    $status   = trim($_GET['status'] ?? '');
    $frequency = trim($_GET['frequency'] ?? '');
    $dueSoon  = isset($_GET['due_soon']) ? (int) $_GET['due_soon'] : null;
    $from     = trim($_GET['from'] ?? '');
    $to       = trim($_GET['to'] ?? '');
    $filterClientId  = isset($_GET['client_id'])   ? (int) $_GET['client_id']   : null;
    $filterPropertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $filterTenantId  = isset($_GET['tenant_id'])   ? (int) $_GET['tenant_id']   : null;
    $filterLeadId    = isset($_GET['lead_id'])     ? (int) $_GET['lead_id']     : null;
    $filterAgentId   = isset($_GET['assigned_agent_id']) ? (int) $_GET['assigned_agent_id'] : null;
    $notifyClient    = isset($_GET['notify_client']) ? (int) $_GET['notify_client'] : null;
    $maintenanceOnly = !empty($_GET['type']) && $_GET['type'] === 'maintenance';
    $filterPriority  = trim($_GET['priority'] ?? '');
    $filterMStatus   = trim($_GET['maintenance_status'] ?? '');
    // series=parents → solo le righe "madre": una serie ricorrente conta come
    // una voce sola. Serve alla pagina Automazioni, che mostra la regola e non
    // le sue 52 occorrenze.
    $seriesScope     = trim($_GET['series'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($search !== '') {
        $where .= " AND (r.title LIKE :search OR r.description LIKE :search
                      OR c.name LIKE :search OR c.surname LIKE :search
                      OR ld.name LIKE :search OR ld.surname LIKE :search
                      OR tn.name LIKE :search OR tn.surname LIKE :search
                      OR p.address LIKE :search)";
        $params['search'] = '%' . $search . '%';
    }

    if ($status !== '' && in_array($status, REMINDER_STATUSES, true)) {
        $where .= ' AND r.status = :status';
        $params['status'] = $status;
    }

    // Escludere uno stato non e' esprimibile con `status`, che e' un uguale.
    // Serve alle schede che nascondono gli annullati: filtrandoli nel browser,
    // la pagina mostrava 95 righe mentre `total` ne contava 150 (annullati
    // inclusi), cioe' due numeri che descrivono insiemi diversi. Il taglio deve
    // avvenire dove si conta, altrimenti il conteggio parla d'altro.
    $excludeStatus = array_values(array_filter(
        array_map('trim', explode(',', (string) ($_GET['exclude_status'] ?? ''))),
        fn($s) => in_array($s, REMINDER_STATUSES, true)
    ));
    foreach ($excludeStatus as $i => $st) {
        $where .= " AND r.status <> :excl_$i";
        $params["excl_$i"] = $st;
    }

    if ($frequency !== '' && in_array($frequency, REMINDER_FREQUENCIES, true)) {
        $where .= ' AND r.frequency = :frequency';
        $params['frequency'] = $frequency;
    }

    if ($dueSoon !== null && $dueSoon > 0) {
        $where .= " AND r.status = 'pending'
                  AND r.reminder_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL :days DAY)";
        $params['days'] = $dueSoon;
    }

    if ($from !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
        $where .= ' AND r.reminder_date >= :from';
        $params['from'] = $from . ' 00:00:00';
    }

    if ($to !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        $where .= ' AND r.reminder_date <= :to';
        $params['to'] = $to . ' 23:59:59';
    }

    if ($filterClientId) {
        $where .= ' AND r.client_id = :filter_client_id';
        $params['filter_client_id'] = $filterClientId;
    }
    if ($filterPropertyId) {
        $where .= ' AND r.property_id = :filter_property_id';
        $params['filter_property_id'] = $filterPropertyId;
    }
    if ($filterTenantId) {
        $where .= ' AND r.tenant_id = :filter_tenant_id';
        $params['filter_tenant_id'] = $filterTenantId;
    }
    if ($filterLeadId) {
        $where .= ' AND r.lead_id = :filter_lead_id';
        $params['filter_lead_id'] = $filterLeadId;
    }
    if ($filterAgentId) {
        $where .= ' AND r.assigned_agent_id = :filter_agent_id';
        $params['filter_agent_id'] = $filterAgentId;
    }
    if ($seriesScope === 'parents') {
        $where .= ' AND r.series_id IS NULL';
    }

    // Una regola a evento non è un promemoria: ha una data fittizia (la colonna
    // è NOT NULL) e non va mai eseguita per conto suo. Senza questo filtro
    // comparirebbe in agenda e sul calendario come un impegno di oggi che non
    // esiste. Solo la pagina Automazioni la chiede, con trigger=all.
    $triggerScope = trim($_GET['trigger'] ?? '');
    if ($triggerScope === 'event' || $triggerScope === 'scheduled') {
        $where .= ' AND r.trigger_type = :trigger_type';
        $params['trigger_type'] = $triggerScope;
    } elseif ($triggerScope !== 'all') {
        $where .= " AND r.trigger_type = 'scheduled'";
    }
    if ($notifyClient !== null) {
        $where .= ' AND r.notify_client = :notify_client';
        $params['notify_client'] = $notifyClient;
    }
    // Maintenance board: show only genuine maintenance work-orders, not every
    // reminder. New tenant requests are tagged request_type='maintenance';
    // older untagged rows are matched by their "[Richiesta maintenance]" title.
    if ($maintenanceOnly) {
        $where .= " AND (r.request_type = 'maintenance'
                      OR (r.request_type IS NULL AND r.title LIKE :maint_marker))";
        $params['maint_marker'] = '[Richiesta maintenance]%';
    }
    if ($filterPriority !== '') {
        $where .= ' AND r.priority = :priority';
        $params['priority'] = $filterPriority;
    }
    if ($filterMStatus !== '') {
        $where .= ' AND r.maintenance_status = :m_status';
        $params['m_status'] = $filterMStatus;
    }

    $joins = "LEFT JOIN clients c ON c.id = r.client_id
              LEFT JOIN properties p ON p.id = r.property_id
              LEFT JOIN tenants tn ON tn.id = r.tenant_id
              LEFT JOIN leads ld ON ld.id = r.lead_id
              LEFT JOIN admin_users au ON au.id = r.assigned_agent_id
              LEFT JOIN property_inventory pi ON pi.id = r.inventory_item_id";

    $countSql = "SELECT COUNT(*) FROM reminders r $joins $where";

    // Prossimo/ultimo invio: la scheda automazione deve rispondere a «ha
    // consegnato? quando riparte?» senza una seconda chiamata per riga.
    //
    // Il MIN comprende la riga madre (`o.id = r.id`), non solo le figlie: la
    // PRIMA occorrenza di una serie è la madre stessa, e guardando solo le
    // figlie un'automazione che parte il 31/08 annuncerebbe il 30/09.
    $dataSql = "SELECT r.*, c.name AS client_name, c.surname AS client_surname,
                   ld.name AS lead_name, ld.surname AS lead_surname,
                   tn.name AS tenant_contact_name, tn.surname AS tenant_contact_surname,
                   au.username AS agent_username,
                   p.address AS property_address, p.city AS property_city,
                   p.reference_code AS property_reference,
                   (SELECT COUNT(*) FROM reminders o WHERE o.series_id = r.id) AS occurrence_count,
                   (SELECT MIN(o.reminder_date) FROM reminders o
                     WHERE (o.series_id = r.id OR o.id = r.id)
                       AND o.status = 'pending' AND o.reminder_date > NOW()
                       AND o.trigger_type = 'scheduled') AS next_occurrence_at,
                   (SELECT dl.dispatched_at FROM reminder_dispatch_log dl
                     WHERE dl.automation_id = r.id ORDER BY dl.dispatched_at DESC LIMIT 1) AS last_dispatch_at,
                   (SELECT dl.status FROM reminder_dispatch_log dl
                     WHERE dl.automation_id = r.id ORDER BY dl.dispatched_at DESC LIMIT 1) AS last_dispatch_status,
                   (SELECT dl.error_details FROM reminder_dispatch_log dl
                     WHERE dl.automation_id = r.id ORDER BY dl.dispatched_at DESC LIMIT 1) AS last_dispatch_error,
                   pi.item_name AS asset_name, pi.brand AS asset_brand, pi.model AS asset_model,
                   pi.serial_number AS asset_serial, pi.condition_rating AS asset_condition,
                   pi.warranty_until AS asset_warranty_until,
                   -- La condizione che conta in una contestazione non è quella di
                   -- oggi: è quella con cui il bene fu consegnato, congelata nel
                   -- verbale di check-in.
                   (SELECT si.condition_rating
                      FROM inventory_snapshot_items si
                      JOIN inventory_snapshots s ON s.id = si.snapshot_id AND s.phase = 'check_in'
                     WHERE si.inventory_item_id = r.inventory_item_id
                  ORDER BY s.snapshot_date DESC LIMIT 1) AS asset_checkin_condition,
                   CASE WHEN tn.id IS NOT NULL THEN CONCAT(tn.name, ' ', tn.surname) ELSE r.tenant_name END AS tenant_name
            FROM reminders r
            $joins
            $where
            ORDER BY r.reminder_date ASC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getReminder(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT r.*, c.name AS client_name, c.surname AS client_surname,
                ld.name AS lead_name, ld.surname AS lead_surname,
                tn.name AS tenant_contact_name, tn.surname AS tenant_contact_surname,
                au.username AS agent_username,
                p.address AS property_address, p.city AS property_city, p.client_id AS property_client_id,
                pi.item_name AS asset_name, pi.brand AS asset_brand, pi.model AS asset_model,
                pi.serial_number AS asset_serial, pi.condition_rating AS asset_condition,
                pi.warranty_until AS asset_warranty_until,
                (SELECT si.condition_rating
                   FROM inventory_snapshot_items si
                   JOIN inventory_snapshots s ON s.id = si.snapshot_id AND s.phase = 'check_in'
                  WHERE si.inventory_item_id = r.inventory_item_id
               ORDER BY s.snapshot_date DESC LIMIT 1) AS asset_checkin_condition,
                (SELECT COUNT(*) FROM reminders o WHERE o.series_id = r.id) AS occurrence_count
         FROM reminders r
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN leads ld ON ld.id = r.lead_id
         LEFT JOIN tenants tn ON tn.id = r.tenant_id
         LEFT JOIN admin_users au ON au.id = r.assigned_agent_id
         LEFT JOIN properties p ON p.id = r.property_id
         LEFT JOIN property_inventory pi ON pi.id = r.inventory_item_id
         WHERE r.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Promemoria non trovato.', 404);
    }

    apiSuccess($row);
}

/**
 * Rubrica unificata per il campo "Contatto".
 *
 * L'agente non ragiona per tabelle: vuole "chi devo richiamare". Proprietari,
 * lead e inquilini arrivano quindi in un solo elenco già etichettato, invece di
 * costringere il form a tre select separate (e l'agente a indovinare in quale
 * delle tre sta la persona).
 */
function listContacts(PDO $db): void
{
    $sql = "SELECT id, 'client' AS contact_type, name, surname, email, phone
            FROM clients WHERE status = 'active'
            UNION ALL
            SELECT id, 'lead' AS contact_type, name, surname, email, phone
            FROM leads WHERE status <> 'lost'
            UNION ALL
            SELECT id, 'tenant' AS contact_type, name, surname, email, phone
            FROM tenants WHERE status = 'active'
            ORDER BY surname, name
            LIMIT 2000";

    apiSuccess($db->query($sql)->fetchAll());
}

/**
 * Restringe una regola a evento a un sottoinsieme di valori del payload.
 *
 * Accetta solo i campi che il catalogo dichiara per QUEL evento e solo i valori
 * che quel campo ammette: un filtro su una chiave sconosciuta non scatterebbe
 * mai e la regola sembrerebbe attiva restando morta.
 *
 * Selezionare tutte le opzioni equivale a non filtrare (NULL): due modi di
 * scrivere la stessa cosa, e il dispatcher ne deve leggere uno solo.
 *
 * @return string|null JSON da scrivere in `reminders.trigger_filter`
 */
function validateTriggerFilter(string $event, $raw): ?string
{
    // Una stringa arriva da updateReminder(), che ricopia dalla riga esistente
    // le chiavi assenti dal corpo: senza decodificarla, un salvataggio che non
    // parla del filtro lo cancellerebbe invece di lasciarlo com'e'.
    if (is_string($raw) && $raw !== '') {
        $raw = json_decode($raw, true);
    }

    $declared = AUTOMATION_EVENT_CATALOGUE[$event]['filters'] ?? [];
    if (!$declared || !is_array($raw) || !$raw) {
        return null;
    }

    $out = [];
    foreach ($declared as $field => $spec) {
        $picked = $raw[$field] ?? null;
        if (!is_array($picked)) {
            continue;
        }
        $options = array_keys($spec['options']);
        $clean   = array_values(array_unique(array_intersect(array_map('strval', $picked), $options)));

        if (!$clean) {
            apiError('Seleziona almeno una voce per "' . $spec['label'] . '", oppure tutte per non filtrare.');
        }
        if (count($clean) === count($options)) {
            continue; // tutte = nessun vincolo
        }
        $out[$field] = $clean;
    }

    return $out ? json_encode($out, JSON_UNESCAPED_UNICODE) : null;
}

/**
 * Vocabolario delle automazioni: token, eventi, strategie di destinatario.
 *
 * Serve al form, che altrimenti manterrebbe una copia di queste liste in JS —
 * e le due copie divergerebbero al primo token aggiunto, con la UI che offre
 * segnaposto che il motore non sa sostituire.
 */
function listAutomationVocabulary(): void
{
    apiSuccess([
        'token_groups'    => AUTOMATION_TOKEN_GROUPS,
        'event_token_group' => AUTOMATION_EVENT_TOKEN_GROUP,
        'events'          => AUTOMATION_EVENT_CATALOGUE,
        'recipient_rules' => AUTOMATION_RECIPIENT_RULES,
        // I modelli viaggiano con il resto del vocabolario: la pagina li mostra
        // prima ancora del modulo, e una seconda chiamata li farebbe comparire
        // dopo che l'agente ha già cliccato "Nuova".
        'presets'         => AUTOMATION_PRESETS,
        'sample_context'  => automationPreviewContext(),
    ]);
}

/**
 * Valori con cui il modulo disegna l'anteprima.
 *
 * Arrivano da qui e non da una tabella in JS perché metà sono veri: il nome
 * dell'agenzia e la data di oggi il browser non li sa, e mostrarli come
 * `{{agenzia.nome}}` faceva sembrare rotto un segnaposto che al momento
 * dell'invio funziona benissimo. Gli altri (contatto, immobile, evento)
 * dipendono da scelte che il modulo può ancora non aver fatto: lì l'esempio
 * resta esempio, e la UI lo sostituisce appena l'agente sceglie qualcosa.
 */
function automationPreviewContext(): array
{
    return array_merge(
        buildAutomationContext([]),
        automationSampleSubset('contatto.'),
        automationSampleSubset('immobile.'),
        automationSampleSubset('evento.'),
        ['evento.data' => (new DateTime())->format('d/m/Y')]
    );
}

/**
 * Invio di prova: la stessa email che riceverebbe il cliente, spedita a chi è
 * collegato adesso.
 *
 * Prima l'unico modo di sapere se un'automazione funziona era aspettare il giro
 * di cron e poi guardare il registro invii — cioè scoprire un token scritto
 * male dopo che è partito verso un cliente vero.
 *
 * Tre vincoli che tengono questa strada separata da quella di produzione:
 *  - il destinatario è SEMPRE l'email dell'admin in sessione, mai un indirizzo
 *    che arriva dal browser. Altrimenti sarebbe un modo per spedire a chiunque
 *    saltando il registro consensi.
 *  - niente registro invii e niente `communications`: una prova non è la storia
 *    dell'automazione, e sporcherebbe l'unica prova di cosa ha ricevuto il
 *    cliente.
 *  - i token che il modulo non può conoscere (contatto non ancora scelto,
 *    prezzo prima del ribasso) si riempiono con valori di esempio, così il
 *    testo si legge per intero invece di mostrare buchi.
 */
function sendAutomationTestEmail(PDO $db): void
{
    $data    = apiGetJsonBody();
    $subject = trim((string) ($data['email_subject'] ?? ''));
    $body    = trim((string) ($data['email_body'] ?? ''));

    if ($subject === '' || $body === '') {
        apiError('Scrivi oggetto e corpo del messaggio prima di provarlo.');
    }

    $stmt = $db->prepare('SELECT email FROM admin_users WHERE id = :id');
    $stmt->execute(['id' => getCurrentAdminId()]);
    $to = trim((string) ($stmt->fetchColumn() ?: ''));

    if ($to === '') {
        apiError('Il tuo utente non ha un indirizzo email: aggiungilo in "Il mio account" per ricevere le prove.');
    }

    $ctx = buildAutomationTestContext($db, $data);

    $renderedSubject = renderAutomationTemplate($subject, $ctx);
    $renderedBody    = renderAutomationTemplate($body, $ctx);

    // La riga in testa serve a chi la riceve fra sei mesi cercando nella posta:
    // senza, una prova è indistinguibile da un invio vero.
    $noticeBody = "— Invio di prova generato dal gestionale. Il cliente non ha ricevuto nulla. —\n\n" . $renderedBody;

    $result = sendHtmlEmail($to, '[PROVA] ' . $renderedSubject, $noticeBody);

    if (!$result['success']) {
        apiError('Invio non riuscito: ' . ($result['error'] ?? 'errore sconosciuto.'), 502);
    }

    apiSuccess([
        'to'        => $to,
        'subject'   => $renderedSubject,
        'body'      => $renderedBody,
        'simulated' => !empty($result['simulated']),
    ]);
}

/**
 * Valori dei token per l'invio di prova: reali dove il modulo ha già scelto un
 * contatto o un immobile, di esempio dove ancora non c'è nulla da leggere.
 */
function buildAutomationTestContext(PDO $db, array $data): array
{
    $row = [];

    $contactType = (string) ($data['contact_type'] ?? '');
    $contactId   = (int) ($data['contact_id'] ?? 0);
    $hasContact  = false;

    if ($contactId > 0 && isset(REMINDER_CONTACT_TYPES[$contactType])) {
        // Gli inquilini portano nome e cognome su colonne che
        // buildAutomationContext() legge con nomi propri (vedi
        // automationContactParts): l'alias va fatto qui, non lì.
        $sources = [
            'client' => ['clients', 'name AS client_name, surname AS client_surname, email AS client_email'],
            'lead'   => ['leads',   'name AS lead_name, surname AS lead_surname, email AS lead_email'],
            'tenant' => ['tenants', 'name AS tenant_first_name, surname AS tenant_surname, email AS tenant_email'],
        ];
        [$table, $columns] = $sources[$contactType];

        $stmt = $db->prepare("SELECT {$columns} FROM {$table} WHERE id = :id");
        $stmt->execute(['id' => $contactId]);
        if ($found = $stmt->fetch()) {
            $row        = array_merge($row, $found);
            $hasContact = true;
        }
    }

    $propertyId  = (int) ($data['property_id'] ?? 0);
    $hasProperty = false;

    if ($propertyId > 0) {
        $stmt = $db->prepare(
            'SELECT address AS property_address, city AS property_city,
                    reference_code AS property_reference, price AS property_price
             FROM properties WHERE id = :id'
        );
        $stmt->execute(['id' => $propertyId]);
        if ($found = $stmt->fetch()) {
            $row         = array_merge($row, $found);
            $hasProperty = true;
        }
    }

    $ctx = buildAutomationContext($row);

    // `evento.*` è sempre di esempio: l'evento non è ancora accaduto, e il
    // ribasso di cui parla il modello non esiste da nessuna parte.
    $fill = automationSampleSubset('evento.');
    if (!$hasContact)  $fill += automationSampleSubset('contatto.');
    if (!$hasProperty) $fill += automationSampleSubset('immobile.');

    return array_merge($ctx, $fill);
}

/** I valori di esempio di un gruppo di token (`contatto.`, `immobile.`, …). */
function automationSampleSubset(string $prefix): array
{
    $out = [];
    foreach (AUTOMATION_SAMPLE_CONTEXT as $token => $value) {
        if (str_starts_with($token, $prefix)) {
            $out[$token] = $value;
        }
    }
    return $out;
}

/**
 * Storico invii di un'automazione — regola e tutte le sue occorrenze insieme,
 * che è il modo in cui l'agente la pensa ("questa automazione ha consegnato?").
 */
function listDispatchLog(PDO $db, int $automationId): void
{
    try {
        $stmt = $db->prepare(
            "SELECT id, reminder_id, dispatched_at, recipient_type, recipient_email,
                    rendered_subject, status, error_details
             FROM reminder_dispatch_log
             WHERE automation_id = :id
             ORDER BY dispatched_at DESC
             LIMIT 100"
        );
        $stmt->execute(['id' => $automationId]);
        apiSuccess($stmt->fetchAll());
    } catch (PDOException $e) {
        apiSuccess([]); // tabella non ancora migrata: nessuno storico, non un errore
    }
}

/** Agenti assegnabili — stessa whitelist di ruoli usata da api/leads.php. */
function listAgents(PDO $db): void
{
    $rows = $db->query(
        "SELECT id, username, email FROM admin_users
         WHERE is_active = 1 AND role IN ('agent', 'admin', 'super_admin')
         ORDER BY username"
    )->fetchAll();

    apiSuccess($rows);
}

function createReminder(PDO $db): void
{
    $data      = apiGetJsonBody();
    $validated = validateReminderInput($db, $data);

    $stmt = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, end_date, frequency, schedule_time, day_rule,
             trigger_type, trigger_event, trigger_delay_minutes, recipient_rule, trigger_filter, status,
             client_id, lead_id, property_id, tenant_id, assigned_agent_id,
             notify_admin, notify_client, is_marketing, email_subject, email_body, request_type,
             maintenance_status, priority)
         VALUES
            (:title, :description, :reminder_date, :end_date, :frequency, :schedule_time, :day_rule,
             :trigger_type, :trigger_event, :trigger_delay_minutes, :recipient_rule, :trigger_filter, :status,
             :client_id, :lead_id, :property_id, :tenant_id, :assigned_agent_id,
             :notify_admin, :notify_client, :is_marketing, :email_subject, :email_body, :request_type,
             :maintenance_status, :priority)"
    );
    $stmt->execute($validated);

    $newId = (int) $db->lastInsertId();
    syncReminderSeries($db, $newId);
    logActivity('create', 'reminder', $newId, 'Promemoria creato: ' . ($validated['title'] ?? ('#' . $newId)));
    getReminder($db, $newId);
}

function updateReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $data = apiGetJsonBody();

    // SEMANTICA DI MERGE, non di sovrascrittura — la stessa scelta gia' fatta
    // per updateProperty (f17fb9a).
    //
    // L'UPDATE qui sotto scrive 21 colonne, ma non tutti i chiamanti ne mandano
    // 21. La finestrella "Promemoria" nella scheda di un proprietario ne manda
    // sei (assets/js/client_profile/index.js:594) — e le altre quindici
    // finivano ai valori di ripiego di validateReminderInput(): l'agente
    // assegnato tornava a nessuno, le notifiche si spegnevano, oggetto e corpo
    // dell'email venivano azzerati, immobile e inquilino perdevano il
    // collegamento e un promemoria a evento tornava "scheduled". Le automazioni
    // sono righe `reminders`: modificarne una dalla scheda cliente ne
    // cancellava il messaggio e l'innesco.
    //
    // Le chiavi assenti dal corpo della richiesta prendono ora il valore che la
    // riga ha gia'; solo quelle presenti vengono cambiate.
    $current = $db->prepare('SELECT * FROM reminders WHERE id = :id');
    $current->execute(['id' => $id]);
    $existing = $current->fetch(PDO::FETCH_ASSOC) ?: [];

    foreach ($existing as $col => $val) {
        if ($col !== 'id' && !array_key_exists($col, $data)) {
            $data[$col] = $val;
        }
    }

    $validated = validateReminderInput($db, $data);

    $stmt = $db->prepare(
        "UPDATE reminders
         SET title = :title, description = :description, reminder_date = :reminder_date,
             end_date = :end_date, frequency = :frequency, status = :status,
             schedule_time = :schedule_time, day_rule = :day_rule,
             trigger_type = :trigger_type, trigger_event = :trigger_event,
             trigger_delay_minutes = :trigger_delay_minutes, recipient_rule = :recipient_rule,
             trigger_filter = :trigger_filter,
             client_id = :client_id, lead_id = :lead_id, property_id = :property_id,
             tenant_id = :tenant_id, assigned_agent_id = :assigned_agent_id,
             notify_admin = :notify_admin, notify_client = :notify_client,
             is_marketing = :is_marketing,
             email_subject = :email_subject, email_body = :email_body,
             request_type = :request_type, maintenance_status = :maintenance_status,
             priority = :priority
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));

    // Rigenera le occorrenze future: la data, la frequenza o il testo possono
    // essere cambiati. È idempotente, quindi risalvare non duplica la serie.
    syncReminderSeries($db, $id);

    logActivity('update', 'reminder', $id, 'Promemoria aggiornato #' . $id);
    getReminder($db, $id);
}

function patchReminder(PDO $db, int $id): void
{
    if (!reminderExists($db, $id)) {
        apiError('Promemoria non trovato.', 404);
    }

    $action = trim($_GET['action'] ?? '');
    $map    = ['complete' => 'completed', 'cancel' => 'cancelled', 'reopen' => 'pending'];

    // Supplier assignment (maintenance workflow)
    if ($action === 'assign_supplier') {
        $data        = apiGetJsonBody();
        $supplierId  = !empty($data['supplier_id'])   ? (int) $data['supplier_id']        : null;
        $supplierName = trim($data['supplier_name'] ?? '') ?: null;
        $stmt = $db->prepare("UPDATE reminders SET supplier_id = :sid, supplier_name = :sname WHERE id = :id");
        $stmt->execute(['sid' => $supplierId, 'sname' => $supplierName, 'id' => $id]);
        getReminder($db, $id);
        return;
    }

    // Bene coinvolto (phase78). L'inquilino scrive "la lavatrice non parte";
    // l'idraulico ha bisogno di marca, modello e matricola — e di sapere in che
    // stato era stata consegnata. Collegare il ticket all'articolo di inventario
    // è ciò che trasforma la prima frase nella seconda.
    if ($action === 'link_asset') {
        $data   = apiGetJsonBody();
        $itemId = !empty($data['inventory_item_id']) ? (int) $data['inventory_item_id'] : null;

        if ($itemId !== null) {
            $chk = $db->prepare(
                "SELECT pi.id
                   FROM property_inventory pi
                   JOIN reminders r ON r.id = :rid
                  WHERE pi.id = :iid
                    AND (r.property_id IS NULL OR pi.property_id = r.property_id)"
            );
            $chk->execute(['rid' => $id, 'iid' => $itemId]);
            // Un bene di un altro immobile su questo ticket non è un errore di
            // battitura: è un intervento fatturato all'immobile sbagliato.
            if (!$chk->fetch()) {
                apiError('Articolo non trovato o non appartenente all\'immobile della richiesta.');
            }
        }

        $db->prepare("UPDATE reminders SET inventory_item_id = :iid WHERE id = :id")
           ->execute(['iid' => $itemId, 'id' => $id]);
        getReminder($db, $id);
        return;
    }

    // Maintenance status (aperta / in_lavorazione / completata / chiusa)
    if ($action === 'maintenance_status') {
        $data      = apiGetJsonBody();
        $newStatus = trim($data['status'] ?? '');
        $allowed   = ['aperta', 'in_lavorazione', 'completata', 'chiusa'];
        if (!in_array($newStatus, $allowed, true)) {
            apiError('Stato manutenzione non valido.');
        }
        // Lo stato di prima serve per non riemettere l'evento a ogni salvataggio:
        // riaprire e richiudere un ticket manderebbe due volte lo stesso invito.
        $before = $db->prepare("SELECT maintenance_status, tenant_id, property_id FROM reminders WHERE id = :id");
        $before->execute(['id' => $id]);
        $ticket = $before->fetch();
        if (!$ticket) {
            apiError('Promemoria non trovato.', 404);
        }

        $stmt = $db->prepare("UPDATE reminders SET maintenance_status = :ms WHERE id = :id");
        $stmt->execute(['ms' => $newStatus, 'id' => $id]);

        if ($newStatus !== ($ticket['maintenance_status'] ?? '') && in_array($newStatus, ['completata', 'chiusa'], true)) {
            // Nel payload NON va il proprietario: 'event_contact' sceglie il primo
            // fra lead/cliente/inquilino, e il riscontro su un intervento lo deve
            // dare chi ci abita. Il proprietario resta raggiungibile con la
            // strategia 'property_owner', che lo risale dall'immobile.
            emitAutomationEvent($db, 'maintenance.completed', 'reminder', $id, [
                'tenant_id'   => $ticket['tenant_id'] !== null ? (int) $ticket['tenant_id'] : null,
                'property_id' => $ticket['property_id'] !== null ? (int) $ticket['property_id'] : null,
                'new_status'  => $newStatus,
            ]);
        }

        getReminder($db, $id);
        return;
    }

    if (!isset($map[$action])) {
        apiError('Azione non valida. Usa: complete, cancel, reopen, assign_supplier, maintenance_status, link_asset.');
    }

    $stmt = $db->prepare("UPDATE reminders SET status = :status WHERE id = :id");
    $stmt->execute(['id' => $id, 'status' => $map[$action]]);

    applySeriesStatusSideEffects($db, $id, $action);
    getReminder($db, $id);
}

/**
 * Propaga alla serie i cambi di stato che la riguardano davvero.
 *
 * "Completa" resta locale: chiudere l'appuntamento di martedì non deve
 * cancellare quelli dei martedì successivi — è esattamente il motivo per cui le
 * occorrenze sono righe separate. "Annulla" e "Riapri" invece agiscono sulla
 * regola: sono i verbi con cui la pagina Automazioni mette in pausa e riattiva.
 */
function applySeriesStatusSideEffects(PDO $db, int $id, string $action): void
{
    if ($action !== 'cancel' && $action !== 'reopen') {
        return;
    }

    $stmt = $db->prepare("SELECT id, series_id, frequency FROM reminders WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row || $row['series_id'] !== null || $row['frequency'] === 'once') {
        return; // occorrenza singola: nessuna serie da toccare
    }

    if ($action === 'cancel') {
        $db->prepare("DELETE FROM reminders WHERE series_id = :id AND status = 'pending'")
           ->execute(['id' => $id]);
        return;
    }

    syncReminderSeries($db, $id);
}

/**
 * Elimina davvero.
 *
 * Prima questa funzione scriveva `status='cancelled'`, cioè esattamente ciò che
 * fa il pulsante pausa: entrambe le pagine che la chiamano chiedono "Eliminare
 * questo promemoria?", la UI rispondeva "eliminato", e la riga restava lì —
 * ricompariva al primo filtro "Tutte" e nessuno capiva perché. Chi vuole
 * sospendere senza perdere ha già `PATCH ?action=cancel`, che resta.
 *
 * Occorrenze della serie e righe del registro invii se ne vanno da sole:
 * `fk_reminders_series` e `fk_disp_reminder` sono ON DELETE CASCADE.
 * Cancellarle a mano qui sarebbe una seconda verità, destinata a divergere
 * dalla prima migrazione che tocca quelle chiavi.
 */
function deleteReminder(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT title, series_id FROM reminders WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    if (!$row) {
        apiError('Promemoria non trovato.', 404);
    }

    // Contate PRIMA: dopo il DELETE non esistono più, e l'agente ha diritto di
    // sapere quante occorrenze programmate sono sparite con la regola.
    $count = $db->prepare('SELECT COUNT(*) FROM reminders WHERE series_id = :id');
    $count->execute(['id' => $id]);
    $occurrences = (int) $count->fetchColumn();

    $db->prepare('DELETE FROM reminders WHERE id = :id')->execute(['id' => $id]);

    logActivity('delete', 'reminder', $id, 'Promemoria eliminato: ' . ($row['title'] ?: ('#' . $id)));
    apiSuccess([
        'id'          => $id,
        'occurrences' => $occurrences,
        'message'     => 'Promemoria eliminato.',
    ]);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateReminderInput(PDO $db, array $data): array
{
    $title        = trim($data['title'] ?? '');
    $description  = trim($data['description'] ?? '') ?: null;
    $reminderDate = trim($data['reminder_date'] ?? '');
    $frequency    = trim($data['frequency'] ?? 'once');
    $status       = trim($data['status'] ?? 'pending');
    $clientId     = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $leadId       = !empty($data['lead_id']) ? (int) $data['lead_id'] : null;
    $propertyId   = !empty($data['property_id']) ? (int) $data['property_id'] : null;
    $tenantId     = !empty($data['tenant_id']) ? (int) $data['tenant_id'] : null;
    $agentId      = !empty($data['assigned_agent_id']) ? (int) $data['assigned_agent_id'] : null;
    $notifyAdmin  = !empty($data['notify_admin']) ? 1 : 0;
    $notifyClient = !empty($data['notify_client']) ? 1 : 0;
    // Commerciale o di servizio. Da questo dipende se l'invio passa dal
    // registro consensi: vedi processSingleReminder() in config/reminders.php.
    $isMarketing  = !empty($data['is_marketing']) ? 1 : 0;
    // Un intervento di manutenzione E' un promemoria con request_type='maintenance':
    // e' cosi' che la bacheca lo trova (riga 182). Finora quella colonna la
    // scriveva SOLO il portale inquilino (tenant/api_maintenance.php:67), quindi
    // l'agenzia poteva leggere la bacheca ma non aprirci un intervento — nemmeno
    // per una segnalazione ricevuta al telefono.
    $requestType = trim($data['request_type'] ?? '') ?: null;
    if ($requestType !== null && !in_array($requestType, REMINDER_REQUEST_TYPES, true)) {
        apiError('Tipo di richiesta non valido.');
    }

    // Stato e priorita' si filtravano ma non si scrivevano: si potevano
    // cambiare solo con la PATCH dedicata, quindi un intervento nasceva sempre
    // senza priorita' — anche quando era urgente.
    $maintStatus = trim($data['maintenance_status'] ?? '') ?: null;
    if ($maintStatus !== null && !in_array($maintStatus, REMINDER_MAINTENANCE_STATUSES, true)) {
        apiError('Stato manutenzione non valido.');
    }
    $priority = trim($data['priority'] ?? '') ?: null;
    if ($priority !== null && !in_array($priority, REMINDER_PRIORITIES, true)) {
        apiError('Priorità non valida.');
    }

    $emailSubject = trim($data['email_subject'] ?? '') ?: null;
    $emailBody    = trim($data['email_body'] ?? '') ?: null;
    $endDateRaw   = trim($data['end_date'] ?? '');
    $endDate      = ($endDateRaw !== '' && preg_match('/^\d{4}-\d{2}-\d{2}/', $endDateRaw))
                    ? substr($endDateRaw, 0, 10) : null;

    // --- Programmazione fine (phase66) -------------------------------------
    $scheduleTime = trim($data['schedule_time'] ?? '');
    if ($scheduleTime !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $scheduleTime)) {
        apiError('Ora di invio non valida.');
    }
    $scheduleTime = $scheduleTime !== '' ? substr($scheduleTime, 0, 5) : null;

    $dayRule = trim($data['day_rule'] ?? '');
    if ($dayRule !== '' && !preg_match(REMINDER_DAY_RULE_PATTERN, $dayRule)) {
        apiError('Regola del giorno non valida.');
    }
    $dayRule = $dayRule !== '' ? $dayRule : null;

    // --- Trigger a evento ---------------------------------------------------
    $triggerType = trim($data['trigger_type'] ?? 'scheduled');
    if (!in_array($triggerType, ['scheduled', 'event'], true)) {
        apiError('Tipo di attivazione non valido.');
    }

    $triggerEvent  = trim($data['trigger_event'] ?? '') ?: null;
    $recipientRule = trim($data['recipient_rule'] ?? '') ?: null;
    $triggerDelay  = max(0, (int) ($data['trigger_delay_minutes'] ?? 0));

    $triggerFilter = null;

    if ($triggerType === 'event') {
        if (!isset(AUTOMATION_EVENT_CATALOGUE[$triggerEvent])) {
            apiError('Evento non valido.');
        }
        $allowed = AUTOMATION_EVENT_CATALOGUE[$triggerEvent]['recipients'];
        if (!in_array($recipientRule, $allowed, true)) {
            apiError('Destinatario non compatibile con l\'evento scelto.');
        }
        $triggerFilter = validateTriggerFilter($triggerEvent, $data['trigger_filter'] ?? null);
        // Una regola a evento non ha una cadenza: la data serve solo perché la
        // colonna è NOT NULL, e la frequenza resta 'once' per non farla entrare
        // nel materializzatore di serie.
        $frequency    = 'once';
        $reminderDate = $reminderDate !== '' ? $reminderDate : date('Y-m-d H:i:s');
        $endDate      = null;
        $dayRule      = null;
        $scheduleTime = null;
    } else {
        $triggerEvent  = null;
        $recipientRule = null;
        $triggerDelay  = 0;
    }

    if ($title === '') {
        apiError('Il titolo è obbligatorio.');
    }
    if ($reminderDate === '') {
        apiError('La data del promemoria è obbligatoria.');
    }

    // Il '!' azzera i campi non presenti nel formato. Senza, una data senza ora
    // ('2026-08-26') eredita l'OROLOGIO CORRENTE: l'automazione partiva ogni
    // mese all'ora in cui l'agente aveva premuto Salva. Con schedule_time
    // valorizzata l'orario viene poi imposto da normalizeReminderAnchor().
    $parsed = DateTime::createFromFormat('Y-m-d\TH:i', $reminderDate)
        ?: DateTime::createFromFormat('Y-m-d H:i:s', $reminderDate)
        ?: DateTime::createFromFormat('!Y-m-d', $reminderDate);

    if (!$parsed) {
        apiError('Formato data non valido.');
    }

    $anchor = normalizeReminderAnchor(
        $parsed->format('Y-m-d H:i:s'),
        $frequency,
        $dayRule,
        $scheduleTime
    );

    if (!in_array($frequency, REMINDER_FREQUENCIES, true)) {
        apiError('Frequenza non valida.');
    }
    if (!in_array($status, REMINDER_STATUSES, true)) {
        apiError('Stato non valido.');
    }

    // Il form invia un solo campo "Contatto" (tipo + id) invece di tre select.
    // Le chiamate storiche — scheda immobile, scheda inquilino, manutenzioni —
    // continuano a passare le FK esplicite, che restano valide.
    if (!empty($data['contact_type']) || !empty($data['contact_id'])) {
        $contactType = trim((string) ($data['contact_type'] ?? ''));
        $contactId   = (int) ($data['contact_id'] ?? 0);

        // Campo svuotato dall'agente: il contatto va rimosso, non conservato.
        $clientId = $leadId = $tenantId = null;

        if ($contactId > 0) {
            if (!isset(REMINDER_CONTACT_TYPES[$contactType])) {
                apiError('Tipo di contatto non valido.');
            }
            match ($contactType) {
                'client' => $clientId = $contactId,
                'lead'   => $leadId   = $contactId,
                'tenant' => $tenantId = $contactId,
            };
        }
    }

    // Auto-risoluzione: se il promemoria riguarda un immobile e nessuno ha
    // indicato un contatto, il proprietario è deducibile. Farlo digitare
    // all'agente è lavoro inutile e una fonte di incoerenze fra le due colonne.
    if ($propertyId && !$clientId && !$leadId && !$tenantId) {
        $owner = $db->prepare("SELECT client_id FROM properties WHERE id = :id");
        $owner->execute(['id' => $propertyId]);
        $ownerId = (int) ($owner->fetchColumn() ?: 0);
        if ($ownerId > 0) {
            $clientId = $ownerId;
        }
    }

    return [
        'title'             => $title,
        'description'       => $description,
        'reminder_date'     => $anchor,
        'end_date'          => $endDate,
        'frequency'         => $frequency,
        'schedule_time'     => $scheduleTime,
        'day_rule'          => $dayRule,
        'trigger_type'      => $triggerType,
        'trigger_event'     => $triggerEvent,
        'trigger_delay_minutes' => $triggerDelay,
        'recipient_rule'    => $recipientRule,
        'trigger_filter'    => $triggerFilter,
        'status'            => $status,
        'client_id'         => $clientId,
        'lead_id'           => $leadId,
        'property_id'       => $propertyId,
        'tenant_id'         => $tenantId,
        'assigned_agent_id' => $agentId,
        'notify_admin'      => $notifyAdmin,
        'notify_client'     => $notifyClient,
        'is_marketing'      => $isMarketing,
        'email_subject'     => $emailSubject,
        'email_body'        => $emailBody,
        // Manutenzione: e' `request_type` a far comparire la riga nella bacheca
        // (vedi il filtro in listReminders). Finora la scriveva solo il portale
        // inquilino, quindi l'agenzia poteva leggere la bacheca ma non aprirci
        // un intervento — nemmeno per una segnalazione ricevuta al telefono.
        'request_type'       => $requestType,
        'maintenance_status' => $maintStatus,
        'priority'           => $priority,
    ];
}

function reminderExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM reminders WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

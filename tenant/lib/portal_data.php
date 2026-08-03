<?php
/**
 * Portale Inquilino — strato dati.
 *
 * Tutte le letture del portale stanno qui, fuori dalla pagina, per un motivo
 * che non e' l'ordine: sono il perimetro di sicurezza. I commenti sulle query
 * dei documenti registrano DUE fughe gia' avvenute davvero (i documenti del
 * proprietario, e la carta d'identita' dell'inquilino precedente agganciata
 * allo stesso immobile). Tenerle in un unico posto significa che quel confine
 * si rilegge e si verifica in un file solo, invece di essere sparso nella vista.
 *
 * Regola per chi aggiunge una lettura: si filtra sull'IMMOBILE e sul CONTRATTO
 * dell'inquilino, MAI su `client_id` — quello e' il proprietario.
 */

require_once __DIR__ . '/../../config/portal_documents.php';

/**
 * Quante righe per pagina. Non sono piu' tetti: da qui in avanti c'e'
 * l'impaginatore, quindi lo storico e' raggiungibile tutto. Prima erano 36
 * rate e 30 documenti *in tutto* — e una locazione 4+4 ne ha 96, cioe' i due
 * terzi dello scadenzario non esistevano per l'inquilino.
 */
const TENANT_PAYMENTS_PER_PAGE = 12;
const TENANT_DOCS_PER_PAGE     = 10;
const TENANT_REQUESTS_PER_PAGE = 10;

/** Etichette italiane degli stati di pagamento. */
const TENANT_PAY_STATUS = [
    'pending'   => 'In attesa',
    'paid'      => 'Pagato',
    'late'      => 'In ritardo',
    'cancelled' => 'Annullato',
];

/**
 * I tipi di richiesta che il portale sa creare (vedi api_maintenance.php).
 * Serve anche a rileggerle: le righe `reminders` SENZA `request_type` sono
 * promemoria interni dell'agenzia e non devono comparire all'inquilino.
 */
const TENANT_REQUEST_TYPES = ['maintenance', 'document', 'info', 'other'];

/** Etichette delle richieste, per tipo. */
const TENANT_REQUEST_LABELS = [
    'maintenance' => 'Manutenzione',
    'document'    => 'Documento',
    'info'        => 'Informazioni',
    'other'       => 'Altro',
];

/**
 * Avanzamento di una richiesta. La bacheca dell'agenzia lavora su
 * `maintenance_status`, NON su `status` (vedi la nota in reminders): quello e'
 * il campo che l'inquilino deve vedere.
 */
const TENANT_REQUEST_PROGRESS = [
    'aperta'         => 'Ricevuta',
    'in_lavorazione' => 'In lavorazione',
    'completata'     => 'Completata',
    'chiusa'         => 'Chiusa',
];

/**
 * Normalizza un numero di pagina dentro l'intervallo reale.
 *
 * Il taglio NON e' silenzioso di proposito: restituisce anche quante pagine
 * esistono, cosi' la vista puo' scrivere "Pagina 3 di 8" con numeri veri. Un
 * clamp muto e' esattamente il difetto gia' visto altrove — l'utente chiede
 * pagina 99, ne riceve una diversa e nessuno glielo dice.
 *
 * @return array{page:int,pages:int,offset:int}
 */
function tenantPage(int $requested, int $total, int $perPage): array
{
    $pages  = max(1, (int) ceil($total / max(1, $perPage)));
    $page   = max(1, min($requested, $pages));
    return ['page' => $page, 'pages' => $pages, 'offset' => ($page - 1) * $perPage];
}

/**
 * Carica tutto cio' che il portale mostra.
 *
 * @param array $pages numeri di pagina richiesti: ['pay'=>1,'doc'=>1,'req'=>1]
 */
function loadTenantPortalData(PDO $db, int $tenantId, array $pages = []): array
{
    // Anagrafica. L'immobile e la locazione arrivano dal CONTRATTO in corso
    // (getTenantCurrentContract in config/db.php), non da una colonna fissa
    // sull'inquilino: la stessa persona puo' essere rilocata nel tempo.
    $stmt = $db->prepare("SELECT * FROM tenants WHERE id = :id");
    $stmt->execute(['id' => $tenantId]);
    $tenant = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

    $contract = $tenant ? getTenantCurrentContract($db, $tenantId) : null;

    if ($tenant) {
        foreach ([
            'property_id', 'address', 'city', 'cap', 'sqm', 'rooms',
            'description', 'lease_start', 'lease_end', 'monthly_rent',
        ] as $k) {
            $tenant[$k] = $contract[$k] ?? null;
        }
    }

    $propertyId = (int) ($tenant['property_id'] ?? 0);
    $contractId = (int) ($contract['contract_id'] ?? 0);

    return [
        'tenant'    => $tenant,
        'contract'  => $contract,
        'lease'     => tenantLeaseDetail($db, $contractId, $tenantId),
        'payments'  => tenantPayments($db, $tenantId, (int) ($pages['pay'] ?? 1)),
        'upcoming'  => tenantUpcoming($db, $tenantId),
        'totals'    => tenantPayTotals($db, $tenantId),
        'documents' => tenantDocuments($db, $propertyId, $contractId, (int) ($pages['doc'] ?? 1)),
        'requests'  => tenantRequests($db, $tenantId, (int) ($pages['req'] ?? 1)),
        'surveys'   => tenantPendingSurveys($db, $tenantId),
    ];
}

/**
 * Il contratto per esteso, per la scheda "Contratto".
 *
 * Il filtro tiene DUE condizioni: l'id del contratto *e* l'inquilino. La prima
 * da sola basterebbe finche' l'id arriva da getTenantCurrentContract, ma questa
 * funzione e' pubblica e domani qualcuno le passera' un id da una richiesta:
 * la seconda condizione fa si' che, quel giorno, non diventi una fuga.
 *
 * `notes` NON viene letta: sono appunti interni dell'agenzia sul contratto.
 */
function tenantLeaseDetail(PDO $db, int $contractId, int $tenantId): ?array
{
    if ($contractId <= 0) return null;

    $stmt = $db->prepare(
        "SELECT id, title, contract_type, contract_subtype, status,
                start_date, end_date, monthly_rent, deposit,
                registration_number, registration_date, registration_office,
                cedolare_secca, istat_update_enabled, istat_baseline_index,
                istat_baseline_month, last_istat_update
         FROM contracts
         WHERE id = :cid AND tenant_id = :tid
         LIMIT 1"
    );
    $stmt->execute(['cid' => $contractId, 'tid' => $tenantId]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

/** Storico rate, impaginato. */
function tenantPayments(PDO $db, int $tenantId, int $page): array
{
    $totalStmt = $db->prepare("SELECT COUNT(*) FROM payments WHERE tenant_id = :tid");
    $totalStmt->execute(['tid' => $tenantId]);
    $total = (int) $totalStmt->fetchColumn();

    $p = tenantPage($page, $total, TENANT_PAYMENTS_PER_PAGE);

    $stmt = $db->prepare(
        "SELECT id, amount, due_date, paid_date, status, notes
         FROM payments WHERE tenant_id = :tid
         ORDER BY due_date DESC
         LIMIT " . TENANT_PAYMENTS_PER_PAGE . " OFFSET " . $p['offset']
    );
    $stmt->execute(['tid' => $tenantId]);

    return ['rows' => $stmt->fetchAll(PDO::FETCH_ASSOC), 'total' => $total] + $p;
}

/** Le prossime tre scadenze non ancora saldate. */
function tenantUpcoming(PDO $db, int $tenantId): array
{
    $stmt = $db->prepare(
        "SELECT id, amount, due_date, status
         FROM payments
         WHERE tenant_id = :tid AND status IN ('pending','late') AND due_date >= CURDATE()
         ORDER BY due_date ASC LIMIT 3"
    );
    $stmt->execute(['tid' => $tenantId]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Totali dal DATABASE, non dalle righe della pagina corrente.
 *
 * Era un array_sum() sull'elenco TAGLIATO. Su una locazione 4+4 lo scadenzario
 * ha 96 rate e le piu' recenti sono in gran parte FUTURE, cioe' ancora da
 * pagare: l'inquilino leggeva un "totale pagato" piu' basso del vero dopo anni
 * di affitti versati puntualmente. Con l'impaginatore l'errore tornerebbe
 * identico, e peggiore: la somma cambierebbe cambiando pagina.
 */
function tenantPayTotals(PDO $db, int $tenantId): array
{
    $stmt = $db->prepare(
        "SELECT
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid_total,
            COALESCE(SUM(CASE WHEN status = 'late' THEN amount END), 0) AS late_total
         FROM payments WHERE tenant_id = :tid"
    );
    $stmt->execute(['tid' => $tenantId]);
    $r = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
    return [
        'paid' => (float) ($r['paid_total'] ?? 0),
        'late' => (float) ($r['late_total'] ?? 0),
    ];
}

/**
 * Documenti, impaginati.
 *
 * Perimetro ristretto alla locazione DI QUESTO inquilino: l'immobile affittato
 * o il proprio contratto. Deliberatamente NON la scheda cliente del
 * proprietario — filtrare per `client_id = owner` esponeva i documenti
 * personali del padrone di casa e le carte di ogni altro immobile.
 *
 * Il ramo "immobile" e' ristretto per tipo (config/portal_documents.php):
 * senza quel filtro l'inquilino attuale scaricava la carta d'identita' e i
 * verbali del precedente, agganciati allo stesso immobile. Dal proprio
 * contratto continua a vedere tutto, perche' quelli sono i suoi documenti.
 */
function tenantDocuments(PDO $db, int $propertyId, int $contractId, int $page): array
{
    $where = "(property_id IS NOT NULL AND property_id = :pid AND " . tenantPropertyDocTypesSql() . ")
              OR (contract_id IS NOT NULL AND contract_id = :cid)";
    $args  = ['pid' => $propertyId, 'cid' => $contractId];

    $totalStmt = $db->prepare("SELECT COUNT(*) FROM documents WHERE $where");
    $totalStmt->execute($args);
    $total = (int) $totalStmt->fetchColumn();

    $p = tenantPage($page, $total, TENANT_DOCS_PER_PAGE);

    $stmt = $db->prepare(
        "SELECT id, title, original_name, mime_type AS file_type, file_size, created_at, contract_id
         FROM documents WHERE $where
         ORDER BY created_at DESC
         LIMIT " . TENANT_DOCS_PER_PAGE . " OFFSET " . $p['offset']
    );
    $stmt->execute($args);

    return ['rows' => $stmt->fetchAll(PDO::FETCH_ASSOC), 'total' => $total] + $p;
}

/**
 * Le richieste inviate dall'inquilino, con il loro avanzamento.
 *
 * Fino a ieri questo elenco non esisteva: il modulo Assistenza scriveva in
 * `reminders` e la richiesta spariva: niente numero, niente stato, nessuna
 * risposta. Era l'unica cosa che il portale lasciasse fare, ed era un pozzo.
 *
 * Il filtro su `request_type` non e' cosmetico: le righe `reminders` legate a
 * un inquilino ma SENZA quel campo sono promemoria interni dell'agenzia
 * (scadenze, solleciti) e non vanno mostrate a chi ne e' l'oggetto.
 */
function tenantRequests(PDO $db, int $tenantId, int $page): array
{
    $in    = "'" . implode("','", TENANT_REQUEST_TYPES) . "'";
    $where = "tenant_id = :tid AND request_type IN ($in)";

    $totalStmt = $db->prepare("SELECT COUNT(*) FROM reminders WHERE $where");
    $totalStmt->execute(['tid' => $tenantId]);
    $total = (int) $totalStmt->fetchColumn();

    $p = tenantPage($page, $total, TENANT_REQUESTS_PER_PAGE);

    $stmt = $db->prepare(
        "SELECT id, title, description, request_type, maintenance_status, status,
                created_at, updated_at
         FROM reminders WHERE $where
         ORDER BY created_at DESC, id DESC
         LIMIT " . TENANT_REQUESTS_PER_PAGE . " OFFSET " . $p['offset']
    );
    $stmt->execute(['tid' => $tenantId]);

    return ['rows' => $stmt->fetchAll(PDO::FETCH_ASSOC), 'total' => $total] + $p;
}

/**
 * Sondaggi ancora da compilare.
 *
 * `tenant/survey.php` esiste da mesi ma vive solo sul link spedito via email:
 * chi lo perde non ha alcun modo di ritrovarlo. Qui il portale glielo rimette
 * davanti. Il token resta quello gia' emesso, non se ne creano di nuovi.
 */
function tenantPendingSurveys(PDO $db, int $tenantId): array
{
    $stmt = $db->prepare(
        "SELECT id, token, created_at
         FROM tenant_surveys
         WHERE tenant_id = :tid AND submitted_at IS NULL AND token IS NOT NULL AND token <> ''
         ORDER BY created_at DESC LIMIT 3"
    );
    $stmt->execute(['tid' => $tenantId]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

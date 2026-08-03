<?php
/**
 * Il contratto muove lo stato dell'immobile.
 *
 * Il buco che questo file chiude: `api/contracts.php` non toccava mai
 * `properties.status` e non emetteva alcun evento. Il ritiro automatico dai
 * portali (lib/portal_lifecycle.php) esisteva gia' e funzionava, ma ascoltava
 * `property.status_changed` — un evento che, per un immobile appena affittato,
 * non arrivava mai: qualcuno doveva ricordarsi di aprire la scheda immobile e
 * cambiare lo stato a mano. Finche' non lo faceva, la casa restava pubblicata e
 * continuava a occupare uno slot a pagamento e a generare richieste di visita
 * per un appartamento gia' occupato.
 *
 * Direzione: si sincronizza SOLO all'entrata in vigore (disponibile →
 * affittato). La scadenza NON rimette l'immobile a disponibile, ed e' una
 * scelta: alla fine di una locazione il rinnovo e' l'esito piu' comune, e
 * ripubblicare da soli la casa di un inquilino che sta rinnovando sarebbe un
 * danno peggiore del ritardo di una riga da aggiornare a mano. La scadenza
 * genera un promemoria (config/contract_expirations.php), che e' la richiesta
 * di una decisione umana — che e' quello che serve li'.
 */

require_once __DIR__ . '/portal_lifecycle.php';
require_once __DIR__ . '/../config/automation_events.php';
require_once __DIR__ . '/../config/activity_log.php';

/**
 * Una locazione occupa l'immobile quando e' in vigore: firmata o lasciata in
 * "Automatico" (NULL), decorrenza raggiunta, scadenza non ancora superata.
 * Bozze e contratti annullati non occupano nulla — la stessa regola del filtro
 * "Attivi" e della generazione dello scadenzario.
 */
function contractOccupiesProperty(array $contract, ?string $today = null): bool
{
    if (($contract['contract_type'] ?? '') !== 'locazione') {
        return false;
    }

    $status = $contract['status'] ?? null;
    if (!($status === null || $status === '' || $status === 'signed')) {
        return false;
    }

    $today = $today ?? date('Y-m-d');
    $start = $contract['start_date'] ?? null;
    $end   = $contract['end_date'] ?? null;

    if ($start === null || substr((string) $start, 0, 10) > $today) {
        return false; // decorrenza futura: l'immobile e' ancora libero
    }
    if ($end !== null && substr((string) $end, 0, 10) < $today) {
        return false; // gia' scaduto
    }

    return true;
}

/**
 * Porta l'immobile ad "affittato" e ritira le pubblicazioni attive.
 *
 * Non lancia mai: salvare il contratto e' l'operazione che l'agente ha chiesto,
 * e non deve fallire perche' la sincronizzazione dello stato immobile e' andata
 * storta. In compenso lascia traccia nel log.
 *
 * @return array{changed:bool, old_status:?string, retired:int}
 */
function contractSyncPropertyOccupancy(PDO $db, int $propertyId): array
{
    $out = ['changed' => false, 'old_status' => null, 'retired' => 0];
    if ($propertyId <= 0) return $out;

    try {
        $stmt = $db->prepare('SELECT status FROM properties WHERE id = :id');
        $stmt->execute(['id' => $propertyId]);
        $current = $stmt->fetch();
        if (!$current) return $out;

        $old = (string) $current['status'];
        $out['old_status'] = $old;

        // Si tocca solo 'available'. Un immobile 'sold' o 'archived' non torna
        // affittato per via di un contratto, e sovrascrivere quello stato
        // significherebbe che il gestionale ribalta una decisione presa
        // altrove — proprio il tipo di automatismo che fa perdere fiducia.
        if ($old !== 'available') return $out;

        $db->prepare('UPDATE properties SET status = :s WHERE id = :id')
           ->execute(['s' => 'rented', 'id' => $propertyId]);
        $out['changed'] = true;

        // Il ritiro si fa SUBITO, non solo tramite l'evento: la coda viene
        // drenata dal cron, e nel frattempo l'annuncio resterebbe online. La
        // chiamata e' idempotente (agisce solo su publishing/published), quindi
        // la reazione di sistema che scattera' sull'evento non fa danni.
        $out['retired'] = portalRetireListingsForProperty($db, $propertyId, 'rented');

        // L'evento serve comunque: le REGOLE dell'utente ("immobile affittato →
        // avvisa il proprietario") ascoltano property.status_changed e non
        // saprebbero nulla di questo cambio se lo facessimo in silenzio.
        emitAutomationEvent($db, 'property.status_changed', 'property', $propertyId, [
            'property_id' => $propertyId,
            'old_status'  => $old,
            'new_status'  => 'rented',
            'reason'      => 'contract',
        ]);
    } catch (Throwable $e) {
        error_log('[contratti] sincronizzazione stato immobile fallita (#' . $propertyId . '): ' . $e->getMessage());
    }

    return $out;
}

/* ==================================================================
 * Scadenzario dei canoni e nascita di una locazione.
 *
 * Queste funzioni stavano dentro api/contracts.php, cioe' valevano solo
 * per chi passava dal modulo Contratti. Ma una locazione nasce anche da
 * "Nuovo Inquilino" (api/tenants.php) e dalla conversione di un lead
 * (api/leads.php), e quelle due strade facevano un INSERT diretto con
 * status='signed': nessun controllo di doppia locazione, nessuno
 * scadenzario, immobile lasciato "disponibile" e annuncio ancora online.
 *
 * Cioe': il percorso PRINCIPALE dell'agenzia era quello che saltava tutte
 * le regole applicate al percorso secondario. Vivono qui perche' la
 * regola sia una sola, quale che sia la porta da cui si entra.
 * ================================================================== */

/**
 * Perche' un contratto non puo' avere uno scadenzario. Array vuoto = si puo'.
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
    //
    // Se il chiamante ha gia' aperto una transazione (la conversione di un lead
    // deve creare inquilino e contratto in blocco), non se ne apre una seconda:
    // PDO non annida, e beginTransaction() lancerebbe. In quel caso la
    // atomicita' e' responsabilita' di chi ha aperto.
    $ownTransaction = !$db->inTransaction();
    if ($ownTransaction) {
        $db->beginTransaction();
    }
    try {
        // Re-read + lock the contract row.
        $lock = $db->prepare("SELECT id FROM contracts WHERE id = :id FOR UPDATE");
        $lock->execute(['id' => $id]);

        // Uno scadenzario gia' presente non e' piu' un rifiuto secco: prorogare
        // un contratto (spostare end_date, il caso piu' comune nella vita di una
        // locazione) non produceva NESSUNA rata nuova e non c'era modo di
        // rigenerarlo — il canone dei mesi aggiunti non veniva mai richiesto e il
        // buco si scopriva a fine anno guardando i conti.
        //
        // Si aggiungono percio' solo le mensilita' FUORI dall'intervallo gia'
        // coperto: prima della prima rata o dopo l'ultima. Le eventuali lacune
        // interne restano intatte, perche' una rata cancellata a mano nel mezzo
        // (un mese di comodato, un canone azzerato) e' una decisione dell'agenzia
        // e non un buco da ricucire. Cosi' la seconda esecuzione su un contratto
        // invariato continua a non creare nulla.
        $rangeStmt = $db->prepare(
            "SELECT MIN(due_date) AS first_due, MAX(due_date) AS last_due, COUNT(*) AS n
               FROM payments WHERE contract_id = :cid"
        );
        $rangeStmt->execute(['cid' => $id]);
        $existing = $rangeStmt->fetch();

        $coveredFrom = ($existing && $existing['n'] > 0 && $existing['first_due'])
            ? DateTime::createFromFormat('!Y-m-d', $existing['first_due']) : null;
        $coveredTo   = ($existing && $existing['n'] > 0 && $existing['last_due'])
            ? DateTime::createFromFormat('!Y-m-d', $existing['last_due']) : null;

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

            // Gia' dentro il tratto coperto: non si tocca (vedi sopra).
            if ($coveredFrom && $coveredTo && $due >= $coveredFrom && $due <= $coveredTo) {
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

        if ($ownTransaction) {
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($ownTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    return $count;
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

/**
 * La locazione in vigore che si sovrappone a queste date, oppure null.
 *
 * Solo query: non decide cosa farne. api/contracts.php la traduce in un 409,
 * contractCreateLease() in una LeaseOverlapException.
 *
 * @param array{contract_type:string,status:?string,property_id:int,start_date:?string,end_date:?string} $v
 */
function leaseOverlapConflict(PDO $db, array $v, ?int $excludeId = null): ?array
{
    $inForce = $v['status'] === null || $v['status'] === 'signed';
    if ($v['contract_type'] !== 'locazione' || !$inForce || $v['start_date'] === null) {
        return null;
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

    return $stmt->fetch() ?: null;
}

/**
 * Doppia prenotazione rilevata mentre si creava una locazione.
 *
 * Porta lo stesso testo che il modulo Contratti mostra da sempre: l'agente
 * legge la stessa frase da qualunque porta sia entrato.
 */
class LeaseOverlapException extends RuntimeException
{
    /** @var array{id:int,title:string,start_date:string,end_date:?string} */
    public array $conflict;

    public function __construct(array $conflict)
    {
        $this->conflict = $conflict;
        $range = $conflict['start_date'] . ' → ' . ($conflict['end_date'] ?: 'aperto');
        parent::__construct(
            "Doppia prenotazione: l'immobile ha già un contratto di locazione in vigore che si sovrappone alle date indicate "
            . "(#{$conflict['id']} «{$conflict['title']}», {$range}). Modifica le date oppure annulla l'altro contratto."
        );
    }
}

/**
 * Crea una locazione facendole attraversare le stesse guardie e le stesse
 * conseguenze del salvataggio dal modulo Contratti:
 *
 *   1. rifiuta la doppia locazione sullo stesso immobile (LeaseOverlapException)
 *   2. genera lo scadenzario dei canoni
 *   3. porta l'immobile ad "affittato" e ritira le pubblicazioni dai portali
 *
 * @param array $lease property_id, tenant_id, client_id, title, start_date,
 *                     end_date, monthly_rent, created_by, status (default 'signed')
 * @return array{id:int, payments_created:int, occupancy:array}
 * @throws LeaseOverlapException
 */
function contractCreateLease(PDO $db, array $lease): array
{
    $propertyId = (int) $lease['property_id'];
    $status     = array_key_exists('status', $lease) ? $lease['status'] : 'signed';
    $startDate  = ($lease['start_date'] ?? null) ?: null;
    $endDate    = ($lease['end_date'] ?? null) ?: null;

    $conflict = leaseOverlapConflict($db, [
        'contract_type' => 'locazione',
        'status'        => $status,
        'property_id'   => $propertyId,
        'start_date'    => $startDate,
        'end_date'      => $endDate,
    ]);
    if ($conflict) {
        throw new LeaseOverlapException($conflict);
    }

    $db->prepare(
        "INSERT INTO contracts
            (property_id, tenant_id, client_id, title, contract_type, status, start_date, end_date, monthly_rent, created_by)
         VALUES
            (:property_id, :tenant_id, :client_id, :title, 'locazione', :status, :start_date, :end_date, :monthly_rent, :created_by)"
    )->execute([
        'property_id'  => $propertyId,
        'tenant_id'    => (int) $lease['tenant_id'],
        'client_id'    => $lease['client_id'] ?: null,
        'title'        => $lease['title'],
        'status'       => $status,
        'start_date'   => $startDate,
        'end_date'     => $endDate,
        'monthly_rent' => $lease['monthly_rent'] ?? null,
        'created_by'   => $lease['created_by'] ?? null,
    ]);
    $contractId = (int) $db->lastInsertId();

    $payments  = autoGeneratePaymentSchedule($db, $contractId);
    $occupancy = contractSyncOccupancyForContract($db, $contractId);

    return ['id' => $contractId, 'payments_created' => $payments, 'occupancy' => $occupancy];
}

/**
 * Porta avanti il contratto quando la firma elettronica e' stata raccolta.
 *
 * Prima la firma toccava solo esign_requests: il cliente aveva firmato ma nel
 * gestionale il contratto restava "Inviato", non generava lo scadenzario, non
 * portava l'immobile ad affittato e non ritirava l'annuncio dai portali.
 * Qualcuno doveva ricordarsene a mano, e nessuna schermata lo diceva.
 *
 * Un contratto puo' avere PIU' firmatari (locatore e conduttore): finche' ne
 * resta uno in attesa non e' firmato, quindi non si avanza. Una richiesta
 * scaduta e mai firmata conta come mancante — perche' e' esattamente quello
 * che e' — e sblocca solo dopo che l'agente l'ha revocata o rispedita.
 *
 * @return array{advanced:bool, reason:string, payments_created:int, occupancy:array}
 */
function contractAdvanceAfterSignature(PDO $db, int $contractId): array
{
    $out = ['advanced' => false, 'reason' => '', 'payments_created' => 0,
            'occupancy' => ['changed' => false, 'old_status' => null, 'retired' => 0]];
    if ($contractId <= 0) {
        $out['reason'] = 'nessun contratto collegato';
        return $out;
    }

    try {
        $stmt = $db->prepare('SELECT id, status FROM contracts WHERE id = :id');
        $stmt->execute(['id' => $contractId]);
        $contract = $stmt->fetch();
        if (!$contract) {
            $out['reason'] = 'contratto inesistente';
            return $out;
        }

        // 'signed' e' gia' a posto; 'cancelled' e' una decisione presa altrove
        // e una firma non la ribalta.
        if (!in_array((string) $contract['status'], ['draft', 'sent', 'expired'], true)) {
            $out['reason'] = 'stato non avanzabile: ' . $contract['status'];
            return $out;
        }

        $pend = $db->prepare(
            "SELECT COUNT(*) FROM esign_requests WHERE contract_id = :cid AND status = 'pending'"
        );
        $pend->execute(['cid' => $contractId]);
        if ((int) $pend->fetchColumn() > 0) {
            $out['reason'] = 'altri firmatari ancora in attesa';
            return $out;
        }

        $db->prepare("UPDATE contracts SET status = 'signed' WHERE id = :id")
           ->execute(['id' => $contractId]);
        $out['advanced'] = true;
        $out['reason']   = 'contratto portato a firmato';

        // Le stesse due conseguenze del salvataggio dal modulo Contratti.
        $out['payments_created'] = autoGeneratePaymentSchedule($db, $contractId);
        $out['occupancy']        = contractSyncOccupancyForContract($db, $contractId);

        logActivity(
            'update', 'contract', $contractId,
            'Contratto #' . $contractId . ' portato a firmato dalla firma elettronica'
            . ($out['payments_created'] > 0 ? ' — ' . $out['payments_created'] . ' rate generate' : '')
            . ($out['occupancy']['changed'] ? ' — immobile affittato' : '')
        );
    } catch (Throwable $e) {
        // La firma e' gia' registrata e vale: non deve fallire per colpa di
        // cio' che viene dopo. Resta la traccia nel log del server.
        error_log('[firma] avanzamento contratto #' . $contractId . ' fallito: ' . $e->getMessage());
        $out['reason'] = 'errore: ' . $e->getMessage();
    }

    return $out;
}

/**
 * Come contractSyncPropertyOccupancy, ma partendo dal contratto: rilegge la
 * riga scritta e agisce solo se quel contratto occupa davvero l'immobile
 * (firmato/automatico, decorrenza raggiunta, non ancora scaduto).
 *
 * @return array{changed:bool, old_status:?string, retired:int}
 */
function contractSyncOccupancyForContract(PDO $db, int $contractId): array
{
    $stmt = $db->prepare('SELECT * FROM contracts WHERE id = :id');
    $stmt->execute(['id' => $contractId]);
    $row = $stmt->fetch();

    if (!$row || !contractOccupiesProperty($row)) {
        return ['changed' => false, 'old_status' => null, 'retired' => 0];
    }

    return contractSyncPropertyOccupancy($db, (int) $row['property_id']);
}

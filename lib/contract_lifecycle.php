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
 * Rinnovo, disdetta e preavviso (phase99).
 *
 * In una locazione italiana la scadenza non e' un evento: e' l'esito di
 * una decisione che va presa mesi prima. Se nessuno manda la disdetta
 * entro il preavviso, il contratto si rinnova da solo — e quel silenzio
 * vale quanto una firma.
 * ================================================================== */

/**
 * Preavviso e rinnovo tipici per tipo di locazione.
 *
 * Sono valori PROPOSTI, non verita': il contratto firmato comanda su questa
 * tabella, e ogni riga puo' sovrascriverli (colonne `notice_months`,
 * `renewal_months`, `auto_renew`). Servono a non far partire un contratto con
 * il preavviso vuoto, che e' il modo in cui la scadenza arriva addosso.
 *
 * `renewal_months` nullo con `auto_renew` vero = "per un periodo uguale al
 * primo": e' il caso degli studenti, e scriverci un numero significherebbe
 * indovinare una durata che dipende dal contratto.
 *
 * Non e' consulenza legale: la durata di legge la verifica chi redige il
 * contratto. Qui si evita solo il valore mancante.
 */
const LEASE_TERMS = [
    '4+4'         => ['notice' => 6,  'renewal' => 48,   'auto' => 1],
    '3+2'         => ['notice' => 6,  'renewal' => 24,   'auto' => 1],
    'commerciale' => ['notice' => 12, 'renewal' => 72,   'auto' => 1],
    'studenti'    => ['notice' => 3,  'renewal' => null, 'auto' => 1],
    'transitorio' => ['notice' => 0,  'renewal' => 0,    'auto' => 0],
    'comodato'    => ['notice' => 0,  'renewal' => 0,    'auto' => 0],
];

/**
 * I termini che valgono per un contratto: quelli scritti sulla riga se ci sono,
 * altrimenti i predefiniti del tipo, altrimenti niente.
 *
 * @return array{notice:?int, renewal:?int, auto:bool}
 */
function leaseTermsFor(array $contract): array
{
    $preset = LEASE_TERMS[(string) ($contract['contract_subtype'] ?? '')] ?? null;

    $notice = $contract['notice_months'] ?? null;
    if ($notice === null || $notice === '') {
        $notice = $preset['notice'] ?? null;
    }

    $renewal = $contract['renewal_months'] ?? null;
    if ($renewal === null || $renewal === '') {
        $renewal = $preset['renewal'] ?? null;
    }

    // `auto_renew` e' NOT NULL con DEFAULT 0, quindi una riga salvata dice
    // sempre la sua: il preset entra solo quando la colonna non c'e' proprio
    // (contratto costruito a mano in un test, o letto da una query parziale).
    $auto = array_key_exists('auto_renew', $contract)
        ? (bool) $contract['auto_renew']
        : (bool) ($preset['auto'] ?? 0);

    return [
        'notice'  => $notice === null ? null : (int) $notice,
        'renewal' => $renewal === null ? null : (int) $renewal,
        'auto'    => $auto,
    ];
}

/**
 * Entro quando va mandata la disdetta perche' il contratto non si rinnovi.
 *
 * Restituisce null quando la domanda non ha senso: nessuna scadenza, nessun
 * preavviso, o disdetta gia' registrata (la decisione e' presa).
 *
 * Il calcolo usa `-N months` su una data ISO. Attenzione al trabocco di fine
 * mese di PHP — 31 marzo meno 1 mese fa 3 marzo, non 28 febbraio: qui si
 * sottraggono mesi da una scadenza che nella pratica cade a fine mese, quindi
 * si normalizza all'ultimo giorno del mese di arrivo quando la data trabocca.
 */
function contractNoticeDeadline(array $contract): ?string
{
    $end = $contract['end_date'] ?? null;
    if (!$end) return null;
    if (!empty($contract['termination_notice_date'])) return null;

    $terms = leaseTermsFor($contract);
    if (empty($terms['notice'])) return null;

    return contractShiftMonths(substr((string) $end, 0, 10), -(int) $terms["notice"]);
}

/**
 * Sposta una data ISO di N mesi (negativo = indietro) restando dentro il mese
 * di arrivo.
 *
 * `strtotime('-1 month')` sul 31 marzo produce il 3 marzo, perche' il 31
 * febbraio non esiste e PHP trabocca in avanti. Su una data di preavviso quel
 * traboccamento sposta il termine dalla parte sbagliata, e le scadenze delle
 * locazioni cadono quasi sempre a fine mese: e' il caso normale, non il caso
 * limite.
 *
 * Esiste un gemello in `config/reminders.php` (`addMonthsClamped`) che fa la
 * stessa aritmetica su oggetti DateTime, per le ricorrenze dei promemoria.
 * Sono due firme diverse per due strati diversi; se un giorno se ne unifica
 * una sola, e' questo il commento da cui partire.
 */
function contractShiftMonths(string $isoDate, int $months): ?string
{
    $d = DateTime::createFromFormat('!Y-m-d', $isoDate);
    if (!$d) return null;
    if ($months === 0) return $d->format('Y-m-d');

    $day = (int) $d->format('d');
    // Ci si sposta dal primo del mese, dove il trabocco non puo' avvenire, e
    // solo dopo si rimette il giorno — tagliato alla lunghezza del mese.
    $sign   = $months > 0 ? '+' : '-';
    $anchor = (clone $d)->modify('first day of this month')
                        ->modify($sign . abs($months) . ' months');

    return $anchor->setDate(
        (int) $anchor->format('Y'),
        (int) $anchor->format('m'),
        min($day, (int) $anchor->format('t'))
    )->format('Y-m-d');
}

/**
 * Durata del contratto in mesi interi, dalla decorrenza alla scadenza.
 * Serve al rinnovo "per un periodo uguale al primo".
 */
function contractDurationMonths(array $contract): ?int
{
    $start = $contract['start_date'] ?? null;
    $end   = $contract['end_date'] ?? null;
    if (!$start || !$end) return null;

    $a = DateTime::createFromFormat('!Y-m-d', substr((string) $start, 0, 10));
    $b = DateTime::createFromFormat('!Y-m-d', substr((string) $end, 0, 10));
    if (!$a || !$b || $b <= $a) return null;

    $diff = $a->diff($b);
    $months = $diff->y * 12 + $diff->m;
    // Una locazione 1/1/2026 → 31/12/2029 misura 3 anni, 11 mesi e 30 giorni:
    // sono 48 mesi meno un giorno, e arrotondare per difetto darebbe 47.
    if ($diff->d >= 28) $months++;

    return $months > 0 ? $months : null;
}

/**
 * Rinnova una locazione: sposta la scadenza in avanti e riempie lo scadenzario.
 *
 * Le due cose vanno insieme, e non e' un dettaglio: prorogare senza generare le
 * rate dei mesi aggiunti significa un canone che non viene mai richiesto: il
 * contratto e' in vigore, l'inquilino ci abita, e nello scadenzario quei mesi
 * non esistono. `insertPaymentSchedule()` riempie solo i buchi, quindi qui si
 * puo' chiamare senza toccare le rate gia' presenti.
 *
 * @param int|null $months Durata del rinnovo. Null = quella prevista dal tipo,
 *                         e se il tipo non la fissa (studenti) la stessa durata
 *                         del primo periodo.
 * @return array{ok:bool, error:?string, old_end:?string, new_end:?string, payments:int, months:int}
 */
function contractRenew(PDO $db, array $contract, ?int $months = null): array
{
    $fail = fn(string $msg) => ['ok' => false, 'error' => $msg, 'old_end' => null,
                                'new_end' => null, 'payments' => 0, 'months' => 0];

    if (($contract['contract_type'] ?? '') !== 'locazione') {
        return $fail('Il rinnovo è previsto solo per i contratti di locazione.');
    }
    if (($contract['status'] ?? null) === 'cancelled') {
        return $fail('Un contratto annullato non si rinnova.');
    }
    if (!empty($contract['termination_notice_date'])) {
        return $fail('Su questo contratto è registrata una disdetta: annullala prima di rinnovare.');
    }
    $end = $contract['end_date'] ?? null;
    if (!$end) {
        return $fail('Il contratto non ha una data di fine: non c\'è una scadenza da spostare.');
    }

    $terms = leaseTermsFor($contract);
    $months = $months ?? $terms['renewal'] ?? contractDurationMonths($contract);

    if (!$months || $months <= 0) {
        return $fail('Durata del rinnovo non determinabile: indicala a mano.');
    }

    $oldEnd = substr((string) $end, 0, 10);
    $newEnd = contractShiftMonths($oldEnd, (int) $months);
    if (!$newEnd) {
        return $fail('Data di fine non valida.');
    }

    $id = (int) $contract['id'];
    $db->prepare(
        "UPDATE contracts
            SET end_date = :end, renewal_count = renewal_count + 1
          WHERE id = :id"
    )->execute(['end' => $newEnd, 'id' => $id]);

    // Le rate si generano sulla riga AGGIORNATA, non su quella che il chiamante
    // aveva in mano: e' la nuova scadenza a dire fin dove arrivare.
    $fresh = $db->prepare('SELECT * FROM contracts WHERE id = :id');
    $fresh->execute(['id' => $id]);
    $updated = $fresh->fetch(PDO::FETCH_ASSOC) ?: [];

    $payments = 0;
    if (!paymentScheduleBlockers($updated) && contractIsInForce($updated)) {
        $created = insertPaymentSchedule($db, $updated);
        $payments = $created > 0 ? $created : 0;
    }

    logActivity('update', 'contract', $id,
        'Contratto rinnovato di ' . $months . ' mesi: scadenza ' . $oldEnd . ' → ' . $newEnd
        . ($payments ? " (+$payments rate)" : ''));

    return ['ok' => true, 'error' => null, 'old_end' => $oldEnd, 'new_end' => $newEnd,
            'payments' => $payments, 'months' => (int) $months];
}

/**
 * Registra la disdetta di una locazione.
 *
 * Quattro fatti, tutti dell'agente: chi ha disdetto, quando ha mandato la
 * comunicazione, perche', e da quando il contratto non e' piu' in vigore.
 * L'ultima non si deduce dalle altre — una disdetta alla scadenza lascia la
 * fine dov'era, un recesso del conduttore la anticipa di mesi.
 *
 * Quando la fine si anticipa, `end_date` viene spostata li'. E' `end_date` che
 * tutto il resto legge per sapere se un contratto e' in vigore (filtro Attivi,
 * occupazione dell'immobile, scadenzario): lasciarla al valore contrattuale
 * avrebbe significato un immobile occupato da una locazione gia' chiusa e rate
 * che continuano a scadere. La data originale finisce in `original_end_date`.
 *
 * Le rate successive alla fine si ANNULLANO, non si cancellano: una rata
 * emessa e' un fatto, e quelle gia' incassate non si toccano mai.
 *
 * @return array{ok:bool, error:?string, cancelled_payments:int, end_moved:bool, new_end:?string}
 */
function contractTerminate(PDO $db, array $contract, array $input): array
{
    $fail = fn(string $msg) => ['ok' => false, 'error' => $msg, 'cancelled_payments' => 0,
                                'end_moved' => false, 'new_end' => null];

    if (($contract['contract_type'] ?? '') !== 'locazione') {
        return $fail('La disdetta è prevista solo per i contratti di locazione.');
    }
    if (($contract['status'] ?? null) === 'cancelled') {
        return $fail('Il contratto è annullato: non c\'è nulla da disdire.');
    }

    $by = trim((string) ($input['terminated_by'] ?? ''));
    if (!in_array($by, ['locatore', 'conduttore'], true)) {
        return $fail('Indica chi ha mandato la disdetta: locatore o conduttore.');
    }

    $noticeDate = trim((string) ($input['termination_notice_date'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $noticeDate)) {
        return $fail('Data della comunicazione mancante o non valida.');
    }

    $effective = trim((string) ($input['termination_effective_date'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $effective)) {
        return $fail('Data di fine locazione mancante o non valida.');
    }

    // Una locazione non finisce prima che la disdetta sia stata mandata.
    if ($effective < $noticeDate) {
        return $fail('La fine della locazione non può precedere la comunicazione della disdetta.');
    }

    $start = substr((string) ($contract['start_date'] ?? ''), 0, 10);
    if ($start && $effective < $start) {
        return $fail('La fine della locazione non può precedere la sua decorrenza.');
    }

    $id     = (int) $contract['id'];
    $oldEnd = $contract['end_date'] ? substr((string) $contract['end_date'], 0, 10) : null;
    $moves  = $oldEnd !== null && $effective < $oldEnd;

    $sql = "UPDATE contracts
               SET termination_notice_date = :notice,
                   terminated_by = :by,
                   termination_reason = :reason,
                   termination_effective_date = :eff,
                   auto_renew = 0";
    $args = [
        'notice' => $noticeDate,
        'by'     => $by,
        'reason' => trim((string) ($input['termination_reason'] ?? '')) ?: null,
        'eff'    => $effective,
        'id'     => $id,
    ];

    if ($moves) {
        // `original_end_date` si scrive solo la prima volta: una seconda
        // disdetta non deve sovrascrivere la scadenza contrattuale vera con
        // quella gia' anticipata da quella precedente.
        $sql .= ", original_end_date = COALESCE(original_end_date, end_date), end_date = :eff2";
        $args['eff2'] = $effective;
    }

    $db->prepare($sql . ' WHERE id = :id')->execute($args);

    // Le rate oltre la fine non sono piu' dovute. Solo quelle in attesa o in
    // ritardo: una rata gia' pagata resta com'e', e annullarla creerebbe un
    // buco in cassa che non corrisponde a niente.
    $cancel = $db->prepare(
        "UPDATE payments
            SET status = 'cancelled',
                notes = TRIM(CONCAT(COALESCE(notes,''), ' [annullata: disdetta del ', :notice, ']'))
          WHERE contract_id = :id
            AND due_date > :eff
            AND status IN ('pending','late')"
    );
    $cancel->execute(['id' => $id, 'eff' => $effective, 'notice' => $noticeDate]);
    $cancelled = $cancel->rowCount();

    logActivity('update', 'contract', $id,
        'Disdetta registrata (' . $by . ', comunicata il ' . $noticeDate . '): fine locazione '
        . $effective . ($moves ? " (era $oldEnd)" : '')
        . ($cancelled ? " — $cancelled rate annullate" : ''));

    return ['ok' => true, 'error' => null, 'cancelled_payments' => $cancelled,
            'end_moved' => $moves, 'new_end' => $moves ? $effective : $oldEnd];
}

/**
 * Cancella una disdetta registrata per errore e rimette la scadenza dov'era.
 *
 * Le rate annullate NON si riattivano da sole: rigenerare lo scadenzario le
 * ricrea dove servono, e riaprire d'ufficio delle rate che qualcuno potrebbe
 * aver gia' sistemato a mano sarebbe peggio del rifarle apposta.
 */
function contractCancelTermination(PDO $db, array $contract): array
{
    if (empty($contract['termination_notice_date'])) {
        return ['ok' => false, 'error' => 'Su questo contratto non c\'è nessuna disdetta registrata.'];
    }

    $id      = (int) $contract['id'];
    $restore = $contract['original_end_date'] ?? null;

    $sql = "UPDATE contracts
               SET termination_notice_date = NULL, terminated_by = NULL,
                   termination_reason = NULL, termination_effective_date = NULL";
    $args = ['id' => $id];

    if ($restore) {
        $sql .= ", end_date = :restore, original_end_date = NULL";
        $args['restore'] = substr((string) $restore, 0, 10);
    }

    $db->prepare($sql . ' WHERE id = :id')->execute($args);

    logActivity('update', 'contract', $id, 'Disdetta annullata sul contratto #' . $id
        . ($restore ? ' — scadenza ripristinata al ' . substr((string) $restore, 0, 10) : ''));

    return ['ok' => true, 'error' => null, 'restored_end' => $restore];
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
 * Un periodo rovesciato — la fine prima dell'inizio — non e' un contratto.
 *
 * Il modulo Contratti lo rifiutava gia'; il modulo Inquilino no, e da li' la
 * locazione entrava in tabella senza un fiato. Il danno non si vedeva dove era
 * stato fatto: "Genera scadenzario" rispondeva «0 pagamenti creati» con l'aria
 * di essere andato a buon fine — il ciclo esce alla prima iterazione, perche'
 * la prima scadenza cade gia' oltre la fine — e in elenco il contratto nasceva
 * "Scaduto" il giorno stesso della firma. Un canone che non viene mai richiesto
 * e' il tipo di errore che si scopre a fine anno guardando i conti.
 *
 * Confronto tra stringhe: il formato e' Y-m-d, ordinabile lessicograficamente,
 * quindi non serve costruire due DateTime. Il periodo aperto (fine assente) e'
 * legittimo e non e' affar suo, come non lo e' la forma delle date: chi chiama
 * le ha gia' validate.
 */
function leaseDatesOutOfOrder(?string $startDate, ?string $endDate): bool
{
    if (($startDate ?? '') === '' || ($endDate ?? '') === '') {
        return false;
    }

    return substr($endDate, 0, 10) < substr($startDate, 0, 10);
}

/**
 * Il testo del rifiuto, uno solo: l'agente legge la stessa frase da qualunque
 * porta sia entrato — modulo Contratti, modulo Inquilino o conversione lead.
 */
function leaseDateOrderMessage(): string
{
    return 'La data di fine non può precedere la data di inizio.';
}

/**
 * Periodo rovesciato rilevato mentre si creava una locazione.
 */
class LeaseDateOrderException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct(leaseDateOrderMessage());
    }
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
 *   1. rifiuta il periodo rovesciato (LeaseDateOrderException)
 *   2. rifiuta la doppia locazione sullo stesso immobile (LeaseOverlapException)
 *   3. genera lo scadenzario dei canoni
 *   4. porta l'immobile ad "affittato" e ritira le pubblicazioni dai portali
 *
 * @param array $lease property_id, tenant_id, client_id, title, start_date,
 *                     end_date, monthly_rent, created_by, status (default 'signed')
 * @return array{id:int, payments_created:int, occupancy:array}
 * @throws LeaseDateOrderException
 * @throws LeaseOverlapException
 */
function contractCreateLease(PDO $db, array $lease): array
{
    $propertyId = (int) $lease['property_id'];
    $status     = array_key_exists('status', $lease) ? $lease['status'] : 'signed';
    $startDate  = ($lease['start_date'] ?? null) ?: null;
    $endDate    = ($lease['end_date'] ?? null) ?: null;

    // Prima della doppia prenotazione: con le date rovesciate anche il controllo
    // di sovrapposizione ragionerebbe su un intervallo che non esiste.
    if (leaseDatesOutOfOrder($startDate, $endDate)) {
        throw new LeaseDateOrderException();
    }

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

<?php
/**
 * Automazioni a evento.
 *
 * Lo scheduler a orologio copre "ogni mese mando il report". Non copre ciò che
 * un'agenzia fa davvero di reattivo: ribasso il prezzo → avviso chi cercava
 * quella casa; visita conclusa → chiedo un riscontro qualche ora dopo.
 *
 * Impianto deliberatamente parassitario del motore promemoria esistente:
 *
 *   1. le API ACCODANO un evento (`automation_events`). Nessun invio dentro il
 *      ciclo di richiesta: un SMTP lento non deve rallentare il salvataggio di
 *      un immobile, né farlo fallire se l'email non parte.
 *   2. il cron drena la coda, trova le REGOLE che ascoltano quell'evento e
 *      materializza un'occorrenza per destinatario (series_id → regola,
 *      trigger_type 'scheduled', data = evento + ritardo).
 *   3. da lì in poi non esiste più nulla di speciale: se ne occupa
 *      processDueReminders(), con i suoi token, il suo registro invii e la sua
 *      risoluzione del destinatario.
 *
 * Il ritardo è il motivo per cui il passo 2 crea una riga invece di spedire:
 * «richiesta di feedback 2 ore dopo la visita» è una data futura, ed è già
 * esattamente ciò che una riga promemoria sa rappresentare.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/matching.php';
require_once __DIR__ . '/automation_templates.php';
require_once __DIR__ . '/lead_sources.php';

/**
 * Eventi ascoltabili. `recipients` elenca le strategie di destinatario che
 * hanno senso per quell'evento: il form mostra solo quelle.
 *
 * `filters` dichiara i campi del payload su cui una regola puo' restringersi.
 * Serviva perche' l'evento e' piu' grosso della regola: "nuovo lead" scatta
 * anche quando l'agente digita a mano il contatto che ha appena sentito al
 * telefono, e un «grazie per averci scritto» a quella persona e' sbagliato.
 * Chiave = campo del payload, `options` = valori ammessi (etichettati per il
 * form), `default` = preselezione di una regola nuova.
 */
const AUTOMATION_EVENT_CATALOGUE = [
    'lead.created' => [
        'label'       => 'Nuovo lead registrato',
        'description' => 'Scatta quando un contatto entra in rubrica (form, portale, import).',
        'entity'      => 'lead',
        'recipients'  => ['event_contact'],
        'filters'     => [
            'source' => [
                'label'   => 'Solo per queste fonti',
                'hint'    => 'Un lead inserito a mano dopo una telefonata non ha scritto niente: lasciare "Telefono" spento evita di ringraziarlo per un messaggio che non ha mandato.',
                'options' => LEAD_SOURCE_LABELS,
                'default' => LEAD_SOURCES_INBOUND,
            ],
        ],
    ],
    'appointment.completed' => [
        'label'       => 'Appuntamento concluso',
        'description' => 'Scatta quando una visita passa in stato "completato".',
        'entity'      => 'appointment',
        'recipients'  => ['event_contact', 'property_owner'],
    ],
    'property.status_changed' => [
        'label'       => 'Stato immobile cambiato',
        'description' => 'Scatta quando un immobile passa a venduto/affittato/archiviato o torna disponibile. '
                       . 'Indipendentemente dalle regole configurate qui, il sistema ritira da solo le pubblicazioni attive sui portali.',
        'entity'      => 'property',
        'recipients'  => ['property_owner'],
    ],
    'property.price_reduced' => [
        'label'       => 'Prezzo immobile ribassato',
        'description' => 'Scatta solo sui ribassi, non su ogni modifica di prezzo.',
        'entity'      => 'property',
        'recipients'  => ['matching_leads', 'property_owner'],
    ],
];

const AUTOMATION_RECIPIENT_RULES = [
    'event_contact'  => 'Il contatto coinvolto nell\'evento',
    'property_owner' => 'Il proprietario dell\'immobile',
    'matching_leads' => 'I lead con ricerca compatibile (max 5)',
];

/** Tetto per fan-out: un ribasso non deve generare centinaia di email. */
const AUTOMATION_MAX_RECIPIENTS = 25;

// ---------------------------------------------------------------------------
// Produzione
// ---------------------------------------------------------------------------

/**
 * Accoda un evento. Non lancia mai: un errore qui non deve far fallire
 * l'operazione di business che l'ha generato (salvare l'immobile è più
 * importante che notificarne il ribasso).
 */
function emitAutomationEvent(PDO $db, string $type, string $entityType, int $entityId, array $payload = []): void
{
    if (!isset(AUTOMATION_EVENT_CATALOGUE[$type])) {
        error_log('[automations] evento sconosciuto ignorato: ' . $type);
        return;
    }

    try {
        $stmt = $db->prepare(
            "INSERT INTO automation_events
                (event_type, entity_type, entity_id, payload, occurred_at, status)
             VALUES (:type, :entity_type, :entity_id, :payload, NOW(), 'pending')"
        );
        $stmt->execute([
            'type'        => $type,
            'entity_type' => $entityType,
            'entity_id'   => $entityId,
            'payload'     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);
    } catch (PDOException $e) {
        error_log('[automations] evento non accodato (' . $type . '): ' . $e->getMessage());
    }
}

// ---------------------------------------------------------------------------
// Consumo (cron)
// ---------------------------------------------------------------------------

/**
 * Drena la coda eventi e materializza le occorrenze.
 *
 * @return array{events:int, occurrences:int, details:array}
 */
function processPendingAutomationEvents(PDO $db): array
{
    try {
        $events = $db->query(
            "SELECT * FROM automation_events
             WHERE status = 'pending'
             ORDER BY occurred_at ASC
             LIMIT 200"
        )->fetchAll();
    } catch (PDOException $e) {
        // Tabella non ancora migrata: il resto del cron deve girare comunque.
        return ['events' => 0, 'occurrences' => 0, 'details' => ['error' => $e->getMessage()]];
    }

    $details     = [];
    $occurrences = 0;

    foreach ($events as $event) {
        try {
            runAutomationSystemReactions($db, $event);
            $written = dispatchAutomationEvent($db, $event);
            $occurrences += $written;
            markAutomationEvent($db, (int) $event['id'], 'processed', null);
            $details[] = ['id' => (int) $event['id'], 'type' => $event['event_type'], 'occurrences' => $written];
        } catch (Throwable $e) {
            // Un evento malformato non deve bloccare la coda dietro di sé.
            markAutomationEvent($db, (int) $event['id'], 'failed', $e->getMessage());
            $details[] = ['id' => (int) $event['id'], 'type' => $event['event_type'], 'error' => $e->getMessage()];
        }
    }

    return ['events' => count($events), 'occurrences' => $occurrences, 'details' => $details];
}

function markAutomationEvent(PDO $db, int $id, string $status, ?string $error): void
{
    $db->prepare("UPDATE automation_events SET status = :s, processed_at = NOW(), error = :e WHERE id = :id")
       ->execute(['s' => $status, 'e' => $error, 'id' => $id]);
}

/**
 * Reazioni di SISTEMA a un evento: cose che devono accadere sempre, anche su
 * un'installazione senza nemmeno un'automazione configurata.
 *
 * Distinzione da tenere ferma: le regole in `reminders` sono opzionali e
 * mandano messaggi; queste sono comportamenti del prodotto. Se il ritiro dai
 * portali fosse una regola configurabile, basterebbe che nessuno l'avesse
 * creata perche' un venduto restasse in vetrina a pagamento.
 *
 * Non lancia: una reazione fallita non deve impedire alle regole utente di
 * girare, ne' bloccare la coda dietro di se'.
 */
function runAutomationSystemReactions(PDO $db, array $event): void
{
    $payload = json_decode((string) ($event['payload'] ?? '{}'), true) ?: [];

    try {
        if ($event['event_type'] === 'property.status_changed') {
            require_once __DIR__ . '/../lib/portal_lifecycle.php';
            $retired = portalRetireListingsForProperty(
                $db,
                (int) $event['entity_id'],
                (string) ($payload['new_status'] ?? '')
            );
            if ($retired > 0) {
                error_log('[portali] ritirate ' . $retired . ' pubblicazioni per immobile #' . $event['entity_id']);
            }
        }
    } catch (Throwable $e) {
        error_log('[automations] reazione di sistema fallita (' . $event['event_type'] . '): ' . $e->getMessage());
    }
}

/** Materializza le occorrenze di tutte le regole che ascoltano questo evento. */
function dispatchAutomationEvent(PDO $db, array $event): int
{
    $payload = json_decode((string) ($event['payload'] ?? '{}'), true) ?: [];

    $stmt = $db->prepare(
        "SELECT * FROM reminders
         WHERE trigger_type = 'event'
           AND trigger_event = :ev
           AND status = 'pending'
           AND series_id IS NULL"
    );
    $stmt->execute(['ev' => $event['event_type']]);
    $rules = $stmt->fetchAll();

    $written = 0;
    foreach ($rules as $rule) {
        if (!automationRuleMatchesFilter($rule, (string) $event['event_type'], $payload)) {
            continue;
        }
        $written += materializeEventOccurrences($db, $rule, $event, $payload);
    }

    return $written;
}

/**
 * La regola si applica a QUESTO evento?
 *
 * `reminders.trigger_filter` e' un oggetto {campo: [valori ammessi]}. Un campo
 * elencato con una lista NON vuota vincola: il payload deve portare un valore
 * presente in lista. Tutti i campi devono passare (AND fra campi, OR dentro).
 *
 * Assente / vuoto / illeggibile = nessun vincolo, la regola scatta come prima:
 * una colonna aggiunta a regole gia' esistenti non deve spegnerle di colpo.
 *
 * Un payload SENZA il campo vincolato non passa. E' la scelta prudente: se un
 * domani una nuova strada di creazione dimenticasse di dichiarare la fonte,
 * meglio un'email non spedita che una spedita a chi non l'ha chiesta.
 */
function automationRuleMatchesFilter(array $rule, string $eventType, array $payload): bool
{
    $raw = $rule['trigger_filter'] ?? null;
    if ($raw === null || $raw === '') {
        return true;
    }

    $filter = is_array($raw) ? $raw : json_decode((string) $raw, true);
    if (!is_array($filter) || !$filter) {
        return true;
    }

    $declared = AUTOMATION_EVENT_CATALOGUE[$eventType]['filters'] ?? [];

    foreach ($filter as $field => $allowed) {
        // Un campo non piu' dichiarato nel catalogo (evento rinominato, filtro
        // rimosso) non deve bloccare per sempre una regola salvata anni fa.
        if (!isset($declared[$field]) || !is_array($allowed) || !$allowed) {
            continue;
        }
        $value = $payload[$field] ?? null;
        if ($value === null || $value === '') {
            error_log('[automations] regola #' . ($rule['id'] ?? '?') . ' saltata: payload senza "' . $field . '"');
            return false;
        }
        if (!in_array((string) $value, array_map('strval', $allowed), true)) {
            return false;
        }
    }

    return true;
}

function materializeEventOccurrences(PDO $db, array $rule, array $event, array $payload): int
{
    $recipients = resolveEventRecipients($db, (string) ($rule['recipient_rule'] ?? ''), $payload);
    if (!$recipients) {
        return 0;
    }

    $delay = max(0, (int) ($rule['trigger_delay_minutes'] ?? 0));
    $when  = (new DateTime($event['occurred_at']))->modify("+{$delay} minutes")->format('Y-m-d H:i:s');

    // I token dell'evento si risolvono ADESSO: il prezzo di ieri non è
    // ricostruibile domani. Quelli di contatto e immobile restano segnaposto e
    // vengono risolti all'invio, sui dati aggiornati.
    $eventCtx = buildEventTokenContext($event, $payload);
    $subject  = renderAutomationTemplate($rule['email_subject'] ?: $rule['title'], $eventCtx, true);
    $body     = renderAutomationTemplate($rule['email_body'] ?: $rule['description'], $eventCtx, true);

    $insert = $db->prepare(
        "INSERT INTO reminders
            (title, description, reminder_date, frequency, status, trigger_type,
             client_id, lead_id, tenant_id, property_id, assigned_agent_id,
             notify_admin, notify_client, email_subject, email_body, series_id)
         VALUES
            (:title, :description, :reminder_date, 'once', 'pending', 'scheduled',
             :client_id, :lead_id, :tenant_id, :property_id, :assigned_agent_id,
             :notify_admin, :notify_client, :email_subject, :email_body, :series_id)"
    );

    $written = 0;
    foreach ($recipients as $r) {
        $insert->execute([
            'title'             => $rule['title'],
            'description'       => $rule['description'],
            'reminder_date'     => $when,
            'client_id'         => $r['client_id'] ?? null,
            'lead_id'           => $r['lead_id'] ?? null,
            'tenant_id'         => $r['tenant_id'] ?? null,
            'property_id'       => $r['property_id'] ?? ($payload['property_id'] ?? null),
            'assigned_agent_id' => $rule['assigned_agent_id'],
            'notify_admin'      => $rule['notify_admin'],
            'notify_client'     => $rule['notify_client'],
            'email_subject'     => $subject,
            'email_body'        => $body,
            'series_id'         => $rule['id'],
        ]);
        $written++;
    }

    return $written;
}

/**
 * Chi va avvisato, secondo la strategia scelta nella regola.
 *
 * @return array<int, array{client_id?:?int, lead_id?:?int, tenant_id?:?int, property_id?:?int}>
 */
function resolveEventRecipients(PDO $db, string $rule, array $payload): array
{
    $propertyId = !empty($payload['property_id']) ? (int) $payload['property_id'] : null;

    switch ($rule) {
        case 'event_contact':
            foreach (['lead_id', 'client_id', 'tenant_id'] as $fk) {
                if (!empty($payload[$fk])) {
                    return [[$fk => (int) $payload[$fk], 'property_id' => $propertyId]];
                }
            }
            return [];

        case 'property_owner':
            if (!$propertyId) return [];
            $stmt = $db->prepare("SELECT client_id FROM properties WHERE id = :id");
            $stmt->execute(['id' => $propertyId]);
            $ownerId = (int) ($stmt->fetchColumn() ?: 0);
            return $ownerId > 0 ? [['client_id' => $ownerId, 'property_id' => $propertyId]] : [];

        case 'matching_leads':
            if (!$propertyId) return [];
            $stmt = $db->prepare("SELECT * FROM properties WHERE id = :id");
            $stmt->execute(['id' => $propertyId]);
            $property = $stmt->fetch();
            if (!$property) return [];

            $out = [];
            foreach (scoreLeadsForProperty($db, $property) as $match) {
                if (empty($match['email'])) continue; // senza indirizzo non c'è invio
                $out[] = ['lead_id' => (int) $match['id'], 'property_id' => $propertyId];
                if (count($out) >= AUTOMATION_MAX_RECIPIENTS) break;
            }
            return $out;
    }

    return [];
}

/** Valori dei token `{{evento.*}}`, già formattati. */
function buildEventTokenContext(array $event, array $payload): array
{
    return [
        'evento.prezzo_precedente' => automationFormatPrice($payload['old_price'] ?? null),
        'evento.prezzo_attuale'    => automationFormatPrice($payload['new_price'] ?? null),
        'evento.data'              => (new DateTime($event['occurred_at']))->format('d/m/Y'),
    ];
}

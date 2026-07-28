<?php
/**
 * Sorveglianza chiavi non restituite.
 *
 * Una chiave "in possesso" con rientro previsto scaduto non deve aspettare che
 * qualcuno se ne accorga scorrendo l'elenco. Questa sweep gira ogni giorno e
 * apre un promemoria INTERNO per l'agente responsabile.
 *
 * Perché un promemoria e non un canale di notifica nuovo: in questa app il
 * motore di notifica è `reminders` (config/reminders.php lo drena ogni 15
 * minuti e manda la mail interna all'agente assegnato). Aggiungere una seconda
 * strada per far arrivare un avviso significherebbe due code, due log e due
 * posti dove un avviso può perdersi.
 *
 * notify_client resta 0: l'avviso è per l'agenzia. Scrivere in automatico
 * all'idraulico "restituisci le chiavi" senza che nessuno abbia riletto il
 * testo è esattamente il messaggio che non si vuole mandare da soli.
 */

require_once __DIR__ . '/db.php';

/** Ogni quanto si può ri-avvisare sulla stessa chiave ancora fuori. */
const KEY_OVERDUE_RENOTIFY_DAYS = 7;

/**
 * @return array{checked:int, notified:int, items:array}
 */
function processOverdueKeys(PDO $db): array
{
    $stmt = $db->prepare(
        "SELECT k.id, k.property_id, k.key_code, k.key_type, k.quantity,
                k.holder_type, k.holder_id, k.holder_supplier_id, k.holder_tenant_id,
                k.holder_client_id, k.holder_lead_id, k.holder_name,
                k.handed_at, k.due_back_at, k.overdue_notified_at,
                DATEDIFF(CURDATE(), k.due_back_at) AS days_late,
                CONCAT_WS(', ', p.address, p.city) AS property_label,
                COALESCE(au.username, sup.name,
                         NULLIF(TRIM(CONCAT_WS(' ', ten.name, ten.surname)), ''),
                         NULLIF(TRIM(CONCAT_WS(' ', cli.name, cli.surname)), ''),
                         NULLIF(TRIM(CONCAT_WS(' ', led.name, led.surname)), ''),
                         k.holder_name) AS holder_label
           FROM property_keys k
           LEFT JOIN properties  p   ON p.id   = k.property_id
           LEFT JOIN admin_users au  ON au.id  = k.holder_id
           LEFT JOIN suppliers   sup ON sup.id = k.holder_supplier_id
           LEFT JOIN tenants     ten ON ten.id = k.holder_tenant_id
           LEFT JOIN clients     cli ON cli.id = k.holder_client_id
           LEFT JOIN leads       led ON led.id = k.holder_lead_id
          WHERE k.status = 'out'
            AND k.returned_at IS NULL
            AND k.due_back_at IS NOT NULL
            AND k.due_back_at < CURDATE()
            AND (k.overdue_notified_at IS NULL
                 OR k.overdue_notified_at < DATE_SUB(NOW(), INTERVAL :days DAY))"
    );
    $stmt->execute(['days' => KEY_OVERDUE_RENOTIFY_DAYS]);
    $overdue = $stmt->fetchAll();

    $items = [];
    foreach ($overdue as $key) {
        $items[] = notifyOverdueKey($db, $key);
    }

    return [
        'checked'  => count($overdue),
        'notified' => count(array_filter($items, static fn($i) => $i['status'] === 'notified')),
        'items'    => $items,
    ];
}

function notifyOverdueKey(PDO $db, array $key): array
{
    $days   = (int) $key['days_late'];
    $holder = $key['holder_label'] ?: 'detentore non registrato';
    $where  = $key['property_label'] ?: 'immobile #' . (int) $key['property_id'];
    $code   = $key['key_code'] ? " (portachiavi {$key['key_code']})" : '';

    $title = sprintf('Chiavi non restituite — %s', $where);
    $body  = sprintf(
        "Le chiavi%s di %s risultano ancora in possesso di %s.\n"
        . "Consegnate il %s, rientro previsto il %s: %d giorn%s di ritardo.",
        $code,
        $where,
        $holder,
        $key['handed_at'] ? date('d/m/Y', strtotime($key['handed_at'])) : 'data non registrata',
        date('d/m/Y', strtotime($key['due_back_at'])),
        $days,
        $days === 1 ? 'o' : 'i'
    );

    $db->beginTransaction();
    try {
        $stmt = $db->prepare(
            // request_type marca l'avviso come NON manutenzione: la bacheca
            // interventi (api/reminders.php, type=maintenance) accetta
            // request_type='maintenance' o NULL col vecchio marcatore nel
            // titolo, e senza questo valore un sollecito chiavi finirebbe fra
            // gli ordini di lavoro. maintenance_status ha DEFAULT 'aperta' e
            // non è quindi un discriminante utilizzabile.
            "INSERT INTO reminders
                (title, description, reminder_date, frequency, status, trigger_type, request_type,
                 property_id, assigned_agent_id, supplier_id, tenant_id, client_id, lead_id,
                 notify_admin, notify_client, email_subject, email_body)
             VALUES
                (:title, :description, NOW(), 'once', 'pending', 'scheduled', 'key_overdue',
                 :property_id, :assigned_agent_id, :supplier_id, :tenant_id, :client_id, :lead_id,
                 1, 0, :email_subject, :email_body)"
        );
        $stmt->execute([
            'title'             => mb_substr($title, 0, 255),
            'description'       => $body,
            'property_id'       => $key['property_id'] ?: null,
            'assigned_agent_id' => resolveKeyResponsibleAgent($db, (int) $key['id'], $key),
            // Le stesse FK del promemoria agganciano l'avviso alla scheda del
            // soggetto: sul fornitore si vede che ha una chiave in ritardo.
            'supplier_id'       => $key['holder_supplier_id'] ?: null,
            'tenant_id'         => $key['holder_tenant_id'] ?: null,
            'client_id'         => $key['holder_client_id'] ?: null,
            'lead_id'           => $key['holder_lead_id'] ?: null,
            'email_subject'     => mb_substr($title, 0, 255),
            'email_body'        => $body,
        ]);
        $reminderId = (int) $db->lastInsertId();

        $db->prepare('UPDATE property_keys SET overdue_notified_at = NOW() WHERE id = :id')
           ->execute(['id' => $key['id']]);

        // L'avviso è esso stesso un fatto di custodia: entra nel registro.
        $db->prepare(
            "INSERT INTO property_key_events
                (key_id, property_id, property_label, event_type, status_before, status_after,
                 holder_type, holder_label, holder_admin_id, holder_supplier_id, holder_tenant_id,
                 holder_client_id, holder_lead_id, due_back_at, reminder_id, notes, admin_username)
             VALUES
                (:key_id, :property_id, :property_label, 'overdue', 'out', 'out',
                 :holder_type, :holder_label, :holder_admin_id, :holder_supplier_id, :holder_tenant_id,
                 :holder_client_id, :holder_lead_id, :due_back_at, :reminder_id, :notes, 'sistema')"
        )->execute([
            'key_id'             => $key['id'],
            'property_id'        => $key['property_id'] ?: null,
            'property_label'     => $key['property_label'],
            'holder_type'        => $key['holder_type'],
            'holder_label'       => $key['holder_label'],
            'holder_admin_id'    => $key['holder_id'] ?: null,
            'holder_supplier_id' => $key['holder_supplier_id'] ?: null,
            'holder_tenant_id'   => $key['holder_tenant_id'] ?: null,
            'holder_client_id'   => $key['holder_client_id'] ?: null,
            'holder_lead_id'     => $key['holder_lead_id'] ?: null,
            'due_back_at'        => $key['due_back_at'],
            'reminder_id'        => $reminderId,
            'notes'              => mb_substr(sprintf('Ritardo di %d giorni rilevato dal controllo automatico.', $days), 0, 500),
        ]);

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        error_log('[key_overdue] chiave #' . $key['id'] . ': ' . $e->getMessage());
        return ['key_id' => (int) $key['id'], 'status' => 'error', 'days_late' => $days];
    }

    return [
        'key_id'      => (int) $key['id'],
        'status'      => 'notified',
        'days_late'   => $days,
        'holder'      => $holder,
        'reminder_id' => $reminderId,
    ];
}

/**
 * A chi va l'avviso. In ordine: chi ha autorizzato la consegna (dal registro),
 * poi l'agente che ha materialmente le chiavi. Se non risulta nessuno dei due
 * resta NULL e il motore ricade sull'indirizzo generico dell'agenzia — meglio
 * di un avviso assegnato a caso.
 */
function resolveKeyResponsibleAgent(PDO $db, int $keyId, array $key): ?int
{
    $stmt = $db->prepare(
        "SELECT admin_user_id FROM property_key_events
          WHERE key_id = :id AND admin_user_id IS NOT NULL AND event_type IN ('handover', 'created')
          ORDER BY created_at DESC, id DESC LIMIT 1"
    );
    $stmt->execute(['id' => $keyId]);
    $authorizer = $stmt->fetchColumn();

    if ($authorizer) return (int) $authorizer;
    return $key['holder_id'] ? (int) $key['holder_id'] : null;
}

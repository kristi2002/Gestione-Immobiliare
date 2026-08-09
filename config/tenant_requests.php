<?php
/**
 * Le richieste che un inquilino manda all'agenzia — vocabolario condiviso.
 *
 * Questa lista serve a DUE lati che prima non si parlavano:
 *
 *   - il portale (`tenant/api_maintenance.php`) la usa per accettare il tipo
 *     scelto dall'inquilino, e `tenant/lib/portal_data.php` per rileggere le
 *     proprie richieste;
 *   - l'agenzia (`api/reminders.php`) la usa per sapere quali righe
 *     `reminders` sono richieste di un inquilino, e quindi su quali ha senso
 *     scrivere una risposta.
 *
 * Stava scritta in un file solo, dentro `tenant/`, e l'API admin non poteva
 * leggerla senza tirarsi dentro l'intero strato dati del portale. La copia
 * sarebbe stata la scorciatoia ovvia, ed e' esattamente il difetto gia' visto
 * altrove: una lista si allarga, l'altra resta indietro, e il disallineamento
 * non da' errore — semplicemente una schermata smette di trovare delle righe.
 *
 * `request_type` e' un varchar libero in tabella: il vincolo vive qui, non
 * nello schema. Si allarga APPENDENDO in coda.
 */

/** I tipi di richiesta che il portale sa creare. */
const TENANT_REQUEST_TYPES = ['maintenance', 'document', 'info', 'appointment', 'other'];

/** Come si chiamano, per chi legge. */
const TENANT_REQUEST_LABELS = [
    'maintenance' => 'Manutenzione',
    'document'    => 'Documento',
    'info'        => 'Informazioni',
    'appointment' => 'Appuntamento',
    'other'       => 'Altro',
];

/**
 * Il perimetro di LETTURA del portale, in SQL.
 *
 * `tenantRequests()` mostra all'inquilino le righe `reminders` che hanno il suo
 * `tenant_id` **e** un `request_type` fra quelli qui sopra: le altre sono
 * promemoria interni dell'agenzia (scadenze, solleciti) e non vanno mostrate a
 * chi ne e' l'oggetto.
 *
 * L'agenzia ha bisogno della stessa condizione per il motivo opposto: prima di
 * scrivere una risposta deve sapere se quella risposta verra' mai letta. Una
 * frase salvata su un promemoria interno non e' un messaggio andato perso —
 * e' un messaggio che non aveva nessun destinatario.
 */
function tenantRequestTypesSqlList(): string
{
    return "'" . implode("','", TENANT_REQUEST_TYPES) . "'";
}

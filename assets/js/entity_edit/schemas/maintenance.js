/**
 * Intervento di manutenzione — apertura di un ticket dal lato agenzia.
 *
 * La bacheca Manutenzione mostrava richieste che solo l'INQUILINO poteva creare:
 * tenant/api_maintenance.php:67 è l'unico punto in tutto il codice che scriveva
 * `reminders.request_type`. api/reminders.php quella colonna la leggeva soltanto
 * (per filtrare la bacheca, riga 182) e non la scriveva mai, nemmeno in INSERT.
 *
 * Conseguenza pratica: la segnalazione che arriva al telefono — cioè quasi tutte —
 * non aveva un posto dove essere registrata. L'agenzia guardava una bacheca su
 * cui non poteva scrivere.
 *
 * Un intervento NON è un'entità a parte: è una riga `reminders` con
 * request_type='maintenance'. Per questo lo schema punta ad api/reminders.php e
 * fissa quel valore in beforeSave, invece di inventare una tabella.
 */

/** enum reminders.maintenance_status — DEFAULT 'aperta'. */
export const MAINTENANCE_STATUSES = [
    { value: 'aperta',         label: 'Aperta' },
    { value: 'in_lavorazione', label: 'In lavorazione' },
    { value: 'completata',     label: 'Completata' },
    { value: 'chiusa',         label: 'Chiusa' },
];

/** `priority` è varchar libero: questi sono i valori che la bacheca colora. */
export const PRIORITIES = [
    { value: 'bassa',   label: 'Bassa' },
    { value: 'media',   label: 'Media' },
    { value: 'alta',    label: 'Alta' },
    { value: 'urgente', label: 'Urgente' },
];

export default {
    entity:   'maintenance',
    api:      'api/reminders.php',
    listView: 'maintenance_workflow',
    titles:   { create: 'Nuovo intervento', edit: 'Modifica intervento' },
    subtitle: 'Una segnalazione ricevuta al telefono o di persona, registrata come le richieste che arrivano dal portale inquilino.',

    sections: [
        {
            legend: 'Segnalazione',
            fields: [
                {
                    name: 'title', label: 'Di cosa si tratta', type: 'text',
                    required: true, maxlength: 200, span: 12, autofocus: true,
                    placeholder: 'es. Caldaia in blocco, perdita sotto il lavello',
                },
                {
                    name: 'property_id', label: 'Immobile', type: 'picker',
                    source: 'properties', required: true, span: 8,
                    placeholder: 'Cerca per riferimento o indirizzo…',
                },
                {
                    name: 'reminder_date', label: 'Data', type: 'datetime', required: true, span: 4,
                    hint: 'Quando è stata segnalata (o quando va affrontata).',
                },
                {
                    name: 'description', label: 'Descrizione', type: 'textarea', rows: 4, span: 12,
                    placeholder: 'Cosa ha detto l\'inquilino, da quando, cosa è già stato provato…',
                },
            ],
        },
        {
            legend: 'Gestione',
            fields: [
                {
                    name: 'maintenance_status', label: 'Stato', type: 'select',
                    options: MAINTENANCE_STATUSES, span: 3, emptyLabel: false,
                },
                { name: 'priority', label: 'Priorità', type: 'select', options: PRIORITIES, span: 3 },
                {
                    name: 'assigned_agent_id', label: 'Agente incaricato', type: 'select',
                    source: 'agents', span: 6, emptyLabel: '— Nessuno —',
                },
            ],
        },
        {
            legend: 'Chi ha segnalato',
            fold: true,
            optionalNote: 'facoltativo',
            hint: 'Agganciare l\'inquilino o il proprietario fa comparire l\'intervento anche nella loro scheda.',
            fields: [
                { name: 'tenant_id', label: 'Inquilino', type: 'select', source: 'tenants', span: 6, emptyLabel: '— Nessuno —' },
                { name: 'client_id', label: 'Proprietario', type: 'select', source: 'clients', span: 6, emptyLabel: '— Nessuno —' },
            ],
        },
    ],

    beforeSave(payload, form) {
        // È questo campo, e solo questo, a far comparire la riga nella bacheca
        // (api/reminders.php). In CREAZIONE è 'maintenance': un ticket aperto
        // dall'agenzia è un intervento.
        //
        // In MODIFICA non si tocca. La bacheca oggi mostra tutte e cinque le
        // richieste del portale: fissarlo qui avrebbe riclassificato come
        // «manutenzione» il «mi serve copia del contratto» di un inquilino,
        // alla prima correzione di un refuso — e lui avrebbe visto cambiare
        // sotto gli occhi il tipo che aveva scelto.
        if (!form?.isEdit) {
            payload.request_type = 'maintenance';
        } else {
            // La PUT conserva le chiavi che non arrivano (updateReminder legge
            // la riga esistente): non mandarla è il modo di lasciarla com'è.
            delete payload.request_type;
        }
        // Un intervento è una cosa singola, non una ricorrenza, e non è una
        // regola a evento: senza questi due l'API applicherebbe i suoi valori di
        // ripiego e la riga finirebbe fra le automazioni.
        payload.frequency    = payload.frequency || 'once';
        payload.trigger_type = 'scheduled';
        if (!payload.maintenance_status) payload.maintenance_status = 'aperta';
    },
};

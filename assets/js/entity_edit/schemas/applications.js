/**
 * Candidature / richieste immobili — schema della pagina "Nuova / Modifica Candidatura".
 *
 * Sostituisce #pa-new-modal in views/property_applications.html.
 *
 * Una candidatura non è un record che compila l'agenzia: è quello che il
 * richiedente ha mandato dal sito, o ha dettato al telefono. Il modulo quindi
 * si comporta in due modi diversi, e non per gusto — è l'API a imporlo:
 *
 *   · in creazione (createApplication) si registra la richiesta per intero;
 *   · in modifica (updateApplication) la PUT legge SOLO `status` e
 *     `converted_to_lead_id`. Nome, email, telefono, immobile e messaggio
 *     vengono ignorati in silenzio: lasciarli scrivibili vorrebbe dire far
 *     correggere un numero di telefono e poi rispondere "salvato" senza averlo
 *     salvato. Su un record esistente restano leggibili ma bloccati — vedi
 *     afterLoad() — e la sola cosa che si aggiorna è lo stato della pratica.
 *
 * `converted_to_lead_id` non è un campo del modulo di proposito: la conversione
 * in lead ha il suo endpoint transazionale (`?action=convert_lead`), che spezza
 * il nome in nome+cognome, porta l'immobile nelle note del lead e rifiuta la
 * seconda conversione con un 409. Riscriverlo qui sarebbe un doppione fragile.
 */

/**
 * APP_TYPES in api/property_applications.php:
 *     const APP_TYPES = ['affitto', 'acquisto'];
 * La POST risponde "Tipo non valido." a qualunque altro valore.
 */
export const APPLICATION_TYPES = [
    { value: 'affitto',  label: 'Affitto' },
    { value: 'acquisto', label: 'Acquisto' },
];

/**
 * APP_STATUSES in api/property_applications.php:
 *     const APP_STATUSES = ['new', 'contacted', 'approved', 'rejected'];
 * La PUT risponde "Stato non valido." fuori da questa lista. Le etichette sono
 * le stesse di STATUS_LABELS in assets/js/property_applications.js e del filtro
 * nella vista: l'elenco e la scheda devono chiamare gli stati allo stesso modo.
 */
export const APPLICATION_STATUSES = [
    { value: 'new',       label: 'Nuova' },
    { value: 'contacted', label: 'Contattato' },
    { value: 'approved',  label: 'Approvato' },
    { value: 'rejected',  label: 'Rifiutato' },
];

/**
 * I soli campi che createApplication() legge dal body — ed è anche l'elenco di
 * quello che il richiedente ha scritto: in modifica si legge, non si riscrive.
 */
const CREATE_FIELDS = [
    'property_id', 'application_type',
    'applicant_name', 'applicant_email', 'applicant_phone',
    'message',
];

/**
 * Blocca un campo già compilato. Il `picker` ha due controlli (il testo visibile
 * e l'id nascosto) e un `<select>` ignora `readonly`, quindi si passa per il
 * gruppo e si sceglie l'arma giusta controllo per controllo.
 */
function lockField(form, name) {
    const group = form.mountEl.querySelector(`[data-ef-field="${name}"]`);
    if (!group) return;
    group.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.tagName === 'SELECT') el.disabled = true;
        else el.readOnly = true;
        el.setAttribute('aria-readonly', 'true');
        el.title = 'Dato inviato dal richiedente: non modificabile.';
    });
}

export default {
    entity:   'applications',
    api:      'api/property_applications.php',
    listView: 'property_applications',
    titles:   { create: 'Nuova Candidatura', edit: 'Modifica Candidatura' },
    subtitle: 'Richiesta di locazione o acquisto arrivata per un immobile: chi ha chiamato, per cosa, e a che punto siamo.',

    sections: [
        {
            legend: 'Immobile richiesto',
            fields: [
                {
                    // Type-ahead e non tendina: con oltre cento immobili a
                    // listino si cerca per RIF molto prima di scorrere l'elenco.
                    // Arriva già compilato aprendo il modulo dalla scheda
                    // immobile ({ entity:'applications', property_id: 12 }).
                    name: 'property_id', label: 'Immobile', type: 'picker',
                    source: 'properties', required: true, span: 8, autofocus: true,
                    placeholder: 'Cerca per riferimento (es. RIF-001) o indirizzo…',
                    hint: 'Obbligatorio: l\'API rifiuta una candidatura senza immobile esistente.',
                },
                {
                    // Nessuna voce vuota: la POST assume 'affitto' quando il
                    // campo manca, e mostrare il valore che il server userebbe
                    // comunque è più onesto di un "— Seleziona —" finto.
                    name: 'application_type', label: 'Tipo di richiesta', type: 'select',
                    options: APPLICATION_TYPES, emptyLabel: false, required: true, span: 4,
                    hint: 'Determina l\'interesse del lead se la richiesta viene convertita.',
                },
            ],
        },
        {
            legend: 'Richiedente',
            hint: 'I recapiti restano qui finché la richiesta non viene convertita in lead: questa tabella non è collegata all\'anagrafica.',
            fields: [
                {
                    name: 'applicant_name', label: 'Nome e cognome', type: 'text',
                    required: true, maxlength: 150, span: 5,
                    placeholder: 'es. Mario Rossi',
                    hint: 'Convertendo in lead la prima parola diventa il nome e il resto il cognome: scrivi "Mario Rossi", non "Rossi Mario".',
                },
                {
                    name: 'applicant_email', label: 'Email', type: 'email',
                    required: true, maxlength: 150, span: 4,
                    placeholder: 'richiedente@email.com',
                },
                {
                    name: 'applicant_phone', label: 'Telefono', type: 'tel',
                    maxlength: 30, span: 3,
                    placeholder: 'es. +39 333 1234567',
                },
            ],
        },
        {
            legend: 'Messaggio e stato',
            fields: [
                {
                    name: 'message', label: 'Messaggio / Note', type: 'textarea',
                    rows: 4, span: 12,
                    placeholder: 'Informazioni aggiuntive ricevute per telefono…',
                    hint: 'Viene ricopiato nelle note del lead alla conversione.',
                },

                // Marcatori di sola lettura. Il motore passa a `when` i valori
                // del modulo, non il record: `created_at` esiste solo su una
                // candidatura già arrivata, quindi distingue "sto registrando
                // una richiesta" da "sto lavorando una richiesta ricevuta".
                { name: 'created_at',           type: 'hidden' },
                { name: 'converted_to_lead_id', type: 'hidden' },

                {
                    name: 'status', label: 'Stato', type: 'select',
                    options: APPLICATION_STATUSES, required: true, span: 4,
                    when: (d) => !!d.created_at,
                    hint: 'Nuova finché non richiami, poi Approvato o Rifiutato. È l\'unico campo che si aggiorna su una richiesta già ricevuta.',
                },
                {
                    name: 'lead_link', label: 'Convertita in lead', type: 'static', span: 8,
                    when: (d) => !!d.converted_to_lead_id,
                    render: (d) => d.converted_to_lead_id ? `Lead #${d.converted_to_lead_id}` : '—',
                    hint: 'Una candidatura si converte una volta sola: il secondo tentativo viene rifiutato.',
                },
            ],
        },
    ],

    /**
     * Su un record esistente il modulo diventa una scheda: si legge quello che
     * è arrivato e si tocca solo lo stato. Vedi updateApplication().
     */
    afterLoad(data, form) {
        CREATE_FIELDS.forEach(name => lockField(form, name));
        form.alert('Di una candidatura ricevuta si aggiorna solo lo stato: gli altri dati sono quelli inviati dal richiedente.', 'info');
    },

    /**
     * Ogni handler dell'API legge la sua manciata di chiavi e ignora il resto.
     * Spedire più di così non rompe nulla oggi, ma nasconde il fatto che quei
     * valori non vengono salvati: meglio che il payload dica la verità.
     */
    beforeSave(payload, form) {
        const allowed = form.isEdit ? ['status'] : CREATE_FIELDS;
        Object.keys(payload).forEach(k => { if (!allowed.includes(k)) delete payload[k]; });
    },
};

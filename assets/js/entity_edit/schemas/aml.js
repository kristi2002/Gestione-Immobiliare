/**
 * Antiriciclaggio — schema for the "Nuova / Modifica verifica AML" page.
 *
 * Replaces #aml-modal in views/aml.html.
 *
 * This is a compliance record, not a CRM card: what gets saved here is what the
 * agency shows to the Guardia di Finanza. Two consequences run through the
 * whole file:
 *
 *   · every enum below is a hand-kept copy of a PHP const in api/aml.php.
 *     validateAmlInput() does NOT reject an unknown value — its $enum() helper
 *     silently falls back to the default. So a typo here does not surface as an
 *     error: it files the pratica as 'basso'/'ordinaria'/'mediazione' and nobody
 *     notices until an inspection. Keep the two lists identical.
 *
 *   · updateAml() writes every column on every PUT, so a field missing from the
 *     schema is a field wiped on the next save. `lead_id` has no editor and no
 *     lookup source — it is carried as a hidden field for exactly this reason.
 *
 * Section order follows the adeguata verifica as it is actually performed:
 * chi è il soggetto → con quale documento l'ho identificato → che operazione sta
 * facendo → quanto rischia → esito e conservazione.
 */

/* AML_SUBJECT_TYPES in api/aml.php — default 'persona_fisica'. */
export const SUBJECT_TYPES = [
    { value: 'persona_fisica',    label: 'Persona fisica' },
    { value: 'persona_giuridica', label: 'Persona giuridica' },
];

/* AML_VERIFICATION in api/aml.php — default 'ordinaria'. */
export const VERIFICATION_TYPES = [
    { value: 'ordinaria',    label: 'Ordinaria' },
    { value: 'semplificata', label: 'Semplificata' },
    { value: 'rafforzata',   label: 'Rafforzata' },
];

/* AML_RISK in api/aml.php — default 'basso'. */
export const RISK_LEVELS = [
    { value: 'basso', label: 'Basso' },
    { value: 'medio', label: 'Medio' },
    { value: 'alto',  label: 'Alto' },
];

/* AML_OPERATIONS in api/aml.php — default 'mediazione', which is why it leads
   the list: these selects carry no empty option, so the first entry is what a
   pratica creata senza toccare nulla ends up with, and it has to agree with the
   server's fallback. */
export const OPERATION_TYPES = [
    { value: 'mediazione', label: 'Mediazione' },
    { value: 'vendita',    label: 'Vendita' },
    { value: 'locazione',  label: 'Locazione' },
    { value: 'altro',      label: 'Altro' },
];

/* AML_STATUSES in api/aml.php — default 'da_completare'. */
export const STATUSES = [
    { value: 'da_completare', label: 'Da completare' },
    { value: 'completata',    label: 'Completata' },
    { value: 'sospesa',       label: 'Sospesa' },
];

/**
 * A `when` that hides a field must never be the reason a filled column goes
 * null: serialize() sends null for anything hidden. So every conditional below
 * also stays open while the control still holds text — switching the tipo
 * soggetto asks the user to clear the field, it does not clear it for them.
 */
const stillFilled = (v) => String(v ?? '').trim() !== '';

export default {
    entity:   'aml',
    api:      'api/aml.php',
    listView: 'aml',
    titles:   { create: 'Nuova Verifica AML', edit: 'Modifica Verifica AML' },
    subtitle: 'Adeguata verifica della clientela (D.lgs 231/2007). Il fascicolo si conserva 10 anni.',

    sections: [
        {
            legend: 'Soggetto',
            hint: 'Chi stai verificando. Il nominativo è l\'unico dato che l\'API pretende: tutto il resto può arrivare dopo, ma una pratica senza codice fiscale non è un\'identificazione.',
            fields: [
                {
                    name: 'subject_name', label: 'Soggetto (nominativo / ragione sociale)', type: 'text',
                    required: true, maxlength: 200, span: 8, autofocus: true,
                    placeholder: 'es. Mario Rossi — oppure Immobiliare Adriatica S.r.l.',
                },
                {
                    name: 'subject_type', label: 'Tipo soggetto', type: 'select',
                    required: true, options: SUBJECT_TYPES, emptyLabel: false, span: 4,
                    hint: 'Decide quali dati servono più sotto (P.IVA, titolare effettivo).',
                },
                {
                    name: 'codice_fiscale', label: 'Codice fiscale', type: 'text',
                    maxlength: 16, span: 6, uppercase: true,
                    placeholder: 'es. RSSMRA80A01H501U',
                    // Nessun controllo posizionale: l'omocodia sostituisce cifre
                    // con lettere e un regex "6 lettere + 2 cifre + …" rifiuta
                    // codici fiscali perfettamente validi. Si controlla solo la
                    // lunghezza, che è l'errore di battitura vero.
                    validate: (v, d) => {
                        const s = String(v).replace(/\s/g, '');
                        if (d.subject_type === 'persona_giuridica') {
                            // Le 16 cifre restano ammesse: una ditta individuale
                            // sta in archivio come giuridica ma porta il CF del
                            // titolare, e bloccarla romperebbe schede già salvate.
                            return /^\d{11}$/.test(s) || /^[A-Za-z0-9]{16}$/.test(s)
                                ? null
                                : 'Per una persona giuridica il codice fiscale è di 11 cifre (16 caratteri per una ditta individuale).';
                        }
                        return /^[A-Za-z0-9]{16}$/.test(s)
                            ? null
                            : 'Il codice fiscale di una persona fisica è di 16 caratteri.';
                    },
                },
                {
                    name: 'partita_iva', label: 'Partita IVA', type: 'text',
                    maxlength: 11, span: 6,
                    placeholder: '11 cifre',
                    pattern: '^[0-9]{11}$',
                    patternMessage: 'La partita IVA è composta da 11 cifre.',
                    when: (d) => d.subject_type === 'persona_giuridica' || stillFilled(d.partita_iva),
                },
                // Nessun elenco lead fra le SOURCES e nessun campo in pagina:
                // senza questo hidden la PUT azzererebbe il collegamento al lead
                // da cui la pratica è nata. Arriva anche come prefill quando la
                // scheda lead apre la verifica.
                { name: 'lead_id', type: 'hidden' },
            ],
        },

        {
            legend: 'Documento d\'identità',
            hint: 'L\'identificazione va fatta in presenza sul documento originale (art. 19). Copia il tipo esatto riportato sul documento, non "carta".',
            fields: [
                {
                    name: 'id_document_type', label: 'Tipo documento', type: 'text',
                    maxlength: 40, span: 5,
                    placeholder: 'es. Carta d\'identità elettronica',
                    hint: 'Carta d\'identità, passaporto, patente, permesso di soggiorno…',
                },
                {
                    name: 'id_document_number', label: 'Numero documento', type: 'text',
                    maxlength: 40, span: 4, uppercase: true,
                    placeholder: 'es. CA12345AB',
                },
                {
                    name: 'id_document_expiry', label: 'Scadenza documento', type: 'date',
                    span: 3,
                    hint: 'Se è scaduto, la verifica va rifatta su un documento valido.',
                },
            ],
        },

        {
            legend: 'Operazione',
            hint: 'Scopo e natura del rapporto (art. 18 lett. c). È la parte che un ispettore legge per prima: "mediazione" senza una riga di scopo non racconta nulla.',
            fields: [
                {
                    name: 'operation_type', label: 'Tipo operazione', type: 'select',
                    required: true, options: OPERATION_TYPES, emptyLabel: false, span: 6,
                },
                {
                    name: 'operation_value', label: 'Valore operazione', type: 'money',
                    min: 0, span: 6, prefix: '€',
                    placeholder: '0,00',
                    hint: 'Sopra i 15.000 € l\'adeguata verifica è obbligatoria anche per un\'operazione occasionale.',
                },
                {
                    name: 'property_id', label: 'Immobile collegato', type: 'picker',
                    source: 'properties', span: 6,
                    placeholder: 'Cerca per riferimento (es. RIF-001) o indirizzo…',
                    hint: 'Lega il fascicolo all\'immobile: è così che lo ritrovi fra tre anni.',
                },
                {
                    name: 'client_id', label: 'Proprietario collegato', type: 'select',
                    source: 'clients', span: 6, emptyLabel: '— Nessuno —',
                },
                {
                    name: 'purpose', label: 'Scopo e natura dell\'operazione', type: 'textarea',
                    rows: 3, span: 12,
                    placeholder: 'es. Acquisto prima casa con mutuo bancario; provvista da vendita immobile precedente.',
                    hint: 'Da dove arrivano i soldi e perché sta comprando. Una frase concreta vale più di una formula.',
                },
            ],
        },

        {
            legend: 'Valutazione del rischio',
            hint: 'Rischio alto e soggetti PEP obbligano alle misure rafforzate (artt. 24-25): qui i due campi vanno letti insieme, non compilati a caso.',
            fields: [
                {
                    name: 'risk_level', label: 'Livello di rischio', type: 'select',
                    required: true, options: RISK_LEVELS, emptyLabel: false, span: 6,
                    hint: 'Paese, tipo di operazione, mezzi di pagamento, comportamento del cliente.',
                },
                {
                    name: 'verification_type', label: 'Tipo di verifica', type: 'select',
                    required: true, options: VERIFICATION_TYPES, emptyLabel: false, span: 6,
                    // Il vincolo è di legge, non di forma: una pratica "alto +
                    // ordinaria" è una verifica non eseguita, e l'API la
                    // salverebbe senza fiatare.
                    validate: (v, d) => (v !== 'rafforzata' && (d.risk_level === 'alto' || Number(d.is_pep) === 1))
                        ? 'Con rischio alto o soggetto PEP la verifica dev\'essere rafforzata (artt. 24-25 D.lgs 231/2007).'
                        : null,
                },
                {
                    name: 'is_pep', type: 'checkbox', span: 12,
                    label: 'Persona Politicamente Esposta (PEP)',
                    checkboxLabel: 'Il soggetto è una Persona Politicamente Esposta (PEP), o un suo familiare / stretto collegato',
                },
                {
                    name: 'beneficial_owner', label: 'Titolare effettivo', type: 'text',
                    maxlength: 200, span: 12,
                    placeholder: 'Nome e cognome della persona fisica che controlla o per conto della quale si opera',
                    hint: 'Per una società: chi detiene oltre il 25% o esercita il controllo (art. 20). Se coincide con il soggetto, lascia vuoto.',
                    when: (d) => d.subject_type === 'persona_giuridica'
                        || Number(d.is_pep) === 1
                        || stillFilled(d.beneficial_owner),
                },
            ],
        },

        {
            legend: 'Esito',
            fields: [
                {
                    name: 'verification_date', label: 'Data adeguata verifica', type: 'date',
                    span: 6,
                    hint: 'La data in cui hai visto il soggetto e il suo documento. Da qui partono i 10 anni di conservazione.',
                },
                {
                    name: 'status', label: 'Stato pratica', type: 'select',
                    required: true, options: STATUSES, emptyLabel: false, span: 6,
                    hint: '"Da completare" è ciò che compare in cima all\'elenco finché non la chiudi.',
                },
            ],
        },

        {
            legend: 'Conservazione e note',
            fold: true,
            optionalNote: 'si compilano da sole',
            hint: 'La conservazione decennale (art. 31) la calcola il server dalla data di verifica. Aprila solo per forzare una scadenza diversa o per lasciare una nota al collega.',
            fields: [
                {
                    name: 'retention_until', label: 'Conservazione fino a', type: 'date',
                    span: 4,
                    hint: 'Vuoto = data verifica + 10 anni.',
                },
                {
                    name: 'notes', label: 'Note interne', type: 'textarea',
                    rows: 3, span: 12,
                    placeholder: 'es. Documento acquisito in copia il 12/03; attesa visura camerale aggiornata.',
                },
            ],
        },
    ],

    /**
     * validateField() esce subito sui valori vuoti, quindi un "obbligatorio solo
     * se lo stato è completata" non può vivere nello spec del campo. Segno
     * l'errore a mano, altrimenti l'alert in cima punta a un campo che nessuno
     * ha evidenziato — e la data sta nella sezione sopra, non sotto gli occhi.
     */
    validate(payload, form) {
        if (payload.status === 'completata' && !payload.verification_date) {
            form.fieldError('verification_date', 'Serve la data per poter chiudere la pratica.');
            form.focusField('verification_date');
            return 'Una pratica completata deve riportare la data dell\'adeguata verifica.';
        }
        if (payload.retention_until && payload.verification_date
            && payload.retention_until < payload.verification_date) {
            form.fieldError('retention_until', 'La conservazione non può finire prima della verifica.');
            form.focusField('retention_until');
            return 'La data di conservazione precede la data della verifica.';
        }
        return null;
    },
};

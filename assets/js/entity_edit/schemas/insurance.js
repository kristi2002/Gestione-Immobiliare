/**
 * Polizze assicurative — schema for the "Nuova / Modifica polizza" page.
 *
 * Replaces #insurance-modal in views/insurance.html.
 *
 * Two things the old modal got wrong and this schema fixes:
 *   · "N. Polizza" was optional in the markup but api/insurance.php refuses an
 *     empty policy_number ("Il numero di polizza è obbligatorio"), so the user
 *     could only find out by pressing Salva.
 *   · client_id (l'intestatario) was never offered at all. The API accepts it
 *     and derives it from the immobile only when it arrives empty, so a polizza
 *     intestata a un comproprietario had no way in.
 */

/**
 * Kept in sync by hand with INSURANCE_TYPES in api/insurance.php:
 *
 *   const INSURANCE_TYPES = ['incendio', 'responsabilita', 'responsabilita_civile',
 *       'globale_fabbricato', 'furto', 'multirischio', 'vita', 'altro'];
 *
 * and with the ENUM on property_insurance.policy_type, which phase62 widened to
 * exactly this union. Anything outside the list is refused with "Tipo polizza
 * non valido"; anything inside it but missing from the ENUM would be refused by
 * MySQL instead — both lists have to move together.
 *
 * 'responsabilita' and 'responsabilita_civile' are the same cover twice: the
 * first is the original 2015 value, the second the one the form has been
 * writing since phase62. The legacy one stays offered so re-saving an old
 * polizza doesn't silently re-type it.
 */
export const POLICY_TYPES = [
    { value: 'globale_fabbricato',   label: 'Globale fabbricato' },
    { value: 'incendio',             label: 'Incendio' },
    { value: 'responsabilita_civile', label: 'Responsabilità civile' },
    { value: 'multirischio',         label: 'Multirischio casa' },
    { value: 'furto',                label: 'Furto' },
    { value: 'vita',                 label: 'Vita' },
    { value: 'responsabilita',       label: 'Responsabilità (dicitura storica)' },
    { value: 'altro',                label: 'Altro' },
];

export default {
    entity:   'insurance',
    api:      'api/insurance.php',
    listView: 'insurance',
    titles:   { create: 'Nuova Polizza', edit: 'Modifica Polizza' },
    subtitle: 'Polizza a copertura di un immobile: chi assicura, per cosa e fino a quando.',

    sections: [
        {
            // Come si archivia una polizza: si ha il fascicolo in mano e si copia
            // la testata. Questi quattro campi sono l'identità del documento e
            // sono tutti obbligatori per l'API — restano quindi in chiaro.
            legend: 'Polizza',
            fields: [
                {
                    // Aprendo il modulo dalla scheda immobile arriva già
                    // valorizzato come prefill (entity_edit/index.js).
                    // Type-ahead e non tendina: gli immobili sono l'elenco più
                    // lungo dell'applicazione e l'agente cerca per RIF, come già
                    // fa nel campo "Immobile richiesto" della scheda lead.
                    name: 'property_id', label: 'Immobile', type: 'picker',
                    source: 'properties', required: true, span: 12, autofocus: true,
                    placeholder: 'Cerca per riferimento (es. RIF-001), indirizzo o città…',
                    hint: 'La polizza è agganciata all\'immobile: da qui l\'API ricava anche il proprietario.',
                },
                {
                    name: 'insurer_name', label: 'Compagnia', type: 'text',
                    required: true, maxlength: 150, span: 5,
                    placeholder: 'es. Generali Italia — Agenzia di Civitanova',
                },
                {
                    name: 'policy_number', label: 'N. polizza', type: 'text',
                    required: true, maxlength: 100, span: 3,
                    placeholder: 'es. 0012345678',
                },
                {
                    name: 'policy_type', label: 'Tipo di copertura', type: 'select',
                    required: true, options: POLICY_TYPES, span: 4,
                },
            ],
        },
        {
            // Premio e date NON stanno in una sezione richiudibile: la scadenza è
            // il motivo per cui questa scheda esiste (la lista è ordinata per
            // end_date, il contatore "In scadenza" e lo Scadenzario leggono solo
            // quella). Nascondere dietro un click il campo che fa suonare la
            // sveglia significa creare polizze mute.
            legend: 'Decorrenza e premio',
            hint: 'Le date sono quelle di polizza, non quelle di pagamento del premio.',
            fields: [
                {
                    name: 'start_date', label: 'Decorrenza', type: 'date', span: 4,
                },
                {
                    name: 'end_date', label: 'Scadenza', type: 'date',
                    required: true, span: 4,
                    hint: 'Guida gli avvisi: senza questa data la polizza non compare né nel contatore «In scadenza (30 gg)» né nello Scadenzario.',
                },
                {
                    name: 'premium_annual', label: 'Premio annuo', type: 'money',
                    span: 4, prefix: '€', min: 0,
                    // premium_annual è DECIMAL(10,2): oltre questa cifra MySQL
                    // rifiuta la riga e l'utente vede solo "Errore database".
                    max: 99999999.99,
                    placeholder: '0,00',
                    hint: 'Somma dei premi annui: alimenta il costo annuale totale in testa alla lista.',
                },
            ],
        },
        {
            // Blocco raro: nove volte su dieci l'intestatario è il proprietario
            // dell'immobile e l'API lo compila da sola (fillClientFromProperty).
            // Si apre solo quando la polizza fa eccezione.
            legend: 'Intestatario e note',
            fold: true,
            optionalNote: 'facoltativo',
            hint: 'Lasciando vuoto l\'intestatario, viene assunto il proprietario dell\'immobile scelto sopra.',
            fields: [
                {
                    name: 'client_id', label: 'Intestatario', type: 'select',
                    source: 'clients', span: 6,
                    emptyLabel: '— Proprietario dell\'immobile —',
                    hint: 'Da compilare solo se la polizza è intestata a un comproprietario o a un terzo.',
                },
                {
                    name: 'notes', label: 'Note', type: 'textarea', rows: 4, span: 12,
                    placeholder: 'Massimali, franchigie, broker di riferimento, modalità di rinnovo…',
                },
            ],
        },
    ],

    /**
     * L'API non confronta le due date: una scadenza anteriore alla decorrenza
     * verrebbe accettata e la polizza risulterebbe scaduta il giorno stesso in
     * cui viene registrata. È quasi sempre un anno digitato male.
     */
    validate(payload) {
        if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
            return 'La scadenza è anteriore alla decorrenza: controlla le date.';
        }
        return null;
    },
};

/**
 * Edifici / condomini — schema for the "Nuovo / Modifica edificio" page.
 *
 * Replaces #buildings-modal in views/buildings.html.
 *
 * Two things this form has to get right that the modal did not:
 *
 *   1. updateBuilding() in api/buildings.php writes EVERY column on a PUT. A
 *      column missing from this schema is not "left as it was", it is erased —
 *      which is exactly how the modal wiped latitude/longitude (written once by
 *      the geocoding inside "Genera unità") at the first edit that followed.
 *      Every field validateBuildingInput() accepts is declared here.
 *
 *   2. L'amministratore è un fornitore in rubrica, non testo libero:
 *      buildings.administrator_supplier_id. Quando è valorizzato, la validazione
 *      dell'API azzera le tre colonne administrator_* di testo — quindi il form
 *      le nasconde, e il payload dice la stessa cosa che il server farebbe
 *      comunque, invece di mandare dati destinati a essere buttati.
 */

/**
 * L'elenco viene da lookups.SOURCES.suppliers (tutta la rubrica) e va ristretto
 * qui: un idraulico fra gli amministratori è rumore che porta a collegamenti
 * sbagliati. 'amministratore' è una delle categorie di SUPPLIER_CATEGORIES in
 * api/suppliers.php — l'API non verifica la categoria del fornitore collegato,
 * quindi questo filtro è l'unica cosa che tiene pulita la lista.
 */
const isAdministrator = (option) => option.meta?.category === 'amministratore';

export default {
    entity:   'buildings',
    api:      'api/buildings.php',
    listView: 'buildings',
    titles:   { create: 'Nuovo Edificio', edit: 'Modifica Edificio' },
    subtitle: 'Anagrafica dello stabile, amministratore di condominio e unità che lo compongono.',
    // Un nuovo edificio deve comparire nella tendina "Edificio" della scheda
    // immobile senza ricaricare la pagina.
    invalidates: ['buildings'],

    sections: [
        {
            legend: 'Dati edificio',
            hint: 'Il CAP serve a geocodificare lo stabile una volta sola: le unità create con «Genera unità» ereditano le sue coordinate.',
            fields: [
                {
                    name: 'name', label: 'Nome edificio', type: 'text',
                    required: true, maxlength: 150, span: 8, autofocus: true,
                    placeholder: 'es. Condominio Le Palme',
                },
                {
                    name: 'total_units', label: 'Unità totali', type: 'integer',
                    min: 0, span: 4, placeholder: '0',
                    hint: 'Quante unità compone lo stabile. Dall\'elenco, «Genera unità» crea in anagrafica quelle che ancora mancano.',
                },
                {
                    name: 'address', label: 'Indirizzo', type: 'text',
                    required: true, maxlength: 255, span: 12,
                    placeholder: 'Via e numero civico',
                },
                {
                    name: 'city', label: 'Città', type: 'text',
                    required: true, maxlength: 100, span: 6,
                    placeholder: 'es. Civitanova Marche',
                },
                {
                    // Validato lato server con /^\d{5}$/ — stesso controllo qui,
                    // così l'errore arriva prima del salvataggio e sul campo giusto.
                    name: 'cap', label: 'CAP', type: 'text',
                    maxlength: 5, span: 3, placeholder: '62012',
                    pattern: '^\\d{5}$', patternMessage: 'Il CAP è di 5 cifre.',
                },
                {
                    name: 'province', label: 'Provincia', type: 'text',
                    maxlength: 2, span: 3, uppercase: true, placeholder: 'MC',
                    pattern: '^[A-Z]{2}$', patternMessage: 'Sigla di 2 lettere, es. MC.',
                },
            ],
        },
        {
            legend: 'Amministratore di condominio',
            hint: 'Collegandolo alla rubrica fornitori, un cambio di recapito si riflette su tutti gli stabili che amministra.',
            fields: [
                {
                    name: 'administrator_supplier_id', label: 'Amministratore in rubrica', type: 'select',
                    source: 'suppliers', filter: isAdministrator, span: 12,
                    emptyLabel: '— Non in rubrica (compila sotto) —',
                    hint: 'Compaiono solo i fornitori di categoria «Amministratore di condominio». Se manca, crealo in Fornitori con quella categoria.',
                },
                // Il fallback storico: vive solo finché non c'è un fornitore collegato.
                {
                    name: 'administrator_name', label: 'Nome amministratore', type: 'text',
                    maxlength: 150, span: 4, placeholder: 'Studio / persona di riferimento',
                    when: (d) => !d.administrator_supplier_id,
                    hint: 'Testo di questo edificio: non si aggiorna insieme agli altri stabili.',
                },
                {
                    name: 'administrator_phone', label: 'Telefono amministratore', type: 'tel',
                    maxlength: 30, span: 4, placeholder: 'es. 0733 123456',
                    when: (d) => !d.administrator_supplier_id,
                },
                {
                    name: 'administrator_email', label: 'Email amministratore', type: 'email',
                    maxlength: 255, span: 4, placeholder: 'amministratore@esempio.it',
                    when: (d) => !d.administrator_supplier_id,
                },
            ],
        },
        {
            legend: 'Note',
            fields: [
                {
                    name: 'notes', label: 'Note', type: 'textarea', rows: 4, span: 12,
                    placeholder: 'Portineria, orari, lavori in corso, riferimenti utili…',
                },
            ],
        },
        {
            // Si aprono di rado: chi inserisce uno stabile scrive l'indirizzo, non
            // le coordinate. Restano raggiungibili per correggere un puntatore
            // finito nel posto sbagliato.
            legend: 'Posizione sulla mappa',
            fold: true,
            optionalNote: 'di norma compilate in automatico',
            hint: 'Ricavate dal CAP al momento della generazione delle unità. Modificale solo se sulla mappa lo stabile è nel posto sbagliato.',
            fields: [
                {
                    name: 'latitude', label: 'Latitudine', type: 'number',
                    min: -90, max: 90, span: 3, placeholder: '43.30700000',
                },
                {
                    name: 'longitude', label: 'Longitudine', type: 'number',
                    min: -180, max: 180, span: 3, placeholder: '13.71850000',
                },
            ],
        },
    ],

    afterLoad(data, form) {
        if (!data || !data.administrator_supplier_id) return data;

        // resolveAdministrator() risponde con nome/telefono/email DEL FORNITORE
        // copiati sopra le colonne di testo libero. Popolare il form così com'è
        // scriverebbe i dati della rubrica dentro i campi "non in rubrica", e
        // sembrerebbero un dato di questo edificio.
        data.administrator_name  = '';
        data.administrator_phone = '';
        data.administrator_email = '';

        // api/suppliers.php elenca solo is_active = 1: un amministratore
        // archiviato in rubrica non ha un'opzione, la <select> ricadrebbe sul
        // placeholder e il salvataggio lo scollegherebbe senza dire niente.
        const sel = form.el('administrator_supplier_id');
        const id  = String(data.administrator_supplier_id);
        if (sel && ![...sel.options].some(o => o.value === id)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = (data.administrator_supplier_name || `Fornitore #${id}`) + ' — non più in elenco';
            sel.appendChild(opt);
        }
        return data;
    },

    validate(payload) {
        // Una coordinata sola non posiziona niente: la mappa la ignora e nessuno
        // capisce perché l'edificio non compare.
        const hasLat = payload.latitude !== null && payload.latitude !== undefined;
        const hasLng = payload.longitude !== null && payload.longitude !== undefined;
        if (hasLat !== hasLng) return 'Latitudine e longitudine vanno inserite insieme.';
        return null;
    },
};

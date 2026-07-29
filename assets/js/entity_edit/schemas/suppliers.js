/**
 * Fornitori — schema for the "Nuovo / Modifica fornitore" page.
 *
 * Replaces #suppliers-modal in views/suppliers.html. Reference implementation:
 * every other schema in this folder follows this shape.
 *
 * Categories are kept in sync by hand with SUPPLIER_CATEGORIES in
 * api/suppliers.php — the API rejects anything outside that list, so a value
 * added here without being added there fails at save with "Categoria non valida".
 */

export const CATEGORIES = [
    { value: 'idraulico',       label: 'Idraulico' },
    { value: 'elettricista',    label: 'Elettricista' },
    { value: 'muratore',        label: 'Muratore' },
    { value: 'falegname',       label: 'Falegname' },
    { value: 'imbianchino',     label: 'Imbianchino' },
    { value: 'giardiniere',     label: 'Giardiniere' },
    { value: 'giardinaggio',    label: 'Giardinaggio' },
    { value: 'pulizie',         label: 'Pulizie' },
    { value: 'ascensore',       label: 'Ascensore' },
    { value: 'serrature',       label: 'Serrature' },
    { value: 'amministratore',  label: 'Amministratore di condominio' },
    // phase76: il fornitore di un contatore (Enel, Hera, A2A) e' un fornitore
    // come gli altri. La colonna lo accettava gia'; la whitelist PHP no.
    { value: 'fornitore_utenze', label: 'Fornitore utenze (luce, gas, acqua)' },
    { value: 'altro',           label: 'Altro' },
];

export default {
    entity:   'suppliers',
    api:      'api/suppliers.php',
    listView: 'suppliers',
    titles:   { create: 'Nuovo Fornitore', edit: 'Modifica Fornitore' },
    subtitle: 'Rubrica fornitori e artigiani: chi chiami quando un immobile ha un problema.',
    // A new fornitore has to appear in the manutenzione and edificio dropdowns
    // without a reload.
    invalidates: ['suppliers'],

    sections: [
        {
            legend: 'Anagrafica',
            fields: [
                {
                    name: 'name', label: 'Nome / Ragione sociale', type: 'text',
                    required: true, maxlength: 150, span: 7, autofocus: true,
                    placeholder: 'es. Idraulica Rossi S.r.l.',
                },
                {
                    name: 'category', label: 'Categoria', type: 'select',
                    required: true, options: CATEGORIES, span: 5,
                    hint: 'Determina in quali elenchi il fornitore viene proposto.',
                },
            ],
        },
        {
            legend: 'Recapiti',
            hint: 'Almeno un recapito rende il fornitore utilizzabile dalla bacheca manutenzione.',
            fields: [
                {
                    name: 'phone', label: 'Telefono', type: 'tel',
                    maxlength: 50, span: 4, placeholder: 'es. 333 1234567',
                },
                {
                    name: 'email', label: 'Email', type: 'email',
                    maxlength: 255, span: 4, placeholder: 'nome@esempio.it',
                },
                {
                    name: 'address', label: 'Indirizzo', type: 'text',
                    maxlength: 255, span: 4, placeholder: 'Via, civico, città',
                },
            ],
        },
        {
            legend: 'Valutazione e note',
            fields: [
                {
                    name: 'rating', label: 'Valutazione', type: 'stars', span: 4,
                    hint: 'Quanto ti sei trovato bene. Ordina i suggerimenti in manutenzione.',
                },
                {
                    name: 'notes', label: 'Note', type: 'textarea', rows: 4, span: 8,
                    placeholder: 'Orari, zone servite, tariffe concordate…',
                },
            ],
        },
    ],
};

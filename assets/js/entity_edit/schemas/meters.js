/**
 * Contatori — schema per "Nuovo / Modifica contatore".
 *
 * Il contatore e' l'oggetto fisico; le letture sono un'altra cosa e stanno in
 * meter_readings. api/meters.php espone da sempre POST, PUT e DELETE, ma
 * l'applicazione permetteva solo di crearne uno al volo mentre si registrava
 * una lettura: un POD digitato male non si correggeva piu', un contatore
 * sostituito non si poteva ne' disattivare ne' togliere dalle tendine — e il
 * messaggio d'errore dell'API ("Disattivalo se non e' piu' in uso") indicava
 * un'azione che non esisteva in nessuna schermata.
 *
 * I tipi sono allineati a METER_TYPES in api/meters.php: un valore aggiunto qui
 * e non la' viene rifiutato al salvataggio con "Tipo contatore non valido".
 */

export const METER_TYPES = [
    { value: 'electricity', label: 'Luce (POD)' },
    { value: 'gas',         label: 'Gas (PDR)' },
    { value: 'water',       label: 'Acqua (matricola)' },
    { value: 'heating',     label: 'Riscaldamento (matricola)' },
];

export default {
    entity:   'meters',
    api:      'api/meters.php',
    listView: 'meters',
    titles:   { create: 'Nuovo Contatore', edit: 'Modifica Contatore' },
    subtitle: 'Il contatore fisico dell\'immobile: identificativo, fornitore e dove si trova il quadrante.',
    // Niente `invalidates`: i contatori non sono una sorgente di lookups.js —
    // la pagina letture li rilegge da api/meters.php a ogni cambio immobile.

    sections: [
        {
            legend: 'Contatore',
            fields: [
                {
                    name: 'property_id', label: 'Immobile', type: 'select',
                    required: true, source: 'properties', span: 7, autofocus: true,
                },
                {
                    name: 'meter_type', label: 'Tipo', type: 'select',
                    required: true, options: METER_TYPES, span: 5,
                    hint: 'Decide come si chiama il codice: POD per la luce, PDR per il gas.',
                },
                {
                    name: 'code', label: 'Codice (POD / PDR / matricola)', type: 'text',
                    maxlength: 50, span: 6, placeholder: 'es. IT001E12345678',
                    hint: 'Identificativo nazionale: deve essere univoco in tutta l\'anagrafica.',
                },
                {
                    name: 'serial_number', label: 'Numero di serie', type: 'text',
                    maxlength: 50, span: 6,
                    hint: 'Quello stampato sull\'apparecchio, se diverso dal codice.',
                },
            ],
        },
        {
            legend: 'Fornitore e ubicazione',
            fields: [
                {
                    name: 'supplier_id', label: 'Fornitore', type: 'select',
                    source: 'suppliers', span: 6,
                    hint: 'Dalla rubrica fornitori (categoria "Fornitore utenze").',
                },
                {
                    name: 'supplier_name', label: 'Fornitore (testo libero)', type: 'text',
                    maxlength: 150, span: 6,
                    hint: 'Da usare solo se il fornitore non e\' in rubrica.',
                },
                {
                    name: 'location', label: 'Dove si trova il quadrante', type: 'text',
                    maxlength: 150, span: 12,
                    placeholder: 'es. nicchia esterna a destra del portone, chiave dal portiere',
                    hint: 'Serve a chi va a leggerlo: due contatori uguali nello stesso stabile si distinguono solo cosi\'.',
                },
            ],
        },
        {
            legend: 'Stato',
            fields: [
                {
                    name: 'installed_on', label: 'Installato il', type: 'date', span: 4,
                },
                {
                    name: 'removed_on', label: 'Rimosso il', type: 'date', span: 4,
                    hint: 'Non puo\' precedere l\'installazione.',
                },
                {
                    name: 'is_active', label: 'Attivo', type: 'checkbox', span: 4,
                    default: true,
                    hint: 'Un contatore sostituito si disattiva, non si elimina: lo storico delle letture resta consultabile.',
                },
                {
                    name: 'notes', label: 'Note', type: 'textarea', rows: 3, span: 12,
                },
            ],
        },
    ],
};

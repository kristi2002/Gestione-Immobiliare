/**
 * Quotazioni OMI — schema for the "Nuova / Modifica quotazione OMI" page.
 *
 * Replaces #omi-modal in views/valuation.html.
 *
 * Quello che si scrive qui non è la valutazione di un immobile: è una riga di
 * listino (€/m² per comune, zona e tipologia), la base da cui parte ogni stima
 * di `api/valuation.php?action=estimate`. Tre cose che il vecchio modale non
 * diceva e che questo modulo mette in chiaro:
 *
 *   · api/valuation.php scrive `source = 'manuale'` su OGNI create e su OGNI
 *     update. Toccare a mano una riga importata la trasforma in un override che
 *     importOmi() salterà per sempre. È la funzione che rende utile questo
 *     modulo — le microzone che il listino non copre — ed è anche il modo di
 *     congelare per sbaglio una zona sui valori di due anni fa. Va detto prima
 *     di salvare, non scoperto al semestre successivo.
 *   · comune + zona + tipologia sono la chiave unica (uq_omi_zone_type) e la
 *     create è una ON DUPLICATE KEY UPDATE: la stessa combinazione non dà
 *     errore, sostituisce la riga che c'era.
 *   · il comune è confrontato per uguaglianza con `properties.city`. Scritto in
 *     un altro modo, il valore c'è ma nessun immobile lo trova.
 *
 * Nessuna sezione richiudibile: dieci campi in tutto e nessuno è raro — i
 * quattro importi sono il motivo per cui la riga esiste, e la nota è l'unica
 * cosa che rende difendibile un override fra sei mesi.
 */

/**
 * Allineate a mano con OMI_TYPES in api/valuation.php:
 *
 *   const OMI_TYPES = ['appartamento', 'villa', 'ufficio', 'negozio', 'box',
 *                      'terreno', 'altro'];
 *
 * e con l'ENUM di `omi_quotazioni.property_type` (phase38), che ha esattamente
 * questi sette valori. Attenzione alla differenza con gli altri moduli: una
 * tipologia fuori elenco NON viene rifiutata, validateOmiInput() la sostituisce
 * in silenzio con 'appartamento'.
 */
export const OMI_TYPES = [
    { value: 'appartamento', label: 'Appartamento' },
    { value: 'villa',        label: 'Villa' },
    { value: 'ufficio',      label: 'Ufficio' },
    { value: 'negozio',      label: 'Negozio' },
    { value: 'box',          label: 'Box / Posto auto' },
    { value: 'terreno',      label: 'Terreno' },
    { value: 'altro',        label: 'Altro' },
];

/**
 * I semestri selezionabili, dal corrente all'indietro.
 *
 * Il periodo era un campo di testo e omiNormalizePeriod() perdona molto: "2026"
 * diventa 2026-S1 senza chiedere, e ogni forma che non contenga un anno viene
 * respinta solo dopo il viaggio al server. Una tendina toglie sia l'indovinello
 * sia l'errore.
 *
 * Non si offre il semestre futuro: omiPeriodStatus() lo marca «quasi sempre un
 * refuso di battitura». E nessun semestre è preselezionato — valuation.js non
 * deduce il semestre dal browser nemmeno per l'import ("l'orologio del client
 * potrebbe datare male il listino"), e la stessa cautela vale qui.
 */
function semesterOptions(now = new Date(), back = 9) {
    const out = [];
    let year = now.getFullYear();
    let sem  = now.getMonth() < 6 ? 1 : 2;   // gennaio–giugno = S1, come omiCurrentPeriod()

    for (let i = 0; i <= back; i++) {
        out.push({ value: `${year}-S${sem}`, label: `${sem}° semestre ${year} (${year}-S${sem})` });
        if (sem === 1) { sem = 2; year -= 1; } else { sem = 1; }
    }
    return out;
}

const PERIODS = semesterOptions();

/**
 * Il punto è il separatore DECIMALE, non quello delle migliaia.
 *
 * È lo stesso inganno che parseOmiCsv() disinnesca sul listino ufficiale, dove
 * "1.600" vale milleseicento. Qui il campo è un <input type="number">: 1.600
 * arriva davvero come 1,6 e verrebbe salvato così, con un errore di mille volte
 * su ogni stima futura di quella zona e nulla che protesti.
 *
 * Una quotazione di vendita sotto i 50 €/m² sul costruito non esiste; l'unica
 * eccezione vera sono i terreni, che a listino stanno anche sotto i 10 €/m² —
 * quindi lì il controllo non si applica.
 */
const sanePrice = (value, data) => {
    if (data.property_type === 'terreno') return null;
    const n = Number(value);
    return (n > 0 && n < 50)
        ? 'Valore troppo basso: il punto è il separatore decimale, quindi «1.600» vale 1,60 €/m². Milleseicento si scrive 1600.'
        : null;
};

/**
 * Il canone OMI è per m² AL MESE: 5–15 €/m² su un'abitazione media, 40 nelle
 * vie migliori di Milano. Tre cifre sono quasi sempre un valore di vendita
 * finito nella riga sbagliata, e a valle diventano un «canone stimato» da
 * centomila euro al mese in una schermata mostrata al proprietario.
 */
const saneRent = (value) =>
    Number(value) > 200
        ? 'Troppo alto per un canone al m² AL MESE: sembra un valore di vendita finito nel campo dell\'affitto.'
        : null;

export default {
    entity:   'valuation',
    api:      'api/valuation.php',
    listView: 'valuation',
    titles:   { create: 'Nuova Quotazione OMI', edit: 'Modifica Quotazione OMI' },
    subtitle: 'Valore al metro quadro di una zona: la base da cui parte ogni stima. Inserita a mano, la riga diventa un override che l\'import ufficiale non tocca.',

    sections: [
        {
            // I tre campi della chiave unica. Stanno insieme e per primi perché
            // sbagliarne uno non produce un errore: produce una riga che esiste
            // e che nessun immobile troverà mai.
            legend: 'Zona di riferimento',
            hint: 'Comune, zona e tipologia identificano la quotazione: la stima li confronta con la scheda immobile. Se esiste già una riga per la stessa combinazione, questa la sostituisce.',
            fields: [
                {
                    name: 'comune', label: 'Comune', type: 'text',
                    required: true, maxlength: 100, span: 5, autofocus: true,
                    placeholder: 'es. Civitanova Marche',
                    hint: 'Confronto per uguaglianza con la città della scheda immobile: «Civitanova M.» non trova gli immobili salvati come «Civitanova Marche».',
                },
                {
                    // uppercase: le zone del listino sono siglate maiuscole (B1,
                    // D3). Il confronto SQL è case-insensitive, ma una tabella
                    // metà "b1" e metà "B1" è illeggibile in elenco.
                    name: 'cadastral_zone', label: 'Zona OMI', type: 'text',
                    maxlength: 20, span: 3, uppercase: true,
                    placeholder: 'es. B1',
                    hint: 'Vuoto = quotazione valida su tutto il comune, quella che la stima usa quando l\'immobile non ha una zona catastale.',
                },
                {
                    // Obbligatoria di proposito, benché l'API non la pretenda:
                    // validateOmiInput() rimpiazza in silenzio una tipologia
                    // vuota o sconosciuta con 'appartamento', e una riga finita
                    // lì per distrazione governa le stime di tutte le abitazioni
                    // della zona senza che nulla lo segnali.
                    name: 'property_type', label: 'Tipologia', type: 'select',
                    required: true, options: OMI_TYPES, span: 4,
                    emptyLabel: '— Scegli la tipologia —',
                    hint: 'Fa parte della chiave: le tipologie del listino ufficiale ci arrivano già ridotte a queste sette.',
                },
            ],
        },
        {
            legend: 'Valori al metro quadro',
            hint: 'Valori per m² commerciale, come li pubblica l\'Agenzia delle Entrate. Il separatore decimale è il punto: milleseicento euro al metro si scrive 1600 — scritto «1.600» vale un euro e sessanta. L\'affitto è facoltativo: senza, la stima non propone un canone.',
            fields: [
                {
                    name: 'price_min_sqm', label: 'Vendita minima', type: 'money',
                    span: 3, min: 0,
                    // price_*_sqm e rent_*_sqm sono DECIMAL(10,2): oltre questa
                    // cifra MySQL rifiuta la riga e l'utente legge solo
                    // "Errore database".
                    max: 99999999.99,
                    suffix: '€/m²', placeholder: '1600',
                    validate: sanePrice,
                },
                {
                    name: 'price_max_sqm', label: 'Vendita massima', type: 'money',
                    span: 3, min: 0, max: 99999999.99,
                    suffix: '€/m²', placeholder: '2100',
                    // L'API blocca già l'intervallo invertito ("il valore minimo
                    // non può superare il massimo"), ma solo dopo il viaggio e
                    // senza dire quale dei due campi guardare.
                    validate: (value, data) => sanePrice(value, data)
                        || (data.price_min_sqm != null && Number(value) < Number(data.price_min_sqm)
                            ? 'Il massimo non può essere inferiore al minimo di vendita.'
                            : null),
                },
                {
                    name: 'rent_min_sqm', label: 'Affitto minimo', type: 'money',
                    span: 3, min: 0, max: 99999999.99,
                    suffix: '€/m² al mese', placeholder: '5.5',
                    validate: saneRent,
                },
                {
                    name: 'rent_max_sqm', label: 'Affitto massimo', type: 'money',
                    span: 3, min: 0, max: 99999999.99,
                    suffix: '€/m² al mese', placeholder: '8',
                    validate: (value, data) => saneRent(value)
                        || (data.rent_min_sqm != null && Number(value) < Number(data.rent_min_sqm)
                            ? 'Il massimo non può essere inferiore al minimo di affitto.'
                            : null),
                },
            ],
        },
        {
            legend: 'Semestre e origine',
            hint: 'Salvando, questa riga diventa un override manuale: l\'import del listino ufficiale la salterà — le conta come «righe saltate perché corrette a mano» — e da qui in avanti resta aggiornata solo se la aggiorni tu.',
            fields: [
                {
                    // Obbligatorio anche se l'API accetta il periodo vuoto: senza
                    // semestre omiPeriodStatus() restituisce 'unknown', il badge
                    // di freschezza non può funzionare e una stima poggiata su un
                    // listino di tre anni fa esce senza che nulla lo segnali. È
                    // il motivo per cui phase73 ha normalizzato questa colonna.
                    name: 'period', label: 'Semestre di riferimento', type: 'select',
                    required: true, options: PERIODS, span: 5,
                    emptyLabel: '— Scegli il semestre —',
                    hint: 'A quale listino si riferiscono i valori. Da qui la scheda decide se la quotazione è ancora attendibile.',
                },
                {
                    // Sola lettura: `source` non è un campo del payload, lo scrive
                    // l'API. Mostrarlo comunque è l'unico modo di far vedere
                    // all'agente che sta per staccare una riga dal listino.
                    name: 'source', label: 'Origine della riga', type: 'static', span: 7,
                    render: (d) => (d && d.source === 'import')
                        ? 'Importata dal listino ufficiale — salvando diventa un override manuale'
                        : 'Override manuale — l\'import del listino non la sovrascrive',
                },
                {
                    name: 'notes', label: 'Note', type: 'textarea',
                    rows: 3, span: 12, maxlength: 255,
                    placeholder: 'Perché questo valore: microzona non coperta dal listino, valore verificato su rogiti recenti, media fra due zone confinanti…',
                    hint: 'Fra sei mesi è l\'unica cosa che spiega perché questa riga non arriva dall\'Agenzia delle Entrate.',
                },
            ],
        },
    ],

    /**
     * Il semestre di una riga vecchia può cadere fuori dalla tendina. Senza
     * questa aggiunta il <select> resterebbe sul segnaposto e il primo salvataggio
     * azzererebbe il periodo — una perdita di dato che nessuno ha chiesto e che
     * nessuno vedrebbe.
     */
    afterLoad(data, form) {
        const sel = form.el('period');
        if (sel && data && data.period && !Array.from(sel.options).some(o => o.value === data.period)) {
            const opt = document.createElement('option');
            opt.value = data.period;
            opt.textContent = `${data.period} (fuori elenco)`;
            sel.appendChild(opt);
        }
        return data;
    },

    /**
     * L'API accetta una quotazione senza nessun importo. È il caso peggiore: la
     * riga vuota occupa la chiave (comune, zona, tipologia), viene marcata
     * 'manuale' e da quel momento l'import ufficiale salta per sempre quella
     * zona — che resta senza valori e senza spiegazione.
     */
    validate(payload) {
        const set = (v) => v !== null && v !== undefined && v !== '';

        if (!set(payload.price_min_sqm) && !set(payload.price_max_sqm)
            && !set(payload.rent_min_sqm) && !set(payload.rent_max_sqm)) {
            return 'Inserisci almeno un intervallo di valori: una riga senza importi resta un override vuoto e blocca l\'import ufficiale su questa zona.';
        }

        // saveAppraisal() rifiuta la quotazione se manca uno dei due estremi di
        // vendita ("non ha valori di vendita"): mezza forbice rende la stima
        // impossibile da congelare per ogni immobile della zona.
        if (set(payload.price_min_sqm) !== set(payload.price_max_sqm)) {
            return 'Vendita: indica sia il minimo sia il massimo. Con un solo estremo la stima non può essere salvata sulla scheda immobile.';
        }

        return null;
    },
};

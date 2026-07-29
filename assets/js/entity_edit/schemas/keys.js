/**
 * Chiavi — schema della pagina "Registra / Modifica chiavi".
 *
 * Sostituisce #key-modal in views/keys.html.
 *
 * È il modulo più condizionale della serie, perché il detentore è polimorfo:
 * api/property_keys.php tiene valorizzata UNA sola FK fra cinque (agente,
 * fornitore, inquilino, proprietario, lead) e riserva holder_name al detentore
 * occasionale. Qui quel bivio diventa cinque campi che si escludono a vicenda
 * con `when`, uno per tipo; beforeSave() li ricompone nell'unico holder_ref_id
 * che l'API accetta in scrittura.
 *
 * I nomi dei campi sono quelli che la GET restituisce (holder_id,
 * holder_supplier_id, holder_tenant_id, …), così il record popola i controlli
 * senza traduzioni: tradurre serve solo in uscita.
 */

const API = 'api/property_keys.php';

/* Rispecchia KEY_TYPES in api/property_keys.php:
     const KEY_TYPES = ['portone', 'appartamento', 'cantina', 'box', 'cancello', 'altro'];
   Una voce in più qui e il salvataggio muore con "Tipo chiave non valido". */
export const KEY_TYPES = [
    { value: 'portone',      label: 'Portone principale' },
    { value: 'appartamento', label: 'Appartamento' },
    { value: 'cantina',      label: 'Cantina' },
    { value: 'box',          label: 'Box auto' },
    { value: 'cancello',     label: 'Cancello / telecomando' },
    { value: 'altro',        label: 'Altro' },
];

/* Rispecchia KEY_STATUSES in api/property_keys.php:
     const KEY_STATUSES = ['out', 'in_office', 'lost'];
   L'ordine qui NON è quello del PHP: senza opzione vuota la prima voce è il
   default del form, e il default dell'API è 'in_office' ($data['status'] ?? …). */
export const KEY_STATUSES = [
    { value: 'in_office', label: 'In ufficio' },
    { value: 'out',       label: 'In possesso' },
    { value: 'lost',      label: 'Smarrite' },
];

/* Rispecchia KEY_HOLDER_TYPES in api/property_keys.php:
     const KEY_HOLDER_TYPES = ['agente', 'fornitore', 'inquilino', 'proprietario', 'lead', 'altro'];
   Il vuoto non è un valore dell'enum: è l'assenza di detentore, cioè "in ufficio". */
export const HOLDER_TYPES = [
    { value: 'agente',       label: 'Agente' },
    { value: 'fornitore',    label: 'Fornitore' },
    { value: 'inquilino',    label: 'Inquilino' },
    { value: 'proprietario', label: 'Proprietario' },
    { value: 'lead',         label: 'Cliente / lead' },
    { value: 'altro',        label: 'Altro (occasionale)' },
];

/** holder_type → colonna che la GET restituisce e che l'API rilegge come holder_ref_id. */
const HOLDER_FIELD = {
    agente:       'holder_id',
    fornitore:    'holder_supplier_id',
    inquilino:    'holder_tenant_id',
    proprietario: 'holder_client_id',
    lead:         'holder_lead_id',
};

/** Un campo detentore si mostra solo per il proprio tipo. */
const holderIs = (type) => (d) => d.holder_type === type;

// ---------------------------------------------------------------------------
// Tendine che il motore non sa ancora riempire da solo
// ---------------------------------------------------------------------------

/**
 * Due elenchi qui non passano da lookups.js, e non per pigrizia:
 *
 *   · "Cliente / lead" — in lookups.js SOURCES non esiste una voce `leads`.
 *   · "Agente"         — la voce `agents` esiste ma punta a api/admin_users.php,
 *                        che apre con requireRole('super_admin'). La pagina
 *                        Chiavi è invece concessa anche ad `admin` e `agent`
 *                        (config/roles.php), cioè proprio a chi le chiavi le
 *                        prende in mano: per loro quella tendina risponderebbe
 *                        403, resterebbe vuota e il form aprirebbe con un avviso
 *                        "Elenco non caricato" a ogni apertura.
 *
 * Un terzo elenco — il "Motivo della consegna" — non è mappabile per natura:
 * dipende dall'immobile scelto ADESSO, mentre `source` si carica una volta al
 * mount. Il motore non ha (ancora) un modo per dichiarare "opzioni che dipendono
 * da un altro campo".
 *
 * Tutti e tre arrivano dall'API di questa stessa entità, che li serve già:
 * ?action=holder_options e ?action=context. Il giorno in cui lookups.js avrà
 * `leads` e un `agents` leggibile da tutti, le prime due spariscono da qui.
 */

/** Le cinque rubriche del detentore in una sola richiesta, per l'intera pagina. */
let holderPromise = null;
function holderOptions() {
    if (!holderPromise) {
        holderPromise = fetch(`${API}?action=holder_options`)
            .then(r => r.json())
            .then(j => (j.success ? (j.data || {}) : {}))
            // Un errore non deve avvelenare la cache: al prossimo cambio si riprova.
            .catch(() => { holderPromise = null; return {}; });
    }
    return holderPromise;
}

/** Appuntamenti e interventi dell'immobile scelto, memorizzati per immobile. */
const contextCache = new Map();
function contextOptions(propertyId) {
    const key = String(propertyId || '');
    if (!key) return Promise.resolve([]);
    if (!contextCache.has(key)) {
        contextCache.set(key, fetch(`${API}?action=context&property_id=${encodeURIComponent(key)}`)
            .then(r => r.json())
            .then(j => {
                if (!j.success) return [];
                const when = (v) => (window.Fmt ? window.Fmt.dateTime(v) : String(v || ''));
                // "appointment:12" / "reminder:7": una sola tendina per due FK
                // diverse, ricomposte in beforeSave().
                return [
                    ...(j.data.appointments || []).map(a => ({
                        value: `appointment:${a.id}`,
                        label: `Appuntamento ${a.appointment_type || ''} — ${when(a.appointment_date)}`
                             + (a.counterpart ? ` · ${a.counterpart}` : ''),
                    })),
                    ...(j.data.interventi || []).map(r => ({
                        value: `reminder:${r.id}`,
                        label: `Intervento — ${r.title}` + (r.supplier_name ? ` · ${r.supplier_name}` : ''),
                    })),
                ];
            })
            .catch(() => { contextCache.delete(key); return []; }));
    }
    return contextCache.get(key);
}

/**
 * Riempie una <select> lasciando in testa il placeholder che il motore ha già
 * reso (è lì che vive `emptyLabel`). `desired` serve solo al primo giro in
 * modifica: populate() scrive il valore del record prima che le opzioni
 * esistano, e un valore senza <option> corrispondente il browser lo azzera.
 */
function fillSelect(root, name, options, desired) {
    const sel = root.querySelector(`select[name="${name}"]`);
    if (!sel) return;

    const keep = (desired === undefined || desired === null || desired === '')
        ? sel.value : String(desired);
    const placeholder = sel.querySelector('option[value=""]');

    sel.replaceChildren();
    if (placeholder) sel.appendChild(placeholder);
    options.forEach(o => sel.appendChild(new Option(o.label, o.value)));
    sel.value = keep;   // se la voce non c'è più torna a vuoto, non a caso
}

/**
 * Allinea le tendine dinamiche allo stato corrente del form.
 * `record` c'è solo in modifica, quando i valori da riselezionare li conosce
 * la riga appena caricata e non il DOM.
 */
function syncDynamicLists(root, record) {
    if (!root) return;
    const state = root.__keysLists || (root.__keysLists = {});

    holderOptions().then(data => {
        if (state.holders) return;
        if (!data.agente && !data.lead) return;   // andata male: si riprova al prossimo change
        state.holders = true;
        fillSelect(root, 'holder_id',      data.agente || [], record && record.holder_id);
        fillSelect(root, 'holder_lead_id', data.lead   || [], record && record.holder_lead_id);
    });

    const el  = root.querySelector('[name="property_id"]');
    const pid = String((record && record.property_id) || (el && el.value) || '');
    if (state.context === pid) return;
    state.context = pid;

    contextOptions(pid).then(options => {
        // L'immobile può essere cambiato mentre la richiesta era in volo.
        if (state.context !== pid) return;
        // Nessun valore da riselezionare in modifica: appointment_id/reminder_id
        // vivono sull'evento di registro, non sulla riga delle chiavi.
        fillSelect(root, 'handover_context', options);
    });
}

// Il cambio di immobile o di detentore non passa da nessun hook dello schema:
// si ascolta il form dov'è, una volta sola per pagina (questo modulo non viene
// rivalutato a ogni navigazione, solo l'entry del loader lo è).
document.addEventListener('change', (e) => {
    const root = e.target && e.target.closest && e.target.closest('[data-ef-entity="keys"]');
    if (root) syncDynamicLists(root);
});

// ---------------------------------------------------------------------------

export default {
    entity:   'keys',
    api:      'api/property_keys.php',
    listView: 'keys',
    titles:   { create: 'Registra Chiavi', edit: 'Modifica Chiavi' },
    subtitle: 'Chi ha le chiavi di questo immobile, da quando e fino a quando.',

    sections: [
        {
            legend: 'Immobile e chiave',
            hint: 'Una scheda per mazzo: portone e appartamento vanno registrati separati se girano separati.',
            fields: [
                {
                    name: 'property_id', label: 'Immobile', type: 'picker', source: 'properties',
                    required: true, span: 12,
                    placeholder: 'Cerca per riferimento, indirizzo o città…',
                    hint: 'Determina anche gli appuntamenti e gli interventi proposti come motivo della consegna.',
                },
                {
                    name: 'key_type', label: 'Tipo chiave', type: 'select',
                    options: KEY_TYPES, emptyLabel: false, span: 4,
                },
                {
                    name: 'quantity', label: 'Copie', type: 'integer',
                    min: 1, span: 3, placeholder: '1',
                    // Campo lasciato vuoto = una copia, come fa l'API.
                    emptyAs: 1,
                    hint: 'Quante copie fisiche contiene il mazzo.',
                },
                {
                    name: 'key_code', label: 'Codice portachiavi', type: 'text',
                    maxlength: 50, span: 5, placeholder: 'es. A12',
                    hint: 'L\'etichetta fisica: è il primo dato che si cerca al bancone. Dalla lista Chiavi si può anche scansionare.',
                },
            ],
        },
        {
            legend: 'Custodia',
            hint: 'Chi ha il mazzo adesso. Senza detentore le chiavi risultano in agenzia.',
            fields: [
                {
                    name: 'status', label: 'Stato', type: 'select',
                    options: KEY_STATUSES, emptyLabel: false, span: 4,
                    hint: 'Con «In ufficio» l\'API azzera detentore e rientro previsto: sono chiavi in agenzia.',
                },
                {
                    name: 'holder_type', label: 'Tipo detentore', type: 'select',
                    options: HOLDER_TYPES, emptyLabel: '— Nessuno: chiavi in ufficio —', span: 4,
                    hint: 'La consegna resta agganciata alla scheda del soggetto, non a una stringa.',
                },

                // Un campo per tipo: il motore serializza a null quello nascosto,
                // quindi cambiare tipo non lascia dietro l'id del tipo precedente.
                {
                    name: 'holder_id', label: 'Agente', type: 'select',
                    required: true, span: 4, when: holderIs('agente'),
                },
                {
                    name: 'holder_supplier_id', label: 'Fornitore', type: 'select', source: 'suppliers',
                    required: true, span: 4, when: holderIs('fornitore'),
                },
                {
                    name: 'holder_tenant_id', label: 'Inquilino', type: 'picker', source: 'tenants',
                    required: true, span: 4, when: holderIs('inquilino'),
                    placeholder: 'Digita cognome o nome…',
                },
                {
                    name: 'holder_client_id', label: 'Proprietario', type: 'picker', source: 'clients',
                    required: true, span: 4, when: holderIs('proprietario'),
                    placeholder: 'Digita cognome o ragione sociale…',
                },
                {
                    name: 'holder_lead_id', label: 'Cliente / lead', type: 'select',
                    required: true, span: 4, when: holderIs('lead'),
                },
                {
                    name: 'holder_name', label: 'Nome detentore', type: 'text',
                    required: true, maxlength: 100, span: 4, when: holderIs('altro'),
                    placeholder: 'Chi non è in anagrafica',
                    hint: 'Testo libero: resta una stringa, non una scheda.',
                },

                {
                    // Non è un campo dell'API: è la coppia appointment_id /
                    // reminder_id in una tendina sola, sciolta in beforeSave().
                    name: 'handover_context', label: 'Motivo della consegna', type: 'select',
                    emptyLabel: '— Non specificato —', span: 8,
                    when: (d) => !!d.holder_type,
                    hint: 'Appuntamento o intervento sull\'immobile: resta agganciato allo storico di custodia.',
                },
                {
                    name: 'location', label: 'Ubicazione', type: 'text',
                    maxlength: 255, span: 4, placeholder: 'Cassetta, cassetto ufficio…',
                    hint: 'Dove sta il mazzo quando è in agenzia.',
                },
            ],
        },
        {
            legend: 'Date',
            fields: [
                { name: 'handed_at', label: 'Consegnate il', type: 'date', span: 4 },
                {
                    name: 'due_back_at', label: 'Rientro previsto', type: 'date', span: 4,
                    hint: 'Superata la data la scheda va in rosso e parte il sollecito. Vale solo per le chiavi fuori.',
                },
                { name: 'returned_at', label: 'Restituite il', type: 'date', span: 4 },
            ],
        },
        {
            legend: 'Note',
            fold: true,
            optionalNote: 'facoltative',
            fields: [
                {
                    name: 'notes', label: 'Note', type: 'textarea', rows: 3, span: 12,
                    placeholder: 'Il codice del cancello, il vicino che apre, il mazzo doppione…',
                },
            ],
        },
    ],

    afterLoad(data, form) {
        // Le tendine dinamiche sono ancora vuote quando populate() scrive i
        // valori: senza il record alla mano il detentore scelto verrebbe azzerato
        // dalla prima <option> mancante. Volutamente NON await: il motore usa il
        // valore restituito COME record, e una Promise diventerebbe la scheda.
        syncDynamicLists(form.mountEl, data);
        return data;
    },

    beforeSave(payload) {
        // Cinque campi in lettura, un solo parametro in scrittura.
        const field = HOLDER_FIELD[payload.holder_type];
        payload.holder_ref_id = field ? payload[field] : null;

        // "appointment:12" → la FK giusta sull'evento di registro.
        const [kind, id] = String(payload.handover_context || '').split(':');
        payload.appointment_id = kind === 'appointment' ? Number(id) : null;
        payload.reminder_id    = kind === 'reminder'    ? Number(id) : null;
        delete payload.handover_context;
    },

    validate(d) {
        // Stessi tre rifiuti di validateKeyInput(), detti prima della richiesta.
        if (d.status === 'out' && !d.holder_type) {
            return 'Una chiave consegnata deve avere un detentore: scegli il tipo e il nominativo.';
        }
        if (d.handed_at && d.returned_at && d.returned_at < d.handed_at) {
            return 'La data di rientro non può precedere la consegna.';
        }
        if (d.handed_at && d.due_back_at && d.due_back_at < d.handed_at) {
            return 'Il rientro previsto non può precedere la consegna.';
        }
        return null;
    },
};

/**
 * Inventario — schema della scheda "Nuovo / Modifica bene".
 *
 * Sostituisce #inventory-modal in views/inventory.html.
 *
 * Due cose che il modale faceva e che qui cambiano di posto:
 *
 *   1. L'IMMOBILE non era un campo. L'elenco Inventario è già filtrato su un
 *      immobile (#inventory-property-select) e il modale prendeva quello dalla
 *      variabile di pagina. Una pagina con un suo indirizzo non ha una tendina
 *      di pagina alle spalle, quindi `property_id` diventa un campo vero —
 *      precompilato con l'immobile da cui si è partiti, e modificabile, il che
 *      per inciso è l'unico modo per spostare un bene fra due unità.
 *
 *   2. LE FOTO si allegano solo dopo aver salvato: hanno bisogno dell'id della
 *      riga. Restano un campo `custom` che in creazione dice perché non è
 *      ancora possibile, e in modifica mostra la galleria e il caricamento.
 *      È la stessa regola di prima, detta però prima di far perdere tempo.
 *
 * Il flusso dei verbali (snapshot) non passa di qui: congela le righe per
 * contratto e vive tutto in assets/js/inventory.js.
 */

// Le foto non passano da api/inventory.php: sono documenti a tutti gli effetti
// (doc_type 'inventario', agganciati con inventory_item_id) e vivono nello
// stesso ramo protetto delle carte d'identità, scaricabili solo dallo streamer
// autenticato. Stesso contratto usato dal vecchio modale.
const DOCS_API = 'api/documents.php';
const ITEM_API = 'api/inventory.php';

/** Miniature + caricamento. Solo in modifica: serve l'id della riga. */
function photoWidget() {
    return {
        name: 'photos',
        label: 'Prova fotografica',
        type: 'custom',
        span: 12,
        html: `
            <p class="field-hint" style="margin-top:0">
                Le foto restano protette: non sono pubbliche e passano dallo streamer
                autenticato, come le carte d'identità.
            </p>
            <div class="ef-photo-empty text-muted">Salva il bene per poter allegare le foto.</div>
            <div class="ef-photo-list"></div>
            <div class="ef-photo-upload" hidden>
                <input type="file" class="form-input ef-photo-file"
                       accept="image/jpeg,image/png,image/webp,application/pdf">
                <button type="button" class="btn btn--ghost btn--sm ef-photo-btn">Carica foto</button>
            </div>`,

        onMount(box, form) {
            const btn = box.querySelector('.ef-photo-btn');
            btn.addEventListener('click', async () => {
                const input = box.querySelector('.ef-photo-file');
                if (!input.files?.length) { form.alert('Scegli prima un file.', 'error'); return; }

                // Stessi campi del vecchio modale: e' api/documents.php a
                // ricevere il file, con l'aggancio al bene e all'immobile.
                const fd = new FormData();
                fd.append('file', input.files[0]);
                fd.append('doc_type', 'inventario');
                fd.append('inventory_item_id', form.id);
                fd.append('property_id', form.el('property_id')?.value || '');
                fd.append('title', 'Foto inventario');

                btn.disabled = true;
                try {
                    const res  = await fetch(DOCS_API, { method: 'POST', body: fd });
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    input.value = '';
                    form.alert('Foto allegata.', 'success');
                    await reloadPhotos(box, form);
                } catch (err) {
                    form.alert(err.message, 'error');
                } finally {
                    btn.disabled = false;
                }
            });
        },

        onPopulate(box, data, form) {
            const canUpload = !!form.id;
            box.querySelector('.ef-photo-empty').hidden  = canUpload;
            box.querySelector('.ef-photo-upload').hidden = !canUpload;
            renderPhotos(box, data?.photos || []);
        },
    };
}

/** Rilegge il bene per riavere l'elenco foto aggiornato. */
async function reloadPhotos(box, form) {
    if (!form.id) return;
    try {
        const res  = await fetch(`${ITEM_API}?id=${encodeURIComponent(form.id)}`);
        const json = await res.json();
        if (!json.success) return;
        let item = json.data;
        if (Array.isArray(item)) item = item[0] || {};
        renderPhotos(box, item.photos || []);
    } catch (_) { /* la foto e' salva: un errore di rilettura non e' fatale */ }
}

function renderPhotos(box, photos) {
    const list = box.querySelector('.ef-photo-list');
    if (!list) return;
    if (!photos.length) {
        list.innerHTML = '<span class="text-muted">Nessuna foto allegata.</span>';
        return;
    }
    list.innerHTML = photos.map(p => {
        const name = String(p.original_name || p.title || 'allegato').replace(/[<>&"]/g, '');
        return `<a class="ef-photo-chip" href="api/download_document.php?id=${Number(p.id)}"
                   target="_blank" rel="noopener" title="${name}">${name}</a>`;
    }).join('');
}

export default {
    entity:   'inventory',
    api:      'api/inventory.php',
    listView: 'inventory',
    titles:   { create: 'Nuovo bene', edit: 'Modifica bene' },
    subtitle: 'Registro dei beni presenti nell\'immobile: è la base del verbale di consegna.',

    sections: [
        {
            legend: 'Bene',
            fields: [
                {
                    name: 'property_id', label: 'Immobile', type: 'picker',
                    source: 'properties', required: true, span: 12,
                    placeholder: 'Cerca per riferimento o indirizzo…',
                    hint: 'Precompilato con l\'immobile da cui hai aperto l\'inventario. Cambiandolo, il bene si sposta.',
                },
                {
                    name: 'item_name', label: 'Nome articolo', type: 'text',
                    required: true, maxlength: 150, span: 6, autofocus: true,
                    placeholder: 'es. Lavatrice, Divano tre posti, Condizionatore camera',
                },
                {
                    // Le categorie vivono in `inventory_categories` e l'API valida
                    // su quella tabella: elencarle qui a mano vorrebbe dire
                    // rifiutare la prima che l'agenzia aggiunge da sé.
                    name: 'category', label: 'Categoria', type: 'select',
                    source: 'inventoryCategories', required: true, span: 3,
                },
                {
                    name: 'quantity', label: 'Quantità', type: 'integer',
                    min: 1, span: 3, placeholder: '1',
                    hint: 'Beni identici nella stessa stanza.',
                },
            ],
        },
        {
            legend: 'Stato alla consegna',
            hint: 'È quello che si confronta a fine locazione: com\'era quando è stato consegnato.',
            fields: [
                {
                    name: 'condition_rating', label: 'Condizione', type: 'stars', span: 6,
                    min: 1, max: 5,
                    hint: 'Da 1 (da sostituire) a 5 (come nuovo).',
                },
                {
                    name: 'check_in_date', label: 'Data check-in', type: 'date', span: 3,
                },
                {
                    name: 'check_out_date', label: 'Data check-out', type: 'date', span: 3,
                    hint: 'Si compila alla riconsegna.',
                },
                {
                    name: 'notes', label: 'Note', type: 'textarea', rows: 3, span: 12,
                    placeholder: 'Graffio sull\'anta destra, telecomando mancante…',
                },
            ],
        },
        {
            legend: 'Identificazione e valore',
            fold: true,
            optionalNote: 'serve quando il bene si rompe o si contesta',
            hint: 'Marca, modello e matricola sono ciò che l\'idraulico chiede al telefono, e ciò che distingue "il forno" da un forno qualsiasi in una contestazione.',
            fields: [
                { name: 'brand',  label: 'Marca',   type: 'text', maxlength: 100, span: 4, placeholder: 'es. Bosch' },
                { name: 'model',  label: 'Modello', type: 'text', maxlength: 100, span: 4, placeholder: 'es. WAT28439IT' },
                { name: 'serial_number', label: 'Matricola / Serial', type: 'text', maxlength: 100, span: 4 },
                {
                    name: 'estimated_value', label: 'Valore stimato', type: 'money',
                    min: 0, max: 99999999.99, prefix: '€', span: 4,
                    hint: 'Usato per quantificare una trattenuta sulla cauzione.',
                },
                { name: 'warranty_until', label: 'Garanzia fino al', type: 'date', span: 4 },
            ],
        },
        {
            legend: 'Prova fotografica',
            fields: [photoWidget()],
        },
    ],

    validate(d) {
        // Gli stessi rifiuti di validateInventoryInput(), detti prima della richiesta.
        if (d.check_in_date && d.check_out_date && d.check_out_date < d.check_in_date) {
            return 'La data di check-out non può precedere il check-in.';
        }
        return null;
    },
};

(function () {
    'use strict';

    const API      = 'api/meter_readings.php';
    const PROP_API = 'api/properties.php';
    const DOC_API  = 'api/documents.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    // Data locale, non `toISOString()`: fra mezzanotte e le 2 in Italia l'UTC e'
    // ancora al giorno prima e il campo si sarebbe aperto su ieri.
    function todayISO() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    const TYPE_LABELS = { gas: 'Gas', electricity: 'Elettricità', water: 'Acqua', heating: 'Riscaldamento' };
    const TYPE_UNITS  = { gas: 'm³', electricity: 'kWh', water: 'm³', heating: 'kWh' };

    let currentPage    = 1;
    const PAGE_LIMIT   = 25;
    let deleteTargetId = null;
    const els          = {};

    function init() {
        els.alert      = document.getElementById('meters-alert');
        els.tbody      = document.getElementById('meters-tbody');
        els.pagination = document.getElementById('meters-pagination');
        els.propFilter = document.getElementById('meters-property-filter');
        els.typeFilter = document.getElementById('meters-type-filter');
        els.modal      = document.getElementById('meters-modal');
        els.form       = document.getElementById('meters-form');
        els.delModal   = document.getElementById('meters-delete-modal');

        bindEvents();
        loadProperties();
        loadReadings();
    }

    function bindEvents() {
        document.getElementById('btn-new-reading').addEventListener('click', () => openModal());
        document.getElementById('meters-modal-close').addEventListener('click', closeModal);
        document.getElementById('meters-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('meters-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('meters-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('meters-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        els.propFilter.addEventListener('change', () => { currentPage = 1; loadReadings(); });
        els.typeFilter.addEventListener('change', () => { currentPage = 1; loadReadings(); });
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            // populate both the filter and the modal select
            [els.propFilter, document.getElementById('meters-property-id')].forEach(sel => {
                if (!sel) return;
                items.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.address || p.title || `#${p.id}`;
                    sel.appendChild(opt);
                });
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadReadings() {
        const params = new URLSearchParams();
        const prop   = els.propFilter.value;
        const type   = els.typeFilter.value;
        if (prop) params.set('property_id', prop);
        if (type) params.set('meter_type', type);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadReadings(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    // `consumption` null = prima lettura del contatore, non consumo zero: va detto,
    // non stampato come 0,00. Il segno conta — un delta negativo e' un contatore
    // sostituito o azzerato, e con la freccia sempre in su passava per un consumo.
    function renderConsumption(value, unit) {
        if (value == null || value === '') {
            return '<span class="text-muted" title="Prima lettura di questo contatore: nessun precedente con cui calcolare il consumo.">— <small>prima lettura</small></span>';
        }

        const n = Number(value);
        if (!isFinite(n)) return '<span class="text-muted">—</span>';

        if (n < 0) {
            return `<span style="color:var(--color-danger,#c0392b);" title="Lettura inferiore alla precedente: contatore sostituito, azzerato o lettura errata.">▼ ${esc(String(value))} ${esc(unit)}</span>`;
        }
        if (n === 0) {
            return `<span class="text-muted">0 ${esc(unit)}</span>`;
        }
        return `<span style="color:var(--color-warning,#e67e22);">▲ ${esc(String(value))} ${esc(unit)}</span>`;
    }

    // Una lettura senza foto non e' un errore, ma in una contestazione di fine
    // locazione e' la parola dell'agente contro quella dell'inquilino: va vista
    // a colpo d'occhio quali righe sono documentate e quali no.
    function renderPhotoCell(r) {
        const n = Number(r.photo_count || 0);
        if (!n) {
            return '<span class="text-muted" title="Nessuna prova fotografica allegata.">—</span>';
        }

        const first = (r.photos && r.photos[0]) || null;
        const label = n > 1 ? ` ${n}` : '';
        if (!first) return `<span class="badge">${esc(String(n))}</span>`;

        return `<a href="${esc(first.download_url)}" target="_blank" rel="noopener"
                   title="${esc(first.original_name)}${n > 1 ? ` (+${n - 1} altre)` : ''}"
                   style="display:inline-flex;align-items:center;gap:.25rem;">
                    <i data-lucide="camera"></i>${esc(label)}
                </a>`;
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Nessuna lettura trovata.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(r => {
            const typeLabel = TYPE_LABELS[r.meter_type] || r.meter_type || '—';
            const unit      = TYPE_UNITS[r.meter_type] || '';
            const reading   = r.reading_value != null ? `${r.reading_value} ${unit}` : '—';
            const deltaHtml = renderConsumption(r.consumption, unit);

            return `<tr>
                <td data-label="Immobile">${esc(r.property_address || r.property_title || `#${r.property_id}`)}</td>
                <td data-label="Tipo"><span class="badge">${esc(typeLabel)}</span></td>
                <td data-label="Lettura">${esc(reading)}</td>
                <td data-label="Consumo">${deltaHtml}</td>
                <td data-label="Data">${formatDate(r.reading_date)}</td>
                <td data-label="Prova">${renderPhotoCell(r)}</td>
                <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-m-edit" data-id="${r.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                    <button class="btn btn--sm btn--ghost btn-m-del" data-id="${r.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>`;
        }).join('');

        els.tbody.querySelectorAll('.btn-m-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    const item = Array.isArray(json.data) ? json.data[0] : json.data;
                    openModal(item);
                } catch (e) { showAlert(e.message, 'error'); }
            });
        });

        els.tbody.querySelectorAll('.btn-m-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                els.delModal.hidden = false;
            });
        });
    }

    function openModal(item = null) {
        els.form.reset();
        document.getElementById('meters-id').value = '';
        document.getElementById('meters-modal-title').textContent = item ? 'Modifica Lettura' : 'Inserisci Lettura';

        // Una lettura non puo' essere futura: il tetto va rimesso a ogni apertura
        // perche' la scheda resta in pagina anche a cavallo della mezzanotte.
        const today = todayISO();
        document.getElementById('meters-reading-date').max = today;

        // default date to today
        if (!item) {
            document.getElementById('meters-reading-date').value = today;
        }

        if (item) {
            document.getElementById('meters-id').value              = item.id;
            document.getElementById('meters-property-id').value     = item.property_id || '';
            document.getElementById('meters-type').value            = item.meter_type || '';
            document.getElementById('meters-reading-value').value   = item.reading_value || '';
            document.getElementById('meters-reading-date').value    = item.reading_date ? item.reading_date.substring(0, 10) : '';
            document.getElementById('meters-notes').value           = item.notes || '';
        }

        renderExistingPhotos(item ? item.photos : []);

        els.modal.hidden = false;
        document.getElementById('meters-reading-value').focus();
    }

    function renderExistingPhotos(photos) {
        const box = document.getElementById('meters-photo-existing');
        if (!box) return;

        if (!photos || !photos.length) {
            box.innerHTML = '';
            return;
        }

        box.innerHTML = 'Già allegate: ' + photos.map(p =>
            `<a href="${esc(p.download_url)}" target="_blank" rel="noopener">${esc(p.original_name)}</a>`
        ).join(', ');
    }

    // L'upload avviene DOPO il salvataggio perche' la foto si lega all'id della
    // lettura, che prima di salvare non esiste. Se il caricamento fallisce la
    // lettura resta salvata: si dice quali file non sono passati invece di far
    // credere che sia andato perso tutto.
    async function uploadPhotos(readingId, propertyId, files) {
        const failed = [];

        for (const file of files) {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('doc_type', 'lettura_contatore');
            fd.append('meter_reading_id', readingId);
            if (propertyId) fd.append('property_id', propertyId);
            fd.append('title', `Foto contatore — lettura #${readingId}`);

            try {
                const res  = await fetch(DOC_API, { method: 'POST', body: fd });
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'errore sconosciuto');
            } catch (e) {
                failed.push(`${file.name} (${e.message})`);
            }
        }

        return failed;
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id  = document.getElementById('meters-id').value;
        const btn = document.getElementById('meters-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            property_id:   document.getElementById('meters-property-id').value,
            meter_type:    document.getElementById('meters-type').value,
            reading_value: document.getElementById('meters-reading-value').value,
            reading_date:  document.getElementById('meters-reading-date').value,
            notes:         document.getElementById('meters-notes').value.trim(),
        };

        try {
            const res  = await fetch(id ? `${API}?id=${id}` : API, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const saved     = Array.isArray(json.data) ? json.data[0] : json.data;
            const readingId = saved && saved.id ? saved.id : id;
            const files     = Array.from(document.getElementById('meters-photo').files || []);

            let failed = [];
            if (readingId && files.length) {
                btn.textContent = 'Caricamento foto…';
                failed = await uploadPhotos(readingId, data.property_id, files);
            }

            closeModal();
            if (failed.length) {
                showAlert(`Lettura salvata, ma non è stato possibile allegare: ${failed.join('; ')}`, 'error');
            } else {
                showAlert('Lettura salvata con successo.', 'success');
            }
            loadReadings();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('meters-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Lettura eliminata.', 'success');
            loadReadings();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    // Formattazione sulla stringa ISO, senza passare da `new Date()`: quello
    // interpreta "2026-07-03" come mezzanotte UTC (che a fusi negativi diventa il
    // giorno prima) e soprattutto stampa l'anno 26 come "26", mascherando in
    // tabella le date corrotte che la KPI invece mostra per intero ("0026").
    function formatDate(str) {
        if (!str) return '—';
        const m = String(str).substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(String(str));
    }

    init();
})();

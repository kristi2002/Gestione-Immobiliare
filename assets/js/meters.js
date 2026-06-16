(function () {
    'use strict';

    const API      = 'api/meter_readings.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
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

        els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>';

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadReadings(); });
        } catch (err) {
            els.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderRows(items) {
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Nessuna lettura trovata.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(r => {
            const typeLabel = TYPE_LABELS[r.meter_type] || r.meter_type || '—';
            const unit      = TYPE_UNITS[r.meter_type] || '';
            const reading   = r.reading_value != null ? `${r.reading_value} ${unit}` : '—';
            const delta     = r.consumption != null ? `${r.consumption} ${unit}` : '—';
            const deltaHtml = r.consumption != null
                ? `<span style="color:${r.consumption > 0 ? 'var(--color-warning,#e67e22)' : 'inherit'};">▲ ${esc(String(r.consumption))} ${esc(unit)}</span>`
                : '<span class="text-muted">—</span>';

            return `<tr>
                <td>${esc(r.property_address || r.property_title || `#${r.property_id}`)}</td>
                <td><span class="badge">${esc(typeLabel)}</span></td>
                <td>${esc(reading)}</td>
                <td>${deltaHtml}</td>
                <td>${formatDate(r.reading_date)}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn--sm btn--ghost btn-m-edit" data-id="${r.id}" title="Modifica">✏️</button>
                    <button class="btn btn--sm btn--ghost btn-m-del" data-id="${r.id}" title="Elimina">🗑️</button>
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

        // default date to today
        if (!item) {
            document.getElementById('meters-reading-date').value = new Date().toISOString().substring(0, 10);
        }

        if (item) {
            document.getElementById('meters-id').value              = item.id;
            document.getElementById('meters-property-id').value     = item.property_id || '';
            document.getElementById('meters-type').value            = item.meter_type || '';
            document.getElementById('meters-reading-value').value   = item.reading_value || '';
            document.getElementById('meters-reading-date').value    = item.reading_date ? item.reading_date.substring(0, 10) : '';
            document.getElementById('meters-notes').value           = item.notes || '';
        }

        els.modal.hidden = false;
        document.getElementById('meters-reading-value').focus();
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
            closeModal();
            showAlert('Lettura salvata con successo.', 'success');
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

    function formatDate(str) {
        if (!str) return '—';
        return new Date(str).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    init();
})();

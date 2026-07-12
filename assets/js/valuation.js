(function () {
    'use strict';

    const API      = 'api/valuation.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    function eur(n) { return n == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n); }
    function eur2(n) { return n == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n); }

    let currentPage = 1;
    const PAGE_LIMIT = 25;
    let deleteTargetId = null;

    const els = {};

    function init() {
        els.alert      = document.getElementById('val-alert');
        els.tbody      = document.getElementById('omi-tbody');
        els.pagination = document.getElementById('omi-pagination');
        els.search     = document.getElementById('omi-search');
        els.modal      = document.getElementById('omi-modal');
        els.form       = document.getElementById('omi-form');
        els.delModal   = document.getElementById('omi-delete-modal');
        els.estResult  = document.getElementById('val-estimate-result');

        bindEvents();
        loadProperties();
        loadOmi();
    }

    function bindEvents() {
        document.getElementById('btn-new-omi').addEventListener('click', () => openModal());
        document.getElementById('omi-modal-close').addEventListener('click', closeModal);
        document.getElementById('omi-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('omi-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('omi-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('omi-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });

        document.getElementById('btn-estimate').addEventListener('click', runEstimate);
        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadOmi(); }, 300));
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            const sel = document.getElementById('val-property');
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = (p.address || `#${p.id}`) + (p.city ? ' · ' + p.city : '');
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function runEstimate() {
        const propertyId = document.getElementById('val-property').value;
        if (!propertyId) { showAlert('Seleziona un immobile.', 'error'); return; }
        const btn = document.getElementById('btn-estimate');
        btn.disabled = true;
        els.estResult.innerHTML = '<p class="text-muted">Calcolo in corso…</p>';
        try {
            const res  = await fetch(`${API}?action=estimate&property_id=${propertyId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            renderEstimate(json.data);
        } catch (err) {
            els.estResult.innerHTML = `<p style="color:var(--color-danger)">${esc(err.message)}</p>`;
        } finally {
            btn.disabled = false;
        }
    }

    function renderEstimate(d) {
        const s = d.suggested || {};
        const omi = d.omi;
        const cmp = d.comparables;

        let html = `<div class="stats-grid" style="margin-bottom:12px;">
            <div class="stat-card"><div class="stat-card__value">${eur(s.value)}</div><div class="stat-card__label">Valore stimato</div></div>
            <div class="stat-card"><div class="stat-card__value">${s.value_min != null ? eur(s.value_min) + ' – ' + eur(s.value_max) : '—'}</div><div class="stat-card__label">Intervallo</div></div>
            <div class="stat-card"><div class="stat-card__value">${eur(s.rent)}</div><div class="stat-card__label">Canone stimato/mese</div></div>
            <div class="stat-card"><div class="stat-card__value">${esc(s.basis || '—')}</div><div class="stat-card__label">Base di calcolo</div></div>
        </div>`;

        html += '<div class="form-row form-row--2">';
        html += '<div class="card"><h4 style="margin-top:0;">Quotazione OMI</h4>';
        if (omi) {
            html += `<p>Zona <strong>${esc(omi.zone || '—')}</strong>${omi.period ? ' · ' + esc(omi.period) : ''}<br>
                Vendita: ${eur(omi.value_min)} – ${eur(omi.value_max)}<br>
                Affitto: ${eur(omi.rent_min)} – ${eur(omi.rent_max)}/mese</p>`;
        } else {
            html += '<p class="text-muted">Nessuna quotazione OMI per questa zona/tipologia.</p>';
        }
        html += '</div>';

        html += '<div class="card"><h4 style="margin-top:0;">Comparabili interni</h4>';
        if (cmp && cmp.sample && cmp.sample.length) {
            html += `<p class="text-muted" style="margin-top:0;">${cmp.count} immobili · media ${cmp.sale_sqm_avg ? eur2(cmp.sale_sqm_avg) + '/m² (vendita)' : ''} ${cmp.rent_sqm_avg ? eur2(cmp.rent_sqm_avg) + '/m² (affitto)' : ''}</p>`;
            html += '<ul style="margin:0;padding-left:18px;">' + cmp.sample.slice(0, 4).map(c =>
                `<li>${esc(c.address)} — ${eur(c.price)} (${c.sqm} m², ${eur2(c.price_sqm)}/m²)</li>`).join('') + '</ul>';
        } else {
            html += '<p class="text-muted">Comparabili interni insufficienti.</p>';
        }
        html += '</div></div>';

        if (d.warnings && d.warnings.length) {
            html += '<div class="alert alert--warning" style="margin-top:10px;">' + d.warnings.map(esc).join('<br>') + '</div>';
        }
        els.estResult.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();
    }

    async function loadOmi() {
        const params = new URLSearchParams();
        if (els.search.value.trim()) params.set('search', els.search.value.trim());
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);
        softLoad(els.tbody, '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');
        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadOmi(); });
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderRows(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:2rem;">Nessuna quotazione. Inserisci i valori OMI per abilitare le stime.</td></tr>';
            return;
        }
        const range = (a, b) => (a == null && b == null) ? '—' : `${eur2(a)} – ${eur2(b)}`;
        els.tbody.innerHTML = items.map(o => `<tr>
            <td data-label="Comune">${esc(o.comune)}</td>
            <td data-label="Zona">${esc(o.cadastral_zone || '—')}</td>
            <td data-label="Tipologia">${esc(o.property_type)}</td>
            <td data-label="Vendita €/m²">${range(o.price_min_sqm, o.price_max_sqm)}</td>
            <td data-label="Affitto €/m²">${range(o.rent_min_sqm, o.rent_max_sqm)}</td>
            <td data-label="Periodo">${esc(o.period || '—')}</td>
            <td data-label="Azioni" class="col-actions" style="white-space:nowrap;">
                <button class="btn btn--sm btn--ghost btn-omi-edit" data-id="${o.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                <button class="btn btn--sm btn--ghost btn-omi-del" data-id="${o.id}" title="Elimina"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`).join('');

        els.tbody.querySelectorAll('.btn-omi-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const res  = await fetch(`${API}?id=${btn.dataset.id}`);
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    openModal(Array.isArray(json.data) ? json.data[0] : json.data);
                } catch (e) { showAlert(e.message, 'error'); }
            });
        });
        els.tbody.querySelectorAll('.btn-omi-del').forEach(btn => {
            btn.addEventListener('click', () => { deleteTargetId = btn.dataset.id; els.delModal.hidden = false; });
        });
    }

    function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

    function openModal(item = null) {
        els.form.reset();
        setVal('omi-id', '');
        document.getElementById('omi-modal-title').textContent = item ? 'Modifica quotazione OMI' : 'Nuova quotazione OMI';
        if (item) {
            setVal('omi-id', item.id);
            setVal('omi-comune', item.comune);
            setVal('omi-zone', item.cadastral_zone);
            setVal('omi-type', item.property_type || 'appartamento');
            setVal('omi-price-min', item.price_min_sqm);
            setVal('omi-price-max', item.price_max_sqm);
            setVal('omi-rent-min', item.rent_min_sqm);
            setVal('omi-rent-max', item.rent_max_sqm);
            setVal('omi-period', item.period);
            setVal('omi-notes', item.notes);
        }
        els.modal.hidden = false;
        document.getElementById('omi-comune').focus();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('omi-id').value;
        const btn = document.getElementById('omi-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';
        const data = {
            comune:         document.getElementById('omi-comune').value.trim(),
            cadastral_zone: document.getElementById('omi-zone').value.trim(),
            property_type:  document.getElementById('omi-type').value,
            price_min_sqm:  document.getElementById('omi-price-min').value || null,
            price_max_sqm:  document.getElementById('omi-price-max').value || null,
            rent_min_sqm:   document.getElementById('omi-rent-min').value || null,
            rent_max_sqm:   document.getElementById('omi-rent-max').value || null,
            period:         document.getElementById('omi-period').value.trim(),
            notes:          document.getElementById('omi-notes').value.trim(),
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
            showAlert('Quotazione salvata.', 'success');
            loadOmi();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('omi-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Quotazione eliminata.', 'success');
            loadOmi();
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

    init();
})();

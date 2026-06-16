(function () {
    'use strict';

    const API      = 'api/inventory.php';
    const PROP_API = 'api/properties.php';

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    const CONDITION_LABELS = { 1: 'Pessima', 2: 'Scarsa', 3: 'Discreta', 4: 'Buona', 5: 'Ottima' };

    let currentPage      = 1;
    const PAGE_LIMIT     = 25;
    let deleteTargetId   = null;
    let selectedProperty = null;
    const els            = {};

    function init() {
        els.alert       = document.getElementById('inventory-alert');
        els.tbody       = document.getElementById('inventory-tbody');
        els.pagination  = document.getElementById('inventory-pagination');
        els.propSelect  = document.getElementById('inventory-property-select');
        els.placeholder = document.getElementById('inventory-placeholder');
        els.content     = document.getElementById('inventory-content');
        els.modal       = document.getElementById('inventory-modal');
        els.form        = document.getElementById('inventory-form');
        els.delModal    = document.getElementById('inventory-delete-modal');

        bindEvents();
        initStarSelector('inventory-condition-stars', 'inventory-condition');
        loadProperties();
    }

    function bindEvents() {
        els.propSelect.addEventListener('change', () => {
            selectedProperty = els.propSelect.value || null;
            if (selectedProperty) {
                els.placeholder.style.display = 'none';
                els.content.style.display     = 'block';
                document.getElementById('btn-new-item').style.display    = '';
                document.getElementById('btn-print-inventory').style.display = '';
                currentPage = 1;
                loadItems();
            } else {
                els.placeholder.style.display = '';
                els.content.style.display     = 'none';
                document.getElementById('btn-new-item').style.display    = 'none';
                document.getElementById('btn-print-inventory').style.display = 'none';
            }
        });

        document.getElementById('btn-new-item').addEventListener('click', () => openModal());
        document.getElementById('btn-print-inventory').addEventListener('click', printReport);

        document.getElementById('inventory-modal-close').addEventListener('click', closeModal);
        document.getElementById('inventory-modal-cancel').addEventListener('click', closeModal);
        els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
        els.form.addEventListener('submit', handleSubmit);

        document.getElementById('inventory-delete-close').addEventListener('click', closeDeleteModal);
        document.getElementById('inventory-delete-cancel').addEventListener('click', closeDeleteModal);
        document.getElementById('inventory-delete-confirm').addEventListener('click', confirmDelete);
        els.delModal.addEventListener('click', e => { if (e.target === els.delModal) closeDeleteModal(); });
    }

    function initStarSelector(containerId, inputId) {
        const stars = document.querySelectorAll(`#${containerId} .star`);
        const input = document.getElementById(inputId);

        function setStars(val) {
            stars.forEach(s => {
                const active = parseInt(s.dataset.value) <= val;
                s.textContent  = active ? '★' : '☆';
                s.style.color  = active ? '#f5a623' : '#ccc';
            });
        }

        setStars(parseInt(input.value) || 3);

        stars.forEach(star => {
            star.addEventListener('mouseover', () => setStars(parseInt(star.dataset.value)));
            star.addEventListener('mouseout',  () => setStars(parseInt(input.value) || 0));
            star.addEventListener('click', () => {
                input.value = star.dataset.value;
                setStars(parseInt(star.dataset.value));
            });
        });

        // expose setter
        input._setDisplay = setStars;
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || p.title || `#${p.id}`;
                els.propSelect.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadItems() {
        if (!selectedProperty) return;
        const params = new URLSearchParams({ property_id: selectedProperty, page: currentPage, limit: PAGE_LIMIT });

        els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>';

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);
            renderRows(parsed.items);
            window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadItems(); });
        } catch (err) {
            els.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function starsHtml(rating) {
        const v = parseInt(rating) || 0;
        return Array.from({ length: 5 }, (_, i) =>
            `<span style="color:${i < v ? '#f5a623' : '#ccc'}">${i < v ? '★' : '☆'}</span>`
        ).join('');
    }

    function renderRows(items) {
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:2rem;">Nessun articolo in inventario.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(item => `<tr>
            <td>${esc(item.item_name)}</td>
            <td>${item.category ? `<span class="badge">${esc(item.category)}</span>` : '<span class="text-muted">—</span>'}</td>
            <td>${esc(item.quantity ?? 1)}</td>
            <td title="${esc(CONDITION_LABELS[item.condition_rating] || '')}">${starsHtml(item.condition_rating)}</td>
            <td>${esc(item.notes || '—')}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn--sm btn--ghost btn-inv-edit" data-id="${item.id}" title="Modifica">✏️</button>
                <button class="btn btn--sm btn--ghost btn-inv-del" data-id="${item.id}" data-name="${esc(item.item_name)}" title="Elimina">🗑️</button>
            </td>
        </tr>`).join('');

        els.tbody.querySelectorAll('.btn-inv-edit').forEach(btn => {
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

        els.tbody.querySelectorAll('.btn-inv-del').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                document.getElementById('inventory-delete-name').textContent = btn.dataset.name;
                els.delModal.hidden = false;
            });
        });
    }

    function openModal(item = null) {
        els.form.reset();
        document.getElementById('inventory-id').value = '';
        document.getElementById('inventory-modal-title').textContent = item ? 'Modifica Articolo' : 'Aggiungi Articolo';

        const condInput = document.getElementById('inventory-condition');
        condInput.value = 3;
        if (condInput._setDisplay) condInput._setDisplay(3);

        if (!item) {
            document.getElementById('inventory-check-in-date').value = new Date().toISOString().substring(0, 10);
            document.getElementById('inventory-quantity').value = 1;
        }

        if (item) {
            document.getElementById('inventory-id').value            = item.id;
            document.getElementById('inventory-item-name').value     = item.item_name || '';
            document.getElementById('inventory-category').value      = item.category || '';
            document.getElementById('inventory-quantity').value      = item.quantity || 1;
            document.getElementById('inventory-check-in-date').value = item.check_in_date ? item.check_in_date.substring(0, 10) : '';
            document.getElementById('inventory-notes').value         = item.notes || '';
            const rating = parseInt(item.condition_rating) || 3;
            condInput.value = rating;
            if (condInput._setDisplay) condInput._setDisplay(rating);
        }

        els.modal.hidden = false;
        document.getElementById('inventory-item-name').focus();
    }

    function closeModal() { els.modal.hidden = true; }
    function closeDeleteModal() { els.delModal.hidden = true; deleteTargetId = null; }

    async function handleSubmit(e) {
        e.preventDefault();
        const id  = document.getElementById('inventory-id').value;
        const btn = document.getElementById('inventory-modal-save');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const data = {
            property_id:      selectedProperty,
            item_name:        document.getElementById('inventory-item-name').value.trim(),
            category:         document.getElementById('inventory-category').value,
            quantity:         parseInt(document.getElementById('inventory-quantity').value) || 1,
            condition_rating: parseInt(document.getElementById('inventory-condition').value) || 3,
            check_in_date:    document.getElementById('inventory-check-in-date').value || null,
            notes:            document.getElementById('inventory-notes').value.trim(),
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
            showAlert('Articolo salvato con successo.', 'success');
            loadItems();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('inventory-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${deleteTargetId}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Articolo eliminato.', 'success');
            loadItems();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function printReport() {
        if (!selectedProperty) return;
        const propLabel = els.propSelect.options[els.propSelect.selectedIndex]?.text || '';
        // Gather current rows from the table
        const rows = Array.from(els.tbody.querySelectorAll('tr')).map(tr => {
            const cells = tr.querySelectorAll('td');
            if (!cells.length) return null;
            return {
                item:      cells[0]?.textContent?.trim() || '',
                category:  cells[1]?.textContent?.trim() || '',
                qty:       cells[2]?.textContent?.trim() || '',
                condition: cells[3]?.textContent?.trim() || '',
                notes:     cells[4]?.textContent?.trim() || '',
            };
        }).filter(Boolean);

        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
            <title>Report Check-in — ${propLabel}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 2rem; }
                h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
                p  { color: #666; margin-bottom: 1.5rem; }
                table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
                th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; text-align: left; }
                th { background: #f4f4f4; font-weight: 600; }
                tr:nth-child(even) { background: #fafafa; }
                .footer { margin-top: 3rem; display: flex; justify-content: space-between; }
                .sig { border-top: 1px solid #333; padding-top: 0.5rem; width: 220px; text-align: center; }
                @media print { button { display: none; } }
            </style></head><body>
            <h1>Report Check-in Inventario</h1>
            <p>Immobile: <strong>${propLabel}</strong> &mdash; Data: ${new Date().toLocaleDateString('it-IT')}</p>
            <table>
                <thead><tr><th>Articolo</th><th>Categoria</th><th>Qtà</th><th>Condizione</th><th>Note</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${r.item}</td><td>${r.category}</td><td>${r.qty}</td><td>${r.condition}</td><td>${r.notes}</td>
                </tr>`).join('')}</tbody>
            </table>
            <div class="footer">
                <div class="sig">Firma proprietario</div>
                <div class="sig">Firma inquilino</div>
            </div>
            <script>window.onload = () => window.print();<\/script>
        </body></html>`);
        win.document.close();
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

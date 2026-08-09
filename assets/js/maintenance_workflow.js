(function () {
    'use strict';

    // Maintenance requests come from api/reminders.php filtered by type='maintenance'
    const API           = 'api/reminders.php';
    const SUPPLIERS_API = 'api/suppliers.php';
    const PROP_API      = 'api/properties.php';
    const INVENTORY_API = 'api/inventory.php';

    const CONDITION_LABELS = { 1: 'Pessima', 2: 'Scarsa', 3: 'Discreta', 4: 'Buona', 5: 'Ottima' };

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    const STATUS_LABELS = {
        aperta:        'Aperta',
        in_lavorazione: 'In lavorazione',
        completata:    'Completata',
        chiusa:        'Chiusa',
    };
    const STATUS_COLORS = {
        aperta:        '#3b82f6',
        in_lavorazione: '#f59e0b',
        completata:    '#22c55e',
        chiusa:        '#6b7280',
    };
    // Le chiavi sono i valori che scrive davvero il modulo (schemas/maintenance.js).
    // 'normale' resta solo come alias di righe vecchie: nessun modulo lo produce.
    const PRIORITY_COLORS = {
        urgente: 'var(--color-danger,#c0392b)',
        alta:    'var(--color-warning,#e67e22)',
        media:   'inherit',
        normale: 'inherit',
        bassa:   '#999',
    };

    let currentPage  = 1;
    const PAGE_LIMIT = 25;
    let currentView  = 'table'; // 'table' | 'kanban'
    let suppliers    = [];
    const els        = {};

    function init() {
        els.alert          = document.getElementById('maintenance-workflow-alert');
        els.tbody          = document.getElementById('mw-tbody');
        els.pagination     = document.getElementById('mw-pagination');
        els.search         = document.getElementById('mw-search');
        els.propFilter     = document.getElementById('mw-property-filter');
        els.statusFilter   = document.getElementById('mw-status-filter');
        els.priorityFilter = document.getElementById('mw-priority-filter');
        els.tableView      = document.getElementById('mw-table-view');
        els.kanbanView     = document.getElementById('mw-kanban-view');
        els.supplierModal  = document.getElementById('mw-supplier-modal');
        els.statusModal    = document.getElementById('mw-status-modal');
        els.assetModal     = document.getElementById('mw-asset-modal');
        els.replyModal     = document.getElementById('mw-reply-modal');

        bindEvents();
        bindRowMenu();
        loadProperties();
        loadSuppliers();
        loadRequests();
    }

    function bindEvents() {
        // Un intervento e' una riga `reminders` con request_type='maintenance':
        // stessa cosa che scrive il portale inquilino, aperta dall'agenzia.
        document.getElementById('btn-new-maintenance')?.addEventListener('click', () => {
            if (window.App) window.App.navigateTo('entity_edit', { entity: 'maintenance' });
        });

        document.querySelectorAll('.mw-view-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mw-view-toggle').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                els.tableView.style.display  = currentView === 'table'  ? '' : 'none';
                els.kanbanView.style.display = currentView === 'kanban' ? '' : 'none';
                // Ricarica invece di ridisegnare la pagina gia' in memoria: le
                // due viste chiedono un numero diverso di righe (25 la tabella,
                // che ha l'impaginatore; 100 la bacheca, che non ce l'ha).
                // Ridisegnando `allItems` la bacheca ereditava le 25 della
                // tabella e restava monca comunque.
                currentPage = 1;
                loadRequests();
            });
        });

        els.search.addEventListener('input', debounce(() => { currentPage = 1; loadRequests(); }, 400));
        els.propFilter.addEventListener('change', () => { currentPage = 1; loadRequests(); });
        els.statusFilter.addEventListener('change', () => { currentPage = 1; loadRequests(); });
        els.priorityFilter.addEventListener('change', () => { currentPage = 1; loadRequests(); });

        // Supplier modal
        document.getElementById('mw-supplier-close').addEventListener('click', closeSupplierModal);
        document.getElementById('mw-supplier-cancel').addEventListener('click', closeSupplierModal);
        els.supplierModal.addEventListener('click', e => { if (e.target === els.supplierModal) closeSupplierModal(); });
        document.getElementById('mw-supplier-confirm').addEventListener('click', confirmAssignSupplier);

        // Status modal
        document.getElementById('mw-status-close').addEventListener('click', closeStatusModal);
        document.getElementById('mw-status-cancel').addEventListener('click', closeStatusModal);
        els.statusModal.addEventListener('click', e => { if (e.target === els.statusModal) closeStatusModal(); });
        document.getElementById('mw-status-confirm').addEventListener('click', confirmChangeStatus);

        // Asset modal
        document.getElementById('mw-asset-close').addEventListener('click', closeAssetModal);
        document.getElementById('mw-asset-cancel').addEventListener('click', closeAssetModal);
        els.assetModal.addEventListener('click', e => { if (e.target === els.assetModal) closeAssetModal(); });
        document.getElementById('mw-asset-confirm').addEventListener('click', confirmLinkAsset);

        document.getElementById('mw-delete-close')?.addEventListener('click', closeDeleteModal);
        document.getElementById('mw-delete-cancel')?.addEventListener('click', closeDeleteModal);
        document.getElementById('mw-delete-confirm')?.addEventListener('click', confirmDelete);
        document.getElementById('mw-asset-select').addEventListener('change', renderAssetDetail);

        // Risposta all'inquilino
        document.getElementById('mw-reply-close')?.addEventListener('click', closeReplyModal);
        document.getElementById('mw-reply-cancel')?.addEventListener('click', closeReplyModal);
        els.replyModal?.addEventListener('click', e => { if (e.target === els.replyModal) closeReplyModal(); });
        document.getElementById('mw-reply-confirm')?.addEventListener('click', confirmReply);

        // La graffetta sulla riga apre la stessa finestra. Delegato sul tbody,
        // che viene riscritto a ogni caricamento; `stopPropagation` perche' il
        // menu di riga ascolta sullo stesso nodo.
        els.tbody.addEventListener('click', e => {
            const tag = e.target.closest('[data-reply-open]');
            if (!tag) return;
            e.stopPropagation();
            openReplyModal(tag.dataset.replyOpen);
        });
    }

    async function loadProperties() {
        try {
            const items = await window.Pagination.fetchList(PROP_API);
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.address || p.title || `#${p.id}`;
                els.propFilter.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadSuppliers() {
        try {
            suppliers = await window.Pagination.fetchList(SUPPLIERS_API);
            const sel = document.getElementById('mw-supplier-select');
            suppliers.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = `${s.name}${s.category ? ` (${s.category})` : ''}`;
                sel.appendChild(opt);
            });
        } catch (e) { /* non-critical */ }
    }

    async function loadRequests() {
        const params = new URLSearchParams();
        params.set('type', 'maintenance');

        const search   = els.search.value.trim();
        const prop     = els.propFilter.value;
        const status   = els.statusFilter.value;
        const priority = els.priorityFilter.value;

        if (search)   params.set('search', search);
        if (prop)     params.set('property_id', prop);
        if (status)   params.set('maintenance_status', status);
        if (priority) params.set('priority', priority);
        params.set('page', currentPage);
        // La bacheca non ha un impaginatore — il suo `#mw-pagination` vive
        // dentro `#mw-table-view`, che in vista kanban e' nascosto. Chiedendo
        // 25 righe come la tabella, i biglietti dal 26esimo in poi non erano
        // raggiungibili in nessun modo: nessun pulsante, nessun avviso, e le
        // colonne mostravano il conteggio della sola pagina come se fosse il
        // totale. 100 e' il tetto vero di apiGetPagination(): chiederne di piu'
        // verrebbe tagliato in silenzio.
        params.set('limit', currentView === 'kanban' ? 100 : PAGE_LIMIT);

        softLoad(els.tbody, '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:2rem;">Caricamento…</td></tr>');

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = window.Pagination.parseResponse(json);

            if (currentView === 'table') {
                renderTable(parsed.items);
                window.Pagination.render(els.pagination, parsed, p => { currentPage = p; loadRequests(); });
            } else {
                els.tbody.classList.remove('is-loading');
                renderKanban(parsed.items);
                // Se il tetto scatta lo si dice, invece di lasciar credere che
                // la bacheca sia tutto il lavoro aperto.
                renderKanbanNotice(parsed.items.length, parsed.total);
            }
        } catch (err) {
            els.tbody.classList.remove('is-loading');
            els.tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</td></tr>`;
        }
    }

    function renderTable(items) {
        els.tbody.classList.remove('is-loading');
        if (!items.length) {
            els.tbody.innerHTML = '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:2rem;">Nessuna richiesta di manutenzione trovata.</td></tr>';
            return;
        }

        els.tbody.innerHTML = items.map(r => {
            const status       = r.maintenance_status || 'aperta';
            const statusLabel  = STATUS_LABELS[status] || status;
            const statusColor  = STATUS_COLORS[status] || '#333';
            const priority     = r.priority || '—';
            const priorityColor = PRIORITY_COLORS[priority] || 'inherit';
            const supplierName = r.supplier_name || r.assigned_supplier || '—';
            const tenantName   = r.tenant_name || extractTenantFromNote(r.description) || '—';

            return `<tr>
                <td data-label="Inquilino">${esc(tenantName)}</td>
                <td data-label="Immobile">${esc(r.property_address || `#${r.property_id}` || '—')}</td>
                <td data-label="Descrizione" title="${esc(r.note || '')}">
                    ${esc(r.title || (r.note ? r.note.substring(0, 50) : '—'))}
                    ${requestBadgesHtml(r)}
                </td>
                <td data-label="Bene">${assetCellHtml(r)}</td>
                <td data-label="Priorità"><span style="color:${priorityColor};font-weight:600;">${esc(priority)}</span></td>
                <td data-label="Stato"><span style="color:${statusColor};font-weight:600;">${esc(statusLabel)}</span></td>
                <td data-label="Fornitore">${supplierName !== '—'
                    ? `<span style="font-size:0.85rem;">${esc(supplierName)}</span>`
                    : '<span class="text-muted">—</span>'}</td>
                <td data-label="Data">${formatDate(r.created_at || r.due_date)}</td>
                <td data-label="Azioni" class="col-actions lt-actions">
                    ${window.RowMenu.button(r.id, 'Azioni intervento')}
                </td>
            </tr>`;
        }).join('');

        if (window.lucide) window.lucide.createIcons();

        // Le righe servono al menu: senza, il pulsante saprebbe solo l'id.
        els.tbody._items = items;

    }

    // Le voci si costruiscono all'apertura, quindi vedono sempre lo stato
    // corrente della riga; la meccanica del menu sta in assets/js/row_menu.js.
    function bindRowMenu() {
        window.RowMenu.bind(els.tbody, btn => {
            const r = (els.tbody._items || []).find(x => String(x.id) === String(btn.dataset.id));
            if (!r) return [];
            return [
                // Solo sulle segnalazioni arrivate DAL portale: su un intervento
                // aperto al telefono non c'e' nessuno dall'altra parte che possa
                // leggere la risposta, e l'API la rifiuterebbe comunque.
                isTenantRequest(r)
                    ? { label: r.reply_text ? 'Modifica risposta' : 'Rispondi all\'inquilino',
                        icon: 'corner-down-right', onClick: () => openReplyModal(r.id) }
                    : null,
                { label: 'Collega bene', icon: 'package',
                  onClick: () => openAssetModal(r.id, r.property_id || '', r.inventory_item_id || '') },
                { label: 'Assegna fornitore', icon: 'wrench',
                  onClick: () => openSupplierModal(r.id, r.supplier_id || '') },
                { label: 'Cambia stato', icon: 'refresh-cw',
                  onClick: () => openStatusModal(r.id, r.maintenance_status || 'aperta') },
                { sep: true },
                // Mancavano entrambe: un intervento aperto per errore, o con la
                // descrizione sbagliata, non si poteva ne' correggere ne'
                // togliere dalla bacheca.
                { label: 'Modifica', icon: 'pencil',
                  onClick: () => window.App.navigateTo('entity_edit', { entity: 'maintenance', id: r.id }) },
                { label: 'Elimina', icon: 'trash-2', danger: true,
                  onClick: () => askDelete(r.id, r.title || ('#' + r.id)) },
            ];
        });
    }

    /**
     * Due cose che la riga taceva e che cambiano cosa fa l'agente:
     * la foto allegata dall'inquilino (finora visibile solo nell'albero
     * documenti dell'immobile) e se a quella segnalazione e' gia' stato
     * risposto. Senza la seconda, l'unico modo di saperlo era aprire il
     * portale dalla parte dell'inquilino.
     */
    function requestBadgesHtml(r) {
        const bits = [];
        const photos = Number(r.photo_count || 0);

        if (photos > 0) {
            // Cliccabile: la foto e' il motivo per cui molte segnalazioni si
            // capiscono in due secondi invece che con una telefonata. Aprire il
            // menu per arrivarci sarebbe un passaggio di troppo.
            bits.push(`<button type="button" class="mw-tag mw-tag--btn" data-reply-open="${r.id}"
                title="${photos} allegat${photos === 1 ? 'o' : 'i'} dall'inquilino — apri">`
                + `<i data-lucide="paperclip"></i>${photos > 1 ? ' ' + photos : ''}</button>`);
        }
        if (isTenantRequest(r)) {
            bits.push(r.reply_text
                ? '<span class="mw-tag mw-tag--ok" title="Risposta inviata all\'inquilino">'
                  + '<i data-lucide="corner-down-right"></i> Risposto</span>'
                : '<span class="mw-tag mw-tag--todo" title="Richiesta dal portale, ancora senza risposta">'
                  + '<i data-lucide="message-circle"></i> Da rispondere</span>');
        }

        return bits.length ? `<div class="mw-tags">${bits.join('')}</div>` : '';
    }

    /**
     * La colonna che l'idraulico legge. Senza bene collegato resta un trattino —
     * meglio di un dato inventato: dice all'agente che manca ancora un pezzo.
     */
    function assetCellHtml(r) {
        if (!r.inventory_item_id || !r.asset_name) {
            return '<span class="text-muted">—</span>';
        }

        const makeModel = [r.asset_brand, r.asset_model].filter(Boolean).join(' ');
        // La condizione che conta è quella di consegna (verbale di check-in):
        // è la baseline contro cui si discute chi paga.
        const cond = r.asset_checkin_condition ?? r.asset_condition;
        const bits = [];

        if (makeModel) bits.push(esc(makeModel));
        if (r.asset_serial) bits.push('S/N ' + esc(r.asset_serial));
        if (cond) bits.push(`consegna: ${cond}/5 ${CONDITION_LABELS[cond] || ''}`);
        if (r.asset_warranty_until) {
            const inWarranty = new Date(r.asset_warranty_until) >= new Date();
            bits.push(inWarranty
                ? `<strong style="color:var(--color-success,#22c55e);">in garanzia fino al ${formatDate(r.asset_warranty_until)}</strong>`
                : `garanzia scaduta il ${formatDate(r.asset_warranty_until)}`);
        }

        return `<strong>${esc(r.asset_name)}</strong>`
             + (bits.length ? `<div class="text-muted" style="font-size:0.75rem;">${bits.join(' · ')}</div>` : '');
    }

    /**
     * Avviso di troncamento della bacheca.
     *
     * Le pastiglie sulle colonne contano le schede DISEGNATE, non quelle
     * esistenti: senza questa riga un "3" su "Aperta" con dieci ticket aperti
     * oltre il centesimo si legge come "ne restano tre", che e' esattamente la
     * conclusione sbagliata da far trarre a chi smista la manutenzione.
     */
    function renderKanbanNotice(shown, total) {
        const host = document.getElementById('mw-kanban-view');
        if (!host) return;

        let el = document.getElementById('mw-kanban-notice');
        if (total > shown) {
            if (!el) {
                el = document.createElement('div');
                el.id = 'mw-kanban-notice';
                el.className = 'alert alert--warning';
                el.style.margin = '0 0 1rem';
                host.insertBefore(el, host.firstChild);
            }
            el.textContent = `Mostrati i primi ${shown} interventi di ${total}. `
                + 'Restringi con i filtri, oppure passa alla vista tabella per scorrerli tutti.';
        } else if (el) {
            el.remove();
        }
    }

    function renderKanban(items) {
        const cols = ['aperta', 'in_lavorazione', 'completata', 'chiusa'];

        cols.forEach(status => {
            const colItems = items.filter(r => (r.maintenance_status || 'aperta') === status);
            const container = document.getElementById(`kanban-${status}`);
            const countEl   = document.getElementById(`col-count-${status}`);
            if (countEl) countEl.textContent = colItems.length;
            if (!container) return;

            if (!colItems.length) {
                container.innerHTML = '<div style="color:#bbb;font-size:0.85rem;text-align:center;padding:1rem;">Nessuna richiesta</div>';
                return;
            }

            container.innerHTML = colItems.map(r => {
                const priority     = r.priority || '—';
                const priorityColor = PRIORITY_COLORS[priority] || 'inherit';
                const tenantName   = r.tenant_name || extractTenantFromNote(r.description) || '—';
                const title        = r.title || (r.description ? r.description.substring(0, 60) : '—');

                return `<div class="card" style="padding:0.75rem;font-size:0.85rem;cursor:default;" data-id="${r.id}">
                    <div style="font-weight:600;margin-bottom:4px;">${esc(title)}</div>
                    ${r.asset_name ? `<div class="text-muted" style="margin-bottom:6px;"><i data-lucide="package"></i> ${esc([r.asset_name, r.asset_brand, r.asset_model].filter(Boolean).join(' '))}</div>` : ''}
                    <div class="text-muted" style="margin-bottom:6px;"><i data-lucide="user"></i> ${esc(tenantName)}</div>
                    ${r.property_address ? `<div class="text-muted" style="margin-bottom:6px;"><i data-lucide="home"></i> ${esc(r.property_address)}</div>` : ''}
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
                        <span style="color:${priorityColor};font-weight:600;font-size:0.75rem;">${esc(priority.toUpperCase())}</span>
                        <div style="display:flex;gap:4px;">
                            <button class="btn btn--sm btn--ghost btn-k-supplier" data-id="${r.id}" data-supplier="${esc(r.supplier_id || '')}" style="font-size:0.7rem;padding:2px 6px;" title="Fornitore"><i data-lucide="wrench"></i></button>
                            <button class="btn btn--sm btn--ghost btn-k-status" data-id="${r.id}" data-status="${esc(r.maintenance_status || 'aperta')}" style="font-size:0.7rem;padding:2px 6px;" title="Stato">↻</button>
                        </div>
                    </div>
                </div>`;
            }).join('');

            container.querySelectorAll('.btn-k-supplier').forEach(btn => {
                btn.addEventListener('click', e => { e.stopPropagation(); openSupplierModal(btn.dataset.id, btn.dataset.supplier); });
            });
            container.querySelectorAll('.btn-k-status').forEach(btn => {
                btn.addEventListener('click', e => { e.stopPropagation(); openStatusModal(btn.dataset.id, btn.dataset.status); });
            });
        });
    }

    function extractTenantFromNote(note) {
        if (!note) return null;
        // Tenant portal may prefix note with "[Inquilino: NAME]"
        const m = note.match(/\[Inquilino:\s*([^\]]+)\]/);
        return m ? m[1].trim() : null;
    }

    function openSupplierModal(requestId, currentSupplierId) {
        document.getElementById('mw-supplier-request-id').value = requestId;
        document.getElementById('mw-supplier-select').value     = currentSupplierId || '';
        els.supplierModal.hidden = false;
    }

    function closeSupplierModal() { els.supplierModal.hidden = true; }

    // ── Eliminazione ─────────────────────────────────────────────────────────
    let deleteTargetId = null;

    function askDelete(id, label) {
        deleteTargetId = id;
        document.getElementById('mw-delete-name').textContent = label;
        document.getElementById('mw-delete-modal').hidden = false;
    }

    function closeDeleteModal() {
        deleteTargetId = null;
        document.getElementById('mw-delete-modal').hidden = true;
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        const btn = document.getElementById('mw-delete-confirm');
        btn.disabled = true;
        try {
            const res  = await fetch(`${API}?id=${encodeURIComponent(deleteTargetId)}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeDeleteModal();
            showAlert('Intervento eliminato.', 'success');
            loadRequests();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function confirmAssignSupplier() {
        const requestId  = document.getElementById('mw-supplier-request-id').value;
        const supplierId = document.getElementById('mw-supplier-select').value;
        const btn = document.getElementById('mw-supplier-confirm');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        const supplier = suppliers.find(s => String(s.id) === String(supplierId));

        try {
            const res  = await fetch(`${API}?id=${requestId}&action=assign_supplier`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supplier_id:   supplierId || null,
                    supplier_name: supplier ? supplier.name : null,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeSupplierModal();
            showAlert('Fornitore assegnato.', 'success');
            loadRequests();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Assegna';
        }
    }

    function openStatusModal(requestId, currentStatus) {
        document.getElementById('mw-status-request-id').value = requestId;
        document.getElementById('mw-new-status').value        = currentStatus || 'aperta';
        els.statusModal.hidden = false;
    }

    function closeStatusModal() { els.statusModal.hidden = true; }

    async function confirmChangeStatus() {
        const requestId = document.getElementById('mw-status-request-id').value;
        const newStatus = document.getElementById('mw-new-status').value;
        const btn = document.getElementById('mw-status-confirm');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        try {
            const res  = await fetch(`${API}?id=${requestId}&action=maintenance_status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeStatusModal();
            showAlert(`Stato aggiornato: ${STATUS_LABELS[newStatus] || newStatus}.`, 'success');
            loadRequests();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Salva';
        }
    }

    // ---- Bene coinvolto ----------------------------------------------------
    let assetItems = [];

    async function openAssetModal(requestId, propertyId, currentAssetId) {
        document.getElementById('mw-asset-request-id').value = requestId;

        const sel = document.getElementById('mw-asset-select');
        sel.innerHTML = '<option value="">— Nessun bene collegato —</option>';
        document.getElementById('mw-asset-detail').innerHTML = '';
        els.assetModal.hidden = false;

        if (!propertyId) {
            document.getElementById('mw-asset-detail').textContent =
                'La richiesta non è collegata a un immobile: senza immobile non c\'è un inventario da cui scegliere.';
            return;
        }

        try {
            // Solo l'inventario di QUESTO immobile: è anche il vincolo che l'API
            // rifà lato server, così un id manipolato non passa comunque.
            const items = await window.Pagination.fetchList(`${INVENTORY_API}?property_id=${propertyId}`);
            assetItems = items;
            items.forEach(i => {
                const label = [i.item_name, [i.brand, i.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
                sel.appendChild(new Option(label, i.id));
            });
            sel.value = currentAssetId || '';
            renderAssetDetail();
        } catch (e) {
            document.getElementById('mw-asset-detail').textContent = 'Impossibile caricare l\'inventario: ' + e.message;
        }
    }

    function renderAssetDetail() {
        const id   = document.getElementById('mw-asset-select').value;
        const item = assetItems.find(i => String(i.id) === String(id));
        const box  = document.getElementById('mw-asset-detail');

        if (!item) { box.innerHTML = ''; return; }

        const rows = [
            ['Marca', item.brand], ['Modello', item.model], ['Matricola', item.serial_number],
            ['Condizione attuale', item.condition_rating ? `${item.condition_rating}/5 ${CONDITION_LABELS[item.condition_rating] || ''}` : null],
            ['Garanzia', item.warranty_until ? formatDate(item.warranty_until) : null],
        ].filter(([, v]) => v);

        box.innerHTML = rows.length
            ? rows.map(([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(v)}</div>`).join('')
            : '<em>Nessun dato tecnico su questo articolo: compilalo in Inventario per darlo al tecnico.</em>';
    }

    function closeAssetModal() { els.assetModal.hidden = true; }

    // ---- Risposta all'inquilino --------------------------------------------

    /**
     * Il perimetro che il portale usa per RILEGGERE le richieste: inquilino
     * agganciato piu' un `request_type` fra quelli che il portale sa creare.
     * La stessa condizione la riapplica l'API (config/tenant_requests.php) —
     * qui serve solo a non offrire un pulsante che verrebbe rifiutato.
     */
    const TENANT_REQUEST_TYPES = ['maintenance', 'document', 'info', 'appointment', 'other'];

    function isTenantRequest(r) {
        return !!r.tenant_id && TENANT_REQUEST_TYPES.includes(String(r.request_type || ''));
    }

    async function openReplyModal(requestId) {
        document.getElementById('mw-reply-request-id').value = requestId;
        const whoEl    = document.getElementById('mw-reply-who');
        const msgEl    = document.getElementById('mw-reply-message');
        const photosEl = document.getElementById('mw-reply-photos');
        const textEl   = document.getElementById('mw-reply-text');

        whoEl.textContent    = 'Caricamento…';
        msgEl.textContent    = '';
        photosEl.innerHTML   = '';
        textEl.value         = '';
        els.replyModal.hidden = false;

        try {
            // La riga completa: la lista non porta le foto (una query per riga),
            // e per rispondere bisogna vedere cosa e' stato mandato.
            const res  = await fetch(`${API}?id=${encodeURIComponent(requestId)}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const r = json.data;

            const who = [r.tenant_contact_name, r.tenant_contact_surname].filter(Boolean).join(' ')
                        || r.tenant_name || 'Inquilino';
            whoEl.textContent = `${who} — ${r.title || ''}`;
            // La firma "— Inviato da: …" la aggiunge il portale in coda al testo:
            // a chi legge da qui non dice nulla che non sia gia' nell'intestazione.
            msgEl.textContent = String(r.description || '').replace(/\r?\n+—\s*Inviato da:[\s\S]*$/, '').trim();

            photosEl.innerHTML = (r.photos || []).map(p =>
                `<a class="mw-reply__photo" href="api/download_document.php?id=${encodeURIComponent(p.id)}"
                    target="_blank" rel="noopener">
                    <i data-lucide="paperclip"></i> ${esc(p.original_name || p.title || 'foto')}
                 </a>`).join('');

            textEl.value = r.reply_text || '';
            if (window.lucide) window.lucide.createIcons();
        } catch (err) {
            whoEl.textContent = '';
            msgEl.textContent = 'Impossibile caricare la richiesta: ' + err.message;
        }
    }

    function closeReplyModal() { els.replyModal.hidden = true; }

    async function confirmReply() {
        const requestId = document.getElementById('mw-reply-request-id').value;
        const text      = document.getElementById('mw-reply-text').value.trim();
        const btn       = document.getElementById('mw-reply-confirm');

        if (!text) {
            showAlert('Scrivi una risposta prima di inviarla.', 'error');
            return;
        }

        btn.disabled = true; btn.textContent = 'Invio…';
        try {
            const res  = await fetch(`${API}?id=${encodeURIComponent(requestId)}&action=reply`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reply_text: text }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeReplyModal();
            showAlert('Risposta inviata: l\'inquilino la vede nel portale.', 'success');
            loadRequests();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Invia risposta';
        }
    }

    async function confirmLinkAsset() {
        const requestId = document.getElementById('mw-asset-request-id').value;
        const assetId   = document.getElementById('mw-asset-select').value;
        const btn = document.getElementById('mw-asset-confirm');
        btn.disabled = true; btn.textContent = 'Salvataggio…';

        try {
            const res  = await fetch(`${API}?id=${requestId}&action=link_asset`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inventory_item_id: assetId || null }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeAssetModal();
            showAlert(assetId ? 'Bene collegato alla richiesta.' : 'Collegamento rimosso.', 'success');
            loadRequests();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Collega';
        }
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    function formatDate(str) { return window.Fmt.date(str); }

    init();
})();

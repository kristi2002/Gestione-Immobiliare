/**
 * WhatsApp templates management (Impostazioni → Template WhatsApp) — Phase 11
 */
(function () {
    'use strict';

    const API = 'api/whatsapp_templates.php';
    let templates = [];
    let currentPage = 1;
    const PAGE_LIMIT = 25;

    function init() {
        const newBtn = document.getElementById('btn-new-wa-template');
        if (!newBtn) return; // panel not present

        newBtn.addEventListener('click', () => openModal());
        document.getElementById('wa-tpl-modal-close').addEventListener('click', closeModal);
        document.getElementById('wa-tpl-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('wa-tpl-form').addEventListener('submit', save);

        document.querySelectorAll('.settings-tab').forEach(tab => {
            if (tab.dataset.tab === 'wa-templates') {
                tab.addEventListener('click', () => { currentPage = 1; load(); });
            }
        });

        load();
    }

    async function load() {
        const list = document.getElementById('wa-templates-admin-list');
        const pagination = document.getElementById('wa-templates-pagination');
        list.innerHTML = 'Caricamento…';
        try {
            const params = new URLSearchParams({ page: currentPage, limit: PAGE_LIMIT });
            const res = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            const parsed = Pagination.parseResponse(json);
            templates = parsed.items;
            if (!templates.length) {
                list.innerHTML = '<p class="text-muted">Nessun template.</p>';
                Pagination.render(pagination, parsed, (p) => { currentPage = p; load(); });
                return;
            }
            list.innerHTML = templates.map(t => `
                <div class="template-item">
                    <div>
                        <strong>${esc(t.name)}</strong> <span class="badge">${esc(t.category)}</span>
                        ${metaBadge(t)}
                        <div class="text-muted">${esc(t.body)}</div>
                    </div>
                    <div class="entity-card__actions">
                        ${window.RowMenu.button(t.id, 'Azioni template')}
                    </div>
                </div>`).join('');
            list._items = templates;
            window.RowMenu.bind(list, b => [
                { label: 'Modifica', icon: 'pencil',
                  onClick: () => openModal((list._items || []).find(t => t.id == b.dataset.id)) },
                { sep: true },
                { label: 'Elimina', icon: 'trash-2', danger: true, onClick: () => del(b.dataset.id) },
            ]);
            Pagination.render(pagination, parsed, (p) => { currentPage = p; load(); });
        } catch (err) {
            list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
        }
    }

    function openModal(t = null) {
        document.getElementById('wa-tpl-form').reset();
        document.getElementById('wa-tpl-id').value = t ? t.id : '';
        document.getElementById('wa-tpl-modal-title').textContent = t ? 'Modifica template' : 'Nuovo template';
        // Il reset del form riporta la lingua al value dell'HTML ("it"), che è
        // il default giusto per un template nuovo.
        if (t) {
            document.getElementById('wa-tpl-name').value = t.name;
            document.getElementById('wa-tpl-category').value = t.category;
            document.getElementById('wa-tpl-body').value = t.body;
            document.getElementById('wa-tpl-meta-name').value = t.meta_template_name || '';
            document.getElementById('wa-tpl-meta-lang').value = t.meta_language || 'it';
            document.getElementById('wa-tpl-meta-status').value = t.meta_status || 'bozza';
        }
        document.getElementById('wa-tpl-modal').hidden = false;
    }

    function closeModal() {
        document.getElementById('wa-tpl-modal').hidden = true;
    }

    async function save(e) {
        e.preventDefault();
        const id = document.getElementById('wa-tpl-id').value;
        const data = {
            name: document.getElementById('wa-tpl-name').value.trim(),
            category: document.getElementById('wa-tpl-category').value,
            body: document.getElementById('wa-tpl-body').value.trim(),
            meta_template_name: document.getElementById('wa-tpl-meta-name').value.trim(),
            meta_language: document.getElementById('wa-tpl-meta-lang').value.trim() || 'it',
            meta_status: document.getElementById('wa-tpl-meta-status').value,
        };
        try {
            const url = id ? `${API}?id=${id}` : API;
            const res = await fetch(url, {
                method: id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            closeModal();
            load();
        } catch (err) {
            alert(err.message);
        }
    }

    async function del(id) {
        if (!await confirmDialog('Vuoi eliminare questo template?', { title: 'Elimina template' })) return;
        try {
            const res = await fetch(`${API}?id=${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            load();
        } catch (err) { alert(err.message); }
    }

    /**
     * Stato Meta a colpo d'occhio: solo un "approvato" con nome collegato è
     * spedibile fuori dalla finestra di 24 ore. Senza questa etichetta la
     * differenza fra un template usabile e uno decorativo non si vede.
     */
    function metaBadge(t) {
        if (!t.meta_template_name) {
            return '<span class="badge badge--muted" title="Non collegato a Meta: utilizzabile solo entro la finestra di 24 ore">solo 24h</span>';
        }
        const labels = {
            approvato:    ['badge--success', 'Meta: approvato'],
            in_revisione: ['badge--warning', 'Meta: in revisione'],
            rifiutato:    ['badge--danger',  'Meta: rifiutato'],
            bozza:        ['badge--muted',   'Meta: bozza'],
        };
        const [cls, label] = labels[t.meta_status] || labels.bozza;
        return `<span class="badge ${cls}" title="${esc(t.meta_template_name)}">${esc(label)}</span>`;
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : s;
        return d.innerHTML;
    }

    init();
})();

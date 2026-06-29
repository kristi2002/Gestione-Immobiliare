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
                        <div class="text-muted">${esc(t.body)}</div>
                    </div>
                    <div class="entity-card__actions">
                        <button class="btn btn--sm btn--ghost btn-tpl-edit" data-id="${t.id}"><i data-lucide="pencil"></i></button>
                        <button class="btn btn--sm btn--ghost btn-tpl-del" data-id="${t.id}"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>`).join('');
            list.querySelectorAll('.btn-tpl-edit').forEach(b =>
                b.addEventListener('click', () => openModal(templates.find(t => t.id == b.dataset.id))));
            list.querySelectorAll('.btn-tpl-del').forEach(b =>
                b.addEventListener('click', () => del(b.dataset.id)));
            Pagination.render(pagination, parsed, (p) => { currentPage = p; load(); });
        } catch (err) {
            list.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
        }
    }

    function openModal(t = null) {
        document.getElementById('wa-tpl-form').reset();
        document.getElementById('wa-tpl-id').value = t ? t.id : '';
        document.getElementById('wa-tpl-modal-title').textContent = t ? 'Modifica template' : 'Nuovo template';
        if (t) {
            document.getElementById('wa-tpl-name').value = t.name;
            document.getElementById('wa-tpl-category').value = t.category;
            document.getElementById('wa-tpl-body').value = t.body;
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

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : s;
        return d.innerHTML;
    }

    init();
})();

/**
 * Edificio / condominio — pezzi condivisi fra l'elenco (buildings.js) e la
 * scheda (building_profile/index.js).
 *
 * Le due pagine usano lo STESSO markup di modale (building_profile.html ne
 * ricopia gli id apposta), quindi la logica di amministratore e generazione
 * unita' vive qui una volta sola invece che in due copie destinate a divergere.
 *
 * Script classico, non modulo: entrambe le pagine lo caricano con <script src>.
 * Nessuno stato globale oltre le liste caricate una volta per pagina.
 */
(function () {
    'use strict';

    const SUPP_API   = 'api/suppliers.php';
    const CLIENT_API = 'api/clients.php';
    const API        = 'api/buildings.php';

    let administrators = [];
    let clients        = [];

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    async function fetchList(url) {
        if (window.Pagination && window.Pagination.fetchList) return window.Pagination.fetchList(url);
        const json = await fetch(url).then(r => r.json());
        return json.data?.items || json.data || [];
    }

    // ── Amministratore ───────────────────────────────────────────────────

    /**
     * Popola il <select> con i fornitori di categoria "amministratore".
     * Filtrare per categoria e non mostrare tutta la rubrica: un idraulico fra
     * gli amministratori e' rumore che porta a collegamenti sbagliati.
     */
    async function loadAdministrators() {
        const sel = document.getElementById('buildings-admin-supplier');
        if (!sel) return;
        try {
            administrators = await fetchList(SUPP_API + '?category=amministratore&limit=200');
        } catch (_) { administrators = []; }
        renderAdminOptions(sel.value);
    }

    function renderAdminOptions(selectedId) {
        const sel = document.getElementById('buildings-admin-supplier');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Non in rubrica (compila sotto) —</option>'
            + administrators.map(a =>
                `<option value="${a.id}">${esc(a.name)}${a.phone ? ' · ' + esc(a.phone) : ''}</option>`
            ).join('');
        if (selectedId) sel.value = String(selectedId);
    }

    /** I campi testo sono il fallback: con un fornitore collegato non servono. */
    function syncAdminFields() {
        const sel    = document.getElementById('buildings-admin-supplier');
        const manual = document.getElementById('buildings-admin-manual');
        if (!sel || !manual) return;
        const linked = !!sel.value;
        manual.style.opacity = linked ? '.45' : '';
        manual.querySelectorAll('input, button').forEach(el => { el.disabled = linked; });
    }

    function bindAdminFields(onChange) {
        const sel = document.getElementById('buildings-admin-supplier');
        if (sel && !sel.dataset.bound) {
            sel.dataset.bound = '1';
            sel.addEventListener('change', () => { syncAdminFields(); if (onChange) onChange(); });
        }
        const promote = document.getElementById('buildings-admin-promote');
        if (promote && !promote.dataset.bound) {
            promote.dataset.bound = '1';
            promote.addEventListener('click', () => promoteAdministrator(onChange));
        }
    }

    /**
     * Salva in rubrica l'amministratore digitato a mano e lo collega.
     *
     * Senza questo passaggio l'unico modo di normalizzare un contatto sarebbe
     * uscire dal form, andare in Fornitori, crearlo, tornare indietro e
     * ricompilare tutto — e nessuno lo fa, quindi il testo libero resterebbe
     * per sempre la strada piu' comoda.
     */
    async function promoteAdministrator(onChange) {
        const name  = (document.getElementById('buildings-admin-name')?.value || '').trim();
        const phone = (document.getElementById('buildings-admin-phone')?.value || '').trim();
        const email = (document.getElementById('buildings-admin-email')?.value || '').trim();

        if (!name) { alertOut('Inserisci il nome dell\'amministratore prima di salvarlo in rubrica.', 'error'); return; }

        const btn = document.getElementById('buildings-admin-promote');
        btn.disabled = true;
        try {
            const res = await fetch(SUPP_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, phone, email, category: 'amministratore', is_active: 1 }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const created = Array.isArray(json.data) ? json.data[0] : json.data;
            administrators.push(created);
            administrators.sort((a, b) => String(a.name).localeCompare(String(b.name)));
            renderAdminOptions(created.id);
            syncAdminFields();
            if (onChange) onChange();
            alertOut('Amministratore salvato in rubrica e collegato.', 'success');
        } catch (err) {
            alertOut(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    function fillAdminFields(item) {
        const sel = document.getElementById('buildings-admin-supplier');
        if (sel) {
            renderAdminOptions(item?.administrator_supplier_id || '');
        }
        const fromSupplier = !!item?.administrator_supplier_id;
        // Con un fornitore collegato i campi testo restano vuoti: mostrarci il
        // nome risolto farebbe credere che sia un dato di questo edificio.
        setVal('buildings-admin-name',  fromSupplier ? '' : (item?.administrator_name || ''));
        setVal('buildings-admin-phone', fromSupplier ? '' : (item?.administrator_phone || ''));
        setVal('buildings-admin-email', fromSupplier ? '' : (item?.administrator_email || ''));
        syncAdminFields();
    }

    function readAdminFields() {
        const supplierId = document.getElementById('buildings-admin-supplier')?.value || '';
        return {
            administrator_supplier_id: supplierId ? parseInt(supplierId, 10) : null,
            administrator_name:  supplierId ? '' : getVal('buildings-admin-name'),
            administrator_phone: supplierId ? '' : getVal('buildings-admin-phone'),
            administrator_email: supplierId ? '' : getVal('buildings-admin-email'),
        };
    }

    // ── Generazione unita' ───────────────────────────────────────────────

    async function loadClients() {
        if (clients.length) return clients;
        try { clients = await fetchList(CLIENT_API + '?limit=500'); } catch (_) { clients = []; }
        return clients;
    }

    async function openGenerateModal(building) {
        const modal = document.getElementById('buildings-generate-modal');
        if (!modal) return;

        document.getElementById('buildings-generate-building-id').value = building.id;

        const declared = parseInt(building.total_units, 10) || 0;
        const linked   = parseInt(building.unit_count, 10) || 0;
        const missing  = Math.max(0, declared - linked);

        document.getElementById('buildings-generate-summary').textContent =
            `${building.name}: ${declared} unità dichiarate, ${linked} già in anagrafica`
            + (missing ? ` — ne mancano ${missing}.` : '.');

        const countEl = document.getElementById('buildings-generate-count');
        countEl.value = missing || '';
        document.getElementById('buildings-generate-start').value = linked + 1;
        document.getElementById('buildings-generate-prefix').value = 'Unità';

        const sel = document.getElementById('buildings-generate-client');
        sel.innerHTML = '<option value="">— Seleziona —</option>';
        (await loadClients()).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.name || ''} ${c.surname || ''}`.trim() || `#${c.id}`;
            sel.appendChild(opt);
        });

        updateGeneratePreview(building);
        modal.hidden = false;
    }

    function updateGeneratePreview(building) {
        const el = document.getElementById('buildings-generate-preview');
        if (!el) return;
        const prefix = (document.getElementById('buildings-generate-prefix')?.value || 'Unità').trim();
        const start  = parseInt(document.getElementById('buildings-generate-start')?.value, 10) || 1;
        const count  = parseInt(document.getElementById('buildings-generate-count')?.value, 10) || 0;
        if (!count) { el.textContent = ''; return; }
        const addr = building?.address || '';
        el.textContent = `Verranno creati: "${addr} - ${prefix} ${start}" … "${addr} - ${prefix} ${start + count - 1}".`;
    }

    function bindGenerateModal(getBuilding, onDone) {
        const modal = document.getElementById('buildings-generate-modal');
        if (!modal || modal.dataset.bound) return;
        modal.dataset.bound = '1';

        const close = () => { modal.hidden = true; };
        document.getElementById('buildings-generate-close')?.addEventListener('click', close);
        document.getElementById('buildings-generate-cancel')?.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        ['buildings-generate-prefix', 'buildings-generate-start', 'buildings-generate-count'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => updateGeneratePreview(getBuilding()));
        });

        document.getElementById('buildings-generate-confirm')?.addEventListener('click', async () => {
            const buildingId = document.getElementById('buildings-generate-building-id').value;
            const count      = parseInt(document.getElementById('buildings-generate-count').value, 10) || 0;
            const clientId   = document.getElementById('buildings-generate-client').value;

            if (count <= 0)  { alertOut('Indica quante unità generare.', 'error'); return; }
            if (!clientId)   { alertOut('Seleziona il proprietario.', 'error'); return; }

            const btn = document.getElementById('buildings-generate-confirm');
            btn.disabled = true; btn.textContent = 'Generazione…';
            try {
                const res = await fetch(`${API}?id=${buildingId}&action=generate_units`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        count,
                        client_id:     parseInt(clientId, 10),
                        prefix:        document.getElementById('buildings-generate-prefix').value.trim(),
                        start_number:  parseInt(document.getElementById('buildings-generate-start').value, 10) || 1,
                        property_type: document.getElementById('buildings-generate-type').value,
                        price_type:    document.getElementById('buildings-generate-price-type').value,
                    }),
                });
                const json = await res.json();
                if (!json.success) throw new Error(json.error);
                const data = Array.isArray(json.data) ? json.data[0] : json.data;
                close();
                alertOut(data.message, 'success');
                if (onDone) onDone(data);
            } catch (err) {
                alertOut(err.message, 'error');
            } finally {
                btn.disabled = false; btn.textContent = 'Genera';
            }
        });
    }

    // ── Utilities ────────────────────────────────────────────────────────

    function getVal(id) { return (document.getElementById(id)?.value || '').trim(); }
    function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

    /** Usa l'alert della pagina ospite, qualunque delle due sia. */
    function alertOut(msg, type) {
        const el = document.getElementById('buildings-alert') || document.getElementById('profile-alert');
        if (!el) { return; }
        el.textContent   = msg;
        el.className     = `alert alert--${type}`;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    window.BuildingAdmin = {
        loadAdministrators,
        bindAdminFields,
        fillAdminFields,
        readAdminFields,
        openGenerateModal,
        bindGenerateModal,
    };
})();

/**
 * Communications (Comunicazioni) — chat-style email interface (Phase 5)
 */
(function () {
    'use strict';

    const API = 'api/communications.php';
    const TEMPLATES_API = 'api/whatsapp_templates.php';

    let templates     = [];
    let selectedTemplate = null;
    let clients       = [];
    let messages      = [];
    let properties    = [];   // immobili del proprietario selezionato
    let selectedId    = null;
    let composeMode   = 'send'; // 'send' | 'receive'
    let sendChannel   = 'email'; // 'email' | 'whatsapp'
    let searchTimer   = null;
    let statusTimer   = null;
    let currentPage   = 1;
    const PAGE_LIMIT  = 25;

    // Ogni quanto ricontrollare gli stati di consegna del thread aperto. Twilio
    // notifica via api/twilio_status_callback.php, ma la pagina non ha modo di
    // saperlo: senza questo refresh le spunte resterebbero ferme all'invio.
    const STATUS_POLL_MS = 20000;

    const CHANNEL_LABELS = {
        email:    'Email',
        whatsapp: 'WhatsApp',
        sms:      'SMS',
        chiamata: 'Chiamata',
        nota:     'Nota interna',
    };

    // Stato di consegna → spunta. 'sent' = partito, 'delivered' = consegnato,
    // 'read' = letto. Restano vuoti finché un canale non li riporta davvero:
    // mostrare due spunte blu su un canale che non le certifica sarebbe una
    // bugia detta all'agente.
    const STATUS_BADGES = {
        queued:    { text: '· in coda',   cls: '' },
        sent:      { text: '✓',           cls: '' },
        delivered: { text: '✓✓',          cls: 'is-delivered' },
        read:      { text: '✓✓',          cls: 'is-read' },
        failed:    { text: 'Fallita',     cls: 'is-failed' },
    };

    const els = {};

    function init() {
        els.clientList    = document.getElementById('chat-client-list');
        els.clientSearch  = document.getElementById('comm-client-search');
        els.chatEmpty     = document.getElementById('chat-empty');
        els.chatActive    = document.getElementById('chat-active');
        els.chatMessages  = document.getElementById('chat-messages');
        els.chatForm      = document.getElementById('chat-form');
        els.alert         = document.getElementById('comm-alert');
        els.clientName    = document.getElementById('chat-client-name');
        els.clientEmail   = document.getElementById('chat-client-email');
        els.composeHint   = document.getElementById('compose-hint');
        els.submitBtn     = document.getElementById('chat-submit');
        els.pagination    = document.getElementById('communications-pagination');
        els.logKind       = document.getElementById('chat-log-kind');
        els.logKindGroup  = document.getElementById('chat-log-kind-group');
        els.property      = document.getElementById('chat-property');
        els.propertyGroup = document.getElementById('chat-property-group');

        bindEvents();
        loadClientSummary().then(() => {
            const preselect = window.App?.viewParams?.clientId;
            if (preselect) {
                selectClient(Number(preselect));
                window.App.viewParams = {};
            }
        });
    }

    function bindEvents() {
        els.clientSearch.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { currentPage = 1; loadClientSummary(); }, 300);
        });

        els.chatForm.addEventListener('submit', handleSubmit);

        document.getElementById('tab-send-email').addEventListener('click', () => setComposeMode('send', 'email'));
        document.getElementById('tab-send-wa').addEventListener('click', () => setComposeMode('send', 'whatsapp'));
        document.getElementById('tab-receive').addEventListener('click', () => setComposeMode('receive', 'email'));

        els.logKind.addEventListener('change', () => setComposeMode('receive'));

        document.getElementById('btn-use-template').addEventListener('click', openTemplateModal);
        document.getElementById('wa-template-close').addEventListener('click', closeTemplateModal);
        document.getElementById('wa-template-cancel').addEventListener('click', closeTemplateModal);
        document.getElementById('wa-template-apply').addEventListener('click', applyTemplate);
    }

    /**
     * Canale e direzione effettivi del compose. In modalità "Registra" li
     * decide il select: prima erano cablati a email/received, quindi una
     * telefonata annotata a mano finiva in archivio come email in entrata.
     */
    function currentComposeTarget() {
        if (composeMode === 'send') {
            return { channel: sendChannel, direction: 'sent' };
        }
        const [channel, direction] = (els.logKind.value || 'email|received').split('|');
        return { channel, direction };
    }

    function setComposeMode(mode, channel = 'email') {
        composeMode = mode;
        if (mode === 'send') sendChannel = channel;

        document.querySelectorAll('.chat-tab').forEach(tab => {
            const active = tab.dataset.mode === mode && (mode !== 'send' || tab.dataset.channel === sendChannel);
            tab.classList.toggle('chat-tab--active', active);
        });

        const target = currentComposeTarget();

        els.logKindGroup.hidden = mode !== 'receive';

        // L'oggetto ha senso solo per le email: WhatsApp, SMS, chiamate e note
        // non ne hanno uno.
        const subjectGroup = document.getElementById('chat-subject')?.closest('.form-group');
        if (subjectGroup) subjectGroup.style.display = target.channel === 'email' ? '' : 'none';

        const tplBtn = document.getElementById('btn-use-template');
        if (tplBtn) tplBtn.hidden = !(mode === 'send' && sendChannel === 'whatsapp');

        if (mode === 'send' && sendChannel === 'whatsapp') {
            els.composeHint.textContent = 'Il messaggio verrà inviato via WhatsApp (Twilio) e salvato nello storico.';
            els.submitBtn.textContent = 'Invia WhatsApp';
        } else if (mode === 'send') {
            els.composeHint.textContent = 'Il messaggio verrà inviato via email e salvato nello storico.';
            els.submitBtn.textContent = 'Invia email';
        } else if (target.channel === 'nota') {
            els.composeHint.textContent = 'Nota interna: resta nel gestionale, non viene inviata a nessuno.';
            els.submitBtn.textContent = 'Salva nota';
        } else {
            els.composeHint.textContent = 'Registrazione manuale: nulla viene inviato, la conversazione viene solo annotata.';
            els.submitBtn.textContent = 'Registra';
        }
    }

    function renderPropertyOptions() {
        els.propertyGroup.hidden = properties.length === 0;
        els.property.innerHTML = '<option value="">— Nessun immobile —</option>' +
            properties.map(p =>
                `<option value="${p.id}">${escapeHtml(propertyLabel(p))}</option>`
            ).join('');
    }

    function propertyLabel(p) {
        return p.city ? `${p.address} — ${p.city}` : String(p.address || '');
    }

    const MAIL_ENABLED_HINT = '';

    // -------------------------------------------------------------------------
    // Client sidebar
    // -------------------------------------------------------------------------

    async function loadClientSummary() {
        const params = new URLSearchParams({ summary: '1' });
        const search = els.clientSearch.value.trim();
        if (search) params.set('search', search);
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

        els.clientList.innerHTML = '<li class="chat-client-list__empty">Caricamento...</li>';

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const parsed = Pagination.parseResponse(json);
            clients = parsed.items;
            renderClientList();
            Pagination.render(els.pagination, parsed, (p) => { currentPage = p; loadClientSummary(); });
        } catch (err) {
            els.clientList.innerHTML = `<li class="chat-client-list__empty chat-client-list__error">${escapeHtml(err.message)}</li>`;
        }
    }

    function renderClientList() {
        if (clients.length === 0) {
            els.clientList.innerHTML = '<li class="chat-client-list__empty">Nessun proprietario trovato.</li>';
            return;
        }

        els.clientList.innerHTML = clients.map(c => {
            const preview = c.last_message_preview
                ? truncate(c.last_message_preview, 40)
                : 'Nessun messaggio';
            const time = c.last_message_at ? formatRelativeTime(c.last_message_at) : '';
            const active = c.id == selectedId ? ' chat-client-item--active' : '';
            const count  = c.message_count > 0
                ? `<span class="chat-client-item__count">${c.message_count}</span>`
                : '';

            return `
                <li>
                    <button type="button" class="chat-client-item${active}" data-id="${c.id}">
                        <div class="chat-client-item__top">
                            <span class="chat-client-item__name">${escapeHtml(c.surname)} ${escapeHtml(c.name)}</span>
                            <span class="chat-client-item__time">${time}</span>
                        </div>
                        <div class="chat-client-item__bottom">
                            <span class="chat-client-item__preview">${escapeHtml(preview)}</span>
                            ${count}
                        </div>
                    </button>
                </li>`;
        }).join('');

        els.clientList.querySelectorAll('.chat-client-item').forEach(btn => {
            btn.addEventListener('click', () => selectClient(Number(btn.dataset.id)));
        });
    }

    // -------------------------------------------------------------------------
    // Chat thread
    // -------------------------------------------------------------------------

    async function selectClient(clientId) {
        selectedId = clientId;
        renderClientList();

        els.chatEmpty.hidden  = true;
        els.chatActive.hidden = false;
        els.chatMessages.innerHTML = '<div class="chat-loading">Caricamento messaggi…</div>';

        const client = clients.find(c => c.id == clientId);
        if (client) {
            els.clientName.textContent  = `${client.surname} ${client.name}`;
            els.clientEmail.textContent = client.email || 'Nessuna email configurata';
        }

        els.chatForm.reset();
        setComposeMode(composeMode);

        try {
            const res  = await fetch(`${API}?client_id=${clientId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            messages   = json.data.messages;
            properties = json.data.properties || [];
            renderPropertyOptions();

            if (json.data.client) {
                els.clientName.textContent  = `${json.data.client.surname} ${json.data.client.name}`;
                els.clientEmail.textContent = json.data.client.email || 'Nessuna email configurata';
            }

            renderMessages();
            scrollToBottom();
            startStatusPolling();
        } catch (err) {
            els.chatMessages.innerHTML = `<div class="chat-loading chat-loading--error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderMessages() {
        if (messages.length === 0) {
            els.chatMessages.innerHTML = '<div class="chat-no-messages">Nessun messaggio. Inizia la conversazione!</div>';
            return;
        }

        els.chatMessages.innerHTML = messages.map(renderBubble).join('');

        // Il pill dell'immobile porta alla scheda: il collegamento serve a poco
        // se poi bisogna cercarlo a mano nell'elenco immobili.
        els.chatMessages.querySelectorAll('.chat-bubble__property').forEach(pill => {
            pill.addEventListener('click', () => {
                if (window.App) window.App.navigateTo('property_profile', { propertyId: Number(pill.dataset.propertyId) });
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    function renderBubble(m) {
        const channel = m.channel || 'email';
        const isNote  = channel === 'nota';
        const isSent  = m.direction === 'sent';

        // Una nota interna non è né inviata né ricevuta: non deve prendere il
        // lato/colore di una delle due, altrimenti si legge come un messaggio
        // scambiato col proprietario.
        const modifiers = [
            `chat-bubble--ch-${channel}`,
            isNote ? 'chat-bubble--note' : (isSent ? 'chat-bubble--sent' : 'chat-bubble--received'),
        ].join(' ');

        const property = m.property_id
            ? `<button type="button" class="chat-bubble__property" data-property-id="${m.property_id}">
                   <i data-lucide="home"></i>${escapeHtml(propertyLabel({ address: m.property_address, city: m.property_city }))}
               </button>`
            : '';

        const verso = isNote ? 'Nota interna' : (isSent ? '↗ Inviata' : '↙ Ricevuta');

        return `
            <div class="chat-bubble ${modifiers}" data-id="${m.id}">
                <div class="chat-bubble__channel">${escapeHtml(CHANNEL_LABELS[channel] || channel)}</div>
                ${m.subject ? `<div class="chat-bubble__subject">${escapeHtml(m.subject)}</div>` : ''}
                <div class="chat-bubble__body">${escapeHtml(m.body)}</div>
                ${property}
                <div class="chat-bubble__meta">
                    <span>${verso}</span>
                    <span>${formatDateTime(m.created_at)}</span>
                    <span class="chat-bubble__status" data-status-for="${m.id}">${statusBadgeHtml(m)}</span>
                </div>
            </div>`;
    }

    function statusBadgeHtml(m) {
        if (m.direction !== 'sent' || m.channel === 'nota') return '';
        const badge = STATUS_BADGES[m.status];
        if (!badge) return '';
        const title = m.status_detail ? ` title="${escapeHtml(m.status_detail)}"` : '';
        return `<span class="chat-status ${badge.cls}"${title}>${badge.text}</span>`;
    }

    // -------------------------------------------------------------------------
    // Stati di consegna
    // -------------------------------------------------------------------------

    function startStatusPolling() {
        stopStatusPolling();
        statusTimer = setInterval(refreshStatuses, STATUS_POLL_MS);
    }

    function stopStatusPolling() {
        if (statusTimer) clearInterval(statusTimer);
        statusTimer = null;
    }

    async function refreshStatuses() {
        // La SPA sostituisce il contenuto senza avvisarci: se il thread non è
        // più nel DOM il timer va spento, altrimenti resta a interrogare l'API
        // per il resto della sessione.
        if (!selectedId || !document.body.contains(els.chatMessages)) {
            stopStatusPolling();
            return;
        }
        try {
            const res  = await fetch(`${API}?action=statuses&client_id=${selectedId}`);
            const json = await res.json();
            if (!json.success) return;

            json.data.statuses.forEach(s => {
                const msg = messages.find(m => String(m.id) === String(s.id));
                if (!msg || msg.status === s.status) return;
                msg.status        = s.status;
                msg.status_detail = s.status_detail;
                const slot = els.chatMessages.querySelector(`[data-status-for="${s.id}"]`);
                if (slot) slot.innerHTML = statusBadgeHtml(msg);
            });
        } catch (_) {
            // Rete assente o sessione scaduta: il prossimo giro riprova.
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();

        if (!selectedId) return;

        const subject = document.getElementById('chat-subject').value.trim();
        const body    = document.getElementById('chat-body').value.trim();

        if (!body) {
            showAlert('Scrivi un messaggio.', 'error');
            return;
        }

        const target     = currentComposeTarget();
        const propertyId = Number(els.property.value) || null;

        els.submitBtn.disabled = true;

        try {
            const res  = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id:   selectedId,
                    property_id: propertyId,
                    direction:   target.direction,
                    channel:     target.channel,
                    subject:     subject || null,
                    body,
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            els.chatForm.reset();
            await loadClientSummary();
            await selectClient(selectedId);
            showAlert(composeMode === 'send'
                ? (sendChannel === 'whatsapp' ? 'WhatsApp inviato e salvato.' : 'Email inviata e salvata.')
                : (target.channel === 'nota' ? 'Nota interna salvata.' : 'Messaggio registrato.'), 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            els.submitBtn.disabled = false;
        }
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    function scrollToBottom() {
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    }

    function showAlert(message, type) {
        els.alert.textContent = message;
        els.alert.className   = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._timer);
        els.alert._timer = setTimeout(() => { els.alert.style.display = 'none'; }, 4000);
    }

    function formatDateTime(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }

    function formatRelativeTime(dateStr) {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);

        if (mins < 1)   return 'ora';
        if (mins < 60)  return `${mins}m`;
        if (hours < 24) return `${hours}h`;
        if (days < 7)   return `${days}g`;
        return new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
    }

    function truncate(str, len) {
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // -------------------------------------------------------------------------
    // WhatsApp templates
    // -------------------------------------------------------------------------

    async function openTemplateModal() {
        selectedTemplate = null;
        document.getElementById('wa-template-vars').hidden = true;
        document.getElementById('wa-template-apply').hidden = true;
        document.getElementById('wa-template-modal').hidden = false;
        const list = document.getElementById('wa-template-list');
        list.innerHTML = 'Caricamento…';
        try {
            const res = await fetch(`${TEMPLATES_API}?limit=500&page=1`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            templates = Pagination.parseResponse(json).items;
            if (!templates.length) {
                list.innerHTML = '<p class="text-muted">Nessun template configurato.</p>';
                return;
            }
            list.innerHTML = templates.map(t => `
                <div class="template-item" data-id="${t.id}">
                    <strong>${escapeHtml(t.name)}</strong>
                    <span class="badge">${escapeHtml(t.category)}</span>
                    <div class="text-muted">${escapeHtml(truncate(t.body, 90))}</div>
                </div>`).join('');
            list.querySelectorAll('.template-item').forEach(item => {
                item.addEventListener('click', () => selectTemplate(Number(item.dataset.id)));
            });
        } catch (err) {
            list.innerHTML = `<div class="entity-error">${escapeHtml(err.message)}</div>`;
        }
    }

    function selectTemplate(id) {
        selectedTemplate = templates.find(t => t.id == id);
        if (!selectedTemplate) return;
        document.querySelectorAll('.template-item').forEach(i =>
            i.classList.toggle('template-item--active', i.dataset.id == id));

        document.getElementById('wa-template-selected-name').textContent = selectedTemplate.name;
        let vars = [];
        try { vars = JSON.parse(selectedTemplate.variables || '[]'); } catch (e) { vars = []; }

        const fields = document.getElementById('wa-template-var-fields');
        const client = clients.find(c => c.id == selectedId);
        fields.innerHTML = vars.map(v => {
            let preset = '';
            if (v === 'nome' && client) preset = `${client.name}`;
            return `<div class="form-group"><label>${escapeHtml(v)}</label>
                <input type="text" class="form-input wa-var-input" data-var="${escapeHtml(v)}" value="${escapeHtml(preset)}"></div>`;
        }).join('');

        document.getElementById('wa-template-vars').hidden = false;
        document.getElementById('wa-template-apply').hidden = false;
        updateTemplatePreview();
        fields.querySelectorAll('.wa-var-input').forEach(inp => inp.addEventListener('input', updateTemplatePreview));
    }

    function fillTemplate() {
        let body = selectedTemplate.body;
        document.querySelectorAll('.wa-var-input').forEach(inp => {
            const re = new RegExp('\\{\\{\\s*' + inp.dataset.var.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}\\}', 'g');
            body = body.replace(re, inp.value);
        });
        return body;
    }

    function updateTemplatePreview() {
        document.getElementById('wa-template-preview').value = fillTemplate();
    }

    function applyTemplate() {
        if (!selectedTemplate) return;
        document.getElementById('chat-body').value = fillTemplate();
        closeTemplateModal();
    }

    function closeTemplateModal() {
        document.getElementById('wa-template-modal').hidden = true;
    }

    // Expose for client profile integration
    window.Communications = { selectClient, reload: loadClientSummary };

    init();
})();

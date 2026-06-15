/**
 * Communications (Comunicazioni) — chat-style email interface (Phase 5)
 */
(function () {
    'use strict';

    const API = 'api/communications.php';

    let clients       = [];
    let messages      = [];
    let selectedId    = null;
    let composeMode   = 'send'; // 'send' | 'receive'
    let sendChannel   = 'email'; // 'email' | 'whatsapp'
    let searchTimer   = null;

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
            searchTimer = setTimeout(loadClientSummary, 300);
        });

        els.chatForm.addEventListener('submit', handleSubmit);

        document.getElementById('tab-send-email').addEventListener('click', () => setComposeMode('send', 'email'));
        document.getElementById('tab-send-wa').addEventListener('click', () => setComposeMode('send', 'whatsapp'));
        document.getElementById('tab-receive').addEventListener('click', () => setComposeMode('receive', 'email'));
    }

    function setComposeMode(mode, channel = 'email') {
        composeMode = mode;
        if (mode === 'send') sendChannel = channel;

        document.querySelectorAll('.chat-tab').forEach(tab => {
            const active = tab.dataset.mode === mode && (mode !== 'send' || tab.dataset.channel === sendChannel);
            tab.classList.toggle('chat-tab--active', active);
        });

        const subjectGroup = document.getElementById('chat-subject')?.closest('.form-group');
        if (subjectGroup) subjectGroup.style.display = (mode === 'send' && sendChannel === 'whatsapp') ? 'none' : '';

        if (mode === 'send' && sendChannel === 'whatsapp') {
            els.composeHint.textContent = 'Il messaggio verrà inviato via WhatsApp (Twilio) e salvato nello storico.';
            els.submitBtn.textContent = 'Invia WhatsApp';
        } else if (mode === 'send') {
            els.composeHint.textContent = 'Il messaggio verrà inviato via email e salvato nello storico.';
            els.submitBtn.textContent = 'Invia email';
        } else {
            els.composeHint.textContent = 'Registra manualmente un messaggio ricevuto dal proprietario.';
            els.submitBtn.textContent = 'Registra';
        }
    }

    const MAIL_ENABLED_HINT = '';

    // -------------------------------------------------------------------------
    // Client sidebar
    // -------------------------------------------------------------------------

    async function loadClientSummary() {
        const params = new URLSearchParams({ summary: '1' });
        const search = els.clientSearch.value.trim();
        if (search) params.set('search', search);

        els.clientList.innerHTML = '<li class="chat-client-list__empty">Caricamento...</li>';

        try {
            const res  = await fetch(`${API}?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            clients = json.data;
            renderClientList();
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

            messages = json.data.messages;

            if (json.data.client) {
                els.clientName.textContent  = `${json.data.client.surname} ${json.data.client.name}`;
                els.clientEmail.textContent = json.data.client.email || 'Nessuna email configurata';
            }

            renderMessages();
            scrollToBottom();
        } catch (err) {
            els.chatMessages.innerHTML = `<div class="chat-loading chat-loading--error">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderMessages() {
        if (messages.length === 0) {
            els.chatMessages.innerHTML = '<div class="chat-no-messages">Nessun messaggio. Inizia la conversazione!</div>';
            return;
        }

        els.chatMessages.innerHTML = messages.map(m => {
            const isSent = m.direction === 'sent';
            const bubbleClass = isSent ? 'chat-bubble--sent' : 'chat-bubble--received';

            return `
                <div class="chat-bubble ${bubbleClass}">
                    ${m.subject ? `<div class="chat-bubble__subject">${escapeHtml(m.subject)}</div>` : ''}
                    <div class="chat-bubble__body">${escapeHtml(m.body)}</div>
                    <div class="chat-bubble__meta">
                        <span>${isSent ? '↗ Inviata' : '↙ Ricevuta'}</span>
                        <span>${formatDateTime(m.created_at)}</span>
                        ${m.status === 'failed' ? '<span class="chat-bubble__failed">Fallita</span>' : ''}
                    </div>
                </div>`;
        }).join('');
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

        const direction = composeMode === 'send' ? 'sent' : 'received';

        els.submitBtn.disabled = true;

        try {
            const res  = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: selectedId,
                    direction,
                    channel:   composeMode === 'send' ? sendChannel : 'email',
                    subject:   subject || null,
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
                : 'Messaggio ricevuto registrato.', 'success');
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

    // Expose for client profile integration
    window.Communications = { selectClient, reload: loadClientSummary };

    init();
})();

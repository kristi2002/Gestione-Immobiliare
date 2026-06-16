(function () {
    'use strict';

    const INBOX_API = 'api/whatsapp_inbox.php';
    const SEND_API  = 'api/whatsapp_send.php';
    const POLL_MS   = 30000;

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    let pollTimer       = null;
    let activePhone     = null;
    let threads         = [];
    const els           = {};

    function init() {
        els.alert       = document.getElementById('whatsapp-inbox-alert');
        els.threadList  = document.getElementById('wa-thread-list');
        els.emptyState  = document.getElementById('wa-empty-state');
        els.activeChat  = document.getElementById('wa-active-chat');
        els.chatHeader  = document.getElementById('wa-chat-header');
        els.chatMsgs    = document.getElementById('wa-chat-messages');
        els.replyText   = document.getElementById('wa-reply-text');
        els.sendBtn     = document.getElementById('wa-send-btn');
        els.newModal    = document.getElementById('wa-new-modal');

        bindEvents();
        loadThreads();
        startPolling();

        // Stop polling when SPA navigates away
        document.addEventListener('app-navigate', stopPolling, { once: true });
    }

    function bindEvents() {
        document.getElementById('btn-new-wa-conv').addEventListener('click', openNewModal);
        document.getElementById('wa-new-close').addEventListener('click', closeNewModal);
        document.getElementById('wa-new-cancel').addEventListener('click', closeNewModal);
        els.newModal.addEventListener('click', e => { if (e.target === els.newModal) closeNewModal(); });
        document.getElementById('wa-new-send').addEventListener('click', sendNewConversation);

        els.sendBtn.addEventListener('click', sendReply);
        els.replyText.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
        });
        // Auto-grow textarea
        els.replyText.addEventListener('input', () => {
            els.replyText.style.height = 'auto';
            els.replyText.style.height = Math.min(els.replyText.scrollHeight, 120) + 'px';
        });
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(() => {
            loadThreads(true);
            if (activePhone) loadMessages(activePhone, true);
        }, POLL_MS);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    async function loadThreads(silent = false) {
        if (!silent) els.threadList.innerHTML = '<div style="padding:1rem;text-align:center;color:#999;font-size:0.9rem;">Caricamento…</div>';
        try {
            const res  = await fetch(`${INBOX_API}?action=threads`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            threads = json.data || [];
            renderThreads();
        } catch (err) {
            if (!silent) {
                els.threadList.innerHTML = `<div style="padding:1rem;color:var(--color-danger);font-size:0.85rem;">${esc(err.message)}</div>`;
            }
        }
    }

    function renderThreads() {
        if (!threads.length) {
            els.threadList.innerHTML = '<div style="padding:1.5rem;text-align:center;color:#999;font-size:0.9rem;">Nessuna conversazione.</div>';
            return;
        }

        els.threadList.innerHTML = threads.map(t => {
            const initials = (t.phone || '?').replace(/\D/g, '').slice(-2);
            const isActive = t.phone === activePhone;
            const unread   = parseInt(t.unread_count) || 0;
            const preview  = t.last_message
                ? (t.last_message.length > 40 ? t.last_message.substring(0, 40) + '…' : t.last_message)
                : '';

            return `<div class="wa-thread-item${isActive ? ' active' : ''}" data-phone="${esc(t.phone)}">
                <div class="wa-thread-avatar">${esc(initials)}</div>
                <div class="wa-thread-info">
                    <div class="wa-thread-phone">${esc(t.phone)}</div>
                    ${t.contact_name ? `<div class="wa-thread-preview" style="color:#555;font-weight:500;">${esc(t.contact_name)}</div>` : ''}
                    <div class="wa-thread-preview">${esc(preview)}</div>
                </div>
                ${unread ? `<div class="wa-unread-badge">${unread}</div>` : ''}
            </div>`;
        }).join('');

        els.threadList.querySelectorAll('.wa-thread-item').forEach(item => {
            item.addEventListener('click', () => openThread(item.dataset.phone));
        });
    }

    async function openThread(phone) {
        activePhone = phone;
        renderThreads(); // update active highlight

        els.emptyState.style.display  = 'none';
        els.activeChat.style.display  = 'flex';
        els.chatHeader.textContent    = phone;

        const thread = threads.find(t => t.phone === phone);
        if (thread?.contact_name) {
            els.chatHeader.textContent = `${thread.contact_name} (${phone})`;
        }

        await loadMessages(phone);
        await markRead(phone);
    }

    async function loadMessages(phone, silent = false) {
        if (!silent) els.chatMsgs.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;">Caricamento…</div>';
        try {
            const res  = await fetch(`${INBOX_API}?action=messages&phone=${encodeURIComponent(phone)}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const messages  = json.data || [];
            const wasBottom = isNearBottom();

            els.chatMsgs.innerHTML = messages.map(m => {
                const isOut = m.direction === 'outbound' || m.direction === 'sent';
                const time  = m.created_at ? formatTime(m.created_at) : '';
                return `<div class="wa-bubble wa-bubble--${isOut ? 'out' : 'in'}">
                    ${esc(m.body || m.message || '')}
                    <div class="wa-bubble-time">${esc(time)}</div>
                </div>`;
            }).join('');

            if (!silent || wasBottom) scrollToBottom();
        } catch (err) {
            if (!silent) {
                els.chatMsgs.innerHTML = `<div style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</div>`;
            }
        }
    }

    async function markRead(phone) {
        try {
            await fetch(`${INBOX_API}?action=mark_read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone }),
            });
            // Update local thread unread count
            const t = threads.find(t => t.phone === phone);
            if (t) { t.unread_count = 0; renderThreads(); }
        } catch (e) { /* non-critical */ }
    }

    async function sendReply() {
        const text = els.replyText.value.trim();
        if (!text || !activePhone) return;

        els.sendBtn.disabled    = true;
        els.replyText.disabled  = true;

        try {
            const res  = await fetch(SEND_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: activePhone, message: text }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            els.replyText.value        = '';
            els.replyText.style.height = '';
            await loadMessages(activePhone);
            await loadThreads(true);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            els.sendBtn.disabled   = false;
            els.replyText.disabled = false;
            els.replyText.focus();
        }
    }

    function openNewModal() {
        document.getElementById('wa-new-phone').value   = '';
        document.getElementById('wa-new-message').value = '';
        els.newModal.hidden = false;
        document.getElementById('wa-new-phone').focus();
    }

    function closeNewModal() { els.newModal.hidden = true; }

    async function sendNewConversation() {
        const phone   = document.getElementById('wa-new-phone').value.trim();
        const message = document.getElementById('wa-new-message').value.trim();
        if (!phone || !message) { showAlert('Inserisci numero e messaggio.', 'error'); return; }

        const btn = document.getElementById('wa-new-send');
        btn.disabled = true; btn.textContent = 'Invio…';

        try {
            const res  = await fetch(SEND_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, message }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeNewModal();
            showAlert('Messaggio inviato.', 'success');
            await loadThreads();
            openThread(phone);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Invia';
        }
    }

    function isNearBottom() {
        const el = els.chatMsgs;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }

    function scrollToBottom() {
        els.chatMsgs.scrollTop = els.chatMsgs.scrollHeight;
    }

    function showAlert(msg, type) {
        els.alert.textContent   = msg;
        els.alert.className     = `alert alert--${type}`;
        els.alert.style.display = 'block';
        clearTimeout(els.alert._t);
        els.alert._t = setTimeout(() => { els.alert.style.display = 'none'; }, 5000);
    }

    function formatTime(str) {
        if (!str) return '';
        const d = new Date(str);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' +
               d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    init();
})();

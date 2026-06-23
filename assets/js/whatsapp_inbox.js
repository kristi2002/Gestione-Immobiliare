(function () {
    'use strict';

    const INBOX_API = 'api/whatsapp_inbox.php';
    const SEND_API  = 'api/whatsapp_send.php';
    const POLL_MS   = 30000;

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    let pollTimer        = null;
    let activePhone      = null;
    let threads          = [];
    let msgPage          = 1;   // current oldest page loaded (pages go newest→oldest as page increases)
    let msgTotalPages    = 1;   // total pages available for active thread
    const MSG_LIMIT      = 50;  // messages per page
    const els            = {};

    function init() {
        els.alert            = document.getElementById('whatsapp-inbox-alert');
        els.threadList       = document.getElementById('wa-thread-list');
        els.emptyState       = document.getElementById('wa-empty-state');
        els.activeChat       = document.getElementById('wa-active-chat');
        els.chatHeader       = document.getElementById('wa-chat-header');
        els.chatName         = document.getElementById('wa-chat-name');
        els.chatSub          = document.getElementById('wa-chat-sub');
        els.chatAvatar       = document.getElementById('wa-chat-avatar');
        els.chatMsgs         = document.getElementById('wa-chat-messages');
        els.replyText        = document.getElementById('wa-reply-text');
        els.sendBtn          = document.getElementById('wa-send-btn');
        els.newModal         = document.getElementById('wa-new-modal');
        els.loadEarlierBar   = document.getElementById('wa-load-earlier-bar');
        els.loadEarlierBtn   = document.getElementById('wa-load-earlier-btn');

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
        // Load earlier messages button
        els.loadEarlierBtn.addEventListener('click', loadEarlierMessages);
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
        if (!silent) {
            const hdr = els.threadList.querySelector('.wa-thread-list-header');
            els.threadList.innerHTML = '';
            if (hdr) els.threadList.appendChild(hdr);
            els.threadList.insertAdjacentHTML('beforeend', '<div style="padding:1rem;text-align:center;color:#999;font-size:0.9rem;">Caricamento…</div>');
        }
        try {
            const res  = await fetch(`${INBOX_API}?threads=1`);
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
        const header = els.threadList.querySelector('.wa-thread-list-header');
        if (!threads.length) {
            els.threadList.innerHTML = '';
            if (header) els.threadList.appendChild(header);
            els.threadList.insertAdjacentHTML('beforeend', '<div style="padding:1.5rem;text-align:center;color:#999;font-size:0.85rem;">Nessuna conversazione.</div>');
            return;
        }

        const items = threads.map(t => {
            const name     = t.contact_name || t.phone || '?';
            const initials = name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
            const isActive = t.phone === activePhone;
            const unread   = parseInt(t.unread_count) || 0;
            const preview  = t.last_message
                ? (t.last_message.length > 45 ? t.last_message.substring(0, 45) + '…' : t.last_message)
                : '';
            const timeStr  = t.last_at ? formatTime(t.last_at) : '';

            return `<div class="wa-thread-item${isActive ? ' active' : ''}" data-phone="${esc(t.phone)}">
                <div class="wa-thread-avatar">${esc(initials)}</div>
                <div class="wa-thread-info">
                    <div class="wa-thread-name">${esc(name)}</div>
                    ${t.contact_name ? `<div class="wa-thread-phone">${esc(t.phone)}</div>` : ''}
                    <div class="wa-thread-preview">${esc(preview)}</div>
                </div>
                <div class="wa-thread-meta">
                    ${timeStr ? `<div class="wa-thread-time">${esc(timeStr)}</div>` : ''}
                    ${unread ? `<div class="wa-unread-badge">${unread}</div>` : ''}
                </div>
            </div>`;
        }).join('');

        els.threadList.innerHTML = '';
        if (header) els.threadList.appendChild(header);
        els.threadList.insertAdjacentHTML('beforeend', items);

        els.threadList.querySelectorAll('.wa-thread-item').forEach(item => {
            item.addEventListener('click', () => openThread(item.dataset.phone));
        });
    }

    async function openThread(phone) {
        activePhone    = phone;
        msgPage        = 1;
        msgTotalPages  = 1;
        renderThreads(); // update active highlight

        els.emptyState.style.display  = 'none';
        els.activeChat.style.display  = 'flex';
        els.loadEarlierBar.style.display = 'none';

        const thread   = threads.find(t => t.phone === phone);
        const name     = thread?.contact_name || phone;
        const initials = name.replace(/\s+/g, '').slice(0, 2).toUpperCase();

        els.chatName.textContent   = name;
        els.chatSub.textContent    = thread?.contact_name ? phone : '';
        els.chatAvatar.textContent = initials;

        await loadMessages(phone);
        await markRead(phone);
    }

    function renderBubbles(messages) {
        return messages.map(m => {
            const isOut = m.direction === 'outbound' || m.direction === 'sent';
            const time  = m.received_at || m.created_at;
            return `<div class="wa-bubble wa-bubble--${isOut ? 'out' : 'in'}">
                ${esc(m.body || m.message || '')}
                <div class="wa-bubble-time">${esc(time ? formatTime(time) : '')}</div>
            </div>`;
        }).join('');
    }

    async function loadMessages(phone, silent = false) {
        if (!silent) els.chatMsgs.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;">Caricamento…</div>';
        try {
            const url  = `${INBOX_API}?thread=${encodeURIComponent(phone)}&page=1&limit=${MSG_LIMIT}`;
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const data      = json.data;
            const messages  = data?.items ?? data ?? [];
            msgPage         = 1;
            msgTotalPages   = data?.pages ?? 1;

            els.chatMsgs.innerHTML = renderBubbles(messages);
            els.loadEarlierBar.style.display = msgTotalPages > 1 ? 'block' : 'none';

            if (!silent) scrollToBottom();
            else if (isNearBottom()) scrollToBottom();
        } catch (err) {
            if (!silent) {
                els.chatMsgs.innerHTML = `<div style="text-align:center;color:var(--color-danger);padding:2rem;">${esc(err.message)}</div>`;
            }
        }
    }

    async function loadEarlierMessages() {
        if (!activePhone || msgPage >= msgTotalPages) return;

        const btn = els.loadEarlierBtn;
        btn.disabled    = true;
        btn.textContent = 'Caricamento…';

        const prevScrollHeight = els.chatMsgs.scrollHeight;

        try {
            const nextPage = msgPage + 1;
            const url = `${INBOX_API}?thread=${encodeURIComponent(activePhone)}&page=${nextPage}&limit=${MSG_LIMIT}`;
            const res  = await fetch(url);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const data     = json.data;
            const messages = data?.items ?? [];
            msgPage        = nextPage;
            msgTotalPages  = data?.pages ?? msgTotalPages;

            // Prepend older messages at top
            els.chatMsgs.insertAdjacentHTML('afterbegin', renderBubbles(messages));

            // Restore scroll position so user stays at the same spot
            els.chatMsgs.scrollTop = els.chatMsgs.scrollHeight - prevScrollHeight;

            // Hide button if no more pages
            if (msgPage >= msgTotalPages) {
                els.loadEarlierBar.style.display = 'none';
            }
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled    = false;
            btn.textContent = '⬆ Carica messaggi precedenti';
        }
    }

    async function markRead(phone) {
        try {
            await fetch(`${INBOX_API}?phone=${encodeURIComponent(phone)}`, {
                method: 'PATCH',
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

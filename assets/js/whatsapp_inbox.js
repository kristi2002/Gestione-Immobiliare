(function () {
    'use strict';

    const INBOX_API = 'api/whatsapp_inbox.php';
    const SEND_API  = 'api/whatsapp_send.php';
    // Un banco di triage a 30s è già "vecchio" quando l'agente lo guarda. Il
    // polling però viene sospeso a scheda nascosta e ripreso subito al rientro
    // (vedi bindVisibility), così il ritmo più stretto non costa nulla a vuoto.
    const POLL_MS   = 15000;

    function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

    let pollTimer        = null;
    let activePhone      = null;
    let threads          = [];
    let msgPage          = 1;   // current oldest page loaded (pages go newest→oldest as page increases)
    let msgTotalPages    = 1;   // total pages available for active thread
    const MSG_LIMIT      = 50;  // messages per page
    const els            = {};
    let threadFilter     = 'all';  // 'all' | 'unread'
    let threadSearch     = '';

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
        els.threadItems      = document.getElementById('wa-thread-items');
        els.threadSearch     = document.getElementById('wa-thread-search');
        els.threadTabs       = document.getElementById('wa-thread-tabs');
        els.unknownBar       = document.getElementById('wa-unknown-bar');
        els.leadModal        = document.getElementById('wa-lead-modal');
        els.linkModal        = document.getElementById('wa-link-modal');
        els.linkResults      = document.getElementById('wa-link-results');
        els.linkSearch       = document.getElementById('wa-link-search');

        bindEvents();
        bindTriageEvents();
        bindVisibility();
        loadThreads();
        startPolling();

        // Stop polling when SPA navigates away
        document.addEventListener('app-navigate', teardown, { once: true });
    }

    function teardown() {
        stopPolling();
        document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    /**
     * A scheda nascosta il polling è puro spreco (e col webhook nemmeno serve:
     * i messaggi arrivano comunque al DB). Al rientro si ricarica subito, così
     * l'agente non aspetta il prossimo tick per vedere cosa è successo.
     */
    function bindVisibility() {
        document.addEventListener('visibilitychange', onVisibilityChange);
    }

    function onVisibilityChange() {
        if (document.hidden) {
            stopPolling();
        } else {
            loadThreads(true);
            if (activePhone) loadMessages(activePhone, true);
            startPolling();
        }
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

        // Thread search + filter tabs
        if (els.threadSearch) {
            let t = null;
            els.threadSearch.addEventListener('input', () => {
                clearTimeout(t);
                t = setTimeout(() => { threadSearch = els.threadSearch.value.trim().toLowerCase(); renderThreads(); }, 180);
            });
        }
        if (els.threadTabs) {
            els.threadTabs.addEventListener('click', e => {
                const tab = e.target.closest('.wa-tab');
                if (!tab) return;
                threadFilter = tab.dataset.filter || 'all';
                els.threadTabs.querySelectorAll('.wa-tab').forEach(x => x.classList.toggle('active', x === tab));
                renderThreads();
            });
        }
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
        if (!silent && els.threadItems) {
            els.threadItems.innerHTML = '<div style="padding:1rem;text-align:center;color:#999;font-size:0.9rem;">Caricamento…</div>';
        }
        try {
            const res  = await fetch(`${INBOX_API}?threads=1`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            threads = json.data || [];
            renderThreads();
            // Il contesto può cambiare sotto i piedi (un collega associa il
            // numero da un'altra postazione): l'intestazione va riallineata.
            if (activePhone) renderChatHeader(activePhone);
        } catch (err) {
            if (!silent && els.threadItems) {
                els.threadItems.innerHTML = `<div style="padding:1rem;color:var(--color-danger);font-size:0.85rem;">${esc(err.message)}</div>`;
            }
        }
    }

    function renderThreads() {
        if (!els.threadItems) return;

        let list = threads.slice();
        if (threadFilter === 'unread') list = list.filter(t => (parseInt(t.unread_count) || 0) > 0);
        if (threadSearch) {
            list = list.filter(t => `${t.contact_name || ''} ${t.phone || ''} ${t.last_message || ''}`.toLowerCase().includes(threadSearch));
        }

        if (!list.length) {
            const msg = !threads.length ? 'Nessuna conversazione.'
                : (threadFilter === 'unread' ? 'Nessuna conversazione non letta.' : 'Nessun risultato.');
            els.threadItems.innerHTML = `<div style="padding:1.5rem;text-align:center;color:#999;font-size:0.85rem;">${msg}</div>`;
            return;
        }

        const items = list.map(t => {
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
                    ${contextChip(t)}
                    <div class="wa-thread-preview">${esc(preview)}</div>
                </div>
                <div class="wa-thread-meta">
                    ${timeStr ? `<div class="wa-thread-time">${esc(timeStr)}</div>` : ''}
                    ${unread ? `<div class="wa-unread-badge">${unread}</div>` : ''}
                </div>
            </div>`;
        }).join('');

        els.threadItems.innerHTML = items;
        els.threadItems.querySelectorAll('.wa-thread-item').forEach(item => {
            item.addEventListener('click', () => openThread(item.dataset.phone));
        });
    }

    /**
     * Il tag di contesto sotto il nome: "Inquilino · Via Tortona 28, Milano".
     * L'etichetta arriva già composta dall'API (contact_context) — il JS decide
     * solo il colore, così lista e intestazione non possono divergere.
     */
    function contextChip(t) {
        if (t.is_unknown) {
            return '<span class="wa-thread-context wa-ctx--unknown">Non riconosciuto</span>';
        }
        if (!t.contact_context) return '';
        const cls = `wa-ctx--${t.contact_type || 'unknown'}`;
        return `<span class="wa-thread-context ${cls}" title="${esc(t.contact_context)}">${esc(t.contact_context)}</span>`;
    }

    async function openThread(phone) {
        activePhone    = phone;
        msgPage        = 1;
        msgTotalPages  = 1;
        renderThreads(); // update active highlight

        els.emptyState.style.display  = 'none';
        els.activeChat.style.display  = 'flex';
        els.loadEarlierBar.style.display = 'none';

        renderChatHeader(phone);

        await loadMessages(phone);
        await markRead(phone);
    }

    /**
     * Intestazione della chat + banner di triage. Estratta da openThread perché
     * va rieseguita anche dopo un'associazione, senza ricaricare i messaggi.
     */
    function renderChatHeader(phone) {
        const thread   = threads.find(t => t.phone === phone);
        const name     = thread?.contact_name || phone;
        const initials = name.replace(/\s+/g, '').slice(0, 2).toUpperCase();

        els.chatName.textContent   = name;
        els.chatAvatar.textContent = initials;

        // Sottotitolo: numero + ruolo/immobile. Se il contatto è ignoto resta
        // solo il numero e compare il banner con le azioni di aggancio.
        const parts = [];
        if (thread?.contact_name) parts.push(phone);
        if (thread?.contact_context) parts.push(thread.contact_context);
        els.chatSub.textContent = parts.join('  ·  ');

        els.unknownBar.style.display = thread && thread.is_unknown ? 'flex' : 'none';
    }

    /**
     * L'allegato non e' un link a Meta: quelle URL chiedono il token di accesso
     * dell'account e scadono. Il file sta nell'albero protetto e passa da
     * api/whatsapp_media.php, che lo serve solo a chi ha una sessione di staff.
     */
    function renderMedia(m) {
        if (!m.media_url) return '';
        const src  = `api/whatsapp_media.php?id=${encodeURIComponent(m.id)}`;
        const mime = m.media_mime || '';

        if (mime.startsWith('image/')) {
            return `<a class="wa-bubble-media" href="${src}" target="_blank" rel="noopener">
                <img src="${src}" alt="Allegato" loading="lazy">
            </a>`;
        }
        if (mime.startsWith('audio/')) {
            return `<audio class="wa-bubble-audio" controls preload="none" src="${src}"></audio>`;
        }
        if (mime.startsWith('video/')) {
            return `<video class="wa-bubble-media" controls preload="none" src="${src}"></video>`;
        }
        // Niente <i data-lucide> qui: le bolle vengono riscritte a ogni
        // caricamento e in questa pagina nessuno richiama createIcons(), quindi
        // l'icona resterebbe un elemento vuoto.
        return `<a class="wa-bubble-file" href="${src}" target="_blank" rel="noopener">
            ${esc(m.media_name || 'Allegato')}
        </a>`;
    }

    function renderBubbles(messages) {
        return messages.map(m => {
            const isOut = m.direction === 'outbound' || m.direction === 'sent';
            const time  = m.received_at || m.created_at;
            const text  = m.body || m.message || '';
            return `<div class="wa-bubble wa-bubble--${isOut ? 'out' : 'in'}">
                ${renderMedia(m)}
                ${text ? esc(text) : ''}
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
            btn.innerHTML = '<i data-lucide="upload"></i> Carica messaggi precedenti';
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

    // ── Triage: numero sconosciuto → lead o contatto esistente ──────────────

    function bindTriageEvents() {
        document.getElementById('wa-create-lead-btn').addEventListener('click', openLeadModal);
        document.getElementById('wa-link-contact-btn').addEventListener('click', openLinkModal);

        document.getElementById('wa-lead-close').addEventListener('click', closeLeadModal);
        document.getElementById('wa-lead-cancel').addEventListener('click', closeLeadModal);
        document.getElementById('wa-lead-save').addEventListener('click', saveLead);
        els.leadModal.addEventListener('click', e => { if (e.target === els.leadModal) closeLeadModal(); });

        document.getElementById('wa-link-close').addEventListener('click', closeLinkModal);
        document.getElementById('wa-link-cancel').addEventListener('click', closeLinkModal);
        els.linkModal.addEventListener('click', e => { if (e.target === els.linkModal) closeLinkModal(); });

        let searchTimer = null;
        els.linkSearch.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(searchContacts, 220);
        });
    }

    function openLeadModal() {
        if (!activePhone) return;
        document.getElementById('wa-lead-phone').textContent   = activePhone;
        document.getElementById('wa-lead-name').value          = '';
        document.getElementById('wa-lead-surname').value       = '';
        document.getElementById('wa-lead-notes').value         = '';
        document.getElementById('wa-lead-interest').value      = 'affitto';
        els.leadModal.hidden = false;
        document.getElementById('wa-lead-name').focus();
    }

    function closeLeadModal() { els.leadModal.hidden = true; }

    async function saveLead() {
        const name    = document.getElementById('wa-lead-name').value.trim();
        const surname = document.getElementById('wa-lead-surname').value.trim();
        if (!name || !surname) { showAlert('Nome e cognome sono obbligatori.', 'error'); return; }

        const btn = document.getElementById('wa-lead-save');
        btn.disabled = true; btn.textContent = 'Creazione…';

        try {
            const res = await fetch(`${INBOX_API}?action=create_lead`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone:         activePhone,
                    name,
                    surname,
                    interest_type: document.getElementById('wa-lead-interest').value,
                    notes:         document.getElementById('wa-lead-notes').value.trim(),
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeLeadModal();
            showAlert(`Lead "${json.data.name}" creato — ${json.data.messages_linked} messaggi collegati.`, 'success');
            await loadThreads();
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Crea lead';
        }
    }

    function openLinkModal() {
        if (!activePhone) return;
        document.getElementById('wa-link-phone').textContent = activePhone;
        els.linkSearch.value    = '';
        els.linkResults.innerHTML = '';
        els.linkModal.hidden    = false;
        els.linkSearch.focus();
    }

    function closeLinkModal() { els.linkModal.hidden = true; }

    async function searchContacts() {
        const q = els.linkSearch.value.trim();
        if (q.length < 2) { els.linkResults.innerHTML = ''; return; }

        try {
            const res  = await fetch(`${INBOX_API}?action=search_contacts&q=${encodeURIComponent(q)}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const rows = json.data || [];
            if (!rows.length) {
                els.linkResults.innerHTML = '<div style="padding:0.8rem;text-align:center;color:#999;font-size:0.82rem;">Nessun contatto trovato.</div>';
                return;
            }

            const badgeClass = { client: 'wa-ctx--client', tenant: 'wa-ctx--tenant', lead: 'wa-ctx--lead' };

            els.linkResults.innerHTML = rows.map(r => {
                const meta = [r.phone, r.detail].filter(Boolean).join(' · ');
                return `<div class="wa-contact-row" data-type="${esc(r.type)}" data-id="${esc(r.id)}">
                    <div class="wa-contact-row__main">
                        <div class="wa-contact-row__name">${esc(`${r.name} ${r.surname}`.trim())}</div>
                        ${meta ? `<div class="wa-contact-row__meta">${esc(meta)}</div>` : ''}
                    </div>
                    <span class="wa-contact-row__badge ${badgeClass[r.type] || ''}">${esc(r.role)}</span>
                </div>`;
            }).join('');

            els.linkResults.querySelectorAll('.wa-contact-row').forEach(row => {
                row.addEventListener('click', () => linkContact(row.dataset.type, row.dataset.id));
            });
        } catch (err) {
            els.linkResults.innerHTML = `<div style="padding:0.8rem;color:var(--color-danger);font-size:0.82rem;">${esc(err.message)}</div>`;
        }
    }

    async function linkContact(type, id) {
        try {
            const res = await fetch(`${INBOX_API}?action=link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: activePhone, type, id: parseInt(id, 10) }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeLinkModal();
            showAlert(`Conversazione associata — ${json.data.messages_linked} messaggi collegati.`, 'success');
            await loadThreads();
        } catch (err) {
            showAlert(err.message, 'error');
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
            // Il backend normalizza il numero prima di salvarlo ("333 1234567"
            // → "+393331234567"): aprire il thread con la stringa digitata
            // mostrerebbe una chat vuota. Si cerca per cifre finali.
            openThread(matchThreadPhone(phone) || phone);
        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Invia';
        }
    }

    /** Ritrova nel thread list il numero equivalente a quello digitato. */
    function matchThreadPhone(input) {
        const tail = (input || '').replace(/\D/g, '').slice(-9);
        if (tail.length < 6) return null;
        return threads.find(t => (t.phone || '').replace(/\D/g, '').endsWith(tail))?.phone || null;
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

    // Oggi si mostra solo l'ora, gli altri giorni anche la data: in una lista di
    // conversazioni la data di oggi e' rumore. `new Date(str)` non andava bene
    // per deciderlo — i DATETIME di MySQL arrivano con lo spazio ("2026-07-03
    // 10:30:00") e alcuni browser li rifiutano, stampando "Invalid Date".
    function formatTime(str) {
        if (!str) return '';
        if (!window.Fmt.isValid(str)) return '';
        return window.Fmt.daysFromToday(str) === 0
            ? window.Fmt.time(str)
            : window.Fmt.dayMonth(str) + ' ' + window.Fmt.time(str);
    }

    init();
})();

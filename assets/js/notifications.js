/**
 * In-app notifications — bell badge + dropdown (Phase 10)
 */
(function () {
    'use strict';

    const API = 'api/notifications.php';
    const POLL_INTERVAL = 60000;

    let items = [];
    /** Scadenze totali: puo' superare items.length (la tendina ne mostra 50). */
    let count = 0;
    /** L'ultimo aggiornamento e' fallito: quello che si vede e' vecchio. */
    let stale = false;
    /** Una sola richiesta per volta (il tick e l'apertura possono coincidere). */
    let inFlight = null;
    /** setInterval attivo, oppure null a scheda nascosta. */
    let timer = null;

    let bell, badge, dropdown, list;

    function init() {
        bell     = document.getElementById('notif-bell');
        badge    = document.getElementById('notif-badge');
        dropdown = document.getElementById('notif-dropdown');
        list     = document.getElementById('notif-list');
        if (!bell) return;

        bell.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.hidden && !dropdown.contains(e.target) && e.target !== bell) {
                dropdown.hidden = true;
            }
        });

        // Le altre schermate cambiano lo stato dei promemoria (completa,
        // annulla, riapri, elabora scaduti): senza un aggancio la campanella
        // resterebbe col conteggio vecchio fino al tick successivo, cioe' fino
        // a un minuto dopo che l'utente ha gia' evaso la scadenza.
        window.Notifications = { refresh: poll };

        // Una scheda in secondo piano non ha nessuno che la guardi: interrogare
        // il server ogni minuto per ore e' traffico speso per un badge che
        // nessuno sta leggendo. Al rientro si rilegge SUBITO, prima di
        // riavviare il giro: altrimenti il primo minuto dopo il ritorno
        // mostrerebbe la situazione di quando si e' usciti, che e' proprio il
        // difetto appena corretto per la tendina.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopPolling();
            } else {
                poll();
                startPolling();
            }
        });

        poll();
        // Se la pagina nasce in una scheda di sfondo (aperta con ctrl+click) il
        // giro non parte: lo avvia il primo ritorno in primo piano.
        if (!document.hidden) startPolling();
    }

    function startPolling() {
        if (timer) return;
        timer = setInterval(poll, POLL_INTERVAL);
    }

    function stopPolling() {
        clearInterval(timer);
        timer = null;
    }

    /**
     * Rilegge badge e lista dal server.
     *
     * Restituisce la Promise della richiesta in corso, cosi' chi la invoca puo'
     * attenderla; le chiamate sovrapposte condividono la stessa richiesta
     * invece di accavallarsi.
     */
    function poll() {
        if (inFlight) return inFlight;

        inFlight = (async () => {
            try {
                const res  = await fetch(API);
                const json = await res.json();
                // Il 401 non arriva fin qui: il fetch di app.js porta al login.
                // Restano il 500, la rete caduta e il success:false.
                if (!res.ok || !json.success) {
                    throw new Error(json.error || ('HTTP ' + res.status));
                }
                items = json.data.items || [];
                count = json.data.count || 0;
                stale = false;
                updateBadge(count);
            } catch (err) {
                // Il conteggio precedente resta esposto: un blip di rete non
                // deve far sparire scadenze vere dalla campanella. Ma non si
                // spaccia piu' per aggiornato — la tendina lo dichiara, e
                // l'errore finisce in console invece di essere ingoiato.
                stale = true;
                console.warn('[notifiche] aggiornamento non riuscito:', err.message);
            } finally {
                inFlight = null;
            }
            renderList();
        })();

        return inFlight;
    }

    function updateBadge(total) {
        if (!badge) return;
        if (total > 0) {
            badge.textContent = total > 99 ? '99+' : total;
            // "99+" da solo non si legge: il titolo porta il numero esatto.
            badge.title = total + (total === 1 ? ' scadenza' : ' scadenze');
            badge.hidden = false;
        } else {
            badge.removeAttribute('title');
            badge.hidden = true;
        }
    }

    function renderList() {
        if (!list) return;

        const notice = stale
            ? '<p class="notif-empty text-muted">Aggiornamento non riuscito: elenco non aggiornato.</p>'
            : '';

        if (items.length === 0) {
            list.innerHTML = notice || '<p class="notif-empty text-muted">Nessuna notifica.</p>';
            return;
        }
        // Il badge puo' dire 80 mentre la tendina ne elenca 50: senza questa
        // riga sembrerebbe che il conteggio sia sbagliato.
        const more = count > items.length
            ? `<p class="notif-empty text-muted">Altre ${count - items.length} in Promemoria.</p>`
            : '';

        list.innerHTML = notice + items.map(it => `
            <button type="button" class="notif-item" data-id="${it.id}"
                    data-source="${escapeHtml(it.source || 'reminder')}"
                    data-view="${escapeHtml(it.view || 'reminders')}">
                <span class="notif-item__title">${escapeHtml(it.title)}</span>
                ${it.body ? `<span class="notif-item__body">${escapeHtml(it.body)}</span>` : ''}
                <span class="notif-item__date">${formatDateTime(it.date || it.reminder_date)}</span>
            </button>
        `).join('') + more;

        list.querySelectorAll('.notif-item').forEach(btn => {
            btn.addEventListener('click', async () => {
                dropdown.hidden = true;
                // Un messaggio si legge: senza questo la campanella annuncia lo
                // stesso WhatsApp all'infinito, perche' la riga resta is_read=0.
                // Una scadenza no: si chiude evadendola, non aprendola.
                if (btn.dataset.source === 'notification') {
                    try {
                        await fetch(API + '?action=read', {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ id: Number(btn.dataset.id) }),
                        });
                    } catch (err) {
                        console.warn('[notifiche] non segnata come letta:', err.message);
                    }
                    poll();
                }
                // Ogni tipo porta dove si risponde davvero: l'Inbox per un
                // WhatsApp, le Comunicazioni per un'email. Prima andavano tutti
                // ai Promemoria, che per un messaggio in arrivo non c'entra.
                if (window.App) window.App.navigateTo(btn.dataset.view || 'reminders');
            });
        });
    }

    function toggleDropdown() {
        if (!dropdown) return;
        dropdown.hidden = !dropdown.hidden;
        if (dropdown.hidden) return;

        // Si disegna subito quello che c'e' — la tendina non deve aspettare la
        // rete per aprirsi — e insieme si rinfresca. Il tick e' di un minuto:
        // senza questo si legge un elenco vecchio fino a 60 secondi, e un
        // promemoria appena evaso altrove resta li' come se fosse ancora aperto.
        renderList();
        poll();
    }

    function formatDateTime(dateStr) { return window.Fmt.dateTime(dateStr); }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

/**
 * In-app notifications — bell badge + dropdown (Phase 10)
 */
(function () {
    'use strict';

    const API = 'api/notifications.php';
    const POLL_INTERVAL = 60000;

    let items = [];
    /** L'ultimo aggiornamento e' fallito: quello che si vede e' vecchio. */
    let stale = false;
    /** Una sola richiesta per volta (il tick e l'apertura possono coincidere). */
    let inFlight = null;

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

        poll();
        setInterval(poll, POLL_INTERVAL);
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
                stale = false;
                updateBadge(json.data.count || 0);
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

    function updateBadge(count) {
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.hidden = false;
        } else {
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
        list.innerHTML = notice + items.map(it => `
            <button type="button" class="notif-item" data-id="${it.id}">
                <span class="notif-item__title">${escapeHtml(it.title)}</span>
                <span class="notif-item__date">${formatDateTime(it.reminder_date)}</span>
            </button>
        `).join('');

        list.querySelectorAll('.notif-item').forEach(btn => {
            btn.addEventListener('click', () => {
                dropdown.hidden = true;
                if (window.App) window.App.navigateTo('reminders');
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

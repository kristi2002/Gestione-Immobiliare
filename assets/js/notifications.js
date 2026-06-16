/**
 * In-app notifications — bell badge + dropdown (Phase 10)
 */
(function () {
    'use strict';

    const API = 'api/notifications.php';
    const POLL_INTERVAL = 60000;

    let items = [];

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

        poll();
        setInterval(poll, POLL_INTERVAL);
    }

    async function poll() {
        try {
            const res  = await fetch(API);
            const json = await res.json();
            if (!json.success) return;
            items = json.data.items || [];
            updateBadge(json.data.count || 0);
            renderList();
        } catch (err) {
            // Silently ignore polling errors.
        }
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
        if (items.length === 0) {
            list.innerHTML = '<p class="notif-empty text-muted">Nessuna notifica.</p>';
            return;
        }
        list.innerHTML = items.map(it => `
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
        if (!dropdown.hidden) renderList();
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '';
        return new Date(dateStr.replace(' ', 'T')).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
    }

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

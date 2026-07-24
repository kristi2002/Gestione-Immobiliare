/**
 * Scheda Agente — per-agent profile: KPIs + leads, appointments, clients, commissions.
 * Mirrors the client_profile module pattern (param via App.viewParams, re-runs per visit).
 */

const agentId = Number(window.App?.viewParams?.agentId) || 0;

const ROLE_LABELS = { super_admin: 'Super admin', admin: 'Amministratore', agent: 'Agente' };
const LEAD_STATUS = {
    new: 'Nuovo', contacted: 'Contattato', interested: 'Interessato',
    negotiating: 'In trattativa', converted: 'Convertito', lost: 'Perso',
};
const INTEREST_LABELS = { affitto: 'Affitto', acquisto: 'Acquisto', entrambi: 'Entrambi' };
const SOURCE_LABELS = { telefono: 'Telefono', email: 'Email', web: 'Web', passaparola: 'Passaparola', social: 'Social', immobiliare: 'Immobiliare.it', idealista: 'Idealista', casa: 'Casa.it', subito: 'Subito', altro: 'Altro' };
const APPT_STATUS = { scheduled: 'Programmata', completed: 'Completata', cancelled: 'Annullata', no_show: 'Non presentato' };
const COMM_STATUS = { pending: 'Da incassare', paid: 'Incassata' };

// KPI cards. `filter` makes a card filter the leads table; `tab` switches tab.
const KPI_ITEMS = [
    { key: 'leads_total',     label: 'Lead totali',  icon: 'clipboard-list' },
    { key: 'leads_converted', label: 'Convertiti',   icon: 'check-circle' },
    { key: 'appointments',    label: 'Visite',       icon: 'calendar', tab: 'appointments' },
    { key: 'properties',      label: 'Immobili',     icon: 'building-2' },
    { key: 'keys_out',        label: 'Chiavi fuori', icon: 'key' },
    { key: 'leads_new',       label: 'Nuovi lead',   icon: 'badge-plus', filter: 'new' },
];

// --- module state -----------------------------------------------------------
let leadsCache = [];
let leadFilter = 'all'; // 'all' | a lead status (e.g. 'new')

function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}
const nfEuro0 = new Intl.NumberFormat('it-IT', { useGrouping: 'always', maximumFractionDigits: 0 });
const fmtEuro = n => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = s => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? esc(s) : d.toLocaleDateString('it-IT'); };
const fmtDateTime = s => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? esc(s) : d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); };
// Real-estate budgets: whole euros with consistent Italian grouping (force
// grouping so 4-digit values like 6.777 aren't left ungrouped by ICU).
const budget = (min, max) => {
    const f = v => '€ ' + nfEuro0.format(Math.round(Number(v)));
    if (min != null && max != null) return f(min) + ' – ' + f(max);
    if (max != null) return 'fino a ' + f(max);
    if (min != null) return 'da ' + f(min);
    return '—';
};
function startOfToday() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }

function showAlert(message, type = 'error') {
    const el = document.getElementById('ap-alert');
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert--${type}`;
    el.style.display = 'block';
}

function activateTab(name) {
    document.querySelectorAll('.agent-profile-view .profile-tab').forEach(t => {
        t.classList.toggle('profile-tab--active', t.dataset.tab === name);
    });
    document.querySelectorAll('.agent-profile-view .profile-panel').forEach(p => { p.hidden = true; });
    const panel = document.getElementById('ap-panel-' + name);
    if (panel) panel.hidden = false;
}

function init() {
    if (!agentId) {
        showAlert('Nessun agente selezionato.');
        return;
    }
    document.getElementById('btn-back-to-agents')?.addEventListener('click', () => {
        if (window.App) window.App.navigateTo('agents');
    });

    // Tabs
    document.querySelectorAll('.agent-profile-view .profile-tab').forEach(tab => {
        tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    });

    // Clear the lead filter by clicking its chip.
    document.getElementById('ap-leads-filter')?.addEventListener('click', () => {
        leadFilter = 'all';
        renderLeads();
    });

    loadHero();
    loadLeads();
    loadAppointments();
    loadClients();
    loadCommissions();
}

// A KPI card was clicked: filter the leads table or jump to a tab.
function onKpiClick(el) {
    if (el.dataset.tab) { activateTab(el.dataset.tab); return; }
    if (el.dataset.filter) {
        // Toggle: clicking the active filter again clears it.
        leadFilter = (leadFilter === el.dataset.filter) ? 'all' : el.dataset.filter;
        activateTab('leads');
        renderLeads();
    }
}

async function loadHero() {
    try {
        const res = await fetch(`api/agent_portfolio.php?agent_id=${agentId}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const d = json.data;
        const a = d.agent || {};
        document.getElementById('ap-avatar').textContent = (a.username || '?').slice(0, 2).toUpperCase();
        document.getElementById('ap-name').textContent = a.username || 'Agente';
        const roleEl = document.getElementById('ap-role-badge');
        roleEl.textContent = ROLE_LABELS[a.role] || a.role || '';
        roleEl.className = `badge badge--role-${a.role || 'agent'}`;
        document.getElementById('ap-meta').innerHTML = a.email
            ? `<a href="mailto:${esc(a.email)}"><i data-lucide="mail"></i> ${esc(a.email)}</a>` : '';
        document.getElementById('ap-conv-rate').textContent = (Number(d.conversion_rate) || 0) + '%';
        document.getElementById('ap-kpis').innerHTML = KPI_ITEMS.map(k => {
            const clickable = k.filter || k.tab;
            const attrs = [
                k.filter ? `data-filter="${k.filter}"` : '',
                k.tab ? `data-tab="${k.tab}"` : '',
                clickable ? `role="button" tabindex="0" title="${k.filter ? 'Mostra solo questi lead' : 'Vai agli appuntamenti'}"` : '',
            ].join(' ');
            return `
            <div class="db-stat ${clickable ? 'db-stat--clickable' : ''}" ${attrs}>
                <div class="db-stat__chip"><i data-lucide="${k.icon}"></i></div>
                <div class="db-stat__label">${k.label}</div>
                <div class="db-stat__value">${d[k.key] ?? 0}</div>
            </div>`;
        }).join('');
        document.querySelectorAll('#ap-kpis .db-stat--clickable').forEach(el => {
            el.addEventListener('click', () => onKpiClick(el));
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKpiClick(el); }
            });
        });
        // Reflect any active filter on the KPI cards.
        syncKpiActive();
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        showAlert(err.message);
    }
}

function syncKpiActive() {
    document.querySelectorAll('#ap-kpis .db-stat--clickable[data-filter]').forEach(el => {
        el.classList.toggle('db-stat--active', leadFilter !== 'all' && el.dataset.filter === leadFilter);
    });
}

async function loadLeads() {
    const tbody = document.getElementById('ap-leads-tbody');
    try {
        const res = await fetch(`api/leads.php?assigned_to=${agentId}&limit=200`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        leadsCache = (json.data && json.data.items) || json.data || [];
        renderLeads();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="entity-error">${esc(err.message)}</td></tr>`;
    }
}

// "Prossima azione" cell: due date + short note, coloured by urgency.
function nextActionCell(l) {
    if (!l.next_action_at) return '<span class="text-muted">—</span>';
    const d = new Date(l.next_action_at + 'T00:00:00');
    if (isNaN(d)) return esc(l.next_action_at);
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    const today = startOfToday();
    let cls = 'ap-na', tag = '';
    if (dd.getTime() < today.getTime())      { cls += ' ap-na--overdue'; tag = '<span class="ap-na__tag">in ritardo</span>'; }
    else if (dd.getTime() === today.getTime()) { cls += ' ap-na--today';   tag = '<span class="ap-na__tag">oggi</span>'; }
    const note = l.next_action ? `<div class="ap-na__note">${esc(l.next_action)}</div>` : '';
    return `<span class="${cls}">${d.toLocaleDateString('it-IT')}${tag}</span>${note}`;
}

function renderLeads() {
    const tbody = document.getElementById('ap-leads-tbody');
    const chip = document.getElementById('ap-leads-filter');
    const countEl = document.getElementById('ap-leads-count');

    let list = leadFilter === 'all' ? leadsCache.slice() : leadsCache.filter(l => l.status === leadFilter);
    // Surface urgency: soonest follow-up first, leads without a date last.
    list.sort((a, b) => {
        const an = a.next_action_at || '', bn = b.next_action_at || '';
        if (an && bn) return an < bn ? -1 : an > bn ? 1 : 0;
        if (an) return -1;
        if (bn) return 1;
        return 0;
    });

    countEl.textContent = `${list.length} lead`;
    if (leadFilter !== 'all') {
        chip.hidden = false;
        chip.textContent = `Filtro: ${LEAD_STATUS[leadFilter] || leadFilter}`;
    } else {
        chip.hidden = true;
    }
    syncKpiActive();

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-muted">${leadFilter !== 'all' ? 'Nessun lead per questo filtro.' : 'Nessun lead assegnato.'}</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(l => `
        <tr>
            <td><strong>${esc(l.surname)} ${esc(l.name)}</strong></td>
            <td>${INTEREST_LABELS[l.interest_type] || esc(l.interest_type)}</td>
            <td>${budget(l.budget_min, l.budget_max)}</td>
            <td><span class="badge badge--lead-${esc(l.status)}">${LEAD_STATUS[l.status] || esc(l.status)}</span></td>
            <td>${nextActionCell(l)}</td>
            <td>${SOURCE_LABELS[l.source] || esc(l.source)}</td>
            <td><button class="btn btn--sm btn--ghost ap-open-lead" data-id="${l.id}">Apri</button></td>
        </tr>`).join('');
    tbody.querySelectorAll('.ap-open-lead').forEach(b => b.addEventListener('click', () => {
        window.App?.navigateTo('lead_edit', { leadId: Number(b.dataset.id) });
    }));
}

// --- Appuntamenti: today front and centre, then upcoming, past collapsed ----
function apptRow(a, isToday) {
    return `
        <tr class="${isToday ? 'ap-appt-row--today' : ''}">
            <td>${fmtDateTime(a.appointment_date)}</td>
            <td>${esc(a.property_address || a.address || '—')}${a.property_city || a.city ? ', ' + esc(a.property_city || a.city) : ''}</td>
            <td>${a.duration_minutes || 60} min</td>
            <td><span class="badge">${APPT_STATUS[a.status] || esc(a.status)}</span></td>
            <td class="text-muted">${esc(a.notes || '')}</td>
        </tr>`;
}
function apptTable(list, isToday) {
    return `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Data</th><th>Immobile</th><th>Durata</th><th>Stato</th><th>Note</th></tr></thead>
        <tbody>${list.map(a => apptRow(a, isToday)).join('')}</tbody>
    </table></div>`;
}
function apptGroup(kind, title, list, isToday, emptyText) {
    const inner = list.length ? apptTable(list, isToday) : `<div class="ap-appt-empty">${emptyText}</div>`;
    return `<div class="ap-appt-group ap-appt-group--${kind}">
        <h4 class="ap-appt-group__title">${title} <span class="ap-appt-group__count">(${list.length})</span></h4>
        ${inner}
    </div>`;
}

async function loadAppointments() {
    const body = document.getElementById('ap-appts-body');
    try {
        const res = await fetch(`api/appointments.php?agent_id=${agentId}&limit=200`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const items = (json.data && json.data.items) || json.data || [];
        const today = startOfToday();
        const todays = [], upcoming = [], past = [];
        items.forEach(a => {
            const d = new Date((a.appointment_date || '').replace(' ', 'T'));
            if (isNaN(d)) { past.push(a); return; }
            const dd = new Date(d); dd.setHours(0, 0, 0, 0);
            const t = dd.getTime();
            if (t === today.getTime()) todays.push(a);
            else if (t > today.getTime()) upcoming.push(a);
            else past.push(a);
        });
        past.reverse(); // most recent past first

        document.getElementById('ap-appts-count').textContent =
            `Oggi: ${todays.length} · Prossimi: ${upcoming.length} · Totale: ${items.length}`;

        if (!items.length) { body.innerHTML = '<div class="ap-appt-empty">Nessun appuntamento.</div>'; return; }

        let html = apptGroup('today', 'Oggi', todays, true, 'Nessun appuntamento in programma oggi.');
        if (upcoming.length) html += apptGroup('upcoming', 'Prossimi', upcoming, false, '');
        if (past.length) {
            html += `<details class="ap-appt-past"><summary>Passati (${past.length})</summary>${apptTable(past, false)}</details>`;
        }
        body.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        body.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

async function loadClients() {
    const grid = document.getElementById('ap-clients-grid');
    try {
        const res = await fetch(`api/clients.php?assigned_agent_id=${agentId}&limit=200`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const items = (json.data && json.data.items) || json.data || [];
        document.getElementById('ap-clients-count').textContent = `${items.length} clienti`;
        if (!items.length) { grid.innerHTML = '<div class="entity-empty">Nessun cliente assegnato.</div>'; return; }
        grid.innerHTML = items.map(c => {
            const initials = (((c.name || '').charAt(0)) + ((c.surname || '').charAt(0))).toUpperCase() || '?';
            return `
            <div class="entity-card entity-card--clickable" data-id="${c.id}" style="cursor:pointer">
                <div class="entity-card__header">
                    <div class="entity-card__avatar">${esc(initials)}</div>
                    <div class="entity-card__title-group">
                        <div class="entity-card__name">${esc(c.surname)} ${esc(c.name)}</div>
                    </div>
                </div>
                <div class="entity-card__body">
                    ${c.email ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="mail"></i></span> ${esc(c.email)}</div>` : ''}
                    ${c.phone ? `<div class="entity-card__info"><span class="entity-card__info-icon"><i data-lucide="phone"></i></span> ${esc(c.phone)}</div>` : ''}
                    ${!c.email && !c.phone ? '<div class="entity-card__info text-muted">Nessun contatto registrato</div>' : ''}
                </div>
            </div>`;
        }).join('');
        grid.querySelectorAll('.entity-card').forEach(card => card.addEventListener('click', () => {
            window.App?.navigateTo('client_profile', { clientId: Number(card.dataset.id) });
        }));
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        grid.innerHTML = `<div class="entity-error">${esc(err.message)}</div>`;
    }
}

async function loadCommissions() {
    const tbody = document.getElementById('ap-comm-tbody');
    try {
        const res = await fetch(`api/commissions.php?admin_user_id=${agentId}&limit=200`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const items = (json.data && json.data.items) || json.data || [];
        document.getElementById('ap-comm-count').textContent = `${items.length} provvigioni`;
        const paid    = items.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount || 0), 0);
        const pending = items.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.amount || 0), 0);
        document.getElementById('ap-comm-totals').innerHTML =
            `<span class="badge badge--lead-converted">Incassate: ${fmtEuro(paid)}</span> ` +
            `<span class="badge badge--lead-contacted">Da incassare: ${fmtEuro(pending)}</span>`;
        if (!items.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Nessuna provvigione registrata.</td></tr>'; return; }
        tbody.innerHTML = items.map(c => `
            <tr>
                <td>${esc(c.property_address || '—')}</td>
                <td>${esc(c.commission_type || '—')}</td>
                <td><strong>${fmtEuro(c.amount)}</strong></td>
                <td>${fmtDate(c.due_date)}</td>
                <td><span class="badge badge--lead-${c.status === 'paid' ? 'converted' : 'contacted'}">${COMM_STATUS[c.status] || esc(c.status)}</span></td>
            </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="entity-error">${esc(err.message)}</td></tr>`;
    }
}

init();

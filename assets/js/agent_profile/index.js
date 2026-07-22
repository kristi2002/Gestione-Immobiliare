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
const SOURCE_LABELS = { telefono: 'Telefono', email: 'Email', web: 'Web', passaparola: 'Passaparola', social: 'Social', altro: 'Altro' };
const APPT_STATUS = { scheduled: 'Programmata', completed: 'Completata', cancelled: 'Annullata', no_show: 'Non presentato' };
const COMM_STATUS = { pending: 'Da incassare', paid: 'Incassata' };

const KPI_ITEMS = [
    { key: 'leads_total',     label: 'Lead totali',  icon: 'clipboard-list' },
    { key: 'leads_converted', label: 'Convertiti',   icon: 'check-circle' },
    { key: 'appointments',    label: 'Visite',       icon: 'calendar' },
    { key: 'properties',      label: 'Immobili',     icon: 'building-2' },
    { key: 'keys_out',        label: 'Chiavi fuori', icon: 'key' },
    { key: 'leads_new',       label: 'Nuovi lead',   icon: 'badge-plus' },
];

function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}
const fmtEuro = n => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = s => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? esc(s) : d.toLocaleDateString('it-IT'); };
const fmtDateTime = s => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? esc(s) : d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); };
const budget = (min, max) => {
    const f = v => '€ ' + Number(v).toLocaleString('it-IT');
    if (min != null && max != null) return f(min) + ' – ' + f(max);
    if (max != null) return 'fino a ' + f(max);
    if (min != null) return 'da ' + f(min);
    return '—';
};

function showAlert(message, type = 'error') {
    const el = document.getElementById('ap-alert');
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert--${type}`;
    el.style.display = 'block';
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
        tab.addEventListener('click', () => {
            document.querySelectorAll('.agent-profile-view .profile-tab').forEach(t => t.classList.remove('profile-tab--active'));
            tab.classList.add('profile-tab--active');
            document.querySelectorAll('.agent-profile-view .profile-panel').forEach(p => { p.hidden = true; });
            const panel = document.getElementById('ap-panel-' + tab.dataset.tab);
            if (panel) panel.hidden = false;
        });
    });

    loadHero();
    loadLeads();
    loadAppointments();
    loadClients();
    loadCommissions();
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
        document.getElementById('ap-kpis').innerHTML = KPI_ITEMS.map(k => `
            <div class="db-stat">
                <div class="db-stat__chip"><i data-lucide="${k.icon}"></i></div>
                <div class="db-stat__label">${k.label}</div>
                <div class="db-stat__value">${d[k.key] ?? 0}</div>
            </div>`).join('');
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        showAlert(err.message);
    }
}

async function loadLeads() {
    const tbody = document.getElementById('ap-leads-tbody');
    try {
        const res = await fetch(`api/leads.php?assigned_to=${agentId}&limit=200`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const items = (json.data && json.data.items) || json.data || [];
        document.getElementById('ap-leads-count').textContent = `${items.length} lead`;
        if (!items.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Nessun lead assegnato.</td></tr>'; return; }
        tbody.innerHTML = items.map(l => `
            <tr>
                <td><strong>${esc(l.surname)} ${esc(l.name)}</strong></td>
                <td>${INTEREST_LABELS[l.interest_type] || esc(l.interest_type)}</td>
                <td>${budget(l.budget_min, l.budget_max)}</td>
                <td><span class="badge badge--lead-${esc(l.status)}">${LEAD_STATUS[l.status] || esc(l.status)}</span></td>
                <td>${SOURCE_LABELS[l.source] || esc(l.source)}</td>
                <td><button class="btn btn--sm btn--ghost ap-open-lead" data-id="${l.id}">Apri</button></td>
            </tr>`).join('');
        tbody.querySelectorAll('.ap-open-lead').forEach(b => b.addEventListener('click', () => {
            window.App?.navigateTo('lead_edit', { leadId: Number(b.dataset.id) });
        }));
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="entity-error">${esc(err.message)}</td></tr>`;
    }
}

async function loadAppointments() {
    const tbody = document.getElementById('ap-appts-tbody');
    try {
        const res = await fetch(`api/appointments.php?agent_id=${agentId}&limit=200`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const items = (json.data && json.data.items) || json.data || [];
        document.getElementById('ap-appts-count').textContent = `${items.length} appuntamenti`;
        if (!items.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Nessun appuntamento.</td></tr>'; return; }
        tbody.innerHTML = items.map(a => `
            <tr>
                <td>${fmtDateTime(a.appointment_date)}</td>
                <td>${esc(a.property_address || a.address || '—')}${a.property_city || a.city ? ', ' + esc(a.property_city || a.city) : ''}</td>
                <td>${a.duration_minutes || 60} min</td>
                <td><span class="badge">${APPT_STATUS[a.status] || esc(a.status)}</span></td>
                <td class="text-muted">${esc(a.notes || '')}</td>
            </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="entity-error">${esc(err.message)}</td></tr>`;
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
        grid.innerHTML = items.map(c => `
            <div class="entity-card" data-id="${c.id}" style="cursor:pointer">
                <div class="entity-card__name"><strong>${esc(c.surname)} ${esc(c.name)}</strong></div>
                ${c.email ? `<div class="entity-card__info"><i data-lucide="mail"></i> ${esc(c.email)}</div>` : ''}
                ${c.phone ? `<div class="entity-card__info"><i data-lucide="phone"></i> ${esc(c.phone)}</div>` : ''}
            </div>`).join('');
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

import { API, USERS_API, LOGO_API, EMAIL_TPL_API, BACKUP_API, USERS_PAGE_LIMIT, EMAIL_TPLS_PAGE_LIMIT } from './constants.js';

// Sta qui e non in constants.js: solo lo script d'ingresso viene caricato con
// `?t=` (app.js), i moduli importati restano in cache un anno (.htaccess). Un
// export nuovo in un sotto-modulo romperebbe la pagina a chi ha la versione
// vecchia in cache.
const ISTAT_API = 'api/istat_index.php';
import { esc } from './helpers.js';

let settings = null;
let isSuperAdmin = false;
let usersPage = 1;
let emailTplsPage = 1;

// setting_key → id dell'input, per riportare l'errore del server SOTTO il campo
// che lo ha causato invece che in un unico messaggio generico.
const FIELD_IDS = {
    agency_name: 'set-agency-name',
    agency_tagline: 'set-agency-tagline',
    agency_phone: 'set-agency-phone',
    agency_address: 'set-agency-address',
    primary_color: 'set-primary-color',
    sidebar_color: 'set-sidebar-color',
    mail_enabled: 'set-mail-enabled',
    agency_email: 'set-agency-email',
    smtp_host: 'set-smtp-host',
    smtp_port: 'set-smtp-port',
    smtp_user: 'set-smtp-user',
    smtp_pass: 'set-smtp-pass',
    smtp_secure: 'set-smtp-secure',
    mailgun_webhook_key: 'set-mailgun-webhook-key',
    whatsapp_enabled: 'set-wa-enabled',
    meta_wa_phone_number_id: 'set-wa-phone-id',
    meta_wa_access_token: 'set-wa-token',
    meta_wa_app_secret: 'set-wa-app-secret',
    meta_wa_verify_token: 'set-wa-verify-token',
    whatsapp_from: 'set-wa-from',
    backup_cloud_enabled: 'set-backup-enabled',
    backup_s3_endpoint: 'set-s3-endpoint',
    backup_s3_bucket: 'set-s3-bucket',
    backup_s3_region: 'set-s3-region',
    backup_s3_key: 'set-s3-key',
    backup_s3_secret: 'set-s3-secret',
    backup_s3_prefix: 'set-s3-prefix',
    meta_app_id: 'set-meta-app-id',
    meta_app_secret: 'set-meta-app-secret',
    agency_denominazione: 'set-fp-denominazione',
    agency_regime_fiscale: 'set-fp-regime',
    agency_piva: 'set-fp-piva',
    agency_cf: 'set-fp-cf',
    agency_indirizzo: 'set-fp-indirizzo',
    agency_pec: 'set-fp-pec',
    agency_cap: 'set-fp-cap',
    agency_comune: 'set-fp-comune',
    agency_provincia: 'set-fp-provincia',
    agency_iban: 'set-fp-iban',
    agency_sepa_creditor_id: 'set-fp-creditor-id',
};

// Sezione dell'API → riquadro di esito. Il modulo Mailgun salva la stessa
// sezione 'mail' ma ha un pulsante suo, quindi un riquadro suo.
const SECTION_FEEDBACK = {
    branding: 'branding', mail: 'mail', mailgun: 'mailgun',
    whatsapp: 'whatsapp', backup: 'backup', meta: 'meta', fatturazione: 'fatturazione',
};

init();

// I `bind*` PRIMA del caricamento: se la GET fallisce (sessione scaduta, errore
// PHP che risponde HTML) l'eccezione fermava init() a metà e la pagina restava
// muta — pulsanti che non fanno niente e nessun messaggio.
function init() {
    bindTabs();
    bindForms();
    bindUsers();
    bindEmailTemplates();
    bindIstat();

    const base = window.location.origin + window.location.pathname.replace(/index\.php.*/, '');
    document.getElementById('meta-redirect-uri').textContent = base + 'meta_callback.php';

    loadSettings().catch(err => showAlert('Impossibile caricare le impostazioni: ' + err.message, 'error'));
}

function bindTabs() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('settings-tab--active'));
            tab.classList.add('settings-tab--active');
            document.querySelectorAll('.settings-panel').forEach(p => p.hidden = true);
            document.getElementById('panel-' + tab.dataset.tab).hidden = false;
            if (tab.dataset.tab === 'sistema') loadReadiness();
            if (tab.dataset.tab === 'email-templates') loadEmailTemplates();
            if (tab.dataset.tab === 'istat') loadIstat();
        });
    });
}

async function loadSettings() {
    const json = await request(API);
    if (!json.success) return showAlert(json.error, 'error');
    applySettings(json.data);

    try {
        const uRes = await fetch(USERS_API);
        if (uRes.ok) {
            isSuperAdmin = true;
            document.getElementById('tab-users').style.display = '';
            await loadUsers();
        }
    } catch (_) {}
}

// Un salvataggio riscrive i campi con quello che il server ha DAVVERO memorizzato:
// normalizzazioni (IBAN senza spazi, provincia in maiuscolo, prefisso con lo
// slash finale) e stato dei segreti diventano così visibili subito.
function applySettings(data) {
    settings = data;
    if (data.branding)     fillBranding(data.branding);
    if (data.mail)         fillMail(data.mail);
    if (data.whatsapp)     fillWhatsApp(data.whatsapp);
    if (data.backup)       fillBackup(data.backup);
    if (data.meta)         fillMeta(data.meta);
    if (data.fatturazione) fillFatturazione(data.fatturazione);
}

// Una risposta non-JSON (fatal PHP, redirect al login) qui diventa un errore
// leggibile invece di un "Unexpected token <" nella console.
async function request(url, options = {}) {
    const res  = await fetch(url, options);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error(`risposta non valida dal server (HTTP ${res.status}).`);
    }
}

/**
 * Un segreto non torna mai al browser: la pagina mostra solo se è impostato e
 * le sue ultime cifre. "rimuovi" è l'unico modo per cancellarlo — un campo
 * lasciato vuoto significa "non toccarlo", non "svuotalo".
 */
function fillSecret(key, section, data, feedbackKey = section) {
    const input = document.getElementById(FIELD_IDS[key]);
    const state = document.getElementById('state-' + key);
    if (input) input.value = '';
    if (!state) return;

    state.textContent = '';
    if (data[key + '_set']) {
        state.append(`Impostato (${data[key + '_hint'] || '••••'}). Lascia vuoto per non modificarlo.`);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secret-state__clear';
        btn.textContent = 'rimuovi';
        btn.addEventListener('click', () => clearSecret(key, section, feedbackKey));
        state.append(btn);
    } else {
        state.append('Non impostato.');
    }
}

async function clearSecret(key, section, feedbackKey) {
    if (!await confirmDialog('Rimuovere il valore memorizzato? La funzione che lo usa smetterà di funzionare.', { title: 'Rimuovi segreto' })) return;
    try {
        const json = await request(API, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, [key + '_clear']: true }),
        });
        if (!json.success) return showSectionFeedback(feedbackKey, json.error || 'Errore', 'error');
        applySettings(json.data);
        showSectionFeedback(feedbackKey, 'Valore rimosso.', 'success');
    } catch (err) {
        showSectionFeedback(feedbackKey, err.message, 'error');
    }
}

function fillBranding(b) {
    document.getElementById('set-agency-name').value = b.agency_name || '';
    document.getElementById('set-agency-tagline').value = b.agency_tagline || '';
    document.getElementById('set-agency-phone').value = b.agency_phone || '';
    document.getElementById('set-agency-address').value = b.agency_address || '';
    document.getElementById('set-primary-color').value = b.primary_color || '#2563eb';
    document.getElementById('set-sidebar-color').value = b.sidebar_color || '#1e293b';
    if (b.logo_path) {
        const img = document.getElementById('set-logo-preview');
        img.src = b.logo_path;
        img.style.display = 'block';
    }
}

function fillMail(m) {
    document.getElementById('set-mail-enabled').checked = !!m.mail_enabled;
    document.getElementById('set-agency-email').value = m.agency_email || '';
    document.getElementById('set-smtp-host').value = m.smtp_host || '';
    document.getElementById('set-smtp-port').value = m.smtp_port || 587;
    document.getElementById('set-smtp-user').value = m.smtp_user || '';
    // `?? 'tls'` e non `|| 'tls'`: la stringa vuota è la scelta "Nessuna", non
    // un valore mancante — con `||` l'opzione era impossibile da selezionare.
    document.getElementById('set-smtp-secure').value = m.smtp_secure ?? 'tls';
    fillSecret('smtp_pass', 'mail', m);
    fillSecret('mailgun_webhook_key', 'mail', m, 'mailgun');
    updateMailHint(!!m.mail_enabled);

    // Show the webhook URL so the user can copy it into Mailgun
    const urlEl = document.getElementById('mailgun-webhook-url');
    if (urlEl && !urlEl.dataset.bound) {
        urlEl.dataset.bound = '1';
        const base = window.location.origin + window.location.pathname.replace(/index\.php.*/, '');
        const webhookUrl = base + 'api/email_inbound.php';
        urlEl.textContent = webhookUrl;
        urlEl.addEventListener('click', () => {
            navigator.clipboard.writeText(webhookUrl).then(() => showAlert('URL copiato!', 'success'));
        });
    }
}

function updateMailHint(enabled) {
    const hint = document.getElementById('mail-disabled-hint');
    if (hint) hint.hidden = enabled;
}

function fillWhatsApp(w) {
    document.getElementById('set-wa-enabled').checked = !!w.whatsapp_enabled;
    document.getElementById('set-wa-phone-id').value = w.meta_wa_phone_number_id || '';
    document.getElementById('set-wa-from').value = w.whatsapp_from || '';
    fillSecret('meta_wa_access_token', 'whatsapp', w);
    fillSecret('meta_wa_app_secret', 'whatsapp', w);
    fillSecret('meta_wa_verify_token', 'whatsapp', w);
}

function fillBackup(b) {
    document.getElementById('set-backup-enabled').checked = !!b.backup_cloud_enabled;
    document.getElementById('set-s3-endpoint').value = b.backup_s3_endpoint || '';
    document.getElementById('set-s3-bucket').value = b.backup_s3_bucket || '';
    document.getElementById('set-s3-region').value = b.backup_s3_region || 'eu-central-1';
    document.getElementById('set-s3-key').value = b.backup_s3_key || '';
    document.getElementById('set-s3-prefix').value = b.backup_s3_prefix || 'gestionale-backups/';
    fillSecret('backup_s3_secret', 'backup', b);
}

function fillMeta(m) {
    document.getElementById('set-meta-app-id').value = m.meta_app_id || '';
    fillSecret('meta_app_secret', 'meta', m);
}

function fillFatturazione(f) {
    if (!f) return;
    document.getElementById('set-fp-denominazione').value = f.agency_denominazione || '';
    document.getElementById('set-fp-regime').value = f.agency_regime_fiscale || 'RF01';
    document.getElementById('set-fp-piva').value = f.agency_piva || '';
    document.getElementById('set-fp-cf').value = f.agency_cf || '';
    document.getElementById('set-fp-indirizzo').value = f.agency_indirizzo || '';
    document.getElementById('set-fp-pec').value = f.agency_pec || '';
    document.getElementById('set-fp-cap').value = f.agency_cap || '';
    document.getElementById('set-fp-comune').value = f.agency_comune || '';
    document.getElementById('set-fp-provincia').value = f.agency_provincia || '';
    if (document.getElementById('set-fp-iban')) document.getElementById('set-fp-iban').value = f.agency_iban || '';
    if (document.getElementById('set-fp-creditor-id')) document.getElementById('set-fp-creditor-id').value = f.agency_sepa_creditor_id || '';
}

function bindForms() {
    document.getElementById('form-branding').addEventListener('submit', e => saveSection(e, 'branding', collectBranding));
    document.getElementById('form-mail').addEventListener('submit', e => saveSection(e, 'mail', collectMail));
    document.getElementById('form-mailgun').addEventListener('submit', e => saveSection(e, 'mail', collectMailgun, 'mailgun'));
    document.getElementById('form-whatsapp').addEventListener('submit', e => saveSection(e, 'whatsapp', collectWhatsApp));
    document.getElementById('form-backup').addEventListener('submit', e => saveSection(e, 'backup', collectBackup));
    document.getElementById('form-meta').addEventListener('submit', e => saveSection(e, 'meta', collectMeta));
    document.getElementById('form-fatturazione').addEventListener('submit', e => saveSection(e, 'fatturazione', collectFatturazione));
    document.getElementById('btn-readiness-refresh')?.addEventListener('click', loadReadiness);
    document.getElementById('btn-test-email').addEventListener('click', testEmail);
    document.getElementById('set-logo-file').addEventListener('change', uploadLogo);
    document.getElementById('btn-backup-now').addEventListener('click', triggerBackup);
    document.getElementById('set-mail-enabled').addEventListener('change', e => updateMailHint(e.target.checked));
}

function collectBranding() {
    return {
        agency_name: document.getElementById('set-agency-name').value,
        agency_tagline: document.getElementById('set-agency-tagline').value,
        agency_phone: document.getElementById('set-agency-phone').value,
        agency_address: document.getElementById('set-agency-address').value,
        primary_color: document.getElementById('set-primary-color').value,
        sidebar_color: document.getElementById('set-sidebar-color').value,
    };
}

function collectMail() {
    return {
        mail_enabled:         document.getElementById('set-mail-enabled').checked,
        agency_email:         document.getElementById('set-agency-email').value,
        smtp_host:            document.getElementById('set-smtp-host').value,
        smtp_port:            document.getElementById('set-smtp-port').value,
        smtp_user:            document.getElementById('set-smtp-user').value,
        smtp_secure:          document.getElementById('set-smtp-secure').value,
        // Vuoto = invariata. Per cancellarla c'è "rimuovi" accanto al campo.
        smtp_pass:            document.getElementById('set-smtp-pass').value,
    };
}

function collectMailgun() {
    return {
        mailgun_webhook_key: document.getElementById('set-mailgun-webhook-key').value,
    };
}

function collectWhatsApp() {
    return {
        whatsapp_enabled: document.getElementById('set-wa-enabled').checked,
        meta_wa_phone_number_id: document.getElementById('set-wa-phone-id').value,
        meta_wa_access_token: document.getElementById('set-wa-token').value,
        meta_wa_app_secret: document.getElementById('set-wa-app-secret').value,
        meta_wa_verify_token: document.getElementById('set-wa-verify-token').value,
        whatsapp_from: document.getElementById('set-wa-from').value,
    };
}

function collectBackup() {
    return {
        backup_cloud_enabled: document.getElementById('set-backup-enabled').checked,
        backup_s3_endpoint: document.getElementById('set-s3-endpoint').value,
        backup_s3_bucket: document.getElementById('set-s3-bucket').value,
        backup_s3_region: document.getElementById('set-s3-region').value,
        backup_s3_key: document.getElementById('set-s3-key').value,
        backup_s3_secret: document.getElementById('set-s3-secret').value,
        backup_s3_prefix: document.getElementById('set-s3-prefix').value,
    };
}

async function loadReadiness() {
    const listEl = document.getElementById('readiness-list');
    const overallEl = document.getElementById('readiness-overall');
    if (!listEl) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
    listEl.innerHTML = '<p class="text-muted">Caricamento…</p>';
    overallEl.innerHTML = '';
    try {
        const res = await fetch('api/readiness.php');
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Errore');
        const icon = { ok: '🟢', warn: '🟡', fail: '🔴' };
        const overallLabel = { ok: 'Pronto', warn: 'Pronto con avvisi', fail: 'Blocchi da risolvere' };
        const oBadge = { ok: 'badge--success', warn: 'badge--warning', fail: 'badge--danger' }[json.overall] || 'badge';
        overallEl.innerHTML = `<span class="badge ${oBadge}" style="font-size:14px;">${icon[json.overall] || ''} ${esc(overallLabel[json.overall] || json.overall)}</span>
            <span class="text-muted" style="margin-left:8px;font-size:12px;">ambiente: ${esc(json.env)} · ${esc((json.checked_at||'').replace('T',' ').substring(0,16))}</span>`;
        const labels = {
            db_user:'Utente database', migrations:'Migrazioni', uploads:'Sicurezza upload',
            setup:'Setup', debug:'Debug', cron_secret:'Segreto cron', email:'Email (SMTP)',
            webhooks:'Firme webhook', cron:'Esecuzione cron', backup:'Backup',
        };
        listEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;">' +
            Object.entries(json.checks).map(([k, c]) =>
                `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;">
                    <span style="font-size:14px;line-height:1.4;">${icon[c.status] || '•'}</span>
                    <div><strong>${esc(labels[k] || k)}</strong><br><span class="text-muted" style="font-size:13px;">${esc(c.message)}</span></div>
                 </div>`).join('') + '</div>';
    } catch (err) {
        listEl.innerHTML = `<p style="color:var(--color-danger);">${esc(err.message)}</p>`;
    }
}

function collectFatturazione() {
    return {
        agency_denominazione:  document.getElementById('set-fp-denominazione').value,
        agency_regime_fiscale: document.getElementById('set-fp-regime').value,
        agency_piva:           document.getElementById('set-fp-piva').value,
        agency_cf:             document.getElementById('set-fp-cf').value,
        agency_indirizzo:      document.getElementById('set-fp-indirizzo').value,
        agency_pec:            document.getElementById('set-fp-pec').value,
        agency_cap:            document.getElementById('set-fp-cap').value,
        agency_comune:         document.getElementById('set-fp-comune').value,
        agency_provincia:      document.getElementById('set-fp-provincia').value,
        agency_iban:           document.getElementById('set-fp-iban') ? document.getElementById('set-fp-iban').value : '',
        agency_sepa_creditor_id: document.getElementById('set-fp-creditor-id') ? document.getElementById('set-fp-creditor-id').value : '',
    };
}

function collectMeta() {
    return {
        meta_app_id: document.getElementById('set-meta-app-id').value,
        meta_app_secret: document.getElementById('set-meta-app-secret').value,
    };
}

async function saveSection(e, section, collector, feedbackKey = section) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    clearFieldErrors(e.target);

    try {
        const json = await request(API, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, ...collector() }),
        });

        if (json.success) {
            applySettings(json.data);
            reloadBranding();
            showSectionFeedback(feedbackKey, 'Impostazioni salvate.', 'success');
            return;
        }

        // 422 → il server dice QUALE campo è sbagliato: l'errore va lì sotto.
        if (json.fields) {
            showFieldErrors(json.fields);
            showSectionFeedback(feedbackKey, json.error || 'Controlla i campi evidenziati.', 'error');
            return;
        }
        showSectionFeedback(feedbackKey, json.error || 'Errore', 'error');
    } catch (err) {
        showSectionFeedback(feedbackKey, err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function clearFieldErrors(scope) {
    (scope || document).querySelectorAll('.field-error').forEach(el => el.remove());
    (scope || document).querySelectorAll('.form-input--invalid').forEach(el => el.classList.remove('form-input--invalid'));
}

function showFieldErrors(fields) {
    let first = null;
    Object.entries(fields).forEach(([key, message]) => {
        const input = document.getElementById(FIELD_IDS[key] || '');
        if (!input) return;
        input.classList.add('form-input--invalid');
        const hint = document.createElement('small');
        hint.className = 'field-error';
        hint.textContent = message;
        (input.parentElement || input).appendChild(hint);
        if (!first) first = input;
    });
    if (first) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        first.focus({ preventScroll: true });
    }
}

// Il CSS dei colori è generato da PHP: dopo un salvataggio va richiesto di
// nuovo, e il nome/logo in sidebar vanno aggiornati a mano — sono stampati dal
// server al primo caricamento e non si ridisegnano da soli.
function reloadBranding() {
    document.querySelector('link[href^="branding.css.php"]')?.remove();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'branding.css.php?' + Date.now();
    document.head.appendChild(link);

    const b = settings?.branding;
    if (!b) return;
    const name = document.querySelector('.sb-brand__name');
    if (name && b.agency_tagline) name.textContent = b.agency_tagline;
    const eyebrow = document.querySelector('.sb-brand__eyebrow');
    if (eyebrow && b.agency_name) eyebrow.textContent = b.agency_name;
    const brandLink = document.querySelector('.sb-brand');
    if (brandLink && b.agency_name) brandLink.title = b.agency_name;
    const logo = document.querySelector('.sb-brand__logo');
    if (logo && b.logo_path) logo.src = b.logo_path + '?' + Date.now();
}

/**
 * Prova la configurazione che l'utente ha DAVANTI, non quella già salvata:
 * cambiare host e premere "Invia test" prima interrogava ancora il vecchio
 * server. La password, se il campo è vuoto, la riusa il server da quella
 * memorizzata.
 *
 * Mittente e destinatario sono due cose diverse: il mittente deve stare sul
 * dominio autorizzato dal server SMTP (un `noreply@` che non è una casella
 * vera va benissimo), ma il test finiva proprio lì e non lo leggeva nessuno.
 * Il destinatario ha quindi un campo suo, e ripiega sull'email agenzia.
 */
async function testEmail() {
    const btn = document.getElementById('btn-test-email');
    const email = document.getElementById('set-test-email').value.trim()
        || document.getElementById('set-agency-email').value;
    btn.disabled = true;
    try {
        const json = await request(API + '?test_email=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, config: collectMail() }),
        });
        if (!json.success) return showSectionFeedback('mail', json.error, 'error');
        // Invio simulato = niente è partito: non va annunciato come successo.
        showSectionFeedback('mail', json.data.message, json.data.simulated ? 'info' : 'success');
    } catch (err) {
        showSectionFeedback('mail', err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function uploadLogo() {
    const input = document.getElementById('set-logo-file');
    const file = input.files[0];
    if (!file) return;
    try {
        const fd = new FormData();
        fd.append('logo', file);
        const json = await request(LOGO_API, { method: 'POST', body: fd });
        if (!json.success) {
            input.value = '';
            return showSectionFeedback('branding', json.error, 'error');
        }
        const img = document.getElementById('set-logo-preview');
        img.src = json.data.logo_path + '?' + Date.now();
        img.style.display = 'block';
        if (settings?.branding) settings.branding.logo_path = json.data.logo_path;
        reloadBranding();
        showSectionFeedback('branding', 'Logo caricato.', 'success');
    } catch (err) {
        showSectionFeedback('branding', err.message, 'error');
    }
}

function bindUsers() {
    document.getElementById('btn-new-user')?.addEventListener('click', () => openUserModal());
    document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
    document.getElementById('user-modal-cancel').addEventListener('click', closeUserModal);
    document.getElementById('user-form').addEventListener('submit', saveUser);
}

async function loadUsers() {
    const params = new URLSearchParams({ page: usersPage, limit: USERS_PAGE_LIMIT });
    const res = await fetch(`${USERS_API}?${params}`);
    const json = await res.json();
    if (!json.success) return;
    const parsed = Pagination.parseResponse(json);
    const users = parsed.items;
    const tbody = document.getElementById('users-tbody');
    // Attiva/disattiva ed elimina esistevano nell'API ma non nella pagina: la
    // colonna "Stato" mostrava un valore che nessuno poteva cambiare.
    tbody.innerHTML = users.map(u => `
        <tr>
            <td data-label="Username">${esc(u.username)}</td>
            <td data-label="Email">${esc(u.email || '—')}</td>
            <td data-label="Ruolo"><span class="badge">${esc(u.role)}</span></td>
            <td data-label="Stato">${u.is_active ? 'Attivo' : '<span class="text-muted">Disattivo</span>'}</td>
            <td class="col-actions" data-label="Azioni">
                <button class="btn btn--sm btn--ghost" data-edit-user="${u.id}" title="Modifica"><i data-lucide="pencil"></i></button>
                <button class="btn btn--sm btn--ghost" data-toggle-user="${u.id}" title="${u.is_active ? 'Disattiva' : 'Riattiva'}"><i data-lucide="${u.is_active ? 'user-x' : 'user-check'}"></i></button>
                <button class="btn btn--sm btn--ghost" data-del-user="${u.id}" title="Elimina" style="color:var(--color-danger)"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`).join('');

    tbody.querySelectorAll('[data-edit-user]').forEach(btn => {
        btn.addEventListener('click', () => openUserModal(users.find(u => u.id == btn.dataset.editUser)));
    });
    tbody.querySelectorAll('[data-toggle-user]').forEach(btn => {
        btn.addEventListener('click', () => toggleUser(users.find(u => u.id == btn.dataset.toggleUser)));
    });
    tbody.querySelectorAll('[data-del-user]').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(users.find(u => u.id == btn.dataset.delUser)));
    });

    Pagination.render(document.getElementById('users-pagination'), parsed, (p) => { usersPage = p; loadUsers(); });
    if (window.lucide) window.lucide.createIcons();
}

async function toggleUser(user) {
    if (!user) return;
    const action = user.is_active ? 'Disattivare' : 'Riattivare';
    if (!await confirmDialog(`${action} l'utente ${user.username}?`, { title: action + ' utente' })) return;
    try {
        const json = await request(`${USERS_API}?id=${user.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !user.is_active }),
        });
        if (!json.success) return showAlert(json.error || 'Errore', 'error');
        await loadUsers();
        showAlert(user.is_active ? 'Utente disattivato.' : 'Utente riattivato.', 'success');
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

async function deleteUser(user) {
    if (!user) return;
    if (!await confirmDialog(`Eliminare definitivamente l'utente ${user.username}?`, { title: 'Elimina utente' })) return;
    try {
        const json = await request(`${USERS_API}?id=${user.id}`, { method: 'DELETE' });
        if (!json.success) return showAlert(json.error || 'Errore', 'error');
        await loadUsers();
        showAlert('Utente eliminato.', 'success');
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

function openUserModal(user = null) {
    document.getElementById('user-modal').hidden = false;
    document.getElementById('user-modal-alert').style.display = 'none';
    document.getElementById('user-id').value = user?.id || '';
    document.getElementById('user-username').value = user?.username || '';
    document.getElementById('user-username').disabled = !!user;
    document.getElementById('user-email').value = user?.email || '';
    document.getElementById('user-password').value = '';
    // Password obbligatoria solo in creazione; in modifica vuota = invariata.
    document.getElementById('user-password').required = !user;
    document.getElementById('user-role').value = user?.role || 'agent';
    document.getElementById('user-modal-title').textContent = user ? 'Modifica utente' : 'Nuovo utente';
}

function closeUserModal() {
    document.getElementById('user-modal').hidden = true;
}

// Errore mostrato DENTRO la modale: #settings-alert sta dietro l'overlay e non si vede.
function showUserModalAlert(msg) {
    const el = document.getElementById('user-modal-alert');
    el.textContent = msg;
    el.style.display = 'block';
}

async function saveUser(e) {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const payload = {
        username: document.getElementById('user-username').value.trim(),
        email: document.getElementById('user-email').value,
        password: document.getElementById('user-password').value,
        role: document.getElementById('user-role').value,
    };
    if (!payload.username) {
        return showUserModalAlert('Inserisci uno username.');
    }
    if ((!id || payload.password) && payload.password.length < 8) {
        return showUserModalAlert('La password deve avere almeno 8 caratteri.');
    }
    const url = id ? `${USERS_API}?id=${id}` : USERS_API;
    const method = id ? 'PUT' : 'POST';
    try {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const json = await res.json();
        if (json.success) {
            closeUserModal();
            await loadUsers();
            showAlert('Utente salvato.', 'success');
        } else {
            showUserModalAlert(json.error || 'Errore durante il salvataggio.');
        }
    } catch (err) {
        showUserModalAlert('Errore di rete: ' + err.message);
    }
}

// La 2FA vive in "Il mio account" (views/account.html): è sicurezza del singolo
// utente, e questa pagina la vede solo il super_admin.

async function triggerBackup() {
    const btn = document.getElementById('btn-backup-now');
    btn.disabled = true;
    btn.textContent = 'Backup in corso…';
    try {
        const json = await request(BACKUP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (json.success) {
            const cloud = json.data.cloud || {};
            // Un upload sul cloud fallito non è un backup riuscito a metà da
            // annunciare in verde: il file è rimasto solo su questo server.
            const level = cloud.attempted && !cloud.success ? 'error' : 'success';
            showSectionFeedback('backup', `${json.data.message} (${json.data.size_kb} KB)`, level);
        } else {
            showSectionFeedback('backup', json.error || 'Errore backup.', 'error');
        }
    } catch (err) {
        showSectionFeedback('backup', 'Errore durante il backup: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save"></i> Backup ora';
        if (window.lucide) window.lucide.createIcons();
    }
}

// -------------------------------------------------------------------------
// Email templates
// -------------------------------------------------------------------------

function bindEmailTemplates() {
    document.getElementById('btn-new-email-tpl').addEventListener('click', () => openEmailTplModal());
    document.getElementById('email-tpl-modal-close').addEventListener('click', closeEmailTplModal);
    document.getElementById('email-tpl-modal-cancel').addEventListener('click', closeEmailTplModal);
    document.getElementById('email-tpl-form').addEventListener('submit', saveEmailTemplate);
}

async function loadEmailTemplates() {
    const params = new URLSearchParams({ page: emailTplsPage, limit: EMAIL_TPLS_PAGE_LIMIT });
    const res = await fetch(`${EMAIL_TPL_API}?${params}`);
    const json = await res.json();
    if (!json.success) return;
    const parsed = Pagination.parseResponse(json);
    const items = parsed.items;
    const tbody = document.getElementById('email-tpl-tbody');
    const CATEGORY_LABELS = {
        benvenuto: 'Benvenuto',
        scadenza_affitto: 'Scad. affitto',
        scadenza_contratto: 'Scad. contratto',
        promemoria: 'Promemoria',
        richiesta_documento: 'Richiesta doc.',
        generico: 'Generico',
    };
    tbody.innerHTML = items.length
        ? items.map(t => `
            <tr>
                <td data-label="Nome">${esc(t.name)}</td>
                <td data-label="Categoria"><span class="badge">${esc(CATEGORY_LABELS[t.category] || t.category)}</span></td>
                <td data-label="Oggetto">${esc(t.subject)}</td>
                <td data-label="Attivo">${t.is_active ? '<i data-lucide="check-circle"></i>' : '—'}</td>
                <td class="col-actions"><button class="btn btn--sm btn--ghost" data-edit-tpl="${t.id}"><i data-lucide="pencil"></i></button>
                    <button class="btn btn--sm btn--ghost" data-del-tpl="${t.id}" style="color:var(--color-danger)"><i data-lucide="trash-2"></i></button></td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="text-muted">Nessun template.</td></tr>';

    tbody.querySelectorAll('[data-edit-tpl]').forEach(btn => {
        btn.addEventListener('click', () => openEmailTplModal(items.find(t => t.id == btn.dataset.editTpl)));
    });
    tbody.querySelectorAll('[data-del-tpl]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!await confirmDialog('Vuoi eliminare questo template?', { title: 'Elimina template' })) return;
            await fetch(`${EMAIL_TPL_API}?id=${btn.dataset.delTpl}`, { method: 'DELETE' });
            await loadEmailTemplates();
            showAlert('Template eliminato.', 'success');
        });
    });
    Pagination.render(
        document.getElementById('email-tpl-pagination'),
        parsed,
        (p) => { emailTplsPage = p; loadEmailTemplates(); }
    );
}

function openEmailTplModal(tpl = null) {
    document.getElementById('email-tpl-modal').hidden = false;
    document.getElementById('email-tpl-id').value = tpl?.id || '';
    document.getElementById('email-tpl-name').value = tpl?.name || '';
    document.getElementById('email-tpl-category').value = tpl?.category || 'generico';
    document.getElementById('email-tpl-subject').value = tpl?.subject || '';
    document.getElementById('email-tpl-body').value = tpl?.body || '';
    document.getElementById('email-tpl-vars').value = tpl?.variables || '';
    document.getElementById('email-tpl-active').checked = tpl ? !!tpl.is_active : true;
    document.getElementById('email-tpl-modal-title').textContent = tpl ? 'Modifica template email' : 'Nuovo template email';
}

function closeEmailTplModal() {
    document.getElementById('email-tpl-modal').hidden = true;
}

async function saveEmailTemplate(e) {
    e.preventDefault();
    const id = document.getElementById('email-tpl-id').value;
    const payload = {
        name: document.getElementById('email-tpl-name').value,
        category: document.getElementById('email-tpl-category').value,
        subject: document.getElementById('email-tpl-subject').value,
        body: document.getElementById('email-tpl-body').value,
        variables: document.getElementById('email-tpl-vars').value,
        is_active: document.getElementById('email-tpl-active').checked,
    };
    const url = id ? `${EMAIL_TPL_API}?id=${id}` : EMAIL_TPL_API;
    const res = await fetch(url, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.success) {
        closeEmailTplModal();
        await loadEmailTemplates();
        showAlert('Template salvato.', 'success');
    } else {
        showAlert(json.error || 'Errore salvataggio template.', 'error');
    }
}

// ── Indici ISTAT FOI ────────────────────────────────────────────────────────
// Il calcolo dell'adeguamento sta sul contratto; qui c'e' il DATO che quel
// calcolo legge. Separarli e' il punto: prima gli indici erano un array nel
// codice, quindi aggiornarli voleva dire un deploy.

let istatCsv = null;

function bindIstat() {
    const file = document.getElementById('istat-import-file');
    if (!file) return;

    const confirmBtn = document.getElementById('istat-import-confirm');
    const report     = document.getElementById('istat-import-report');

    file.addEventListener('change', async () => {
        // Ogni nuovo file riparte dall'anteprima: il pulsante "Importa" non deve
        // restare abilitato da un'anteprima fatta su un file diverso.
        istatCsv = null;
        confirmBtn.disabled = true;
        report.innerHTML = '';
        const f = file.files[0];
        if (!f) return;
        try {
            istatCsv = await f.text();
        } catch (err) {
            showAlert('Impossibile leggere il file: ' + err.message, 'error');
        }
    });

    document.getElementById('istat-import-preview').addEventListener('click', () => runIstatImport(true));
    confirmBtn.addEventListener('click', () => runIstatImport(false));
    document.getElementById('istat-manual-save').addEventListener('click', saveIstatManual);
}

async function loadIstat() {
    const tbody = document.getElementById('istat-tbody');
    if (!tbody) return;

    const res  = await fetch(ISTAT_API);
    const json = await res.json();
    if (!json.success) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted">${esc(json.error)}</td></tr>`;
        return;
    }

    const { items, coverage, message } = json.data;
    const cov = document.getElementById('istat-coverage');

    if (!coverage.available) {
        cov.innerHTML = `<div class="alert alert--warning">${esc(message || 'Tabella indici non disponibile.')}</div>`;
    } else if (coverage.total === 0) {
        cov.innerHTML = '<div class="alert alert--warning">Nessun indice caricato: l\'adeguamento ISTAT non può essere calcolato.</div>';
    } else {
        // I valori 'seed' sono quelli ereditati dal codice: funzionano, ma
        // nessuno li ha confrontati col bollettino. Dirlo qui evita che un
        // numero provvisorio venga usato per anni come se fosse ufficiale.
        const seedWarn = coverage.seed > 0
            ? ` <strong>${coverage.seed}</strong> ancora da verificare sul bollettino ufficiale.`
            : '';
        cov.innerHTML =
            `<div class="alert alert--${coverage.seed > 0 ? 'warning' : 'info'}">` +
            `<strong>${coverage.total}</strong> periodi (${coverage.monthly} mensili, ${coverage.annual} medie annue) ` +
            `da ${esc(coverage.first)} a ${esc(coverage.last)}.${seedWarn}</div>`;
    }

    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Nessun indice.</td></tr>';
        return;
    }

    const SOURCE_LABEL = { seed: 'ereditato dal codice', import: 'import', manuale: 'manuale' };
    tbody.innerHTML = items.map(r => `
        <tr>
            <td>${esc(r.period)}</td>
            <td>${esc(r.index_value)}</td>
            <td>${esc(SOURCE_LABEL[r.source] || r.source)}</td>
            <td>${esc(String(r.updated_at || '').substring(0, 10))}</td>
            <td><button class="btn btn--sm btn--ghost" data-istat-del="${r.id}" title="Elimina"><i data-lucide="trash-2"></i></button></td>
        </tr>`).join('');

    tbody.querySelectorAll('[data-istat-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!await confirmDialog('Eliminare questo indice?', { title: 'Elimina indice' })) return;
            const res = await fetch(`${ISTAT_API}?id=${btn.dataset.istatDel}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) return showAlert(json.error, 'error');
            await loadIstat();
            showAlert('Indice eliminato.', 'success');
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

async function runIstatImport(dryRun) {
    const report = document.getElementById('istat-import-report');
    if (!istatCsv) return showAlert('Seleziona prima un file CSV.', 'error');

    const res  = await fetch(ISTAT_API + '?action=import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: istatCsv, dry_run: dryRun }),
    });
    const json = await res.json();

    if (!json.success) {
        report.innerHTML = `<div class="alert alert--error">${esc(json.error)}</div>`;
        document.getElementById('istat-import-confirm').disabled = true;
        return;
    }

    const d = json.data;
    const preview = (d.preview || []).map(p => `${esc(p.period)} = ${esc(p.index_value)}`).join(' · ');
    report.innerHTML =
        `<div class="alert alert--${dryRun ? 'info' : 'success'}">` +
        `${esc(d.message)}<br>` +
        `Righe lette ${d.rows_in_file}, pronte ${d.rows_ready}, scartate ${d.skipped_bad}, ` +
        `override manuali preservati ${d.skipped_manual}.` +
        (preview ? `<br><small class="text-muted">${preview}</small>` : '') +
        `</div>`;

    // Si abilita l'import solo se l'anteprima ha trovato qualcosa da scrivere.
    document.getElementById('istat-import-confirm').disabled = !(dryRun && d.rows_ready > 0);

    if (!dryRun) {
        istatCsv = null;
        document.getElementById('istat-import-file').value = '';
        await loadIstat();
    }
}

async function saveIstatManual() {
    const period = document.getElementById('istat-manual-period').value.trim();
    const value  = document.getElementById('istat-manual-value').value.trim();
    if (!period || !value) return showAlert('Indica periodo e valore.', 'error');

    const res  = await fetch(ISTAT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, index_value: value }),
    });
    const json = await res.json();
    if (!json.success) return showAlert(json.error, 'error');

    document.getElementById('istat-manual-period').value = '';
    document.getElementById('istat-manual-value').value = '';
    await loadIstat();
    showAlert(`Indice ${json.data.period} salvato.`, 'success');
}

/**
 * Esito accanto al pulsante che l'ha prodotto. L'avviso unico in cima alla
 * pagina resta per gli errori che non appartengono a una scheda: salvando
 * Fatturazione (una scheda lunga) il messaggio in alto era fuori schermo, e il
 * salvataggio sembrava non aver risposto niente.
 */
function showSectionFeedback(section, msg, type) {
    const el = document.getElementById('feedback-' + (SECTION_FEEDBACK[section] || section));
    if (!el) return showAlert(msg, type);
    el.textContent = msg;
    el.className = 'settings-feedback settings-feedback--' + type;
    el.hidden = false;
    clearTimeout(el._timer);
    // Gli errori restano finché non si risalva: sparire dopo 5 secondi mentre
    // l'utente sta ancora correggendo il campo non aiuta nessuno.
    if (type === 'success') {
        el._timer = setTimeout(() => { el.hidden = true; }, 5000);
    }
}

function showAlert(msg, type) {
    const el = document.getElementById('settings-alert');
    el.textContent = msg;
    el.className = 'alert alert--' + type;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

(function () {
    'use strict';

    const API = 'api/settings.php';
    const USERS_API = 'api/admin_users.php';
    const LOGO_API = 'api/upload_logo.php';
    const EMAIL_TPL_API = 'api/email_templates.php';
    const BACKUP_API = 'api/backup_trigger.php';
    let settings = null;
    let isSuperAdmin = false;
    let usersPage = 1;
    const USERS_PAGE_LIMIT = 25;
    let emailTplsPage = 1;
    const EMAIL_TPLS_PAGE_LIMIT = 25;

    init();

    async function init() {
        bindTabs();
        await loadSettings();
        bindForms();
        bindUsers();
        bindEmailTemplates();
        bind2fa();
        render2fa();
        const base = window.location.origin + window.location.pathname.replace(/index\.php.*/, '');
        document.getElementById('meta-redirect-uri').textContent = base + 'meta_callback.php';
    }

    function bindTabs() {
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('settings-tab--active'));
                tab.classList.add('settings-tab--active');
                document.querySelectorAll('.settings-panel').forEach(p => p.hidden = true);
                document.getElementById('panel-' + tab.dataset.tab).hidden = false;
                if (tab.dataset.tab === 'email-templates') loadEmailTemplates();
            });
        });
    }

    async function loadSettings() {
        const res = await fetch(API);
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        settings = json.data;
        fillBranding(settings.branding);
        fillMail(settings.mail);
        fillWhatsApp(settings.whatsapp);
        fillBackup(settings.backup);
        fillMeta(settings.meta);
        try {
            const uRes = await fetch(USERS_API);
            if (uRes.ok) {
                isSuperAdmin = true;
                document.getElementById('tab-users').style.display = '';
                await loadUsers();
            }
        } catch (_) {}
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
        document.getElementById('set-smtp-pass').value = m.smtp_pass || '';
        document.getElementById('set-smtp-secure').value = m.smtp_secure || 'tls';
        document.getElementById('set-mailgun-webhook-key').value = m.mailgun_webhook_key || '';
        // Show the webhook URL so the user can copy it into Mailgun
        const urlEl = document.getElementById('mailgun-webhook-url');
        if (urlEl) {
            const base = window.location.origin + window.location.pathname.replace(/index\.php.*/, '');
            const webhookUrl = base + 'api/email_inbound.php';
            urlEl.textContent = webhookUrl;
            urlEl.addEventListener('click', () => {
                navigator.clipboard.writeText(webhookUrl).then(() => showAlert('URL copiato!', 'success'));
            });
        }
    }

    function fillWhatsApp(w) {
        document.getElementById('set-wa-enabled').checked = !!w.whatsapp_enabled;
        document.getElementById('set-twilio-sid').value = w.twilio_account_sid || '';
        document.getElementById('set-twilio-token').value = w.twilio_auth_token || '';
        document.getElementById('set-twilio-from').value = w.twilio_whatsapp_from || '';
    }

    function fillBackup(b) {
        document.getElementById('set-backup-enabled').checked = !!b.backup_cloud_enabled;
        document.getElementById('set-s3-endpoint').value = b.backup_s3_endpoint || '';
        document.getElementById('set-s3-bucket').value = b.backup_s3_bucket || '';
        document.getElementById('set-s3-region').value = b.backup_s3_region || 'eu-central-1';
        document.getElementById('set-s3-key').value = b.backup_s3_key || '';
        document.getElementById('set-s3-secret').value = b.backup_s3_secret || '';
        document.getElementById('set-s3-prefix').value = b.backup_s3_prefix || 'gestionale-backups/';
    }

    function fillMeta(m) {
        document.getElementById('set-meta-app-id').value = m.meta_app_id || '';
        document.getElementById('set-meta-app-secret').value = m.meta_app_secret || '';
    }

    function bindForms() {
        document.getElementById('form-branding').addEventListener('submit', e => saveSection(e, 'branding', collectBranding));
        document.getElementById('form-mail').addEventListener('submit', e => saveSection(e, 'mail', collectMail));
        document.getElementById('form-whatsapp').addEventListener('submit', e => saveSection(e, 'whatsapp', collectWhatsApp));
        document.getElementById('form-backup').addEventListener('submit', e => saveSection(e, 'backup', collectBackup));
        document.getElementById('form-meta').addEventListener('submit', e => saveSection(e, 'meta', collectMeta));
        document.getElementById('btn-test-email').addEventListener('click', testEmail);
        document.getElementById('set-logo-file').addEventListener('change', uploadLogo);
        document.getElementById('btn-backup-now').addEventListener('click', triggerBackup);
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
            smtp_pass:            document.getElementById('set-smtp-pass').value,
            smtp_secure:          document.getElementById('set-smtp-secure').value,
            mailgun_webhook_key:  document.getElementById('set-mailgun-webhook-key').value,
        };
    }

    function collectWhatsApp() {
        return {
            whatsapp_enabled: document.getElementById('set-wa-enabled').checked,
            twilio_account_sid: document.getElementById('set-twilio-sid').value,
            twilio_auth_token: document.getElementById('set-twilio-token').value,
            twilio_whatsapp_from: document.getElementById('set-twilio-from').value,
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

    function collectMeta() {
        return {
            meta_app_id: document.getElementById('set-meta-app-id').value,
            meta_app_secret: document.getElementById('set-meta-app-secret').value,
        };
    }

    async function saveSection(e, section, collector) {
        e.preventDefault();
        const body = { section, ...collector() };
        const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = await res.json();
        if (json.success) {
            showAlert('Impostazioni salvate.', 'success');
            settings = json.data;
            document.querySelector('link[href="branding.css.php"]')?.remove();
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'branding.css.php?' + Date.now();
            document.head.appendChild(link);
        } else {
            showAlert(json.error || 'Errore', 'error');
        }
    }

    async function testEmail() {
        const email = document.getElementById('set-agency-email').value;
        const res = await fetch(API + '?test_email=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const json = await res.json();
        showAlert(json.success ? json.data.message : json.error, json.success ? 'success' : 'error');
    }

    async function uploadLogo() {
        const file = document.getElementById('set-logo-file').files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('logo', file);
        const res = await fetch(LOGO_API, { method: 'POST', body: fd });
        const json = await res.json();
        if (json.success) {
            const img = document.getElementById('set-logo-preview');
            img.src = json.data.logo_path + '?' + Date.now();
            img.style.display = 'block';
            showAlert('Logo caricato.', 'success');
        } else {
            showAlert(json.error, 'error');
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
        tbody.innerHTML = users.map(u => `
            <tr>
                <td data-label="Username">${esc(u.username)}</td>
                <td data-label="Email">${esc(u.email || '—')}</td>
                <td data-label="Ruolo"><span class="badge">${esc(u.role)}</span></td>
                <td data-label="Stato">${u.is_active ? 'Attivo' : 'Disattivo'}</td>
                <td class="col-actions" data-label="Azioni"><button class="btn btn--sm btn--ghost" data-edit-user="${u.id}">✏️</button></td>
            </tr>`).join('');
        tbody.querySelectorAll('[data-edit-user]').forEach(btn => {
            btn.addEventListener('click', () => openUserModal(users.find(u => u.id == btn.dataset.editUser)));
        });
        Pagination.render(document.getElementById('users-pagination'), parsed, (p) => { usersPage = p; loadUsers(); });
    }

    function openUserModal(user = null) {
        document.getElementById('user-modal').hidden = false;
        document.getElementById('user-id').value = user?.id || '';
        document.getElementById('user-username').value = user?.username || '';
        document.getElementById('user-username').disabled = !!user;
        document.getElementById('user-email').value = user?.email || '';
        document.getElementById('user-password').value = '';
        document.getElementById('user-role').value = user?.role || 'agent';
        document.getElementById('user-modal-title').textContent = user ? 'Modifica utente' : 'Nuovo utente';
    }

    function closeUserModal() {
        document.getElementById('user-modal').hidden = true;
    }

    async function saveUser(e) {
        e.preventDefault();
        const id = document.getElementById('user-id').value;
        const payload = {
            username: document.getElementById('user-username').value,
            email: document.getElementById('user-email').value,
            password: document.getElementById('user-password').value,
            role: document.getElementById('user-role').value,
        };
        const url = id ? `${USERS_API}?id=${id}` : USERS_API;
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const json = await res.json();
        if (json.success) {
            closeUserModal();
            await loadUsers();
            showAlert('Utente salvato.', 'success');
        } else {
            showAlert(json.error, 'error');
        }
    }

    // -------------------------------------------------------------------------
    // 2FA
    // -------------------------------------------------------------------------

    let totpSecret = null;

    function bind2fa() {
        document.getElementById('btn-2fa-start').addEventListener('click', start2fa);
        document.getElementById('btn-2fa-confirm').addEventListener('click', confirm2fa);
        document.getElementById('btn-2fa-disable').addEventListener('click', disable2fa);
    }

    function render2fa() {
        const enabled = !!(settings && settings.twofa && settings.twofa.enabled);
        document.getElementById('totp-enabled-view').hidden = !enabled;
        document.getElementById('totp-disabled-view').hidden = enabled;
    }

    async function start2fa() {
        const res = await fetch(API + '?action=2fa_setup');
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        totpSecret = json.data.secret;
        document.getElementById('totp-qr').src = json.data.qr_image;
        document.getElementById('totp-uri').textContent = json.data.otpauth;
        document.getElementById('totp-setup-panel').hidden = false;
        document.getElementById('totp-backup-panel').hidden = true;
    }

    async function confirm2fa() {
        const code = document.getElementById('totp-verify-code').value.trim();
        if (!totpSecret || !code) return showAlert('Inserisci il codice.', 'error');
        const res = await fetch(API + '?action=2fa_enable', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: totpSecret, code }),
        });
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        document.getElementById('totp-setup-panel').hidden = true;
        document.getElementById('totp-backup-codes').textContent = json.data.backup_codes.join('\n');
        document.getElementById('totp-backup-panel').hidden = false;
        if (settings) settings.twofa = { enabled: true };
        showAlert('2FA attivata.', 'success');
        setTimeout(render2fa, 100);
    }

    async function disable2fa() {
        const password = document.getElementById('totp-disable-pass').value;
        if (!password) return showAlert('Inserisci la password.', 'error');
        const res = await fetch(API + '?action=2fa_disable', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        const json = await res.json();
        if (!json.success) return showAlert(json.error, 'error');
        if (settings) settings.twofa = { enabled: false };
        document.getElementById('totp-disable-pass').value = '';
        render2fa();
        showAlert('2FA disattivata.', 'success');
    }

    async function triggerBackup() {
        const btn = document.getElementById('btn-backup-now');
        btn.disabled = true;
        btn.textContent = 'Backup in corso…';
        try {
            const res = await fetch(BACKUP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const json = await res.json();
            if (json.success) {
                showAlert(`Backup completato: ${json.data.filename} (${json.data.size_kb} KB)`, 'success');
            } else {
                showAlert(json.error || 'Errore backup.', 'error');
            }
        } catch (err) {
            showAlert('Errore di rete durante il backup.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '💾 Backup ora';
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
                    <td data-label="Attivo">${t.is_active ? '✅' : '—'}</td>
                    <td class="col-actions"><button class="btn btn--sm btn--ghost" data-edit-tpl="${t.id}">✏️</button>
                        <button class="btn btn--sm btn--ghost" data-del-tpl="${t.id}" style="color:var(--color-danger)">🗑️</button></td>
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

    function showAlert(msg, type) {
        const el = document.getElementById('settings-alert');
        el.textContent = msg;
        el.className = 'alert alert--' + type;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }
})();

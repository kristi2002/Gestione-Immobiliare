// Il mio account — 2FA del singolo utente.
//
// Sta qui e non nelle Impostazioni perché quella pagina è riservata al
// super_admin: la 2FA deve poterla attivare chiunque abbia un accesso, incluso
// un utente in sola lettura (api/account.php dichiara API_SELF_SERVICE).

const API = 'api/account.php';

let totpSecret = null;
let twofaEnabled = false;

bind();
load();

function bind() {
    document.getElementById('btn-2fa-start').addEventListener('click', start2fa);
    document.getElementById('btn-2fa-confirm').addEventListener('click', confirm2fa);
    document.getElementById('btn-2fa-disable').addEventListener('click', disable2fa);
}

async function load() {
    try {
        const json = await request(`${API}?action=status`);
        if (!json.success) return showAlert(json.error, 'error');
        const d = json.data;
        document.getElementById('account-username').textContent = d.username || '—';
        document.getElementById('account-email').textContent = d.email || '—';
        document.getElementById('account-role').textContent = (d.role || '').replace('_', ' ') || '—';
        twofaEnabled = !!(d.twofa && d.twofa.enabled);
        render();
    } catch (err) {
        showAlert('Impossibile caricare i dati dell\'account: ' + err.message, 'error');
    }
}

function render() {
    document.getElementById('totp-enabled-view').hidden = !twofaEnabled;
    document.getElementById('totp-disabled-view').hidden = twofaEnabled;
}

async function start2fa() {
    try {
        const json = await request(`${API}?action=2fa_setup`);
        if (!json.success) return showAlert(json.error, 'error');
        totpSecret = json.data.secret;
        // Il segreto si legge a gruppi di 4: va ricopiato a mano in un'app, e a
        // caratteri attaccati si sbaglia. Il QR generato da terzi non c'e' piu'
        // (spediva questo stesso segreto fuori — vedi api/account.php).
        document.getElementById('totp-secret').textContent =
            String(json.data.secret || '').replace(/(.{4})/g, '$1 ').trim();
        document.getElementById('totp-uri').textContent = json.data.otpauth;
        document.getElementById('totp-setup-panel').hidden = false;
        document.getElementById('totp-backup-panel').hidden = true;
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

async function confirm2fa() {
    const code = document.getElementById('totp-verify-code').value.trim();
    if (!totpSecret || !code) return showAlert('Inserisci il codice.', 'error');
    try {
        const json = await request(`${API}?action=2fa_enable`, 'POST', { secret: totpSecret, code });
        if (!json.success) return showAlert(json.error, 'error');
        document.getElementById('totp-setup-panel').hidden = true;
        document.getElementById('totp-backup-codes').textContent = json.data.backup_codes.join('\n');
        document.getElementById('totp-backup-panel').hidden = false;
        twofaEnabled = true;
        // I codici di backup si vedono una volta sola: la vista "attiva" li
        // nasconderebbe, quindi resta com'è finché l'utente non ricarica.
        showAlert('2FA attivata. Salva i codici di backup qui sotto.', 'success');
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

async function disable2fa() {
    const password = document.getElementById('totp-disable-pass').value;
    if (!password) return showAlert('Inserisci la password.', 'error');
    try {
        const json = await request(`${API}?action=2fa_disable`, 'POST', { password });
        if (!json.success) return showAlert(json.error, 'error');
        twofaEnabled = false;
        document.getElementById('totp-disable-pass').value = '';
        render();
        showAlert('2FA disattivata.', 'success');
    } catch (err) {
        showAlert(err.message, 'error');
    }
}

// Una risposta non-JSON (errore PHP, pagina di login) romperebbe .json() con un
// messaggio incomprensibile: qui diventa un errore leggibile.
async function request(url, method = 'GET', body = null) {
    const opts = { method };
    if (body !== null) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error(`Risposta non valida dal server (HTTP ${res.status}).`);
    }
}

function showAlert(msg, type) {
    const el = document.getElementById('account-alert');
    el.textContent = msg;
    el.className = 'alert alert--' + type;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
}

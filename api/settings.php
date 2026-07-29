<?php
/**
 * App settings API — branding, email, WhatsApp, backup, Meta app credentials.
 *
 * La 2FA non sta più qui: è sicurezza del singolo account, non un'impostazione
 * dell'agenzia, e questa pagina è riservata al super_admin. Vive in
 * api/account.php, raggiungibile da ogni ruolo.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/mail_html.php';

apiHandleOptions();

try {
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        if (isset($_GET['public'])) {
            apiSuccess(getPublicBranding());
        }
        requireRole('super_admin');
        apiSuccess(publicSettingsPayload());
    } elseif ($method === 'PUT') {
        requireRole('super_admin');
        requireWriteAccess();
        updateSettings();
    } elseif ($method === 'POST' && isset($_GET['test_email'])) {
        requireRole('super_admin');
        requireWriteAccess();
        testEmail();
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

/**
 * Un segreto arriva in tre forme:
 *   - campo vuoto        → invariato (la pagina non lo pre-compila più)
 *   - `<chiave>_clear`   → cancellazione esplicita (revoca di un token)
 *   - valore             → nuovo segreto
 * La vecchia maschera `••••` resta rifiutata: un browser con il JS in cache
 * potrebbe ancora rispedirla, e scriverla come password sarebbe peggio che
 * ignorarla.
 */
function collectSecret(array $data, string $key, array &$pairs): void
{
    if (!empty($data[$key . '_clear'])) {
        $pairs[$key] = '';
        return;
    }
    $value = trim((string) ($data[$key] ?? ''));
    if ($value === '' || str_starts_with($value, '••••')) {
        return;
    }
    $pairs[$key] = $value;
}

function collectPlain(array $data, array $keys, array &$pairs): void
{
    foreach ($keys as $key) {
        if (array_key_exists($key, $data)) {
            $pairs[$key] = is_bool($data[$key])
                ? ($data[$key] ? 'true' : 'false')
                : trim((string) $data[$key]);
        }
    }
}

function updateSettings(): void
{
    $data    = apiGetJsonBody();
    $section = $data['section'] ?? 'all';
    $pairs   = [];

    if (in_array($section, ['branding', 'all'], true)) {
        collectPlain($data, ['agency_name','agency_tagline','agency_phone','agency_address','primary_color','sidebar_color'], $pairs);
    }

    if (in_array($section, ['mail', 'all'], true)) {
        collectPlain($data, ['mail_enabled','agency_email','smtp_host','smtp_port','smtp_user','smtp_secure'], $pairs);
        collectSecret($data, 'smtp_pass', $pairs);
        collectSecret($data, 'mailgun_webhook_key', $pairs);
    }

    if (in_array($section, ['whatsapp', 'all'], true)) {
        collectPlain($data, ['whatsapp_enabled','twilio_account_sid','twilio_whatsapp_from'], $pairs);
        collectSecret($data, 'twilio_auth_token', $pairs);
    }

    if (in_array($section, ['backup', 'all'], true)) {
        collectPlain($data, ['backup_cloud_enabled','backup_s3_endpoint','backup_s3_bucket','backup_s3_region','backup_s3_key','backup_s3_prefix'], $pairs);
        collectSecret($data, 'backup_s3_secret', $pairs);
    }

    if (in_array($section, ['meta', 'all'], true)) {
        collectPlain($data, ['meta_app_id'], $pairs);
        collectSecret($data, 'meta_app_secret', $pairs);
    }

    if (in_array($section, ['fatturazione', 'all'], true)) {
        collectPlain($data, [
            'agency_piva','agency_cf','agency_denominazione','agency_regime_fiscale',
            'agency_indirizzo','agency_cap','agency_comune','agency_provincia','agency_pec',
            'agency_iban','agency_sepa_creditor_id',
        ], $pairs);
    }

    if (empty($pairs)) {
        apiError('Nessun campo da aggiornare.');
    }

    $pairs  = normalizeSettings($pairs);
    $errors = validateSettings($pairs);
    if ($errors) {
        apiValidationError($errors);
    }

    setSettings($pairs);
    // 'update' e non 'settings_update': logActivity() scarta in silenzio ogni
    // azione fuori dalla sua whitelist (config/activity_log.php).
    logActivity('update', 'settings', null, 'Impostazioni ' . $section . ' — campi: ' . implode(', ', array_keys($pairs)));

    apiSuccess(publicSettingsPayload());
}

/**
 * L'invio di prova usa quello che c'è SULLO SCHERMO, non quello salvato:
 * altrimenti si cambia host, si preme "Invia test" e si ottiene il responso
 * della vecchia configurazione. La password, se il campo è vuoto (di norma lo
 * è: i segreti non tornano al browser), la prende da quella salvata.
 */
function testEmail(): void
{
    $data = apiGetJsonBody();
    $to   = trim((string) ($data['email'] ?? '')) ?: (string) getMailConfig()['agency_email'];

    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        apiError('Email di test non valida.');
    }

    $override = null;
    if (!empty($data['config']) && is_array($data['config'])) {
        $saved = getMailConfig();
        $cfg   = $data['config'];
        $pass  = trim((string) ($cfg['smtp_pass'] ?? ''));

        $override = [
            'mail_enabled' => filter_var($cfg['mail_enabled'] ?? $saved['mail_enabled'], FILTER_VALIDATE_BOOLEAN),
            'agency_name'  => $saved['agency_name'],
            'agency_email' => trim((string) ($cfg['agency_email'] ?? '')) ?: $saved['agency_email'],
            'smtp_host'    => trim((string) ($cfg['smtp_host'] ?? '')),
            'smtp_port'    => (int) ($cfg['smtp_port'] ?? 0) ?: $saved['smtp_port'],
            'smtp_user'    => trim((string) ($cfg['smtp_user'] ?? '')),
            'smtp_secure'  => (string) ($cfg['smtp_secure'] ?? $saved['smtp_secure']),
            'smtp_pass'    => ($pass === '' || str_starts_with($pass, '••••')) ? $saved['smtp_pass'] : $pass,
        ];

        if (!filter_var($override['agency_email'], FILTER_VALIDATE_EMAIL)) {
            apiError('Email agenzia (mittente) non valida.');
        }
    }

    $result = sendTestEmail($to, $override);
    if (!$result['success']) {
        apiError($result['error'] ?? 'Invio fallito.');
    }

    // `simulated` significa che NULLA è partito: l'invio reale è disattivato.
    // Dire "inviata" in quel caso è la bugia che questa pagina raccontava.
    if (!empty($result['simulated'])) {
        apiSuccess([
            'simulated' => true,
            'message'   => "Invio reale disattivato: nessuna email è stata spedita a {$to}. "
                         . 'Attiva "Abilita invio email reale" e salva, poi riprova.',
        ]);
    }

    apiSuccess([
        'simulated' => false,
        'message'   => "Email di test inviata a {$to}. Controlla anche la cartella spam.",
    ]);
}

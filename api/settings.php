<?php
/**
 * App settings API — branding, email, WhatsApp, backup, Meta app credentials.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/mail_html.php';
require_once __DIR__ . '/../config/totp.php';

apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');

    if ($action === '2fa_setup' && $method === 'GET') {
        twoFaSetup($db);
    } elseif ($action === '2fa_enable' && $method === 'POST') {
        requireWriteAccess();
        twoFaEnable($db);
    } elseif ($action === '2fa_disable' && $method === 'POST') {
        requireWriteAccess();
        twoFaDisable($db);
    } elseif ($method === 'GET') {
        if (isset($_GET['public'])) {
            apiSuccess(getPublicBranding());
        }
        requireRole('super_admin');
        $payload = publicSettingsPayload();
        $payload['twofa'] = twoFaStatus($db);
        apiSuccess($payload);
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

// ---------------------------------------------------------------------------
// 2FA (acts on the current logged-in admin)
// ---------------------------------------------------------------------------

function twoFaSetup(PDO $db): void
{
    $secret   = generateTotpSecret();
    $username = getCurrentUsername();
    $issuer   = getSetting('agency_name', 'Gestionale Immobiliare');
    $uri      = generateQrCodeUrl($secret, $username, $issuer);

    apiSuccess([
        'secret'     => $secret,
        'otpauth'    => $uri,
        'qr_image'   => 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' . rawurlencode($uri),
    ]);
}

function twoFaEnable(PDO $db): void
{
    $data   = apiGetJsonBody();
    $secret = trim($data['secret'] ?? '');
    $code   = trim($data['code'] ?? '');

    if ($secret === '' || $code === '') {
        apiError('Segreto e codice obbligatori.');
    }
    if (!verifyTotpCode($secret, $code)) {
        apiError('Codice non valido. Riprova.');
    }

    $codes  = generateBackupCodes();
    $hashed = array_map('hashBackupCode', $codes);

    $stmt = $db->prepare(
        'UPDATE admin_users SET totp_secret = :secret, totp_enabled = 1, totp_backup_codes = :codes WHERE id = :id'
    );
    $stmt->execute([
        'secret' => $secret,
        'codes'  => json_encode($hashed),
        'id'     => getCurrentAdminId(),
    ]);

    apiSuccess(['enabled' => true, 'backup_codes' => $codes]);
}

function twoFaDisable(PDO $db): void
{
    $data     = apiGetJsonBody();
    $password = $data['password'] ?? '';

    $stmt = $db->prepare('SELECT password_hash FROM admin_users WHERE id = :id');
    $stmt->execute(['id' => getCurrentAdminId()]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($password, $row['password_hash'])) {
        apiError('Password non corretta.');
    }

    $db->prepare(
        'UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0, totp_backup_codes = NULL WHERE id = :id'
    )->execute(['id' => getCurrentAdminId()]);

    apiSuccess(['enabled' => false]);
}

function twoFaStatus(PDO $db): array
{
    $stmt = $db->prepare('SELECT totp_enabled FROM admin_users WHERE id = :id');
    $stmt->execute(['id' => getCurrentAdminId()]);
    return ['enabled' => (bool) ($stmt->fetchColumn())];
}

function updateSettings(): void
{
    $data = apiGetJsonBody();
    $section = $data['section'] ?? 'all';
    $pairs   = [];

    if (in_array($section, ['branding', 'all'], true)) {
        foreach (['agency_name','agency_tagline','agency_phone','agency_address','primary_color','sidebar_color'] as $k) {
            if (array_key_exists($k, $data)) {
                $pairs[$k] = trim((string) $data[$k]);
            }
        }
    }

    if (in_array($section, ['mail', 'all'], true)) {
        foreach (['mail_enabled','agency_email','smtp_host','smtp_port','smtp_user','smtp_secure'] as $k) {
            if (array_key_exists($k, $data)) {
                $pairs[$k] = is_bool($data[$k]) ? ($data[$k] ? 'true' : 'false') : trim((string) $data[$k]);
            }
        }
        if (!empty($data['smtp_pass']) && !str_starts_with((string) $data['smtp_pass'], '••••')) {
            $pairs['smtp_pass'] = trim((string) $data['smtp_pass']);
        }
        if (!empty($data['mailgun_webhook_key']) && !str_starts_with((string) $data['mailgun_webhook_key'], '••••')) {
            $pairs['mailgun_webhook_key'] = trim((string) $data['mailgun_webhook_key']);
        }
    }

    if (in_array($section, ['whatsapp', 'all'], true)) {
        foreach (['whatsapp_enabled','twilio_account_sid','twilio_whatsapp_from'] as $k) {
            if (array_key_exists($k, $data)) {
                $pairs[$k] = is_bool($data[$k]) ? ($data[$k] ? 'true' : 'false') : trim((string) $data[$k]);
            }
        }
        if (!empty($data['twilio_auth_token']) && !str_starts_with((string) $data['twilio_auth_token'], '••••')) {
            $pairs['twilio_auth_token'] = trim((string) $data['twilio_auth_token']);
        }
    }

    if (in_array($section, ['backup', 'all'], true)) {
        foreach (['backup_cloud_enabled','backup_s3_endpoint','backup_s3_bucket','backup_s3_region','backup_s3_key','backup_s3_prefix'] as $k) {
            if (array_key_exists($k, $data)) {
                $pairs[$k] = is_bool($data[$k]) ? ($data[$k] ? 'true' : 'false') : trim((string) $data[$k]);
            }
        }
        if (!empty($data['backup_s3_secret']) && !str_starts_with((string) $data['backup_s3_secret'], '••••')) {
            $pairs['backup_s3_secret'] = trim((string) $data['backup_s3_secret']);
        }
    }

    if (in_array($section, ['meta', 'all'], true)) {
        foreach (['meta_app_id'] as $k) {
            if (array_key_exists($k, $data)) {
                $pairs[$k] = trim((string) $data[$k]);
            }
        }
        if (!empty($data['meta_app_secret']) && !str_starts_with((string) $data['meta_app_secret'], '••••')) {
            $pairs['meta_app_secret'] = trim((string) $data['meta_app_secret']);
        }
    }

    if (empty($pairs)) {
        apiError('Nessun campo da aggiornare.');
    }

    setSettings($pairs);
    apiSuccess(publicSettingsPayload());
}

function testEmail(): void
{
    $data = apiGetJsonBody();
    $to   = trim($data['email'] ?? getMailConfig()['agency_email']);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        apiError('Email di test non valida.');
    }
    $result = sendTestEmail($to);
    if (!$result['success']) {
        apiError($result['error'] ?? 'Invio fallito.');
    }
    apiSuccess(['message' => "Email di test inviata a {$to}."]);
}

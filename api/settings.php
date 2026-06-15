<?php
/**
 * App settings API — branding, email, WhatsApp, backup, Meta app credentials.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/mail.php';

apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        if (isset($_GET['public'])) {
            apiSuccess(getPublicBranding());
        }
        requireRole('super_admin', 'admin');
        apiSuccess(publicSettingsPayload());
    } elseif ($method === 'PUT') {
        requireRole('super_admin', 'admin');
        requireWriteAccess();
        updateSettings();
    } elseif ($method === 'POST' && isset($_GET['test_email'])) {
        requireRole('super_admin', 'admin');
        requireWriteAccess();
        testEmail();
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
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

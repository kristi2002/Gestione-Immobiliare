<?php
/**
 * Application settings — DB-backed with .env fallback.
 */

require_once __DIR__ . '/db.php';

const SETTINGS_DEFAULTS = [
    'agency_name'           => 'Gestionale Immobiliare Orlandi',
    'agency_tagline'        => 'Orlandi Immobiliare',
    'agency_phone'          => '',
    'agency_address'        => 'Via Gabriele D\'Annunzio 49, 62012 Civitanova Marche',
    'logo_path'             => 'uploads/branding/logo.jpg',
    'primary_color'         => '#206bac',
    'sidebar_color'         => '#0d2140',
    'mail_enabled'          => 'false',
    'agency_email'          => 'admin@agenzia.it',
    'smtp_host'             => '',
    'smtp_port'             => '587',
    'smtp_user'             => '',
    'smtp_pass'             => '',
    'smtp_secure'           => 'tls',
    'whatsapp_enabled'      => 'false',
    'twilio_account_sid'    => '',
    'twilio_auth_token'     => '',
    'twilio_whatsapp_from'  => '',
    'backup_cloud_enabled'  => 'false',
    'backup_s3_endpoint'    => '',
    'backup_s3_bucket'      => '',
    'backup_s3_region'      => 'eu-central-1',
    'backup_s3_key'         => '',
    'backup_s3_secret'      => '',
    'backup_s3_prefix'      => 'gestionale-backups/',
    'meta_app_id'           => '',
    'meta_app_secret'       => '',
];

function getSetting(string $key, ?string $default = null): ?string
{
    static $cache = null;

    if ($cache === null) {
        $cache = [];
        try {
            $db   = getDB();
            $rows = $db->query('SELECT setting_key, setting_value FROM app_settings')->fetchAll();
            foreach ($rows as $row) {
                $cache[$row['setting_key']] = $row['setting_value'];
            }
        } catch (Throwable) {
            $cache = [];
        }
    }

    if (array_key_exists($key, $cache) && $cache[$key] !== null && $cache[$key] !== '') {
        return $cache[$key];
    }

    $envMap = [
        'agency_name'      => 'AGENCY_NAME',
        'agency_email'     => 'AGENCY_EMAIL',
        'mail_enabled'     => 'MAIL_ENABLED',
        'smtp_host'        => 'SMTP_HOST',
        'smtp_port'        => 'SMTP_PORT',
        'smtp_user'        => 'SMTP_USER',
        'smtp_pass'        => 'SMTP_PASS',
        'smtp_secure'      => 'SMTP_SECURE',
        'meta_app_id'      => 'META_APP_ID',
        'meta_app_secret'  => 'META_APP_SECRET',
        'twilio_account_sid'   => 'TWILIO_ACCOUNT_SID',
        'twilio_auth_token'    => 'TWILIO_AUTH_TOKEN',
        'twilio_whatsapp_from' => 'TWILIO_WHATSAPP_FROM',
        'backup_s3_endpoint'   => 'BACKUP_S3_ENDPOINT',
        'backup_s3_bucket'     => 'BACKUP_S3_BUCKET',
        'backup_s3_region'     => 'BACKUP_S3_REGION',
        'backup_s3_key'        => 'BACKUP_S3_KEY',
        'backup_s3_secret'     => 'BACKUP_S3_SECRET',
        'backup_cloud_enabled' => 'BACKUP_CLOUD_ENABLED',
    ];

    if (isset($envMap[$key])) {
        $envVal = env($envMap[$key], null);
        if ($envVal !== null && $envVal !== '') {
            return is_bool($envVal) ? ($envVal ? 'true' : 'false') : (string) $envVal;
        }
    }

    if ($default !== null) {
        return $default;
    }

    return SETTINGS_DEFAULTS[$key] ?? null;
}

function setSetting(string $key, ?string $value): void
{
    $db = getDB();
    $stmt = $db->prepare(
        'INSERT INTO app_settings (setting_key, setting_value) VALUES (:key, :value)
         ON DUPLICATE KEY UPDATE setting_value = :value2'
    );
    $stmt->execute(['key' => $key, 'value' => $value, 'value2' => $value]);
}

function setSettings(array $pairs): void
{
    foreach ($pairs as $key => $value) {
        setSetting($key, $value === null ? null : (string) $value);
    }
}

function getPublicBranding(): array
{
    return [
        'agency_name'    => getSetting('agency_name'),
        'agency_tagline' => getSetting('agency_tagline'),
        'agency_phone'   => getSetting('agency_phone'),
        'agency_address' => getSetting('agency_address'),
        'logo_path'      => getSetting('logo_path'),
        'primary_color'  => getSetting('primary_color'),
        'sidebar_color'  => getSetting('sidebar_color'),
    ];
}

function getMailConfig(): array
{
    return [
        'mail_enabled' => filter_var(getSetting('mail_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
        'agency_name'  => getSetting('agency_name'),
        'agency_email' => getSetting('agency_email'),
        'smtp_host'    => getSetting('smtp_host'),
        'smtp_port'    => (int) getSetting('smtp_port', '587'),
        'smtp_user'    => getSetting('smtp_user'),
        'smtp_pass'    => getSetting('smtp_pass'),
        'smtp_secure'  => getSetting('smtp_secure', 'tls'),
    ];
}

function getWhatsAppConfig(): array
{
    return [
        'enabled'    => filter_var(getSetting('whatsapp_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
        'account_sid'=> getSetting('twilio_account_sid'),
        'auth_token' => getSetting('twilio_auth_token'),
        'from'       => getSetting('twilio_whatsapp_from'),
    ];
}

function getBackupCloudConfig(): array
{
    return [
        'enabled'  => filter_var(getSetting('backup_cloud_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
        'endpoint' => getSetting('backup_s3_endpoint'),
        'bucket'   => getSetting('backup_s3_bucket'),
        'region'   => getSetting('backup_s3_region', 'eu-central-1'),
        'key'      => getSetting('backup_s3_key'),
        'secret'   => getSetting('backup_s3_secret'),
        'prefix'   => getSetting('backup_s3_prefix', 'gestionale-backups/'),
    ];
}

function maskSecret(?string $value): ?string
{
    if (!$value || strlen($value) < 4) {
        return $value ? '••••' : null;
    }
    return '••••••••' . substr($value, -4);
}

function publicSettingsPayload(): array
{
    return [
        'branding' => getPublicBranding(),
        'mail' => [
            'mail_enabled'        => filter_var(getSetting('mail_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
            'agency_email'        => getSetting('agency_email'),
            'smtp_host'           => getSetting('smtp_host'),
            'smtp_port'           => (int) getSetting('smtp_port', '587'),
            'smtp_user'           => getSetting('smtp_user'),
            'smtp_pass'           => maskSecret(getSetting('smtp_pass')),
            'smtp_secure'         => getSetting('smtp_secure', 'tls'),
            'mailgun_webhook_key' => maskSecret(getSetting('mailgun_webhook_key')),
        ],
        'whatsapp' => [
            'whatsapp_enabled'     => filter_var(getSetting('whatsapp_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
            'twilio_account_sid'   => getSetting('twilio_account_sid'),
            'twilio_auth_token'    => maskSecret(getSetting('twilio_auth_token')),
            'twilio_whatsapp_from' => getSetting('twilio_whatsapp_from'),
        ],
        'backup' => [
            'backup_cloud_enabled' => filter_var(getSetting('backup_cloud_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
            'backup_s3_endpoint'   => getSetting('backup_s3_endpoint'),
            'backup_s3_bucket'     => getSetting('backup_s3_bucket'),
            'backup_s3_region'     => getSetting('backup_s3_region'),
            'backup_s3_key'        => getSetting('backup_s3_key'),
            'backup_s3_secret'     => maskSecret(getSetting('backup_s3_secret')),
            'backup_s3_prefix'     => getSetting('backup_s3_prefix'),
        ],
        'meta' => [
            'meta_app_id'     => getSetting('meta_app_id'),
            'meta_app_secret' => maskSecret(getSetting('meta_app_secret')),
        ],
    ];
}

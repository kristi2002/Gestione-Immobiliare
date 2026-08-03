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
    'logo_path'             => 'assets/img/orlandi_logo.jpg',
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
    'meta_wa_phone_number_id' => '',
    'meta_wa_access_token'    => '',
    'meta_wa_app_secret'      => '',
    'meta_wa_verify_token'    => '',
    'whatsapp_from'           => '',
    'backup_cloud_enabled'  => 'false',
    'backup_s3_endpoint'    => '',
    'backup_s3_bucket'      => '',
    'backup_s3_region'      => 'eu-central-1',
    'backup_s3_key'         => '',
    'backup_s3_secret'      => '',
    'backup_s3_prefix'      => 'gestionale-backups/',
    'meta_app_id'           => '',
    'meta_app_secret'       => '',
    'mailgun_webhook_key'   => '',
    // Consenso marketing. Il testo è quello ESATTO mostrato o letto al contatto
    // al momento della raccolta e finisce dentro consent_records: è la prova di
    // "a cosa" ha acconsentito. Vuoto di proposito — lo fornisce l'agenzia con
    // la propria informativa, non lo inventiamo noi.
    'marketing_consent_text'  => '',
    'privacy_policy_version'  => '',
    // Generata al primo uso da config/consent.php, non si configura a mano.
    'unsubscribe_signing_key' => '',
    // Fatturazione elettronica (identità fiscale cedente/prestatore)
    'agency_piva'           => '',
    'agency_cf'             => '',
    'agency_denominazione'  => '',
    'agency_regime_fiscale' => 'RF01',
    'agency_indirizzo'      => '',
    'agency_cap'            => '',
    'agency_comune'         => '',
    'agency_provincia'      => '',
    'agency_pec'            => '',
    'agency_iban'           => '',
    'agency_sepa_creditor_id' => '',
];

// Guarded so a test harness that pre-defines a stub getSetting() (see
// tests/bootstrap.php) isn't fatally redeclared when this file is transitively
// included. In production the stub never exists, so the real one below wins.
if (!function_exists('getSetting')) {
function getSetting(string $key, ?string $default = null): ?string
{
    static $cache = null;
    static $generation = -1;

    // La cache vale per la singola richiesta, ma una scrittura la invalida: chi
    // salva e poi rilegge (l'API Impostazioni risponde con i valori salvati)
    // deve vedere il nuovo valore, non quello caricato a inizio richiesta.
    $current = $GLOBALS['__settings_cache_generation'] ?? 0;

    if ($cache === null || $generation !== $current) {
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
        $generation = $current;
    }

    // Una riga presente in app_settings VINCE, anche se vale ''. Prima il vuoto
    // veniva scambiato per "mai impostato" e la lettura ripiegava su .env o sul
    // default: svuotare un campo dalle Impostazioni non aveva quindi alcun
    // effetto (scegliere sicurezza SMTP "Nessuna" tornava sempre a TLS, e
    // cancellare l'indirizzo faceva riapparire quello scritto qui sotto).
    // Il fallback resta per le chiavi che in tabella non esistono affatto.
    if (array_key_exists($key, $cache) && $cache[$key] !== null) {
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
        'meta_wa_phone_number_id' => 'META_WA_PHONE_NUMBER_ID',
        'meta_wa_access_token'    => 'META_WA_ACCESS_TOKEN',
        'meta_wa_app_secret'      => 'META_WA_APP_SECRET',
        'meta_wa_verify_token'    => 'META_WA_VERIFY_TOKEN',
        'whatsapp_from'           => 'WHATSAPP_FROM',
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
} // if (!function_exists('getSetting'))

function settingsCacheInvalidate(): void
{
    $GLOBALS['__settings_cache_generation'] = ($GLOBALS['__settings_cache_generation'] ?? 0) + 1;
}

function setSetting(string $key, ?string $value): void
{
    $db = getDB();
    $stmt = $db->prepare(
        'INSERT INTO app_settings (setting_key, setting_value) VALUES (:key, :value)
         ON DUPLICATE KEY UPDATE setting_value = :value2'
    );
    $stmt->execute(['key' => $key, 'value' => $value, 'value2' => $value]);
    settingsCacheInvalidate();
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

// Guarded for the same reason as getSetting() above — tests/bootstrap.php
// pre-defines a stub getMailConfig() before this file is included.
if (!function_exists('getMailConfig')) {
function getMailConfig(): array
{
    return [
        'mail_enabled' => filter_var(getSetting('mail_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
        'agency_name'  => getSetting('agency_name'),
        'agency_email' => getSetting('agency_email'),
        'smtp_host'    => getSetting('smtp_host'),
        // `?:` e non solo il default: una riga vuota in tabella darebbe porta 0.
        'smtp_port'    => (int) (getSetting('smtp_port', '587') ?: '587'),
        'smtp_user'    => getSetting('smtp_user'),
        'smtp_pass'    => getSetting('smtp_pass'),
        'smtp_secure'  => getSetting('smtp_secure', 'tls'),
    ];
}
} // if (!function_exists('getMailConfig'))

/**
 * WhatsApp Business Platform, presa direttamente da Meta (Cloud API).
 *
 * `phone_number_id` NON e' il numero: e' l'identificativo che Meta assegna al
 * mittente e l'unica cosa che finisce nell'URL delle chiamate. Il numero in
 * chiaro (`from`) serve solo a scrivere il mittente in archivio e nella chat.
 */
function getWhatsAppConfig(): array
{
    return [
        'enabled'         => filter_var(getSetting('whatsapp_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
        'phone_number_id' => getSetting('meta_wa_phone_number_id'),
        'access_token'    => getSetting('meta_wa_access_token'),
        'app_secret'      => getSetting('meta_wa_app_secret'),
        'verify_token'    => getSetting('meta_wa_verify_token'),
        'from'            => getSetting('whatsapp_from'),
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

/**
 * I segreti non tornano MAI al browser, nemmeno mascherati dentro il campo:
 * riempire l'input con la maschera faceva sì che un utente che la modificava
 * rispedisse una stringa che inizia con `••••`, che il salvataggio scartava in
 * silenzio annunciando "Impostazioni salvate". Ora il campo resta vuoto e la
 * pagina mostra solo se il segreto c'è (`*_set`) e le sue ultime 4 cifre
 * (`*_hint`), che sono un promemoria, non un valore da rispedire.
 */
const SETTINGS_SECRET_KEYS = [
    'smtp_pass',
    'mailgun_webhook_key',
    'meta_wa_access_token',
    'meta_wa_app_secret',
    'meta_wa_verify_token',
    'backup_s3_secret',
    'meta_app_secret',
];

function maskSecret(?string $value): ?string
{
    if (!$value || strlen($value) < 4) {
        return $value ? '••••' : null;
    }
    return '••••••••' . substr($value, -4);
}

function secretState(string $key): array
{
    $value = (string) getSetting($key, '');
    return [
        $key . '_set'  => $value !== '',
        $key . '_hint' => $value !== '' ? maskSecret($value) : null,
    ];
}

function publicSettingsPayload(): array
{
    return [
        'branding' => getPublicBranding(),
        'mail' => array_merge([
            'mail_enabled'        => filter_var(getSetting('mail_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
            'agency_email'        => getSetting('agency_email'),
            'smtp_host'           => getSetting('smtp_host'),
            'smtp_port'           => (int) (getSetting('smtp_port', '587') ?: '587'),
            'smtp_user'           => getSetting('smtp_user'),
            'smtp_secure'         => getSetting('smtp_secure', 'tls'),
        ], secretState('smtp_pass'), secretState('mailgun_webhook_key')),
        'whatsapp' => array_merge([
            'whatsapp_enabled'        => filter_var(getSetting('whatsapp_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
            'meta_wa_phone_number_id' => getSetting('meta_wa_phone_number_id'),
            'whatsapp_from'           => getSetting('whatsapp_from'),
        ], secretState('meta_wa_access_token'), secretState('meta_wa_app_secret'), secretState('meta_wa_verify_token')),
        'backup' => array_merge([
            'backup_cloud_enabled' => filter_var(getSetting('backup_cloud_enabled', 'false'), FILTER_VALIDATE_BOOLEAN),
            'backup_s3_endpoint'   => getSetting('backup_s3_endpoint'),
            'backup_s3_bucket'     => getSetting('backup_s3_bucket'),
            'backup_s3_region'     => getSetting('backup_s3_region'),
            'backup_s3_key'        => getSetting('backup_s3_key'),
            'backup_s3_prefix'     => getSetting('backup_s3_prefix'),
        ], secretState('backup_s3_secret')),
        'meta' => array_merge([
            'meta_app_id' => getSetting('meta_app_id'),
        ], secretState('meta_app_secret')),
        'fatturazione' => [
            'agency_piva'           => getSetting('agency_piva'),
            'agency_cf'             => getSetting('agency_cf'),
            'agency_denominazione'  => getSetting('agency_denominazione'),
            'agency_regime_fiscale' => getSetting('agency_regime_fiscale', 'RF01'),
            'agency_indirizzo'      => getSetting('agency_indirizzo'),
            'agency_cap'            => getSetting('agency_cap'),
            'agency_comune'         => getSetting('agency_comune'),
            'agency_provincia'      => getSetting('agency_provincia'),
            'agency_pec'            => getSetting('agency_pec'),
            'agency_iban'           => getSetting('agency_iban'),
            'agency_sepa_creditor_id' => getSetting('agency_sepa_creditor_id'),
        ],
    ];
}

// ---------------------------------------------------------------------------
// Normalizzazione e validazione dei valori in ingresso
//
// Questi campi non restano nel database: finiscono nell'XML FatturaPA, nel file
// pain.008 che va in banca, nella connessione SMTP. Un IBAN con una cifra
// sbagliata non dà errore qui — lo dà la banca, giorni dopo, rifiutando l'intero
// flusso di incasso. Per questo il controllo sta nel momento in cui il dato
// viene scritto, non nel momento in cui viene usato.
// ---------------------------------------------------------------------------

const SETTINGS_REGIMI_FISCALI = ['RF01', 'RF02', 'RF04', 'RF18', 'RF19'];

/**
 * Ripulisce i valori PRIMA della validazione: maiuscole dove sono obbligatorie
 * (P.IVA, provincia, IBAN), spazi interni via, prefissi normalizzati. Così
 * "it60 x054 2811 1010 0000 0123 456" e "IT60X0542811101000000123456" sono lo
 * stesso IBAN, e l'utente non deve indovinare il formato.
 */
function normalizeSettings(array $pairs): array
{
    $upperNoSpace = ['agency_piva', 'agency_cf', 'agency_provincia', 'agency_iban', 'agency_sepa_creditor_id'];
    foreach ($upperNoSpace as $key) {
        if (isset($pairs[$key])) {
            $pairs[$key] = strtoupper(preg_replace('/\s+/', '', (string) $pairs[$key]));
        }
    }

    if (isset($pairs['agency_cap'])) {
        $pairs['agency_cap'] = preg_replace('/\D/', '', (string) $pairs['agency_cap']);
    }

    foreach (['primary_color', 'sidebar_color'] as $key) {
        if (isset($pairs[$key]) && $pairs[$key] !== '') {
            $color = strtolower(trim((string) $pairs[$key]));
            $pairs[$key] = str_starts_with($color, '#') ? $color : '#' . $color;
        }
    }

    foreach (['agency_email', 'agency_pec'] as $key) {
        if (isset($pairs[$key])) {
            $pairs[$key] = strtolower(trim((string) $pairs[$key]));
        }
    }

    // Il numero si scrive in E.164. Il prefisso `whatsapp:` non serve a Meta
    // (era la forma di Twilio), ma chi lo incolla dalla vecchia configurazione
    // non deve vedersi rifiutare il campo.
    if (isset($pairs['whatsapp_from'])) {
        $from = preg_replace('/\s+/', '', (string) $pairs['whatsapp_from']);
        $from = preg_replace('/^whatsapp:/i', '', $from);
        $pairs['whatsapp_from'] = $from;
    }

    // L'identificativo del mittente e' solo cifre: incollarlo da Meta si porta
    // dietro spazi, e un ID con uno spazio dentro fa fallire ogni invio con un
    // 404 di Graph che non dice nulla di utile.
    if (isset($pairs['meta_wa_phone_number_id'])) {
        $pairs['meta_wa_phone_number_id'] = preg_replace('/\D+/', '', (string) $pairs['meta_wa_phone_number_id']);
    }

    // La chiave S3 è un percorso: senza `/` finale i backup finiscono in una
    // cartella con il nome incollato al file.
    if (isset($pairs['backup_s3_prefix']) && $pairs['backup_s3_prefix'] !== '') {
        $pairs['backup_s3_prefix'] = ltrim(rtrim(trim((string) $pairs['backup_s3_prefix']), '/'), '/') . '/';
    }

    if (isset($pairs['backup_s3_endpoint'])) {
        $pairs['backup_s3_endpoint'] = rtrim(trim((string) $pairs['backup_s3_endpoint']), '/');
    }

    return $pairs;
}

/**
 * @return array<string,string> chiave impostazione => messaggio d'errore.
 *                              Vuoto = tutto valido.
 */
function validateSettings(array $pairs): array
{
    $errors = [];
    $has    = static fn(string $k): bool => array_key_exists($k, $pairs);
    $val    = static fn(string $k): string => trim((string) ($pairs[$k] ?? ''));

    if ($has('agency_name') && $val('agency_name') === '') {
        $errors['agency_name'] = 'Il nome agenzia non può restare vuoto.';
    }

    foreach (['primary_color' => 'Colore primario', 'sidebar_color' => 'Colore sidebar'] as $key => $label) {
        if ($has($key) && $val($key) !== '' && !preg_match('/^#[0-9a-f]{6}$/i', $val($key))) {
            $errors[$key] = "{$label}: usa un colore esadecimale, es. #206bac.";
        }
    }

    foreach (['agency_email' => 'Email agenzia', 'agency_pec' => 'PEC'] as $key => $label) {
        if ($has($key) && $val($key) !== '' && !filter_var($val($key), FILTER_VALIDATE_EMAIL)) {
            $errors[$key] = "{$label}: indirizzo non valido.";
        }
    }

    if ($has('smtp_port')) {
        $port = $val('smtp_port');
        if ($port === '' || !ctype_digit($port) || (int) $port < 1 || (int) $port > 65535) {
            $errors['smtp_port'] = 'Porta SMTP: un numero tra 1 e 65535 (di norma 587).';
        }
    }

    if ($has('smtp_secure') && !in_array($val('smtp_secure'), ['tls', 'ssl', ''], true)) {
        $errors['smtp_secure'] = 'Sicurezza SMTP non valida.';
    }

    // Il valore che conta è quello che resterà DOPO il salvataggio: se il campo
    // arriva nella richiesta vince quello, altrimenti quello già memorizzato.
    // Serve nei due sensi — attivare una funzione senza le sue credenziali, e
    // svuotare una credenziale mentre la funzione è attiva.
    $effective = static function (string $key) use ($pairs): string {
        return array_key_exists($key, $pairs)
            ? trim((string) $pairs[$key])
            : (string) getSetting($key, '');
    };
    $effectiveFlag = static function (string $key) use ($pairs): bool {
        $raw = array_key_exists($key, $pairs) ? $pairs[$key] : getSetting($key, 'false');
        return filter_var($raw, FILTER_VALIDATE_BOOLEAN);
    };
    // Il controllo di coerenza riguarda SOLO la sezione che si sta salvando:
    // altrimenti salvando Fatturazione si riceveva un errore su smtp_host, un
    // campo che quel modulo non contiene e che l'utente non può correggere lì.
    $touches = static function (array $keys) use ($pairs): bool {
        return (bool) array_intersect($keys, array_keys($pairs));
    };

    // Invio reale senza host SMTP: il messaggio partirebbe con mail() di PHP,
    // che su questo server non è configurato. Meglio dirlo adesso.
    if ($touches(['mail_enabled', 'smtp_host', 'agency_email', 'smtp_user', 'smtp_pass', 'smtp_port', 'smtp_secure'])
        && $effectiveFlag('mail_enabled')) {
        if ($effective('smtp_host') === '') {
            $errors['smtp_host'] = 'Con l\'invio reale attivo serve un host SMTP.';
        }
        if ($effective('agency_email') === '') {
            $errors['agency_email'] = 'Con l\'invio reale attivo serve l\'email dell\'agenzia.';
        }
    }

    if ($has('whatsapp_from') && $val('whatsapp_from') !== ''
        && !preg_match('/^\+[1-9]\d{7,14}$/', $val('whatsapp_from'))) {
        $errors['whatsapp_from'] = 'Numero WhatsApp in formato internazionale, es. +393331234567.';
    }

    if ($touches(['whatsapp_enabled', 'meta_wa_phone_number_id', 'meta_wa_access_token', 'meta_wa_app_secret', 'meta_wa_verify_token', 'whatsapp_from'])
        && $effectiveFlag('whatsapp_enabled')) {
        $required = [
            'meta_wa_phone_number_id' => 'Phone number ID',
            'meta_wa_access_token'    => 'Token di accesso',
            // Senza app secret la firma dei webhook non e' verificabile, e
            // whatsapp_webhook.php in produzione rifiuta tutto: WhatsApp
            // sembrerebbe attivo e non arriverebbe un solo messaggio.
            'meta_wa_app_secret'      => 'App secret',
            'meta_wa_verify_token'    => 'Verify token',
            'whatsapp_from'           => 'Numero WhatsApp',
        ];
        foreach ($required as $key => $label) {
            if ($effective($key) === '') {
                $errors[$key] = "{$label}: obbligatorio finché WhatsApp è attivo.";
            }
        }
    }

    if ($has('backup_s3_endpoint') && $val('backup_s3_endpoint') !== ''
        && !filter_var($val('backup_s3_endpoint'), FILTER_VALIDATE_URL)) {
        $errors['backup_s3_endpoint'] = 'Endpoint: URL completo, es. https://s3.eu-central-1.amazonaws.com.';
    }

    if ($touches(['backup_cloud_enabled', 'backup_s3_endpoint', 'backup_s3_bucket', 'backup_s3_key', 'backup_s3_secret', 'backup_s3_region', 'backup_s3_prefix'])
        && $effectiveFlag('backup_cloud_enabled')) {
        $required = [
            'backup_s3_endpoint' => 'Endpoint',
            'backup_s3_bucket'   => 'Bucket',
            'backup_s3_key'      => 'Access Key',
            'backup_s3_secret'   => 'Secret Key',
        ];
        foreach ($required as $key => $label) {
            if ($effective($key) === '') {
                $errors[$key] = "{$label}: obbligatorio finché il backup su cloud è attivo.";
            }
        }
    }

    if ($has('meta_app_id') && $val('meta_app_id') !== '' && !ctype_digit($val('meta_app_id'))) {
        $errors['meta_app_id'] = 'Meta App ID: solo cifre.';
    }

    if ($has('agency_regime_fiscale') && !in_array($val('agency_regime_fiscale'), SETTINGS_REGIMI_FISCALI, true)) {
        $errors['agency_regime_fiscale'] = 'Regime fiscale non valido.';
    }

    if ($has('agency_piva') && $val('agency_piva') !== '' && !isValidPartitaIva($val('agency_piva'))) {
        $errors['agency_piva'] = 'Partita IVA: 11 cifre con codice di controllo valido.';
    }

    if ($has('agency_cf') && $val('agency_cf') !== '' && !isValidCodiceFiscaleAgenzia($val('agency_cf'))) {
        $errors['agency_cf'] = 'Codice fiscale: 16 caratteri (persona fisica) o 11 cifre (società).';
    }

    if ($has('agency_cap') && $val('agency_cap') !== '' && !preg_match('/^\d{5}$/', $val('agency_cap'))) {
        $errors['agency_cap'] = 'CAP: 5 cifre.';
    }

    if ($has('agency_provincia') && $val('agency_provincia') !== '' && !preg_match('/^[A-Z]{2}$/', $val('agency_provincia'))) {
        $errors['agency_provincia'] = 'Provincia: sigla di 2 lettere, es. MC.';
    }

    if ($has('agency_iban') && $val('agency_iban') !== '' && !isValidIban($val('agency_iban'))) {
        $errors['agency_iban'] = 'IBAN non valido (codice di controllo errato).';
    }

    if ($has('agency_sepa_creditor_id') && $val('agency_sepa_creditor_id') !== ''
        && !isValidSepaCreditorId($val('agency_sepa_creditor_id'))) {
        $errors['agency_sepa_creditor_id'] = 'Identificativo Creditore SEPA non valido: le due cifre di controllo non tornano (es. valido: IT79ZZZA1B02C34D56E78F90).';
    }

    return $errors;
}

/** Resto della divisione per 97 su una stringa numerica lunga (niente bcmath). */
function iso7064Mod97(string $digits): int
{
    $remainder = 0;
    foreach (str_split($digits) as $digit) {
        $remainder = ($remainder * 10 + (int) $digit) % 97;
    }
    return $remainder;
}

/** Converte le lettere in numeri secondo lo schema IBAN: A=10 … Z=35. */
function alphaToDigits(string $value): string
{
    $out = '';
    foreach (str_split($value) as $char) {
        $out .= ctype_alpha($char) ? (string) (ord($char) - 55) : $char;
    }
    return $out;
}

/**
 * Delega a lib/sepa_sdd.php: quel controllo conosce anche la lunghezza
 * registrata per ogni paese ed è lo stesso che gira prima dell'export pain.008.
 * Due implementazioni dell'IBAN vorrebbero dire un IBAN accettato qui e
 * rifiutato là — l'inclusione è pigra perché settings.php lo carica ovunque.
 */
function isValidIban(string $iban): bool
{
    require_once __DIR__ . '/../lib/sepa_sdd.php';
    return sepaIbanIsValid($iban);
}

/**
 * Identificativo Creditore SEPA: paese + 2 cifre di controllo + 3 caratteri di
 * "business code" (che NON entrano nel calcolo) + identificativo nazionale.
 */
function isValidSepaCreditorId(string $cid): bool
{
    $cid = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $cid));
    if (!preg_match('/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/', $cid)) {
        return false;
    }
    $national = substr($cid, 7);
    return iso7064Mod97(alphaToDigits($national . substr($cid, 0, 4))) === 1;
}

/** Codice di controllo della partita IVA italiana (11 cifre, algoritmo di Luhn). */
function isValidPartitaIva(string $piva): bool
{
    if (!preg_match('/^\d{11}$/', $piva)) {
        return false;
    }
    $sum = 0;
    for ($i = 0; $i < 10; $i++) {
        $digit = (int) $piva[$i];
        if ($i % 2 === 1) {
            $digit *= 2;
            if ($digit > 9) {
                $digit -= 9;
            }
        }
        $sum += $digit;
    }
    return ((10 - $sum % 10) % 10) === (int) $piva[10];
}

/** Le società usano la P.IVA come codice fiscale: entrambe le forme sono valide. */
function isValidCodiceFiscaleAgenzia(string $cf): bool
{
    if (preg_match('/^\d{11}$/', $cf)) {
        return isValidPartitaIva($cf);
    }
    return (bool) preg_match('/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/', $cf);
}

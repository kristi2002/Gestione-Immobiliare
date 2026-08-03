<?php
/**
 * Meta Graph API — scheduled-post processing and token-expiry email alerts.
 * Included by config/meta.php.
 */

require_once __DIR__ . '/../env.php';
// L'avviso di token scaduto lo manda il cron (cron/publish_social_posts.php),
// che carica solo env + db + meta.php: senza queste due righe sendHtmlEmail() e
// getSetting() non esistevano e l'avviso finiva nel solo error_log. L'agenzia
// non veniva mai informata che i post avevano smesso di pubblicarsi.
require_once __DIR__ . '/../settings.php';
require_once __DIR__ . '/../mail_html.php';

/**
 * Process all scheduled posts that are due.
 */
function processDueSocialPosts(PDO $db): array
{
    $stmt = $db->prepare(
        "SELECT * FROM social_posts
         WHERE status = 'scheduled' AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC"
    );
    $stmt->execute();
    $due = $stmt->fetchAll();

    $results = [];
    foreach ($due as $post) {
        $results[] = publishAndUpdatePost($db, $post);
    }

    return ['processed' => count($results), 'results' => $results];
}

function publishAndUpdatePost(PDO $db, array $post): array
{
    $result = publishSocialPost($db, $post);

    if ($result['success']) {
        // A integrazione Meta spenta publishSocialPost() risponde success con
        // simulated=true e identificativi inventati: niente e' uscito. Scrivere
        // 'published' riempiva lo storico — l'unico posto dove l'agenzia
        // verifica cosa e' stato pubblicato — di annunci che nessuno ha visto,
        // e una volta collegato Meta sarebbero rimasti li' indistinguibili da
        // quelli veri. Vedi phase89.
        $publishStatus = !empty($result['simulated']) ? 'simulated' : 'published';

        // `error_message = NULL` cancellava il motivo di un invio solo parziale
        // (Facebook sì, Instagram no): la riga risultava pubblicata e nessuno
        // poteva più sapere che metà annuncio non era uscito, né perché.
        $update = $db->prepare(
            "UPDATE social_posts
             SET status = :status, published_at = NOW(),
                 facebook_post_id = :fb_id, instagram_media_id = :ig_id,
                 error_message = :error
             WHERE id = :id"
        );
        $update->execute([
            'id'     => $post['id'],
            'status' => $publishStatus,
            'fb_id'  => $result['facebook_post_id'],
            'ig_id'  => $result['instagram_media_id'],
            'error'  => $result['error'],
        ]);

        // Un canale caduto per token scaduto va segnalato anche quando l'altro
        // è passato, altrimenti l'avviso arriva solo quando falliscono entrambi.
        if (!empty($result['error']) && isMetaTokenExpiredError($result['error'])) {
            sendMetaTokenExpiryAlert($db, $result['error']);
        }

        return [
            'id'        => $post['id'],
            'status'    => $publishStatus,
            'partial'   => !empty($result['partial']),
            'error'     => $result['error'],
            'simulated' => $result['simulated'],
        ];
    }

    $update = $db->prepare(
        "UPDATE social_posts SET status = 'failed', error_message = :error WHERE id = :id"
    );
    $update->execute(['id' => $post['id'], 'error' => $result['error']]);

    // ── Token expiry alert ───────────────────────────────────────────────────
    if (!empty($result['error']) && isMetaTokenExpiredError($result['error'])) {
        sendMetaTokenExpiryAlert($db, $result['error']);
    }

    return [
        'id'     => $post['id'],
        'status' => 'failed',
        'error'  => $result['error'],
    ];
}

/**
 * Detect Meta token expiry / invalid-token errors from the API response.
 * Meta returns error.code = 190 for OAuth token problems.
 */
function isMetaTokenExpiredError(string $error): bool
{
    $tokenKeywords = [
        'error code 190',
        'invalid oauth',
        'session has expired',
        'token has expired',
        'access token',
        'oauth',
        'login',
        'relogin',
        'invalid_token',
        'token expired',
    ];
    $lower = strtolower($error);
    foreach ($tokenKeywords as $kw) {
        if (str_contains($lower, $kw)) {
            return true;
        }
    }
    return false;
}

/**
 * Email the admin once per 24 h when Meta token errors are detected.
 * Usa la chiave `meta_token_alert_last_sent` in app_settings per limitare gli invii.
 *
 * La tabella si chiama app_settings (colonne setting_key/setting_value): qui si
 * leggeva e scriveva `settings.key_name`, che non esiste. Entrambe le query
 * fallivano dentro un catch silenzioso, quindi il limite di 24 ore non ha mai
 * funzionato: a token scaduto l'avviso partiva a OGNI giro del cron social.
 */
function sendMetaTokenExpiryAlert(PDO $db, string $errorDetail): void
{
    // Rate-limit: send at most once every 24 hours
    if (function_exists('getSetting')) {
        $lastSentRaw = getSetting('meta_token_alert_last_sent');
        if (!empty($lastSentRaw)) {
            $lastSent = strtotime($lastSentRaw);
            if ($lastSent !== false && (time() - $lastSent) < 86400) {
                return; // Already alerted within last 24 h
            }
        }
    }

    // Only send if mail is available
    if (!function_exists('sendHtmlEmail') || !function_exists('getSetting')) {
        error_log('[meta] Token expiry detected but mail not available. Error: ' . $errorDetail);
        return;
    }

    $agencyName   = getSetting('agency_name', 'Gestionale Immobiliare');
    $adminEmail   = getSetting('admin_email') ?: getSetting('agency_email', '');
    // Questo avviso lo manda cron/publish_social_posts.php, dove la costante non
    // esiste: l'unica istruzione utile del messaggio ("accedi al gestionale")
    // arrivava senza indirizzo.
    $appUrl       = appBaseUrl();

    if (!$adminEmail) {
        error_log('[meta] Token expiry detected but no admin_email configured.');
        return;
    }

    $subject = "⚠️ {$agencyName} — Token Meta scaduto, ri-connessione necessaria";
    $body    = "Gentile amministratore,\n\n"
             . "La pubblicazione automatica sui social ({$agencyName}) ha rilevato un errore di autenticazione "
             . "con le API di Meta (Facebook / Instagram):\n\n"
             . "  {$errorDetail}\n\n"
             . "Questo accade quando il token Meta è scaduto o è stato revocato.\n\n"
             . "Cosa fare:\n"
             . "1. Accedi al gestionale: {$appUrl}\n"
             . "2. Vai su Social Media → Impostazioni\n"
             . "3. Clicca «Connetti con Facebook» per rinnovare il token\n\n"
             . "Fino alla ri-connessione i post programmati falliranno.\n\n"
             . "— Sistema automatico {$agencyName}";

    sendHtmlEmail($adminEmail, $subject, $body);

    // Record timestamp so we don't spam
    if (function_exists('setSetting')) {
        try {
            setSetting('meta_token_alert_last_sent', date('Y-m-d H:i:s'));
        } catch (Throwable) {
            // Ignore — alert was still sent
        }
    }
}

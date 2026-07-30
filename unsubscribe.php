<?php
/**
 * Disiscrizione dalle comunicazioni commerciali — pagina PUBBLICA.
 *
 * GET  /unsubscribe.php?token=...  → pagina di conferma, NESSUN effetto
 * POST /unsubscribe.php            → revoca il consenso
 *
 * Perché il GET non revoca niente: i filtri antispam, gli antivirus aziendali e
 * l'anteprima dei link di Gmail APRONO gli indirizzi contenuti nelle email per
 * controllarli. Se bastasse una GET, quei controlli automatici disiscriverebbero
 * le persone a loro insaputa e nessuno capirebbe perché le liste si svuotano.
 * Serve quindi un secondo passaggio esplicito.
 *
 * Il POST vale anche come endpoint "One-Click" (RFC 8058), quello che Gmail e
 * Outlook chiamano dal pulsante "Annulla iscrizione" vicino al mittente: per
 * questo NON richiede né sessione né token CSRF — chi lo chiama è il provider di
 * posta, non il browser dell'utente. L'autorizzazione è la firma del token.
 */

require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/settings.php';
require_once __DIR__ . '/config/consent.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$token  = trim($_REQUEST['token'] ?? '');

$branding = getPublicBranding();
$agency   = $branding['agency_name'] ?: 'Gestionale Immobiliare';
$color    = $branding['primary_color'] ?: '#206bac';

/** Pagina minima, senza dipendenze: deve aprirsi anche fra due anni. */
function unsubscribeRender(string $agency, string $color, string $title, string $bodyHtml, int $httpCode = 200): never
{
    http_response_code($httpCode);
    header('Content-Type: text/html; charset=utf-8');
    // Non deve finire nella cache di nessuno: il contenuto dipende dal token.
    header('Cache-Control: no-store, max-age=0');
    header('X-Robots-Tag: noindex, nofollow');

    $agencyEsc = htmlspecialchars($agency, ENT_QUOTES, 'UTF-8');
    $colorEsc  = htmlspecialchars($color, ENT_QUOTES, 'UTF-8');
    $titleEsc  = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');

    echo <<<HTML
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{$titleEsc} — {$agencyEsc}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:520px">
<tr><td style="background:{$colorEsc};padding:20px 24px;color:#fff;font-size:18px;font-weight:bold">{$agencyEsc}</td></tr>
<tr><td style="padding:28px 24px;color:#334155;line-height:1.6">
<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">{$titleEsc}</h1>
{$bodyHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
HTML;
    exit;
}

try {
    $db = getDB();
} catch (Throwable $e) {
    error_log('[unsubscribe] database non raggiungibile: ' . $e->getMessage());
    unsubscribeRender($agency, $color, 'Servizio non disponibile',
        '<p>Non riusciamo a completare la richiesta in questo momento. Riprova più tardi.</p>', 503);
}

$subject = $token !== '' ? consentUnsubscribeVerify($db, $token) : null;

if ($subject === null) {
    // Nessun dettaglio sul perché: un token non valido e un token per un
    // soggetto inesistente devono raccontare la stessa cosa.
    unsubscribeRender($agency, $color, 'Link non valido',
        '<p>Questo link di disiscrizione non è valido o è stato modificato.</p>'
        . '<p style="color:#64748b;font-size:14px">Se continui a ricevere messaggi indesiderati, rispondi'
        . ' direttamente a una nostra email e provvederemo noi.</p>', 403);
}

if ($method === 'POST') {
    $ok = consentWithdraw(
        $db,
        $subject['subject_type'],
        $subject['subject_id'],
        $subject['purpose'],
        'unsubscribe_link'
    );

    if (!$ok) {
        unsubscribeRender($agency, $color, 'Non ha funzionato',
            '<p>Non siamo riusciti a registrare la disiscrizione. Riprova più tardi.</p>', 500);
    }

    unsubscribeRender($agency, $color, 'Disiscrizione confermata',
        '<p>Non riceverai più comunicazioni commerciali da ' . htmlspecialchars($agency, ENT_QUOTES, 'UTF-8') . '.</p>'
        . '<p style="color:#64748b;font-size:14px">Continuerai a ricevere le comunicazioni legate ai contratti in'
        . ' essere (scadenze, pagamenti, documenti), che non sono messaggi promozionali.</p>');
}

// GET — conferma esplicita, nessun effetto collaterale.
$tokenEsc = htmlspecialchars($token, ENT_QUOTES, 'UTF-8');
unsubscribeRender($agency, $color, 'Confermi la disiscrizione?',
    '<p>Stai per smettere di ricevere comunicazioni commerciali da '
    . htmlspecialchars($agency, ENT_QUOTES, 'UTF-8') . '.</p>'
    . '<form method="post" action="unsubscribe.php" style="margin:24px 0 0">'
    . '<input type="hidden" name="token" value="' . $tokenEsc . '">'
    . '<button type="submit" style="background:' . htmlspecialchars($color, ENT_QUOTES, 'UTF-8')
    . ';color:#fff;border:0;border-radius:6px;padding:12px 20px;font-size:15px;cursor:pointer">'
    . 'Conferma disiscrizione</button>'
    . '</form>'
    . '<p style="color:#64748b;font-size:14px;margin-top:20px">Le comunicazioni legate ai contratti in essere'
    . ' (scadenze, pagamenti, documenti) continueranno ad arrivarti: non sono messaggi promozionali.</p>');

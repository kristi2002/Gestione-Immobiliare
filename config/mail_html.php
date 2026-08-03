<?php
/**
 * Branded HTML email wrapper for cron and notifications.
 */

require_once __DIR__ . '/env.php';
require_once __DIR__ . '/settings.php';

/**
 * $footerHtml è HTML GIÀ pronto, aggiunto in fondo al piè di pagina: serve al
 * link di disiscrizione, che deve stare dentro il messaggio e non può passare
 * da $bodyText (che viene escapato riga per riga, giustamente).
 */
function wrapHtmlEmail(string $subject, string $bodyText, string $footerHtml = ''): string
{
    $branding = getPublicBranding();
    $agency   = htmlspecialchars($branding['agency_name'] ?: 'Gestionale Immobiliare', ENT_QUOTES, 'UTF-8');
    $color    = htmlspecialchars($branding['primary_color'] ?? '#2563eb', ENT_QUOTES, 'UTF-8');
    $logo     = trim((string) ($branding['logo_path'] ?? ''));
    $logoHtml = '';

    // Il logo va indirizzato in modo ASSOLUTO. `logo_path` è un percorso
    // relativo al sito ("assets/img/orlandi_logo.jpg") e dentro un client di
    // posta non c'è alcuna pagina rispetto a cui risolverlo: finiva in OGNI
    // email come immagine rotta — promemoria, solleciti, reset password,
    // campagne. Se APP_URL non è configurato non si ripiega sul relativo (che è
    // rotto per definizione): si omette il logo e resta il nome dell'agenzia.
    //
    // L'indirizzo si chiede ad appBaseUrl(), non alla costante: questo file lo
    // usano soprattutto i cron, dove la costante non esiste (vedi env.php). Con
    // `defined('APP_URL')` il logo c'era dal browser e spariva da ogni email
    // spedita davvero — cioè da tutte.
    if ($logo !== '') {
        $appBase = appBaseUrl();
        $logoSrc = preg_match('#^https?://#i', $logo) === 1
            ? $logo
            : ($appBase !== '' ? $appBase . '/' . ltrim($logo, '/') : '');

        if ($logoSrc !== '') {
            $logoUrl  = htmlspecialchars($logoSrc, ENT_QUOTES, 'UTF-8');
            $logoHtml = "<img src=\"{$logoUrl}\" alt=\"{$agency}\" style=\"max-height:48px;margin-bottom:16px\">";
        }
    }

    $paragraphs = '';
    foreach (preg_split('/\r\n|\r|\n/', trim($bodyText)) as $line) {
        if ($line === '') {
            $paragraphs .= '<br>';
            continue;
        }
        $paragraphs .= '<p style="margin:0 0 12px;line-height:1.5;color:#334155">'
            . htmlspecialchars($line, ENT_QUOTES, 'UTF-8') . '</p>';
    }

    $subjectEsc = htmlspecialchars($subject, ENT_QUOTES, 'UTF-8');
    $footerExtra = $footerHtml !== '' ? '<div style="margin-top:8px">' . $footerHtml . '</div>' : '';

    return <<<HTML
<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><title>{$subjectEsc}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px">
<tr><td style="background:{$color};padding:20px 24px;color:#fff;font-size:18px;font-weight:bold">
{$logoHtml}{$agency}
</td></tr>
<tr><td style="padding:24px">{$paragraphs}</td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0">
Messaggio automatico da {$agency}. Non rispondere a questa email se non necessario.{$footerExtra}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
HTML;
}

function sendHtmlEmail(string $to, string $subject, string $bodyText, array $attachments = []): array
{
    $html = wrapHtmlEmail($subject, $bodyText);
    return sendClientEmail($to, $subject, $bodyText, $html, $attachments);
}

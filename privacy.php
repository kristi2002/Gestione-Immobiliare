<?php
/**
 * Privacy notice (Informativa privacy — GDPR Art. 13/14). Public page.
 * Agency identity is pulled from settings so it stays correct per deployment.
 */
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/settings.php';

$b            = getPublicBranding();
$agencyName   = $b['agency_name'] ?? 'Agenzia Immobiliare';
$agencyEmail  = getSetting('agency_email') ?: 'privacy@agenzia.it';
$updated      = date('d/m/Y');
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Informativa Privacy — <?= htmlspecialchars($agencyName) ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="branding.css.php">
    <style>
        .legal { max-width: 820px; margin: 0 auto; padding: 40px 24px 80px; line-height: 1.65; }
        .legal h1 { margin-bottom: 8px; }
        .legal h2 { margin-top: 32px; }
        .legal .muted { color: var(--color-text-muted, #667); }
        .legal ul { padding-left: 22px; }
    </style>
</head>
<body>
<div class="legal">
    <h1>Informativa sul trattamento dei dati personali</h1>
    <p class="muted">Ai sensi degli artt. 13 e 14 del Regolamento (UE) 2016/679 (GDPR) · Aggiornata il <?= $updated ?></p>

    <h2>1. Titolare del trattamento</h2>
    <p><strong><?= htmlspecialchars($agencyName) ?></strong>. Per ogni richiesta relativa ai dati personali è
       possibile scrivere a <a href="mailto:<?= htmlspecialchars($agencyEmail) ?>"><?= htmlspecialchars($agencyEmail) ?></a>.</p>

    <h2>2. Dati trattati</h2>
    <p>Dati anagrafici e di contatto (nome, cognome, codice fiscale, email, telefono), dati contrattuali e di
       pagamento, documenti caricati (es. documenti d'identità, contratti) e comunicazioni intercorse.</p>

    <h2>3. Finalità e basi giuridiche</h2>
    <ul>
        <li>Gestione di mandati, contratti di locazione/compravendita e adempimenti connessi — <em>esecuzione di un contratto</em> (art. 6.1.b).</li>
        <li>Adempimenti fiscali, contabili e di legge — <em>obbligo legale</em> (art. 6.1.c).</li>
        <li>Comunicazioni operative e assistenza — <em>legittimo interesse / contratto</em>.</li>
        <li>Comunicazioni promozionali, ove previste — <em>consenso</em> (art. 6.1.a), revocabile in qualsiasi momento.</li>
    </ul>

    <h2>4. Conservazione</h2>
    <p>I dati sono conservati per il tempo necessario alle finalità e nel rispetto degli obblighi di legge
       (di norma 10 anni per la documentazione fiscale/contrattuale). Scaduti i termini, i dati sono cancellati
       o anonimizzati secondo la politica di retention del Titolare.</p>

    <h2>5. Destinatari e trasferimenti</h2>
    <p>I dati possono essere trattati da fornitori che agiscono come responsabili del trattamento (es. hosting,
       posta elettronica, messaggistica, pagamenti), nominati ai sensi dell'art. 28 GDPR. Non è previsto alcun
       trasferimento extra-UE senza adeguate garanzie.</p>

    <h2>6. Diritti dell'interessato</h2>
    <p>L'interessato può esercitare i diritti di accesso, rettifica, cancellazione, limitazione, portabilità e
       opposizione (artt. 15–22 GDPR), nonché revocare il consenso e proporre reclamo al Garante per la protezione
       dei dati personali. Le richieste vanno inviate a
       <a href="mailto:<?= htmlspecialchars($agencyEmail) ?>"><?= htmlspecialchars($agencyEmail) ?></a>.</p>

    <h2>7. Cookie</h2>
    <p>La piattaforma utilizza esclusivamente cookie tecnici necessari al funzionamento (gestione della sessione).
       Non vengono utilizzati cookie di profilazione senza consenso.</p>

    <p class="muted" style="margin-top:40px"><a href="javascript:history.back()">← Torna indietro</a></p>
</div>
</body>
</html>

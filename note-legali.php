<?php
/**
 * Note legali — pagina pubblica.
 *
 * Nasce perche' il footer del sito vetrina la linkava con `href="#"`: un link
 * morto in mezzo a Privacy e Cookie, cioe' esattamente dove un visitatore va a
 * cercare chi c'e' dietro il sito. Per un'agenzia immobiliare l'identificazione
 * del titolare e i dati REA/iscrizione non sono cortesia: sono obblighi
 * (art. 7 D.Lgs. 70/2003 per il commercio elettronico, e la disciplina degli
 * agenti d'affari in mediazione).
 *
 * Cio' che il gestionale sa lo prende dalle impostazioni; cio' che non puo'
 * sapere — P.IVA, REA, polizza — lo DICHIARA mancante invece di stampare un
 * segnaposto che sembra un dato. Un "12345678" finto in una nota legale e'
 * peggio del vuoto: sembra compilato.
 */
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/settings.php';

$b           = getPublicBranding();
$agencyName  = $b['agency_name'] ?? 'Agenzia Immobiliare';
$agencyEmail = getSetting('agency_email') ?: '';
$agencyPhone = getSetting('agency_phone') ?: '';

// Le chiavi sono quelle che l'applicazione usa DAVVERO: la denominazione e la
// sede legale stanno in Impostazioni → Fatturazione (le stesse che finiscono
// nell'XML FatturaPA), non fra i dati di contatto. Inventare `agency_vat`
// avrebbe prodotto una nota legale eternamente vuota accanto a una fattura
// elettronica compilata con la stessa informazione.
$legalName   = getSetting('agency_denominazione') ?: $agencyName;
$agencyVat   = getSetting('agency_piva') ?: '';
$agencyCf    = getSetting('agency_cf') ?: '';
$agencyPec   = getSetting('agency_pec') ?: '';

// Sede: si preferisce quella fiscale, spezzata nelle sue parti; se non c'e' si
// ricade sull'indirizzo di contatto.
$fiscalSeat = trim(implode(' ', array_filter([
    getSetting('agency_indirizzo') ?: '',
    getSetting('agency_cap') ?: '',
    getSetting('agency_comune') ?: '',
    ($p = getSetting('agency_provincia')) ? "($p)" : '',
])));
$agencyAddr = $fiscalSeat !== '' ? $fiscalSeat : (getSetting('agency_address') ?: '');

// Il REA non ha (ancora) un campo in Impostazioni: la chiave si legge comunque,
// cosi' il giorno che viene aggiunta la pagina si compila da sola.
$agencyRea   = getSetting('agency_rea') ?: '';
$updated     = date('d/m/Y');

/** Un dato assente si vede: si scrive "da completare", non un segnaposto. */
function legalValue(string $v): string
{
    return $v !== ''
        ? htmlspecialchars($v)
        : '<em class="todo">da completare nelle impostazioni</em>';
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Note legali — <?= htmlspecialchars($agencyName) ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="branding.css.php">
    <style>
        .legal { max-width: 820px; margin: 0 auto; padding: 40px 24px 80px; line-height: 1.65; }
        .legal h1 { margin-bottom: 8px; }
        .legal h2 { margin-top: 32px; }
        .legal .muted { color: var(--color-text-muted, #667); }
        .legal ul { padding-left: 22px; }
        .legal dt { font-weight: 600; margin-top: 10px; }
        .legal dd { margin: 0 0 0 0; }
        .legal .todo { color: #b45309; font-style: italic; }
    </style>
</head>
<body>
<div class="legal">
    <h1>Note legali</h1>
    <p class="muted">Aggiornate il <?= $updated ?></p>

    <h2>1. Titolare del sito</h2>
    <dl>
        <dt>Denominazione</dt><dd><?= htmlspecialchars($legalName) ?></dd>
        <dt>Sede</dt><dd><?= legalValue($agencyAddr) ?></dd>
        <dt>Partita IVA</dt><dd><?= legalValue($agencyVat) ?></dd>
        <dt>Codice fiscale</dt><dd><?= legalValue($agencyCf) ?></dd>
        <dt>Iscrizione REA / CCIAA</dt><dd><?= legalValue($agencyRea) ?></dd>
        <dt>Email</dt>
        <dd><?= $agencyEmail !== ''
                ? '<a href="mailto:' . htmlspecialchars($agencyEmail) . '">' . htmlspecialchars($agencyEmail) . '</a>'
                : legalValue('') ?></dd>
        <?php if ($agencyPec !== ''): ?>
        <dt>PEC</dt><dd><?= htmlspecialchars($agencyPec) ?></dd>
        <?php endif; ?>
        <dt>Telefono</dt><dd><?= legalValue($agencyPhone) ?></dd>
    </dl>

    <h2>2. Attività di mediazione</h2>
    <p>L'attività di mediazione immobiliare è svolta ai sensi della L. 39/1989 e successive modifiche.
       Le provvigioni sono dovute alla conclusione dell'affare secondo quanto pattuito nell'incarico
       sottoscritto dalle parti.</p>

    <h2>3. Contenuti e annunci</h2>
    <p>Le informazioni sugli immobili pubblicate su questo sito hanno finalità illustrativa e non
       costituiscono offerta al pubblico ai sensi dell'art. 1336 c.c. Superfici, planimetrie, dati
       catastali e classe energetica sono indicati sulla base della documentazione fornita dalla
       proprietà e vanno verificati in sede di trattativa. Prezzi e disponibilità possono variare
       senza preavviso.</p>

    <h2>4. Proprietà intellettuale</h2>
    <p>Testi, fotografie, planimetrie, marchi e logo presenti sul sito sono di proprietà del
       Titolare o dei rispettivi aventi diritto. Non è consentita la riproduzione, anche parziale,
       senza autorizzazione scritta.</p>

    <h2>5. Limitazione di responsabilità</h2>
    <p>Il Titolare non risponde di eventuali interruzioni del servizio, né dei contenuti di siti
       terzi raggiungibili tramite collegamenti presenti su queste pagine.</p>

    <h2>6. Dati personali e cookie</h2>
    <p>Il trattamento dei dati personali è descritto nell'<a href="privacy.php">informativa privacy</a>;
       i cookie e i servizi di terze parti utilizzati sono elencati nella
       <a href="privacy.php#cookie">sezione cookie</a> della stessa informativa.</p>

    <h2>7. Legge applicabile</h2>
    <p>Al presente sito si applica la legge italiana. Per le controversie con i consumatori è
       competente il foro di residenza o domicilio elettivo del consumatore.</p>

    <p class="muted" style="margin-top:40px"><a href="javascript:history.back()">← Torna indietro</a></p>
</div>
</body>
</html>

<?php
/**
 * Lo schema del database e' rimasto indietro rispetto al codice?
 *
 * La domanda vale una sonda tutta sua perche' la risposta e' stata "si" per
 * cinque giorni senza che nessuno lo sapesse (10 agosto 2026: prod ferma a
 * phase96 mentre il codice usava phase97/98/99). Il controllo, in
 * `api/readiness.php`, funzionava benissimo e diceva `fail` nominando le tre
 * migrazioni mancanti. Nessuno lo guardava.
 *
 * Ed e' il punto: **una sonda che si consulta non e' un allarme.** Perche' quel
 * `fail` fosse letto serviva che qualcuno aprisse Impostazioni → Stato sistema,
 * cioe' proprio la cosa che non si fa quando non si sospetta niente. Da qui
 * dentro invece la deriva va a CERCARE una persona, dal cron che gira ogni ora.
 *
 * Il rilevamento vive qui, e non in `readiness.php`, per l'altra lezione della
 * stessa giornata: una regola chiusa dentro un file che un solo chiamante puo'
 * raggiungere e' una regola che il secondo chiamante riscrivera' — sbagliata.
 * Vedi [[italian-number-parsing]] per l'esempio piu' caro.
 *
 * Cio' che questa sonda NON vede: una migrazione REGISTRATA senza che il suo
 * DDL sia stato applicato (database ripristinato da un dump piu' vecchio). E'
 * gia' successo — `login_attempts.username` — e li' il registro mente. Contro
 * quel caso serve una migrazione di backfill nuova, non un conteggio.
 */

require_once __DIR__ . '/../config/settings.php';

/** Ogni quanto ripetere l'avviso, per non trasformarlo in rumore. */
const SCHEMA_DRIFT_ALERT_INTERVAL_HOURS = 24;

/**
 * Le migrazioni presenti come file ma assenti dal registro.
 *
 * Le esclusioni non sono arbitrarie: `000_helpers` non e' una migrazione ma le
 * procedure che le altre usano, e le fasi fino alla 28 sono dentro
 * `schema_production.sql` (il baseline), quindi non risultano applicate e non
 * devono.
 *
 * @return string[] i nomi delle migrazioni in sospeso, in ordine
 */
function pendingMigrations(PDO $db, ?string $migrationsDir = null): array
{
    $dir = $migrationsDir ?? dirname(__DIR__) . '/database/migrations';

    $applied = array_flip(
        $db->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN)
    );

    $pending = [];
    foreach (glob($dir . '/*.sql') ?: [] as $file) {
        $version = basename($file, '.sql');

        if ($version === '000_helpers' || $version === 'README') continue;
        if (preg_match('/^phase(\d+)/', $version, $m) && (int) $m[1] <= 28) continue;

        if (!isset($applied[$version])) {
            $pending[] = $version;
        }
    }

    sort($pending);
    return $pending;
}

/**
 * Se lo schema e' indietro, lo dice a qualcuno: log di sistema sempre, email
 * all'agenzia una volta al giorno.
 *
 * Non lancia mai e non blocca il chiamante: gira dentro un job del cron che ha
 * altro da fare, e un avviso che fa fallire il lavoro di cui e' ospite sarebbe
 * un secondo problema invece della segnalazione del primo.
 *
 * @return array{drift:bool, pending:string[], notified:bool}
 */
function checkSchemaDrift(PDO $db): array
{
    $out = ['drift' => false, 'pending' => [], 'notified' => false];

    try {
        $pending = pendingMigrations($db);
    } catch (Throwable $e) {
        error_log('[schema] impossibile verificare le migrazioni: ' . $e->getMessage());
        return $out;
    }

    if (!$pending) {
        // Tornata a posto: si azzera il fermo, cosi' la prossima deriva avvisa
        // subito invece di aspettare la fine di una finestra vecchia.
        if (getSetting('schema_drift_alert_last_sent') !== null) {
            setSetting('schema_drift_alert_last_sent', null);
        }
        return $out;
    }

    $out['drift']   = true;
    $out['pending'] = $pending;

    // Il log va sempre: e' la traccia che resta anche se l'email non parte.
    error_log('[schema] MIGRAZIONI NON APPLICATE (' . count($pending) . '): '
        . implode(', ', $pending) . ' — il codice in esecuzione potrebbe usare colonne assenti.');

    $lastRaw = getSetting('schema_drift_alert_last_sent');
    $last    = $lastRaw ? strtotime($lastRaw) : 0;
    if ($last && (time() - $last) < SCHEMA_DRIFT_ALERT_INTERVAL_HOURS * 3600) {
        return $out; // già avvisato di recente
    }

    try {
        require_once __DIR__ . '/../config/mail.php';
        require_once __DIR__ . '/../config/mail_html.php';

        $to = getSetting('agency_email') ?: (string) env('MAIL_FROM', '');
        if ($to === '') {
            return $out; // nessun destinatario configurato: resta il log
        }

        $body = "Il database non ha applicato " . count($pending) . " migrazione/i, "
            . "mentre l'applicazione in esecuzione le presuppone.\n\n"
            . "In sospeso:\n  - " . implode("\n  - ", $pending) . "\n\n"
            . "Conseguenza possibile: le pagine che usano le colonne nuove rispondono con un errore.\n\n"
            . "Come si applica:\n"
            . "  docker exec <container-app> php /var/www/html/database/migrate.php\n\n"
            . "Oppure riavviando il container: l'entrypoint le applica all'avvio.";

        $res = sendHtmlEmail($to, '[Gestionale] Migrazioni database non applicate', $body);
        // `simulated` = mailer spento: non si segna come avvisato, o al primo
        // giro con l'email accesa l'allarme resterebbe muto per 24 ore.
        if (!empty($res['success']) && empty($res['simulated'])) {
            setSetting('schema_drift_alert_last_sent', date('Y-m-d H:i:s'));
            $out['notified'] = true;
        }
    } catch (Throwable $e) {
        error_log('[schema] avviso deriva non inviato: ' . $e->getMessage());
    }

    return $out;
}

<?php

use PHPUnit\Framework\TestCase;

/**
 * Ogni job che scrive un battito dev'essere sorvegliato da readiness.php.
 *
 * Il battito esiste per una ragione precisa: per mesi il filtro sbagliato nel
 * crontab di produzione ha fatto fallire OGNI job senza che nessuno se ne
 * accorgesse, perche' si controllava l'esistenza degli script invece della loro
 * esecuzione. `cronHeartbeat()` e la lista in `api/readiness.php` sono le due
 * meta' di quella lezione — e valgono solo INSIEME.
 *
 * `publish_social_posts` aveva la prima meta' e non la seconda: chiamava
 * cronHeartbeat('social_posts') scrivendo diligentemente in app_settings una
 * riga che nessuna sonda leggeva. Un job cosi' e' sorvegliato peggio di uno
 * senza battito, perche' la pagina Stato sistema dice "Tutti i job cron hanno un
 * heartbeat recente" mentre uno dei sette e' fermo.
 *
 * Questo test e' l'unica cosa che tiene allineate le due liste. Non prova che il
 * cron giri (quello lo dice il battito stesso, in produzione): prova che se gira
 * qualcuno se ne accorgera'.
 */
class CronHeartbeatCoverageTest extends TestCase
{
    /** @return string[] i nomi passati a cronHeartbeat() dagli script in cron/ */
    private function heartbeatsWritten(): array
    {
        $jobs = [];
        foreach (glob(dirname(__DIR__, 2) . '/cron/*.php') ?: [] as $file) {
            $src = (string) file_get_contents($file);
            if (preg_match_all("/cronHeartbeat\(\s*'([a-z0-9_]+)'\s*\)/", $src, $m)) {
                foreach ($m[1] as $job) {
                    $jobs[$job] = basename($file);
                }
            }
        }
        return $jobs;
    }

    /** @return string[] le chiavi di $cronJobs in api/readiness.php */
    private function heartbeatsWatched(): array
    {
        $src = (string) file_get_contents(dirname(__DIR__, 2) . '/api/readiness.php');
        // Il blocco e' un array letterale: si legge senza eseguire readiness.php,
        // che aprirebbe sessione e database.
        if (!preg_match('/\$cronJobs\s*=\s*\[(.*?)\n\];/s', $src, $m)) {
            $this->fail('Non trovo $cronJobs in api/readiness.php: il formato e cambiato, aggiorna questo test.');
        }
        preg_match_all("/'([a-z0-9_]+)'\s*=>/", $m[1], $q);
        return $q[1];
    }

    public function testOgniBattitoScrittoEAncheSorvegliato(): void
    {
        $written = $this->heartbeatsWritten();
        $watched = $this->heartbeatsWatched();

        $this->assertNotEmpty($written, 'Nessun cronHeartbeat() trovato in cron/: la ricerca e rotta.');

        $unwatched = array_diff(array_keys($written), $watched);

        $this->assertSame([], array_values($unwatched), sprintf(
            "Questi job scrivono un battito che nessuno legge: %s.\n" .
            "Aggiungi una riga per ognuno in \$cronJobs (api/readiness.php), " .
            "altrimenti Stato sistema dira' che va tutto bene mentre sono fermi.",
            implode(', ', array_map(
                static fn ($j) => "$j ({$written[$j]})",
                $unwatched
            ))
        ));
    }

    public function testNonSiSorvegliaUnJobCheNonEsiste(): void
    {
        $written = array_keys($this->heartbeatsWritten());
        $watched = $this->heartbeatsWatched();

        $ghosts = array_diff($watched, $written);

        $this->assertSame([], array_values($ghosts), sprintf(
            "readiness.php sorveglia job che nessuno script scrive piu': %s.\n" .
            "Una soglia su un battito che non arrivera' mai produce un warn perenne, " .
            "che si impara a ignorare — e con lui si ignorano gli altri.",
            implode(', ', $ghosts)
        ));
    }
}

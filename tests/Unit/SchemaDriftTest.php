<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/schema_drift.php';

/**
 * La deriva fra schema e codice.
 *
 * Il 10 agosto 2026 la produzione e' stata cinque giorni con tre migrazioni non
 * applicate mentre il codice le presupponeva. Il controllo esisteva e funzionava
 * — diceva `fail` nominando le tre — ma viveva solo dentro una sonda che
 * qualcuno doveva decidere di aprire. Questi test stanno sul conto estratto,
 * quello che ora legge anche il cron.
 *
 * Il filesystem e' vero (una cartella temporanea) e il database e' finto: qui
 * si prova la REGOLA — cosa conta come "in sospeso" — non il driver SQL.
 */
class SchemaDriftTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/zz_migr_' . bin2hex(random_bytes(6));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $f) {
            unlink($f);
        }
        @rmdir($this->dir);
    }

    private function file(string $name): void
    {
        file_put_contents($this->dir . '/' . $name . '.sql', '-- prova');
    }

    /** Un PDO finto che risponde con l'elenco delle migrazioni registrate. */
    private function db(array $applied): PDO
    {
        $stmt = $this->createMock(PDOStatement::class);
        $stmt->method('fetchAll')->willReturn($applied);

        $db = $this->createMock(PDO::class);
        $db->method('query')->willReturn($stmt);

        return $db;
    }

    public function testTrovaLeMigrazioniNonRegistrate(): void
    {
        $this->file('phase97_uno');
        $this->file('phase98_due');
        $this->file('phase99_tre');

        $pending = pendingMigrations($this->db(['phase97_uno']), $this->dir);

        $this->assertSame(['phase98_due', 'phase99_tre'], $pending);
    }

    public function testNessunaDerivaQuandoTuttoEApplicato(): void
    {
        $this->file('phase97_uno');
        $this->file('phase98_due');

        $this->assertSame([], pendingMigrations($this->db(['phase97_uno', 'phase98_due']), $this->dir));
    }

    public function testGliHelperNonSonoUnaMigrazione(): void
    {
        // 000_helpers non e' una migrazione: sono le procedure che le altre usano,
        // e non compare mai nel registro. Contarlo darebbe una deriva perpetua,
        // cioe' un allarme sempre rosso — che e' come nessun allarme.
        $this->file('000_helpers');

        $this->assertSame([], pendingMigrations($this->db([]), $this->dir));
    }

    public function testIlBaselineFinoAllaFase28NonConta(): void
    {
        // Le fasi <= 28 sono dentro schema_production.sql: non risultano
        // applicate e non devono, o ogni installazione da baseline nascerebbe
        // con venti migrazioni "in sospeso" che non esistono.
        $this->file('phase3_property_media');
        $this->file('phase28_qualcosa');
        $this->file('phase29_questa_conta');

        $this->assertSame(['phase29_questa_conta'], pendingMigrations($this->db([]), $this->dir));
    }

    public function testIlReadmeNonEUnaMigrazione(): void
    {
        $this->file('README');
        $this->assertSame([], pendingMigrations($this->db([]), $this->dir));
    }

    public function testLOrdineEStabile(): void
    {
        // L'elenco finisce in un'email e in un messaggio d'errore: due giri
        // devono produrre la stessa frase, o sembra che la situazione cambi.
        $this->file('phase99_tre');
        $this->file('phase97_uno');
        $this->file('phase98_due');

        $this->assertSame(
            ['phase97_uno', 'phase98_due', 'phase99_tre'],
            pendingMigrations($this->db([]), $this->dir)
        );
    }
}

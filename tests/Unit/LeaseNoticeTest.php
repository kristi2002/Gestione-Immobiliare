<?php

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/portal_specs.php';
require_once __DIR__ . '/../../lib/contract_lifecycle.php';

/**
 * Preavviso, rinnovo e la data entro cui va mandata la disdetta.
 *
 * E' la data piu' importante di una locazione e la piu' facile da sbagliare:
 * le scadenze cadono quasi sempre a fine mese, e li' l'aritmetica dei mesi in
 * PHP trabocca (31 agosto meno 6 mesi fa 3 marzo, non 28 febbraio). Sbagliarla
 * sposta il termine dalla parte sbagliata e il contratto si rinnova per altri
 * quattro anni senza che nessuno abbia deciso niente.
 */
class LeaseNoticeTest extends TestCase
{
    // ── Aritmetica dei mesi ──────────────────────────────────────────────

    #[DataProvider('fineMeseProvider')]
    public function testNonTraboccaOltreIlMeseDiArrivo(string $da, int $mesi, string $atteso): void
    {
        $this->assertSame($atteso, contractShiftMonths($da, $mesi));
    }

    public static function fineMeseProvider(): array
    {
        return [
            'agosto -6 → febbraio (non 3 marzo)' => ['2030-08-31', -6, '2030-02-28'],
            'marzo -1 → febbraio'                => ['2030-03-31', -1, '2030-02-28'],
            'bisestile: agosto -6 → 29 feb'      => ['2028-08-31', -6, '2028-02-29'],
            'gennaio -1 → dicembre anno prima'   => ['2030-01-31', -1, '2029-12-31'],
            'gennaio +1 → febbraio'              => ['2030-01-31', 1,  '2030-02-28'],
            'settembre +48 (rinnovo 4 anni)'     => ['2030-08-31', 48, '2034-08-31'],
            'zero mesi non muove nulla'          => ['2030-08-31', 0,  '2030-08-31'],
            'giorno basso: nessun taglio'        => ['2030-08-15', -6, '2030-02-15'],
        ];
    }

    public function testDataNonValidaTornaNull(): void
    {
        $this->assertNull(contractShiftMonths('non-una-data', -6));
    }

    // ── Termini per tipo di locazione ────────────────────────────────────

    public function testIlValoreScrittoSullaRigaBatteIlPredefinito(): void
    {
        // Il contratto firmato comanda: un 4+4 con preavviso di 3 mesi scritto
        // a mano deve restare a 3, non tornare ai 6 del preset.
        $terms = leaseTermsFor([
            'contract_subtype' => '4+4',
            'notice_months'    => 3,
            'auto_renew'       => 1,
        ]);

        $this->assertSame(3, $terms['notice']);
        $this->assertSame(48, $terms['renewal'], 'il rinnovo non scritto resta quello del tipo');
    }

    public function testSenzaValoriSiUsaIlPredefinitoDelTipo(): void
    {
        $terms = leaseTermsFor(['contract_subtype' => 'commerciale', 'auto_renew' => 1]);

        $this->assertSame(12, $terms['notice']);
        $this->assertSame(72, $terms['renewal']);
        $this->assertTrue($terms['auto']);
    }

    public function testTipoSconosciutoNonInventaNulla(): void
    {
        $terms = leaseTermsFor(['contract_subtype' => 'qualcosa-di-nuovo', 'auto_renew' => 0]);

        $this->assertNull($terms['notice']);
        $this->assertNull($terms['renewal']);
    }

    public function testStudentiRinnovaPerUnPeriodoUgualeAlPrimo(): void
    {
        // `renewal` nullo NON significa "nessun rinnovo": significa "quanto il
        // primo periodo", e chi chiama lo risolve sulla durata effettiva.
        $terms = leaseTermsFor(['contract_subtype' => 'studenti', 'auto_renew' => 1]);

        $this->assertSame(3, $terms['notice']);
        $this->assertNull($terms['renewal']);
        $this->assertTrue($terms['auto']);
    }

    // ── La scadenza del preavviso ────────────────────────────────────────

    public function testScadenzaPreavvisoDiUn4piu4(): void
    {
        $this->assertSame('2030-02-28', contractNoticeDeadline([
            'end_date'         => '2030-08-31',
            'contract_subtype' => '4+4',
            'auto_renew'       => 1,
        ]));
    }

    public function testConDisdettaGiaRegistrataNonCEPiuNienteDaDecidere(): void
    {
        $this->assertNull(contractNoticeDeadline([
            'end_date'                => '2030-08-31',
            'contract_subtype'        => '4+4',
            'auto_renew'              => 1,
            'termination_notice_date' => '2030-01-15',
        ]));
    }

    public function testSenzaPreavvisoNonCEUnTermine(): void
    {
        // Transitorio: finisce e basta, non c'e' nessuna disdetta da mandare.
        $this->assertNull(contractNoticeDeadline([
            'end_date'         => '2027-03-31',
            'contract_subtype' => 'transitorio',
            'auto_renew'       => 0,
        ]));
    }

    public function testSenzaScadenzaNonCEUnTermine(): void
    {
        $this->assertNull(contractNoticeDeadline([
            'end_date'         => null,
            'contract_subtype' => '4+4',
            'auto_renew'       => 1,
        ]));
    }

    // ── Durata del contratto ─────────────────────────────────────────────

    #[DataProvider('durataProvider')]
    public function testDurataInMesi(string $inizio, string $fine, ?int $atteso): void
    {
        $this->assertSame($atteso, contractDurationMonths(['start_date' => $inizio, 'end_date' => $fine]));
    }

    public static function durataProvider(): array
    {
        return [
            // Una 4+4 dal 1° al 31 misura 47 mesi e 30 giorni: arrotondare per
            // difetto direbbe 47 e il rinnovo "uguale al primo" perderebbe un mese.
            '4 anni pieni'   => ['2026-09-01', '2030-08-31', 48],
            '3 anni'         => ['2026-01-01', '2028-12-31', 36],
            '18 mesi'        => ['2026-01-01', '2027-06-30', 18],
            'fine prima dell\'inizio' => ['2026-09-01', '2026-01-01', null],
            'date mancanti'  => ['', '', null],
        ];
    }
}

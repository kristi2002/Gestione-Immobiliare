<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/istat.php';

/**
 * Indici ISTAT FOI — lettura del periodo, del valore e calcolo dell'adeguamento.
 *
 * Perche' proprio qui: il risultato di questo calcolo diventa il canone che
 * l'agenzia chiede all'inquilino per i dodici mesi successivi. Un errore non si
 * manifesta come un crash ma come un importo leggermente sbagliato, che nessuno
 * ricalcola a mano — quindi il posto in cui va intercettato e' questo.
 *
 * I test NON toccano il database di proposito: passando `null` come PDO la
 * libreria usa la copia di riserva delle medie annue, il che rende il calcolo
 * verificabile su numeri fissi e noti.
 */
class IstatIndexTest extends TestCase
{
    // ── Periodi ────────────────────────────────────────────────────────────

    /**
     * Il campo «Mese indice base» e' testo libero e il CSV ISTAT scrive il
     * periodo in almeno quattro modi diversi. Se il parser non li copre, il
     * valore finisce scartato in silenzio e il contratto resta senza indice.
     */
    public function testRiconosceIFormatiDiPeriodoUsatiDavvero(): void
    {
        $this->assertSame(['year' => 2026, 'month' => 1], istatParsePeriod('2026-01'));
        $this->assertSame(['year' => 2026, 'month' => 1], istatParsePeriod('2026/01'));
        $this->assertSame(['year' => 2026, 'month' => 1], istatParsePeriod('01/2026'));
        $this->assertSame(['year' => 2026, 'month' => 1], istatParsePeriod('gennaio 2026'));
        $this->assertSame(['year' => 2026, 'month' => 12], istatParsePeriod('dicembre 2026'));
    }

    /** Solo l'anno = media annua, che nella tabella e' il mese 0. */
    public function testAnnoSenzaMeseEMediaAnnua(): void
    {
        $this->assertSame(['year' => 2024, 'month' => 0], istatParsePeriod('2024'));
    }

    public function testRifiutaPeriodiNonValidi(): void
    {
        $this->assertNull(istatParsePeriod('2026-13'));
        $this->assertNull(istatParsePeriod('2026-00'));
        $this->assertNull(istatParsePeriod('asd'));
        $this->assertNull(istatParsePeriod(''));
        $this->assertNull(istatParsePeriod(null));
    }

    // ── Valori ─────────────────────────────────────────────────────────────

    /**
     * L'indice arriva scritto all'italiana (118,2) o all'inglese (118.2).
     * Sbagliare qui sposta la virgola di un adeguamento vero.
     */
    public function testLeggeIDecimaliInEntrambeLeConvenzioni(): void
    {
        $this->assertSame(118.2, istatParseDecimal('118,2'));
        $this->assertSame(118.2, istatParseDecimal('118.2'));
        $this->assertSame(118.0, istatParseDecimal(' 118 '));
    }

    /**
     * Con entrambi i separatori decide l'ULTIMO. Regressione: l'ordine delle
     * sostituzioni faceva diventare "1.234,5" il numero 12345, cioe' dieci volte
     * tanto — la virgola veniva convertita in punto prima che i punti delle
     * migliaia fossero rimossi, e la rimozione se li mangiava tutti.
     */
    public function testMigliaiaEDecimaliInsieme(): void
    {
        $this->assertSame(1234.5, istatParseDecimal('1.234,5'));
        $this->assertSame(1234.5, istatParseDecimal('1,234.5'));
    }

    // ── Calcolo ────────────────────────────────────────────────────────────

    /**
     * Il numero che conta. Base 2023 = 118,2 → 2024 = 119,6:
     * variazione 1,184%, applicata al 75% = 0,888%, su 1.000 € = 1.008,88 €.
     */
    public function testAdeguamentoAl75PerCentoDellaVariazione(): void
    {
        $r = istatComputeAdjustment(null, 1000.0,
            ['year' => 2023, 'month' => 0, 'index' => null],
            ['year' => 2024, 'month' => 0]);

        $this->assertTrue($r['ok']);
        $this->assertSame(118.2, $r['baseline_index']);
        $this->assertSame(119.6, $r['target_index']);
        $this->assertSame(1.184, $r['variation_pct']);
        $this->assertSame(0.888, $r['applied_pct']);
        $this->assertSame(1008.88, $r['new_rent']);
        $this->assertSame(8.88, $r['monthly_increase']);
        $this->assertSame(106.56, $r['annual_increase']);
    }

    /**
     * L'indice scritto sul contratto e' quello che le parti hanno firmato: deve
     * vincere sulla tabella, altrimenti il gestionale ricalcola un accordo.
     */
    public function testIndiceSulContrattoVinceSullaTabella(): void
    {
        $r = istatComputeAdjustment(null, 1000.0,
            ['year' => 2023, 'month' => 0, 'index' => 100.0],
            ['year' => 2024, 'month' => 0]);

        $this->assertSame(100.0, $r['baseline_index']);
        $this->assertSame(19.6, $r['variation_pct']);
    }

    /**
     * Senza dato non si inventa un numero: si fallisce dicendo cosa manca.
     * Un adeguamento plausibile ma inventato e' peggio di un errore.
     */
    public function testSenzaIndiceBaseNonCalcola(): void
    {
        $r = istatComputeAdjustment(null, 1000.0,
            ['year' => 1990, 'month' => 0, 'index' => null],
            ['year' => 2024, 'month' => 0]);

        $this->assertFalse($r['ok']);
        $this->assertStringContainsString('1990', $r['message']);
    }

    public function testCanoneNonValidoNonCalcola(): void
    {
        $r = istatComputeAdjustment(null, 0.0,
            ['year' => 2023, 'month' => 0, 'index' => null],
            ['year' => 2024, 'month' => 0]);

        $this->assertFalse($r['ok']);
    }

    /**
     * Quando il calcolo poggia sulla copia di riserva del codice invece che sul
     * dato caricato, il risultato lo dichiara. Senza questo avviso un valore
     * provvisorio si presenta all'agente come se fosse ufficiale.
     */
    public function testDichiaraQuandoUsaLaCopiaDiRiserva(): void
    {
        $r = istatComputeAdjustment(null, 1000.0,
            ['year' => 2023, 'month' => 0, 'index' => null],
            ['year' => 2024, 'month' => 0]);

        $this->assertNotEmpty($r['warnings']);
        $this->assertStringContainsString('copia di riserva', implode(' ', $r['warnings']));
    }

    // ── Import CSV ─────────────────────────────────────────────────────────

    public function testImportaCsvItalianoConIntestazione(): void
    {
        $out = istatParseCsv("Periodo;Valore\n2026-01;123,4\n2026-02;123,7\n");

        $this->assertSame(2, $out['data_lines']);
        $this->assertSame(0, $out['skipped']);
        $this->assertCount(2, $out['rows']);
        $this->assertSame(123.4, $out['rows']['2026-1']['index_value']);
        $this->assertSame('2026-01', $out['rows']['2026-1']['period']);
    }

    public function testImportaCsvSenzaIntestazioneEConVirgola(): void
    {
        $out = istatParseCsv("2025-11,121.9\n2025-12,122.1\n");

        $this->assertCount(2, $out['rows']);
        $this->assertSame(122.1, $out['rows']['2025-12']['index_value']);
    }

    /** Colonne riconosciute per nome, anche fuori ordine e con colonne in piu'. */
    public function testTrovaLeColonneDallIntestazione(): void
    {
        $out = istatParseCsv("Codice;Valore;Periodo\nFOI;119,6;2024\n");

        $this->assertSame(119.6, $out['rows']['2024-0']['index_value']);
        $this->assertSame('2024 (media annua)', $out['rows']['2024-0']['period']);
    }

    /**
     * La colonna sbagliata e' l'errore piu' probabile di un import a mano: i
     * fogli ISTAT affiancano l'indice alla variazione percentuale. Un FOI base
     * 2015=100 non vale 0,8 — fuori intervallo si scarta, altrimenti quel numero
     * diventerebbe un adeguamento del -99% su un canone vero.
     */
    public function testScartaLaColonnaDelleVariazioniPercentuali(): void
    {
        $out = istatParseCsv("Periodo;Variazione\n2026-01;0,8\n2026-02;1,2\n");

        $this->assertCount(0, $out['rows']);
        $this->assertSame(2, $out['skipped']);
    }

    /** Nello stesso file l'ultima riga di un periodo vince, senza duplicarlo. */
    public function testPeriodoRipetutoNonSiDuplica(): void
    {
        $out = istatParseCsv("2026-01;123,4\n2026-01;123,9\n");

        $this->assertCount(1, $out['rows']);
        $this->assertSame(123.9, $out['rows']['2026-1']['index_value']);
    }

    public function testMesiScrittiAParoleETabulazione(): void
    {
        $out = istatParseCsv("gennaio 2023\t118,0\nfebbraio 2023\t118,3\n");

        $this->assertCount(2, $out['rows']);
        $this->assertSame(118.3, $out['rows']['2023-2']['index_value']);
    }
}

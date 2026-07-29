<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/sepa_sdd.php';

/**
 * pain.008.001.02 — sequenza FRST/RCUR.
 *
 * Il file SDD non ha un modo di fallire rumorosamente: se la sequenza e' sbagliata
 * l'XML resta valido a schema e viene respinto dalla banca giorni dopo l'upload.
 * Questi test guardano quindi l'unica cosa che conta, la struttura dei blocchi
 * PmtInf, non il fatto che la generazione "non dia errore".
 */
class SepaSddTest extends TestCase
{
    private const CREDITOR = [
        'name'        => 'Orlandi Immobiliare',
        'iban'        => 'IT60X0542811101000000123456',
        'creditor_id' => 'IT66ZZZ12345678901',
    ];

    private function tx(string $ref, string $seq, float $amount = 500.00): array
    {
        return [
            'end_to_end_id' => 'RENT-' . $ref,
            'amount'        => $amount,
            'mandate_id'    => 'UMR-' . $ref,
            'mandate_date'  => '2026-01-15',
            'debtor_name'   => 'Inquilino ' . $ref,
            'debtor_iban'   => 'IT60X0542811101000000123456',
            'remittance'    => 'Canone locazione 2026-07',
            'seq_type'      => $seq,
        ];
    }

    private function xpath(string $xml): DOMXPath
    {
        $dom = new DOMDocument();
        $this->assertTrue($dom->loadXML($xml), 'XML non leggibile');
        $xp = new DOMXPath($dom);
        $xp->registerNamespace('p', 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02');
        return $xp;
    }

    /**
     * Il caso che il codice precedente sbagliava: un lotto misto usciva tutto
     * come RCUR, e il primo incasso del nuovo inquilino veniva respinto.
     */
    public function testMixedBatchIsSplitIntoOnePmtInfPerSequenceType(): void
    {
        $txs = [
            $this->tx('A', 'RCUR', 500.00),
            $this->tx('B', 'FRST', 750.50),
            $this->tx('C', 'RCUR', 620.00),
        ];

        $xp = $this->xpath(sepaSddBuildXml(self::CREDITOR, $txs, '2026-08-05', 'SDD-202608-abc', '2026-07-29T10:00:00'));

        $blocks = $xp->query('//p:PmtInf');
        $this->assertSame(2, $blocks->length, 'Serve un blocco PmtInf per sequenza');

        // FRST per primo: e' il blocco che richiede piu' preavviso alla banca.
        $seqs = [];
        foreach ($xp->query('//p:PmtInf/p:PmtTpInf/p:SeqTp') as $n) $seqs[] = $n->textContent;
        $this->assertSame(['FRST', 'RCUR'], $seqs);

        // Ogni blocco conta e somma SOLO le proprie transazioni.
        $this->assertSame('1', $xp->query('//p:PmtInf[1]/p:NbOfTxs')->item(0)->textContent);
        $this->assertSame('750.50', $xp->query('//p:PmtInf[1]/p:CtrlSum')->item(0)->textContent);
        $this->assertSame('2', $xp->query('//p:PmtInf[2]/p:NbOfTxs')->item(0)->textContent);
        $this->assertSame('1120.00', $xp->query('//p:PmtInf[2]/p:CtrlSum')->item(0)->textContent);

        // Il GrpHdr resta il totale del messaggio.
        $this->assertSame('3', $xp->query('//p:GrpHdr/p:NbOfTxs')->item(0)->textContent);
        $this->assertSame('1870.50', $xp->query('//p:GrpHdr/p:CtrlSum')->item(0)->textContent);

        // PmtInfId deve essere unico nel messaggio, altrimenti la banca scarta il file.
        $ids = [];
        foreach ($xp->query('//p:PmtInf/p:PmtInfId') as $n) $ids[] = $n->textContent;
        $this->assertSame($ids, array_unique($ids));
        $this->assertLessThanOrEqual(35, max(array_map('strlen', $ids)));

        // La transazione FRST e' finita nel blocco FRST, non solo "da qualche parte".
        $this->assertSame(
            'RENT-B',
            $xp->query('//p:PmtInf[1]/p:DrctDbtTxInf/p:PmtId/p:EndToEndId')->item(0)->textContent
        );
    }

    /** Nessun blocco vuoto: un PmtInf con NbOfTxs=0 viola lo schema. */
    public function testSingleSequenceBatchProducesOneBlock(): void
    {
        $txs = [$this->tx('A', 'RCUR'), $this->tx('B', 'RCUR')];
        $xp  = $this->xpath(sepaSddBuildXml(self::CREDITOR, $txs, '2026-08-05', 'SDD-202608-abc', '2026-07-29T10:00:00'));

        $this->assertSame(1, $xp->query('//p:PmtInf')->length);
        $this->assertSame('RCUR', $xp->query('//p:PmtInf/p:PmtTpInf/p:SeqTp')->item(0)->textContent);
        $this->assertSame(0, $xp->query("//p:SeqTp[text()='FRST']")->length);
    }

    /**
     * Una sequenza mancante e' un errore del chiamante, non un default: il
     * builder ripiega su RCUR ed e' esattamente il modo in cui il bug e' passato
     * inosservato la prima volta.
     */
    public function testValidationRejectsMissingSequenceType(): void
    {
        $tx = $this->tx('A', 'RCUR');
        unset($tx['seq_type']);

        $errors = sepaSddValidate(self::CREDITOR, [$tx], '2026-08-05', '2026-07-29');
        $this->assertNotEmpty(array_filter($errors, fn($e) => str_contains($e, 'Sequenza SDD')));
    }

    public function testValidBatchHasNoErrors(): void
    {
        $txs = [$this->tx('A', 'FRST'), $this->tx('B', 'RCUR')];
        $this->assertSame([], sepaSddValidate(self::CREDITOR, $txs, '2026-08-05', '2026-07-29'));
    }

    /** Il mod-97 che tiene fuori dal file gli IBAN storti (regressione). */
    public function testIbanChecksum(): void
    {
        $this->assertTrue(sepaIbanIsValid('IT60X0542811101000000123456'));
        $this->assertTrue(sepaIbanIsValid('it60 x054 2811 1010 0000 0123 456'), 'spazi e minuscole vanno normalizzati');
        $this->assertFalse(sepaIbanIsValid('IT60X0542811101000000123457'), 'cifra di controllo errata');
        $this->assertFalse(sepaIbanIsValid('IT60X05428111010000001234'),    'lunghezza errata per IT');
        $this->assertFalse(sepaIbanIsValid(null));
    }
}

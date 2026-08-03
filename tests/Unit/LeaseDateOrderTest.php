<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/portal_specs.php';
require_once __DIR__ . '/../../lib/contract_lifecycle.php';

/**
 * Il periodo di una locazione non puo' finire prima di cominciare.
 *
 * Il caso vero da cui nasce: un contratto salvato dal modulo Inquilino con
 * 11/06/2027 → 26/06/2026. Nessun errore, riga in tabella, e poi lo scadenzario
 * usciva vuoto («0 pagamenti creati», con l'aria di essere andato a buon fine)
 * perche' la prima scadenza cade gia' oltre la fine. Il canone non veniva mai
 * richiesto a nessuno.
 */
class LeaseDateOrderTest extends TestCase
{
    public function testPeriodoRovesciatoERifiutato(): void
    {
        $this->assertTrue(leaseDatesOutOfOrder('2027-06-11', '2026-06-26'));
    }

    public function testPeriodoNormalePassa(): void
    {
        $this->assertFalse(leaseDatesOutOfOrder('2026-06-26', '2027-06-11'));
    }

    /**
     * Un solo giorno di locazione e' insolito ma non e' un errore di ordine:
     * la guardia rifiuta il periodo impossibile, non quello breve.
     */
    public function testStessoGiornoPassa(): void
    {
        $this->assertFalse(leaseDatesOutOfOrder('2026-06-26', '2026-06-26'));
    }

    /**
     * Periodo aperto: la locazione senza scadenza e' legittima (occupa
     * l'immobile finche' non si chiude) e non deve inciampare qui.
     */
    public function testPeriodoApertoPassa(): void
    {
        $this->assertFalse(leaseDatesOutOfOrder('2026-06-26', null));
        $this->assertFalse(leaseDatesOutOfOrder('2026-06-26', ''));
        $this->assertFalse(leaseDatesOutOfOrder(null, '2027-06-11'));
        $this->assertFalse(leaseDatesOutOfOrder(null, null));
    }

    /**
     * Le date che arrivano dal database portano l'ora appresso (DATETIME o
     * stringa gia' formattata): il confronto deve restare sui primi 10 caratteri,
     * altrimenti "2026-06-26 00:00:00" e "2026-06-26" non risulterebbero uguali.
     */
    public function testDateConOraSiConfrontanoSullaDataSola(): void
    {
        $this->assertFalse(leaseDatesOutOfOrder('2026-06-26 00:00:00', '2026-06-26 00:00:00'));
        $this->assertTrue(leaseDatesOutOfOrder('2027-06-11 00:00:00', '2026-06-26 00:00:00'));
    }

    /** Un solo testo, da qualunque porta si entri. */
    public function testMessaggioUnico(): void
    {
        $this->assertSame(leaseDateOrderMessage(), (new LeaseDateOrderException())->getMessage());
    }
}

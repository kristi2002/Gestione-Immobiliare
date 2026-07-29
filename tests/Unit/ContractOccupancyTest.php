<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/portal_specs.php';
require_once __DIR__ . '/../../lib/contract_lifecycle.php';

/**
 * Quando una locazione occupa l'immobile.
 *
 * Da questa risposta dipende il passaggio automatico dell'immobile ad
 * "affittato" e, di conseguenza, il ritiro dell'annuncio dai portali. Sbagliare
 * in un verso lascia online una casa gia' affittata (slot a pagamento sprecato e
 * richieste di visita inutili); sbagliare nell'altro ritira l'annuncio di una
 * casa ancora libera, che e' peggio: fa perdere richieste vere.
 *
 * La data di riferimento e' iniettata invece di usare "oggi": un test che
 * dipende dal calendario passa a marzo e fallisce a settembre.
 */
class ContractOccupancyTest extends TestCase
{
    private const OGGI = '2026-07-29';

    private function contratto(array $override = []): array
    {
        return array_merge([
            'contract_type' => 'locazione',
            'status'        => null, // "Automatico"
            'start_date'    => '2026-01-01',
            'end_date'      => '2030-01-01',
        ], $override);
    }

    private function occupa(array $override = []): bool
    {
        return contractOccupiesProperty($this->contratto($override), self::OGGI);
    }

    /**
     * NULL = "Automatico", che dal phase69 e' il default del form: se questo
     * caso non contasse come in vigore, la sincronizzazione non scatterebbe
     * quasi mai — che e' esattamente il buco che il phase81 chiude.
     */
    public function testLocazioneAutomaticaInCorsoOccupa(): void
    {
        $this->assertTrue($this->occupa());
    }

    public function testLocazioneFirmataOccupa(): void
    {
        $this->assertTrue($this->occupa(['status' => 'signed']));
    }

    /** Senza data di fine la locazione e' aperta: occupa finche' non si chiude. */
    public function testLocazioneSenzaScadenzaOccupa(): void
    {
        $this->assertTrue($this->occupa(['end_date' => null]));
    }

    /**
     * Bozze e contratti annullati non occupano nulla: e' la stessa regola del
     * filtro "Attivi" e della generazione dello scadenzario. Un preventivo di
     * locazione non deve togliere la casa dal mercato.
     */
    public function testBozzaInviatoAnnullatoNonOccupano(): void
    {
        $this->assertFalse($this->occupa(['status' => 'draft']));
        $this->assertFalse($this->occupa(['status' => 'sent']));
        $this->assertFalse($this->occupa(['status' => 'cancelled']));
    }

    /** Contratto firmato che parte fra due mesi: la casa e' ancora libera oggi. */
    public function testDecorrenzaFuturaNonOccupa(): void
    {
        $this->assertFalse($this->occupa(['start_date' => '2026-09-01']));
    }

    public function testContrattoScadutoNonOccupa(): void
    {
        $this->assertFalse($this->occupa(['end_date' => '2026-07-28']));
    }

    /** Gli estremi sono inclusi: il giorno di inizio e quello di fine contano. */
    public function testGliEstremiDelPeriodoSonoInclusi(): void
    {
        $this->assertTrue($this->occupa(['start_date' => self::OGGI]));
        $this->assertTrue($this->occupa(['end_date' => self::OGGI]));
    }

    /** Senza decorrenza non si sa da quando: non si tocca lo stato dell'immobile. */
    public function testSenzaDataInizioNonOccupa(): void
    {
        $this->assertFalse($this->occupa(['start_date' => null]));
    }

    /**
     * Solo le locazioni. Una compravendita porta l'immobile a "venduto", ed e'
     * una decisione che passa dalla scheda immobile — non da qui.
     */
    public function testSoloLeLocazioniOccupano(): void
    {
        $this->assertFalse($this->occupa(['contract_type' => 'compravendita']));
        $this->assertFalse($this->occupa(['contract_type' => 'preliminare']));
        $this->assertFalse($this->occupa(['contract_type' => 'mandato']));
        $this->assertFalse($this->occupa(['contract_type' => 'altro']));
    }

    /** MySQL puo' restituire DATE o DATETIME a seconda della colonna/driver. */
    public function testTolleraIlFormatoDatetime(): void
    {
        $this->assertTrue($this->occupa(['end_date' => '2030-01-01 00:00:00']));
        $this->assertFalse($this->occupa(['end_date' => '2026-07-28 23:59:59']));
    }
}

<?php

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/numbers.php';

/**
 * Numeri scritti come li scrive un italiano.
 *
 * `(float) "250.000,00"` fa 250. E' il difetto piu' caro che questo progetto
 * conosce perche' non si vede: un import di 150 immobili da 250.000 € diventa
 * un archivio di case da 250 €, e ogni cifra presa da sola sembra plausibile.
 *
 * La regola era gia' scritta e documentata — dentro una closure in
 * api/valuation.php, quindi irraggiungibile. L'import degli immobili l'ha
 * rifatta col cast ingenuo. Questi test stanno sulla versione condivisa.
 */
class ItalianNumberTest extends TestCase
{
    #[DataProvider('numeriProvider')]
    public function testLeggeLaNotazioneItaliana(string $scritto, ?float $atteso): void
    {
        $this->assertSame($atteso, parseItalianNumber($scritto));
    }

    /** @return array<string, array{0: string, 1: float|null}> */
    public static function numeriProvider(): array
    {
        return [
            // Il caso che costa: Excel italiano scrive cosi'.
            'prezzo da Excel'          => ['250.000,00', 250000.0],
            'migliaia senza decimali'  => ['250.000',    250000.0],
            'canone con le migliaia'   => ['1.600',      1600.0],
            'canone con i centesimi'   => ['1.600,50',   1600.5],
            'milioni'                  => ['1.234.567',  1234567.0],

            // Formati che erano gia' corretti e devono restare tali.
            'virgola decimale'         => ['250000,00',  250000.0],
            'punto decimale'           => ['1600.50',    1600.5],
            'superficie con decimali'  => ['120.50',     120.5],
            'intero secco'             => ['950',        950.0],
            // Due decimali dopo il punto ⇒ decimale, non migliaia: 1.6 resta 1.6.
            'un solo decimale'         => ['1.6',        1.6],

            // Spazio come separatore delle migliaia.
            'spazio migliaia'          => ['250 000',    250000.0],

            // Non numeri.
            'trattino'                 => ['-',          null],
            'vuoto'                    => ['',           null],
            'testo'                    => ['n.d.',       null],
            'con apici e spazi'        => ['" 1.600 "',  1600.0],
            'negativo'                 => ['-1.600',     -1600.0],
        ];
    }

    public function testNullNonEUnNumero(): void
    {
        $this->assertNull(parseItalianNumber(null));
    }

    public function testGliImportiDevonoEsserePositivi(): void
    {
        // In un listino uno zero o un negativo sono celle vuote scritte male.
        $this->assertNull(parseItalianAmount('0'));
        $this->assertNull(parseItalianAmount('-1.600'));
        $this->assertSame(1600.0, parseItalianAmount('1.600'));
    }

    public function testIlCastIngenuoSbagliaDiMilleVolte(): void
    {
        // Il test che spiega perche' questo file esiste. Se un domani qualcuno
        // "semplifica" parseItalianNumber in un (float), questo lo ferma.
        $scritto = '250.000,00';

        $this->assertSame(250.0, (float) $scritto, 'il cast ingenuo fa 250');
        $this->assertSame(250000.0, parseItalianNumber($scritto), 'il parser fa 250000');
    }
}

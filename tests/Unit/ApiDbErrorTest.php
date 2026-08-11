<?php

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/api_helpers.php';

/**
 * Da un errore di MySQL a una frase che dice cosa correggere.
 *
 * «Errore database.» e' cio' che vedeva chi salvava una provincia scritta per
 * intero («Provincia di Macerata») in una colonna da dieci caratteri: il
 * vincolo funziona — MySQL e' in STRICT_TRANS_TABLES, in locale e in
 * produzione, quindi RIFIUTA invece di troncare in silenzio, che sarebbe stato
 * molto peggio — ma il messaggio non diceva quale campo, e chi compila non ha
 * modo di indovinarlo.
 *
 * La regola sta in una funzione pura proprio per poterla provare qui:
 * `apiDbError()` finisce in `apiError()`, che fa `exit`.
 */
class ApiDbErrorTest extends TestCase
{
    private const CTX = 'Impossibile salvare il proprietario';

    #[DataProvider('erroriProvider')]
    public function testTraduceGliErroriCheNasconoDaCioCheLUtenteHaScritto(
        string $sqlstate,
        string $mysqlMsg,
        int $statoAtteso,
        string $frammentoAtteso
    ): void {
        [$msg, $status, $mapped] = apiDbErrorMessage($mysqlMsg, $sqlstate, self::CTX);

        $this->assertTrue($mapped, 'doveva essere riconosciuto');
        $this->assertSame($statoAtteso, $status);
        $this->assertStringContainsString($frammentoAtteso, $msg);
        $this->assertStringStartsWith(self::CTX, $msg, 'il contesto apre la frase');
    }

    /** @return array<string, array{0:string,1:string,2:int,3:string}> */
    public static function erroriProvider(): array
    {
        return [
            'valore troppo lungo: nomina la colonna' => [
                '22001',
                "SQLSTATE[22001]: String data, right truncated: 1406 Data too long for column 'province' at row 1",
                422,
                '«province»',
            ],
            'troncamento (1265) vale come troppo lungo' => [
                '01000',
                "SQLSTATE[01000]: Warning: 1265 Data truncated for column 'method' at row 1",
                422,
                '«method»',
            ],
            'duplicato: nomina il vincolo' => [
                '23000',
                "SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'RSSMRA' for key 'uq_clients_cf'",
                409,
                'uq_clients_cf',
            ],
            'riferimento inesistente' => [
                '23000',
                "SQLSTATE[23000]: Integrity constraint violation: 1452 Cannot add or update a child row",
                409,
                'non esiste',
            ],
            'record collegato: non si elimina' => [
                '23000',
                "SQLSTATE[23000]: Integrity constraint violation: 1451 Cannot delete or update a parent row",
                409,
                'Disattivalo',
            ],
        ];
    }

    public function testSenzaNomeDiColonnaResta_comprensibile(): void
    {
        // Un 1406 senza `column '...'` nel messaggio non deve produrre «di «»».
        [$msg, $status] = apiDbErrorMessage('1406 Data too long', '22001', self::CTX);

        $this->assertSame(422, $status);
        $this->assertStringNotContainsString('«»', $msg);
        $this->assertStringContainsString('troppo lungo', $msg);
    }

    public function testLaChiavePrimariaNonSiNominaAllUtente(): void
    {
        // «vincolo PRIMARY» non dice niente a chi compila un form.
        [$msg] = apiDbErrorMessage(
            "1062 Duplicate entry '3' for key 'PRIMARY'",
            '23000',
            self::CTX
        );

        $this->assertStringNotContainsString('PRIMARY', $msg);
        $this->assertStringContainsString('esiste già', $msg);
    }

    public function testCioCheNonSiSaTradurreRestaGenericoEVaNelLog(): void
    {
        // Il terzo valore falso e' il segnale che apiDbError() usa per scrivere
        // nel log: un messaggio grezzo di MySQL non si mostra a chi lavora.
        [$msg, $status, $mapped] = apiDbErrorMessage(
            'SQLSTATE[HY000]: General error: 2006 MySQL server has gone away',
            'HY000',
            self::CTX
        );

        $this->assertFalse($mapped);
        $this->assertSame(500, $status);
        $this->assertSame('Errore database.', $msg);
    }
}

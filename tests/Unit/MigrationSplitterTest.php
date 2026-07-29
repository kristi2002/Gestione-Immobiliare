<?php

use PHPUnit\Framework\TestCase;

/**
 * splitSqlStatements() — il taglio degli statement nel runner delle migrazioni.
 *
 * Vale la pena di testarlo perche' sbaglia in silenzio: uno statement tagliato a
 * meta' non arriva come "file malformato" ma come errore 1064 di MySQL, che
 * parla di sintassi mentre l'SQL scritto e' valido. E siccome il runner si ferma
 * al primo errore, una sola migrazione rotta blocca tutte quelle dopo.
 */
class MigrationSplitterTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        if (function_exists('splitSqlStatements')) {
            return;
        }
        // migrate.php APPLICA le migrazioni se incluso: si caricano solo le
        // definizioni di funzione in coda al file, senza eseguirne il corpo.
        $lines = file(__DIR__ . '/../../database/migrate.php');
        $start = null;
        foreach ($lines as $i => $line) {
            if (str_starts_with($line, 'function migrationOrder')) {
                $start = $i;
                break;
            }
        }
        if ($start === null) {
            self::fail('migrate.php: blocco delle funzioni non trovato');
        }
        eval(implode('', array_slice($lines, $start)));
    }

    /** Il caso che rompeva phase74/79/80/81/82. */
    public function testSemicolonInsideAStringDoesNotSplit(): void
    {
        $sql = "ALTER TABLE t ADD COLUMN c INT COMMENT 'unico = intera; split = meta';\n";

        $out = splitSqlStatements($sql);

        $this->assertCount(1, $out, 'Il ; dentro il COMMENT non e\' un fine-statement');
        $this->assertStringContainsString("'unico = intera; split = meta'", $out[0]);
    }

    public function testDoubledQuoteIsALiteralNotAStringEnd(): void
    {
        $sql = "SET @s := 'dall''agente; e poi';\nSELECT 1;\n";

        $out = splitSqlStatements($sql);

        $this->assertCount(2, $out);
        $this->assertStringContainsString("dall''agente; e poi", $out[0]);
    }

    public function testStringSpanningMultipleLinesKeepsCommentLikeLines(): void
    {
        // Una riga che inizia per `--` DENTRO un letterale e' testo, non commento.
        $sql = "INSERT INTO t (c) VALUES ('prima\n-- non sono un commento\nterza');\n";

        $out = splitSqlStatements($sql);

        $this->assertCount(1, $out);
        $this->assertStringContainsString('-- non sono un commento', $out[0]);
    }

    public function testStandaloneCommentsAndBlankLinesAreDropped(): void
    {
        $sql = "-- commento\n\n# altro commento\nSELECT 1;\n";

        $this->assertSame(['SELECT 1'], array_map('trim', splitSqlStatements($sql)));
    }

    /** DELIMITER // per le stored procedure di 000_helpers.sql. */
    public function testDelimiterDirectiveIsHonoured(): void
    {
        $sql = "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END //\nDELIMITER ;\nSELECT 3;\n";

        $out = array_map('trim', splitSqlStatements($sql));

        $this->assertCount(2, $out);
        $this->assertStringContainsString('SELECT 1; SELECT 2;', $out[0], 'I ; interni al corpo non tagliano');
        $this->assertSame('SELECT 3', $out[1]);
    }

    public function testBacktickIdentifiersAreNotStringDelimiters(): void
    {
        $sql = "ALTER TABLE `t` ADD COLUMN `c'x` INT;\nSELECT 1;\n";

        $this->assertCount(2, splitSqlStatements($sql));
    }

    public function testTrailingStatementWithoutDelimiterIsKept(): void
    {
        $this->assertSame(['SELECT 1'], array_map('trim', splitSqlStatements("SELECT 1\n")));
    }

    /**
     * Il contratto vero: ogni migrazione del repo deve produrre statement con un
     * numero PARI di apici. Dispari = tagliata dentro una stringa.
     */
    public function testEveryMigrationInTheRepoSplitsWithBalancedQuotes(): void
    {
        $files = glob(__DIR__ . '/../../database/migrations/*.sql') ?: [];
        $this->assertNotEmpty($files);

        foreach ($files as $file) {
            foreach (splitSqlStatements(file_get_contents($file)) as $statement) {
                // Gli apici preceduti da backslash sono caratteri, non delimitatori
                // (phase5 ne ha: "l\'orario"). Vanno tolti prima di contare, o il
                // conteggio risulta dispari su uno statement perfettamente intero.
                $normalized = preg_replace('/\\\\./s', '', $statement);

                $this->assertSame(
                    0,
                    substr_count($normalized, "'") % 2,
                    basename($file) . ': statement tagliato dentro un letterale'
                );
            }
        }
    }
}

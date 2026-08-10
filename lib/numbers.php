<?php
/**
 * Numeri scritti come li scrive un italiano.
 *
 * `(float) "250.000,00"` fa **250**. Non 250000, non un errore: duecentocinquanta.
 * E' il difetto piu' caro che questo progetto conosce, perche' non si vede: un
 * import di 150 immobili a 250.000 € diventa un archivio di immobili da 250 €,
 * ogni cifra e' plausibile presa da sola, e il CSV di partenza era giusto.
 *
 * La regola, che vale per prezzi, canoni e superfici:
 *
 *   - c'e' una VIRGOLA          → notazione italiana: i punti sono migliaia
 *                                 ("1.600,50" = 1600.5)
 *   - solo PUNTI, ognuno seguito
 *     da esattamente tre cifre  → migliaia ("250.000" = 250000, "1.600" = 1600)
 *   - tutto il resto            → e' gia' un numero ("1600.50", "950", "1.6")
 *
 * Il gruppo di tre cifre e' quello che scioglie l'ambiguita' vera: "1.600" da
 * solo potrebbe essere milleseicento o uno-e-sei, e su un prezzo o un canone e'
 * sempre il primo — nessuno quota un affitto a tre decimali.
 *
 * Nota su perche' non e' l'unico parser dell'applicazione: `istatParseDecimal()`
 * (lib/istat.php) tratta un separatore solitario SEMPRE come decimale, ed e'
 * corretto li' — un indice FOI sta fra 90 e 140, quindi "112.3" e' centododici
 * e tre, e l'ambiguita' delle migliaia non puo' presentarsi. Due domini, due
 * regole, entrambe scritte. Se un giorno se ne vuole una sola, e' da qui che si
 * comincia a ragionare, non da un merge affrettato.
 */

/**
 * @return float|null null se la stringa non contiene un numero riconoscibile
 */
function parseItalianNumber(?string $raw): ?float
{
    $v = trim((string) $raw, " \t\"'\u{00A0}");
    if ($v === '' || $v === '-') return null;

    // Lo spazio come separatore delle migliaia esiste ("250 000"): si toglie
    // prima di ogni altra cosa, o `is_numeric()` boccia tutto.
    $v = str_replace([' ', "\u{00A0}"], '', $v);

    if (str_contains($v, ',')) {
        // Virgola presente ⇒ italiano: i punti sono migliaia, la virgola decimale.
        $v = str_replace(['.', ','], ['', '.'], $v);
    } elseif (preg_match('/^-?\d{1,3}(\.\d{3})+$/', $v)) {
        // Solo punti, ognuno seguito da esattamente tre cifre ⇒ migliaia.
        $v = str_replace('.', '', $v);
    }

    return is_numeric($v) ? (float) $v : null;
}

/**
 * Come sopra, ma per un importo che deve essere positivo: i prezzi a zero o
 * negativi in un listino sono celle vuote scritte male, non valori.
 */
function parseItalianAmount(?string $raw): ?float
{
    $n = parseItalianNumber($raw);
    return ($n !== null && $n > 0) ? $n : null;
}

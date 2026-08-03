<?php
/**
 * Scrittura CSV.
 *
 * Il problema che chiude: dal PHP 8.4 `fputcsv()` senza il parametro $escape
 * emette un Deprecated, e con display_errors acceso quell'avviso finisce
 * DENTRO il file scaricato — prima ancora dell'intestazione:
 *
 *   <br /><b>Deprecated</b>: fputcsv(): the $escape parameter must be
 *   provided ... on line <b>478</b><br />
 *   id,indirizzo,citta,...
 *
 * Excel apre un file cosi' con la prima riga di spazzatura e le colonne
 * sfasate. Riguardava OGNI esportazione dell'applicazione (proprietari,
 * immobili, export portali, report).
 *
 * $escape = '' e' anche la scelta giusta nel merito, non solo il default
 * futuro: l'escaping con backslash non fa parte del CSV (RFC 4180), dove le
 * virgolette si raddoppiano. Con '\\' un valore che finisce per backslash
 * poteva produrre un file che nemmeno PHP rileggeva correttamente.
 */

/**
 * Una riga CSV, con l'escaping esplicito e conforme.
 *
 * @param resource $stream
 * @param array<int,mixed> $fields
 */
function csvRow($stream, array $fields): int|false
{
    return fputcsv($stream, $fields, ',', '"', '');
}

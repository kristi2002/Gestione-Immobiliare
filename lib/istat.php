<?php
/**
 * ISTAT FOI rent adjustment (adeguamento ISTAT del canone di locazione).
 *
 * Italian leases index the rent to a share (75% by default) of the variation of
 * the FOI index — indice dei prezzi al consumo per le famiglie di operai e
 * impiegati, al netto dei tabacchi, base 2015 = 100.
 *
 * Gli indici NON stanno piu' in questo file: vivono in `istat_foi_index`
 * (phase80) e si aggiornano per import o a mano, senza deploy. Qui resta solo
 * una copia di riserva delle medie annue, usata quando la tabella non c'e'
 * ancora (installazione non migrata) o e' vuota — e in quel caso il risultato lo
 * DICHIARA, invece di far passare un segnaposto per un dato ufficiale.
 *
 * L'ISTAT pubblica il FOI ogni mese e i contratti indicizzano sul mese, non
 * sulla media annua: per questo la ricerca e' per (anno, mese) e la media annua
 * e' solo il ripiego quando il mese non e' disponibile.
 */

/**
 * Copia di riserva: le medie annue che fino a phase80 erano l'unica fonte.
 *
 * @return array<int,float> anno => media annua FOI (base 2015=100)
 */
function istatFoiFallbackIndex(): array
{
    return [
        2015 => 100.0,
        2016 => 99.9,
        2017 => 101.0,
        2018 => 102.1,
        2019 => 102.7,
        2020 => 102.5,
        2021 => 104.4,
        2022 => 112.0,
        2023 => 118.2,
        2024 => 119.6,
        2025 => 121.5,
        2026 => 123.0, // provvisorio
    ];
}

/**
 * La tabella esiste? Un'installazione non ancora migrata deve continuare a
 * calcolare col ripiego invece di rispondere errore.
 */
function istatTableAvailable(?PDO $db): bool
{
    static $available = null;
    if ($db === null) return false;
    if ($available !== null) return $available;

    try {
        $db->query('SELECT 1 FROM istat_foi_index LIMIT 1');
        $available = true;
    } catch (PDOException) {
        $available = false;
    }
    return $available;
}

/**
 * Normalizza un periodo scritto da un umano o letto da un CSV.
 *
 * Accetta 2024-01, 2024/01, 01/2024, "gennaio 2024", 2024 (media annua).
 * Serve sia al campo «Mese indice base» del contratto sia all'importer, cosi'
 * le due strade non divergono su cosa sia un periodo valido.
 *
 * @return array{year:int, month:int}|null month 0 = media annua
 */
function istatParsePeriod(?string $raw): ?array
{
    $s = trim(mb_strtolower((string) $raw));
    if ($s === '') return null;

    $months = [
        'gennaio' => 1, 'febbraio' => 2, 'marzo' => 3, 'aprile' => 4,
        'maggio' => 5, 'giugno' => 6, 'luglio' => 7, 'agosto' => 8,
        'settembre' => 9, 'ottobre' => 10, 'novembre' => 11, 'dicembre' => 12,
    ];

    // "gennaio 2024" / "2024 gennaio"
    foreach ($months as $name => $num) {
        if (str_contains($s, $name) && preg_match('/(19|20)\d{2}/', $s, $y)) {
            return ['year' => (int) $y[0], 'month' => $num];
        }
    }

    // 2024-01 | 2024/01 | 2024.01
    if (preg_match('/^((?:19|20)\d{2})[-\/.](\d{1,2})$/', $s, $m)) {
        $month = (int) $m[2];
        return $month >= 1 && $month <= 12 ? ['year' => (int) $m[1], 'month' => $month] : null;
    }

    // 01/2024
    if (preg_match('/^(\d{1,2})[-\/.]((?:19|20)\d{2})$/', $s, $m)) {
        $month = (int) $m[1];
        return $month >= 1 && $month <= 12 ? ['year' => (int) $m[2], 'month' => $month] : null;
    }

    // Solo anno = media annua
    if (preg_match('/^((?:19|20)\d{2})$/', $s, $m)) {
        return ['year' => (int) $m[1], 'month' => 0];
    }

    return null;
}

function istatFormatPeriod(int $year, int $month): string
{
    return $month > 0
        ? sprintf('%04d-%02d', $year, $month)
        : sprintf('%04d (media annua)', $year);
}

/**
 * Lo stesso periodo, nella forma da SCRIVERE in `contracts.istat_baseline_month`.
 *
 * Non e' un doppione di `istatFormatPeriod()`: quella produce un'etichetta per
 * chi legge, e per la media annua scrive "2026 (media annua)" — diciotto
 * caratteri che in una `varchar(7)` non entrano, e che `istatParsePeriod()`
 * NON sa rileggere (torna null). Salvarla avrebbe rotto l'adeguamento
 * dell'anno successivo in due modi insieme: la scrittura falliva, e se anche
 * fosse passata la base non si sarebbe piu' potuta interpretare — si tornava
 * alla data di inizio e si riapplicava la variazione dal principio, cioe' due
 * volte sullo stesso canone.
 *
 * Qui si scrive la forma macchina, che `istatParsePeriod()` rilegge esatta:
 * `2026-03` per un indice mensile, `2026` per la media annua.
 */
function istatStorablePeriod(int $year, int $month): string
{
    return $month > 0
        ? sprintf('%04d-%02d', $year, $month)
        : sprintf('%04d', $year);
}

/**
 * Numero decimale scritto all'italiana o all'inglese.
 *
 * L'indice FOI sta fra 90 e 140, quindi qui non esiste l'ambiguita' del
 * separatore delle migliaia che morde sui prezzi OMI: un solo separatore e'
 * sempre decimale. Quando ci sono entrambi, decide l'ultimo.
 */
function istatParseDecimal(?string $raw): ?float
{
    $s = trim((string) $raw);
    if ($s === '') return null;
    $s = str_replace(' ', '', $s);

    $lastComma = strrpos($s, ',');
    $lastDot   = strrpos($s, '.');

    if ($lastComma !== false && $lastDot !== false) {
        // L'ordine conta: prima si tolgono i separatori delle migliaia, POI si
        // converte il decimale. Facendo il contrario, "1.234,5" diventa
        // "1.234.5" e la rimozione dei punti lo appiattisce a 12345.
        $s = $lastComma > $lastDot
            ? str_replace(',', '.', str_replace('.', '', $s))
            : str_replace(',', '', $s);
    } elseif ($lastComma !== false) {
        $s = str_replace(',', '.', $s);
    }

    return is_numeric($s) ? (float) $s : null;
}

/**
 * Cerca l'indice di un periodo.
 *
 * Se il mese richiesto non c'e' si ripiega sulla media annua, ma il ripiego
 * viene DICHIARATO (`exact` = false): un adeguamento calcolato sulla media annua
 * quando il contratto indicizza su gennaio non e' sbagliato per forza, ma non e'
 * il numero che l'agente crede di star leggendo, e deve poterlo sapere.
 *
 * @return array{value:?float, year:int, month:int, source:string, exact:bool}
 */
function istatLookupIndex(?PDO $db, int $year, int $month = 0): array
{
    $miss = ['value' => null, 'year' => $year, 'month' => $month, 'source' => 'assente', 'exact' => false];

    if (istatTableAvailable($db)) {
        $stmt = $db->prepare(
            'SELECT index_value, source FROM istat_foi_index
              WHERE ref_year = :y AND ref_month = :m LIMIT 1'
        );

        $stmt->execute(['y' => $year, 'm' => $month]);
        if ($row = $stmt->fetch()) {
            return [
                'value'  => (float) $row['index_value'],
                'year'   => $year,
                'month'  => $month,
                'source' => (string) $row['source'],
                'exact'  => true,
            ];
        }

        // Mese assente: media annua dello stesso anno.
        if ($month > 0) {
            $stmt->execute(['y' => $year, 'm' => 0]);
            if ($row = $stmt->fetch()) {
                return [
                    'value'  => (float) $row['index_value'],
                    'year'   => $year,
                    'month'  => 0,
                    'source' => (string) $row['source'],
                    'exact'  => false,
                ];
            }
        }

        return $miss;
    }

    // Tabella non migrata: copia di riserva, solo medie annue.
    $map = istatFoiFallbackIndex();
    if (!isset($map[$year])) return $miss;

    return [
        'value'  => $map[$year],
        'year'   => $year,
        'month'  => 0,
        'source' => 'fallback',
        'exact'  => $month === 0,
    ];
}

/**
 * Il periodo piu' recente disponibile: e' il bersaglio naturale di un
 * adeguamento, perche' oltre non c'e' dato pubblicato.
 *
 * @return array{year:int, month:int}|null
 */
function istatLatestPeriod(?PDO $db): ?array
{
    if (istatTableAvailable($db)) {
        $row = $db->query(
            'SELECT ref_year, ref_month FROM istat_foi_index
             ORDER BY ref_year DESC, ref_month DESC LIMIT 1'
        )->fetch();
        if ($row) {
            return ['year' => (int) $row['ref_year'], 'month' => (int) $row['ref_month']];
        }
        return null;
    }

    $map = istatFoiFallbackIndex();
    return $map ? ['year' => max(array_keys($map)), 'month' => 0] : null;
}

/**
 * Copertura del dato, per la schermata di gestione: quanti periodi, da quando a
 * quando, e se ci sono ancora valori 'seed' (cioe' mai verificati sull'ufficiale).
 *
 * @return array{total:int, monthly:int, annual:int, seed:int, first:?string, last:?string, available:bool}
 */
function istatCoverage(?PDO $db): array
{
    if (!istatTableAvailable($db)) {
        return ['total' => 0, 'monthly' => 0, 'annual' => 0, 'seed' => 0,
                'first' => null, 'last' => null, 'available' => false];
    }

    $row = $db->query(
        "SELECT COUNT(*) AS total,
                SUM(ref_month > 0) AS monthly,
                SUM(ref_month = 0) AS annual,
                SUM(source = 'seed') AS seed
           FROM istat_foi_index"
    )->fetch() ?: [];

    $bounds = $db->query(
        'SELECT MIN(ref_year * 100 + ref_month) AS lo, MAX(ref_year * 100 + ref_month) AS hi
           FROM istat_foi_index'
    )->fetch() ?: [];

    $fmt = static function ($packed): ?string {
        if ($packed === null) return null;
        $packed = (int) $packed;
        return istatFormatPeriod(intdiv($packed, 100), $packed % 100);
    };

    return [
        'total'     => (int) ($row['total'] ?? 0),
        'monthly'   => (int) ($row['monthly'] ?? 0),
        'annual'    => (int) ($row['annual'] ?? 0),
        'seed'      => (int) ($row['seed'] ?? 0),
        'first'     => $fmt($bounds['lo'] ?? null),
        'last'      => $fmt($bounds['hi'] ?? null),
        'available' => true,
    ];
}

/**
 * Adeguamento proposto.
 *
 * Semantica: variazione CUMULATA dall'indice base a quello del periodo
 * bersaglio, moltiplicata per la quota contrattuale (75% di default). E' il
 * calcolo giusto per un contratto mai adeguato prima; per gli adeguamenti annuali
 * successivi il periodo base da passare e' quello dell'ultimo adeguamento.
 *
 * @param array{year:int, month:int, index:?float} $baseline `index` = indice
 *        scritto sul contratto: se c'e' vince sempre sulla tabella, perche' e'
 *        il numero che le parti hanno firmato.
 * @param array{year:int, month:int} $target
 */
function istatComputeAdjustment(
    ?PDO $db,
    float $currentRent,
    array $baseline,
    array $target,
    float $share = 0.75
): array {
    if ($currentRent <= 0) {
        return ['ok' => false, 'message' => 'Canone corrente non valido.'];
    }

    $notes = [];

    $baselineIndex = isset($baseline['index']) && $baseline['index'] > 0 ? (float) $baseline['index'] : null;
    $baselinePeriod = istatFormatPeriod((int) $baseline['year'], (int) ($baseline['month'] ?? 0));

    if ($baselineIndex === null) {
        $found = istatLookupIndex($db, (int) $baseline['year'], (int) ($baseline['month'] ?? 0));
        if ($found['value'] === null) {
            return [
                'ok' => false,
                'message' => 'Indice ISTAT di riferimento mancante per ' . $baselinePeriod
                    . '. Importa gli indici (Impostazioni → Indici ISTAT) oppure scrivi l\'indice base sul contratto.',
            ];
        }
        $baselineIndex  = $found['value'];
        $baselinePeriod = istatFormatPeriod($found['year'], $found['month']);
        if (!$found['exact']) {
            $notes[] = 'indice base non disponibile per il mese richiesto: usata la media annua ' . $found['year'];
        }
        if ($found['source'] === 'fallback') {
            $notes[] = 'valore da copia di riserva del codice, non dalla tabella indici';
        }
        if ($found['source'] === 'seed') {
            $notes[] = 'indice base non ancora verificato sul bollettino ufficiale';
        }
    }

    $targetFound = istatLookupIndex($db, (int) $target['year'], (int) ($target['month'] ?? 0));
    if ($targetFound['value'] === null) {
        // Nessun dato per il periodo chiesto: si scende all'ultimo pubblicato
        // invece di rispondere errore — ma si dice quale si e' usato.
        $latest = istatLatestPeriod($db);
        if ($latest === null) {
            return ['ok' => false, 'message' => 'Nessun indice ISTAT disponibile. Importa gli indici da Impostazioni → Indici ISTAT.'];
        }
        $targetFound = istatLookupIndex($db, $latest['year'], $latest['month']);
        $notes[] = 'periodo richiesto non ancora pubblicato: usato l\'ultimo disponibile';
    }

    if ($targetFound['value'] === null) {
        return ['ok' => false, 'message' => 'Nessun indice ISTAT disponibile per il periodo di adeguamento.'];
    }

    if (!$targetFound['exact'] && ($target['month'] ?? 0) > 0) {
        $notes[] = 'indice di adeguamento non disponibile per il mese richiesto: usata la media annua ' . $targetFound['year'];
    }
    if ($targetFound['source'] === 'fallback') {
        $notes[] = 'indice di adeguamento da copia di riserva del codice';
    }
    if ($targetFound['source'] === 'seed') {
        $notes[] = 'indice di adeguamento non ancora verificato sul bollettino ufficiale';
    }

    $targetIndex  = $targetFound['value'];
    $variationPct = (($targetIndex - $baselineIndex) / $baselineIndex) * 100.0;
    $appliedPct   = $variationPct * $share;
    $newRent      = round($currentRent * (1 + $appliedPct / 100.0), 2);
    $monthlyInc   = round($newRent - $currentRent, 2);

    return [
        'ok'               => true,
        'baseline_index'   => round($baselineIndex, 3),
        'baseline_period'  => $baselinePeriod,
        'target_index'     => round($targetIndex, 3),
        'target_period'    => istatFormatPeriod($targetFound['year'], $targetFound['month']),
        // La stessa cosa in forma memorizzabile: chi applica l'adeguamento deve
        // salvare la nuova base, e l'etichetta qui sopra non si rilegge.
        'target_period_key' => istatStorablePeriod($targetFound['year'], $targetFound['month']),
        'target_year'      => $targetFound['year'],
        'variation_pct'    => round($variationPct, 3),
        'applied_pct'      => round($appliedPct, 3),
        'share'            => $share,
        'current_rent'     => round($currentRent, 2),
        'new_rent'         => $newRent,
        'monthly_increase' => $monthlyInc,
        'annual_increase'  => round($monthlyInc * 12, 2),
        'warnings'         => $notes,
    ];
}

/**
 * @return array{rows:array<string,array{ref_year:int,ref_month:int,index_value:float,period:string}>, data_lines:int, skipped:int}
 */
function istatParseCsv(string $csv): array
{
    $csv   = str_replace(["\r\n", "\r"], "\n", $csv);
    $lines = array_values(array_filter(explode("\n", $csv), static fn($l) => trim($l) !== ''));

    // Separatore: si sceglie quello piu' frequente nella prima riga. Il punto e
    // virgola va provato per primo perche' e' quello dei CSV italiani, dove la
    // virgola e' gia' occupata dai decimali.
    $sep = ';';
    if ($lines) {
        $counts = [';' => substr_count($lines[0], ';'), "\t" => substr_count($lines[0], "\t"), ',' => substr_count($lines[0], ',')];
        arsort($counts);
        $sep = array_key_first($counts);
        if ($counts[$sep] === 0) $sep = ';';
    }

    // Intestazione: se c'e', si cercano le colonne per nome; altrimenti si
    // assume periodo nella prima colonna e valore nella seconda.
    $periodCol = 0;
    $valueCol  = 1;
    $start     = 0;

    $first = str_getcsv($lines[0] ?? '', $sep, '"', '\\');
    $isHeader = false;
    foreach ($first as $i => $cell) {
        $c = mb_strtolower(trim((string) $cell));
        if ($c === '') continue;
        if (preg_match('/periodo|tempo|mese|data|time/', $c)) { $periodCol = $i; $isHeader = true; }
        if (preg_match('/valore|indice|index|value/', $c))     { $valueCol  = $i; $isHeader = true; }
    }
    if ($isHeader) $start = 1;

    $rows    = [];
    $skipped = 0;
    $dataLines = 0;

    for ($i = $start; $i < count($lines); $i++) {
        $cells = str_getcsv($lines[$i], $sep, '"', '\\');
        $dataLines++;

        $period = istatParsePeriod($cells[$periodCol] ?? null);
        $value  = istatParseDecimal($cells[$valueCol] ?? null);

        // Un indice FOI base 2015=100 sta in un intervallo stretto. Il controllo
        // non e' pedanteria: intercetta la colonna sbagliata (una variazione
        // percentuale, un numero d'ordine) prima che finisca in tabella e
        // diventi un adeguamento assurdo su un canone vero.
        if ($period === null || $value === null || $value < 50 || $value > 400) {
            $skipped++;
            continue;
        }

        $key = $period['year'] . '-' . $period['month'];
        $rows[$key] = [
            'ref_year'    => $period['year'],
            'ref_month'   => $period['month'],
            'index_value' => $value,
            'period'      => istatFormatPeriod($period['year'], $period['month']),
        ];
    }

    return ['rows' => $rows, 'data_lines' => $dataLines, 'skipped' => $skipped];
}

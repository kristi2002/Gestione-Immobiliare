<?php
/**
 * Property valuation engine — OMI quotazioni management + on-demand estimate.
 *
 * OMI quotazioni (per-zone €/m² values):
 *   GET    /api/valuation.php                    — list OMI rows (comune, search)
 *   GET    /api/valuation.php?id={id}            — single OMI row
 *   POST   /api/valuation.php                    — create/upsert OMI row (manuale)
 *   PUT    /api/valuation.php?id={id}            — update OMI row (manuale)
 *   DELETE /api/valuation.php?id={id}            — delete OMI row
 *   POST   /api/valuation.php?action=import      — bulk import listino ufficiale (CSV)
 *
 * Estimate:
 *   GET    /api/valuation.php?action=estimate&property_id={id}
 *   POST   /api/valuation.php?action=save_appraisal — congela la stima in property_appraisals
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/omi.php';
apiHandleOptions();

const OMI_TYPES = ['appartamento', 'villa', 'ufficio', 'negozio', 'box', 'terreno', 'altro'];

// Il listino nazionale completo pesa decine di MB; l'import ragionevole è per
// provincia o comune. Il limite tiene il payload dentro i limiti di PHP e dice
// all'agente di scaricare l'estratto giusto invece di far fallire la richiesta
// a metà con un errore di memoria.
const OMI_IMPORT_MAX_BYTES = 8388608; // 8 MB

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $action = trim($_GET['action'] ?? '');

    if ($method === 'GET' && $action === 'estimate') {
        estimateProperty($db, (int) ($_GET['property_id'] ?? 0));
    }
    if ($method === 'POST' && $action === 'import') {
        importOmi($db);
    }
    if ($method === 'POST' && $action === 'save_appraisal') {
        saveAppraisal($db);
    }

    switch ($method) {
        case 'GET':
            $id ? getOmi($db, $id) : listOmi($db);
            break;
        case 'POST':
            createOmi($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID quotazione mancante.');
            updateOmi($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID quotazione mancante.');
            deleteOmi($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

function estimateProperty(PDO $db, int $propertyId): void
{
    if ($propertyId <= 0) apiError('property_id mancante.');

    $stmt = $db->prepare('SELECT * FROM properties WHERE id = :id');
    $stmt->execute(['id' => $propertyId]);
    $p = $stmt->fetch();
    if (!$p) apiError('Immobile non trovato.', 404);

    $type = $p['property_type'] ?? 'appartamento';

    // Le quotazioni OMI sono per metro quadro COMMERCIALE (superficie lorda
    // ponderata: i balconi e le cantine pesano meno del vano abitabile). Se la
    // scheda ha il dettaglio delle superfici si usa quello, altrimenti si
    // ripiega su `sqm` dichiarando il ripiego — moltiplicare un €/m²
    // commerciale per una superficie calpestabile sottostima l'immobile.
    $surfStmt = $db->prepare('SELECT SUM(commercial_sqm) FROM property_surfaces WHERE property_id = :id');
    $surfStmt->execute(['id' => $propertyId]);
    $commercial = (float) ($surfStmt->fetchColumn() ?: 0);

    $rawSqm = $p['sqm'] !== null ? (float) $p['sqm'] : null;
    $sqm       = $commercial > 0 ? $commercial : $rawSqm;
    $sqmSource = $commercial > 0 ? 'commerciale' : 'sqm';

    $result = [
        'property_id'   => $propertyId,
        'address'       => $p['address'],
        'city'          => $p['city'],
        'sqm'           => $sqm,
        'sqm_source'    => $sqmSource,
        'property_type' => $type,
        'omi'           => null,
        'coefficients'  => null,
        'comparables'   => null,
        'suggested'     => null,
        'breakdown'     => [],
        'warnings'      => [],
    ];

    if ($sqm === null || $sqm <= 0) {
        $result['warnings'][] = 'Superficie (m²) mancante: la stima è possibile solo con i m².';
    } elseif ($sqmSource === 'sqm') {
        $result['warnings'][] = 'Superficie commerciale non dettagliata: si usano i m² della scheda. I valori OMI sono per m² commerciale.';
    }

    // --- OMI-based range -----------------------------------------------------
    [$omiRow, $omiScope] = findOmiQuotation($db, (string) $p['city'], $type, trim((string) ($p['cadastral_zone'] ?? '')));

    $omi = null;
    if ($omiRow) {
        $status = omiPeriodStatus($omiRow['period']);

        if ($sqm) {
            $omi = [
                'zone'          => $omiRow['cadastral_zone'],
                'scope'         => $omiScope,
                'period'        => $status['period'],
                'period_level'  => $status['level'],
                'period_label'  => $status['label'],
                'source'        => $omiRow['source'] ?? 'manuale',
                'price_min_sqm' => $omiRow['price_min_sqm'] !== null ? (float) $omiRow['price_min_sqm'] : null,
                'price_max_sqm' => $omiRow['price_max_sqm'] !== null ? (float) $omiRow['price_max_sqm'] : null,
                'rent_min_sqm'  => $omiRow['rent_min_sqm']  !== null ? (float) $omiRow['rent_min_sqm']  : null,
                'rent_max_sqm'  => $omiRow['rent_max_sqm']  !== null ? (float) $omiRow['rent_max_sqm']  : null,
            ];
            $omi['value_min'] = $omi['price_min_sqm'] !== null ? round($omi['price_min_sqm'] * $sqm) : null;
            $omi['value_max'] = $omi['price_max_sqm'] !== null ? round($omi['price_max_sqm'] * $sqm) : null;
            $omi['rent_min']  = $omi['rent_min_sqm']  !== null ? round($omi['rent_min_sqm']  * $sqm) : null;
            $omi['rent_max']  = $omi['rent_max_sqm']  !== null ? round($omi['rent_max_sqm']  * $sqm) : null;
        }

        if ($status['level'] === 'stale') {
            $result['warnings'][] = 'Quotazione OMI ' . $status['period'] . ': dati scaduti, aggiorna il listino prima di presentare la stima.';
        } elseif ($status['level'] === 'unknown') {
            $result['warnings'][] = 'La quotazione OMI usata non ha un semestre di riferimento valido: impossibile dire se è aggiornata.';
        }
        if ($omiScope === 'comune') {
            $result['warnings'][] = 'Zona OMI non indicata su questo immobile: si usa l\'intervallo di tutte le zone di ' . $p['city'] . ', quindi molto ampio. Compila la zona catastale nella scheda per una stima stretta.';
        } elseif ($omiScope === 'generic') {
            $result['warnings'][] = 'Nessuna quotazione per la zona ' . ($p['cadastral_zone'] ?: '—') . ': si usa la quotazione generica del comune.';
        }
    } else {
        $zone = trim((string) ($p['cadastral_zone'] ?? ''));
        $result['warnings'][] = 'Nessuna quotazione OMI per ' . $p['city'] . ($zone !== '' ? " (zona $zone)" : '') . ' / ' . $type . '. Importa il listino o inseriscila in Valutazioni.';
    }
    $result['omi'] = $omi;

    // --- Coefficienti di merito ---------------------------------------------
    // La forbice OMI vale per la zona; questi la portano sull'immobile.
    $coef = omiMeritCoefficients($p);
    $result['coefficients'] = $coef;
    if ($coef['capped']) {
        $result['warnings'][] = 'Le rettifiche superano il ±35% consentito e sono state limitate: verifica i dati della scheda o inserisci una stima manuale.';
    }

    $omiMinAdj = ($omi && $omi['value_min'] !== null) ? round($omi['value_min'] * $coef['factor']) : null;
    $omiMaxAdj = ($omi && $omi['value_max'] !== null) ? round($omi['value_max'] * $coef['factor']) : null;
    $rentMinAdj = ($omi && $omi['rent_min'] !== null) ? round($omi['rent_min'] * $coef['factor']) : null;
    $rentMaxAdj = ($omi && $omi['rent_max'] !== null) ? round($omi['rent_max'] * $coef['factor']) : null;

    // --- Comparables from own stock (same city + type, with a price) ---------
    $cmpStmt = $db->prepare(
        "SELECT id, address, price, price_type, sqm
         FROM properties
         WHERE id <> :id AND city = :city AND property_type = :type
           AND price IS NOT NULL AND price > 0 AND sqm IS NOT NULL AND sqm > 0
           AND status IN ('sold','rented','available')
         ORDER BY updated_at DESC
         LIMIT 8"
    );
    $cmpStmt->execute(['id' => $propertyId, 'city' => $p['city'], 'type' => $type]);
    $rows = $cmpStmt->fetchAll();

    $saleSqmPrices = [];
    $rentSqmPrices = [];
    $sample = [];
    foreach ($rows as $r) {
        $pps = (float) $r['price'] / (float) $r['sqm'];
        if (($r['price_type'] ?? '') === 'vendita') $saleSqmPrices[] = $pps;
        else $rentSqmPrices[] = $pps;
        $sample[] = [
            'address'    => $r['address'],
            'price'      => (float) $r['price'],
            'price_type' => $r['price_type'],
            'sqm'        => (float) $r['sqm'],
            'price_sqm'  => round($pps, 2),
        ];
    }

    $comparables = null;
    if ($sqm && (count($saleSqmPrices) || count($rentSqmPrices))) {
        $comparables = [
            'count'       => count($sample),
            'sample'      => $sample,
            'value_est'   => count($saleSqmPrices) ? round(avg($saleSqmPrices) * $sqm) : null,
            'rent_est'    => count($rentSqmPrices) ? round(avg($rentSqmPrices) * $sqm) : null,
            'sale_sqm_avg'=> count($saleSqmPrices) ? round(avg($saleSqmPrices), 2) : null,
            'rent_sqm_avg'=> count($rentSqmPrices) ? round(avg($rentSqmPrices), 2) : null,
        ];
    } else {
        $result['warnings'][] = 'Comparabili interni insufficienti (stesso comune, stessa tipologia, con prezzo e m²).';
    }
    $result['comparables'] = $comparables;

    // --- Suggested -----------------------------------------------------------
    //
    // L'intervallo è la forbice OMI rettificata (area × min, area × max), non la
    // dispersione fra due stimatori: con il solo OMI — il caso normale — un
    // intervallo costruito sui punti medi collasserebbe in un unico numero e la
    // scheda mostrerebbe "€192.000 – €192.000".
    // I comparabili interni ALLARGANO la forbice quando cadono fuori: se il
    // mercato reale dell'agenzia sta sopra o sotto il listino, quel fatto va
    // mostrato, non mediato via.
    $valueMin = $omiMinAdj;
    $valueMax = $omiMaxAdj;
    if ($comparables && $comparables['value_est'] !== null) {
        $valueMin = $valueMin === null ? $comparables['value_est'] : min($valueMin, $comparables['value_est']);
        $valueMax = $valueMax === null ? $comparables['value_est'] : max($valueMax, $comparables['value_est']);
    }

    $rentMin = $rentMinAdj;
    $rentMax = $rentMaxAdj;
    if ($comparables && $comparables['rent_est'] !== null) {
        $rentMin = $rentMin === null ? $comparables['rent_est'] : min($rentMin, $comparables['rent_est']);
        $rentMax = $rentMax === null ? $comparables['rent_est'] : max($rentMax, $comparables['rent_est']);
    }

    // Il valore di sintesi resta la media delle basi disponibili: è il numero
    // che l'agente pronuncia, l'intervallo è quello che difende.
    $valueCandidates = [];
    if ($omiMinAdj !== null && $omiMaxAdj !== null) $valueCandidates[] = ($omiMinAdj + $omiMaxAdj) / 2;
    if ($comparables && $comparables['value_est'] !== null) $valueCandidates[] = $comparables['value_est'];

    $rentCandidates = [];
    if ($rentMinAdj !== null && $rentMaxAdj !== null) $rentCandidates[] = ($rentMinAdj + $rentMaxAdj) / 2;
    if ($comparables && $comparables['rent_est'] !== null) $rentCandidates[] = $comparables['rent_est'];

    $result['suggested'] = [
        'value'        => count($valueCandidates) ? round(avg($valueCandidates)) : null,
        'rent'         => count($rentCandidates) ? round(avg($rentCandidates)) : null,
        'value_min'    => $valueMin,
        'value_max'    => $valueMax,
        'rent_min'     => $rentMin,
        'rent_max'     => $rentMax,
        'comparable_1' => $sample[0] ?? null,
        'comparable_2' => $sample[1] ?? null,
        'basis'        => trim(($omi ? 'OMI' : '') . ($omi && $comparables ? ' + ' : '') . ($comparables ? 'comparabili' : '')) ?: 'dati insufficienti',
    ];

    // --- Breakdown -----------------------------------------------------------
    // L'agente deve poter mostrare al venditore da dove esce il numero. Senza
    // il conto in chiaro la stima è un'opinione del software.
    $result['breakdown'] = buildBreakdown($sqm, $sqmSource, $omi, $coef, $omiMinAdj, $omiMaxAdj);

    apiSuccess($result);
}

/**
 * Sceglie la quotazione da applicare e DICHIARA con che precisione l'ha trovata.
 *
 * Il punto delicato è l'immobile senza zona catastale: prendere in quel caso una
 * riga qualsiasi del comune significa valutare un immobile di periferia con i
 * valori del centro senza che nulla lo segnali. Quando la zona manca e non
 * esiste una riga generica, si restituisce l'INVILUPPO di tutte le zone del
 * comune (min dei min, max dei max) — un intervallo largo e onesto invece di un
 * numero preciso e sbagliato.
 *
 * @return array{0: ?array, 1: string} riga + scope ('zone'|'generic'|'comune')
 */
function findOmiQuotation(PDO $db, string $comune, string $type, string $zone): array
{
    if ($zone !== '') {
        $stmt = $db->prepare(
            'SELECT * FROM omi_quotazioni
              WHERE comune = :comune AND property_type = :type AND cadastral_zone = :zone
              LIMIT 1'
        );
        $stmt->execute(['comune' => $comune, 'type' => $type, 'zone' => $zone]);
        if ($row = $stmt->fetch()) {
            return [$row, 'zone'];
        }
    }

    // Riga generica di comune (zona vuota), inserita a mano dove il listino non
    // arriva al dettaglio di zona.
    $stmt = $db->prepare(
        "SELECT * FROM omi_quotazioni
          WHERE comune = :comune AND property_type = :type AND cadastral_zone = ''
          LIMIT 1"
    );
    $stmt->execute(['comune' => $comune, 'type' => $type]);
    if ($row = $stmt->fetch()) {
        return [$row, $zone !== '' ? 'generic' : 'zone'];
    }

    if ($zone !== '') {
        // La zona è dichiarata ma non è a listino: non si ripiega su altre
        // zone, sarebbero valori di un'altra parte del comune.
        return [null, 'none'];
    }

    $stmt = $db->prepare(
        'SELECT MIN(price_min_sqm) AS price_min_sqm, MAX(price_max_sqm) AS price_max_sqm,
                MIN(rent_min_sqm)  AS rent_min_sqm,  MAX(rent_max_sqm)  AS rent_max_sqm,
                MAX(period) AS period, COUNT(*) AS n
           FROM omi_quotazioni
          WHERE comune = :comune AND property_type = :type'
    );
    $stmt->execute(['comune' => $comune, 'type' => $type]);
    $row = $stmt->fetch();
    if ($row && (int) $row['n'] > 0 && $row['price_min_sqm'] !== null) {
        $row['cadastral_zone'] = 'tutte (' . (int) $row['n'] . ' zone)';
        $row['source']         = 'import';
        return [$row, 'comune'];
    }

    return [null, 'none'];
}

/** @return array<int,array{label:string,detail:string}> */
function buildBreakdown(?float $sqm, string $sqmSource, ?array $omi, array $coef, ?int $minAdj, ?int $maxAdj): array
{
    if (!$omi || $sqm === null || $sqm <= 0) {
        return [];
    }

    $n0 = static fn($v) => number_format((float) $v, 0, ',', '.');
    $n2 = static fn($v) => rtrim(rtrim(number_format((float) $v, 2, ',', '.'), '0'), ',');

    $sqmLabel = $n2($sqm) . ' m²' . ($sqmSource === 'commerciale' ? ' commerciali' : '');
    $out = [];

    if ($omi['price_min_sqm'] !== null && $omi['price_max_sqm'] !== null) {
        $out[] = [
            'label'  => 'Base OMI',
            'detail' => $sqmLabel . ' × ' . $n0($omi['price_min_sqm']) . '–' . $n0($omi['price_max_sqm']) . ' €/m²'
                        . ' = ' . $n0($omi['value_min']) . ' – ' . $n0($omi['value_max']) . ' €',
        ];
    }

    foreach ($coef['items'] as $item) {
        $out[] = [
            'label'  => $item['label'],
            'detail' => sprintf('%+.0f%%', $item['pct']),
        ];
    }

    if ($coef['items'] && $minAdj !== null && $maxAdj !== null) {
        $out[] = [
            'label'  => 'Valore rettificato',
            'detail' => $n0($omi['value_min']) . '–' . $n0($omi['value_max']) . ' € × '
                        . number_format($coef['factor'], 3, ',', '.')
                        . ' = ' . $n0($minAdj) . ' – ' . $n0($maxAdj) . ' €',
        ];
    }

    return $out;
}

function avg(array $nums): float
{
    return count($nums) ? array_sum($nums) / count($nums) : 0.0;
}

// ---------------------------------------------------------------------------
// Salvataggio della stima come valutazione datata
// ---------------------------------------------------------------------------

/**
 * Congela il risultato della stima rapida in `property_appraisals`.
 *
 * Non si fida dei numeri inviati dal client: ricalcola lato server e salva
 * quelli. Il client manda solo property_id, lo stato conservativo scelto e le
 * note — una valutazione firmata dall'agenzia non può dipendere da un valore
 * modificabile nel browser.
 */
function saveAppraisal(PDO $db): void
{
    $body       = apiGetJsonBody();
    $propertyId = (int) ($body['property_id'] ?? 0);
    if ($propertyId <= 0) apiError('property_id mancante.');

    $stmt = $db->prepare('SELECT * FROM properties WHERE id = :id');
    $stmt->execute(['id' => $propertyId]);
    $p = $stmt->fetch();
    if (!$p) apiError('Immobile non trovato.', 404);

    $type = $p['property_type'] ?? 'appartamento';

    $surfStmt = $db->prepare('SELECT SUM(commercial_sqm) FROM property_surfaces WHERE property_id = :id');
    $surfStmt->execute(['id' => $propertyId]);
    $commercial = (float) ($surfStmt->fetchColumn() ?: 0);
    $sqm = $commercial > 0 ? $commercial : ($p['sqm'] !== null ? (float) $p['sqm'] : null);

    if ($sqm === null || $sqm <= 0) {
        apiError('Impossibile salvare la valutazione: superficie (m²) mancante sulla scheda immobile.');
    }

    [$omiRow, $omiScope] = findOmiQuotation($db, (string) $p['city'], $type, trim((string) ($p['cadastral_zone'] ?? '')));
    if (!$omiRow) {
        apiError('Nessuna quotazione OMI applicabile: importa il listino del comune prima di salvare la valutazione.');
    }

    $coef   = omiMeritCoefficients($p);
    $status = omiPeriodStatus($omiRow['period']);

    $vMin = $omiRow['price_min_sqm'] !== null ? (float) $omiRow['price_min_sqm'] * $sqm * $coef['factor'] : null;
    $vMax = $omiRow['price_max_sqm'] !== null ? (float) $omiRow['price_max_sqm'] * $sqm * $coef['factor'] : null;
    $rMin = $omiRow['rent_min_sqm']  !== null ? (float) $omiRow['rent_min_sqm']  * $sqm * $coef['factor'] : null;
    $rMax = $omiRow['rent_max_sqm']  !== null ? (float) $omiRow['rent_max_sqm']  * $sqm * $coef['factor'] : null;

    if ($vMin === null || $vMax === null) {
        apiError('La quotazione OMI applicabile non ha valori di vendita: impossibile calcolare la valutazione.');
    }

    $estimatedValue = round(($vMin + $vMax) / 2, 2);
    $estimatedRent  = ($rMin !== null && $rMax !== null) ? round(($rMin + $rMax) / 2, 2) : null;

    // Lo stato conservativo della valutazione riflette la scheda immobile: è lo
    // stesso dato che ha generato il coefficiente, tenerli allineati evita una
    // valutazione che dichiara "buono" e sconta il 18% da ristrutturare.
    $conditionMap = ['nuovo' => 'ottimo', 'ottimo' => 'ottimo', 'buono' => 'buono', 'da_ristrutturare' => 'da_ristrutturare'];
    $condition    = $conditionMap[trim((string) ($p['condition_state'] ?? ''))] ?? 'buono';

    $basis = 'OMI ' . ($status['period'] ?? 'periodo ignoto')
           . ' · zona ' . ($omiRow['cadastral_zone'] !== '' ? $omiRow['cadastral_zone'] : 'generica')
           . ($omiScope === 'comune' ? ' (inviluppo comune)' : '')
           . ' · ' . number_format($sqm, 2, ',', '.') . ' m²'
           . ($commercial > 0 ? ' commerciali' : '')
           . ' · coeff. ' . number_format($coef['factor'], 3, ',', '.');

    $stmt = $db->prepare(
        'INSERT INTO property_appraisals
            (property_id, appraised_by, estimated_value, estimated_rent, condition_rating, notes,
             comparable_1_address, comparable_1_price, comparable_2_address, comparable_2_price,
             appraisal_date, omi_period, omi_zone, omi_price_min, omi_price_max,
             sqm_used, coefficient, estimate_basis)
         VALUES
            (:property_id, :appraised_by, :estimated_value, :estimated_rent, :condition_rating, :notes,
             :c1a, :c1p, :c2a, :c2p,
             CURDATE(), :omi_period, :omi_zone, :omi_price_min, :omi_price_max,
             :sqm_used, :coefficient, :estimate_basis)'
    );

    $cmpStmt = $db->prepare(
        "SELECT address, price FROM properties
          WHERE id <> :id AND city = :city AND property_type = :type
            AND price IS NOT NULL AND price > 0 AND price_type = 'vendita'
          ORDER BY updated_at DESC LIMIT 2"
    );
    $cmpStmt->execute(['id' => $propertyId, 'city' => $p['city'], 'type' => $type]);
    $cmp = $cmpStmt->fetchAll();

    $stmt->execute([
        'property_id'      => $propertyId,
        'appraised_by'     => getCurrentAdminId() ?: null,
        'estimated_value'  => $estimatedValue,
        'estimated_rent'   => $estimatedRent,
        'condition_rating' => $condition,
        'notes'            => trim((string) ($body['notes'] ?? '')) ?: null,
        'c1a'              => $cmp[0]['address'] ?? null,
        'c1p'              => $cmp[0]['price']   ?? null,
        'c2a'              => $cmp[1]['address'] ?? null,
        'c2p'              => $cmp[1]['price']   ?? null,
        'omi_period'       => $status['period'],
        'omi_zone'         => $omiRow['cadastral_zone'] !== '' ? $omiRow['cadastral_zone'] : null,
        'omi_price_min'    => $omiRow['price_min_sqm'],
        'omi_price_max'    => $omiRow['price_max_sqm'],
        'sqm_used'         => round($sqm, 2),
        'coefficient'      => $coef['factor'],
        'estimate_basis'   => $basis,
    ]);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'appraisal', $newId, 'Valutazione OMI immobile #' . $propertyId);

    apiSuccess([
        'id'              => $newId,
        'estimated_value' => $estimatedValue,
        'estimated_rent'  => $estimatedRent,
        'omi_period'      => $status['period'],
        'basis'           => $basis,
        'message'         => 'Valutazione salvata sulla scheda immobile.',
    ]);
}

// ---------------------------------------------------------------------------
// Import del listino ufficiale
// ---------------------------------------------------------------------------

/**
 * Importa un estratto del listino OMI dell'Agenzia delle Entrate.
 *
 * Formato atteso: il CSV pubblicato dall'Agenzia (separatore `;`, decimali con
 * la virgola, intestazione con Comune_descrizione / Zona / Descr_Tipologia /
 * Stato / Compr_min / Compr_max / Loc_min / Loc_max). Il file vero comincia con
 * una o due righe di preambolo, quindi l'intestazione viene cercata invece che
 * assunta alla riga 1.
 *
 * Due scelte che vale la pena conoscere:
 *
 * - Si importano le righe con Stato = NORMALE. Il listino pubblica la stessa
 *   zona in più stati conservativi; prenderli tutti moltiplicherebbe le righe e
 *   romperebbe la chiave unica (comune, zona, tipologia). La base NORMALE più i
 *   coefficienti di merito dà lo stesso risultato restando interrogabile.
 *   Dove il NORMALE non esiste per una tipologia si prende quello disponibile e
 *   lo si dichiara nel report.
 *
 * - Le righe corrette a mano (`source = 'manuale'`) NON vengono sovrascritte:
 *   sono gli override e le microzone di cui parla la scheda, e un import
 *   semestrale che le cancellasse renderebbe il lavoro dell'agente inutile.
 */
function importOmi(PDO $db): void
{
    $body   = apiGetJsonBody();
    $csv    = (string) ($body['csv'] ?? '');
    $period = omiNormalizePeriod((string) ($body['period'] ?? ''));
    $dryRun = !empty($body['dry_run']);

    if (trim($csv) === '') apiError('Nessun contenuto CSV ricevuto.');
    if (strlen($csv) > OMI_IMPORT_MAX_BYTES) {
        apiError('File troppo grande (max ' . (OMI_IMPORT_MAX_BYTES / 1048576) . ' MB). Scarica l\'estratto per provincia o comune invece del listino nazionale.');
    }
    if ($period === null) {
        apiError('Indica il semestre di riferimento del listino (es. 2026-S1).');
    }

    $parsed = parseOmiCsv($csv);
    if ($parsed['error'] !== null) apiError($parsed['error']);
    if (!$parsed['rows']) {
        apiError('Nessuna riga utilizzabile nel CSV. Attese le colonne Comune_descrizione, Zona, Descr_Tipologia, Compr_min, Compr_max.');
    }

    // Righe protette: override manuali già presenti.
    $manual = [];
    $mStmt = $db->query("SELECT comune, cadastral_zone, property_type FROM omi_quotazioni WHERE source = 'manuale'");
    foreach ($mStmt->fetchAll() as $m) {
        $manual[omiKey($m['comune'], $m['cadastral_zone'], $m['property_type'])] = true;
    }

    $skippedManual = 0;
    $toWrite       = [];
    foreach ($parsed['rows'] as $key => $row) {
        if (isset($manual[$key])) { $skippedManual++; continue; }
        $toWrite[$key] = $row;
    }

    $preview = array_slice(array_values($toWrite), 0, 15);

    $report = [
        'period'           => $period,
        'dry_run'          => $dryRun,
        'rows_in_file'     => $parsed['data_lines'],
        'rows_ready'       => count($toWrite),
        'skipped_manual'   => $skippedManual,
        'skipped_typology' => $parsed['skipped_typology'],
        'skipped_novalue'  => $parsed['skipped_novalue'],
        'non_normal_state' => $parsed['non_normal'],
        'comuni'           => $parsed['comuni'],
        'preview'          => $preview,
    ];

    if ($dryRun) {
        $report['message'] = 'Anteprima: nessuna riga scritta.';
        apiSuccess($report);
    }

    $stmt = $db->prepare(
        "INSERT INTO omi_quotazioni
            (comune, cadastral_zone, property_type, price_min_sqm, price_max_sqm,
             rent_min_sqm, rent_max_sqm, period, source, omi_stato, notes)
         VALUES
            (:comune, :cadastral_zone, :property_type, :price_min_sqm, :price_max_sqm,
             :rent_min_sqm, :rent_max_sqm, :period, 'import', :omi_stato, :notes)
         ON DUPLICATE KEY UPDATE
            price_min_sqm = VALUES(price_min_sqm), price_max_sqm = VALUES(price_max_sqm),
            rent_min_sqm  = VALUES(rent_min_sqm),  rent_max_sqm  = VALUES(rent_max_sqm),
            period        = VALUES(period),        source        = 'import',
            omi_stato     = VALUES(omi_stato),     notes         = VALUES(notes)"
    );

    $db->beginTransaction();
    try {
        foreach ($toWrite as $row) {
            $stmt->execute([
                'comune'         => $row['comune'],
                'cadastral_zone' => $row['cadastral_zone'],
                'property_type'  => $row['property_type'],
                'price_min_sqm'  => $row['price_min_sqm'],
                'price_max_sqm'  => $row['price_max_sqm'],
                'rent_min_sqm'   => $row['rent_min_sqm'],
                'rent_max_sqm'   => $row['rent_max_sqm'],
                'period'         => $period,
                'omi_stato'      => $row['omi_stato'],
                'notes'          => $row['notes'],
            ]);
        }
        $db->commit();
    } catch (PDOException $e) {
        $db->rollBack();
        throw $e;
    }

    // logActivity accetta solo create/update/delete/login/logout: un'azione
    // 'import' verrebbe scartata in silenzio e l'import non lascerebbe traccia.
    logActivity('create', 'omi', 0, 'Import listino OMI ' . $period . ': ' . count($toWrite) . ' quotazioni');

    $report['message'] = count($toWrite) . ' quotazioni importate per il semestre ' . $period . '.';
    apiSuccess($report);
}

function omiKey(string $comune, string $zone, string $type): string
{
    return mb_strtolower($comune) . '|' . mb_strtolower($zone) . '|' . $type;
}

/**
 * Legge il CSV e aggrega per (comune, zona, tipologia).
 *
 * L'aggregazione serve perché la nostra tipologia è più grossolana di quella
 * del listino: "Abitazioni civili" e "Abitazioni di tipo economico" cadono
 * entrambe in `appartamento`. Unendole si prende il minimo dei minimi e il
 * massimo dei massimi — la forbice della categoria allargata è davvero quella,
 * e una media nasconderebbe l'estremo che serve a trattare.
 */
function parseOmiCsv(string $csv): array
{
    $csv = str_replace(["\r\n", "\r"], "\n", $csv);
    // Il listino ufficiale è in ISO-8859-1: senza conversione i comuni con
    // accento ("Forlì") arrivano come byte non validi e MySQL li tronca.
    if (!mb_check_encoding($csv, 'UTF-8')) {
        $csv = mb_convert_encoding($csv, 'UTF-8', 'ISO-8859-1');
    }
    $csv   = preg_replace('/^\xEF\xBB\xBF/', '', $csv);
    $lines = explode("\n", $csv);

    $delim     = ';';
    $headerIdx = null;
    $header    = [];

    foreach ($lines as $i => $line) {
        if (trim($line, " \t;,") === '') continue;
        $d    = substr_count($line, ';') >= substr_count($line, ',') ? ';' : ',';
        $cols = array_map(static fn($c) => strtolower(trim($c, " \t\"'")), explode($d, $line));
        if (in_array('compr_min', $cols, true) || in_array('comune_descrizione', $cols, true)) {
            $headerIdx = $i;
            $header    = $cols;
            $delim     = $d;
            break;
        }
        if ($i > 20) break; // il preambolo del listino è di poche righe
    }

    if ($headerIdx === null) {
        return ['error' => 'Intestazione non riconosciuta: serve il CSV OMI dell\'Agenzia delle Entrate (colonne Comune_descrizione, Zona, Descr_Tipologia, Compr_min, Compr_max).', 'rows' => []];
    }

    $col = static function (array $header, array $names): ?int {
        foreach ($names as $n) {
            $idx = array_search($n, $header, true);
            if ($idx !== false) return (int) $idx;
        }
        return null;
    };

    $iComune = $col($header, ['comune_descrizione', 'comune_amm', 'comune', 'comune_cat']);
    $iZona   = $col($header, ['zona', 'zona_descr', 'linkzona', 'cod_zona']);
    $iTipo   = $col($header, ['descr_tipologia', 'tipologia', 'descrizione_tipologia']);
    $iStato  = $col($header, ['stato', 'stato_conservativo']);
    $iCMin   = $col($header, ['compr_min', 'compravendita_min', 'valore_min']);
    $iCMax   = $col($header, ['compr_max', 'compravendita_max', 'valore_max']);
    $iLMin   = $col($header, ['loc_min', 'locazione_min']);
    $iLMax   = $col($header, ['loc_max', 'locazione_max']);

    if ($iComune === null || $iTipo === null || $iCMin === null || $iCMax === null) {
        return ['error' => 'Colonne obbligatorie mancanti (Comune_descrizione, Descr_Tipologia, Compr_min, Compr_max).', 'rows' => []];
    }

    // Il listino usa la notazione italiana: il punto separa le MIGLIAIA
    // ("1.600" = milleseicento) e la virgola i decimali ("7,0"). Trattare il
    // punto come separatore decimale trasforma 1.600 €/m² in 1,6 €/m² — un
    // errore di mille volte su ogni valore di vendita, che a valle diventa una
    // stima da 200 € per un appartamento e nessuno se ne accorge dal CSV.
    $num = static function (?string $v): ?float {
        $v = trim((string) $v, " \t\"'");
        if ($v === '' || $v === '-') return null;

        if (str_contains($v, ',')) {
            // Virgola presente ⇒ italiano: i punti sono migliaia.
            $v = str_replace(['.', ','], ['', '.'], $v);
        } elseif (preg_match('/^\d{1,3}(\.\d{3})+$/', $v)) {
            // Solo punti, ognuno seguito da esattamente tre cifre ⇒ migliaia.
            $v = str_replace('.', '', $v);
        }
        // Ogni altro caso ("450", "1600.50", "1.6") è già un numero valido.

        if (!is_numeric($v)) return null;
        $f = (float) $v;
        return $f > 0 ? $f : null;
    };

    $rows            = [];
    $best            = [];   // stato conservativo della riga già accettata
    $dataLines       = 0;
    $skippedTypology = 0;
    $skippedNoValue  = 0;
    $nonNormal       = 0;
    $comuni          = [];

    foreach (array_slice($lines, $headerIdx + 1) as $line) {
        if (trim($line, " \t;,") === '') continue;
        $c = explode($delim, $line);
        if (count($c) <= $iCMax) continue;
        $dataLines++;

        $comune = trim($c[$iComune] ?? '', " \t\"'");
        if ($comune === '') continue;

        $type = omiMapTipologia(trim($c[$iTipo] ?? '', " \t\"'"));
        if ($type === null) { $skippedTypology++; continue; }

        $cMin = $num($c[$iCMin] ?? null);
        $cMax = $num($c[$iCMax] ?? null);
        if ($cMin === null && $cMax === null) { $skippedNoValue++; continue; }

        $stato = $iStato !== null ? strtoupper(trim($c[$iStato] ?? '', " \t\"'")) : '';
        if ($stato !== '' && $stato !== 'NORMALE') $nonNormal++;

        $zone = $iZona !== null ? trim($c[$iZona] ?? '', " \t\"'") : '';
        $key  = omiKey($comune, $zone, $type);

        // Fra più stati conservativi vince NORMALE; a parità si aggrega.
        $isNormal   = ($stato === '' || $stato === 'NORMALE');
        $prevNormal = $best[$key] ?? null;
        if ($prevNormal === true && !$isNormal) {
            continue; // già abbiamo la base standard, non la inquiniamo
        }
        if ($prevNormal === false && $isNormal) {
            unset($rows[$key]); // sostituisce il ripiego con la base standard
        }
        $best[$key] = $isNormal || ($prevNormal ?? false);

        $lMin = $iLMin !== null ? $num($c[$iLMin] ?? null) : null;
        $lMax = $iLMax !== null ? $num($c[$iLMax] ?? null) : null;

        if (!isset($rows[$key])) {
            $rows[$key] = [
                'comune'         => $comune,
                'cadastral_zone' => $zone,
                'property_type'  => $type,
                'price_min_sqm'  => $cMin,
                'price_max_sqm'  => $cMax,
                'rent_min_sqm'   => $lMin,
                'rent_max_sqm'   => $lMax,
                'omi_stato'      => $stato !== '' ? $stato : 'NORMALE',
                'notes'          => null,
            ];
        } else {
            $r = $rows[$key];
            $rows[$key]['price_min_sqm'] = minOrNull($r['price_min_sqm'], $cMin);
            $rows[$key]['price_max_sqm'] = maxOrNull($r['price_max_sqm'], $cMax);
            $rows[$key]['rent_min_sqm']  = minOrNull($r['rent_min_sqm'], $lMin);
            $rows[$key]['rent_max_sqm']  = maxOrNull($r['rent_max_sqm'], $lMax);
        }
        $comuni[$comune] = true;
    }

    // Dove la base standard non esisteva, si dice quale stato è stato usato:
    // una quotazione OTTIMO trattata come base falserebbe i coefficienti.
    foreach ($rows as $k => $r) {
        if (($r['omi_stato'] ?? 'NORMALE') !== 'NORMALE') {
            $rows[$k]['notes'] = 'Base OMI in stato ' . $r['omi_stato'] . ' (NORMALE non pubblicato).';
        }
    }

    return [
        'error'            => null,
        'rows'             => $rows,
        'data_lines'       => $dataLines,
        'skipped_typology' => $skippedTypology,
        'skipped_novalue'  => $skippedNoValue,
        'non_normal'       => $nonNormal,
        'comuni'           => array_slice(array_keys($comuni), 0, 30),
    ];
}

function minOrNull(?float $a, ?float $b): ?float
{
    if ($a === null) return $b;
    if ($b === null) return $a;
    return min($a, $b);
}

function maxOrNull(?float $a, ?float $b): ?float
{
    if ($a === null) return $b;
    if ($b === null) return $a;
    return max($a, $b);
}

// ---------------------------------------------------------------------------
// OMI CRUD
// ---------------------------------------------------------------------------

function listOmi(PDO $db): void
{
    $pagination = apiGetPagination();
    $comune     = trim($_GET['comune'] ?? '');
    $search     = trim($_GET['search'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];
    if ($comune !== '') { $where .= ' AND comune = :comune'; $params['comune'] = $comune; }
    if ($search !== '') {
        $frag = apiWordSearch($search, ['comune', 'cadastral_zone', 'property_type'], $params);
        if ($frag !== '') $where .= ' AND (' . $frag . ')';
    }

    $countSql = "SELECT COUNT(*) FROM omi_quotazioni $where";
    $dataSql  = "SELECT * FROM omi_quotazioni $where ORDER BY comune, cadastral_zone, property_type";
    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);

    // Lo stato di freschezza si calcola qui una volta sola: la tabella deve
    // poter mostrare il badge senza che il client reimplementi le soglie.
    foreach ($items as &$item) {
        $status                 = omiPeriodStatus($item['period']);
        $item['period_level']   = $status['level'];
        $item['period_label']   = $status['label'];
    }
    unset($item);

    $pages = $total > 0 ? (int) ceil($total / $pagination['limit']) : 0;
    apiSuccess([
        'items'   => $items,
        'total'   => $total,
        'page'    => $pagination['page'],
        'limit'   => $pagination['limit'],
        'pages'   => $pages,
        'current_period' => omiCurrentPeriod(),
    ]);
}

function getOmi(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM omi_quotazioni WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Quotazione non trovata.', 404);
    apiSuccess($row);
}

function createOmi(PDO $db): void
{
    $v = validateOmiInput(apiGetJsonBody());
    $stmt = $db->prepare(
        "INSERT INTO omi_quotazioni (comune, cadastral_zone, property_type, price_min_sqm, price_max_sqm, rent_min_sqm, rent_max_sqm, period, notes, source)
         VALUES (:comune, :cadastral_zone, :property_type, :price_min_sqm, :price_max_sqm, :rent_min_sqm, :rent_max_sqm, :period, :notes, 'manuale')
         ON DUPLICATE KEY UPDATE
            price_min_sqm = VALUES(price_min_sqm), price_max_sqm = VALUES(price_max_sqm),
            rent_min_sqm = VALUES(rent_min_sqm), rent_max_sqm = VALUES(rent_max_sqm),
            period = VALUES(period), notes = VALUES(notes), source = 'manuale'"
    );
    $stmt->execute($v);
    logActivity('create', 'omi', (int) $db->lastInsertId(), 'Quotazione OMI: ' . $v['comune'] . ' ' . $v['cadastral_zone']);
    apiSuccess(['message' => 'Quotazione salvata.']);
}

function updateOmi(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT id FROM omi_quotazioni WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) apiError('Quotazione non trovata.', 404);

    $v = validateOmiInput(apiGetJsonBody());
    // Una riga toccata a mano diventa un override e smette di essere
    // sovrascritta dall'import del semestre successivo.
    $stmt = $db->prepare(
        "UPDATE omi_quotazioni SET comune = :comune, cadastral_zone = :cadastral_zone, property_type = :property_type,
            price_min_sqm = :price_min_sqm, price_max_sqm = :price_max_sqm,
            rent_min_sqm = :rent_min_sqm, rent_max_sqm = :rent_max_sqm, period = :period, notes = :notes,
            source = 'manuale'
         WHERE id = :id"
    );
    $stmt->execute(array_merge($v, ['id' => $id]));
    logActivity('update', 'omi', $id, 'Quotazione OMI aggiornata #' . $id);
    getOmi($db, $id);
}

function deleteOmi(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT id FROM omi_quotazioni WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) apiError('Quotazione non trovata.', 404);
    $db->prepare('DELETE FROM omi_quotazioni WHERE id = :id')->execute(['id' => $id]);
    logActivity('delete', 'omi', $id, 'Quotazione OMI eliminata #' . $id);
    apiSuccess(['id' => $id, 'message' => 'Quotazione eliminata.']);
}

function validateOmiInput(array $data): array
{
    $comune = trim($data['comune'] ?? '');
    if ($comune === '') apiError('Il comune è obbligatorio.');
    $type = trim($data['property_type'] ?? 'appartamento');
    if (!in_array($type, OMI_TYPES, true)) $type = 'appartamento';

    $numOrNull = static fn($v) => isset($v) && $v !== '' ? (float) $v : null;

    // Il periodo passa dal normalizzatore: senza un formato garantito il badge
    // "quotazione scaduta" non può funzionare. Se il testo non contiene un anno
    // riconoscibile la richiesta viene respinta invece di salvare un periodo
    // che nessuno potrà più confrontare.
    $rawPeriod = trim($data['period'] ?? '');
    $period    = omiNormalizePeriod($rawPeriod);
    if ($rawPeriod !== '' && $period === null) {
        apiError('Periodo non valido: usa il formato AAAA-S1 o AAAA-S2 (es. 2026-S1).');
    }

    $priceMin = $numOrNull($data['price_min_sqm'] ?? null);
    $priceMax = $numOrNull($data['price_max_sqm'] ?? null);
    $rentMin  = $numOrNull($data['rent_min_sqm'] ?? null);
    $rentMax  = $numOrNull($data['rent_max_sqm'] ?? null);

    // Un min maggiore del max produce un intervallo di stima invertito che
    // nessuna schermata a valle può raddrizzare: si blocca qui.
    if ($priceMin !== null && $priceMax !== null && $priceMin > $priceMax) {
        apiError('Vendita: il valore minimo non può superare il massimo.');
    }
    if ($rentMin !== null && $rentMax !== null && $rentMin > $rentMax) {
        apiError('Affitto: il valore minimo non può superare il massimo.');
    }

    return [
        'comune'         => $comune,
        'cadastral_zone' => trim($data['cadastral_zone'] ?? ''),
        'property_type'  => $type,
        'price_min_sqm'  => $priceMin,
        'price_max_sqm'  => $priceMax,
        'rent_min_sqm'   => $rentMin,
        'rent_max_sqm'   => $rentMax,
        'period'         => $period,
        'notes'          => trim($data['notes'] ?? '') ?: null,
    ];
}

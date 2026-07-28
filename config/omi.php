<?php
/**
 * OMI — dominio delle quotazioni dell'Agenzia delle Entrate.
 *
 * Sta in config/ e non in api/valuation.php perché tre consumatori distinti ne
 * hanno bisogno: l'endpoint delle valutazioni, l'importer del listino e la
 * scheda immobile che deve dire se una stima salvata è ancora attendibile.
 *
 * Tre responsabilità:
 *   1. il SEMESTRE come valore confrontabile (non una stringa libera);
 *   2. la traduzione delle tipologie del listino ufficiale nelle nostre;
 *   3. i coefficienti di merito, che portano la forbice OMI — che vale per la
 *      zona, non per l'appartamento — sul singolo immobile.
 */

// ---------------------------------------------------------------------------
// 1. Periodo (semestre)
// ---------------------------------------------------------------------------

/**
 * Riduce qualunque forma scritta a mano al formato canonico `YYYY-S1|S2`.
 * Restituisce null se il testo non contiene un anno riconoscibile: un periodo
 * ignoto è un'informazione, un periodo indovinato è un errore silenzioso.
 */
function omiNormalizePeriod(?string $raw): ?string
{
    $raw = trim((string) $raw);
    if ($raw === '') {
        return null;
    }

    if (!preg_match('/(19|20)\d{2}/', $raw, $m)) {
        return null;
    }
    $year = (int) $m[0];

    // Tolto l'anno, quello che resta contiene solo il semestre. Cercarlo su
    // ciò che avanza evita di scambiare le cifre dell'anno per un semestre
    // ("2026" non deve diventare S2). In assenza di un marcatore del secondo
    // semestre si assume il primo: è la convenzione con cui il listino viene
    // citato ("valori 2026" = 2026-S1).
    $rest = preg_replace('/(19|20)\d{2}/', ' ', $raw, 1);
    $sem  = preg_match('/(?:^|\W)(?:s|sem\w*)?\s*(?:2|ii)(?:\W|$)/i', (string) $rest) ? 2 : 1;

    return sprintf('%d-S%d', $year, $sem);
}

/**
 * Il semestre come intero monotono, per poter fare differenze.
 * 2026-S1 → 4052, 2026-S2 → 4053.
 */
function omiPeriodIndex(?string $period): ?int
{
    $period = omiNormalizePeriod($period);
    if ($period === null) {
        return null;
    }
    [$year, $sem] = explode('-S', $period);
    return ((int) $year) * 2 + ((int) $sem) - 1;
}

/** Semestre solare corrente (gennaio–giugno = S1). */
function omiCurrentPeriod(?DateTimeImmutable $now = null): string
{
    $now = $now ?? new DateTimeImmutable('today');
    $sem = ((int) $now->format('n')) <= 6 ? 1 : 2;
    return sprintf('%d-S%d', (int) $now->format('Y'), $sem);
}

/**
 * Stato di freschezza di una quotazione.
 *
 * La soglia non è "semestre corrente" perché l'OMI pubblica in ritardo: i
 * valori di un semestre escono a semestre concluso, quindi il listino più
 * recente ottenibile è quasi sempre quello precedente. Segnalare come scaduto
 * il dato più aggiornato che esiste addestrerebbe l'agente a ignorare il badge.
 *
 *   0-1 semestri  → aggiornata
 *   2 semestri    → invecchiata (nota, nessun allarme)
 *   3+ semestri   → scaduta (badge di avviso)
 *
 * @return array{level:string,label:string,age:?int,period:?string}
 */
function omiPeriodStatus(?string $period, ?DateTimeImmutable $now = null): array
{
    $normalized = omiNormalizePeriod($period);
    $idx        = omiPeriodIndex($normalized);
    $currentIdx = omiPeriodIndex(omiCurrentPeriod($now));

    if ($idx === null || $currentIdx === null) {
        return ['level' => 'unknown', 'label' => 'Periodo non indicato', 'age' => null, 'period' => null];
    }

    $age = $currentIdx - $idx;

    if ($age < 0) {
        // Periodo futuro: quasi sempre un refuso di battitura, va visto.
        return ['level' => 'unknown', 'label' => "Periodo futuro ($normalized)", 'age' => $age, 'period' => $normalized];
    }
    if ($age <= 1) {
        return ['level' => 'current', 'label' => "Dati OMI $normalized", 'age' => $age, 'period' => $normalized];
    }
    if ($age === 2) {
        return ['level' => 'aging', 'label' => "Dati OMI $normalized (da verificare)", 'age' => $age, 'period' => $normalized];
    }

    return [
        'level'  => 'stale',
        'label'  => "Dati OMI $normalized scaduti — ricalcolare",
        'age'    => $age,
        'period' => $normalized,
    ];
}

// ---------------------------------------------------------------------------
// 2. Tipologie del listino ufficiale
// ---------------------------------------------------------------------------

/**
 * `Descr_Tipologia` del CSV dell'Agenzia delle Entrate → enum property_type.
 *
 * Il listino distingue molto più finemente di noi (tre fasce di abitazione,
 * due di ufficio, tre di posto auto). La riduzione è voluta: l'enum di
 * `properties` ha sette valori e la stima deve poterci agganciare. Le fasce
 * abitative si sciolgono tutte in `appartamento` e la differenza di pregio
 * viene poi ripresa dai coefficienti di merito.
 *
 * Restituisce null per le tipologie che non sappiamo trattare (es. "Capannoni
 * industriali"): l'importer le salta e le dichiara, invece di infilarle in
 * `altro` dove inquinerebbero le stime.
 */
function omiMapTipologia(string $descr): ?string
{
    $d = mb_strtolower(trim($descr));
    if ($d === '') {
        return null;
    }

    $map = [
        'abitazioni signorili'        => 'appartamento',
        'abitazioni civili'           => 'appartamento',
        'abitazioni di tipo economico'=> 'appartamento',
        'ville e villini'             => 'villa',
        'villini'                     => 'villa',
        'ville'                       => 'villa',
        'uffici'                      => 'ufficio',
        'uffici strutturati'          => 'ufficio',
        'negozi'                      => 'negozio',
        'box'                         => 'box',
        'autorimesse'                 => 'box',
        'posti auto coperti'          => 'box',
        'posti auto scoperti'         => 'box',
        'magazzini'                   => 'altro',
        'laboratori'                  => 'altro',
    ];

    if (isset($map[$d])) {
        return $map[$d];
    }

    // Varianti di scrittura fra un semestre e l'altro ("Abitazioni civili e
    // di tipo economico", "Box e autorimesse"): si ricade sulla radice.
    foreach ([
        'abitazion' => 'appartamento',
        'vill'      => 'villa',
        'uffic'     => 'ufficio',
        'negoz'     => 'negozio',
        'box'       => 'box',
        'autorimess'=> 'box',
        'posti auto'=> 'box',
        'terren'    => 'terreno',
    ] as $needle => $type) {
        if (str_contains($d, $needle)) {
            return $type;
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// 3. Coefficienti di merito
// ---------------------------------------------------------------------------

/**
 * La quotazione OMI vale per la ZONA: dice quanto costa un metro quadro medio
 * in quella fascia di quel comune, non quanto vale questo appartamento. Su quel
 * dato la prassi estimativa applica i coefficienti di merito, che riportano il
 * valore medio sul singolo immobile.
 *
 * Le percentuali sono le rettifiche correnti nella prassi (stato conservativo,
 * piano, ascensore, classe energetica). Restano volutamente moderate e sono
 * TUTTE esposte all'agente riga per riga: una rettifica che l'agente non può
 * vedere non è difendibile davanti al venditore, ed è l'agente — non il
 * gestionale — a firmare la valutazione.
 *
 * Il totale è limitato a ±35%: oltre quella soglia non si sta più rettificando
 * un valore di zona, si sta scrivendo un numero nuovo, e allora va inserito a
 * mano come stima manuale.
 *
 * @param  array $p riga di `properties`
 * @return array{factor:float,items:array<int,array{label:string,pct:float}>,capped:bool}
 */
function omiMeritCoefficients(array $p): array
{
    $items = [];

    // — Stato conservativo ————————————————————————————————
    // La base OMI importata è la riga NORMALE, che corrisponde al nostro
    // "buono": è lo zero della scala, non una mancanza di dato.
    $condition = trim((string) ($p['condition_state'] ?? ''));
    $byCondition = [
        'nuovo'            => 10.0,
        'ottimo'           => 6.0,
        'buono'            => 0.0,
        'da_ristrutturare' => -18.0,
    ];
    if ($condition !== '' && isset($byCondition[$condition])) {
        $pct = $byCondition[$condition];
        if ($pct != 0.0) {
            $labels = [
                'nuovo'            => 'Nuovo / in costruzione',
                'ottimo'           => 'Ottimo / ristrutturato',
                'da_ristrutturare' => 'Da ristrutturare',
            ];
            $items[] = ['label' => $labels[$condition] ?? $condition, 'pct' => $pct];
        }
    }

    // — Piano ——————————————————————————————————————————
    $floorRaw   = mb_strtolower(trim((string) ($p['floor'] ?? '')));
    $totalFloors= isset($p['total_floors']) && $p['total_floors'] !== null ? (int) $p['total_floors'] : null;
    $floorNum   = null;
    if ($floorRaw !== '') {
        if (preg_match('/-?\d+/', $floorRaw, $fm)) {
            $floorNum = (int) $fm[0];
        }
    }

    $isBasement = $floorRaw !== '' && preg_match('/interrat|seminterrat|sottosuolo/', $floorRaw);
    $isGround   = $floorRaw !== '' && preg_match('/terra|rialzat|piano t\b|^t$/', $floorRaw);
    $isAttic    = $floorRaw !== '' && preg_match('/attico|mansard/', $floorRaw);

    if ($isBasement || ($floorNum !== null && $floorNum < 0)) {
        $items[] = ['label' => 'Piano interrato / seminterrato', 'pct' => -25.0];
        $floorNum = $floorNum ?? -1;
    } elseif ($isAttic) {
        $items[] = ['label' => 'Attico / mansarda', 'pct' => 10.0];
    } elseif ($isGround || $floorNum === 0) {
        $items[] = ['label' => 'Piano terra / rialzato', 'pct' => -12.0];
        $floorNum = $floorNum ?? 0;
    } elseif ($floorNum !== null && $totalFloors !== null && $totalFloors > 1 && $floorNum >= $totalFloors) {
        $items[] = ['label' => 'Ultimo piano', 'pct' => 3.0];
    }

    // — Ascensore ——————————————————————————————————————
    // Penalità solo dove pesa davvero: dal terzo piano in su. Sotto, l'assenza
    // di ascensore incide poco e sommarla farebbe doppio conto con il piano.
    $elevator = $p['elevator'] ?? null;
    if ($floorNum !== null && $floorNum >= 3 && ($elevator === 0 || $elevator === '0')) {
        $items[] = ['label' => 'Senza ascensore (piano ' . $floorNum . ')', 'pct' => -10.0];
    }

    // — Classe energetica ——————————————————————————————
    $energy = strtoupper(trim((string) ($p['energy_class'] ?? '')));
    if ($energy !== '') {
        $letter = $energy[0];
        $byEnergy = ['A' => 5.0, 'B' => 3.0, 'C' => 0.0, 'D' => 0.0, 'E' => -2.0, 'F' => -4.0, 'G' => -6.0];
        if (isset($byEnergy[$letter]) && $byEnergy[$letter] != 0.0) {
            $items[] = ['label' => "Classe energetica $energy", 'pct' => $byEnergy[$letter]];
        }
    }

    $totalPct = 0.0;
    foreach ($items as $it) {
        $totalPct += $it['pct'];
    }

    $capped = false;
    if ($totalPct > 35.0)  { $totalPct = 35.0;  $capped = true; }
    if ($totalPct < -35.0) { $totalPct = -35.0; $capped = true; }

    return [
        'factor' => round(1 + ($totalPct / 100), 4),
        'items'  => $items,
        'capped' => $capped,
    ];
}

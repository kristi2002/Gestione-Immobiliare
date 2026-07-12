<?php
/**
 * ISTAT FOI rent adjustment (adeguamento ISTAT del canone di locazione).
 *
 * Italian leases typically index the rent to 75% of the yearly variation of the
 * FOI index (indice dei prezzi al consumo per le famiglie di operai e impiegati,
 * al netto dei tabacchi — base 2015 = 100).
 *
 * NOTE: the values below are INDICATIVE annual averages and MUST be kept aligned
 * with the official ISTAT publication (https://www.istat.it) before being used
 * on a real contract. They are provided so the calculator works out-of-the-box;
 * the source of truth is always the ISTAT monthly bulletin.
 */

/** @return array<int,float> year => annual-average FOI index (base 2015=100) */
function istatFoiAnnualIndex(): array
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
        2026 => 123.0, // provvisorio — aggiornare con dato ISTAT
    ];
}

function istatIndexForYear(int $year): ?float
{
    $map = istatFoiAnnualIndex();
    return $map[$year] ?? null;
}

/**
 * Compute the proposed adjusted rent.
 *
 * @param float      $currentRent    Current monthly rent.
 * @param float|null $baselineIndex  FOI index at the contract baseline (preferred).
 * @param int|null   $baselineYear   Fallback: baseline year (uses annual index).
 * @param int|null   $targetYear     Year to adjust to (defaults to current year).
 * @param float      $share          Share of the variation applied (default 0.75).
 * @return array{
 *   ok:bool, message?:string,
 *   baseline_index?:float, target_index?:float, target_year?:int,
 *   variation_pct?:float, applied_pct?:float,
 *   current_rent?:float, new_rent?:float, monthly_increase?:float, annual_increase?:float
 * }
 */
function istatComputeAdjustment(
    float $currentRent,
    ?float $baselineIndex = null,
    ?int $baselineYear = null,
    ?int $targetYear = null,
    float $share = 0.75
): array {
    if ($currentRent <= 0) {
        return ['ok' => false, 'message' => 'Canone corrente non valido.'];
    }

    if ($baselineIndex === null && $baselineYear !== null) {
        $baselineIndex = istatIndexForYear($baselineYear);
    }
    if ($baselineIndex === null || $baselineIndex <= 0) {
        return ['ok' => false, 'message' => 'Indice ISTAT di riferimento mancante. Imposta l\'indice base o l\'anno di decorrenza.'];
    }

    // targetYear defaults handled by caller (Date* unavailable here w/o passing).
    if ($targetYear === null) {
        return ['ok' => false, 'message' => 'Anno di adeguamento mancante.'];
    }

    $targetIndex = istatIndexForYear($targetYear);
    if ($targetIndex === null) {
        // fall back to the latest known year
        $map = istatFoiAnnualIndex();
        $latestYear = max(array_keys($map));
        $targetIndex = $map[$latestYear];
        $targetYear  = $latestYear;
    }

    $variationPct = (($targetIndex - $baselineIndex) / $baselineIndex) * 100.0;
    $appliedPct   = $variationPct * $share;
    $newRent      = round($currentRent * (1 + $appliedPct / 100.0), 2);
    $monthlyInc   = round($newRent - $currentRent, 2);

    return [
        'ok'               => true,
        'baseline_index'   => round($baselineIndex, 3),
        'target_index'     => round($targetIndex, 3),
        'target_year'      => $targetYear,
        'variation_pct'    => round($variationPct, 3),
        'applied_pct'      => round($appliedPct, 3),
        'share'            => $share,
        'current_rent'     => round($currentRent, 2),
        'new_rent'         => $newRent,
        'monthly_increase' => $monthlyInc,
        'annual_increase'  => round($monthlyInc * 12, 2),
    ];
}

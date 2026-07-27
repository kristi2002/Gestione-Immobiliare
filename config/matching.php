<?php
/**
 * Magic Match (reverse): punteggio dei lead attivi rispetto a un immobile.
 *
 * Viveva dentro api/properties.php::matchingLeads(), che però chiude chiamando
 * apiSuccess(): inutilizzabile da qualsiasi altro contesto. Il dispatcher delle
 * automazioni gira da cron, senza api_bootstrap, e ha bisogno esattamente di
 * questo calcolo per l'evento "prezzo ribassato". Qui è una funzione pura che
 * ritorna i match; l'endpoint resta il suo unico wrapper HTTP.
 */

/**
 * @param array $p riga `properties`
 * @return array<int, array> match ordinati per punteggio decrescente
 */
function scoreLeadsForProperty(PDO $db, array $p, int $limit = 5): array
{
    // A rental listing matches renters (affitto/entrambi); a sale matches buyers.
    $wantInterest = ($p['price_type'] ?? 'affitto') === 'vendita'
        ? ['acquisto', 'entrambi']
        : ['affitto', 'entrambi'];
    $in = implode(',', array_fill(0, count($wantInterest), '?'));

    $stmt = $db->prepare(
        "SELECT * FROM leads
         WHERE status IN ('new','contacted','interested','negotiating')
           AND interest_type IN ($in)"
    );
    $stmt->execute($wantInterest);
    $leads = $stmt->fetchAll();

    $price   = $p['price'] !== null ? (float) $p['price'] : null;
    $matches = [];

    foreach ($leads as $l) {
        $score   = 0;
        $reasons = [];

        if (!empty($l['preferred_city']) && !empty($p['city'])
            && mb_strtolower(trim($l['preferred_city'])) === mb_strtolower(trim($p['city']))) {
            $score += 30; $reasons[] = 'Città';
        }
        // NB: property_type e' il "gruppo" (appartamento/villa/...), non la
        // `typology` fine di immobiliare.it — l'etichetta segue il form immobili.
        if (!empty($l['preferred_type']) && $l['preferred_type'] === $p['property_type']) {
            $score += 25; $reasons[] = 'Gruppo';
        }
        if ($price !== null) {
            $min = $l['budget_min'] !== null ? (float) $l['budget_min'] : null;
            $max = $l['budget_max'] !== null ? (float) $l['budget_max'] : null;
            $okMin = $min === null || $price >= $min;
            $okMax = $max === null || $price <= $max;
            if ($okMin && $okMax && ($min !== null || $max !== null)) {
                $score += 30; $reasons[] = 'Budget';
            }
        }
        // properties.rooms = camere da letto (i "locali" sono rooms + other_rooms).
        if (!empty($l['min_rooms']) && $p['rooms'] !== null && (int) $p['rooms'] >= (int) $l['min_rooms']) {
            $score += 10; $reasons[] = 'Camere';
        }
        if (!empty($l['min_sqm']) && $p['sqm'] !== null && (float) $p['sqm'] >= (float) $l['min_sqm']) {
            $score += 5; $reasons[] = 'Superficie';
        }

        if ($score <= 0) continue;

        $matches[] = [
            'id'       => (int) $l['id'],
            'name'     => trim(($l['name'] ?? '') . ' ' . ($l['surname'] ?? '')),
            'phone'    => $l['phone'] ?? null,
            'email'    => $l['email'] ?? null,
            'status'   => $l['status'],
            'interest_type' => $l['interest_type'],
            'budget_min' => $l['budget_min'] !== null ? (float) $l['budget_min'] : null,
            'budget_max' => $l['budget_max'] !== null ? (float) $l['budget_max'] : null,
            'score'    => $score,
            'reasons'  => $reasons,
        ];
    }

    usort($matches, fn($a, $b) => $b['score'] <=> $a['score']);

    return array_slice($matches, 0, $limit);
}

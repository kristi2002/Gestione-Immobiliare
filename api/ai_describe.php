<?php
/**
 * AI listing copywriter.
 *
 * POST /api/ai_describe.php
 *   body: { "property_id": 123 }  — draft from the stored property
 *      or { "property": { ...fields... } }  — draft from an unsaved form
 *
 * Returns { title, description } in Italian. Requires AI_API_KEY (see lib/ai.php);
 * without it, responds with a clear "not configured" 400 (no dead UI).
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../lib/ai.php';
apiHandleOptions();
apiRequireMethod('POST');

try {
    $db   = getDB();
    $data = apiGetJsonBody();

    $prop = null;
    if (!empty($data['property_id'])) {
        $stmt = $db->prepare('SELECT * FROM properties WHERE id = :id');
        $stmt->execute(['id' => (int) $data['property_id']]);
        $prop = $stmt->fetch() ?: null;
    } elseif (!empty($data['property']) && is_array($data['property'])) {
        $prop = $data['property'];
    }

    if (!$prop) {
        apiError('Dati immobile mancanti.');
    }

    if (!aiIsConfigured()) {
        apiError('Funzione AI non configurata. Imposta AI_API_KEY nel file .env per attivarla.', 400);
    }

    $facts = buildPropertyFacts($prop);

    $system = "Sei un copywriter immobiliare italiano esperto. Scrivi annunci accattivanti, "
        . "concreti e conformi: nessuna promessa fuorviante, tono professionale, italiano corretto. "
        . "Non inventare dati non forniti (prezzo, metratura, classe energetica). "
        . "Rispondi ESCLUSIVAMENTE con un oggetto JSON valido con due campi: "
        . "\"title\" (max 70 caratteri) e \"description\" (2-4 paragrafi).";

    $user = "Genera titolo e descrizione per questo immobile.\n\nDati:\n" . $facts;

    $raw = aiComplete($system, $user, 800);

    $parsed = extractJson($raw);
    $title = trim((string) ($parsed['title'] ?? ''));
    $desc  = trim((string) ($parsed['description'] ?? ''));

    // Fallback: if the model didn't return clean JSON, use the raw text as description.
    if ($desc === '') {
        $desc = trim($raw);
    }

    apiSuccess([
        'title'       => $title !== '' ? $title : null,
        'description' => $desc,
    ]);
} catch (RuntimeException $e) {
    apiError($e->getMessage(), 502);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------

function buildPropertyFacts(array $p): string
{
    $typeLabels = [
        'appartamento' => 'Appartamento', 'villa' => 'Villa', 'ufficio' => 'Ufficio',
        'negozio' => 'Negozio', 'box' => 'Box/Garage', 'terreno' => 'Terreno', 'altro' => 'Immobile',
    ];
    $lines = [];
    $add = function (string $label, $val) use (&$lines) {
        if ($val !== null && $val !== '' && $val !== '0') $lines[] = "- $label: $val";
    };

    $add('Tipologia', $typeLabels[$p['property_type'] ?? ''] ?? ($p['property_type'] ?? null));
    $add('Contratto', ($p['price_type'] ?? '') === 'vendita' ? 'Vendita' : 'Affitto');
    $add('Città', $p['city'] ?? null);
    $add('Indirizzo/zona', $p['address'] ?? null);
    $add('Superficie (m²)', $p['sqm'] ?? null);
    $add('Locali', $p['locali'] ?? ($p['rooms'] ?? null));
    $add('Bagni', $p['bathrooms'] ?? null);
    $add('Piano', $p['floor'] ?? null);
    $add('Ascensore', isset($p['elevator']) && $p['elevator'] !== '' ? ((int) $p['elevator'] ? 'Sì' : 'No') : null);
    $add('Riscaldamento', $p['heating'] ?? null);
    $add('Arredamento', $p['furnished'] ?? null);
    $add('Stato', $p['condition_state'] ?? null);
    $add('Classe energetica', $p['energy_class'] ?? null);
    $add('Esposizione', $p['exposure'] ?? null);
    $add('Balconi', $p['balconies'] ?? null);
    $add('Terrazzi', $p['terraces'] ?? null);
    $add('Giardino', $p['garden'] ?? null);
    $add('Posti auto', $p['parking_spaces'] ?? null);
    $add('Spese condominiali (€/mese)', $p['condo_fees'] ?? null);
    $add('Prezzo (€)', $p['price'] ?? null);
    $add('Caratteristiche aggiuntive', $p['additional_features'] ?? null);

    return implode("\n", $lines);
}

/** Best-effort extraction of a JSON object from a model response. */
function extractJson(string $raw): array
{
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) return $decoded;

    if (preg_match('/\{.*\}/s', $raw, $m)) {
        $decoded = json_decode($m[0], true);
        if (is_array($decoded)) return $decoded;
    }
    return [];
}

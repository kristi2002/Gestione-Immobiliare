<?php
/**
 * Pre-flight: un immobile e' pubblicabile su questo portale?
 *
 * I portali sono severi sui dati mancanti e lo dicono TARDI e MALE: l'annuncio
 * parte nel feed, viene scartato ore dopo, e l'errore torna in un feed di
 * ritorno che nessuno guarda. Qui il controllo e' locale e immediato: l'agente
 * scopre che mancano due foto e la classe energetica mentre ha ancora la scheda
 * aperta, non tre giorni dopo.
 *
 * REGOLA DI IMPIANTO: questa e' l'UNICA implementazione della validazione, e
 * ha due chiamanti — il blocco in api/portal_sync.php e (quando esistera') il
 * generatore del feed. Se qualcuno ne scrive una seconda per comodita', le due
 * divergono e il pre-flight comincia a dare l'ok a righe che il feed scarta:
 * e' il modo classico in cui questa funzionalita' smette di valere qualcosa.
 *
 * Ritorna una LISTA DI VIOLAZIONI, non un booleano: "non si puo' pubblicare"
 * senza dire cosa manca costringe l'agente a indovinare.
 */

require_once __DIR__ . '/../config/portal_specs.php';
require_once __DIR__ . '/portal_mapping.php';

/**
 * Immobile + conteggi media + testi (con fallback sulla scheda multilingua).
 * Null se l'immobile non esiste.
 */
function portalLoadPropertyForValidation(PDO $db, int $propertyId): ?array
{
    $stmt = $db->prepare('SELECT * FROM properties WHERE id = :id');
    $stmt->execute(['id' => $propertyId]);
    $property = $stmt->fetch();
    if (!$property) {
        return null;
    }

    $stmt = $db->prepare(
        "SELECT media_type, COUNT(*) AS n
           FROM property_media
          WHERE property_id = :id
          GROUP BY media_type"
    );
    $stmt->execute(['id' => $propertyId]);
    $counts = [];
    foreach ($stmt->fetchAll() as $row) {
        $counts[$row['media_type']] = (int) $row['n'];
    }
    $property['_photo_count']      = $counts['photo'] ?? 0;
    $property['_floor_plan_count'] = $counts['floor_plan'] ?? 0;

    // Titolo/descrizione possono vivere sulla scheda italiana invece che sulle
    // colonne dirette (vedi phase58): un annuncio descritto solo li' e'
    // comunque descritto, e bloccarlo sarebbe un falso positivo.
    $stmt = $db->prepare(
        "SELECT title, description FROM property_descriptions
          WHERE property_id = :id AND lang = 'it' LIMIT 1"
    );
    $stmt->execute(['id' => $propertyId]);
    $it = $stmt->fetch() ?: [];

    if (trim((string) ($property['listing_title'] ?? '')) === '') {
        $property['listing_title'] = $it['title'] ?? null;
    }
    if (trim((string) ($property['description'] ?? '')) === '') {
        $property['description'] = $it['description'] ?? null;
    }

    return $property;
}

function portalViolation(string $code, string $message, ?string $field = null): array
{
    return array_filter([
        'code'    => $code,
        'field'   => $field,
        'label'   => $field !== null ? (PORTAL_FIELD_LABELS[$field] ?? $field) : null,
        'message' => $message,
    ], static fn($v) => $v !== null);
}

/**
 * Violazioni bloccanti per (immobile, portale). Lista vuota = pubblicabile.
 */
function portalValidateProperty(PDO $db, int $propertyId, string $portal): array
{
    $spec = portalSpec($portal);
    if ($spec === null) {
        return [portalViolation('unknown_portal', 'Portale non riconosciuto.')];
    }

    $property = portalLoadPropertyForValidation($db, $propertyId);
    if ($property === null) {
        return [portalViolation('missing_property', 'Immobile non trovato.')];
    }

    $violations = [];

    // --- Stato immobile -----------------------------------------------------
    // Un venduto/affittato non deve occupare uno slot a pagamento sul portale.
    if (in_array($property['status'], PORTAL_UNPUBLISHABLE_PROPERTY_STATUS, true)) {
        $labels = ['sold' => 'venduto', 'rented' => 'affittato', 'archived' => 'archiviato'];
        $violations[] = portalViolation(
            'property_not_active',
            'L\'immobile risulta ' . ($labels[$property['status']] ?? $property['status'])
                . ': non puo\' essere pubblicato come annuncio attivo.',
            null
        );
    }

    // --- Campi obbligatori --------------------------------------------------
    foreach ($spec['required'] as $field) {
        if (trim((string) ($property[$field] ?? '')) === '') {
            $violations[] = portalViolation(
                'missing_field',
                'Campo obbligatorio per ' . $spec['label'] . ': manca "'
                    . (PORTAL_FIELD_LABELS[$field] ?? $field) . '".',
                $field
            );
        }
    }

    // --- Prezzo -------------------------------------------------------------
    // "Prezzo su richiesta" e' una scelta editoriale legittima; un prezzo a
    // zero o assente senza quella spunta e' invece un dato dimenticato.
    if ((int) ($property['price_on_request'] ?? 0) !== 1) {
        if ($property['price'] === null || (float) $property['price'] <= 0) {
            $violations[] = portalViolation(
                'missing_price',
                'Indica un prezzo, oppure spunta "prezzo su richiesta" sulla scheda immobile.',
                'price'
            );
        }
    }

    // --- Classe energetica --------------------------------------------------
    // Presente ma fuori scala = errore a parte: dice all'agente che il valore
    // c'e' ma non e' quello che il portale accetta, invece di dirgli "manca".
    $energy = strtoupper(trim((string) ($property['energy_class'] ?? '')));
    if ($energy !== '' && !in_array($energy, PORTAL_ENERGY_CLASSES, true)) {
        $violations[] = portalViolation(
            'invalid_energy_class',
            'Classe energetica "' . $property['energy_class'] . '" non riconosciuta. Ammesse: '
                . implode(', ', PORTAL_ENERGY_CLASSES) . '.',
            'energy_class'
        );
    }

    // --- Media --------------------------------------------------------------
    if ($property['_photo_count'] < $spec['min_photos']) {
        $violations[] = portalViolation(
            'min_photos',
            $spec['label'] . ' richiede almeno ' . $spec['min_photos'] . ' foto: presenti '
                . $property['_photo_count'] . '.'
        );
    }
    if (!empty($spec['require_floor_plan']) && $property['_floor_plan_count'] < 1) {
        $violations[] = portalViolation(
            'missing_floor_plan',
            $spec['label'] . ' richiede la planimetria: nessuna caricata.'
        );
    }

    // --- Tassonomia ---------------------------------------------------------
    // Senza mappatura il feed spedirebbe il valore interno grezzo e il portale
    // scarterebbe la riga: meglio fermarsi qui, dove si capisce il perche'.
    foreach ($spec['map_domains'] as $domain) {
        $value = $property[$domain] ?? null;
        if ($value === null || $value === '') {
            continue; // gia' segnalato come campo mancante, se obbligatorio
        }
        if (portalMapValue($db, $portal, $domain, (string) $value) === null) {
            $violations[] = portalViolation(
                'unmapped_value',
                'Il valore "' . $value . '" (' . (PORTAL_FIELD_LABELS[$domain] ?? $domain)
                    . ') non ha una mappatura per ' . $spec['label']
                    . '. Va aggiunta in portal_field_map.',
                $domain
            );
        }
    }

    return $violations;
}

/**
 * Stati di pubblicazione che dichiarano l'annuncio VIVO sul portale e che
 * quindi passano dal pre-flight. 'draft' no: la bozza serve proprio a
 * parcheggiare un annuncio incompleto. 'error'/'removed' descrivono un esito,
 * non un'intenzione, e bloccarli impedirebbe di registrare cos'e' successo.
 */
const PORTAL_STATUSES_REQUIRING_PREFLIGHT = ['publishing', 'published'];

function portalStatusRequiresPreflight(string $status): bool
{
    return in_array($status, PORTAL_STATUSES_REQUIRING_PREFLIGHT, true);
}

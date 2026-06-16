<?php
/**
 * Geocoding resolve — Italian addresses via Google (optional) + Nominatim + Photon.
 *
 * GET /api/geocode_resolve.php?address=...&city=...&cap=...&province=MO
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/geocode.php';

apiHandleOptions();
apiRequireMethod('GET');

try {
    $property = [
        'address'  => trim($_GET['address'] ?? ''),
        'city'     => trim($_GET['city'] ?? ''),
        'cap'      => trim($_GET['cap'] ?? ''),
        'province' => trim($_GET['province'] ?? ''),
    ];

    $resolved = geocodeResolve($property);
    $result   = $resolved['result'];

    if (!$result) {
        apiError('Indirizzo non trovato. Verifica via, numero civico, CAP e città, oppure inserisci le coordinate manualmente.');
    }

    apiSuccess([
        'lat'                => $result['lat'],
        'lng'                => $result['lng'],
        'label'              => $result['label'],
        'confidence'         => $result['confidence'],
        'source'             => $result['source'],
        'suggested_province' => $resolved['suggested_province'],
    ]);
} catch (InvalidArgumentException $e) {
    apiError($e->getMessage());
} catch (Throwable $e) {
    apiError('Errore geocodifica.', 500);
}

<?php
/**
 * Process contract expirations — manual trigger from admin UI or HTTP cron.
 */

require_once __DIR__ . '/../config/cron_bootstrap.php';
require_once __DIR__ . '/../config/contract_expirations.php';

apiHandleOptions();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    apiError('Metodo non consentito. Usa POST.', 405);
}

try {
    $result = processContractExpirations(getDB());
    apiSuccess($result);
} catch (PDOException $e) {
    apiError('Errore durante l\'elaborazione delle scadenze contratti.', 500);
}

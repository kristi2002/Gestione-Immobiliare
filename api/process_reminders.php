<?php
/**
 * Process due reminders — manual trigger from admin UI or external cron via HTTP POST.
 */

require_once __DIR__ . '/../config/cron_bootstrap.php';
require_once __DIR__ . '/../config/reminders.php';

apiHandleOptions();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    apiError('Metodo non consentito. Usa POST.', 405);
}

try {
    $result = processDueReminders(getDB());
    apiSuccess($result);
} catch (PDOException $e) {
    apiError('Errore durante l\'elaborazione dei promemoria.', 500);
}

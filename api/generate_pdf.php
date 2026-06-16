<?php
/**
 * PDF generation API.
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/pdf.php';

apiHandleOptions();
requireWriteAccess();

if (!canAccessView('pdf')) {
    apiError('Permesso negato.', 403);
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        apiError('Metodo non consentito.', 405);
    }

    $data = apiGetJsonBody();
    $type = $data['type'] ?? 'contract';

    if ($type === 'contract') {
        $result = generateContractPdf(getDB(), $data, getCurrentAdminId());
    } elseif ($type === 'report') {
        $propertyId = (int) ($data['property_id'] ?? 0);
        if ($propertyId <= 0) {
            apiError('property_id obbligatorio per report.');
        }
        $result = generatePropertyReportPdf(getDB(), $propertyId, getCurrentAdminId());
    } elseif ($type === 'mandato') {
        $result = generateMandatoPdf(getDB(), $data, getCurrentAdminId());
    } else {
        apiError('Tipo PDF non valido.');
    }

    if (!$result['success']) {
        apiError($result['error'] ?? 'Generazione fallita.');
    }

    apiSuccess($result);
} catch (Throwable $e) {
    apiError('Errore generazione PDF.', 500);
}

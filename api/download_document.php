<?php
/**
 * Secure document download endpoint.
 * GET /api/download_document.php?id={id}
 */

require_once __DIR__ . '/../config/bootstrap.php';

if (!isLoggedIn()) {
    http_response_code(401);
    exit('Autenticazione richiesta.');
}

require_once __DIR__ . '/../config/db.php';

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;

if ($id <= 0) {
    http_response_code(400);
    exit('ID documento mancante.');
}

try {
    $db   = getDB();
    $stmt = $db->prepare("SELECT original_name, file_path, mime_type FROM documents WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        http_response_code(404);
        exit('Documento non trovato.');
    }

    $fullPath = __DIR__ . '/../' . $doc['file_path'];

    if (!file_exists($fullPath)) {
        http_response_code(404);
        exit('File non trovato sul server.');
    }

    $mime     = $doc['mime_type'] ?: 'application/octet-stream';
    $filename = $doc['original_name'];

    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . rawurlencode($filename) . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
    header('Content-Length: ' . filesize($fullPath));
    header('Cache-Control: no-cache, must-revalidate');
    header('Pragma: no-cache');

    readfile($fullPath);
    exit;

} catch (PDOException $e) {
    http_response_code(500);
    exit('Errore server.');
}

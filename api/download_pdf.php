<?php
require_once __DIR__ . '/../config/bootstrap.php';

if (!isLoggedIn()) {
    http_response_code(401);
    exit('Autenticazione richiesta.');
}

require_once __DIR__ . '/../config/db.php';

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if ($id <= 0) {
    http_response_code(400);
    exit('ID mancante.');
}

$stmt = getDB()->prepare('SELECT title, file_path FROM pdf_documents WHERE id = :id');
$stmt->execute(['id' => $id]);
$doc = $stmt->fetch();

require_once __DIR__ . '/../config/upload_guard.php';
$path = $doc ? safeUploadRealPath((string) $doc['file_path']) : null;
if (!$doc || $path === null) {
    http_response_code(404);
    exit('PDF non trovato.');
}

header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="' . rawurlencode($doc['title'] . '.pdf') . '"');
header('Content-Length: ' . filesize($path));
readfile($path);

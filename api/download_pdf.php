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

if (!$doc || !is_readable(__DIR__ . '/../' . $doc['file_path'])) {
    http_response_code(404);
    exit('PDF non trovato.');
}

$path = __DIR__ . '/../' . $doc['file_path'];
header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="' . rawurlencode($doc['title'] . '.pdf') . '"');
header('Content-Length: ' . filesize($path));
readfile($path);

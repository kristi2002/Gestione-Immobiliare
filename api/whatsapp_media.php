<?php
/**
 * Allegato di un messaggio WhatsApp.
 * GET /api/whatsapp_media.php?id={whatsapp_message_id}
 *
 * I file arrivano dai clienti (foto di guasti, documenti d'identita', contratti
 * firmati a mano) e vivono sotto uploads/documents/, l'albero che Apache non
 * serve: questo endpoint e' l'unico modo di leggerli, e solo con una sessione
 * di staff. L'inbox WhatsApp e' una schermata di back-office, quindi non c'e'
 * un accesso da portale da concedere qui.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/upload_guard.php';

if (!isLoggedIn()) {
    http_response_code(401);
    exit('Autenticazione richiesta.');
}

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if ($id <= 0) {
    http_response_code(400);
    exit('ID messaggio mancante.');
}

try {
    $stmt = getDB()->prepare(
        'SELECT media_url, media_mime, media_name FROM whatsapp_messages WHERE id = :id'
    );
    $stmt->execute(['id' => $id]);
    $msg = $stmt->fetch();
} catch (PDOException $e) {
    http_response_code(500);
    exit('Errore server.');
}

if (!$msg || empty($msg['media_url'])) {
    http_response_code(404);
    exit('Allegato non trovato.');
}

// La colonna e' scrivibile anche da POST /api/whatsapp_inbox.php (messaggi in
// uscita salvati dal client): senza questo vincolo un percorso scelto da chi
// chiama trasformerebbe questo endpoint in un lettore di tutto uploads/.
// Il guard sotto impedisce comunque di uscire dall'albero, ma il perimetro
// giusto per gli allegati WhatsApp e' la loro cartella.
$rel = (string) $msg['media_url'];
if (!str_starts_with($rel, 'uploads/documents/whatsapp/')) {
    http_response_code(404);
    exit('Allegato non trovato.');
}

$path = safeUploadRealPath($rel);
if ($path === null) {
    http_response_code(404);
    exit('File non trovato sul server.');
}

$mime = $msg['media_mime'] ?: 'application/octet-stream';
$name = $msg['media_name'] ?: basename($path);

header('Content-Type: ' . $mime);
header('Content-Disposition: inline; filename="' . str_replace(['"', '\\'], '', $name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
header('Content-Length: ' . filesize($path));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=300');

readfile($path);

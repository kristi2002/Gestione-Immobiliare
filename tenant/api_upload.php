<?php
/**
 * Portale Inquilino — foto allegata a una propria richiesta.
 *
 * POST multipart: { reminder_id, file }
 *
 * E' la PRIMA superficie di caricamento aperta a un inquilino, quindi vale la
 * pena dire cosa la tiene stretta:
 *
 * 1. Si allega SOLO a una richiesta gia' esistente E propria. Il legame si
 *    verifica sul database (`tenant_id`), non sul valore mandato dal browser.
 * 2. SOLO immagini e PDF, decisi annusando il contenuto con mime_content_type()
 *    e non fidandosi dell'estensione ne' del Content-Type dichiarato. Niente
 *    formati eseguibili, niente Office: una prova fotografica non e' un .docx
 *    che chiunque puo' riscrivere dopo la contestazione (stesso criterio di
 *    METER_PHOTO_MIMES in api/documents.php).
 * 3. Il nome del file NON viene riusato: si genera. Un nome scelto
 *    dall'utente e' la strada classica per l'attraversamento di cartella.
 * 4. Tetto di 5 file per richiesta e 8 MB l'uno, piu' il limite per IP.
 *
 * L'albero uploads/ non e' navigabile e il suo .htaccess nega l'esecuzione
 * degli script; il file si rilegge solo via api/download_document.php, che ha
 * il suo controllo di proprieta'.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/csrf.php';
require_once __DIR__ . '/../config/rate_limit.php';

initTenantSession();

header('Content-Type: application/json; charset=utf-8');

/** Solo prove fotografiche. Deciso annusando il file, non dall'estensione. */
const TENANT_UPLOAD_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const TENANT_UPLOAD_MAX   = 8 * 1024 * 1024;   // 8 MB
const TENANT_UPLOAD_CAP   = 5;                 // foto per richiesta

function upOut(bool $ok, $payload, int $code = 200): never
{
    http_response_code($code);
    exit(json_encode($ok ? ['success' => true, 'data' => $payload]
                         : ['success' => false, 'error' => $payload]));
}

if (!isTenantLoggedIn())                       upOut(false, 'Non autorizzato.', 401);
if ($_SERVER['REQUEST_METHOD'] !== 'POST')     upOut(false, 'Metodo non consentito.', 405);

// Il corpo e' multipart, quindi il token arriva dall'intestazione o dal campo.
$sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf_token'] ?? '');
if ($sent === '' || !hash_equals(getCsrfToken(), (string) $sent)) {
    upOut(false, 'Token CSRF non valido.', 403);
}

checkRateLimit('tenant_upload', 20, 900);

$tenantId   = getCurrentTenantId();
$db         = getDB();
$reminderId = (int) ($_POST['reminder_id'] ?? 0);

// La richiesta deve esistere ED essere sua. Punto 1.
$own = $db->prepare(
    "SELECT id FROM reminders
      WHERE id = :rid AND tenant_id = :tid AND request_type IS NOT NULL
      LIMIT 1"
);
$own->execute(['rid' => $reminderId, 'tid' => $tenantId]);
if (!$own->fetchColumn()) {
    // Stessa risposta per "non esiste" e "non e' tua": l'una non deve
    // distinguersi dall'altra.
    upOut(false, 'Richiesta non trovata.', 404);
}

$countStmt = $db->prepare('SELECT COUNT(*) FROM documents WHERE reminder_id = :rid');
$countStmt->execute(['rid' => $reminderId]);
if ((int) $countStmt->fetchColumn() >= TENANT_UPLOAD_CAP) {
    upOut(false, 'Hai già allegato ' . TENANT_UPLOAD_CAP . ' foto a questa richiesta.', 400);
}

if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    upOut(false, 'Nessun file ricevuto, o errore durante il caricamento.', 400);
}

$file = $_FILES['file'];

if ($file['size'] <= 0)                  upOut(false, 'Il file è vuoto.', 400);
if ($file['size'] > TENANT_UPLOAD_MAX)   upOut(false, 'File troppo grande. Massimo 8 MB.', 400);

// Punto 2: si annusa il contenuto. Il Content-Type del browser e' dichiarato
// dal client, quindi non e' una prova di niente.
$mime = function_exists('mime_content_type')
    ? (mime_content_type($file['tmp_name']) ?: '')
    : '';
if (!in_array($mime, TENANT_UPLOAD_MIMES, true)) {
    upOut(false, 'Sono ammesse solo foto (JPG, PNG, WEBP) o PDF.', 400);
}

$uploadDir = __DIR__ . '/../uploads/documents/' . date('Y/m');
if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true)) {
    upOut(false, 'Impossibile salvare il file.', 500);
}

// Punto 3: il nome si genera, e l'estensione viene dal MIME riconosciuto —
// non da quella che il browser ha mandato.
$ext = match ($mime) {
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
    'image/webp'      => 'webp',
    'application/pdf' => 'pdf',
};
$filename = 'tn_' . bin2hex(random_bytes(12)) . '.' . $ext;
$destPath = $uploadDir . '/' . $filename;

if (!move_uploaded_file($file['tmp_name'], $destPath)) {
    upOut(false, 'Errore nel salvataggio del file.', 500);
}

$relative = 'uploads/documents/' . date('Y/m') . '/' . $filename;

// Il nome originale si conserva solo come etichetta da mostrare, ripulito: non
// viene mai usato per costruire un percorso.
$label = mb_substr(preg_replace('/[\x00-\x1F\/\\\\]+/u', '', (string) $file['name']), 0, 120);

$ins = $db->prepare(
    "INSERT INTO documents (reminder_id, property_id, doc_type, title, file_path,
                            original_name, mime_type, file_size, created_at)
     VALUES (:rid, :pid, 'other', :title, :path, :orig, :mime, :size, NOW())"
);

// property_id si eredita dalla richiesta: serve all'agenzia per ritrovare la
// foto dalla scheda dell'immobile.
$pid = $db->prepare('SELECT property_id FROM reminders WHERE id = :rid');
$pid->execute(['rid' => $reminderId]);
$propertyId = $pid->fetchColumn() ?: null;

$ins->execute([
    'rid'   => $reminderId,
    'pid'   => $propertyId ?: null,
    'title' => 'Foto della richiesta #' . $reminderId,
    'path'  => $relative,
    'orig'  => $label !== '' ? $label : ('foto.' . $ext),
    'mime'  => $mime,
    'size'  => (int) $file['size'],
]);

upOut(true, [
    'message' => 'Foto allegata.',
    'id'      => (int) $db->lastInsertId(),
    'name'    => $label !== '' ? $label : ('foto.' . $ext),
]);

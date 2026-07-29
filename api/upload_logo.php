<?php
/**
 * Logo upload for branding.
 */
require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';

apiHandleOptions();
// Stessa soglia della pagina che ospita il caricamento (Impostazioni →
// Branding, super_admin): 'admin' qui era un permesso che nessuno poteva usare.
requireRole('super_admin');
requireWriteAccess();

const LOGO_MAX_BYTES = 2097152; // 2 MB — un logo più pesante è un errore, non un logo.

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || empty($_FILES['logo'])) {
    apiError('File logo mancante.', 400);
}

$file = $_FILES['logo'];
if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) {
    apiError('File troppo grande (massimo 2 MB).', 400);
}
if ($file['error'] !== UPLOAD_ERR_OK) {
    apiError('Errore upload.', 400);
}
if (($file['size'] ?? 0) > LOGO_MAX_BYTES) {
    apiError('File troppo grande (massimo 2 MB).', 400);
}

// Niente SVG: è un documento XML che può contenere <script>, e questa cartella
// è servita da Apache. Aperto direttamente col suo URL, un SVG ostile
// eseguirebbe codice sull'origine dell'applicazione, con la sessione
// dell'utente collegato. Per un logo i formati raster bastano.
$allowed = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];

// Il MIME dichiarato dal browser lo sceglie chi carica: fa fede quello che il
// file È davvero. getimagesize legge l'intestazione reale del binario.
$info = @getimagesize($file['tmp_name']);
$mime = $info['mime'] ?? null;
if ($mime === null && function_exists('mime_content_type')) {
    $mime = mime_content_type($file['tmp_name']) ?: null;
}

if (!$mime || !isset($allowed[$mime])) {
    apiError('Formato non supportato. Usa PNG, JPG o WebP.');
}

$dir = dirname(__DIR__) . '/uploads/branding';
if (!is_dir($dir)) {
    mkdir($dir, 0755, true);
}

$filename = 'logo_' . date('Ymd_His') . '.' . $allowed[$mime];
$relative = 'uploads/branding/' . $filename;
$full     = $dir . '/' . $filename;

if (!move_uploaded_file($file['tmp_name'], $full)) {
    apiError('Salvataggio logo fallito.');
}

// Il logo precedente non serve più a nessuno: lasciarlo lì accumulava un file
// per ogni caricamento, tutti raggiungibili dal loro URL.
$previous = (string) getSetting('logo_path', '');
if ($previous !== '' && $previous !== $relative && str_starts_with($previous, 'uploads/branding/')) {
    $previousPath = dirname(__DIR__) . '/' . $previous;
    if (is_file($previousPath)) {
        @unlink($previousPath);
    }
}

setSetting('logo_path', $relative);
logActivity('update', 'settings', null, 'Logo agenzia aggiornato: ' . $filename);
apiSuccess(['logo_path' => $relative]);

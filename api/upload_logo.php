<?php
/**
 * Logo upload for branding.
 */
require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/settings.php';

apiHandleOptions();
requireRole('super_admin', 'admin');
requireWriteAccess();

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || empty($_FILES['logo'])) {
    apiError('File logo mancante.', 400);
}

$file = $_FILES['logo'];
if ($file['error'] !== UPLOAD_ERR_OK) {
    apiError('Errore upload.', 400);
}

$allowed = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/svg+xml' => 'svg'];
$mime = function_exists('mime_content_type')
    ? (mime_content_type($file['tmp_name']) ?: $file['type'])
    : $file['type'];
if (!isset($allowed[$mime])) {
    apiError('Formato non supportato. Usa PNG, JPG, WebP o SVG.');
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

setSetting('logo_path', $relative);
apiSuccess(['logo_path' => $relative]);

<?php
/**
 * Property Media API — gallery uploads for photos, videos, floor plans.
 *
 * GET    /api/property_media.php?property_id={id}  — list media for a property
 * POST   /api/property_media.php                   — upload file (multipart)
 * DELETE /api/property_media.php?id={id}           — delete media item
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const MEDIA_TYPES = ['photo', 'video', 'floor_plan'];

const ALLOWED_MIMES = [
    'photo'      => ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    'video'      => ['video/mp4', 'video/webm', 'video/quicktime'],
    'floor_plan' => ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
            if (!$propertyId) {
                apiError('property_id mancante.');
            }
            listMedia($db, $propertyId);
            break;
        case 'POST':
            uploadMedia($db);
            break;
        case 'DELETE':
            if (!$id) {
                apiError('ID media mancante.');
            }
            deleteMedia($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listMedia(PDO $db, int $propertyId): void
{
    if (!propertyExists($db, $propertyId)) {
        apiError('Immobile non trovato.', 404);
    }

    $stmt = $db->prepare(
        "SELECT id, property_id, media_type, file_path, original_name,
                mime_type, file_size, sort_order, created_at
         FROM property_media
         WHERE property_id = :property_id
         ORDER BY sort_order ASC, created_at ASC"
    );
    $stmt->execute(['property_id' => $propertyId]);

    $items = $stmt->fetchAll();
    foreach ($items as &$item) {
        $item['url'] = $item['file_path'];
    }

    apiSuccess($items);
}

function uploadMedia(PDO $db): void
{
    $propertyId = isset($_POST['property_id']) ? (int) $_POST['property_id'] : 0;
    $mediaType  = trim($_POST['media_type'] ?? 'photo');

    if ($propertyId <= 0) {
        apiError('property_id mancante.');
    }
    if (!propertyExists($db, $propertyId)) {
        apiError('Immobile non trovato.', 404);
    }
    if (!in_array($mediaType, MEDIA_TYPES, true)) {
        apiError('Tipo media non valido.');
    }
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        apiError('Nessun file caricato o errore durante l\'upload.');
    }

    $file = $_FILES['file'];

    if ($file['size'] > MAX_FILE_SIZE) {
        apiError('File troppo grande. Massimo 20 MB.');
    }

    $mime = mime_content_type($file['tmp_name']) ?: $file['type'];
    $allowed = ALLOWED_MIMES[$mediaType] ?? [];

    if (!in_array($mime, $allowed, true)) {
        apiError('Tipo di file non consentito per questa categoria.');
    }

    $uploadDir = __DIR__ . '/../uploads/properties/' . $propertyId;
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true)) {
        apiError('Impossibile creare la cartella di upload.', 500);
    }

    $ext      = pathinfo($file['name'], PATHINFO_EXTENSION);
    $safeExt  = preg_replace('/[^a-zA-Z0-9]/', '', $ext);
    $filename = uniqid('media_', true) . ($safeExt ? '.' . strtolower($safeExt) : '');
    $destPath = $uploadDir . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        apiError('Errore nel salvataggio del file.', 500);
    }

    $relativePath = 'uploads/properties/' . $propertyId . '/' . $filename;

    $sortStmt = $db->prepare(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM property_media WHERE property_id = :id"
    );
    $sortStmt->execute(['id' => $propertyId]);
    $sortOrder = (int) $sortStmt->fetchColumn();

    $stmt = $db->prepare(
        "INSERT INTO property_media
            (property_id, media_type, file_path, original_name, mime_type, file_size, sort_order)
         VALUES
            (:property_id, :media_type, :file_path, :original_name, :mime_type, :file_size, :sort_order)"
    );
    $stmt->execute([
        'property_id'   => $propertyId,
        'media_type'    => $mediaType,
        'file_path'     => $relativePath,
        'original_name' => $file['name'],
        'mime_type'     => $mime,
        'file_size'     => $file['size'],
        'sort_order'    => $sortOrder,
    ]);

    $newId = (int) $db->lastInsertId();

    $getStmt = $db->prepare("SELECT * FROM property_media WHERE id = :id");
    $getStmt->execute(['id' => $newId]);
    $item = $getStmt->fetch();
    $item['url'] = $item['file_path'];

    apiSuccess($item, 201);
}

function deleteMedia(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM property_media WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $item = $stmt->fetch();

    if (!$item) {
        apiError('File non trovato.', 404);
    }

    $fullPath = __DIR__ . '/../' . $item['file_path'];
    if (file_exists($fullPath)) {
        unlink($fullPath);
    }

    $del = $db->prepare("DELETE FROM property_media WHERE id = :id");
    $del->execute(['id' => $id]);

    apiSuccess(['id' => $id, 'message' => 'File eliminato.']);
}

function propertyExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM properties WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

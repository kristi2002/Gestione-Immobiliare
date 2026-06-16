<?php
/**
 * Property Media API — gallery uploads for photos, videos, floor plans, maps, attachments.
 *
 * GET    /api/property_media.php?property_id={id}  — list media for a property
 * POST   /api/property_media.php                   — upload file (multipart)
 * PATCH  /api/property_media.php?action=set_cover  — set cover image (JSON)
 * DELETE /api/property_media.php?id={id}           — delete media item
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const MEDIA_TYPES = ['photo', 'video', 'floor_plan', 'house_map', 'attachment'];

const ALLOWED_MIMES = [
    'photo'      => ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    'video'      => ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
    'floor_plan' => ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    'house_map'  => ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    'attachment' => [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
];

const COVER_MEDIA_TYPES = ['photo', 'floor_plan', 'house_map'];

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
        case 'PATCH':
            if (($_GET['action'] ?? '') === 'set_cover') {
                setCoverMedia($db);
            } else {
                apiError('Azione non valida.');
            }
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
        "SELECT m.id, m.property_id, m.media_type, m.file_path, m.original_name,
                m.mime_type, m.file_size, m.sort_order, m.created_at,
                CASE WHEN m.id = p.cover_media_id THEN 1 ELSE 0 END AS is_cover
         FROM property_media m
         INNER JOIN properties p ON p.id = m.property_id
         WHERE m.property_id = :property_id
         ORDER BY m.sort_order ASC, m.created_at ASC"
    );
    $stmt->execute(['property_id' => $propertyId]);

    $items = $stmt->fetchAll();
    foreach ($items as &$item) {
        $item['url']      = $item['file_path'];
        $item['is_cover'] = (bool) $item['is_cover'];
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
    if (empty($_FILES['file'])) {
        apiError('Nessun file caricato.');
    }

    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        apiError(uploadErrorMessage($file['error']));
    }

    if ($file['size'] > MAX_FILE_SIZE) {
        apiError('File troppo grande. Massimo 20 MB.');
    }

    $mime    = detectMimeType($file);
    $allowed = ALLOWED_MIMES[$mediaType] ?? [];

    if (!in_array($mime, $allowed, true)) {
        apiError('Tipo di file non consentito per questa categoria (' . $mime . '). Usa MP4, WebM o MOV per i video.');
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
        'SELECT COALESCE(MAX(sort_order), 0) + 1 FROM property_media WHERE property_id = :id'
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

    maybeAutoSetCover($db, $propertyId, $newId, $mediaType, $mime);

    $getStmt = $db->prepare(
        "SELECT m.*, CASE WHEN m.id = p.cover_media_id THEN 1 ELSE 0 END AS is_cover
         FROM property_media m
         INNER JOIN properties p ON p.id = m.property_id
         WHERE m.id = :id"
    );
    $getStmt->execute(['id' => $newId]);
    $item = $getStmt->fetch();
    $item['url']      = $item['file_path'];
    $item['is_cover'] = (bool) $item['is_cover'];

    apiSuccess($item, 201);
}

function setCoverMedia(PDO $db): void
{
    $data       = apiGetJsonBody();
    $propertyId = (int) ($data['property_id'] ?? 0);
    $mediaId    = (int) ($data['media_id'] ?? 0);

    if ($propertyId <= 0 || $mediaId <= 0) {
        apiError('property_id e media_id obbligatori.');
    }
    if (!propertyExists($db, $propertyId)) {
        apiError('Immobile non trovato.', 404);
    }

    $stmt = $db->prepare(
        "SELECT id, media_type, mime_type FROM property_media
         WHERE id = :id AND property_id = :property_id"
    );
    $stmt->execute(['id' => $mediaId, 'property_id' => $propertyId]);
    $media = $stmt->fetch();

    if (!$media) {
        apiError('File non trovato per questo immobile.', 404);
    }
    if (!in_array($media['media_type'], COVER_MEDIA_TYPES, true)
        || strpos((string) $media['mime_type'], 'image/') !== 0) {
        apiError('Solo le immagini (foto, planimetria o cartina) possono essere anteprima.');
    }

    $upd = $db->prepare('UPDATE properties SET cover_media_id = :media_id WHERE id = :property_id');
    $upd->execute(['media_id' => $mediaId, 'property_id' => $propertyId]);

    apiSuccess(['property_id' => $propertyId, 'media_id' => $mediaId, 'message' => 'Anteprima aggiornata.']);
}

function deleteMedia(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT m.*, p.cover_media_id
         FROM property_media m
         INNER JOIN properties p ON p.id = m.property_id
         WHERE m.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $item = $stmt->fetch();

    if (!$item) {
        apiError('File non trovato.', 404);
    }

    $fullPath = __DIR__ . '/../' . $item['file_path'];
    if (file_exists($fullPath)) {
        unlink($fullPath);
    }

    $del = $db->prepare('DELETE FROM property_media WHERE id = :id');
    $del->execute(['id' => $id]);

    if ((int) $item['cover_media_id'] === $id) {
        $db->prepare('UPDATE properties SET cover_media_id = NULL WHERE id = :id')
            ->execute(['id' => $item['property_id']]);
        assignFallbackCover($db, (int) $item['property_id']);
    }

    apiSuccess(['id' => $id, 'message' => 'File eliminato.']);
}

function maybeAutoSetCover(PDO $db, int $propertyId, int $mediaId, string $mediaType, string $mime): void
{
    if (!in_array($mediaType, COVER_MEDIA_TYPES, true) || strpos($mime, 'image/') !== 0) {
        return;
    }

    $stmt = $db->prepare('SELECT cover_media_id FROM properties WHERE id = :id');
    $stmt->execute(['id' => $propertyId]);
    $coverId = $stmt->fetchColumn();

    if ($coverId) {
        return;
    }

    $db->prepare('UPDATE properties SET cover_media_id = :media_id WHERE id = :property_id')
        ->execute(['media_id' => $mediaId, 'property_id' => $propertyId]);
}

function assignFallbackCover(PDO $db, int $propertyId): void
{
    $stmt = $db->prepare(
        "SELECT id FROM property_media
         WHERE property_id = :property_id
           AND media_type IN ('photo', 'floor_plan', 'house_map')
           AND mime_type LIKE 'image/%'
         ORDER BY sort_order ASC, created_at ASC
         LIMIT 1"
    );
    $stmt->execute(['property_id' => $propertyId]);
    $nextId = $stmt->fetchColumn();

    if ($nextId) {
        $db->prepare('UPDATE properties SET cover_media_id = :media_id WHERE id = :property_id')
            ->execute(['media_id' => (int) $nextId, 'property_id' => $propertyId]);
    }
}

function propertyExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare('SELECT id FROM properties WHERE id = :id');
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

function uploadErrorMessage(int $code): string
{
    $iniLimit = ini_get('upload_max_filesize') ?: '2M';

    return match ($code) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE =>
            "File troppo grande per il server (limite attuale: {$iniLimit}). Per i video serve almeno 20 MB — ricostruisci il container Docker dopo l'aggiornamento.",
        UPLOAD_ERR_PARTIAL   => 'Upload interrotto. Riprova.',
        UPLOAD_ERR_NO_FILE   => 'Nessun file selezionato.',
        UPLOAD_ERR_NO_TMP_DIR => 'Cartella temporanea mancante sul server.',
        UPLOAD_ERR_CANT_WRITE => 'Impossibile scrivere il file sul disco.',
        UPLOAD_ERR_EXTENSION  => 'Upload bloccato da un\'estensione PHP.',
        default               => 'Errore durante l\'upload del file.',
    };
}

function detectMimeType(array $file): string
{
    $mime = '';
    if (!empty($file['tmp_name']) && is_file($file['tmp_name'])) {
        $mime = mime_content_type($file['tmp_name']) ?: '';
    }
    if ($mime === '' || $mime === 'application/octet-stream') {
        $mime = trim($file['type'] ?? '');
    }

    $ext = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
    $byExt = [
        'jpg'  => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png'  => 'image/png',
        'webp' => 'image/webp',
        'gif'  => 'image/gif',
        'mp4'  => 'video/mp4',
        'm4v'  => 'video/mp4',
        'webm' => 'video/webm',
        'mov'  => 'video/quicktime',
        'qt'   => 'video/quicktime',
        'avi'  => 'video/x-msvideo',
        'pdf'  => 'application/pdf',
    ];

    if ($mime === '' || $mime === 'application/octet-stream') {
        $mime = $byExt[$ext] ?? $mime;
    }

    return $mime ?: 'application/octet-stream';
}

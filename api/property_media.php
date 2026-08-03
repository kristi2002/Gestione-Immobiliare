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
require_once __DIR__ . '/../lib/image_processing.php';

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

/**
 * Extension written to disk, keyed by the mime we DETECTED — never by the
 * extension the browser sent. The uploaded name is attacker-controlled and this
 * tree is web-served: deriving the stored name from the accepted mime is what
 * makes it impossible to land a ".php" (or any other executable) in there,
 * whatever the file claims to be. Every mime in ALLOWED_MIMES must appear here.
 */
const MIME_EXTENSIONS = [
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
    'image/webp'      => 'webp',
    'image/gif'       => 'gif',
    'video/mp4'       => 'mp4',
    'video/webm'      => 'webm',
    'video/quicktime' => 'mov',
    'video/x-msvideo' => 'avi',
    'application/pdf' => 'pdf',
    'application/msword' => 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
];

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
        "SELECT m.id, m.property_id, m.media_type, m.file_path, m.thumb_path, m.original_name,
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
        $item['url']       = mediaUrl($item);
        $item['thumb_url'] = thumbUrl($item);
        $item['is_cover']  = (bool) $item['is_cover'];
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
        // Il messaggio nomina i formati della categoria SCELTA. Prima
        // consigliava sempre i video, anche caricando un PDF fra le foto —
        // e ora che l'errore arriva davvero all'agente (la scheda immobile lo
        // mostra, invece di far sparire il file in silenzio) deve dire il vero.
        $labels = array_values(array_unique(array_map(
            static fn(string $m): string => strtoupper(MIME_EXTENSIONS[$m] ?? $m),
            $allowed
        )));
        apiError(
            'Tipo di file non consentito per la categoria scelta (' . $mime . '). '
            . 'Formati ammessi: ' . implode(', ', $labels) . '.'
        );
    }

    // Attachments may hold sensitive files, so they live in the deny-all
    // protected tree and are served only via api/media.php (auth-scoped).
    // Presentation assets (photo/video/floor_plan/house_map) are public listing
    // material and stay in the web-served uploads/properties tree.
    $isPrivate = ($mediaType === 'attachment');
    $relDir    = $isPrivate
        ? 'uploads/documents/property_attachments/' . $propertyId
        : 'uploads/properties/' . $propertyId;
    $uploadDir = __DIR__ . '/../' . $relDir;
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true)) {
        apiError('Impossibile creare la cartella di upload.', 500);
    }

    // Extension from the DETECTED mime, not from the submitted filename.
    $filename = uniqid('media_', true) . '.' . (MIME_EXTENSIONS[$mime] ?? 'bin');
    $destPath = $uploadDir . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        apiError('Errore nel salvataggio del file.', 500);
    }

    $relativePath = $relDir . '/' . $filename;

    // Presentation images get downscaled and given a thumbnail; private
    // attachments do not. An attachment is a document the agency filed as-is —
    // re-encoding a scanned ID or a signed plan to save bandwidth on a listing
    // grid it never appears in would be destroying evidence to no purpose.
    $thumbRelative = null;
    if (!$isPrivate && imageIsProcessable($mime)) {
        imageDownscaleInPlace($destPath, $mime);

        $thumbDir = $uploadDir . '/thumbs';
        if ((is_dir($thumbDir) || mkdir($thumbDir, 0755, true))
            && imageWriteThumbnail($destPath, $thumbDir . '/' . $filename, $mime)) {
            $thumbRelative = $relDir . '/thumbs/' . $filename;
        }
    }

    // Size AFTER processing: $file['size'] is what arrived, which is no longer
    // what is on disk once the original has been downscaled.
    clearstatcache(true, $destPath);
    $storedSize = @filesize($destPath) ?: (int) $file['size'];

    $sortStmt = $db->prepare(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 FROM property_media WHERE property_id = :id'
    );
    $sortStmt->execute(['id' => $propertyId]);
    $sortOrder = (int) $sortStmt->fetchColumn();

    $stmt = $db->prepare(
        "INSERT INTO property_media
            (property_id, media_type, file_path, thumb_path, original_name, mime_type, file_size, sort_order)
         VALUES
            (:property_id, :media_type, :file_path, :thumb_path, :original_name, :mime_type, :file_size, :sort_order)"
    );
    $stmt->execute([
        'property_id'   => $propertyId,
        'media_type'    => $mediaType,
        'file_path'     => $relativePath,
        'thumb_path'    => $thumbRelative,
        'original_name' => $file['name'],
        'mime_type'     => $mime,
        'file_size'     => $storedSize,
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
    $item['url']       = mediaUrl($item);
    $item['thumb_url'] = thumbUrl($item);
    $item['is_cover']  = (bool) $item['is_cover'];

    apiSuccess($item, 201);
}

/**
 * Public presentation media is served by its direct (web-served) path; private
 * attachments are served only through the auth-scoped streamer api/media.php.
 */
function mediaUrl(array $item): string
{
    return ($item['media_type'] ?? '') === 'attachment'
        ? 'api/media.php?id=' . (int) $item['id']
        : (string) $item['file_path'];
}

/**
 * Thumbnail URL, falling back to the full-size one.
 *
 * The fallback is the whole point: rows uploaded before thumbnails existed,
 * videos, PDFs and GIFs all have thumb_path NULL and must still render. A
 * caller can use this unconditionally.
 */
function thumbUrl(array $item): string
{
    $thumb = trim((string) ($item['thumb_path'] ?? ''));

    return $thumb !== '' ? $thumb : mediaUrl($item);
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

    // The thumbnail is a second file on disk: without this it survives the row
    // that pointed at it and the thumbs/ folder grows forever.
    $thumbRel = trim((string) ($item['thumb_path'] ?? ''));
    if ($thumbRel !== '') {
        $thumbFull = __DIR__ . '/../' . $thumbRel;
        if (file_exists($thumbFull)) {
            unlink($thumbFull);
        }
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

/**
 * Determine the mime type from the file's own bytes.
 *
 * What changed and why: this used to fall back to $file['type'] — the
 * Content-Type the BROWSER declared in the multipart body, which is simply a
 * string the client chose. Combined with the old naming (extension copied from
 * the submitted filename) that was a path to writing an arbitrary .php into
 * uploads/properties/, which Apache serves. Both halves are closed now: the
 * mime comes from the bytes, and the stored extension comes from the mime.
 *
 * Order of trust:
 *   1. getimagesize() — reads the image header itself, is not fileinfo, and
 *      returns false for anything that is not really an image. This is the ONLY
 *      way an image/* mime can be produced here, so a PHP script renamed .jpg
 *      cannot acquire one.
 *   2. mime_content_type() — fileinfo, for video/PDF/doc.
 *   3. Extension, restricted to non-image container formats. Some builds report
 *      application/octet-stream for .mov/.webm and rejecting a legitimate video
 *      would be a real regression; an extension-derived video mime is harmless
 *      because the stored file is named from that mime, not executed.
 */
function detectMimeType(array $file): string
{
    $tmp = $file['tmp_name'] ?? '';
    if ($tmp === '' || !is_file($tmp)) {
        return 'application/octet-stream';
    }

    // Restricted to the image types we actually accept: getimagesize()'s WBMP
    // probe is loose enough to claim image/vnd.wap.wbmp for arbitrary binary
    // starting with null bytes (verified). Real MP4/MOV/WebM headers do not
    // trip it, but a file that did would be rejected with a nonsense mime in
    // the error instead of falling through to the checks below.
    $info = @getimagesize($tmp);
    $byte = is_array($info) ? strtolower(trim((string) ($info['mime'] ?? ''))) : '';
    if (in_array($byte, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
        return $byte;
    }

    // Suppressed: on some runtimes mime_content_type() raises a warning for a
    // file it cannot open (observed on Windows), and a warning printed mid
    // handler lands inside the JSON response and makes it unparseable. An empty
    // result is already handled by the fallback below.
    $mime = '';
    if (function_exists('mime_content_type')) {
        $mime = strtolower(trim((string) @mime_content_type($tmp)));
    }

    if ($mime !== '' && $mime !== 'application/octet-stream') {
        return $mime;
    }

    // Container/document formats only — no image/* here by design (see step 1).
    // None of these is executable by Apache, and the file is stored under a name
    // derived from the mime, so the worst case is a mislabelled download.
    $byExt = [
        'mp4'  => 'video/mp4',
        'm4v'  => 'video/mp4',
        'webm' => 'video/webm',
        'mov'  => 'video/quicktime',
        'qt'   => 'video/quicktime',
        'avi'  => 'video/x-msvideo',
        'pdf'  => 'application/pdf',
    ];
    $ext = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));

    return $byExt[$ext] ?? ($mime ?: 'application/octet-stream');
}

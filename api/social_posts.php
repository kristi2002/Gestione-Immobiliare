<?php
/**
 * Social Posts CRUD API.
 *
 * GET    /api/social_posts.php                  — list
 * GET    /api/social_posts.php?id={id}          — single post
 * POST   /api/social_posts.php                  — create (multipart: fields + optional image)
 * PUT    /api/social_posts.php?id={id}          — update (JSON or multipart)
 * PATCH  /api/social_posts.php?id={id}&action=publish — publish immediately
 * DELETE /api/social_posts.php?id={id}          — delete draft/scheduled post
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/meta.php';

apiHandleOptions();

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getPost($db, $id) : listPosts($db);
            break;
        case 'POST':
            $id ? updatePost($db, $id) : createPost($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID post mancante.');
            // JSON-only updates (no file upload)
            updatePostJson($db, $id);
            break;
        case 'PATCH':
            if (!$id) apiError('ID post mancante.');
            patchPost($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID post mancante.');
            deletePost($db, $id);
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

function listPosts(PDO $db): void
{
    $pagination = apiGetPagination();
    $status   = trim($_GET['status'] ?? '');
    $platform = trim($_GET['platform'] ?? '');
    $search   = trim($_GET['search'] ?? '');

    $where = 'WHERE 1=1';
    $params = [];

    if ($status !== '' && in_array($status, SOCIAL_STATUSES, true)) {
        $where .= ' AND sp.status = :status';
        $params['status'] = $status;
    }
    if ($platform !== '' && in_array($platform, SOCIAL_PLATFORMS, true)) {
        $where .= ' AND sp.platform = :platform';
        $params['platform'] = $platform;
    }
    if ($search !== '') {
        $where .= ' AND (sp.caption LIKE :search OR p.address LIKE :search OR p.city LIKE :search)';
        $params['search'] = '%' . $search . '%';
    }

    $countSql = "SELECT COUNT(*) FROM social_posts sp
            LEFT JOIN properties p ON p.id = sp.property_id
            $where";

    $dataSql = "SELECT sp.*, p.address AS property_address, p.city AS property_city
            FROM social_posts sp
            LEFT JOIN properties p ON p.id = sp.property_id
            $where
            ORDER BY sp.scheduled_at DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getPost(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT sp.*, p.address AS property_address, p.city AS property_city
         FROM social_posts sp
         LEFT JOIN properties p ON p.id = sp.property_id
         WHERE sp.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $post = $stmt->fetch();

    if (!$post) {
        apiError('Post non trovato.', 404);
    }

    apiSuccess($post);
}

function createPost(PDO $db): void
{
    $data      = parsePostInput();
    $validated = validatePostInput($data);
    $imagePath = handleImageUpload($_FILES['image'] ?? null);

    $stmt = $db->prepare(
        "INSERT INTO social_posts
            (property_id, platform, caption, image_path, scheduled_at, status)
         VALUES
            (:property_id, :platform, :caption, :image_path, :scheduled_at, :status)"
    );
    $stmt->execute(array_merge($validated, ['image_path' => $imagePath]));

    getPost($db, (int) $db->lastInsertId());
}

function updatePost(PDO $db, int $id): void
{
    $existing = fetchPostById($db, $id);
    if (!$existing) {
        apiError('Post non trovato.', 404);
    }
    if ($existing['status'] === 'published') {
        apiError('I post già pubblicati non possono essere modificati.');
    }

    $data      = parsePostInput();
    $validated = validatePostInput($data);

    $imagePath = $existing['image_path'];
    if (!empty($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        if ($imagePath && file_exists(__DIR__ . '/../' . $imagePath)) {
            unlink(__DIR__ . '/../' . $imagePath);
        }
        $imagePath = handleImageUpload($_FILES['image']);
    }

    applyPostUpdate($db, $id, $validated, $imagePath);
    getPost($db, $id);
}

function updatePostJson(PDO $db, int $id): void
{
    $existing = fetchPostById($db, $id);
    if (!$existing) {
        apiError('Post non trovato.', 404);
    }
    if ($existing['status'] === 'published') {
        apiError('I post già pubblicati non possono essere modificati.');
    }

    $data      = apiGetJsonBody();
    $validated = validatePostInput($data);
    applyPostUpdate($db, $id, $validated, $existing['image_path']);
    getPost($db, $id);
}

function applyPostUpdate(PDO $db, int $id, array $validated, ?string $imagePath): void
{
    $stmt = $db->prepare(
        "UPDATE social_posts
         SET property_id = :property_id, platform = :platform, caption = :caption,
             image_path = :image_path, scheduled_at = :scheduled_at, status = :status
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['image_path' => $imagePath, 'id' => $id]));
}

function patchPost(PDO $db, int $id): void
{
    $action = trim($_GET['action'] ?? '');
    if ($action !== 'publish') {
        apiError('Azione non valida. Usa action=publish.');
    }

    $post = fetchPostById($db, $id);
    if (!$post) {
        apiError('Post non trovato.', 404);
    }
    if ($post['status'] === 'published') {
        apiError('Post già pubblicato.');
    }

    $result = publishAndUpdatePost($db, $post);
    getPost($db, $id);
}

function deletePost(PDO $db, int $id): void
{
    $post = fetchPostById($db, $id);
    if (!$post) {
        apiError('Post non trovato.', 404);
    }
    if ($post['status'] === 'published') {
        apiError('I post pubblicati non possono essere eliminati.');
    }

    if ($post['image_path'] && file_exists(__DIR__ . '/../' . $post['image_path'])) {
        unlink(__DIR__ . '/../' . $post['image_path']);
    }

    $db->prepare('DELETE FROM social_posts WHERE id = :id')->execute(['id' => $id]);
    apiSuccess(['id' => $id, 'message' => 'Post eliminato.']);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePostInput(): array
{
    if (!empty($_POST)) {
        return $_POST;
    }
    return apiGetJsonBody();
}

function validatePostInput(array $data): array
{
    $propertyId  = !empty($data['property_id']) ? (int) $data['property_id'] : null;
    $platform    = trim($data['platform'] ?? 'both');
    $caption     = trim($data['caption'] ?? '');
    $scheduledAt = trim($data['scheduled_at'] ?? '');
    $status      = trim($data['status'] ?? 'draft');

    if ($caption === '') {
        apiError('La didascalia è obbligatoria.');
    }
    if ($scheduledAt === '') {
        apiError('La data di pubblicazione è obbligatoria.');
    }
    if (!in_array($platform, SOCIAL_PLATFORMS, true)) {
        apiError('Piattaforma non valida.');
    }
    if (!in_array($status, SOCIAL_STATUSES, true)) {
        apiError('Stato non valido.');
    }

    $parsed = DateTime::createFromFormat('Y-m-d\TH:i', $scheduledAt)
        ?: DateTime::createFromFormat('Y-m-d H:i:s', $scheduledAt)
        ?: DateTime::createFromFormat('Y-m-d', $scheduledAt);

    if (!$parsed) {
        apiError('Formato data non valido.');
    }

    return [
        'property_id'  => $propertyId,
        'platform'     => $platform,
        'caption'      => $caption,
        'scheduled_at' => $parsed->format('Y-m-d H:i:s'),
        'status'       => $status,
    ];
}

function handleImageUpload(?array $file): ?string
{
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
        return null;
    }

    if ($file['size'] > MAX_IMAGE_SIZE) {
        apiError('Immagine troppo grande. Massimo 10 MB.');
    }

    $allowed = ['image/jpeg', 'image/png', 'image/webp'];
    $mime    = mime_content_type($file['tmp_name']) ?: $file['type'];
    if (!in_array($mime, $allowed, true)) {
        apiError('Formato immagine non supportato. Usa JPEG, PNG o WebP.');
    }

    $dir = __DIR__ . '/../uploads/social/' . date('Y/m');
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
        apiError('Impossibile creare cartella upload.', 500);
    }

    $ext      = pathinfo($file['name'], PATHINFO_EXTENSION);
    $safeExt  = preg_replace('/[^a-zA-Z0-9]/', '', $ext);
    $filename = uniqid('social_', true) . ($safeExt ? '.' . strtolower($safeExt) : '');
    $dest     = $dir . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        apiError('Errore salvataggio immagine.', 500);
    }

    return 'uploads/social/' . date('Y/m') . '/' . $filename;
}

function fetchPostById(PDO $db, int $id): ?array
{
    $stmt = $db->prepare('SELECT * FROM social_posts WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

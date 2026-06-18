<?php
/**
 * Documents API — upload, list, delete.
 *
 * GET    /api/documents.php                        — list (filters: search, doc_type, client_id, property_id)
 * GET    /api/documents.php?id={id}              — single document metadata
 * POST   /api/documents.php                        — upload (multipart)
 * DELETE /api/documents.php?id={id}              — delete document + file
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const DOC_TYPES = ['invoice', 'contract', 'id', 'id_front', 'id_back', 'other'];

const ALLOWED_MIMES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'text/plain',
];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getDocument($db, $id) : listDocuments($db);
            break;
        case 'POST':
            uploadDocument($db);
            break;
        case 'DELETE':
            if (!$id) {
                apiError('ID documento mancante.');
            }
            deleteDocument($db, $id);
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

function listDocuments(PDO $db): void
{
    $pagination = apiGetPagination();
    $search     = trim($_GET['search'] ?? '');
    $docType    = trim($_GET['doc_type'] ?? '');
    $clientId   = isset($_GET['client_id']) ? (int) $_GET['client_id'] : null;
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;

    // ── Part 1: real documents ────────────────────────────────────────────
    $docItems = [];
    if ($docType !== 'contratto') {
        $dWhere  = 'WHERE 1=1';
        $dParams = [];

        if ($search !== '') {
            $frag = apiWordSearch($search, ['d.title', 'd.original_name', 'd.notes', 'c.name', 'c.surname', 'p.address', 'p.city'], $dParams, 'dw');
            if ($frag) $dWhere .= " AND $frag";
        }
        if ($docType !== '') {
            $dWhere .= ' AND d.doc_type = :doc_type';
            $dParams['doc_type'] = $docType;
        }
        if ($clientId) {
            $dWhere .= ' AND d.client_id = :client_id';
            $dParams['client_id'] = $clientId;
        }
        if ($propertyId) {
            $dWhere .= ' AND d.property_id = :property_id';
            $dParams['property_id'] = $propertyId;
        }

        $stmt = $db->prepare(
            "SELECT d.id, d.doc_type, d.title, d.client_id, d.property_id,
                    d.original_name, d.mime_type, d.file_size, d.notes, d.created_at,
                    c.name AS client_name, c.surname AS client_surname,
                    p.address AS property_address, p.city AS property_city,
                    NULL AS contract_id
             FROM documents d
             LEFT JOIN clients c ON c.id = d.client_id
             LEFT JOIN properties p ON p.id = d.property_id
             $dWhere
             ORDER BY d.created_at DESC"
        );
        $stmt->execute($dParams);
        $docItems = $stmt->fetchAll();
        foreach ($docItems as &$d) {
            $d['download_url'] = 'api/download_document.php?id=' . $d['id'];
        }
        unset($d);
    }

    // ── Part 2: contracts (as virtual document entries) ───────────────────
    $ctItems = [];
    if ($docType === '' || $docType === 'contratto') {
        $cWhere  = 'WHERE 1=1';
        $cParams = [];

        if ($search !== '') {
            $frag = apiWordSearch($search, ['ct.title', 'ct.notes', 'cl.name', 'cl.surname', 'pr.address', 'pr.city'], $cParams, 'cw');
            if ($frag) $cWhere .= " AND $frag";
        }
        if ($clientId) {
            $cWhere .= ' AND ct.client_id = :ct_client_id';
            $cParams['ct_client_id'] = $clientId;
        }
        if ($propertyId) {
            $cWhere .= ' AND ct.property_id = :ct_property_id';
            $cParams['ct_property_id'] = $propertyId;
        }

        $typeLabels = [
            'locazione' => 'Locazione', 'compravendita' => 'Compravendita',
            'preliminare' => 'Preliminare', 'mandato' => 'Mandato', 'altro' => 'Altro',
        ];

        $stmt = $db->prepare(
            "SELECT ct.id, 'contratto' AS doc_type, ct.title, ct.client_id, ct.property_id,
                    ct.contract_type AS original_name, NULL AS mime_type, NULL AS file_size,
                    ct.notes, ct.created_at,
                    cl.name AS client_name, cl.surname AS client_surname,
                    pr.address AS property_address, pr.city AS property_city,
                    ct.id AS contract_id
             FROM contracts ct
             LEFT JOIN clients cl ON cl.id = ct.client_id
             INNER JOIN properties pr ON pr.id = ct.property_id
             $cWhere
             ORDER BY ct.created_at DESC"
        );
        $stmt->execute($cParams);
        $rows = $stmt->fetchAll();
        foreach ($rows as $row) {
            $row['original_name'] = $typeLabels[$row['original_name']] ?? $row['original_name'];
            $row['download_url']  = null;
            $ctItems[] = $row;
        }
    }

    // ── Merge, sort, paginate in PHP ──────────────────────────────────────
    $all = array_merge($docItems, $ctItems);
    usort($all, fn($a, $b) => strcmp((string)($b['created_at'] ?? ''), (string)($a['created_at'] ?? '')));

    $total = count($all);
    $items = array_slice($all, $pagination['offset'], $pagination['limit']);

    apiPaginatedSuccess($items, $total, $pagination);
}

function getDocument(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT d.*, c.name AS client_name, c.surname AS client_surname,
                p.address AS property_address, p.city AS property_city
         FROM documents d
         LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN properties p ON p.id = d.property_id
         WHERE d.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        apiError('Documento non trovato.', 404);
    }

    $doc['download_url'] = 'api/download_document.php?id=' . $doc['id'];
    apiSuccess($doc);
}

function uploadDocument(PDO $db): void
{
    $docType    = trim($_POST['doc_type'] ?? 'other');
    $title      = trim($_POST['title'] ?? '') ?: null;
    $clientId   = !empty($_POST['client_id']) ? (int) $_POST['client_id'] : null;
    $propertyId = !empty($_POST['property_id']) ? (int) $_POST['property_id'] : null;
    $notes      = trim($_POST['notes'] ?? '') ?: null;

    if (!in_array($docType, DOC_TYPES, true)) {
        apiError('Tipo documento non valido.');
    }

    if (!$clientId && !$propertyId) {
        apiError('Associa il documento ad almeno un proprietario o un immobile.');
    }

    if ($clientId && !clientExists($db, $clientId)) {
        apiError('Proprietario non trovato.');
    }

    if ($propertyId && !propertyExists($db, $propertyId)) {
        apiError('Immobile non trovato.');
    }

    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        apiError('Nessun file caricato o errore durante l\'upload.');
    }

    $file = $_FILES['file'];

    if ($file['size'] > MAX_FILE_SIZE) {
        apiError('File troppo grande. Massimo 25 MB.');
    }

    $mime = function_exists('mime_content_type')
        ? (mime_content_type($file['tmp_name']) ?: $file['type'])
        : $file['type'];
    if (!in_array($mime, ALLOWED_MIMES, true)) {
        apiError('Tipo di file non consentito. Formati: PDF, immagini, Word, testo.');
    }

    $subdir = date('Y/m');
    $uploadDir = __DIR__ . '/../uploads/documents/' . $subdir;
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true)) {
        apiError('Impossibile creare la cartella di upload.', 500);
    }

    $ext     = pathinfo($file['name'], PATHINFO_EXTENSION);
    $safeExt = preg_replace('/[^a-zA-Z0-9]/', '', $ext);
    $filename = uniqid('doc_', true) . ($safeExt ? '.' . strtolower($safeExt) : '');
    $destPath = $uploadDir . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        apiError('Errore nel salvataggio del file.', 500);
    }

    $relativePath = 'uploads/documents/' . $subdir . '/' . $filename;

    $stmt = $db->prepare(
        "INSERT INTO documents
            (doc_type, title, client_id, property_id, file_path,
             original_name, mime_type, file_size, notes)
         VALUES
            (:doc_type, :title, :client_id, :property_id, :file_path,
             :original_name, :mime_type, :file_size, :notes)"
    );
    $stmt->execute([
        'doc_type'      => $docType,
        'title'         => $title,
        'client_id'     => $clientId,
        'property_id'   => $propertyId,
        'file_path'     => $relativePath,
        'original_name' => $file['name'],
        'mime_type'     => $mime,
        'file_size'     => $file['size'],
        'notes'         => $notes,
    ]);

    $newId = (int) $db->lastInsertId();
    getDocument($db, $newId);
}

function deleteDocument(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM documents WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        apiError('Documento non trovato.', 404);
    }

    $fullPath = __DIR__ . '/../' . $doc['file_path'];
    if (file_exists($fullPath)) {
        unlink($fullPath);
    }

    $del = $db->prepare("DELETE FROM documents WHERE id = :id");
    $del->execute(['id' => $id]);

    apiSuccess(['id' => $id, 'message' => 'Documento eliminato.']);
}

function clientExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

function propertyExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM properties WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

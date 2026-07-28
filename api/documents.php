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

// 'regolamento', 'planimetria', 'verbale' (phase74): documenti che appartengono
// all'edificio, non alla singola unita' — regolamento di condominio, planimetrie
// strutturali, verbali d'assemblea.
// 'lettura_contatore' (phase75): la foto del quadrante scattata dall'agente al
// momento della lettura. Sta qui e non in una cartella propria perche' questo e'
// l'unico ramo di uploads/ con deny totale di Apache, streamer autenticato e log
// GDPR — vedi la migrazione per il ragionamento completo.
const DOC_TYPES = ['invoice', 'contract', 'id', 'id_front', 'id_back', 'preventivo', 'regolamento', 'planimetria', 'verbale', 'lettura_contatore', 'other'];

// Una prova fotografica e' un'immagine o la scansione di una bolletta. Accettare
// qui un .docx significherebbe accettare come "prova" un documento modificabile.
const METER_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

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
            if (($_GET['action'] ?? '') === 'stats') {
                apiSuccess([
                    'total'     => (int) $db->query('SELECT COUNT(*) FROM documents')->fetchColumn(),
                    'contracts' => (int) $db->query("SELECT COUNT(*) FROM documents WHERE doc_type IN ('contratto','contract')")->fetchColumn(),
                    'ids'       => (int) $db->query("SELECT COUNT(*) FROM documents WHERE doc_type = 'id'")->fetchColumn(),
                    'new_month' => (int) $db->query("SELECT COUNT(*) FROM documents WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')")->fetchColumn(),
                ]);
            }
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
    $contractId = isset($_GET['contract_id']) ? (int) $_GET['contract_id'] : null;
    $buildingId = isset($_GET['building_id']) ? (int) $_GET['building_id'] : null;
    $readingId  = isset($_GET['meter_reading_id']) ? (int) $_GET['meter_reading_id'] : null;

    // Ereditarieta' condominiale (phase74): chiedendo i documenti di un immobile
    // si ricevono anche quelli caricati sull'edificio che lo contiene —
    // regolamento, planimetrie, verbali. Il file resta uno solo: le unita' lo
    // vedono, non ne possiedono una copia. Passare inherit=0 per escluderli.
    $inheritedBuildingId = null;
    if ($propertyId && ($_GET['inherit'] ?? '1') !== '0') {
        $bStmt = $db->prepare('SELECT building_id FROM properties WHERE id = :id');
        $bStmt->execute(['id' => $propertyId]);
        $inheritedBuildingId = (int) $bStmt->fetchColumn() ?: null;
    }

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
            if ($inheritedBuildingId) {
                // `property_id IS NULL` sul ramo ereditato: un documento che
                // l'agente ha gia' legato a un'ALTRA unita' dello stesso stabile
                // appartiene a quella, non a tutto il condominio.
                $dWhere .= ' AND (d.property_id = :property_id
                                  OR (d.building_id = :inherited_building_id AND d.property_id IS NULL))';
                $dParams['inherited_building_id'] = $inheritedBuildingId;
            } else {
                $dWhere .= ' AND d.property_id = :property_id';
            }
            $dParams['property_id'] = $propertyId;
        }
        if ($buildingId) {
            $dWhere .= ' AND d.building_id = :building_id';
            $dParams['building_id'] = $buildingId;
        }
        if ($contractId) {
            $dWhere .= ' AND d.contract_id = :contract_id';
            $dParams['contract_id'] = $contractId;
        }
        if ($readingId) {
            $dWhere .= ' AND d.meter_reading_id = :meter_reading_id';
            $dParams['meter_reading_id'] = $readingId;
        }

        $stmt = $db->prepare(
            "SELECT d.id, d.doc_type, d.title, d.client_id, d.property_id, d.contract_id, d.building_id,
                    d.meter_reading_id,
                    d.original_name, d.mime_type, d.file_size, d.notes, d.created_at,
                    c.name AS client_name, c.surname AS client_surname,
                    p.address AS property_address, p.city AS property_city,
                    ct.title AS contract_title,
                    b.name AS building_name
             FROM documents d
             LEFT JOIN clients c ON c.id = d.client_id
             LEFT JOIN properties p ON p.id = d.property_id
             LEFT JOIN contracts ct ON ct.id = d.contract_id
             LEFT JOIN buildings b ON b.id = d.building_id
             $dWhere
             ORDER BY d.created_at DESC"
        );
        $stmt->execute($dParams);
        $docItems = $stmt->fetchAll();
        foreach ($docItems as &$d) {
            $d['download_url'] = 'api/download_document.php?id=' . $d['id'];
            // Ereditato = arriva dall'edificio, non da questo immobile. La UI lo
            // mostra in sola lettura: si modifica e si cancella dalla scheda
            // dell'edificio, dove il file e' stato caricato una volta sola.
            $d['inherited']        = ($inheritedBuildingId && empty($d['property_id'])) ? 1 : 0;
            $d['inherited_from']   = $d['inherited'] ? 'building' : null;
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
        if ($contractId) {
            $cWhere .= ' AND ct.id = :ct_id';
            $cParams['ct_id'] = $contractId;
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
                p.address AS property_address, p.city AS property_city,
                ct.title AS contract_title,
                b.name AS building_name
         FROM documents d
         LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN properties p ON p.id = d.property_id
         LEFT JOIN contracts ct ON ct.id = d.contract_id
         LEFT JOIN buildings b ON b.id = d.building_id
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
    $contractId = !empty($_POST['contract_id']) ? (int) $_POST['contract_id'] : null;
    $buildingId = !empty($_POST['building_id']) ? (int) $_POST['building_id'] : null;
    $readingId  = !empty($_POST['meter_reading_id']) ? (int) $_POST['meter_reading_id'] : null;
    $notes      = trim($_POST['notes'] ?? '') ?: null;

    if (!in_array($docType, DOC_TYPES, true)) {
        apiError('Tipo documento non valido.');
    }

    if (!$clientId && !$propertyId && !$contractId && !$buildingId && !$readingId) {
        apiError('Associa il documento ad almeno un proprietario, un immobile, un contratto, un edificio o una lettura.');
    }

    if ($clientId && !clientExists($db, $clientId)) {
        apiError('Proprietario non trovato.');
    }

    if ($propertyId && !propertyExists($db, $propertyId)) {
        apiError('Immobile non trovato.');
    }

    if ($contractId && !contractExists($db, $contractId)) {
        apiError('Contratto non trovato.');
    }

    if ($buildingId && !buildingExists($db, $buildingId)) {
        apiError('Edificio non trovato.');
    }

    if ($readingId && !meterReadingExists($db, $readingId)) {
        apiError('Lettura contatore non trovata.');
    }

    // Un documento legato all'edificio E a una sua unita' non verrebbe ereditato
    // dalle altre unita' (vedi listDocuments): sarebbe un regolamento visibile a
    // un appartamento solo. Se vale per tutto lo stabile, non ha un'unita'.
    if ($buildingId && $propertyId) {
        apiError('Un documento condominiale vale per tutto l\'edificio: non collegarlo anche a una singola unità.');
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
    $uploadExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    // mime_content_type() frequently misreports Office files — a .docx is a ZIP
    // archive so it sniffs as application/zip, and a .doc as application/CDFV2 or
    // application/x-ole-storage. Accept Word/ODT by their (trusted) extension in
    // that case so legitimate documents aren't rejected.
    $docExtFallback = ['doc', 'docx', 'odt'];
    if (!in_array($mime, ALLOWED_MIMES, true) && !in_array($uploadExt, $docExtFallback, true)) {
        apiError('Tipo di file non consentito. Formati: PDF, immagini, Word, testo.');
    }

    // La prova di una lettura deve restare una prova: niente formati editabili.
    if ($readingId && !in_array($mime, METER_PHOTO_MIMES, true)) {
        apiError('La prova della lettura deve essere una foto (JPG, PNG, WEBP) o un PDF.');
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
            (doc_type, title, client_id, property_id, contract_id, building_id, meter_reading_id, file_path,
             original_name, mime_type, file_size, notes)
         VALUES
            (:doc_type, :title, :client_id, :property_id, :contract_id, :building_id, :meter_reading_id, :file_path,
             :original_name, :mime_type, :file_size, :notes)"
    );
    $stmt->execute([
        'doc_type'         => $docType,
        'title'            => $title,
        'client_id'        => $clientId,
        'property_id'      => $propertyId,
        'contract_id'      => $contractId,
        'building_id'      => $buildingId,
        'meter_reading_id' => $readingId,
        'file_path'     => $relativePath,
        'original_name' => $file['name'],
        'mime_type'     => $mime,
        'file_size'     => $file['size'],
        'notes'         => $notes,
    ]);

    $newId = (int) $db->lastInsertId();
    logActivity('create', 'document', $newId, 'Documento caricato: ' . ($file['name'] ?? ('#' . $newId)));
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

    logActivity('delete', 'document', $id, 'Documento eliminato: ' . ($doc['original_name'] ?? ('#' . $id)));
    apiSuccess(['id' => $id, 'message' => 'Documento eliminato.']);
}

function contractExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
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

function buildingExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM buildings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

function meterReadingExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM meter_readings WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

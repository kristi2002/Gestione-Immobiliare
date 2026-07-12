<?php
/**
 * Secure document download endpoint.
 * GET /api/download_document.php?id={id}
 *
 * Access is scoped to the caller's identity:
 *   - Admin session  → any document (staff).
 *   - Tenant session → only documents on the tenant's current-contract property,
 *                      or documents linked to that property's owner (client).
 *   - Owner session  → only documents linked to the owner (client), or to a
 *                      property the owner owns.
 * A logged-in tenant/owner requesting another account's document gets 404
 * (indistinguishable from "not found" — no existence oracle).
 */

require_once __DIR__ . '/../config/bootstrap.php';

// ---------------------------------------------------------------------------
// Identify the caller. Exactly one of these becomes true.
// ---------------------------------------------------------------------------
$isAdmin        = false;
$isTenantPortal = false;
$isOwnerPortal  = false;
$tenantId       = 0;
$ownerClientId  = 0;

if (isLoggedIn()) {
    $isAdmin = true;
} else {
    // Tenant session. Bind the id to the tenant cookie so switching away from the
    // admin session opened by bootstrap loads the correct session (not the old id).
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    session_name(TENANT_SESSION_NAME);
    if (!empty($_COOKIE[TENANT_SESSION_NAME])) session_id($_COOKIE[TENANT_SESSION_NAME]);
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
    @session_start();
    if (isTenantLoggedIn()) {
        $isTenantPortal = true;
        $tenantId       = (int) ($_SESSION['tenant_id'] ?? 0);
    } else {
        session_write_close();
        // Owner session
        session_name('gestionale_owner_session');
        if (!empty($_COOKIE['gestionale_owner_session'])) session_id($_COOKIE['gestionale_owner_session']);
        @session_start();
        if (!empty($_SESSION['owner_client_id'])) {
            $isOwnerPortal = true;
            $ownerClientId = (int) $_SESSION['owner_client_id'];
        } else {
            http_response_code(401);
            exit('Autenticazione richiesta.');
        }
    }
}

require_once __DIR__ . '/../config/db.php';

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if ($id <= 0) {
    http_response_code(400);
    exit('ID documento mancante.');
}

try {
    $db = getDB();

    // -----------------------------------------------------------------------
    // Build an ownership-scoped fetch. The WHERE clause itself enforces
    // authorization: a document the caller may not see simply isn't returned.
    // -----------------------------------------------------------------------
    if ($isAdmin) {
        $stmt = $db->prepare(
            "SELECT original_name, file_path, mime_type
               FROM documents
              WHERE id = :id"
        );
        $stmt->execute(['id' => $id]);

    } elseif ($isTenantPortal) {
        // Resolve the tenant's current property + that property's owner client,
        // exactly as the tenant portal does (config/db.php getTenantCurrentContract).
        $contract       = $tenantId > 0 ? getTenantCurrentContract($db, $tenantId) : null;
        $tenantPropId   = (int) ($contract['property_id'] ?? 0);
        $tenantOwnerCid = (int) ($contract['property_client_id'] ?? 0);

        $stmt = $db->prepare(
            "SELECT original_name, file_path, mime_type
               FROM documents
              WHERE id = :id
                AND ( (property_id IS NOT NULL AND property_id = :pid)
                   OR (client_id   IS NOT NULL AND client_id   = :cid) )"
        );
        $stmt->execute(['id' => $id, 'pid' => $tenantPropId, 'cid' => $tenantOwnerCid]);

    } else { // owner portal
        $stmt = $db->prepare(
            "SELECT d.original_name, d.file_path, d.mime_type
               FROM documents d
               LEFT JOIN properties p ON p.id = d.property_id
              WHERE d.id = :id
                AND ( (d.client_id IS NOT NULL AND d.client_id = :oid)
                   OR (p.client_id  IS NOT NULL AND p.client_id  = :oid2) )"
        );
        $stmt->execute(['id' => $id, 'oid' => $ownerClientId, 'oid2' => $ownerClientId]);
    }

    $doc = $stmt->fetch();

    if (!$doc) {
        // Either nonexistent or not owned by the caller — same response for both.
        http_response_code(404);
        exit('Documento non trovato.');
    }

    // Containment guard: the stored path must resolve to a real file INSIDE uploads/.
    require_once __DIR__ . '/../config/upload_guard.php';
    $fullPath = safeUploadRealPath((string) $doc['file_path']);
    if ($fullPath === null) {
        http_response_code(404);
        exit('File non trovato sul server.');
    }

    // GDPR data-access audit: record who downloaded which document.
    require_once __DIR__ . '/../config/gdpr.php';
    if ($isAdmin) {
        logDataAccessAdmin('download', null, null, 'document', $id, (string) $doc['original_name']);
    } else {
        $actorType = $isTenantPortal ? 'tenant' : 'owner';
        $actorId   = $isTenantPortal ? $tenantId : $ownerClientId;
        logDataAccess('download', null, null, $actorType, $actorId, null, 'document', $id, (string) $doc['original_name']);
    }

    $mime     = $doc['mime_type'] ?: 'application/octet-stream';
    $filename = $doc['original_name'];

    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . str_replace(['"', '\\'], ['', ''], $filename) . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
    header('Content-Length: ' . filesize($fullPath));
    header('Cache-Control: no-cache, must-revalidate');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');

    readfile($fullPath);
    exit;

} catch (PDOException $e) {
    http_response_code(500);
    exit('Errore server.');
}

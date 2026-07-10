<?php
/**
 * Property media streamer.
 * GET /api/media.php?id={mediaId}
 *
 * Public listing assets (photo / video / floor_plan / house_map) are served to
 * anyone — they are marketing material shown on the website, portals and social.
 *
 * Private "attachment" media may contain sensitive files and is access-scoped:
 *   - Admin session  → any attachment.
 *   - Owner session  → only attachments on a property the owner owns.
 *   - Tenant session → only attachments on the tenant's current-contract property.
 * A caller who may not see an attachment gets 404 (no existence oracle).
 *
 * Attachment files live under uploads/documents/property_attachments/ (the
 * deny-all protected tree) and are only ever reachable through this endpoint.
 */

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';

const PUBLIC_MEDIA_TYPES = ['photo', 'video', 'floor_plan', 'house_map'];

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if ($id <= 0) {
    http_response_code(400);
    exit('ID media mancante.');
}

try {
    $db = getDB();

    $stmt = $db->prepare(
        'SELECT id, property_id, media_type, file_path, original_name, mime_type
           FROM property_media WHERE id = :id'
    );
    $stmt->execute(['id' => $id]);
    $media = $stmt->fetch();

    if (!$media) {
        http_response_code(404);
        exit('File non trovato.');
    }

    // Public listing assets — no auth required.
    if (in_array($media['media_type'], PUBLIC_MEDIA_TYPES, true)) {
        streamMediaFile($media);
    }

    // ----- Attachment: enforce ownership scoping -----------------------------
    $propertyId = (int) $media['property_id'];
    $allowed    = false;

    if (isLoggedIn()) {
        // Admin staff — full access.
        $allowed = true;
    } else {
        // Tenant session. Bind the id to the tenant cookie so switching away from
        // the admin session opened by bootstrap loads the correct session.
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        session_name(TENANT_SESSION_NAME);
        if (!empty($_COOKIE[TENANT_SESSION_NAME])) session_id($_COOKIE[TENANT_SESSION_NAME]);
        session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        @session_start();

        if (isTenantLoggedIn()) {
            $tenantId = (int) ($_SESSION['tenant_id'] ?? 0);
            $contract = $tenantId > 0 ? getTenantCurrentContract($db, $tenantId) : null;
            $allowed  = $contract && (int) ($contract['property_id'] ?? 0) === $propertyId;
        } else {
            session_write_close();
            session_name('gestionale_owner_session');
            if (!empty($_COOKIE['gestionale_owner_session'])) session_id($_COOKIE['gestionale_owner_session']);
            @session_start();
            $ownerClientId = (int) ($_SESSION['owner_client_id'] ?? 0);
            if ($ownerClientId > 0) {
                $chk = $db->prepare('SELECT 1 FROM properties WHERE id = :pid AND client_id = :cid');
                $chk->execute(['pid' => $propertyId, 'cid' => $ownerClientId]);
                $allowed = (bool) $chk->fetchColumn();
            } else {
                http_response_code(401);
                exit('Autenticazione richiesta.');
            }
        }
    }

    if (!$allowed) {
        // Not owned by the caller — indistinguishable from not-found.
        http_response_code(404);
        exit('File non trovato.');
    }

    streamMediaFile($media);

} catch (PDOException $e) {
    http_response_code(500);
    exit('Errore server.');
}

function streamMediaFile(array $media): never
{
    $fullPath = __DIR__ . '/../' . $media['file_path'];
    if (!is_file($fullPath)) {
        http_response_code(404);
        exit('File non trovato sul server.');
    }

    $mime     = $media['mime_type'] ?: 'application/octet-stream';
    $filename = $media['original_name'] ?: basename($fullPath);

    header('Content-Type: ' . $mime);
    header('Content-Disposition: inline; filename="' . str_replace(['"', '\\'], '', $filename) . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
    header('Content-Length: ' . filesize($fullPath));
    header('Accept-Ranges: bytes');
    header('X-Content-Type-Options: nosniff');

    readfile($fullPath);
    exit;
}

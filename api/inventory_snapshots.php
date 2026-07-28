<?php
/**
 * Verbali di consegna / riconsegna (inventory snapshots) — phase78.
 *
 * GET    /api/inventory_snapshots.php?contract_id=X        — verbali del contratto
 * GET    /api/inventory_snapshots.php?property_id=X        — verbali dell'immobile
 * GET    /api/inventory_snapshots.php?id={id}              — verbale + righe
 * GET    /api/inventory_snapshots.php?action=contracts&property_id=X
 *                                                          — locazioni dell'immobile con stato verbali
 * GET    /api/inventory_snapshots.php?action=comparison&contract_id=X
 *                                                          — griglia check-in vs check-out
 * POST   /api/inventory_snapshots.php                      — crea verbale {contract_id, phase, snapshot_date}
 * POST   /api/inventory_snapshots.php?action=lock&id={id}  — chiude: PDF + hash + firma
 * PUT    /api/inventory_snapshots.php?item_id={id}         — compila una riga
 * DELETE /api/inventory_snapshots.php?id={id}              — elimina una bozza
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
require_once __DIR__ . '/../config/inventory_snapshots.php';
apiHandleOptions();

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim($_GET['action'] ?? '');
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;
    $itemId = isset($_GET['item_id']) ? (int) $_GET['item_id'] : null;

    switch ($method) {
        case 'GET':
            if ($action === 'contracts') {
                $propertyId = (int) ($_GET['property_id'] ?? 0);
                if (!$propertyId) apiError('Immobile mancante.');
                apiSuccess(listPropertyContractsWithSnapshots($db, $propertyId));
            } elseif ($action === 'comparison') {
                $contractId = (int) ($_GET['contract_id'] ?? 0);
                if (!$contractId) apiError('Contratto mancante.');
                apiSuccess(buildInventoryComparison($db, $contractId));
            } elseif ($id) {
                $snapshot = fetchInventorySnapshot($db, $id);
                if (!$snapshot) apiError('Verbale non trovato.', 404);
                $snapshot['items']        = fetchInventorySnapshotItems($db, $id);
                $snapshot['download_url'] = $snapshot['document_id'] ? 'api/download_document.php?id=' . $snapshot['document_id'] : null;
                apiSuccess($snapshot);
            } else {
                $contractId = isset($_GET['contract_id']) ? (int) $_GET['contract_id'] : null;
                $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
                if (!$contractId && !$propertyId) apiError('Specificare contract_id o property_id.');
                apiSuccess(listInventorySnapshots($db, $contractId, $propertyId));
            }
            break;

        case 'POST':
            if ($action === 'lock') {
                if (!$id) apiError('ID verbale mancante.');
                $data = apiGetJsonBody();
                $result = lockInventorySnapshot(
                    $db,
                    $id,
                    getCurrentAdminId() ?: null,
                    trim($data['signer_name'] ?? '') ?: null,
                    trim($data['signer_email'] ?? '') ?: null
                );
                logActivity('update', 'inventory_snapshot', $id, 'Verbale chiuso (hash ' . substr($result['content_hash'], 0, 12) . '…)');
                apiSuccess($result);
            } else {
                $data       = apiGetJsonBody();
                $contractId = (int) ($data['contract_id'] ?? 0);
                $phase      = trim($data['phase'] ?? '');
                $date       = trim($data['snapshot_date'] ?? '') ?: null;

                if (!$contractId) apiError('Contratto obbligatorio.');
                if ($date !== null && !DateTime::createFromFormat('!Y-m-d', $date)) apiError('Data verbale non valida.');

                $result = createInventorySnapshot($db, $contractId, $phase, $date, getCurrentAdminId() ?: null);
                logActivity('create', 'inventory_snapshot', $result['id'],
                    'Verbale ' . $phase . ' creato con ' . $result['copied'] . ' righe');

                $snapshot          = fetchInventorySnapshot($db, $result['id']);
                $snapshot['items'] = fetchInventorySnapshotItems($db, $result['id']);
                apiSuccess($snapshot);
            }
            break;

        case 'PUT':
            if (!$itemId) apiError('ID riga mancante.');
            apiSuccess(updateInventorySnapshotItem($db, $itemId, apiGetJsonBody()));
            break;

        case 'DELETE':
            if (!$id) apiError('ID verbale mancante.');
            $snapshot = fetchInventorySnapshot($db, $id);
            if (!$snapshot) apiError('Verbale non trovato.', 404);
            // Un verbale chiuso è la prova: si elimina il contratto, non il verbale.
            if ($snapshot['status'] === 'locked') {
                apiError('Il verbale è chiuso e non può essere eliminato.', 409);
            }
            $db->prepare("DELETE FROM inventory_snapshots WHERE id = :id")->execute(['id' => $id]);
            logActivity('delete', 'inventory_snapshot', $id, 'Bozza verbale eliminata #' . $id);
            apiSuccess(['id' => $id, 'message' => 'Bozza eliminata.']);
            break;

        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (RuntimeException $e) {
    apiError($e->getMessage());
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

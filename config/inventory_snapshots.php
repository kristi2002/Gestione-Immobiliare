<?php
/**
 * Verbali di consegna (inventory snapshots) — phase78.
 *
 * L'inventario appartiene all'IMMOBILE, la contestazione appartiene al
 * CONTRATTO. Finché le due cose coincidono non succede niente; succede quando
 * l'inquilino esce: scrivere la condizione d'uscita sulla riga viva
 * sovrascriverebbe quella d'ingresso, cioè cancellerebbe la linea di partenza
 * nell'istante esatto in cui serve difenderla.
 *
 * Il verbale è quindi una COPIA congelata delle righe per quella locazione:
 * check-in e check-out coesistono, si confrontano riga per riga, e restano
 * leggibili anche se l'articolo viene poi modificato o eliminato.
 *
 * Chiusura (`lock`): PDF generato → hash SHA-256 delle sue esatte bytes → riga
 * `documents` (l'unico ramo di uploads/ con deny Apache, streamer autenticato e
 * log GDPR) → opzionale richiesta di firma. Da quel momento le righe non si
 * toccano più: è il senso stesso di un verbale.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/env.php';
require_once __DIR__ . '/pdf.php';
require_once __DIR__ . '/settings.php';

const INVENTORY_SNAPSHOT_PHASES = ['check_in', 'check_out'];

const INVENTORY_PHASE_LABELS = [
    'check_in'  => 'Verbale di consegna (check-in)',
    'check_out' => 'Verbale di riconsegna (check-out)',
];

const INVENTORY_CONDITION_LABELS = [
    1 => 'Pessima', 2 => 'Scarsa', 3 => 'Discreta', 4 => 'Buona', 5 => 'Ottima',
];

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

function inventoryCategories(PDO $db, bool $onlyActive = true): array
{
    $sql = 'SELECT id, slug, label, sort_order, is_active FROM inventory_categories';
    if ($onlyActive) {
        $sql .= ' WHERE is_active = 1';
    }
    $sql .= ' ORDER BY sort_order ASC, label ASC';

    return $db->query($sql)->fetchAll();
}

function inventoryCategorySlugs(PDO $db): array
{
    return array_column(inventoryCategories($db, false), 'slug');
}

function fetchInventorySnapshot(PDO $db, int $id): ?array
{
    $stmt = $db->prepare(
        "SELECT s.*, p.address AS property_address, p.city AS property_city,
                c.title AS contract_title, c.start_date, c.end_date,
                t.name AS tenant_name, t.surname AS tenant_surname, t.email AS tenant_email,
                e.status AS signature_status, e.signed_at, e.signer_name, e.signer_email, e.token AS signature_token,
                d.file_path AS document_path
         FROM inventory_snapshots s
         LEFT JOIN properties p ON p.id = s.property_id
         LEFT JOIN contracts  c ON c.id = s.contract_id
         LEFT JOIN tenants    t ON t.id = c.tenant_id
         LEFT JOIN esign_requests e ON e.id = s.esign_request_id
         LEFT JOIN documents  d ON d.id = s.document_id
         WHERE s.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();

    return $row ?: null;
}

function fetchInventorySnapshotItems(PDO $db, int $snapshotId): array
{
    $stmt = $db->prepare(
        "SELECT si.*, ic.label AS category_label
           FROM inventory_snapshot_items si
           LEFT JOIN inventory_categories ic ON ic.slug = si.category
          WHERE si.snapshot_id = :sid
       ORDER BY si.category ASC, si.item_name ASC, si.id ASC"
    );
    $stmt->execute(['sid' => $snapshotId]);

    return $stmt->fetchAll();
}

function listInventorySnapshots(PDO $db, ?int $contractId, ?int $propertyId): array
{
    $where  = 'WHERE 1=1';
    $params = [];

    if ($contractId) {
        $where .= ' AND s.contract_id = :contract_id';
        $params['contract_id'] = $contractId;
    }
    if ($propertyId) {
        $where .= ' AND s.property_id = :property_id';
        $params['property_id'] = $propertyId;
    }

    $stmt = $db->prepare(
        "SELECT s.*, c.title AS contract_title, c.start_date, c.end_date,
                t.name AS tenant_name, t.surname AS tenant_surname,
                e.status AS signature_status, e.signed_at,
                (SELECT COUNT(*) FROM inventory_snapshot_items si WHERE si.snapshot_id = s.id) AS item_count
           FROM inventory_snapshots s
           LEFT JOIN contracts c ON c.id = s.contract_id
           LEFT JOIN tenants   t ON t.id = c.tenant_id
           LEFT JOIN esign_requests e ON e.id = s.esign_request_id
           $where
       ORDER BY s.contract_id DESC, s.phase ASC"
    );
    $stmt->execute($params);

    return $stmt->fetchAll();
}

/**
 * Contratti di locazione dell'immobile, con lo stato dei due verbali.
 * È l'elenco su cui lavora la pagina Inventario: da qui si apre un check-in o
 * un check-out senza dover indovinare quale contratto sia quello giusto.
 */
function listPropertyContractsWithSnapshots(PDO $db, int $propertyId): array
{
    $stmt = $db->prepare(
        "SELECT c.id, c.title, c.start_date, c.end_date, c.status,
                CONCAT_WS(' ', t.name, t.surname) AS tenant_name, t.email AS tenant_email,
                si.id AS check_in_id,  si.status AS check_in_status,  si.snapshot_date AS check_in_date,
                so.id AS check_out_id, so.status AS check_out_status, so.snapshot_date AS check_out_date
           FROM contracts c
           LEFT JOIN tenants t ON t.id = c.tenant_id
           LEFT JOIN inventory_snapshots si ON si.contract_id = c.id AND si.phase = 'check_in'
           LEFT JOIN inventory_snapshots so ON so.contract_id = c.id AND so.phase = 'check_out'
          WHERE c.property_id = :pid
            AND c.contract_type = 'locazione'
       ORDER BY COALESCE(c.start_date, c.created_at) DESC"
    );
    $stmt->execute(['pid' => $propertyId]);

    return $stmt->fetchAll();
}

// ---------------------------------------------------------------------------
// Scrittura
// ---------------------------------------------------------------------------

/**
 * Crea un verbale copiando le righe.
 *
 * check-in  → copia l'inventario VIVO dell'immobile, con le condizioni di oggi.
 * check-out → copia le righe del CHECK-IN (è quello l'elenco consegnato: se nel
 *             frattempo il proprietario ha aggiunto un divano, non era nella
 *             consegna e non si contesta all'inquilino), azzerando le condizioni
 *             perché sono esattamente ciò che l'agente deve compilare.
 *             Senza check-in ricade sull'inventario vivo.
 *
 * @return array{id:int, copied:int}
 * @throws RuntimeException con messaggio già presentabile all'utente.
 */
function createInventorySnapshot(PDO $db, int $contractId, string $phase, ?string $date, ?int $adminId): array
{
    if (!in_array($phase, INVENTORY_SNAPSHOT_PHASES, true)) {
        throw new RuntimeException('Fase verbale non valida.');
    }

    $stmt = $db->prepare("SELECT id, property_id, contract_type FROM contracts WHERE id = :id");
    $stmt->execute(['id' => $contractId]);
    $contract = $stmt->fetch();

    if (!$contract) {
        throw new RuntimeException('Contratto non trovato.');
    }
    if (empty($contract['property_id'])) {
        throw new RuntimeException('Il contratto non è collegato a un immobile.');
    }

    $exists = $db->prepare("SELECT id FROM inventory_snapshots WHERE contract_id = :cid AND phase = :phase");
    $exists->execute(['cid' => $contractId, 'phase' => $phase]);
    if ($existingId = $exists->fetchColumn()) {
        throw new RuntimeException('Esiste già un verbale di ' .
            ($phase === 'check_in' ? 'consegna' : 'riconsegna') . ' per questo contratto (#' . $existingId . ').');
    }

    $propertyId = (int) $contract['property_id'];
    $source     = inventorySnapshotSource($db, $contractId, $phase, $propertyId);

    if (!$source) {
        throw new RuntimeException("Nessun articolo in inventario per questo immobile: non c'è niente da verbalizzare.");
    }

    $db->beginTransaction();
    try {
        $ins = $db->prepare(
            "INSERT INTO inventory_snapshots
                (contract_id, property_id, phase, status, snapshot_date, created_by)
             VALUES (:cid, :pid, :phase, 'draft', :sdate, :uid)"
        );
        $ins->execute([
            'cid'   => $contractId,
            'pid'   => $propertyId,
            'phase' => $phase,
            'sdate' => $date ?: date('Y-m-d'),
            'uid'   => $adminId ?: null,
        ]);
        $snapshotId = (int) $db->lastInsertId();

        $insItem = $db->prepare(
            "INSERT INTO inventory_snapshot_items
                (snapshot_id, inventory_item_id, item_name, category, quantity, condition_rating,
                 notes, brand, model, serial_number, estimated_value, photo_count)
             VALUES
                (:sid, :item_id, :item_name, :category, :quantity, :condition_rating,
                 :notes, :brand, :model, :serial_number, :estimated_value, :photo_count)"
        );

        foreach ($source as $row) {
            $insItem->execute([
                'sid'              => $snapshotId,
                'item_id'          => $row['inventory_item_id'],
                'item_name'        => $row['item_name'],
                'category'         => $row['category'],
                'quantity'         => $row['quantity'],
                // Il check-out nasce senza voto: è il campo che l'agente compila
                // guardando il bene, non un valore ereditato che sembra già fatto.
                'condition_rating' => $phase === 'check_in' ? $row['condition_rating'] : null,
                'notes'            => $phase === 'check_in' ? $row['notes'] : null,
                'brand'            => $row['brand'],
                'model'            => $row['model'],
                'serial_number'    => $row['serial_number'],
                'estimated_value'  => $row['estimated_value'],
                'photo_count'      => $row['photo_count'],
            ]);
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    return ['id' => $snapshotId, 'copied' => count($source)];
}

/** Righe da copiare: check-in dall'inventario vivo, check-out dal check-in. */
function inventorySnapshotSource(PDO $db, int $contractId, string $phase, int $propertyId): array
{
    if ($phase === 'check_out') {
        $stmt = $db->prepare(
            "SELECT si.inventory_item_id, si.item_name, si.category, si.quantity, si.condition_rating,
                    si.notes, si.brand, si.model, si.serial_number, si.estimated_value, si.photo_count
               FROM inventory_snapshot_items si
               JOIN inventory_snapshots s ON s.id = si.snapshot_id
              WHERE s.contract_id = :cid AND s.phase = 'check_in'
           ORDER BY si.category ASC, si.item_name ASC"
        );
        $stmt->execute(['cid' => $contractId]);
        $rows = $stmt->fetchAll();
        if ($rows) {
            return $rows;
        }
    }

    $stmt = $db->prepare(
        "SELECT pi.id AS inventory_item_id, pi.item_name, pi.category, pi.quantity, pi.condition_rating,
                pi.notes, pi.brand, pi.model, pi.serial_number, pi.estimated_value,
                (SELECT COUNT(*) FROM documents d WHERE d.inventory_item_id = pi.id) AS photo_count
           FROM property_inventory pi
          WHERE pi.property_id = :pid
       ORDER BY pi.category ASC, pi.item_name ASC"
    );
    $stmt->execute(['pid' => $propertyId]);

    return $stmt->fetchAll();
}

/**
 * Aggiorna una riga del verbale. Quantità 0 = "mancante": è il modo in cui si
 * registra un bene sparito senza inventare una colonna che direbbe la stessa
 * cosa (il confronto lo traduce poi in danno pari all'intero valore stimato).
 */
function updateInventorySnapshotItem(PDO $db, int $itemId, array $data): array
{
    $stmt = $db->prepare(
        "SELECT si.*, s.status AS snapshot_status, s.id AS snap_id
           FROM inventory_snapshot_items si
           JOIN inventory_snapshots s ON s.id = si.snapshot_id
          WHERE si.id = :id"
    );
    $stmt->execute(['id' => $itemId]);
    $item = $stmt->fetch();

    if (!$item) {
        throw new RuntimeException('Riga del verbale non trovata.');
    }
    if ($item['snapshot_status'] === 'locked') {
        throw new RuntimeException('Il verbale è chiuso e firmato: le righe non sono più modificabili.');
    }

    $rating = $data['condition_rating'] ?? null;
    $rating = ($rating === '' || $rating === null) ? null : (int) $rating;
    if ($rating !== null && ($rating < 1 || $rating > 5)) {
        throw new RuntimeException('Condizione deve essere tra 1 e 5.');
    }

    $quantity = isset($data['quantity']) && $data['quantity'] !== '' ? (int) $data['quantity'] : (int) $item['quantity'];
    if ($quantity < 0) {
        throw new RuntimeException('Quantità non valida.');
    }

    $notes = trim((string) ($data['notes'] ?? '')) ?: null;

    $db->prepare(
        "UPDATE inventory_snapshot_items
            SET condition_rating = :rating, quantity = :qty, notes = :notes
          WHERE id = :id"
    )->execute(['rating' => $rating, 'qty' => $quantity, 'notes' => $notes, 'id' => $itemId]);

    $stmt = $db->prepare("SELECT * FROM inventory_snapshot_items WHERE id = :id");
    $stmt->execute(['id' => $itemId]);

    return $stmt->fetch();
}

// ---------------------------------------------------------------------------
// Confronto check-in / check-out
// ---------------------------------------------------------------------------

/**
 * Griglia di confronto: ogni riga del check-in accanto alla sua d'uscita.
 *
 * L'accoppiamento è per `inventory_item_id` quando c'è (il caso normale) e per
 * nome+categoria quando l'articolo nel frattempo è stato eliminato: il verbale
 * sopravvive alla riga viva, l'abbinamento deve sopravvivere con lui.
 *
 * `suggested_deduction` è una proporzione indicativa (valore × peggioramento/5),
 * non una perizia: serve a dare all'agente un ordine di grandezza da discutere,
 * e va sempre presentata come stima.
 */
function buildInventoryComparison(PDO $db, int $contractId): array
{
    $snapshots = listInventorySnapshots($db, $contractId, null);
    $byPhase   = [];
    foreach ($snapshots as $s) {
        $byPhase[$s['phase']] = $s;
    }

    $checkIn  = $byPhase['check_in']  ?? null;
    $checkOut = $byPhase['check_out'] ?? null;

    $inItems  = $checkIn  ? fetchInventorySnapshotItems($db, (int) $checkIn['id'])  : [];
    $outItems = $checkOut ? fetchInventorySnapshotItems($db, (int) $checkOut['id']) : [];

    $key = static fn(array $r): string => !empty($r['inventory_item_id'])
        ? 'id:' . $r['inventory_item_id']
        : 'nk:' . mb_strtolower(trim($r['item_name'])) . '|' . ($r['category'] ?? '');

    $outByKey = [];
    foreach ($outItems as $r) {
        $outByKey[$key($r)][] = $r;
    }

    $rows           = [];
    $totalDeduction = 0.0;
    $worsened       = 0;
    $missing        = 0;

    foreach ($inItems as $in) {
        $k   = $key($in);
        $out = null;
        if (!empty($outByKey[$k])) {
            $out = array_shift($outByKey[$k]);
        }

        $inRating  = $in['condition_rating']  !== null ? (int) $in['condition_rating']  : null;
        $outRating = $out && $out['condition_rating'] !== null ? (int) $out['condition_rating'] : null;
        $value     = $in['estimated_value'] !== null ? (float) $in['estimated_value'] : null;

        $isMissing = $out !== null && (int) $out['quantity'] === 0;
        $delta     = ($inRating !== null && $outRating !== null) ? $outRating - $inRating : null;

        $deduction = null;
        if ($value !== null) {
            if ($isMissing) {
                $deduction = round($value, 2);
            } elseif ($delta !== null && $delta < 0) {
                $deduction = round($value * (abs($delta) / 5), 2);
            }
        }

        if ($isMissing) {
            $missing++;
        } elseif ($delta !== null && $delta < 0) {
            $worsened++;
        }
        if ($deduction !== null) {
            $totalDeduction += $deduction;
        }

        $rows[] = [
            'item_name'           => $in['item_name'],
            'category'            => $in['category'],
            'category_label'      => $in['category_label'] ?? $in['category'],
            'brand'               => $in['brand'],
            'model'               => $in['model'],
            'serial_number'       => $in['serial_number'],
            'estimated_value'     => $value,
            'check_in_rating'     => $inRating,
            'check_in_quantity'   => (int) $in['quantity'],
            'check_in_notes'      => $in['notes'],
            'check_out_item_id'   => $out['id'] ?? null,
            'check_out_rating'    => $outRating,
            'check_out_quantity'  => $out !== null ? (int) $out['quantity'] : null,
            'check_out_notes'     => $out['notes'] ?? null,
            'missing'             => $isMissing,
            'delta'               => $delta,
            'suggested_deduction' => $deduction,
        ];
    }

    // Righe presenti solo all'uscita: beni aggiunti dopo la consegna. Non si
    // contestano all'inquilino, ma vanno mostrati o "spariscono" dal verbale.
    foreach ($outByKey as $leftovers) {
        foreach ($leftovers as $out) {
            $rows[] = [
                'item_name'           => $out['item_name'],
                'category'            => $out['category'],
                'category_label'      => $out['category_label'] ?? $out['category'],
                'brand'               => $out['brand'],
                'model'               => $out['model'],
                'serial_number'       => $out['serial_number'],
                'estimated_value'     => $out['estimated_value'] !== null ? (float) $out['estimated_value'] : null,
                'check_in_rating'     => null,
                'check_in_quantity'   => null,
                'check_in_notes'      => null,
                'check_out_item_id'   => (int) $out['id'],
                'check_out_rating'    => $out['condition_rating'] !== null ? (int) $out['condition_rating'] : null,
                'check_out_quantity'  => (int) $out['quantity'],
                'check_out_notes'     => $out['notes'],
                'missing'             => false,
                'delta'               => null,
                'suggested_deduction' => null,
                'added_after_check_in' => true,
            ];
        }
    }

    return [
        'contract_id' => $contractId,
        'check_in'    => $checkIn,
        'check_out'   => $checkOut,
        'rows'        => $rows,
        'summary'     => [
            'items'               => count($rows),
            'worsened'            => $worsened,
            'missing'             => $missing,
            'suggested_deduction' => round($totalDeduction, 2),
        ],
    ];
}

// ---------------------------------------------------------------------------
// Chiusura: PDF + hash + firma
// ---------------------------------------------------------------------------

/**
 * Chiude il verbale: genera il PDF, ne calcola l'impronta, lo archivia in
 * `documents` e blocca le righe. Se arriva un firmatario, crea anche la
 * richiesta di firma (stesso meccanismo a token dei contratti).
 *
 * @return array dati del verbale chiuso + link di firma quando presente.
 */
function lockInventorySnapshot(PDO $db, int $snapshotId, ?int $adminId, ?string $signerName, ?string $signerEmail): array
{
    $snapshot = fetchInventorySnapshot($db, $snapshotId);
    if (!$snapshot) {
        throw new RuntimeException('Verbale non trovato.');
    }
    if ($snapshot['status'] === 'locked') {
        throw new RuntimeException('Verbale già chiuso il ' . date('d/m/Y H:i', strtotime($snapshot['locked_at'])) . '.');
    }

    $items = fetchInventorySnapshotItems($db, $snapshotId);
    if (!$items) {
        throw new RuntimeException('Verbale senza righe: niente da chiudere.');
    }

    // Un check-out con condizioni non compilate non è un verbale: è un modulo in
    // bianco firmato, che in una contestazione vale contro chi lo ha prodotto.
    if ($snapshot['phase'] === 'check_out') {
        $blank = array_filter($items, static fn($i) => $i['condition_rating'] === null && (int) $i['quantity'] > 0);
        if ($blank) {
            throw new RuntimeException('Compila la condizione di riconsegna di tutte le righe (mancano ' . count($blank) . ').');
        }
    }

    $pdf   = buildInventorySnapshotPdf($db, $snapshot, $items);
    $bytes = $pdf->output();
    $hash  = hash('sha256', $bytes);

    $dir = dirname(__DIR__) . '/uploads/documents/generated';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException('Cartella uploads non scrivibile sul server.');
    }

    $filename = 'verbale_' . $snapshot['phase'] . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.pdf';
    $relative = 'uploads/documents/generated/' . $filename;

    if (@file_put_contents($dir . '/' . $filename, $bytes) === false) {
        throw new RuntimeException('Impossibile salvare il PDF del verbale.');
    }

    $title = INVENTORY_PHASE_LABELS[$snapshot['phase']] . ' — ' . ($snapshot['property_address'] ?: 'Immobile #' . $snapshot['property_id']);

    $db->prepare(
        "INSERT INTO documents
            (doc_type, title, property_id, contract_id, file_path, original_name, mime_type, file_size, notes)
         VALUES
            ('inventario', :title, :pid, :cid, :path, :orig, 'application/pdf', :size, :notes)"
    )->execute([
        'title' => $title,
        'pid'   => $snapshot['property_id'],
        'cid'   => $snapshot['contract_id'],
        'path'  => $relative,
        'orig'  => $filename,
        'size'  => strlen($bytes),
        'notes' => 'SHA-256: ' . $hash,
    ]);
    $documentId = (int) $db->lastInsertId();

    $esignId  = null;
    $signLink = null;
    if ($signerEmail && filter_var($signerEmail, FILTER_VALIDATE_EMAIL)) {
        $token     = bin2hex(random_bytes(32));
        $expiresAt = date('Y-m-d H:i:s', strtotime('+30 days'));

        $db->prepare(
            "INSERT INTO esign_requests
                (document_id, contract_id, signer_name, signer_email, token, status, expires_at)
             VALUES (:did, :cid, :sname, :semail, :token, 'pending', :exp)"
        )->execute([
            'did'    => $documentId,
            'cid'    => $snapshot['contract_id'],
            'sname'  => $signerName ?: 'Inquilino',
            'semail' => $signerEmail,
            'token'  => $token,
            'exp'    => $expiresAt,
        ]);
        $esignId  = (int) $db->lastInsertId();
        // appBaseUrl(): ci si arriva anche da cron/process_contract_expirations.php,
        // dove la costante non esiste e il link di firma restava monco.
        $signLink = appBaseUrl() . '/sign.php?token=' . $token;
    }

    $db->prepare(
        "UPDATE inventory_snapshots
            SET status = 'locked', document_id = :did, esign_request_id = :eid,
                content_hash = :hash, locked_at = NOW(), locked_by = :uid
          WHERE id = :id"
    )->execute([
        'did'  => $documentId,
        'eid'  => $esignId,
        'hash' => $hash,
        'uid'  => $adminId ?: null,
        'id'   => $snapshotId,
    ]);

    return [
        'id'            => $snapshotId,
        'status'        => 'locked',
        'document_id'   => $documentId,
        'download_url'  => 'api/download_document.php?id=' . $documentId,
        'content_hash'  => $hash,
        'esign_request_id' => $esignId,
        'sign_link'     => $signLink,
    ];
}

/** Il PDF del verbale: elenco per il check-in, confronto per il check-out. */
function buildInventorySnapshotPdf(PDO $db, array $snapshot, array $items): SimplePdf
{
    $isCheckIn = $snapshot['phase'] === 'check_in';
    $title     = INVENTORY_PHASE_LABELS[$snapshot['phase']];

    $tenantFull = trim(($snapshot['tenant_name'] ?? '') . ' ' . ($snapshot['tenant_surname'] ?? ''));

    $blocks = [
        ['type' => 'h2', 'text' => 'Riferimenti'],
        ['type' => 'kv', 'pairs' => [
            ['Immobile',  trim(($snapshot['property_address'] ?? '') . ' ' . ($snapshot['property_city'] ?? '')) ?: '—'],
            ['Contratto', ($snapshot['contract_title'] ?? '—') . ' (#' . $snapshot['contract_id'] . ')'],
            ['Inquilino', $tenantFull ?: '—'],
            ['Data verbale', formatDateIt($snapshot['snapshot_date'])],
        ]],
    ];

    if ($isCheckIn) {
        $rows = [];
        foreach ($items as $i) {
            $rows[] = [
                $i['item_name'],
                trim(($i['brand'] ?? '') . ' ' . ($i['model'] ?? '')) ?: '—',
                $i['serial_number'] ?: '—',
                (string) $i['quantity'],
                inventoryConditionText($i['condition_rating']),
                $i['notes'] ?: '—',
            ];
        }

        $blocks[] = ['type' => 'h2', 'text' => 'Beni consegnati'];
        $blocks[] = [
            'type'    => 'table',
            'columns' => [
                ['label' => 'Articolo',      'width' => 0.24],
                ['label' => 'Marca/Modello', 'width' => 0.20],
                ['label' => 'Matricola',     'width' => 0.16],
                ['label' => 'Qtà',           'width' => 0.06, 'align' => 'right'],
                ['label' => 'Condizione',    'width' => 0.16],
                ['label' => 'Note',          'width' => 0.18],
            ],
            'rows' => $rows,
        ];
    } else {
        $comparison = buildInventoryComparison($db, (int) $snapshot['contract_id']);
        $rows = [];
        foreach ($comparison['rows'] as $r) {
            $rows[] = [
                $r['item_name'],
                inventoryConditionText($r['check_in_rating']),
                $r['missing'] ? 'MANCANTE' : inventoryConditionText($r['check_out_rating']),
                $r['delta'] === null ? '—' : ($r['delta'] > 0 ? '+' . $r['delta'] : (string) $r['delta']),
                $r['suggested_deduction'] === null ? '—' : '€ ' . number_format($r['suggested_deduction'], 2, ',', '.'),
                $r['check_out_notes'] ?: '—',
            ];
        }

        $blocks[] = ['type' => 'h2', 'text' => 'Confronto consegna / riconsegna'];
        $blocks[] = [
            'type'    => 'table',
            'columns' => [
                ['label' => 'Articolo',   'width' => 0.26],
                ['label' => 'Ingresso',   'width' => 0.14],
                ['label' => 'Uscita',     'width' => 0.14],
                ['label' => 'Δ',          'width' => 0.06, 'align' => 'right'],
                ['label' => 'Stima danno','width' => 0.16, 'align' => 'right'],
                ['label' => 'Note',       'width' => 0.24],
            ],
            'rows' => $rows,
        ];
        $blocks[] = ['type' => 'kv', 'pairs' => [
            ['Beni peggiorati', (string) $comparison['summary']['worsened']],
            ['Beni mancanti',   (string) $comparison['summary']['missing']],
            ['Totale stima indicativa', '€ ' . number_format($comparison['summary']['suggested_deduction'], 2, ',', '.')],
        ]];
        $blocks[] = ['type' => 'paragraph', 'text' =>
            'Le stime sono proporzionali al valore dichiarato in inventario e al peggioramento rilevato: '
            . 'costituiscono una base di discussione tra le parti, non una perizia né una quantificazione definitiva del danno.'];
    }

    if (!empty($snapshot['notes'])) {
        $blocks[] = ['type' => 'h2', 'text' => 'Annotazioni'];
        $blocks[] = ['type' => 'paragraph', 'text' => $snapshot['notes']];
    }

    $blocks[] = ['type' => 'spacer', 'height' => 6];
    $blocks[] = ['type' => 'paragraph', 'text' =>
        'Le parti dichiarano di aver verificato i beni sopra elencati e di accettarne lo stato come descritto.'];
    $blocks[] = ['type' => 'signatures', 'items' => ['Firma del locatore', 'Firma del conduttore']];

    return SimplePdf::fromBlocks($title, $blocks, pdfDocOpts($title, [
        'meta' => 'Contratto #' . $snapshot['contract_id'],
    ]));
}

function inventoryConditionText(?int $rating): string
{
    if ($rating === null) return '—';
    return $rating . '/5 ' . (INVENTORY_CONDITION_LABELS[$rating] ?? '');
}

// ---------------------------------------------------------------------------
// Ciclo di vita: il check-out non lo si ricorda, lo si riceve
// ---------------------------------------------------------------------------

/**
 * Locazioni scadute con verbale di consegna ma senza riconsegna: prepara la
 * bozza di check-out e apre il compito per l'agente.
 *
 * Nessun broker di eventi: in questa app "evento" significa una riga
 * `reminders` che il motore promemoria consegna già da sola. Il cron delle
 * scadenze contratti è il posto naturale — passa di lì ogni giorno per lo stesso
 * insieme di contratti.
 *
 * @return array{processed:int, created:int, skipped:int, results:array}
 */
function processInventoryCheckouts(PDO $db, int $graceDays = 0): array
{
    try {
        $stmt = $db->prepare(
            "SELECT c.id, c.title, c.property_id, c.client_id, c.tenant_id, c.end_date,
                    p.address AS property_address,
                    s.id AS check_in_id
               FROM contracts c
               JOIN inventory_snapshots s ON s.contract_id = c.id AND s.phase = 'check_in'
               LEFT JOIN inventory_snapshots so ON so.contract_id = c.id AND so.phase = 'check_out'
               LEFT JOIN properties p ON p.id = c.property_id
              WHERE c.contract_type = 'locazione'
                AND c.end_date IS NOT NULL
                AND c.end_date <= DATE_ADD(CURDATE(), INTERVAL :grace DAY)
                AND so.id IS NULL"
        );
        $stmt->execute(['grace' => $graceDays]);
        $contracts = $stmt->fetchAll();
    } catch (PDOException $e) {
        // Tabelle non ancora migrate: il resto del cron deve girare comunque.
        return ['processed' => 0, 'created' => 0, 'skipped' => 0, 'results' => [], 'note' => 'phase78 non applicata.'];
    }

    $created = 0;
    $skipped = 0;
    $results = [];

    foreach ($contracts as $c) {
        try {
            $snap = createInventorySnapshot($db, (int) $c['id'], 'check_out', date('Y-m-d'), null);
        } catch (Throwable $e) {
            $skipped++;
            $results[] = ['contract_id' => (int) $c['id'], 'error' => $e->getMessage()];
            continue;
        }

        $title = 'Confronto check-out inventario: ' . ($c['property_address'] ?: ('contratto #' . $c['id']));

        $dup = $db->prepare(
            "SELECT id FROM reminders WHERE title = :title AND status = 'pending' LIMIT 1"
        );
        $dup->execute(['title' => $title]);

        if (!$dup->fetch()) {
            $db->prepare(
                "INSERT INTO reminders
                    (title, description, reminder_date, frequency, status, client_id, property_id, tenant_id,
                     request_type, notify_admin, notify_client)
                 VALUES
                    (:title, :description, NOW(), 'once', 'pending', :client_id, :property_id, :tenant_id,
                     'inventory_checkout', 1, 0)"
            )->execute([
                'title'       => $title,
                'description' => 'Il contratto è scaduto il ' . date('d/m/Y', strtotime($c['end_date']))
                    . '. È stata creata la bozza di verbale di riconsegna #' . $snap['id']
                    . ' con ' . $snap['copied'] . ' righe da compilare (Inventario → Verbali).',
                'client_id'   => $c['client_id'],
                'property_id' => $c['property_id'],
                'tenant_id'   => $c['tenant_id'],
            ]);
        }

        $created++;
        $results[] = ['contract_id' => (int) $c['id'], 'snapshot_id' => $snap['id'], 'items' => $snap['copied']];
    }

    return [
        'processed' => count($contracts),
        'created'   => $created,
        'skipped'   => $skipped,
        'results'   => $results,
    ];
}

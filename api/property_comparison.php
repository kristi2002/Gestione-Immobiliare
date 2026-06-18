<?php
/**
 * Property Comparison API (read-only).
 *
 * GET /api/property_comparison.php?ids=1,2,3  — side-by-side comparison of up to 4 properties
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
apiHandleOptions();
apiRequireMethod('GET');

try {
    $db = getDB();

    $idsParam = trim($_GET['ids'] ?? '');
    if ($idsParam === '') {
        apiError('Parametro ids obbligatorio (es. ?ids=1,2,3).');
    }

    $ids = array_values(array_unique(array_filter(
        array_map('intval', explode(',', $idsParam)),
        fn($id) => $id > 0
    )));

    if (count($ids) < 1) {
        apiError('Nessun ID valido fornito.');
    }
    if (count($ids) > 4) {
        apiError('Massimo 4 immobili per confronto.');
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    // Fetch base property data
    $stmt = $db->prepare(
        "SELECT p.id, p.address, p.city, p.cap, p.province,
                p.sqm AS size_sqm, p.rooms, p.bathrooms, p.floor,
                p.year_built, p.property_type,
                p.description, p.additional_features AS features,
                p.status, p.price, p.price_type,
                p.created_at, p.latitude, p.longitude,
                c.name AS client_name, c.surname AS client_surname
         FROM properties p
         LEFT JOIN clients c ON c.id = p.client_id
         WHERE p.id IN ($placeholders)
         ORDER BY FIELD(p.id, $placeholders)"
    );
    $params = array_merge($ids, $ids);
    $stmt->execute($params);
    $properties = $stmt->fetchAll();

    if (empty($properties)) {
        apiError('Nessun immobile trovato con gli ID forniti.', 404);
    }

    // Enrich each property
    $result = [];
    foreach ($properties as $prop) {
        $propId = (int) $prop['id'];

        // Current monthly rent: prefer active signed contract, fall back to price if price_type='affitto'
        $rentStmt = $db->prepare(
            "SELECT monthly_rent FROM contracts
             WHERE property_id = :pid AND status = 'signed'
               AND start_date <= CURDATE()
               AND (end_date IS NULL OR end_date >= CURDATE())
             ORDER BY start_date DESC LIMIT 1"
        );
        $rentStmt->execute(['pid' => $propId]);
        $rentRow     = $rentStmt->fetch();
        if ($rentRow) {
            $monthlyRent = (float) $rentRow['monthly_rent'];
        } elseif ($prop['price_type'] === 'affitto' && $prop['price'] !== null) {
            $monthlyRent = (float) $prop['price'];
        } else {
            $monthlyRent = null;
        }

        // Total income last 12 months
        $incomeStmt = $db->prepare(
            "SELECT COALESCE(SUM(amount), 0) AS total
             FROM payments
             WHERE property_id = :pid AND status = 'paid'
               AND paid_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)"
        );
        $incomeStmt->execute(['pid' => $propId]);
        $totalIncome12m = (float) $incomeStmt->fetchColumn();

        // Latest appraised market value
        $apprStmt = $db->prepare(
            "SELECT estimated_value FROM property_appraisals
             WHERE property_id = :pid
             ORDER BY appraisal_date DESC, id DESC LIMIT 1"
        );
        $apprStmt->execute(['pid' => $propId]);
        $currentValue = ($v = $apprStmt->fetchColumn()) !== false ? (float) $v : null;

        // Last payment date
        $lastPayStmt = $db->prepare(
            "SELECT MAX(paid_date) FROM payments
             WHERE property_id = :pid AND status = 'paid'"
        );
        $lastPayStmt->execute(['pid' => $propId]);
        $lastPaymentDate = $lastPayStmt->fetchColumn() ?: null;

        // Occupancy status (active signed contract exists?)
        $occupancyStmt = $db->prepare(
            "SELECT COUNT(*) FROM contracts
             WHERE property_id = :pid AND status = 'signed'
               AND start_date <= CURDATE()
               AND (end_date IS NULL OR end_date >= CURDATE())"
        );
        $occupancyStmt->execute(['pid' => $propId]);
        $occupancyStatus = (int) $occupancyStmt->fetchColumn() > 0 ? 'occupied' : 'vacant';

        // Decode features JSON if applicable
        $features = $prop['features'];
        if ($features !== null) {
            $decoded = json_decode($features, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $features = $decoded;
            }
        }

        $result[] = [
            'id'                 => $propId,
            'address'            => $prop['address'],
            'city'               => $prop['city'],
            'cap'                => $prop['cap'],
            'province'           => $prop['province'],
            'property_type'      => $prop['property_type'],
            'size_sqm'           => $prop['size_sqm'] !== null ? (float) $prop['size_sqm'] : null,
            'rooms'              => $prop['rooms'] !== null ? (int) $prop['rooms'] : null,
            'bathrooms'          => $prop['bathrooms'] !== null ? (int) $prop['bathrooms'] : null,
            'floor'              => $prop['floor'],
            'year_built'         => $prop['year_built'] !== null ? (int) $prop['year_built'] : null,
            'price_type'         => $prop['price_type'],
            'price'              => $prop['price'] !== null ? (float) $prop['price'] : null,
            'current_value'      => $currentValue,
            'monthly_rent'       => $monthlyRent,
            'status'             => $prop['status'],
            'features'           => $features,
            'last_payment_date'  => $lastPaymentDate,
            'total_income_12m'   => $totalIncome12m,
            'occupancy_status'   => $occupancyStatus,
            'client_name'        => trim(($prop['client_name'] ?? '') . ' ' . ($prop['client_surname'] ?? '')),
            'latitude'           => $prop['latitude'] !== null ? (float) $prop['latitude'] : null,
            'longitude'          => $prop['longitude'] !== null ? (float) $prop['longitude'] : null,
        ];
    }

    apiSuccess(['properties' => $result, 'count' => count($result)]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

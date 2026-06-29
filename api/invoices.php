<?php
/**
 * Invoices (Fatture agenzia) CRUD API.
 *
 * GET    /api/invoices.php             — list (status, client_id, year)
 * GET    /api/invoices.php?id={id}     — single
 * POST   /api/invoices.php             — create (auto invoice_number)
 * PUT    /api/invoices.php?id={id}     — update
 * DELETE /api/invoices.php?id={id}     — delete (drafts only)
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

if (!in_array(getCurrentRole(), ['admin', 'super_admin'], true)) {
    apiError('Permesso negato.', 403);
}

const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'cancelled'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getInvoice($db, $id) : listInvoices($db);
            break;
        case 'POST':
            createInvoice($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID fattura mancante.');
            updateInvoice($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID fattura mancante.');
            deleteInvoice($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function listInvoices(PDO $db): void
{
    $pagination = apiGetPagination();
    $status     = trim($_GET['status'] ?? '');
    $clientId   = isset($_GET['client_id']) ? (int) $_GET['client_id'] : null;
    $propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : null;
    $year       = isset($_GET['year']) ? (int) $_GET['year'] : null;

    $where = 'WHERE 1=1';
    $params = [];

    if ($status !== '' && in_array($status, INVOICE_STATUSES, true)) {
        $where .= ' AND i.status = :status'; $params['status'] = $status;
    }
    if ($clientId)   { $where .= ' AND i.client_id = :cid'; $params['cid'] = $clientId; }
    if ($propertyId) { $where .= ' AND i.property_id = :pid'; $params['pid'] = $propertyId; }
    if ($year)       { $where .= ' AND YEAR(i.issue_date) = :year'; $params['year'] = $year; }

    $countSql = "SELECT COUNT(*) FROM invoices i $where";

    $dataSql = "SELECT i.*, c.name AS client_name, c.surname AS client_surname,
                   l.name AS lead_name, l.surname AS lead_surname
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.client_id
            LEFT JOIN leads l ON l.id = i.lead_id
            $where
            ORDER BY i.issue_date DESC, i.id DESC";

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, $params, $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getInvoice(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT i.*, c.name AS client_name, c.surname AS client_surname,
                l.name AS lead_name, l.surname AS lead_surname
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN leads l ON l.id = i.lead_id
         WHERE i.id = :id"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Fattura non trovata.', 404);
    apiSuccess($row);
}

function createInvoice(PDO $db): void
{
    $validated = validateInvoiceInput(apiGetJsonBody());
    $validated['invoice_number'] = nextInvoiceNumber($db, (int) substr($validated['issue_date'], 0, 4));
    $validated['created_by']     = getCurrentAdminId() ?: null;

    $stmt = $db->prepare(
        "INSERT INTO invoices
            (invoice_number, client_id, lead_id, description, amount, vat_rate,
             status, issue_date, due_date, paid_date, notes, created_by)
         VALUES
            (:invoice_number, :client_id, :lead_id, :description, :amount, :vat_rate,
             :status, :issue_date, :due_date, :paid_date, :notes, :created_by)"
    );
    $stmt->execute($validated);
    getInvoice($db, (int) $db->lastInsertId());
}

function updateInvoice(PDO $db, int $id): void
{
    if (!invoiceExists($db, $id)) apiError('Fattura non trovata.', 404);
    $validated = validateInvoiceInput(apiGetJsonBody());
    $stmt = $db->prepare(
        "UPDATE invoices SET
            client_id = :client_id, lead_id = :lead_id, description = :description,
            amount = :amount, vat_rate = :vat_rate, status = :status,
            issue_date = :issue_date, due_date = :due_date, paid_date = :paid_date,
            notes = :notes
         WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));
    getInvoice($db, $id);
}

function deleteInvoice(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT status FROM invoices WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Fattura non trovata.', 404);
    if ($row['status'] !== 'draft') apiError('Solo le bozze possono essere eliminate.');

    $db->prepare("DELETE FROM invoices WHERE id = :id")->execute(['id' => $id]);
    apiSuccess(['id' => $id, 'message' => 'Fattura eliminata.']);
}

function nextInvoiceNumber(PDO $db, int $year): string
{
    $stmt = $db->prepare("SELECT COUNT(*) + 1 FROM invoices WHERE YEAR(issue_date) = :year");
    $stmt->execute(['year' => $year]);
    $seq = (int) $stmt->fetchColumn();
    return sprintf('FAT-%d-%04d', $year, $seq);
}

function validateInvoiceInput(array $data): array
{
    $clientId    = !empty($data['client_id']) ? (int) $data['client_id'] : null;
    $leadId      = !empty($data['lead_id']) ? (int) $data['lead_id'] : null;
    $description = trim($data['description'] ?? '');
    $amount      = isset($data['amount']) && $data['amount'] !== '' ? (float) $data['amount'] : null;
    $vatRate     = isset($data['vat_rate']) && $data['vat_rate'] !== '' ? (float) $data['vat_rate'] : 22.00;
    $status      = trim($data['status'] ?? 'draft');
    $issueDate   = trim($data['issue_date'] ?? '') ?: date('Y-m-d');
    $dueDate     = trim($data['due_date'] ?? '') ?: null;
    $paidDate    = trim($data['paid_date'] ?? '') ?: null;
    $notes       = trim($data['notes'] ?? '') ?: null;

    if ($description === '') apiError('La descrizione è obbligatoria.');
    if ($amount === null || $amount < 0) apiError('Importo non valido.');
    if ($vatRate < 0) apiError('Aliquota IVA non valida.');
    if (!in_array($status, INVOICE_STATUSES, true)) apiError('Stato non valido.');
    if (!DateTime::createFromFormat('Y-m-d', $issueDate)) apiError('Data emissione non valida.');

    return [
        'client_id'   => $clientId,
        'lead_id'     => $leadId,
        'description' => $description,
        'amount'      => $amount,
        'vat_rate'    => $vatRate,
        'status'      => $status,
        'issue_date'  => $issueDate,
        'due_date'    => $dueDate,
        'paid_date'   => $paidDate,
        'notes'       => $notes,
    ];
}

function invoiceExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM invoices WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

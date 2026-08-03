<?php
/**
 * WhatsApp templates CRUD API.
 *
 * GET    /api/whatsapp_templates.php          — list
 * GET    /api/whatsapp_templates.php?id={id}  — single
 * POST   /api/whatsapp_templates.php          — create
 * PUT    /api/whatsapp_templates.php?id={id}  — update
 * DELETE /api/whatsapp_templates.php?id={id}  — delete
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

const WA_TEMPLATE_CATEGORIES = ['benvenuto', 'scadenza', 'pagamento', 'visita', 'generico'];

try {
    $db     = getDB();
    $method = $_SERVER['REQUEST_METHOD'];
    $id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

    switch ($method) {
        case 'GET':
            $id ? getTemplate($db, $id) : listTemplates($db);
            break;
        case 'POST':
            createTemplate($db);
            break;
        case 'PUT':
            if (!$id) apiError('ID template mancante.');
            updateTemplate($db, $id);
            break;
        case 'DELETE':
            if (!$id) apiError('ID template mancante.');
            deleteTemplate($db, $id);
            break;
        default:
            apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function listTemplates(PDO $db): void
{
    $pagination = apiGetPagination();
    $countSql = 'SELECT COUNT(*) FROM whatsapp_templates';
    $dataSql = 'SELECT * FROM whatsapp_templates ORDER BY category ASC, name ASC';

    [$items, $total] = apiFetchPaginated($db, $countSql, $dataSql, [], $pagination);
    apiPaginatedSuccess($items, $total, $pagination);
}

function getTemplate(PDO $db, int $id): void
{
    $stmt = $db->prepare("SELECT * FROM whatsapp_templates WHERE id = :id");
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    if (!$row) apiError('Template non trovato.', 404);
    apiSuccess($row);
}

function createTemplate(PDO $db): void
{
    $validated = validateTemplateInput(apiGetJsonBody());
    $stmt = $db->prepare(
        "INSERT INTO whatsapp_templates (name, category, body, variables)
         VALUES (:name, :category, :body, :variables)"
    );
    $stmt->execute($validated);
    getTemplate($db, (int) $db->lastInsertId());
}

function updateTemplate(PDO $db, int $id): void
{
    if (!templateExists($db, $id)) apiError('Template non trovato.', 404);
    $validated = validateTemplateInput(apiGetJsonBody());
    $stmt = $db->prepare(
        "UPDATE whatsapp_templates SET name = :name, category = :category,
             body = :body, variables = :variables WHERE id = :id"
    );
    $stmt->execute(array_merge($validated, ['id' => $id]));
    getTemplate($db, $id);
}

function deleteTemplate(PDO $db, int $id): void
{
    if (!templateExists($db, $id)) apiError('Template non trovato.', 404);
    $db->prepare("DELETE FROM whatsapp_templates WHERE id = :id")->execute(['id' => $id]);
    apiSuccess(['id' => $id, 'message' => 'Template eliminato.']);
}

function validateTemplateInput(array $data): array
{
    $name     = trim($data['name'] ?? '');
    $category = trim($data['category'] ?? 'generico');
    $body     = trim($data['body'] ?? '');

    if ($name === '') apiError('Il nome è obbligatorio.');
    if ($body === '') apiError('Il testo del template è obbligatorio.');
    if (!in_array($category, WA_TEMPLATE_CATEGORIES, true)) apiError('Categoria non valida.');

    // Derive variables from the body ({{var}}) unless explicitly provided.
    $variables = $data['variables'] ?? null;
    if (is_array($variables)) {
        $variables = json_encode(array_values($variables), JSON_UNESCAPED_UNICODE);
    } elseif (!is_string($variables) || $variables === '') {
        preg_match_all('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', $body, $m);
        $variables = json_encode(array_values(array_unique($m[1])), JSON_UNESCAPED_UNICODE);
    }

    return [
        'name'      => $name,
        'category'  => $category,
        'body'      => $body,
        'variables' => $variables,
    ];
}

function templateExists(PDO $db, int $id): bool
{
    $stmt = $db->prepare("SELECT id FROM whatsapp_templates WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return (bool) $stmt->fetch();
}

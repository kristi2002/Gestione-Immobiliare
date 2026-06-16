<?php
/**
 * Email templates CRUD — admin/super_admin only.
 */
require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();
requireRole('admin', 'super_admin');

$method = $_SERVER['REQUEST_METHOD'];
$id     = isset($_GET['id']) ? (int) $_GET['id'] : null;

$VALID_CATEGORIES = ['benvenuto', 'scadenza_contratto', 'scadenza_affitto', 'promemoria', 'richiesta_documento', 'generico'];

try {
    $db = getDB();

    if ($method === 'GET') {
        $id ? getTemplate($db, $id) : listTemplates($db);
    } elseif ($method === 'POST') {
        requireWriteAccess();
        createTemplate($db, $VALID_CATEGORIES);
    } elseif ($method === 'PUT' && $id) {
        requireWriteAccess();
        updateTemplate($db, $id, $VALID_CATEGORIES);
    } elseif ($method === 'DELETE' && $id) {
        requireWriteAccess();
        deleteTemplate($db, $id);
    } else {
        apiError('Metodo non consentito.', 405);
    }
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

function listTemplates(PDO $db): void
{
    $pagination = apiGetPagination(50, 200);
    $category   = $_GET['category'] ?? '';
    $active     = $_GET['active'] ?? '';

    $where  = [];
    $params = [];

    if ($category !== '') {
        $where[]              = 'category = :cat';
        $params['cat']        = $category;
    }
    if ($active !== '') {
        $where[]              = 'is_active = :active';
        $params['active']     = $active ? 1 : 0;
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    [$items, $total] = apiFetchPaginated(
        $db,
        "SELECT COUNT(*) FROM email_templates $whereClause",
        "SELECT * FROM email_templates $whereClause ORDER BY category, name",
        $params,
        $pagination
    );

    apiPaginatedSuccess($items, $total, $pagination);
}

function getTemplate(PDO $db, int $id): void
{
    $stmt = $db->prepare('SELECT * FROM email_templates WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $tpl = $stmt->fetch();
    if (!$tpl) apiError('Template non trovato.', 404);
    apiSuccess($tpl);
}

function createTemplate(PDO $db, array $validCats): void
{
    $data     = apiGetJsonBody();
    $name     = trim($data['name'] ?? '');
    $category = $data['category'] ?? 'generico';
    $subject  = trim($data['subject'] ?? '');
    $body     = trim($data['body'] ?? '');

    if (!$name || !$subject || !$body) {
        apiError('Nome, oggetto e testo sono obbligatori.');
    }
    if (!in_array($category, $validCats, true)) {
        apiError('Categoria non valida.');
    }

    $stmt = $db->prepare(
        'INSERT INTO email_templates (name, category, subject, body, variables, is_active)
         VALUES (:n, :cat, :subj, :body, :vars, :active)'
    );
    $stmt->execute([
        'n'      => $name,
        'cat'    => $category,
        'subj'   => $subject,
        'body'   => $body,
        'vars'   => trim($data['variables'] ?? '') ?: null,
        'active' => isset($data['is_active']) ? (int)(bool)$data['is_active'] : 1,
    ]);

    getTemplate($db, (int) $db->lastInsertId());
}

function updateTemplate(PDO $db, int $id, array $validCats): void
{
    $stmt = $db->prepare('SELECT id FROM email_templates WHERE id = :id');
    $stmt->execute(['id' => $id]);
    if (!$stmt->fetch()) apiError('Template non trovato.', 404);

    $data   = apiGetJsonBody();
    $fields = [];
    $params = ['id' => $id];

    if (isset($data['name']))      { $fields[] = 'name = :name';        $params['name']      = trim($data['name']); }
    if (isset($data['category']) && in_array($data['category'], $validCats, true)) {
                                     $fields[] = 'category = :cat';     $params['cat']       = $data['category']; }
    if (isset($data['subject']))   { $fields[] = 'subject = :subj';     $params['subj']      = trim($data['subject']); }
    if (isset($data['body']))      { $fields[] = 'body = :body';         $params['body']      = trim($data['body']); }
    if (isset($data['variables'])) { $fields[] = 'variables = :vars';   $params['vars']      = trim($data['variables']) ?: null; }
    if (isset($data['is_active'])) { $fields[] = 'is_active = :active'; $params['active']    = (int)(bool)$data['is_active']; }

    if (!$fields) apiError('Nessun campo da aggiornare.');

    $db->prepare('UPDATE email_templates SET ' . implode(', ', $fields) . ' WHERE id = :id')->execute($params);
    getTemplate($db, $id);
}

function deleteTemplate(PDO $db, int $id): void
{
    $stmt = $db->prepare('DELETE FROM email_templates WHERE id = :id');
    $stmt->execute(['id' => $id]);
    apiSuccess(['deleted' => true]);
}

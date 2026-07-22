<?php
/**
 * Documenti allegabili — alimenta la sezione "Allega documenti" della modal
 * Invia messaggio (pagina Proprietari).
 *
 * GET /api/get_attachable_documents.php?client_id={id}&property_id={id|0}&categories=D,F,C,P
 *
 *   - client_id   obbligatorio: il proprietario destinatario del messaggio.
 *   - property_id 0 (o assente) = documenti collegati direttamente al
 *                 proprietario (senza immobile); altrimenti l'immobile DEVE
 *                 appartenere al proprietario indicato (verifica server-side,
 *                 mai fidarsi del frontend).
 *   - categories  lettere D,F,C,P separate da virgola (default: tutte).
 *
 * Risposta normalizzata (i file vivono tutti nella tabella `documents`):
 *   [{id, tipo: 'D'|'F'|'C'|'P', doc_type, nome_file, dimensione, created_at}]
 */

require_once __DIR__ . '/../config/api_bootstrap.php';

apiHandleOptions();

// Mappa categoria (lettera UI) → valori doc_type nella tabella documents.
const CATEGORY_DOC_TYPES = [
    'D' => ['other', 'id', 'id_front', 'id_back'],
    'F' => ['invoice'],
    'C' => ['contract'],
    'P' => ['preventivo'],
];

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    apiError('Metodo non consentito.', 405);
}

$clientId   = isset($_GET['client_id']) ? (int) $_GET['client_id'] : 0;
$propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : 0;

if ($clientId <= 0) {
    apiError('client_id obbligatorio.');
}

// Categorie richieste → lista doc_type. Lettere sconosciute vengono ignorate.
$rawCats  = strtoupper(trim($_GET['categories'] ?? ''));
$letters  = $rawCats === '' ? array_keys(CATEGORY_DOC_TYPES) : array_filter(array_map('trim', explode(',', $rawCats)));
$docTypes = [];
foreach ($letters as $letter) {
    foreach (CATEGORY_DOC_TYPES[$letter] ?? [] as $t) {
        $docTypes[$t] = $letter; // doc_type → lettera, per normalizzare la risposta
    }
}
if (!$docTypes) {
    apiSuccess(['items' => []]); // nessuna categoria attiva → lista vuota
}

try {
    $db = getDB();

    $stmt = $db->prepare("SELECT id FROM clients WHERE id = :id");
    $stmt->execute(['id' => $clientId]);
    if (!$stmt->fetch()) {
        apiError('Proprietario non trovato.', 404);
    }

    $params = [];
    if ($propertyId > 0) {
        // L'immobile deve essere collegato al proprietario destinatario.
        $own = $db->prepare("SELECT id FROM properties WHERE id = :pid AND client_id = :cid");
        $own->execute(['pid' => $propertyId, 'cid' => $clientId]);
        if (!$own->fetch()) {
            apiError('Immobile non collegato a questo proprietario.', 403);
        }
        $where = 'd.property_id = :pid';
        $params['pid'] = $propertyId;
    } else {
        // Documenti del proprietario non legati a un immobile specifico.
        $where = 'd.client_id = :cid AND d.property_id IS NULL';
        $params['cid'] = $clientId;
    }

    // IN (...) con placeholder posizionali per i doc_type richiesti.
    $typeList = array_keys($docTypes);
    $inFrag   = implode(',', array_fill(0, count($typeList), '?'));

    $sql = "SELECT d.id, d.doc_type, d.title, d.original_name, d.file_size, d.created_at
              FROM documents d
             WHERE {$where} AND d.doc_type IN ({$inFrag})
             ORDER BY d.created_at DESC
             LIMIT 200";

    // PDO non mescola placeholder nominali e posizionali: converto i nominali.
    $positional = [];
    $sql = preg_replace_callback('/:(\w+)/', function ($m) use ($params, &$positional) {
        $positional[] = $params[$m[1]];
        return '?';
    }, $sql);

    $stmt = $db->prepare($sql);
    $stmt->execute(array_merge($positional, $typeList));

    $items = [];
    foreach ($stmt->fetchAll() as $row) {
        $items[] = [
            'id'         => (int) $row['id'],
            'tipo'       => $docTypes[$row['doc_type']] ?? 'D',
            'doc_type'   => $row['doc_type'],
            'nome_file'  => $row['title'] ?: $row['original_name'],
            'dimensione' => $row['file_size'] !== null ? (int) $row['file_size'] : null,
            'created_at' => $row['created_at'],
        ];
    }

    apiSuccess(['items' => $items]);
} catch (PDOException $e) {
    apiError('Errore database.', 500);
}

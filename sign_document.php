<?php
/**
 * Il documento che si sta per firmare — pagina pubblica, nessuna sessione.
 * GET /sign_document.php?token=XXXXXX
 *
 * L'autorizzazione E' il token della richiesta di firma, esattamente come per
 * unsubscribe.php: chi ha ricevuto il link ha diritto di vedere cosa gli si
 * chiede di firmare. Senza questo endpoint sign.php mostrava solo il nome del
 * firmatario e un consenso che dichiarava "di aver letto" un documento che non
 * era in nessun punto della pagina.
 *
 * Un link scaduto non mostra piu' nulla; un link gia' firmato si', perche' chi
 * ha firmato deve poter rivedere cosa ha firmato.
 */
require_once __DIR__ . '/config/db.php';

$token = trim($_GET['token'] ?? '');
if ($token === '') {
    http_response_code(400);
    exit('Token mancante.');
}

/**
 * Tipi che si possono mostrare DENTRO la pagina senza trasformare un allegato
 * in codice sul nostro dominio: un .html o un .svg serviti inline sarebbero
 * XSS immagazzinata contro chi apre il link. Tutto il resto si scarica.
 */
const SIGN_INLINE_MIMES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
];

try {
    $db   = getDB();
    $stmt = $db->prepare(
        'SELECT er.id, er.document_id, er.status, er.expires_at, er.signer_email,
                d.original_name, d.file_path, d.mime_type
           FROM esign_requests er
           LEFT JOIN documents d ON d.id = er.document_id
          WHERE er.token = :token
          LIMIT 1'
    );
    $stmt->execute(['token' => $token]);
    $req = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$req) {
        http_response_code(404);
        exit('Link non valido.');
    }
    if ($req['status'] === 'expired' || strtotime($req['expires_at']) < time()) {
        http_response_code(410);
        exit('Questo link di firma è scaduto.');
    }
    if (empty($req['document_id']) || empty($req['file_path'])) {
        http_response_code(404);
        exit('Nessun documento allegato a questa richiesta.');
    }

    // Containment guard: il percorso salvato deve risolvere dentro uploads/.
    require_once __DIR__ . '/config/upload_guard.php';
    $fullPath = safeUploadRealPath((string) $req['file_path']);
    if ($fullPath === null) {
        http_response_code(404);
        exit('File non trovato sul server.');
    }

    // Tracciamento accessi GDPR: chi apre il documento, e quando.
    require_once __DIR__ . '/config/gdpr.php';
    if (function_exists('logDataAccess')) {
        // actor_type e' un enum ('admin','owner','tenant','system'): il
        // firmatario non e' un utente dei portali, quindi va in 'system' con
        // l'identita' nell'etichetta. Passare 'signer' faceva fallire in
        // silenzio la scrittura del registro (1265 Data truncated).
        logDataAccess(
            'view', null, null, 'system', null,
            'firma richiesta #' . (int) $req['id'] . ' — ' . (string) $req['signer_email'],
            'document', (int) $req['document_id'], (string) $req['original_name']
        );
    }

    $mime       = $req['mime_type'] ?: 'application/octet-stream';
    $canInline  = in_array($mime, SIGN_INLINE_MIMES, true);
    $filename   = str_replace(['"', '\\', "\r", "\n"], '', (string) $req['original_name']);
    $disposition = $canInline ? 'inline' : 'attachment';

    header('Content-Type: ' . ($canInline ? $mime : 'application/octet-stream'));
    header('Content-Disposition: ' . $disposition . '; filename="' . $filename . '"; filename*=UTF-8\'\'' . rawurlencode((string) $req['original_name']));
    header('Content-Length: ' . filesize($fullPath));
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; object-src 'none'; sandbox");
    header('Referrer-Policy: no-referrer');
    header('Cache-Control: private, no-store');

    readfile($fullPath);
    exit;

} catch (PDOException) {
    http_response_code(500);
    exit('Errore server.');
}

<?php
/**
 * Shared helpers for JSON API endpoints.
 */

function apiHeaders(): void
{
    header('Content-Type: application/json; charset=utf-8');

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (APP_URL !== '' && $origin !== '') {
        $appOrigin = parse_url(APP_URL, PHP_URL_SCHEME) . '://' . parse_url(APP_URL, PHP_URL_HOST);
        $appPort   = parse_url(APP_URL, PHP_URL_PORT);
        if ($appPort) {
            $appOrigin .= ':' . $appPort;
        }
        if ($origin === $appOrigin) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
        }
    }

    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Cron-Secret, X-CSRF-Token');
}

function apiHandleOptions(): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        apiHeaders();
        http_response_code(204);
        exit;
    }
}

function apiDiscardBufferedOutput(): void
{
    // Drop any stray output (PHP warnings/notices) captured before the JSON body.
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
}

function apiSuccess(mixed $data = null, int $code = 200): void
{
    apiDiscardBufferedOutput();
    apiHeaders();
    http_response_code($code);
    echo json_encode([
        'success' => true,
        'data'    => $data,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Build a word-by-word search SQL fragment (AND of ORs).
 * Each word must appear in at least one of the given columns.
 * Every column×word pair gets its own unique named parameter (ws_i_j)
 * so the query is safe even with PDO::ATTR_EMULATE_PREPARES => true.
 * Appends named params to $params.  Returns '' when $search is blank.
 *
 * @param string   $prefix  Optional prefix to namespace params (avoids
 *                          clashes when called twice for the same query).
 */
function apiWordSearch(string $search, array $columns, array &$params, string $prefix = 'ws'): string
{
    $search = trim($search);
    if ($search === '' || empty($columns)) return '';

    $words   = array_values(array_filter(preg_split('/\s+/u', $search)));
    $clauses = [];

    foreach ($words as $i => $word) {
        $colParts = [];
        foreach ($columns as $j => $col) {
            $key        = $prefix . '_' . $i . '_' . $j;
            $colParts[] = "$col LIKE :$key";
            $params[$key] = '%' . $word . '%';
        }
        $clauses[] = '(' . implode(' OR ', $colParts) . ')';
    }

    return implode(' AND ', $clauses);
}

/**
 * @param array<string,mixed> $extra chiavi aggiuntive accanto a success/error —
 *        per gli errori in cui qualcosa e' comunque stato salvato e la pagina
 *        deve poterlo ritrovare (es. una comunicazione registrata come 'failed').
 *        `success` ed `error` non sono sovrascrivibili.
 */
function apiError(string $message, int $code = 400, array $extra = []): void
{
    apiDiscardBufferedOutput();
    apiHeaders();
    http_response_code($code);
    echo json_encode(array_merge($extra, [
        'success' => false,
        'error'   => $message,
    ]), JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Traduce un errore del database in una frase che dice cosa correggere.
 *
 * «Errore database.» e' cio' che l'agente vedeva salvando un codice fiscale di
 * diciassette caratteri: il vincolo funziona (MySQL e' in STRICT_TRANS_TABLES,
 * verificato in locale e in produzione, quindi il valore viene RIFIUTATO e non
 * troncato in silenzio — che sarebbe stato molto peggio) ma il messaggio non
 * dice quale campo, e chi sta compilando non ha modo di indovinarlo.
 *
 * Si mappano solo gli errori che nascono da cio' che l'utente ha scritto. Tutto
 * il resto resta generico E finisce nel log: un messaggio di MySQL grezzo in
 * faccia a chi usa l'applicazione racconta nomi di tabelle e di vincoli, che
 * non e' informazione utile per lui ed e' informazione di troppo per chiunque
 * altro stia guardando.
 *
 * @param string $context frase iniziale, es. "Impossibile salvare il proprietario"
 */
function apiDbError(PDOException $e, string $context = 'Operazione non completata'): void
{
    [$message, $status, $mapped] = apiDbErrorMessage(
        $e->getMessage(),
        (string) $e->getCode(),
        $context
    );

    // Quello che non si sa tradurre finisce nel log: e' l'unico posto dove il
    // messaggio grezzo di MySQL serve a qualcuno.
    if (!$mapped) {
        error_log('[db] ' . $context . ': ' . $e->getMessage());
    }

    apiError($message, $status);
}

/**
 * La sola traduzione, senza effetti: cosi' si puo' provare.
 *
 * `apiDbError()` finisce in `apiError()`, che scrive e fa `exit` — non
 * verificabile in un test. La regola vive qui, il contorno la' sopra: e' la
 * stessa ragione per cui il conto delle migrazioni e' stato tolto dalla sonda
 * (lib/schema_drift.php) e il parser dei numeri dalla closure di parseOmiCsv().
 *
 * @return array{0:string, 1:int, 2:bool} messaggio, stato HTTP, e se e' stato
 *         riconosciuto (falso = generico, da mettere nel log)
 */
function apiDbErrorMessage(string $msg, string $code, string $context): array
{
    // 22001 / 1406 / 1265: il valore non entra nella colonna. Il nome della
    // colonna sta nel messaggio di MySQL fra apici — e' l'unica cosa che serve.
    if ($code === '22001' || str_contains($msg, '1406') || str_contains($msg, '1265')) {
        $field = preg_match("/column '([^']+)'/i", $msg, $m) ? $m[1] : null;
        return [
            $context . ': il valore'
                . ($field ? " di «{$field}»" : '')
                . ' è troppo lungo per questo campo. Accorcialo e riprova.',
            422, true,
        ];
    }

    // 1062: violazione di un vincolo di unicita'.
    if (str_contains($msg, '1062')) {
        $field = preg_match("/for key '([^']+)'/i", $msg, $m) ? $m[1] : null;
        return [
            $context . ': esiste già un record con questo valore'
                . ($field && !str_contains($field, 'PRIMARY') ? " (vincolo {$field})" : '')
                . '.',
            409, true,
        ];
    }

    // 1452: la riga a cui si punta non esiste (cancellata mentre si compilava).
    if (str_contains($msg, '1452')) {
        return [
            $context . ': un riferimento collegato non esiste (potrebbe essere '
                . 'stato eliminato mentre compilavi). Ricarica la pagina e riprova.',
            409, true,
        ];
    }

    // 1451: la riga e' usata da altre righe e non si puo' togliere.
    if (str_contains($msg, '1451')) {
        return [
            $context . ': il record è collegato ad altri dati e non può essere '
                . 'eliminato. Disattivalo, oppure rimuovi prima i collegamenti.',
            409, true,
        ];
    }

    return ['Errore database.', 500, false];
}

/**
 * Errore di validazione con il dettaglio per campo, così la pagina può marcare
 * l'input sbagliato invece di mostrare un solo messaggio generico in cima.
 *
 * @param array<string,string> $fields nome campo => messaggio
 */
function apiValidationError(array $fields, string $message = 'Controlla i campi evidenziati.'): void
{
    apiDiscardBufferedOutput();
    apiHeaders();
    http_response_code(422);
    echo json_encode([
        'success' => false,
        'error'   => $message,
        'fields'  => $fields,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function apiGetJsonBody(): array
{
    static $cached = null;

    if ($cached !== null) {
        return $cached;
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        $cached = [];
        return $cached;
    }

    $data = json_decode($raw, true);
    $cached = is_array($data) ? $data : [];
    return $cached;
}

function apiRequireMethod(string ...$methods): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'], $methods, true)) {
        apiError('Metodo non consentito.', 405);
    }
}

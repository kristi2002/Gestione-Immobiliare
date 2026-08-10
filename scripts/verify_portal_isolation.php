<?php
/**
 * Isolamento fra portali — la verifica piu' importante dell'applicazione.
 *
 * CLAUDE.md §4.1 la mette al primo posto per raggio d'azione: una fuga qui non
 * e' un bug, e' un incidente GDPR con i dati di clienti veri. E per mesi non e'
 * stata eseguita per un motivo banale — nel database non esisteva NESSUN utente
 * di portale, quindi non c'era un "account B" con cui provare a rubare.
 *
 * Questo script si provvede da solo gli account: crea due inquilini su immobili
 * e proprietari diversi, due proprietari con accesso al portale, un documento
 * per parte, poi prova sistematicamente a leggere i dati dell'altro. Alla fine
 * rimuove tutto e verifica di averlo rimosso.
 *
 * Uso:
 *   php scripts/verify_portal_isolation.php [http://127.0.0.1:8099]
 *
 * Esce con codice 1 se una sola prova fallisce, cosi' puo' stare in CI.
 *
 * Nota: il server interno di PHP non legge .htaccess. Le regole Apache
 * (accesso diretto a uploads/, views/, config/) NON sono coperte qui e vanno
 * provate sull'host vero — lo script lo dice anche in coda.
 */

$root = dirname(__DIR__);
require_once $root . '/config/bootstrap.php';
require_once $root . '/config/db.php';
require_once $root . '/config/password.php';

$BASE   = rtrim($argv[1] ?? 'http://127.0.0.1:8099', '/');
$MARKER = 'ZZISO';

$db = getDB();

// ---------------------------------------------------------------------------
// HTTP minimale con barattolo dei cookie per sessione
// ---------------------------------------------------------------------------

$jars = [];

function http(string $method, string $url, array $opt = []): array
{
    global $jars;
    $jar = $opt['jar'] ?? null;
    if ($jar !== null && !isset($jars[$jar])) {
        $jars[$jar] = tempnam(sys_get_temp_dir(), 'iso');
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CUSTOMREQUEST  => $method,
        // Serve la Location: un 302 verso login.php e' un rifiuto corretto, un
        // 302 verso altro no. Senza leggerla, le due cose sono indistinguibili.
        CURLOPT_HEADER         => true,
    ]);
    if ($jar !== null) {
        curl_setopt($ch, CURLOPT_COOKIEJAR, $jars[$jar]);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $jars[$jar]);
    }
    if (isset($opt['form'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($opt['form']));
    }
    if (isset($opt['json'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($opt['json']));
        $opt['headers'][] = 'Content-Type: application/json';
    }
    if (!empty($opt['headers'])) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $opt['headers']);
    }

    $raw  = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hlen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);

    $headers = substr($raw, 0, $hlen);
    $body    = substr($raw, $hlen);

    preg_match('/^Location:\s*(.+)$/mi', $headers, $m);

    return [
        'code'     => $code,
        'body'     => $body,
        'location' => isset($m[1]) ? trim($m[1]) : '',
    ];
}

// ---------------------------------------------------------------------------
// Esito delle prove
// ---------------------------------------------------------------------------

$results = [];

/**
 * @param callable():array $probe  deve restituire ['code'=>int,'body'=>string]
 * @param callable(array):bool $ok giudica se il rifiuto e' avvenuto
 */
function probe(string $group, string $what, string $expected, callable $call, callable $ok): void
{
    global $results;
    $res = $call();
    $results[] = [
        'group'    => $group,
        'what'     => $what,
        'expected' => $expected,
        'actual'   => $res['code'] . ' ' . trim(mb_substr(preg_replace('/\s+/', ' ', $res['body']), 0, 70)),
        'pass'     => $ok($res),
    ];
}

/** Rifiuto accettabile: 401, 403 o 404 (il 404 e' voluto, non rivela l'esistenza). */
function denied(array $res): bool
{
    return in_array($res['code'], [401, 403, 404], true);
}

/**
 * Le pagine web (non le API) rifiutano rimandando al login, non con un 401:
 * `requireAuthWeb()` fa `Location: login.php`. Il 302 va quindi accettato, ma
 * SOLO verso il login — e con un corpo vuoto. Un 302 verso altro, o un 200 con
 * dentro la vista, sono due difetti diversi che senza questo controllo si
 * leggerebbero entrambi come "rifiutato".
 */
function deniedOrLoginRedirect(array $res): bool
{
    if (denied($res)) return true;
    if (!in_array($res['code'], [301, 302], true)) return false;

    return (bool) preg_match('#(^|/)login\.php#', $res['location']);
}

/** Una risposta JSON di errore conta come rifiuto anche con codice 200. */
function deniedOrJsonError(array $res): bool
{
    if (denied($res)) return true;
    $j = json_decode($res['body'], true);
    return is_array($j) && isset($j['success']) && $j['success'] === false;
}

// ---------------------------------------------------------------------------
// Pulizia
//
// Sta qui, PRIMA delle fixture, e non solo in coda: una corsa interrotta a
// metà (una colonna sbagliata, il server che non risponde) lascia dietro
// l'inquilino A, e alla corsa dopo l'indice unico sull'email lo rifiuta —
// lo script diventa ineseguibile proprio quando serve rieseguirlo.
// ---------------------------------------------------------------------------

function purge(PDO $db, string $marker): int
{
    $stmts = [
        "DELETE FROM documents WHERE title LIKE '$marker%'",
        "DELETE FROM payments WHERE contract_id IN (SELECT id FROM (SELECT id FROM contracts WHERE title LIKE '$marker%') x)",
        "DELETE FROM contracts WHERE title LIKE '$marker%'",
        "DELETE FROM tenant_users WHERE tenant_id IN (SELECT id FROM (SELECT id FROM tenants WHERE name LIKE '$marker%') x)",
        "DELETE FROM tenants WHERE name LIKE '$marker%'",
        "DELETE FROM properties WHERE address LIKE 'Via $marker%'",
        "DELETE FROM clients WHERE name LIKE '$marker%'",
    ];
    foreach ($stmts as $sql) {
        try { $db->exec($sql); } catch (Throwable $e) { fwrite(STDERR, 'Pulizia: ' . $e->getMessage() . "\n"); }
    }

    $left = 0;
    foreach ([
        "SELECT COUNT(*) FROM clients WHERE name LIKE '$marker%'",
        "SELECT COUNT(*) FROM tenants WHERE name LIKE '$marker%'",
        "SELECT COUNT(*) FROM properties WHERE address LIKE 'Via $marker%'",
        "SELECT COUNT(*) FROM contracts WHERE title LIKE '$marker%'",
        "SELECT COUNT(*) FROM documents WHERE title LIKE '$marker%'",
    ] as $q) {
        $left += (int) $db->query($q)->fetchColumn();
    }
    return $left;
}

// ---------------------------------------------------------------------------
// Fixture: due inquilini su immobili di proprietari diversi, due proprietari
// ---------------------------------------------------------------------------

echo "Provisioning…\n";
purge($db, $MARKER); // residui di una corsa interrotta

// Il file che i documenti di prova puntano. Lo crea lo script per essere
// autosufficiente: senza, `safeUploadRealPath()` non trova nulla e ogni prova
// risponderebbe 404 — cioe' l'isolamento sembrerebbe perfetto senza essere
// stato messo alla prova nemmeno una volta.
$placeholderRel = 'uploads/documents/zziso-placeholder.txt';
$placeholderAbs = $root . '/' . $placeholderRel;
if (!is_dir(dirname($placeholderAbs))) {
    @mkdir(dirname($placeholderAbs), 0755, true);
}
file_put_contents($placeholderAbs, "ZZISO placeholder\n");

$pwd     = $MARKER . 'pw!9Q';
$pwdHash = password_hash($pwd, PASSWORD_DEFAULT);

/** Crea proprietario + immobile + inquilino + contratto + un documento. */
function makeSide(PDO $db, string $tag, string $pwdHash, string $marker): array
{
    $db->prepare(
        "INSERT INTO clients (name, surname, email, portal_email, portal_password_hash, status, created_at)
         VALUES (:n, 'Isolamento', :em, :pem, :ph, 'active', NOW())"
    )->execute([
        'n'   => $marker . $tag,
        'em'  => strtolower($marker . $tag) . '.owner@example.test',
        'pem' => strtolower($marker . $tag) . '.owner@example.test',
        'ph'  => $pwdHash,
    ]);
    $clientId = (int) $db->lastInsertId();

    // `properties` non ha una colonna `title`: l'annuncio si chiama
    // `listing_title` e il marcatore per la pulizia va sull'indirizzo.
    $db->prepare(
        "INSERT INTO properties (client_id, listing_title, address, city, status, created_at)
         VALUES (:c, :t, :a, 'Civitanova Marche', 'rented', NOW())"
    )->execute([
        'c' => $clientId,
        't' => $marker . $tag . ' Immobile',
        'a' => 'Via ' . $marker . $tag . ' 1',
    ]);
    $propertyId = (int) $db->lastInsertId();

    $db->prepare(
        "INSERT INTO tenants (name, surname, email, status, created_at)
         VALUES (:n, 'Isolamento', :em, 'active', NOW())"
    )->execute([
        'n'  => $marker . $tag,
        'em' => strtolower($marker . $tag) . '.tenant@example.test',
    ]);
    $tenantId = (int) $db->lastInsertId();

    $db->prepare('INSERT INTO tenant_users (tenant_id, password_hash, created_at) VALUES (:t, :h, NOW())')
       ->execute(['t' => $tenantId, 'h' => $pwdHash]);

    $db->prepare(
        "INSERT INTO contracts (property_id, tenant_id, client_id, title, contract_type, status,
                                start_date, end_date, monthly_rent, created_at)
         VALUES (:p, :t, :c, :ti, 'locazione', 'signed', '2026-01-01', '2030-01-01', 500, NOW())"
    )->execute([
        'p' => $propertyId, 't' => $tenantId, 'c' => $clientId,
        'ti' => $marker . $tag . ' Locazione',
    ]);
    $contractId = (int) $db->lastInsertId();

    // Tre documenti, uno per ogni perimetro che il portale distingue.
    $mk = function (string $kind, ?int $prop, ?int $contract, ?int $client, string $type) use ($db, $marker, $tag) {
        $db->prepare(
            "INSERT INTO documents (property_id, contract_id, client_id, doc_type, title, file_path,
                                    original_name, mime_type, file_size, created_at)
             VALUES (:p, :ct, :cl, :dt, :ti, 'uploads/documents/zziso-placeholder.txt',
                     :orig, 'text/plain', 12, NOW())"
        )->execute([
            'p' => $prop, 'ct' => $contract, 'cl' => $client, 'dt' => $type,
            'ti' => $marker . $tag . ' ' . $kind,
            'orig' => $marker . $tag . '-' . $kind . '.txt',
        ]);
        return (int) $db->lastInsertId();
    };

    return [
        'tag'         => $tag,
        'client_id'   => $clientId,
        'property_id' => $propertyId,
        'tenant_id'   => $tenantId,
        'contract_id' => $contractId,
        'tenant_email' => strtolower($marker . $tag) . '.tenant@example.test',
        'owner_email'  => strtolower($marker . $tag) . '.owner@example.test',
        // planimetria sull'immobile: tipo VISIBILE all'inquilino di quell'immobile
        'doc_property' => $mk('planimetria', $propertyId, null, null, 'planimetria'),
        // documento del contratto: visibile solo all'inquilino di QUEL contratto
        'doc_contract' => $mk('contratto', null, $contractId, null, 'contract'),
        // carta d'identita' del PROPRIETARIO: nessun inquilino deve vederla
        'doc_owner'    => $mk('identita', null, null, $clientId, 'id'),
    ];
}

$A = makeSide($db, 'A', $pwdHash, $MARKER);
$B = makeSide($db, 'B', $pwdHash, $MARKER);

printf("  A: proprietario #%d immobile #%d inquilino #%d contratto #%d\n", $A['client_id'], $A['property_id'], $A['tenant_id'], $A['contract_id']);
printf("  B: proprietario #%d immobile #%d inquilino #%d contratto #%d\n", $B['client_id'], $B['property_id'], $B['tenant_id'], $B['contract_id']);

// ---------------------------------------------------------------------------
// Accessi
// ---------------------------------------------------------------------------

echo "Login…\n";

$loginTenantA = http('POST', "$BASE/tenant/login.php", ['jar' => 'tA', 'form' => ['email' => $A['tenant_email'], 'password' => $pwd]]);
$loginOwnerA  = http('POST', "$BASE/owner/login.php",  ['jar' => 'oA', 'form' => ['email' => $A['owner_email'],  'password' => $pwd]]);

// Un login fallito rende insensata ogni prova successiva: meglio fermarsi.
foreach ([['inquilino A', $loginTenantA], ['proprietario A', $loginOwnerA]] as [$who, $res]) {
    if ($res['code'] !== 302 && $res['code'] !== 200) {
        fwrite(STDERR, "Login $who non riuscito (HTTP {$res['code']}). Il server risponde su $BASE?\n");
        exit(2);
    }
}

// Prova che la sessione sia davvero attiva: senza questo, un 401 su ogni
// richiesta sembrerebbe un isolamento perfetto mentre e' solo un login rotto.
$sanityT = http('GET', "$BASE/api/download_document.php?id=" . $A['doc_property'], ['jar' => 'tA']);
$sanityO = http('GET', "$BASE/api/download_document.php?id=" . $A['doc_owner'], ['jar' => 'oA']);

$results[] = ['group' => 'Controprova', 'what' => 'inquilino A legge la planimetria del PROPRIO immobile',
              'expected' => '200', 'actual' => $sanityT['code'] . '', 'pass' => $sanityT['code'] === 200];
$results[] = ['group' => 'Controprova', 'what' => 'proprietario A legge un PROPRIO documento',
              'expected' => '200', 'actual' => $sanityO['code'] . '', 'pass' => $sanityO['code'] === 200];

// Il ramo "documento del PROPRIO contratto" ha una storia: dipende dalla chiave
// `contract_id` restituita da getTenantCurrentContract(), e se quel nome
// cambiasse il perimetro si stringerebbe in silenzio — l'inquilino non
// scaricherebbe piu' il proprio contratto e nessun test lo direbbe.
$sanityC = http('GET', "$BASE/api/download_document.php?id=" . $A['doc_contract'], ['jar' => 'tA']);
$results[] = ['group' => 'Controprova', 'what' => 'inquilino A legge il PROPRIO contratto',
              'expected' => '200', 'actual' => $sanityC['code'] . '', 'pass' => $sanityC['code'] === 200];

// ---------------------------------------------------------------------------
// 1. Inquilino A contro inquilino B
// ---------------------------------------------------------------------------

probe('Inquilino → inquilino', 'documento del contratto di B', '401/403/404',
    fn() => http('GET', "$BASE/api/download_document.php?id=" . $B['doc_contract'], ['jar' => 'tA']), 'denied');

probe('Inquilino → inquilino', 'planimetria dell\'immobile di B', '401/403/404',
    fn() => http('GET', "$BASE/api/download_document.php?id=" . $B['doc_property'], ['jar' => 'tA']), 'denied');

probe('Inquilino → proprietario', 'carta d\'identita\' del PROPRIO locatore', '401/403/404',
    fn() => http('GET', "$BASE/api/download_document.php?id=" . $A['doc_owner'], ['jar' => 'tA']), 'denied');

probe('Inquilino → proprietario', 'carta d\'identita\' del locatore di B', '401/403/404',
    fn() => http('GET', "$BASE/api/download_document.php?id=" . $B['doc_owner'], ['jar' => 'tA']), 'denied');

probe('Inquilino → inquilino', 'allega una foto a una richiesta di B', '401/403/404',
    function () use ($BASE, $B) {
        return http('POST', "$BASE/tenant/api_upload.php", ['jar' => 'tA', 'form' => ['reminder_id' => 999999]]);
    }, 'deniedOrJsonError');

probe('Inquilino → inquilino', 'autolettura su un contatore dell\'immobile di B', '401/403/404',
    fn() => http('POST', "$BASE/tenant/api_portal_actions.php", [
        'jar' => 'tA',
        'json' => ['action' => 'reading', 'meter_id' => 999999, 'value' => 1234],
    ]), 'deniedOrJsonError');

// ---------------------------------------------------------------------------
// 2. Proprietario A contro proprietario B
// ---------------------------------------------------------------------------

probe('Proprietario → proprietario', 'documento personale di B', '401/403/404',
    fn() => http('GET', "$BASE/api/download_document.php?id=" . $B['doc_owner'], ['jar' => 'oA']), 'denied');

probe('Proprietario → proprietario', 'planimetria dell\'immobile di B', '401/403/404',
    fn() => http('GET', "$BASE/api/download_document.php?id=" . $B['doc_property'], ['jar' => 'oA']), 'denied');

probe('Proprietario → inquilino', 'documento del contratto dell\'inquilino di B', '401/403/404',
    fn() => http('GET', "$BASE/api/download_document.php?id=" . $B['doc_contract'], ['jar' => 'oA']), 'denied');

// ---------------------------------------------------------------------------
// 3. Attraversamento di privilegio: sessione portale → endpoint dell'agenzia
// ---------------------------------------------------------------------------

$adminEndpoints = [
    'api/clients.php', 'api/properties.php', 'api/contracts.php', 'api/payments.php',
    'api/documents.php', 'api/tenants.php', 'api/get_dashboard_stats.php',
    'api/settings.php', 'api/admin_users.php', 'api/activity_log.php',
];

foreach ($adminEndpoints as $ep) {
    probe('Inquilino → agenzia', $ep, '401/403',
        fn() => http('GET', "$BASE/$ep", ['jar' => 'tA']), 'deniedOrJsonError');
    probe('Proprietario → agenzia', $ep, '401/403',
        fn() => http('GET', "$BASE/$ep", ['jar' => 'oA']), 'deniedOrJsonError');
}

probe('Inquilino → agenzia', 'download_pdf.php (documenti generati)', '401/403/404',
    fn() => http('GET', "$BASE/api/download_pdf.php?id=1", ['jar' => 'tA']), 'denied');

// Le viste admin: si accetta il rimando al login, non il contenuto.
foreach (['clients', 'settings', 'activity_log', 'tenant_profile'] as $view) {
    probe('Inquilino → agenzia', "view.php?name=$view", 'login o 403',
        fn() => http('GET', "$BASE/view.php?name=$view", ['jar' => 'tA', 'headers' => ['X-App-Partial: 1']]),
        'deniedOrLoginRedirect');
    probe('Proprietario → agenzia', "view.php?name=$view", 'login o 403',
        fn() => http('GET', "$BASE/view.php?name=$view", ['jar' => 'oA', 'headers' => ['X-App-Partial: 1']]),
        'deniedOrLoginRedirect');
}

// E il guscio dell'applicazione dell'agenzia: se servisse la dashboard a una
// sessione di portale, tutto il resto non conterebbe piu' niente.
probe('Inquilino → agenzia', 'index.php (guscio admin)', 'login o 403',
    fn() => http('GET', "$BASE/index.php", ['jar' => 'tA']), 'deniedOrLoginRedirect');
probe('Proprietario → agenzia', 'index.php (guscio admin)', 'login o 403',
    fn() => http('GET', "$BASE/index.php", ['jar' => 'oA']), 'deniedOrLoginRedirect');

// ---------------------------------------------------------------------------
// 4. Senza cookie
// ---------------------------------------------------------------------------

foreach (['api/clients.php', 'api/get_dashboard_stats.php', 'api/download_document.php?id=' . $A['doc_property']] as $ep) {
    probe('Anonimo', $ep, '401/403/404', fn() => http('GET', "$BASE/$ep"), 'denied');
}

probe('Anonimo', 'tenant/index.php (portale inquilino)', 'redirect al login',
    fn() => http('GET', "$BASE/tenant/index.php"),
    fn($r) => in_array($r['code'], [301, 302, 401, 403], true));

probe('Anonimo', 'owner/index.php (portale proprietario)', 'redirect al login',
    fn() => http('GET', "$BASE/owner/index.php"),
    fn($r) => in_array($r['code'], [301, 302, 401, 403], true));

// ---------------------------------------------------------------------------
// Pulizia
// ---------------------------------------------------------------------------

echo "Pulizia…\n";

$residui = purge($db, $MARKER);

@unlink($placeholderAbs);
foreach ($jars as $f) { @unlink($f); }

// ---------------------------------------------------------------------------
// Referto
// ---------------------------------------------------------------------------

$failed = array_values(array_filter($results, fn($r) => !$r['pass']));

echo "\n";
echo str_repeat('=', 100), "\n";
printf("%-28s %-46s %-10s %s\n", 'AMBITO', 'PROVA', 'ATTESO', 'ESITO');
echo str_repeat('-', 100), "\n";

$lastGroup = null;
foreach ($results as $r) {
    printf("%-28s %-46s %-10s %s\n",
        $r['group'] === $lastGroup ? '' : $r['group'],
        mb_substr($r['what'], 0, 45),
        $r['expected'],
        ($r['pass'] ? 'PASS' : 'FAIL  <-- ') . ($r['pass'] ? '' : $r['actual'])
    );
    $lastGroup = $r['group'];
}

echo str_repeat('=', 100), "\n";
printf("%d prove, %d passate, %d fallite. Residui di prova: %d\n",
    count($results), count($results) - count($failed), count($failed), $residui);

echo "\nNON coperto da questo script: le regole Apache (.htaccess). Il server interno\n"
   . "di PHP le ignora, quindi l'accesso diretto a uploads/, views/ e config/ va\n"
   . "provato sull'host vero.\n";

exit(count($failed) === 0 && $residui === 0 ? 0 : 1);

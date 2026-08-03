<?php
/**
 * Portale Inquilino — "Password dimenticata", a richiesta dell'interessato.
 *
 * POST { email }
 *
 * Esisteva gia' `api/password_reset.php`, ma e' a innesco AMMINISTRATIVO: lo
 * chiama un agente dalla scheda dell'inquilino. Cioe' chi restava fuori doveva
 * telefonare in agenzia e aspettare che qualcuno fosse in ufficio. Questo
 * endpoint e' l'altra meta': lo chiama chi non riesce a entrare.
 *
 * DUE REGOLE, ed entrambe hanno un motivo preciso:
 *
 * 1. La risposta e' SEMPRE la stessa, che l'indirizzo esista o no. Un endpoint
 *    pubblico che risponde "utente non trovato" e' un modo per sapere chi e'
 *    inquilino dell'agenzia: si prova una lista di indirizzi e si legge la
 *    differenza. Con dati di locazione, quello e' gia' un fatto personale.
 *
 * 2. Il link NON torna mai nella risposta, nemmeno con la posta simulata.
 *    L'endpoint e' pubblico: restituire il token vorrebbe dire consegnare
 *    l'accesso a chiunque conosca l'indirizzo email. In sviluppo si legge dal
 *    log del server, non dalla rete.
 *
 * E c'e' una terza cosa, che la regola 1 da sola NON risolve: il TEMPO.
 * Con il corpo identico ma l'indirizzo esistente, questo endpoint impiegava
 * 2,1 secondi (il giro SMTP) contro 0,1 di un indirizzo sconosciuto. Venti
 * volte tanto: non un canale sottile da laboratorio, un oracolo che si legge
 * a occhio. Chi provava una lista di indirizzi otteneva comunque l'elenco
 * degli inquilini dell'agenzia, cronometro alla mano.
 *
 * Percio' ogni risposta esce non prima di FORGOT_MIN_SECONDS. E' una
 * mitigazione, non una garanzia: se un giorno l'SMTP fosse piu' lento della
 * soglia, la differenza tornerebbe a vedersi. La difesa vera resta il tetto
 * per IP qui sotto — la soglia serve a non regalare il dato a chi si limita
 * a guardare l'orologio.
 */

/** Sotto questo tempo nessuna risposta esce. Vedi la nota sul TEMPO. */
const FORGOT_MIN_SECONDS = 3.0;

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/../config/rate_limit.php';
require_once __DIR__ . '/../lib/password_reset.php';

initTenantSession();

header('Content-Type: application/json; charset=utf-8');

/** Momento in cui la richiesta e' entrata: serve a livellare i tempi di uscita. */
$forgotStartedAt = microtime(true);

/**
 * L'unica risposta possibile, comunque sia andata (regola 1), e mai prima di
 * FORGOT_MIN_SECONDS (la nota sul TEMPO).
 */
function forgotDone(): never
{
    global $forgotStartedAt;

    $elapsed = microtime(true) - $forgotStartedAt;
    $wait    = FORGOT_MIN_SECONDS - $elapsed;
    if ($wait > 0) {
        usleep((int) round($wait * 1_000_000));
    }

    exit(json_encode([
        'success' => true,
        'data'    => ['message' => 'Se l\'indirizzo e\' registrato, riceverai a breve un\'email con il link per reimpostare la password.'],
    ]));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['success' => false, 'error' => 'Metodo non consentito.']));
}

// Nessun CSRF qui: la pagina e' pubblica e chi la apre non ha ancora una
// sessione da proteggere. Al posto suo c'e' il tetto per IP — che e' la difesa
// giusta, perche' il rischio non e' la richiesta forzata ma l'abuso in massa.
// Il tetto e' basso: mandare email a spese del dominio dell'agenzia costa
// reputazione, e una casella tempestata di link di reset e' molestia.
checkRateLimit('tenant_forgot_password', 5, 900);

$body  = json_decode((string) file_get_contents('php://input'), true) ?: [];
$email = trim((string) ($body['email'] ?? ''));

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    forgotDone();   // nemmeno un'email malformata deve distinguersi
}

try {
    $db   = getDB();
    $stmt = $db->prepare(
        "SELECT t.id, t.name, t.surname, t.email
         FROM tenants t
         INNER JOIN tenant_users tu ON tu.tenant_id = t.id
         WHERE t.email = :e AND t.status = 'active'
         LIMIT 1"
    );
    $stmt->execute(['e' => $email]);
    $tenant = $stmt->fetch(PDO::FETCH_ASSOC);

    // Nessun account, o account mai attivato sul portale: si esce dalla stessa
    // porta di un invio riuscito.
    if (!$tenant) {
        forgotDone();
    }

    $baseUrl = appBaseUrl();
    if ($baseUrl === '') {
        // Un link relativo in un'email non e' cliccabile. Non lo diciamo al
        // chiamante (sarebbe informazione sul server), ma va nel log.
        error_log('tenant forgot-password: APP_URL non configurato, nessun link inviato');
        forgotDone();
    }

    $issued = passwordResetIssue($db, 'tenant', (int) $tenant['id'], $email, null);
    $link   = $baseUrl . '/reset_password.php?token=' . $issued['token'];

    $mail = passwordResetEmail(
        trim($tenant['name'] . ' ' . $tenant['surname']),
        $link,
        $issued['expires_at'],
        (string) getSetting('agency_name', 'Gestionale Immobiliare')
    );

    $sent = sendClientEmail($email, $mail['subject'], $mail['body']);

    if (empty($sent['success'])) {
        // Il link esiste ma non e' arrivato a nessuno: va chiuso subito,
        // altrimenti resta un accesso valido di cui non sa nulla neanche il
        // destinatario.
        passwordResetInvalidate($db, $issued['id']);
        error_log('tenant forgot-password: invio fallito — ' . ($sent['error'] ?? 'errore SMTP'));
    } elseif (!empty($sent['simulated'])) {
        // In sviluppo la posta non parte davvero: il link si legge qui.
        error_log('tenant forgot-password (simulato) link: ' . $link);
    }
} catch (Throwable $e) {
    // Nemmeno un guasto deve distinguersi da un invio riuscito.
    error_log('tenant forgot-password failed: ' . $e->getMessage());
}

forgotDone();

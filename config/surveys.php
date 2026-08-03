<?php
/**
 * Sondaggi di soddisfazione: link, riuso e invito.
 *
 * Il sondaggio nasce come riga con un token: chi lo riceve compila senza login
 * (il token E' la credenziale). Finora il link lo si copiava a mano dal modale
 * e lo si incollava altrove; qui vive la parte che serve per SPEDIRLO, da due
 * strade diverse:
 *
 *   - a mano, dalla pagina Sondaggi ("Genera e invia");
 *   - da sola, quando un'automazione usa il token {{sondaggio.link}}.
 *
 * Entrambe passano da qui perche' l'URL pubblico va costruito in UN posto solo:
 * quando esistevano due costruzioni parallele (API e JS) una delle due puntava
 * a una pagina inesistente e nessuno se ne accorgeva, perche' in app si usava
 * sempre l'altra.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/env.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/settings.php';

/** La pagina pubblica sta sotto tenant/, non in radice. */
const SURVEY_PUBLIC_PATH = '/tenant/survey.php';

/**
 * URL pubblico del sondaggio, o '' se l'indirizzo dell'app non e' configurato.
 *
 * Stringa vuota e non percorso relativo: dentro un'email un link relativo non
 * e' cliccabile, e chi chiama deve poter decidere di non spedire affatto.
 *
 * La costante APP_URL la definisce config/bootstrap.php, che e' un file del
 * percorso HTTP: cron/process_reminders.php carica solo l'ambiente, quindi
 * sotto cron la costante NON esiste e la variabile si'. Guardare solo la
 * costante voleva dire spedire dal web e non dal cron — cioe' rompersi
 * esattamente nell'uso automatico. Vedi anche mail_html.php, che per lo stesso
 * motivo perde il logo nelle email del cron.
 */
function surveyPublicLink(string $token): string
{
    $baseUrl = surveyLinkBaseUrl();
    if ($baseUrl === '' || $token === '') {
        return '';
    }
    return $baseUrl . SURVEY_PUBLIC_PATH . '?token=' . rawurlencode($token);
}

/**
 * Indirizzo pubblico dell'app, '' se non configurato.
 *
 * Interrogabile PRIMA di creare il sondaggio: senza questo, un invio impossibile
 * lasciava comunque in tabella una riga con un token che nessuno avrebbe mai
 * ricevuto.
 */
function surveyLinkBaseUrl(): string
{
    $baseUrl = defined('APP_URL') && APP_URL !== ''
        ? (string) APP_URL
        : (string) env('APP_URL', '');

    return rtrim($baseUrl, '/');
}

/**
 * Restituisce un sondaggio APERTO per questo inquilino/immobile, creandolo solo
 * se non ce n'e' gia' uno in attesa di risposta.
 *
 * Il riuso non e' un'ottimizzazione: senza, ogni sollecito automatico
 * genererebbe un token nuovo, e l'inquilino che compila il primo link ricevuto
 * si vedrebbe comunque arrivare i successivi. Un sondaggio gia' compilato non
 * si riusa mai (submitted_at blocca la seconda risposta).
 *
 * @return array{id:int, token:string, link:string, created:bool}
 */
function surveyEnsureOpen(PDO $db, ?int $tenantId, ?int $propertyId): array
{
    if ($tenantId === null && $propertyId === null) {
        throw new InvalidArgumentException('Serve almeno un inquilino o un immobile.');
    }

    // <=> confronta anche i NULL: un sondaggio "solo immobile" non deve essere
    // riusato per lo stesso immobile ma con inquilino noto, e viceversa.
    $stmt = $db->prepare(
        "SELECT id, token FROM tenant_surveys
         WHERE tenant_id <=> :tenant_id AND property_id <=> :property_id
           AND submitted_at IS NULL
         ORDER BY id DESC LIMIT 1"
    );
    $stmt->execute(['tenant_id' => $tenantId, 'property_id' => $propertyId]);
    $existing = $stmt->fetch();

    if ($existing) {
        return [
            'id'      => (int) $existing['id'],
            'token'   => (string) $existing['token'],
            'link'    => surveyPublicLink((string) $existing['token']),
            'created' => false,
        ];
    }

    $token = bin2hex(random_bytes(32)); // 64-char hex token
    $db->prepare(
        "INSERT INTO tenant_surveys (tenant_id, property_id, token)
         VALUES (:tenant_id, :property_id, :token)"
    )->execute([
        'tenant_id'   => $tenantId,
        'property_id' => $propertyId,
        'token'       => $token,
    ]);

    return [
        'id'      => (int) $db->lastInsertId(),
        'token'   => $token,
        'link'    => surveyPublicLink($token),
        'created' => true,
    ];
}

/**
 * Destinatario dell'invito: nome ed email dell'inquilino.
 *
 * @return array{email:string, name:string}|null
 */
function surveyTenantRecipient(PDO $db, int $tenantId): ?array
{
    $stmt = $db->prepare("SELECT name, surname, email FROM tenants WHERE id = :id");
    $stmt->execute(['id' => $tenantId]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }

    $email = trim((string) ($row['email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }

    return [
        'email' => $email,
        'name'  => trim(((string) $row['name']) . ' ' . ((string) $row['surname'])),
    ];
}

/**
 * Testo dell'invito. Testo semplice, come il reset password: il link nudo su
 * una riga sua e' cliccabile ovunque, mentre wrapHtmlEmail() escapa il corpo
 * riga per riga e lo renderebbe una stringa morta.
 *
 * @return array{subject:string, body:string}
 */
function surveyInvitationMessage(string $recipientName, string $link, ?string $propertyAddress = null): array
{
    $agency = (string) getSetting('agency_name', 'Gestionale Immobiliare');
    $who    = $recipientName !== '' ? $recipientName : 'Gentile inquilino';
    $where  = trim((string) $propertyAddress) !== ''
        ? ' per l\'immobile di ' . trim((string) $propertyAddress)
        : '';

    $body = "Gentile {$who},\n\n"
          . "vorremmo sapere come sta andando{$where}.\n"
          . "Bastano due minuti: si valutano la qualita' complessiva, la manutenzione e la comunicazione.\n\n"
          . "{$link}\n\n"
          . "Il link e' personale e si puo' compilare una sola volta.\n\n"
          . "Grazie,\n{$agency}";

    return [
        'subject' => $agency . ' — Come sta andando? Due minuti per un riscontro',
        'body'    => $body,
    ];
}

/**
 * Crea (o riusa) il sondaggio e ne spedisce l'invito all'inquilino.
 *
 * Non lancia sui casi previsti — nessuna email, APP_URL assente, SMTP giu' —
 * perche' i chiamanti sono due e nessuno dei due deve morire per questo: l'API
 * riporta l'errore all'agente, il cron lo scrive nel registro invii.
 *
 * @return array{success:bool, error?:string, survey_id?:int, link?:string,
 *               email?:string, simulated?:bool}
 */
function surveySendInvitation(PDO $db, int $tenantId, ?int $propertyId = null, ?string $propertyAddress = null): array
{
    $recipient = surveyTenantRecipient($db, $tenantId);
    if ($recipient === null) {
        return ['success' => false, 'error' => 'L\'inquilino non ha un indirizzo email valido: non c\'e\' dove mandare il link.'];
    }
    if (surveyLinkBaseUrl() === '') {
        return ['success' => false, 'error' => 'APP_URL non configurato sul server: il link nell\'email sarebbe incompleto.'];
    }

    $survey = surveyEnsureOpen($db, $tenantId, $propertyId);

    $mail = surveyInvitationMessage($recipient['name'], $survey['link'], $propertyAddress);
    $sent = sendClientEmail($recipient['email'], $mail['subject'], $mail['body']);

    if (empty($sent['success'])) {
        return [
            'success'   => false,
            'error'     => 'Email non inviata (' . ($sent['error'] ?? 'errore SMTP') . ').',
            'survey_id' => $survey['id'],
            'link'      => $survey['link'],
        ];
    }

    return [
        'success'   => true,
        'survey_id' => $survey['id'],
        'link'      => $survey['link'],
        'email'     => $recipient['email'],
        // In sviluppo l'email non parte davvero: dire "inviata" farebbe cercare
        // per mezz'ora un messaggio che non esiste.
        'simulated' => !empty($sent['simulated']),
    ];
}

// ---------------------------------------------------------------------------
// Automazioni
// ---------------------------------------------------------------------------

/** Il token che un modello di automazione usa per farsi dare il link. */
const SURVEY_AUTOMATION_TOKEN = 'sondaggio.link';

/** Il modello chiede un link di sondaggio? */
function surveyTemplateWantsLink(?string ...$templates): bool
{
    foreach ($templates as $t) {
        if ($t !== null && stripos($t, '{{' . SURVEY_AUTOMATION_TOKEN) !== false) {
            return true;
        }
    }
    return false;
}

/**
 * Risolve {{sondaggio.link}} per un'occorrenza di promemoria.
 *
 * Il link non puo' stare nel modello salvato: e' diverso per ogni destinatario
 * e va creato al momento dell'invio, non alla scrittura della regola. Per
 * questo la riga `tenant_surveys` nasce qui, come effetto della spedizione.
 *
 * `required` distingue "il modello non lo chiede" da "lo chiede ma non si puo'
 * dare": nel secondo caso il messaggio NON va spedito, perche' conterrebbe un
 * buco al posto del link ed e' l'unica cosa che il messaggio doveva contenere.
 *
 * @return array{required:bool, link:string, error:?string}
 */
function surveyResolveAutomationLink(PDO $db, array $reminder, ?string ...$templates): array
{
    if (!surveyTemplateWantsLink(...$templates)) {
        return ['required' => false, 'link' => '', 'error' => null];
    }

    $tenantId = !empty($reminder['tenant_id']) ? (int) $reminder['tenant_id'] : null;
    if ($tenantId === null) {
        return [
            'required' => true,
            'link'     => '',
            'error'    => 'Il modello usa {{sondaggio.link}} ma il promemoria non e\' collegato a un inquilino.',
        ];
    }

    if (surveyLinkBaseUrl() === '') {
        return [
            'required' => true,
            'link'     => '',
            'error'    => 'APP_URL non configurato sul server: il link del sondaggio sarebbe incompleto.',
        ];
    }

    try {
        $survey = surveyEnsureOpen($db, $tenantId, !empty($reminder['property_id']) ? (int) $reminder['property_id'] : null);
    } catch (Throwable $e) {
        return ['required' => true, 'link' => '', 'error' => 'Sondaggio non creato: ' . $e->getMessage()];
    }

    if ($survey['link'] === '') {
        return [
            'required' => true,
            'link'     => '',
            'error'    => 'APP_URL non configurato sul server: il link del sondaggio sarebbe incompleto.',
        ];
    }

    return ['required' => true, 'link' => $survey['link'], 'error' => null];
}

<?php
/**
 * Invio di email COMMERCIALI — l'unica porta da cui devono passare.
 *
 * Differenza rispetto a `sendClientEmail()`: qui, prima di spedire, si chiede al
 * registro dei consensi se si può. Un messaggio commerciale a chi non ha dato il
 * consenso non è un invio riuscito male, è un invio che non deve partire.
 *
 * NON usare questa funzione per reset password, scadenze di pagamento o
 * notifiche all'agente: quelle hanno base giuridica contrattuale, passano da
 * `sendClientEmail()` e non devono essere bloccate da un consenso marketing
 * mancante.
 */

require_once __DIR__ . '/../config/consent.php';
require_once __DIR__ . '/../config/mail.php';
require_once __DIR__ . '/../config/mail_html.php';
require_once __DIR__ . '/../config/settings.php';

/**
 * @return array{success: bool, status: string, external_id: ?string, error: ?string}
 */
function sendMarketingEmail(
    PDO    $db,
    string $subjectType,
    int    $subjectId,
    string $to,
    string $subject,
    string $bodyText,
    string $purpose = CONSENT_PURPOSE_MARKETING
): array {
    $refuse = static fn(string $status, string $error): array => [
        'success'     => false,
        'status'      => $status,
        'external_id' => null,
        'error'       => $error,
    ];

    // 1. Il consenso. Prima di tutto il resto, e prima di aprire qualunque
    //    connessione: non si tocca il server di posta per un invio vietato.
    if (!consentGranted($db, $subjectType, $subjectId, $purpose)) {
        return $refuse(
            'blocked',
            'Consenso marketing assente o revocato per questo contatto: il messaggio non è stato inviato.'
        );
    }

    // 2. Il link di disiscrizione. Un'email commerciale senza un modo per
    //    disiscriversi è essa stessa una violazione, quindi la mancanza di
    //    APP_URL non degrada l'invio: lo impedisce. Meglio nessun messaggio che
    //    un messaggio da cui non si può uscire.
    $baseUrl = defined('APP_URL') ? rtrim((string) APP_URL, '/') : '';
    if ($baseUrl === '') {
        return $refuse(
            'failed',
            'APP_URL non configurato: il link di disiscrizione sarebbe incompleto, invio annullato.'
        );
    }

    $token           = consentUnsubscribeToken($db, $subjectType, $subjectId, $purpose);
    $unsubscribeUrl  = $baseUrl . '/unsubscribe.php?token=' . rawurlencode($token);
    $agency          = (string) getSetting('agency_name', 'Gestionale Immobiliare');

    $textFooter = "\n\n—\nRicevi questo messaggio perché hai acconsentito a ricevere comunicazioni"
        . " commerciali da {$agency}.\nPer non riceverne più: {$unsubscribeUrl}";

    $urlEsc     = htmlspecialchars($unsubscribeUrl, ENT_QUOTES, 'UTF-8');
    $agencyEsc  = htmlspecialchars($agency, ENT_QUOTES, 'UTF-8');
    $htmlFooter = "Ricevi questo messaggio perché hai acconsentito a ricevere comunicazioni commerciali da {$agencyEsc}. "
        . "<a href=\"{$urlEsc}\" style=\"color:#64748b\">Disiscriviti</a>.";

    $html = wrapHtmlEmail($subject, $bodyText, $htmlFooter);

    // 3. Gli header RFC 2369 / RFC 8058: sono ciò che fa comparire "Annulla
    //    iscrizione" accanto al mittente in Gmail. Non è cosmesi — la loro
    //    assenza è uno dei motivi per cui la posta commerciale finisce in spam,
    //    e una campagna in spam è indistinguibile da una campagna non spedita.
    $headers = [
        'List-Unsubscribe: <' . $unsubscribeUrl . '>',
        'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    ];

    return sendClientEmail($to, $subject, $bodyText . $textFooter, $html, [], null, $headers);
}

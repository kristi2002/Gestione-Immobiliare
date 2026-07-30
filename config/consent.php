<?php
/**
 * Registro dei consensi — lettura, concessione, revoca.
 *
 * `consent_records` (phase32, esteso da phase46) esisteva già ed era scritto da
 * `logConsent()`, ma non lo leggeva NESSUNO tranne l'export/cancellazione GDPR:
 * il registro c'era e non fermava niente. Qui vive la parte che mancava — la
 * domanda "possiamo scrivere a questa persona?" — perché un invio commerciale
 * senza consenso non è un bug di forma, è un illecito.
 *
 * Il default è NO: un soggetto senza alcuna riga non è un soggetto consenziente.
 *
 * ATTENZIONE — questo vale solo per i messaggi COMMERCIALI. Reset password,
 * scadenze di pagamento e notifiche all'agente hanno base giuridica contrattuale
 * e non passano di qui: metterli sotto consenso significherebbe che chi non ha
 * mai dato consenso marketing non può nemmeno recuperare la propria password.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/gdpr.php';

const CONSENT_PURPOSE_MARKETING = 'marketing';

/** Deve combaciare con l'ENUM di consent_records.subject_type (phase46). */
const CONSENT_SUBJECT_TYPES = ['client', 'tenant', 'lead', 'application'];

/** Solo queste due tabelle hanno la colonna denormalizzata marketing_consent_at. */
const CONSENT_MARKETING_COLUMN_TABLES = ['client' => 'clients', 'tenant' => 'tenants'];

/**
 * Il soggetto ha, ADESSO, un consenso valido per questa finalità?
 *
 * Vince l'ultima riga scritta: il registro è append-only, quindi la storia
 * concesso → revocato → riconcesso si legge dalla riga più recente e non da un
 * OR su tutte (che renderebbe la revoca impossibile).
 *
 * Un errore di lettura restituisce false: se non riusciamo a dimostrare il
 * consenso, non abbiamo il consenso.
 */
function consentGranted(PDO $db, string $subjectType, int $subjectId, string $purpose = CONSENT_PURPOSE_MARKETING): bool
{
    if (!in_array($subjectType, CONSENT_SUBJECT_TYPES, true) || $subjectId <= 0) {
        return false;
    }

    try {
        $stmt = $db->prepare(
            'SELECT granted, withdrawn_at
               FROM consent_records
              WHERE subject_type = :t AND subject_id = :id AND purpose = :p
              ORDER BY created_at DESC, id DESC
              LIMIT 1'
        );
        $stmt->execute(['t' => $subjectType, 'id' => $subjectId, 'p' => $purpose]);
        $row = $stmt->fetch();
    } catch (Throwable $e) {
        error_log('[consent] lettura fallita: ' . $e->getMessage());
        return false;
    }

    if (!$row) {
        return false;
    }

    return (int) $row['granted'] === 1 && $row['withdrawn_at'] === null;
}

/**
 * Porta il consenso allo stato richiesto, scrivendo SOLO se cambia qualcosa.
 *
 * Il "solo se cambia" non è un'ottimizzazione: senza, ogni salvataggio della
 * scheda anagrafica appenderebbe una riga identica e il registro — che deve
 * essere una prova leggibile di quando e come il consenso è stato raccolto —
 * diventerebbe rumore in cui la data vera non si trova più.
 *
 * @return bool true se è stata scritta una riga (stato cambiato), false se no-op.
 */
function consentSet(
    PDO     $db,
    string  $subjectType,
    int     $subjectId,
    bool    $granted,
    string  $purpose     = CONSENT_PURPOSE_MARKETING,
    string  $source      = 'admin_form',
    ?string $consentText = null
): bool {
    if (!in_array($subjectType, CONSENT_SUBJECT_TYPES, true) || $subjectId <= 0) {
        return false;
    }

    if (consentGranted($db, $subjectType, $subjectId, $purpose) === $granted) {
        return false;
    }

    return $granted
        ? consentGrant($db, $subjectType, $subjectId, $purpose, $source, $consentText)
        : consentWithdraw($db, $subjectType, $subjectId, $purpose, $source);
}

/**
 * Concede il consenso e allinea la colonna denormalizzata.
 *
 * `$consentText` è il testo ESATTO mostrato o letto al soggetto: senza di esso
 * il registro dice che qualcuno ha acconsentito ma non a cosa, che davanti a un
 * reclamo non vale come consenso dimostrabile. Se il chiamante non lo passa si
 * usa quello configurato in Impostazioni.
 */
function consentGrant(
    PDO     $db,
    string  $subjectType,
    int     $subjectId,
    string  $purpose     = CONSENT_PURPOSE_MARKETING,
    string  $source      = 'admin_form',
    ?string $consentText = null
): bool {
    $text = $consentText ?? consentConfiguredText($purpose);

    logConsent($db, $subjectType, $subjectId, $purpose, true, 'consent', $text, $source);
    consentSyncColumn($db, $subjectType, $subjectId, $purpose, true);

    return true;
}

/**
 * Revoca il consenso.
 *
 * Due scritture volutamente distinte: `withdrawn_at` sulle righe di concessione
 * precedenti (così una riga vecchia non resta a dire "concesso" per sempre) e
 * una nuova riga granted=0, che è il fatto storico "il giorno X ha revocato" e
 * non deve essere cancellabile riscrivendo la riga precedente.
 */
function consentWithdraw(
    PDO    $db,
    string $subjectType,
    int    $subjectId,
    string $purpose = CONSENT_PURPOSE_MARKETING,
    string $source  = 'unsubscribe_link'
): bool {
    try {
        $stmt = $db->prepare(
            'UPDATE consent_records
                SET withdrawn_at = NOW()
              WHERE subject_type = :t AND subject_id = :id AND purpose = :p
                AND granted = 1 AND withdrawn_at IS NULL'
        );
        $stmt->execute(['t' => $subjectType, 'id' => $subjectId, 'p' => $purpose]);
    } catch (Throwable $e) {
        error_log('[consent] revoca: UPDATE fallito: ' . $e->getMessage());
        return false;
    }

    logConsent($db, $subjectType, $subjectId, $purpose, false, 'consent', null, $source);
    consentSyncColumn($db, $subjectType, $subjectId, $purpose, false);

    return true;
}

/**
 * Tiene allineata `clients.marketing_consent_at` / `tenants.marketing_consent_at`
 * al registro.
 *
 * La colonna è una comodità di lettura (liste, export GDPR); il registro è la
 * verità. Se le due divergono, la scheda mostra un consenso che la revoca ha
 * già tolto — quindi si scrivono sempre insieme.
 */
function consentSyncColumn(PDO $db, string $subjectType, int $subjectId, string $purpose, bool $granted): void
{
    if ($purpose !== CONSENT_PURPOSE_MARKETING) {
        return;
    }
    $table = CONSENT_MARKETING_COLUMN_TABLES[$subjectType] ?? null;
    if ($table === null) {
        return; // lead/application non hanno la colonna: vive solo nel registro
    }

    try {
        // $table viene da una costante interna, mai dall'input.
        $db->prepare("UPDATE {$table} SET marketing_consent_at = :v WHERE id = :id")
           ->execute(['v' => $granted ? date('Y-m-d H:i:s') : null, 'id' => $subjectId]);
    } catch (Throwable $e) {
        error_log('[consent] allineamento colonna fallito (' . $table . '): ' . $e->getMessage());
    }
}

/**
 * Applica il consenso arrivato dal corpo di una richiesta API.
 *
 * `array_key_exists` e non `isset`: un form che manda `false` sta dicendo "non
 * acconsente", che è un'informazione da registrare, mentre un form che non manda
 * affatto la chiave (un'altra schermata, un salvataggio parziale) non deve
 * toccare il consenso già presente. Con `isset` i due casi sarebbero identici e
 * il primo andrebbe perso.
 */
function consentApplyFromInput(
    PDO    $db,
    string $subjectType,
    int    $subjectId,
    array  $data,
    string $field   = 'marketing_consent',
    string $purpose = CONSENT_PURPOSE_MARKETING
): void {
    if (!array_key_exists($field, $data)) {
        return;
    }
    $granted = filter_var($data[$field], FILTER_VALIDATE_BOOLEAN);
    consentSet($db, $subjectType, $subjectId, $granted, $purpose, 'admin_form');
}

/** Il testo dell'informativa configurato in Impostazioni ('' se mai impostato). */
function consentConfiguredText(string $purpose = CONSENT_PURPOSE_MARKETING): ?string
{
    if ($purpose !== CONSENT_PURPOSE_MARKETING) {
        return null;
    }
    $text = trim((string) getSetting('marketing_consent_text', ''));

    return $text === '' ? null : $text;
}

// ---------------------------------------------------------------------------
// Token di disiscrizione
//
// Firmato e senza stato: il link di disiscrizione deve funzionare per sempre,
// anche fra due anni in una vecchia email, quindi non può appoggiarsi a una
// riga a uso singolo come i reset password (phase83). Il token non è un segreto
// da custodire: contiene solo un riferimento e la firma serve a impedire che
// qualcuno disiscriva terzi cambiando l'id nell'URL.
// ---------------------------------------------------------------------------

function consentBase64UrlEncode(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function consentBase64UrlDecode(string $encoded): string
{
    return (string) base64_decode(strtr($encoded, '-_', '+/'), true);
}

/**
 * Chiave di firma, generata al primo uso e conservata in app_settings.
 *
 * Non è una variabile d'ambiente perché non deve esserci un deploy in cui
 * manca: una chiave vuota firmerebbe qualunque cosa e renderebbe il token
 * falsificabile. L'INSERT è idempotente (ON DUPLICATE ... = se stesso) e il
 * valore viene sempre riletto dal database, così due richieste in parallelo
 * finiscono per usare la stessa chiave invece di sovrascriversi a vicenda.
 */
function consentSigningKey(PDO $db): string
{
    static $key = null;
    if ($key !== null) {
        return $key;
    }

    $existing = trim((string) getSetting('unsubscribe_signing_key', ''));
    if ($existing !== '') {
        return $key = $existing;
    }

    $candidate = bin2hex(random_bytes(32));
    $db->prepare(
        'INSERT INTO app_settings (setting_key, setting_value) VALUES (:k, :v)
         ON DUPLICATE KEY UPDATE setting_value = setting_value'
    )->execute(['k' => 'unsubscribe_signing_key', 'v' => $candidate]);

    $stmt = $db->prepare('SELECT setting_value FROM app_settings WHERE setting_key = :k');
    $stmt->execute(['k' => 'unsubscribe_signing_key']);
    $stored = (string) $stmt->fetchColumn();

    settingsCacheInvalidate();

    return $key = ($stored !== '' ? $stored : $candidate);
}

function consentUnsubscribeToken(PDO $db, string $subjectType, int $subjectId, string $purpose = CONSENT_PURPOSE_MARKETING): string
{
    $payload   = consentBase64UrlEncode($subjectType . '|' . $subjectId . '|' . $purpose);
    $signature = consentBase64UrlEncode(
        hash_hmac('sha256', $payload, consentSigningKey($db), true)
    );

    return $payload . '.' . $signature;
}

/**
 * Verifica il token e restituisce il soggetto, o null se non è valido.
 *
 * @return array{subject_type: string, subject_id: int, purpose: string}|null
 */
function consentUnsubscribeVerify(PDO $db, string $token): ?array
{
    if (!str_contains($token, '.')) {
        return null;
    }
    [$payload, $signature] = explode('.', $token, 2);
    if ($payload === '' || $signature === '') {
        return null;
    }

    $expected = consentBase64UrlEncode(
        hash_hmac('sha256', $payload, consentSigningKey($db), true)
    );
    // hash_equals e non ===: il confronto a tempo costante impedisce di
    // ricostruire la firma un carattere alla volta misurando le risposte.
    if (!hash_equals($expected, $signature)) {
        return null;
    }

    $parts = explode('|', consentBase64UrlDecode($payload));
    if (count($parts) !== 3) {
        return null;
    }
    [$subjectType, $subjectId, $purpose] = $parts;

    if (!in_array($subjectType, CONSENT_SUBJECT_TYPES, true) || (int) $subjectId <= 0 || $purpose === '') {
        return null;
    }

    return [
        'subject_type' => $subjectType,
        'subject_id'   => (int) $subjectId,
        'purpose'      => $purpose,
    ];
}

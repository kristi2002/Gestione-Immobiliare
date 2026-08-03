<?php
/**
 * Link di reset password per i portali inquilino e proprietario.
 *
 * Il flusso in tre atti:
 *   1. l'agente preme "Invia link di reset" → passwordResetIssue() genera un
 *      token, ne salva solo l'hash e restituisce il token in chiaro UNA volta;
 *   2. il token viaggia esclusivamente dentro l'email;
 *   3. l'interessato apre reset_password.php, sceglie la password, e
 *      passwordResetConsume() la scrive e chiude il link.
 *
 * L'agenzia non vede mai la password. Vedi il commento della migrazione
 * phase83_password_resets.sql per il perche' questo cambia la posizione
 * dell'agenzia rispetto a "gliela detto al telefono".
 *
 * Questo file non tocca sessioni ne' output: e' richiamabile sia dall'API admin
 * sia dalla pagina pubblica.
 */

// Unica dipendenza: l'hashing. Volutamente NON config/auth.php — la sua
// createTenantPortalUser() prende la connessione dal getDB() globale, e bastava
// quello per rendere questo file non collaudabile contro un database di prova.
// Qui il PDO arriva sempre come parametro.
require_once __DIR__ . '/../config/password.php';

/**
 * Durata del link.
 *
 * Ventiquattro ore e non venti minuti: qui il link non nasce da un utente che
 * ha appena cliccato "password dimenticata" ed e' davanti allo schermo, ma da
 * un agente che lo manda e poi telefona. Un link scaduto prima che l'inquilino
 * apra la posta la sera significa una seconda chiamata all'agenzia — e la
 * pressione a tornare alla password detta a voce, che e' il problema da cui
 * si sta scappando. Uso singolo e revoca dei precedenti fanno il resto.
 */
const PASSWORD_RESET_TTL_HOURS = 24;

/** Da quanti giorni in poi le righe consumate/scadute vengono buttate. */
const PASSWORD_RESET_RETENTION_DAYS = 30;

/** Tipi di soggetto ammessi. */
const PASSWORD_RESET_SUBJECTS = ['tenant', 'owner'];

/** Lunghezza minima, la stessa che i form admin gia' impongono. */
const PASSWORD_MIN_LENGTH = 8;

/**
 * SHA-256 del token. Non password_hash(): il token e' gia' 256 bit di entropia,
 * non gli serve un KDF lento, e cosi' e' cercabile per indice.
 */
function passwordResetTokenHash(string $token): string
{
    return hash('sha256', $token);
}

/**
 * Emette un link e restituisce il token IN CHIARO — l'unica volta in cui esiste
 * fuori dall'email. Revoca i link precedenti ancora aperti dello stesso soggetto.
 *
 * @return array{token:string,expires_at:string,id:int}
 */
function passwordResetIssue(PDO $db, string $subjectType, int $subjectId, string $email, ?int $adminId = null): array
{
    if (!in_array($subjectType, PASSWORD_RESET_SUBJECTS, true)) {
        throw new InvalidArgumentException('Tipo soggetto non valido: ' . $subjectType);
    }

    $column = $subjectType === 'tenant' ? 'tenant_id' : 'client_id';

    // Pulizia opportunistica: le righe consumate o scadute da un mese non
    // servono piu' a nessuno e non c'e' motivo di conservare a chi e' stato
    // mandato un link nel 2026. Qui invece che in un cron, cosi' non dipende da
    // una schedulazione che potrebbe non girare (vedi phase-crontab in passato).
    $db->prepare(
        'DELETE FROM password_resets
          WHERE expires_at < DATE_SUB(NOW(), INTERVAL :days DAY)'
    )->execute(['days' => PASSWORD_RESET_RETENTION_DAYS]);

    // Un solo link vivo per soggetto: se l'agente ne manda un secondo perche'
    // il primo "non arrivava", il primo deve smettere di funzionare.
    $db->prepare(
        "UPDATE password_resets
            SET invalidated_at = NOW()
          WHERE {$column} = :id AND used_at IS NULL AND invalidated_at IS NULL"
    )->execute(['id' => $subjectId]);

    $token     = bin2hex(random_bytes(32));   // 64 caratteri esadecimali
    $expiresAt = date('Y-m-d H:i:s', strtotime('+' . PASSWORD_RESET_TTL_HOURS . ' hours'));

    $db->prepare(
        "INSERT INTO password_resets ({$column}, email, token_hash, expires_at, created_by)
         VALUES (:subject, :email, :hash, :expires, :admin)"
    )->execute([
        'subject' => $subjectId,
        'email'   => $email,
        'hash'    => passwordResetTokenHash($token),
        'expires' => $expiresAt,
        'admin'   => $adminId ?: null,
    ]);

    return [
        'id'         => (int) $db->lastInsertId(),
        'token'      => $token,
        'expires_at' => $expiresAt,
    ];
}

/**
 * Revoca un link appena emesso.
 *
 * Serve quando l'invio dell'email fallisce: il link non e' arrivato a nessuno,
 * ma esiste, ed e' valido. Lasciarlo aperto significherebbe un accesso pendente
 * di cui nessuno sa nulla.
 */
function passwordResetInvalidate(PDO $db, int $id): void
{
    $db->prepare('UPDATE password_resets SET invalidated_at = NOW() WHERE id = :id AND used_at IS NULL')
       ->execute(['id' => $id]);
}

/**
 * Cerca un token utilizzabile.
 *
 * Restituisce null in TUTTI i casi di rifiuto — inesistente, scaduto, gia' usato,
 * revocato. La pagina pubblica mostra un solo messaggio per tutti: distinguere
 * "scaduto" da "non esiste" direbbe a chi prova link a caso quando ne ha
 * indovinato uno.
 *
 * @return array{id:int,subject_type:string,subject_id:int,email:string}|null
 */
function passwordResetFind(PDO $db, string $token): ?array
{
    // Un token della lunghezza sbagliata non e' mai stato emesso da noi: si
    // risparmia la query e si evita di scrivere spazzatura nei log di MySQL.
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        return null;
    }

    $stmt = $db->prepare(
        'SELECT id, tenant_id, client_id, email, expires_at, used_at, invalidated_at
           FROM password_resets
          WHERE token_hash = :hash
          LIMIT 1'
    );
    $stmt->execute(['hash' => passwordResetTokenHash($token)]);
    $row = $stmt->fetch();

    if (!$row
        || $row['used_at'] !== null
        || $row['invalidated_at'] !== null
        || strtotime($row['expires_at']) < time()
    ) {
        return null;
    }

    return [
        'id'           => (int) $row['id'],
        'subject_type' => $row['tenant_id'] !== null ? 'tenant' : 'owner',
        'subject_id'   => (int) ($row['tenant_id'] ?? $row['client_id']),
        'email'        => (string) $row['email'],
    ];
}

/**
 * Imposta la nuova password e chiude il link.
 *
 * Transazione unica: una password scritta senza che il link risulti consumato
 * lascerebbe un link riutilizzabile, e un link consumato senza password scritta
 * chiuderebbe fuori l'interessato.
 *
 * @param array{id:int,subject_type:string,subject_id:int} $reset  da passwordResetFind()
 */
function passwordResetConsume(PDO $db, array $reset, string $newPassword, ?string $ip = null): void
{
    if (strlen($newPassword) < PASSWORD_MIN_LENGTH) {
        throw new InvalidArgumentException('Password troppo corta.');
    }

    $db->beginTransaction();
    try {
        // Il link si chiude PRIMA, e solo se era ancora aperto: la clausola
        // used_at IS NULL rende la UPDATE il punto di serializzazione, cosi' due
        // invii simultanei dello stesso form non possono impostare due password
        // diverse. Zero righe toccate = qualcuno e' arrivato prima.
        $stmt = $db->prepare(
            'UPDATE password_resets
                SET used_at = NOW(), request_ip = :ip
              WHERE id = :id AND used_at IS NULL AND invalidated_at IS NULL'
        );
        $stmt->execute(['id' => $reset['id'], 'ip' => $ip]);

        if ($stmt->rowCount() === 0) {
            throw new RuntimeException('Link non piu\' valido.');
        }

        $hash = appPasswordHash($newPassword);

        if ($reset['subject_type'] === 'tenant') {
            // Upsert: l'inquilino puo' non avere ancora una riga in tenant_users
            // (primo accesso) o averla gia' (reset vero e proprio). Stessa
            // semantica di createTenantPortalUser(), ma sul PDO ricevuto.
            $db->prepare(
                'INSERT INTO tenant_users (tenant_id, password_hash) VALUES (:tenant_id, :hash)
                 ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)'
            )->execute(['tenant_id' => $reset['subject_id'], 'hash' => $hash]);
        } else {
            // Anche portal_email, non solo l'hash: owner/auth.php autentica con
            // "WHERE portal_email = :email", e su un proprietario nuovo quella
            // colonna e' NULL. Il link partiva verso clients.email (api/password_reset.php:66),
            // il proprietario sceglieva la password, e poi non riusciva a entrare
            // con nessun indirizzo: l'accesso al portale non si apriva mai.
            // L'indirizzo giusto e' quello a cui il link e' stato spedito, che la
            // riga password_resets conserva. COALESCE per non sovrascrivere un
            // portal_email gia' deciso dall'agenzia.
            $db->prepare(
                'UPDATE clients
                    SET portal_password_hash = :hash,
                        portal_email = COALESCE(portal_email, :email)
                  WHERE id = :id'
            )->execute([
                'hash'  => $hash,
                'email' => $reset['email'],
                'id'    => $reset['subject_id'],
            ]);
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

/**
 * Testo dell'email. Volutamente scarno: niente logo, niente HTML elaborato,
 * niente parola "password" nell'oggetto — un messaggio che sembra marketing
 * finisce nello spam, ed e' l'unico canale su cui questo flusso poggia.
 *
 * @return array{subject:string,body:string}
 */
function passwordResetEmail(string $recipientName, string $link, string $expiresAt, string $agencyName): array
{
    $expiry = date('d/m/Y \a\l\l\e H:i', strtotime($expiresAt));
    $name   = trim($recipientName) !== '' ? trim($recipientName) : 'Gentile utente';

    $body = "{$name},\n\n"
        . "per impostare la password del portale {$agencyName}, apra questo link:\n\n"
        . "{$link}\n\n"
        . "Il link e' valido fino al {$expiry} e puo' essere usato una sola volta.\n"
        . "La password la sceglie lei: l'agenzia non la vede e non puo' recuperarla.\n\n"
        . "Se non ha richiesto lei questo accesso, ignori il messaggio: senza il link "
        . "non cambia nulla.\n\n"
        . $agencyName;

    return [
        'subject' => $agencyName . ' — accesso al portale',
        'body'    => $body,
    ];
}

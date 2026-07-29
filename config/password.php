<?php
/**
 * Hashing delle password — un solo punto per l'intera app.
 *
 * Prima ogni chiamante scriveva `password_hash($p, PASSWORD_DEFAULT)`: sei punti
 * diversi (admin, inquilini, proprietari, seed) che davano tutti bcrypt. Cambiare
 * algoritmo voleva dire trovarli tutti e sei, e sbagliarne uno significa lasciare
 * un portale indietro senza che niente lo segnali.
 *
 * ARGON2ID invece di bcrypt: bcrypt tronca silenziosamente oltre i 72 byte ed e'
 * poco costoso da attaccare su GPU, mentre argon2id e' memory-hard e quindi non
 * si parallelizza a buon mercato. Qui si custodiscono documenti d'identita' e
 * contratti di persone reali, non punteggi di un gioco.
 *
 * Il fallback non e' prudenza generica: PASSWORD_ARGON2ID esiste solo se PHP e'
 * stato compilato con libargon2. Su un runtime senza, `password_hash($p,
 * PASSWORD_ARGON2ID)` non degrada — solleva ValueError, e la prima persona a
 * scoprirlo sarebbe un inquilino che non riesce piu' a farsi creare l'accesso.
 * Se l'algoritmo non c'e' si continua con bcrypt, che resta perfettamente valido.
 */

/** Algoritmo preferito, o null se questo runtime non lo espone. */
function appPasswordAlgo(): ?string
{
    static $algo = null;
    static $resolved = false;

    if (!$resolved) {
        $resolved = true;
        // password_algos() elenca cio' che il binario supporta davvero; la sola
        // presenza della costante non basterebbe come prova.
        if (defined('PASSWORD_ARGON2ID') && in_array(PASSWORD_ARGON2ID, password_algos(), true)) {
            $algo = PASSWORD_ARGON2ID;
        }
    }

    return $algo;
}

/**
 * Hash di una password nuova. Da usare ovunque al posto di password_hash().
 *
 * I parametri sono i default di PHP (64 MiB, 4 iterazioni, 1 thread): sopra le
 * raccomandazioni OWASP e sostenibili su un login, che e' un'operazione rara.
 */
function appPasswordHash(string $password): string
{
    $algo = appPasswordAlgo();

    return $algo !== null
        ? password_hash($password, $algo)
        : password_hash($password, PASSWORD_DEFAULT);
}

/**
 * Va ri-hashata? Vero per gli hash bcrypt gia' in tabella una volta che argon2id
 * e' disponibile.
 *
 * Senza questo il cambio di algoritmo varrebbe solo per le password create da
 * oggi in poi: gli account esistenti — cioe' tutti quelli veri — resterebbero su
 * bcrypt per sempre. La riscrittura avviene al login, quando la password in
 * chiaro e' disponibile per un istante ed e' gia' stata verificata.
 */
function appPasswordNeedsRehash(string $hash): bool
{
    $algo = appPasswordAlgo();

    return $algo !== null
        ? password_needs_rehash($hash, $algo)
        : password_needs_rehash($hash, PASSWORD_DEFAULT);
}

/**
 * Ri-hasha e persiste, se serve, subito dopo un password_verify() riuscito.
 *
 * $persist riceve il nuovo hash e lo scrive dove il chiamante sa (tabelle e
 * colonne diverse per admin, inquilini e proprietari).
 *
 * Gli errori vengono inghiottiti di proposito: questa e' una manutenzione
 * opportunistica dentro un login gia' andato a buon fine. Se il DB e' in sola
 * lettura o la UPDATE fallisce, l'utente deve comunque entrare — l'hash vecchio
 * e' ancora valido e il tentativo si ripete al prossimo accesso. Il fallimento
 * finisce nel log, non sullo schermo di chi sta facendo login.
 *
 * @param callable(string):mixed $persist
 */
function appPasswordUpgrade(string $plainPassword, string $currentHash, callable $persist): void
{
    if (!appPasswordNeedsRehash($currentHash)) {
        return;
    }

    try {
        $persist(appPasswordHash($plainPassword));
    } catch (Throwable $e) {
        error_log('appPasswordUpgrade fallito: ' . $e->getMessage());
    }
}

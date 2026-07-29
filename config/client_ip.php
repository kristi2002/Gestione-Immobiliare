<?php
/**
 * clientIpAddress() — l'unico posto in cui si decide "chi sta chiamando".
 *
 * Il problema
 * -----------
 * config/login_throttle.php e config/rate_limit.php leggevano entrambi
 * X-Forwarded-For (e CF-Connecting-IP) senza chiedersi da dove arrivasse la
 * richiesta. Sono intestazioni scritte dal client: chiunque puo' mandarne una
 * diversa a ogni tentativo e ottenere ogni volta un secchiello nuovo. Il che
 * significa che la protezione contro il forzamento del login — cinque tentativi
 * e blocco per quindici minuti — si aggirava aggiungendo una riga alla
 * richiesta, e lo stesso valeva per ogni limite di frequenza dell'API.
 *
 * La regola
 * ---------
 * Un'intestazione di inoltro vale solo se ce l'ha messa un proxy nostro. Non
 * serve una lista di indirizzi da configurare (e da tenere aggiornata): la
 * distinzione utile e' gia' nell'indirizzo del peer.
 *
 *   REMOTE_ADDR privato o loopback  -> la richiesta e' passata dal reverse
 *                                      proxy (Traefik/Coolify, Docker, nginx):
 *                                      l'intestazione e' sua e la si usa.
 *   REMOTE_ADDR pubblico            -> il client sta parlando direttamente con
 *                                      noi; qualunque X-Forwarded-For se la sia
 *                                      scritta da solo. Si ignora.
 *
 * Cosi' dietro Cloudflare/Coolify continuiamo a contare l'utente vero (e non a
 * mettere tutti nello stesso secchiello del gateway Docker), mentre una
 * connessione diretta non puo' piu' fingersi mille client diversi.
 *
 * TRUSTED_PROXY_IPS in .env (elenco separato da virgole) aggiunge indirizzi
 * pubblici da considerare comunque proxy, per chi mette un bilanciatore fuori
 * dalla rete privata.
 */

/** True per 10/8, 172.16/12, 192.168/16, 127/8, ::1, fc00::/7 e link-local. */
function isPrivateOrLoopbackIp(string $ip): bool
{
    if ($ip === '') {
        return false;
    }
    // filter_var esclude privati e riservati: se NON passa, e' uno di quelli.
    return filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    ) === false;
}

/** Il peer e' un proxy di cui ci fidiamo? */
function requestCameThroughTrustedProxy(): bool
{
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    if ($remote === '') {
        return false;
    }
    if (isPrivateOrLoopbackIp($remote)) {
        return true;
    }

    $configured = function_exists('env') ? (string) env('TRUSTED_PROXY_IPS', '') : '';
    if ($configured === '') {
        return false;
    }
    foreach (explode(',', $configured) as $candidate) {
        if (trim($candidate) === $remote) {
            return true;
        }
    }
    return false;
}

/**
 * L'indirizzo da usare per contare tentativi e limiti. Mai vuoto.
 */
function clientIpAddress(): string
{
    $remote = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    if (!requestCameThroughTrustedProxy()) {
        return $remote;
    }

    // Cloudflare riscrive CF-Connecting-IP a ogni passaggio, quindi e' la piu'
    // affidabile quando c'e'. X-Forwarded-For e' una catena "client, proxy1,
    // proxy2": il primo elemento e' quello che interessa, ed e' attendibile solo
    // perche' siamo gia' dentro il ramo "il peer e' un proxy nostro".
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR'] as $header) {
        $raw = $_SERVER[$header] ?? '';
        if ($raw === '') {
            continue;
        }
        $first = trim(explode(',', $raw)[0]);
        if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
            return $first;
        }
    }

    return $remote;
}

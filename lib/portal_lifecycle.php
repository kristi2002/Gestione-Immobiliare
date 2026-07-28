<?php
/**
 * Ritiro automatico dai portali quando l'immobile esce dal mercato.
 *
 * Il problema concreto: un immobile venduto a gennaio che resta pubblicato
 * fino a marzo continua a occupare uno slot a pagamento e a generare richieste
 * per una casa che non c'e' piu'. Nessuno se ne accorge, perche' togliere
 * l'annuncio e' l'ultima cosa a cui si pensa dopo un rogito.
 *
 * Impianto: reazione di SISTEMA all'evento `property.status_changed`, non una
 * regola configurabile. Le regole in `reminders` servono a mandare messaggi e
 * sono opzionali per definizione; questo invece deve accadere sempre, anche su
 * un'installazione dove nessuno ha configurato automazioni. Riusa la coda
 * `automation_events` gia' esistente — nessun broker aggiuntivo: la coda e'
 * gia' durevole, gia' drenata dal cron e gia' tollerante ai guasti.
 *
 * ⚠️ Limite dichiarato: finche' non esiste un feed reale verso i portali,
 * questo aggiorna lo STATO TRACCIATO nel gestionale, non l'annuncio sul
 * portale. E' l'equivalente automatico di quello che oggi l'agente fa a mano,
 * e diventa un ritiro vero il giorno in cui il generatore del feed escludera'
 * le righe 'removed'. Non va raccontato al cliente come "ritiro dai portali".
 */

require_once __DIR__ . '/../config/portal_specs.php';

/**
 * Righe di pubblicazione VIVE: solo queste costano uno slot e vanno ritirate.
 * Le bozze restano dove sono — non sono mai arrivate al portale, e azzerarle
 * cancellerebbe il lavoro preparatorio dell'agente senza alcun beneficio.
 */
const PORTAL_LIVE_LISTING_STATUSES = ['publishing', 'published'];

/**
 * Mette in ritiro le pubblicazioni attive di un immobile uscito dal mercato.
 *
 * @return int quante righe sono state messe in ritiro
 */
function portalRetireListingsForProperty(PDO $db, int $propertyId, string $propertyStatus): int
{
    if (!in_array($propertyStatus, PORTAL_UNPUBLISHABLE_PROPERTY_STATUS, true)) {
        return 0;
    }

    $labels = ['sold' => 'venduto', 'rented' => 'affittato', 'archived' => 'archiviato'];
    $reason = 'Ritiro automatico: immobile ' . ($labels[$propertyStatus] ?? $propertyStatus)
        . ' il ' . date('d/m/Y') . '.';

    $placeholders = implode(',', array_fill(0, count(PORTAL_LIVE_LISTING_STATUSES), '?'));

    // Le note dell'agente non si buttano: si annota in coda. Se qualcuno
    // rileggera' questa riga fra sei mesi, deve poter capire perche' e' passata
    // in "rimosso" senza che nessuno l'abbia toccata.
    //
    // CONCAT_WS + NULLIF invece di TRIM(CONCAT(...)): TRIM in MySQL toglie gli
    // spazi, non i newline, quindi su una nota vuota lasciava una riga vuota in
    // testa. CONCAT_WS salta gli argomenti NULL e il separatore non compare.
    $sql = "UPDATE portal_listings
               SET status = 'removed',
                   notes  = CONCAT_WS('\n', NULLIF(notes, ''), ?)
             WHERE property_id = ?
               AND status IN ($placeholders)";

    $stmt = $db->prepare($sql);
    $stmt->execute(array_merge([$reason, $propertyId], PORTAL_LIVE_LISTING_STATUSES));

    return $stmt->rowCount();
}

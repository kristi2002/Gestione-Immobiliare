<?php
/**
 * Il contratto muove lo stato dell'immobile.
 *
 * Il buco che questo file chiude: `api/contracts.php` non toccava mai
 * `properties.status` e non emetteva alcun evento. Il ritiro automatico dai
 * portali (lib/portal_lifecycle.php) esisteva gia' e funzionava, ma ascoltava
 * `property.status_changed` — un evento che, per un immobile appena affittato,
 * non arrivava mai: qualcuno doveva ricordarsi di aprire la scheda immobile e
 * cambiare lo stato a mano. Finche' non lo faceva, la casa restava pubblicata e
 * continuava a occupare uno slot a pagamento e a generare richieste di visita
 * per un appartamento gia' occupato.
 *
 * Direzione: si sincronizza SOLO all'entrata in vigore (disponibile →
 * affittato). La scadenza NON rimette l'immobile a disponibile, ed e' una
 * scelta: alla fine di una locazione il rinnovo e' l'esito piu' comune, e
 * ripubblicare da soli la casa di un inquilino che sta rinnovando sarebbe un
 * danno peggiore del ritardo di una riga da aggiornare a mano. La scadenza
 * genera un promemoria (config/contract_expirations.php), che e' la richiesta
 * di una decisione umana — che e' quello che serve li'.
 */

require_once __DIR__ . '/portal_lifecycle.php';
require_once __DIR__ . '/../config/automation_events.php';

/**
 * Una locazione occupa l'immobile quando e' in vigore: firmata o lasciata in
 * "Automatico" (NULL), decorrenza raggiunta, scadenza non ancora superata.
 * Bozze e contratti annullati non occupano nulla — la stessa regola del filtro
 * "Attivi" e della generazione dello scadenzario.
 */
function contractOccupiesProperty(array $contract, ?string $today = null): bool
{
    if (($contract['contract_type'] ?? '') !== 'locazione') {
        return false;
    }

    $status = $contract['status'] ?? null;
    if (!($status === null || $status === '' || $status === 'signed')) {
        return false;
    }

    $today = $today ?? date('Y-m-d');
    $start = $contract['start_date'] ?? null;
    $end   = $contract['end_date'] ?? null;

    if ($start === null || substr((string) $start, 0, 10) > $today) {
        return false; // decorrenza futura: l'immobile e' ancora libero
    }
    if ($end !== null && substr((string) $end, 0, 10) < $today) {
        return false; // gia' scaduto
    }

    return true;
}

/**
 * Porta l'immobile ad "affittato" e ritira le pubblicazioni attive.
 *
 * Non lancia mai: salvare il contratto e' l'operazione che l'agente ha chiesto,
 * e non deve fallire perche' la sincronizzazione dello stato immobile e' andata
 * storta. In compenso lascia traccia nel log.
 *
 * @return array{changed:bool, old_status:?string, retired:int}
 */
function contractSyncPropertyOccupancy(PDO $db, int $propertyId): array
{
    $out = ['changed' => false, 'old_status' => null, 'retired' => 0];
    if ($propertyId <= 0) return $out;

    try {
        $stmt = $db->prepare('SELECT status FROM properties WHERE id = :id');
        $stmt->execute(['id' => $propertyId]);
        $current = $stmt->fetch();
        if (!$current) return $out;

        $old = (string) $current['status'];
        $out['old_status'] = $old;

        // Si tocca solo 'available'. Un immobile 'sold' o 'archived' non torna
        // affittato per via di un contratto, e sovrascrivere quello stato
        // significherebbe che il gestionale ribalta una decisione presa
        // altrove — proprio il tipo di automatismo che fa perdere fiducia.
        if ($old !== 'available') return $out;

        $db->prepare('UPDATE properties SET status = :s WHERE id = :id')
           ->execute(['s' => 'rented', 'id' => $propertyId]);
        $out['changed'] = true;

        // Il ritiro si fa SUBITO, non solo tramite l'evento: la coda viene
        // drenata dal cron, e nel frattempo l'annuncio resterebbe online. La
        // chiamata e' idempotente (agisce solo su publishing/published), quindi
        // la reazione di sistema che scattera' sull'evento non fa danni.
        $out['retired'] = portalRetireListingsForProperty($db, $propertyId, 'rented');

        // L'evento serve comunque: le REGOLE dell'utente ("immobile affittato →
        // avvisa il proprietario") ascoltano property.status_changed e non
        // saprebbero nulla di questo cambio se lo facessimo in silenzio.
        emitAutomationEvent($db, 'property.status_changed', 'property', $propertyId, [
            'property_id' => $propertyId,
            'old_status'  => $old,
            'new_status'  => 'rented',
            'reason'      => 'contract',
        ]);
    } catch (Throwable $e) {
        error_log('[contratti] sincronizzazione stato immobile fallita (#' . $propertyId . '): ' . $e->getMessage());
    }

    return $out;
}

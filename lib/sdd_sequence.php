<?php
/**
 * Sequenza SDD (FRST/RCUR) — decisione e registro.
 *
 * Vive in lib/ e non dentro api/generate_sdd.php per una ragione pratica: qui la
 * logica e' testabile contro un database vero senza passare da api_bootstrap.php
 * (sessione, ruoli, exit). E' la parte che, sbagliata, fa respingere gli incassi.
 */

/**
 * Assegna a ogni addebito la sequenza SDD (FRST = primo incasso su quel mandato,
 * RCUR = successivi).
 *
 * La sequenza non e' un dato del pagamento: e' una funzione di quello che e' gia'
 * stato esportato per lo stesso mandato. Tre casi, in quest'ordine:
 *
 *   1. il pagamento e' gia' in `sdd_collections` → si RIUSA la sequenza scritta
 *      allora. Riscaricare il file di marzo non deve trasformare in RCUR un
 *      addebito che alla banca e' arrivato come FRST;
 *   2. il mandato (tenant_id + UMR) non ha mai avuto un export → FRST;
 *   3. altrimenti RCUR.
 *
 * Un mandato NUOVO sullo stesso inquilino (IBAN cambiato, nuova firma → nuovo
 * UMR) ricade nel caso 2 e riparte da FRST, che e' esattamente il comportamento
 * previsto dallo schema SEPA.
 *
 * @param array<int,array<string,mixed>> $txs
 * @return array<int,array<string,mixed>>
 */
function sddAssignSequenceTypes(PDO $db, array $txs): array
{
    if (!$txs) {
        return $txs;
    }

    $paymentIds = array_map(fn($t) => (int) $t['payment_id'], $txs);
    $ph = implode(',', array_fill(0, count($paymentIds), '?'));

    // Caso 1: sequenze gia' assegnate a questi pagamenti.
    $stmt = $db->prepare("SELECT payment_id, seq_type FROM sdd_collections WHERE payment_id IN ($ph)");
    $stmt->execute($paymentIds);
    $already = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

    // Caso 2/3: quali mandati hanno gia' una storia. Una query sola per l'intero
    // lotto — con una query per riga un export di cinquanta canoni ne farebbe
    // cinquanta, tutte identiche nella forma.
    $seen = [];
    $tenantIds = array_unique(array_map(fn($t) => (int) $t['tenant_id'], $txs));
    $tph = implode(',', array_fill(0, count($tenantIds), '?'));
    $stmt = $db->prepare(
        "SELECT DISTINCT tenant_id, mandate_ref FROM sdd_collections WHERE tenant_id IN ($tph)"
    );
    $stmt->execute(array_values($tenantIds));
    foreach ($stmt->fetchAll() as $row) {
        $seen[$row['tenant_id'] . '|' . $row['mandate_ref']] = true;
    }

    foreach ($txs as $i => $t) {
        $paymentId = (int) $t['payment_id'];
        if (isset($already[$paymentId])) {
            $txs[$i]['seq_type'] = $already[$paymentId];
            continue;
        }
        // Chiave dentro il lotto corrente: due canoni dello stesso inquilino nello
        // stesso file (arretrato + mese corrente) non possono essere entrambi FRST.
        $key = $t['tenant_id'] . '|' . $t['mandate_id'];
        $txs[$i]['seq_type'] = isset($seen[$key]) ? 'RCUR' : 'FRST';
        $seen[$key] = true;
    }

    return $txs;
}

/**
 * Scrive nel registro le sequenze appena consegnate alla banca.
 *
 * INSERT IGNORE piu' UNIQUE(payment_id): una ri-generazione dello stesso mese non
 * duplica nulla e non riscrive le sequenze (che a quel punto sono gia' state
 * riusate da sddAssignSequenceTypes). L'indice unico parziale `uq_sdd_collections_frst`
 * fa da rete sull'unico caso che le due query non possono coprire da sole — due
 * amministratori che generano il file nello stesso momento: il secondo FRST viene
 * scartato dal DB invece di finire nel registro.
 *
 * @param array<int,array<string,mixed>> $txs
 */
function sddRecordExport(PDO $db, array $txs, string $collectionDate, string $msgId, ?int $adminId): void
{
    $stmt = $db->prepare(
        'INSERT IGNORE INTO sdd_collections
            (payment_id, tenant_id, mandate_ref, seq_type, collection_date, msg_id, exported_by)
         VALUES (:payment_id, :tenant_id, :mandate_ref, :seq_type, :collection_date, :msg_id, :exported_by)'
    );

    $db->beginTransaction();
    try {
        foreach ($txs as $t) {
            $stmt->execute([
                'payment_id'      => (int) $t['payment_id'],
                'tenant_id'       => (int) $t['tenant_id'],
                'mandate_ref'     => (string) $t['mandate_id'],
                'seq_type'        => $t['seq_type'],
                'collection_date' => $collectionDate,
                'msg_id'          => $msgId,
                'exported_by'     => $adminId ?: null,
            ]);
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

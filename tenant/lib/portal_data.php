<?php
/**
 * Portale Inquilino — strato dati.
 *
 * Tutte le letture del portale stanno qui, fuori dalla pagina, per un motivo
 * che non e' l'ordine: sono il perimetro di sicurezza. I commenti sulle query
 * dei documenti registrano DUE fughe gia' avvenute davvero (i documenti del
 * proprietario, e la carta d'identita' dell'inquilino precedente agganciata
 * allo stesso immobile). Tenerle in un unico posto significa che quel confine
 * si rilegge e si verifica in un file solo, invece di essere sparso nella vista.
 *
 * Regola per chi aggiunge una lettura: si filtra sull'IMMOBILE e sul CONTRATTO
 * dell'inquilino, MAI su `client_id` — quello e' il proprietario.
 */

require_once __DIR__ . '/../../config/portal_documents.php';

/**
 * Quante righe mostra ogni riquadro. Il portale non ha impaginatore: oltre
 * questi numeri le righe non sono raggiungibili in alcun modo, quindi il tetto
 * va detto. 36 mensilita' sono tre anni, ma una locazione 4+4 ne ha 96: senza
 * avviso l'inquilino vede lo storico interrompersi e non sa che c'e' dell'altro.
 */
const TENANT_PAYMENTS_LIMIT = 36;
const TENANT_DOCS_LIMIT     = 30;

/** Etichette italiane degli stati di pagamento. */
const TENANT_PAY_STATUS = [
    'pending'   => 'In attesa',
    'paid'      => 'Pagato',
    'late'      => 'In ritardo',
    'cancelled' => 'Annullato',
];

/**
 * Carica tutto cio' che il portale mostra, in un colpo solo.
 *
 * @return array{tenant: ?array, contract: ?array, payments: array, paymentsTotal: int,
 *               upcoming: array, documents: array, documentsTotal: int,
 *               paidTotal: float, lateTotal: float}
 */
function loadTenantPortalData(PDO $db, int $tenantId): array
{
    // Anagrafica. L'immobile e la locazione arrivano dal CONTRATTO in corso
    // (getTenantCurrentContract in config/db.php), non da una colonna fissa
    // sull'inquilino: la stessa persona puo' essere rilocata nel tempo.
    $stmt = $db->prepare("SELECT * FROM tenants WHERE id = :id");
    $stmt->execute(['id' => $tenantId]);
    $tenant = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

    $contract = $tenant ? getTenantCurrentContract($db, $tenantId) : null;

    if ($tenant) {
        foreach ([
            'property_id', 'address', 'city', 'cap', 'sqm', 'rooms',
            'description', 'lease_start', 'lease_end', 'monthly_rent',
        ] as $k) {
            $tenant[$k] = $contract[$k] ?? null;
        }
    }

    $propertyId = (int) ($tenant['property_id'] ?? 0);
    $contractId = (int) ($contract['contract_id'] ?? 0);

    // ── Pagamenti ───────────────────────────────────────────────────────────
    $payStmt = $db->prepare(
        "SELECT id, amount, due_date, paid_date, status, notes
         FROM payments WHERE tenant_id = :tid
         ORDER BY due_date DESC LIMIT " . TENANT_PAYMENTS_LIMIT
    );
    $payStmt->execute(['tid' => $tenantId]);
    $payments = $payStmt->fetchAll(PDO::FETCH_ASSOC);

    $payTotalStmt = $db->prepare("SELECT COUNT(*) FROM payments WHERE tenant_id = :tid");
    $payTotalStmt->execute(['tid' => $tenantId]);
    $paymentsTotal = (int) $payTotalStmt->fetchColumn();

    $upcomingStmt = $db->prepare(
        "SELECT id, amount, due_date, status
         FROM payments
         WHERE tenant_id = :tid AND status IN ('pending','late') AND due_date >= CURDATE()
         ORDER BY due_date ASC LIMIT 3"
    );
    $upcomingStmt->execute(['tid' => $tenantId]);
    $upcoming = $upcomingStmt->fetchAll(PDO::FETCH_ASSOC);

    // Totali dal DATABASE, non dalle 36 righe caricate sopra.
    //
    // Era un array_sum() sull'elenco TAGLIATO (ORDER BY due_date DESC LIMIT 36).
    // Su una locazione 4+4 lo scadenzario ha 96 rate e le 36 piu' recenti sono
    // in gran parte FUTURE, cioe' ancora da pagare: l'inquilino leggeva un
    // "totale pagato" piu' basso del vero dopo anni di affitti versati
    // puntualmente. Stesso errore gia' corretto nel portale proprietario.
    $totStmt = $db->prepare(
        "SELECT
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid_total,
            COALESCE(SUM(CASE WHEN status = 'late' THEN amount END), 0) AS late_total
         FROM payments WHERE tenant_id = :tid"
    );
    $totStmt->execute(['tid' => $tenantId]);
    $totals = $totStmt->fetch(PDO::FETCH_ASSOC) ?: ['paid_total' => 0, 'late_total' => 0];

    // ── Documenti ───────────────────────────────────────────────────────────
    // Perimetro ristretto alla locazione DI QUESTO inquilino: l'immobile
    // affittato o il proprio contratto. Deliberatamente NON la scheda cliente
    // del proprietario — filtrare per `client_id = owner` esponeva i documenti
    // personali del padrone di casa e le carte di ogni altro immobile.
    //
    // Il ramo "immobile" e' ristretto per tipo (config/portal_documents.php):
    // senza quel filtro l'inquilino attuale scaricava la carta d'identita' e i
    // verbali del precedente, agganciati allo stesso immobile. Dal proprio
    // contratto continua a vedere tutto, perche' quelli sono i suoi documenti.
    $docsWhere = "(property_id IS NOT NULL AND property_id = :pid AND " . tenantPropertyDocTypesSql() . ")
                  OR (contract_id IS NOT NULL AND contract_id = :cid)";

    $docsStmt = $db->prepare(
        "SELECT id, title, original_name, mime_type AS file_type, file_size, created_at
         FROM documents WHERE $docsWhere
         ORDER BY created_at DESC LIMIT " . TENANT_DOCS_LIMIT
    );
    $docsStmt->execute(['pid' => $propertyId, 'cid' => $contractId]);
    $documents = $docsStmt->fetchAll(PDO::FETCH_ASSOC);

    // Stesso perimetro: il totale deve contare le righe che l'inquilino avrebbe
    // diritto di vedere, non tutti i documenti del gestionale.
    $docsTotalStmt = $db->prepare("SELECT COUNT(*) FROM documents WHERE $docsWhere");
    $docsTotalStmt->execute(['pid' => $propertyId, 'cid' => $contractId]);

    return [
        'tenant'         => $tenant,
        'contract'       => $contract,
        'payments'       => $payments,
        'paymentsTotal'  => $paymentsTotal,
        'upcoming'       => $upcoming,
        'documents'      => $documents,
        'documentsTotal' => (int) $docsTotalStmt->fetchColumn(),
        'paidTotal'      => (float) $totals['paid_total'],
        'lateTotal'      => (float) $totals['late_total'],
    ];
}

<?php
/**
 * Scheda "Pagamenti".
 *
 * Attese: $payments, $paymentsTotal, $paidTotal, $lateTotal, $tenant.
 *
 * Su telefono la tabella si trasforma in un elenco di schede: ogni cella porta
 * `data-k` con la sua intestazione di colonna, che il CSS rimette davanti al
 * valore quando il <thead> sparisce (vedi 17-tenant-portal.css).
 */
?>
<div class="tp-section" id="tp-section-pagamenti" role="tabpanel" aria-labelledby="tp-tab-pagamenti">
    <div class="tp-stack">

        <div class="tp-tiles">
            <div class="tp-tile tp-tile--ok">
                <div class="tp-tile__k">Totale pagato</div>
                <div class="tp-tile__v"><?= tMoney($paidTotal, 0) ?></div>
            </div>
            <?php if ($lateTotal > 0): ?>
                <div class="tp-tile tp-tile--late">
                    <div class="tp-tile__k">In ritardo</div>
                    <div class="tp-tile__v"><?= tMoney($lateTotal, 0) ?></div>
                </div>
            <?php endif; ?>
            <div class="tp-tile">
                <div class="tp-tile__k">Canone mensile</div>
                <div class="tp-tile__v"><?= tMoney($tenant['monthly_rent'] ?? 0, 0) ?></div>
            </div>
        </div>

        <div class="card">
            <div class="tp-card__head">
                <?= tIcon('receipt', 'tp-card__ico') ?>
                <h3 class="tp-card__title">Storico pagamenti</h3>
            </div>

            <?php if (empty($payments)): ?>
                <?= tEmpty('receipt', 'Nessun pagamento registrato', 'Le rate compariranno qui appena l\'agenzia genera lo scadenzario.') ?>
            <?php else: ?>
                <div class="tp-table-wrap">
                    <table class="tp-table">
                        <thead>
                            <tr>
                                <th>Scadenza</th>
                                <th>Importo</th>
                                <th>Stato</th>
                                <th>Pagato il</th>
                                <th>Note</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($payments as $pay): ?>
                                <tr>
                                    <td data-k="Scadenza"><?= tDate($pay['due_date']) ?></td>
                                    <td data-k="Importo" class="tp-table__amt"><?= tMoney($pay['amount']) ?></td>
                                    <td data-k="Stato"><?= tPayBadge((string) $pay['status']) ?></td>
                                    <td data-k="Pagato il"><?= tDate($pay['paid_date']) ?></td>
                                    <td data-k="Note" class="tp-table__note"><?= tEsc($pay['notes'] ?? '') ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
                <?= tTruncNote(count($payments), $paymentsTotal) ?>
            <?php endif; ?>
        </div>

    </div>
</div>

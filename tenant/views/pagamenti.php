<?php
/**
 * Scheda "Pagamenti".
 *
 * Attese: $payments (insieme impaginato), $totals, $tenant, $agencyIban,
 * $agencyName.
 *
 * Su telefono la tabella si trasforma in un elenco di schede: ogni cella porta
 * `data-k` con la sua intestazione di colonna, che il CSS rimette davanti al
 * valore quando il <thead> sparisce (vedi 17-tenant-portal.css).
 */

// La causale suggerita. Il pagamento online non c'e' (il bottone Stripe era
// morto: chiamava un endpoint che pretende una sessione ADMIN), quindi il
// bonifico e' il modo vero con cui questi soldi si muovono. Dire quanto si
// deve senza dire dove versarlo era mezza informazione.
$causale = 'Canone di locazione';
if (!empty($tenant['address'])) {
    $causale .= ' — ' . $tenant['address'];
}
?>
<div class="tp-section" id="tp-section-pagamenti" role="tabpanel" aria-labelledby="tp-tab-pagamenti">
    <div class="tp-stack">

        <div class="tp-tiles">
            <div class="tp-tile tp-tile--ok">
                <div class="tp-tile__k">Totale pagato</div>
                <div class="tp-tile__v"><?= tMoney($totals['paid'], 0) ?></div>
            </div>
            <?php if ($totals['late'] > 0): ?>
                <div class="tp-tile tp-tile--late">
                    <div class="tp-tile__k">In ritardo</div>
                    <div class="tp-tile__v"><?= tMoney($totals['late'], 0) ?></div>
                </div>
            <?php endif; ?>
            <div class="tp-tile">
                <div class="tp-tile__k">Canone mensile</div>
                <div class="tp-tile__v"><?= tMoney($tenant['monthly_rent'] ?? 0, 0) ?></div>
            </div>
        </div>

        <?php if ($agencyIban !== ''): ?>
            <div class="card">
                <div class="tp-card__head">
                    <?= tIcon('landmark', 'tp-card__ico') ?>
                    <h3 class="tp-card__title">Come pagare</h3>
                </div>
                <p class="tp-card__sub">Bonifico bancario intestato a <?= tEsc($agencyName) ?>.</p>

                <div class="tp-copy">
                    <div class="tp-copy__k">IBAN</div>
                    <div class="tp-copy__row">
                        <code class="tp-copy__v" id="tp-iban"><?= tEsc(tIbanGroups($agencyIban)) ?></code>
                        <button type="button" class="tp-copy__btn" data-copy="#tp-iban"
                                aria-label="Copia l'IBAN"><?= tIcon('copy') ?><span>Copia</span></button>
                    </div>
                </div>

                <div class="tp-copy">
                    <div class="tp-copy__k">Causale suggerita</div>
                    <div class="tp-copy__row">
                        <code class="tp-copy__v" id="tp-causale"><?= tEsc($causale) ?></code>
                        <button type="button" class="tp-copy__btn" data-copy="#tp-causale"
                                aria-label="Copia la causale"><?= tIcon('copy') ?><span>Copia</span></button>
                    </div>
                </div>

                <p class="tp-note">
                    <?= tIcon('info', 'tp-note__ico') ?>
                    Indica sempre il mese di riferimento nella causale. I pagamenti risultano
                    registrati qui quando l'agenzia li ha verificati in banca.
                </p>
            </div>
        <?php endif; ?>

        <div class="card">
            <div class="tp-card__head">
                <?= tIcon('receipt', 'tp-card__ico') ?>
                <h3 class="tp-card__title">Storico pagamenti</h3>
                <?php if ($payments['total'] > 0): ?>
                    <span class="tp-card__badge"><span class="badge badge--muted"><?= (int) $payments['total'] ?></span></span>
                <?php endif; ?>
            </div>

            <?php if (empty($payments['rows'])): ?>
                <?= tEmpty('receipt', 'Nessun pagamento registrato',
                    'Le rate compariranno qui appena l\'agenzia genera lo scadenzario.') ?>
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
                            <?php foreach ($payments['rows'] as $pay): ?>
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
                <?= tPager($payments, 'pay', 'pagamenti') ?>
            <?php endif; ?>
        </div>

    </div>
</div>

<?php
/**
 * Scheda "Contratto".
 *
 * Attese: $lease (contratto per esteso, o null), $contractDocs (documenti del
 * proprio contratto), $tenant.
 *
 * Fino a ieri l'inquilino vedeva del proprio contratto quattro numeri infilati
 * nella scheda dell'immobile. Qui c'e' il resto di cio' che l'agenzia ha
 * registrato: cauzione, adeguamento ISTAT, estremi di registrazione.
 */

$CONTRACT_TYPE = [
    'locazione'      => 'Locazione',
    'compravendita'  => 'Compravendita',
    'preliminare'    => 'Preliminare',
    'mandato'        => 'Mandato',
    'altro'          => 'Altro',
];

$CONTRACT_STATUS = [
    'draft'     => ['Bozza',       'muted'],
    'sent'      => ['Inviato',     'info'],
    'signed'    => ['Firmato',     'success'],
    'expired'   => ['Scaduto',     'warning'],
    'cancelled' => ['Annullato',   'muted'],
];
?>
<div class="tp-section" id="tp-section-contratto" role="tabpanel" aria-labelledby="tp-tab-contratto">
    <div class="tp-stack">

        <?php if (!$lease): ?>
            <div class="card">
                <?= tEmpty('file-text', 'Nessun contratto disponibile',
                    "Non risulta un contratto collegato al tuo nominativo. Se pensi sia un errore, contatta l'agenzia.") ?>
            </div>
        <?php else: ?>
            <?php
            [$statusLabel, $statusVariant] = $CONTRACT_STATUS[$lease['status']] ?? ['—', 'muted'];
            $expiring = $lease['end_date'] && strtotime($lease['end_date']) >= time()
                        && strtotime($lease['end_date']) <= strtotime('+90 days');
            ?>

            <div class="card">
                <div class="tp-card__head">
                    <?= tIcon('file-signature', 'tp-card__ico') ?>
                    <h3 class="tp-card__title">
                        <?= tEsc($CONTRACT_TYPE[$lease['contract_type']] ?? $lease['contract_type']) ?>
                    </h3>
                    <span class="tp-card__badge">
                        <span class="badge badge--<?= tEsc($statusVariant) ?>"><?= tEsc($statusLabel) ?></span>
                    </span>
                </div>

                <?php if (!empty($lease['title'])): ?>
                    <p class="tp-card__sub"><?= tEsc($lease['title']) ?></p>
                <?php endif; ?>

                <div class="tp-facts">
                    <div class="tp-fact">
                        <span class="tp-fact__k">Decorrenza</span>
                        <span class="tp-fact__v"><?= tDate($lease['start_date']) ?></span>
                    </div>
                    <div class="tp-fact">
                        <span class="tp-fact__k">Scadenza</span>
                        <span class="tp-fact__v"><?= tDate($lease['end_date']) ?></span>
                    </div>
                    <div class="tp-fact">
                        <span class="tp-fact__k">Canone mensile</span>
                        <span class="tp-fact__v"><?= tMoney($lease['monthly_rent'] ?? 0) ?></span>
                    </div>
                    <div class="tp-fact">
                        <span class="tp-fact__k">Deposito cauzionale</span>
                        <span class="tp-fact__v">
                            <?= $lease['deposit'] !== null && (float) $lease['deposit'] > 0
                                ? tMoney($lease['deposit'])
                                : '—' ?>
                        </span>
                    </div>
                </div>

                <?php if ($expiring): ?>
                    <p class="tp-note tp-note--warn">
                        <?= tIcon('alarm-clock', 'tp-note__ico') ?>
                        Il contratto scade il <?= tDate($lease['end_date']) ?>. Per rinnovo o disdetta
                        contatta l'agenzia: i termini di preavviso sono indicati nel testo del contratto.
                    </p>
                <?php endif; ?>
            </div>

            <?php if ($lease['istat_update_enabled'] || $lease['last_istat_update']): ?>
                <div class="card">
                    <div class="tp-card__head">
                        <?= tIcon('trending-up', 'tp-card__ico') ?>
                        <h3 class="tp-card__title">Adeguamento ISTAT</h3>
                    </div>
                    <div class="tp-facts tp-facts--3">
                        <div class="tp-fact">
                            <span class="tp-fact__k">Aggiornamento</span>
                            <span class="tp-fact__v"><?= $lease['istat_update_enabled'] ? 'Previsto' : 'Non previsto' ?></span>
                        </div>
                        <div class="tp-fact">
                            <span class="tp-fact__k">Indice di partenza</span>
                            <span class="tp-fact__v">
                                <?= $lease['istat_baseline_index'] !== null ? tEsc(tNum($lease['istat_baseline_index'])) : '—' ?>
                                <?= $lease['istat_baseline_month'] ? '<small>(' . tEsc($lease['istat_baseline_month']) . ')</small>' : '' ?>
                            </span>
                        </div>
                        <div class="tp-fact">
                            <span class="tp-fact__k">Ultimo adeguamento</span>
                            <span class="tp-fact__v"><?= tDate($lease['last_istat_update']) ?></span>
                        </div>
                    </div>
                </div>
            <?php endif; ?>

            <?php if ($lease['registration_number'] || $lease['registration_date'] || $lease['cedolare_secca']): ?>
                <div class="card">
                    <div class="tp-card__head">
                        <?= tIcon('stamp', 'tp-card__ico') ?>
                        <h3 class="tp-card__title">Registrazione</h3>
                    </div>
                    <div class="tp-facts tp-facts--3">
                        <div class="tp-fact">
                            <span class="tp-fact__k">Numero</span>
                            <span class="tp-fact__v"><?= $lease['registration_number'] ? tEsc($lease['registration_number']) : '—' ?></span>
                        </div>
                        <div class="tp-fact">
                            <span class="tp-fact__k">Data</span>
                            <span class="tp-fact__v"><?= tDate($lease['registration_date']) ?></span>
                        </div>
                        <div class="tp-fact">
                            <span class="tp-fact__k">Ufficio</span>
                            <span class="tp-fact__v"><?= $lease['registration_office'] ? tEsc($lease['registration_office']) : '—' ?></span>
                        </div>
                        <div class="tp-fact">
                            <span class="tp-fact__k">Cedolare secca</span>
                            <span class="tp-fact__v"><?= $lease['cedolare_secca'] ? 'Sì' : 'No' ?></span>
                        </div>
                    </div>
                </div>
            <?php endif; ?>

            <div class="card">
                <div class="tp-card__head">
                    <?= tIcon('paperclip', 'tp-card__ico') ?>
                    <h3 class="tp-card__title">Copia del contratto</h3>
                </div>
                <?php if (empty($contractDocs)): ?>
                    <?= tEmpty('file-x', 'Nessuna copia caricata',
                        "L'agenzia non ha ancora allegato il documento firmato. Puoi richiederlo dalla scheda Assistenza.") ?>
                <?php else: ?>
                    <ul class="tp-doclist">
                        <?php foreach ($contractDocs as $d): ?>
                            <?php $label = $d['title'] ?: $d['original_name']; ?>
                            <li class="tp-doc">
                                <span class="tp-doc__ico"><?= tIcon(tDocIcon($d['original_name'] ?? '')) ?></span>
                                <div class="tp-doc__body">
                                    <div class="tp-doc__name" title="<?= tEsc($label) ?>"><?= tEsc($label) ?></div>
                                    <div class="tp-doc__meta"><?= tEsc(tDate($d['created_at'])) ?></div>
                                </div>
                                <a class="tp-doc__get"
                                   href="../api/download_document.php?id=<?= (int) $d['id'] ?>"
                                   target="_blank" rel="noopener"
                                   aria-label="Scarica <?= tEsc($label) ?>"><?= tIcon('download') ?></a>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                <?php endif; ?>
            </div>
        <?php endif; ?>

    </div>
</div>

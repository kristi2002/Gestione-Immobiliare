<?php
/**
 * Scheda "Documenti".
 *
 * Attese: $documents (insieme impaginato).
 *
 * Il perimetro di cosa finisce in questo elenco e' deciso in
 * lib/portal_data.php, non qui: la vista non filtra nulla.
 */
?>
<div class="tp-section" id="tp-section-documenti" role="tabpanel" aria-labelledby="tp-tab-documenti">
    <div class="card">
        <div class="tp-card__head">
            <?= tIcon('folder', 'tp-card__ico') ?>
            <h3 class="tp-card__title">I miei documenti</h3>
            <?php if ($documents['total'] > 0): ?>
                <span class="tp-card__badge"><span class="badge badge--muted"><?= (int) $documents['total'] ?></span></span>
            <?php endif; ?>
        </div>

        <?php if (empty($documents['rows'])): ?>
            <?= tEmpty('folder-open', 'Nessun documento disponibile',
                'Qui troverai il contratto e le carte legate al tuo immobile.') ?>
        <?php else: ?>
            <ul class="tp-doclist">
                <?php foreach ($documents['rows'] as $d): ?>
                    <?php
                    $label = $d['title'] ?: $d['original_name'];
                    $size  = tFileSize($d['file_size'] ?? 0);
                    $meta  = tDate($d['created_at']) . ($size !== '' ? ' · ' . $size : '');
                    ?>
                    <li class="tp-doc">
                        <span class="tp-doc__ico"><?= tIcon(tDocIcon($d['original_name'] ?? '')) ?></span>
                        <div class="tp-doc__body">
                            <div class="tp-doc__name" title="<?= tEsc($label) ?>"><?= tEsc($label) ?></div>
                            <div class="tp-doc__meta"><?= tEsc($meta) ?></div>
                        </div>
                        <a class="tp-doc__get"
                           href="../api/download_document.php?id=<?= (int) $d['id'] ?>"
                           target="_blank" rel="noopener"
                           title="Scarica <?= tEsc($label) ?>"
                           aria-label="Scarica <?= tEsc($label) ?>"><?= tIcon('download') ?></a>
                    </li>
                <?php endforeach; ?>
            </ul>
            <?= tPager($documents, 'doc', 'documenti') ?>
        <?php endif; ?>
    </div>
</div>

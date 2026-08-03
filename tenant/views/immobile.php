<?php
/**
 * Scheda "Il mio immobile".
 *
 * Attese: $tenant (array|null), $upcoming, $surveys, $agencyPhone, $agencyEmail.
 */
?>
<div class="tp-section is-active" id="tp-section-immobile" role="tabpanel" aria-labelledby="tp-tab-immobile">
    <div class="tp-stack">

        <?php if (!empty($surveys)): ?>
            <?php $s = $surveys[0]; ?>
            <div class="card tp-invite">
                <div class="tp-invite__ico"><?= tIcon('message-square-heart') ?></div>
                <div class="tp-invite__body">
                    <div class="tp-invite__t">Com'è andata?</div>
                    <p class="tp-invite__s">
                        C'è un breve questionario da compilare: bastano due minuti e aiuta
                        l'agenzia a capire come sta andando la tua locazione.
                    </p>
                </div>
                <a class="btn btn--primary tp-invite__cta"
                   href="survey.php?token=<?= tEsc($s['token']) ?>">Rispondi</a>
            </div>
        <?php endif; ?>

        <?php if (!$tenant || !$tenant['address']): ?>
            <div class="card">
                <?= tEmpty(
                    'home',
                    'Nessuna locazione attiva',
                    "Non risulta un contratto in corso a tuo nome. Se pensi sia un errore, contatta l'agenzia."
                ) ?>
            </div>
        <?php else: ?>

            <div class="card">
                <h2 class="tp-hero__addr"><?= tEsc($tenant['address']) ?></h2>
                <p class="tp-hero__city">
                    <?= tEsc($tenant['city']) ?><?= $tenant['cap'] ? ' · CAP ' . tEsc($tenant['cap']) : '' ?>
                </p>

                <div class="tp-facts">
                    <div class="tp-fact">
                        <span class="tp-fact__k">Superficie</span>
                        <span class="tp-fact__v"><?= $tenant['sqm'] ? tEsc(tNum($tenant['sqm'])) . ' mq' : '—' ?></span>
                    </div>
                    <div class="tp-fact">
                        <span class="tp-fact__k">Locali</span>
                        <span class="tp-fact__v"><?= $tenant['rooms'] ? tEsc($tenant['rooms']) : '—' ?></span>
                    </div>
                    <div class="tp-fact">
                        <span class="tp-fact__k">Canone mensile</span>
                        <span class="tp-fact__v"><?= tMoney($tenant['monthly_rent'] ?? 0) ?></span>
                    </div>
                    <div class="tp-fact">
                        <span class="tp-fact__k">Contratto</span>
                        <span class="tp-fact__v">
                            <?= tDate($tenant['lease_start']) ?><?= $tenant['lease_end'] ? ' → ' . tDate($tenant['lease_end']) : '' ?>
                        </span>
                    </div>
                </div>

                <?php if (!empty($tenant['description'])): ?>
                    <p class="tp-hero__desc"><?= nl2br(tEsc($tenant['description'])) ?></p>
                <?php endif; ?>
            </div>

        <?php endif; ?>

        <?php if (!empty($upcoming)): ?>
            <div class="card tp-alert-card">
                <div class="tp-card__head">
                    <?= tIcon('alarm-clock', 'tp-card__ico') ?>
                    <h3 class="tp-card__title">Prossime scadenze</h3>
                </div>
                <ul class="tp-duelist">
                    <?php foreach ($upcoming as $u): ?>
                        <li class="tp-due">
                            <span>
                                <span class="tp-due__amt"><?= tMoney($u['amount']) ?></span>
                                <span class="tp-due__date"> · <?= tDate($u['due_date']) ?></span>
                            </span>
                            <?= tPayBadge((string) $u['status']) ?>
                        </li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <?php if ($agencyPhone || $agencyEmail): ?>
            <div class="card">
                <div class="tp-card__head">
                    <?= tIcon('building-2', 'tp-card__ico') ?>
                    <h3 class="tp-card__title">Contatti dell'agenzia</h3>
                </div>
                <?php if ($agencyPhone): ?>
                    <div class="tp-contact">
                        <span class="tp-contact__ico"><?= tIcon('phone') ?></span>
                        <span>
                            <span class="tp-contact__k">Telefono</span><br>
                            <a class="tp-contact__v" href="tel:<?= tEsc($agencyPhone) ?>"><?= tEsc($agencyPhone) ?></a>
                        </span>
                    </div>
                <?php endif; ?>
                <?php if ($agencyEmail): ?>
                    <div class="tp-contact">
                        <span class="tp-contact__ico"><?= tIcon('mail') ?></span>
                        <span>
                            <span class="tp-contact__k">Email</span><br>
                            <a class="tp-contact__v" href="mailto:<?= tEsc($agencyEmail) ?>"><?= tEsc($agencyEmail) ?></a>
                        </span>
                    </div>
                <?php endif; ?>
            </div>
        <?php endif; ?>

    </div>
</div>

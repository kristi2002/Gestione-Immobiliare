<?php
/**
 * Scheda "Assistenza".
 *
 * Attese: $agencyPhone, $agencyEmail.
 *
 * NOTA — questo modulo spedisce e basta: la richiesta finisce in `reminders` e
 * l'inquilino non la rivede mai piu'. Lo storico con lo stato e' il punto 2
 * della fase 2 (docs/planning/TENANT_PORTAL_OVERHAUL.md); qui non si fa finta
 * che ci sia gia'.
 */
$types = [
    ['key' => 'maintenance', 'icon' => 'wrench',        'label' => 'Manutenzione'],
    ['key' => 'document',    'icon' => 'file-text',     'label' => 'Documento'],
    ['key' => 'info',        'icon' => 'circle-help',   'label' => 'Informazioni'],
    ['key' => 'other',       'icon' => 'message-circle','label' => 'Altro'],
];
?>
<div class="tp-section" id="tp-section-assistenza" role="tabpanel" aria-labelledby="tp-tab-assistenza">
    <div class="tp-stack">

        <div class="card">
            <div class="tp-card__head">
                <?= tIcon('life-buoy', 'tp-card__ico') ?>
                <h3 class="tp-card__title">Invia una richiesta</h3>
            </div>
            <p class="tp-card__sub">
                Segnala un problema, richiedi un documento o contatta l'agenzia.
            </p>

            <div id="tp-request-alert" class="alert" hidden></div>

            <div class="tp-types" role="radiogroup" aria-label="Tipo di richiesta">
                <?php foreach ($types as $i => $t): ?>
                    <button type="button"
                            class="tp-type<?= $i === 0 ? ' is-on' : '' ?>"
                            data-type="<?= tEsc($t['key']) ?>"
                            role="radio"
                            aria-checked="<?= $i === 0 ? 'true' : 'false' ?>">
                        <?= tIcon($t['icon'], 'tp-type__ico') ?>
                        <span><?= tEsc($t['label']) ?></span>
                    </button>
                <?php endforeach; ?>
            </div>

            <form id="tp-request-form" novalidate>
                <div class="form-group">
                    <label for="tp-req-subject">Oggetto *</label>
                    <input type="text" id="tp-req-subject" class="form-input" required
                           maxlength="200" autocomplete="off"
                           placeholder="Es. Perdita d'acqua in bagno">
                </div>
                <div class="form-group">
                    <label for="tp-req-message">Messaggio *</label>
                    <textarea id="tp-req-message" class="form-textarea" rows="5" required
                              maxlength="4000"
                              placeholder="Descrivi il problema o la richiesta in dettaglio…"></textarea>
                </div>
                <button type="submit" class="btn btn--primary" id="tp-req-send">Invia richiesta</button>
            </form>
        </div>

        <?php if ($agencyPhone || $agencyEmail): ?>
            <div class="card">
                <div class="tp-card__head">
                    <?= tIcon('phone-call', 'tp-card__ico') ?>
                    <h3 class="tp-card__title">Contatti diretti</h3>
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

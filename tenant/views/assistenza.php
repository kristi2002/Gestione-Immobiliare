<?php
/**
 * Scheda "Assistenza".
 *
 * Attese: $agencyPhone, $agencyEmail.
 *
 * Da adesso il modulo non spedisce piu' nel vuoto: sotto c'e' lo storico con
 * l'avanzamento di ogni richiesta. Prima la riga finiva in `reminders` e
 * spariva — niente numero, niente stato, nessuna risposta — ed era l'unica
 * cosa che il portale lasciasse fare.
 *
 * Attese: $requests (insieme impaginato), $agencyPhone, $agencyEmail.
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

        <div class="card">
            <div class="tp-card__head">
                <?= tIcon('inbox', 'tp-card__ico') ?>
                <h3 class="tp-card__title">Le mie richieste</h3>
                <?php if (($requests['total'] ?? 0) > 0): ?>
                    <span class="tp-card__badge"><span class="badge badge--muted"><?= (int) $requests['total'] ?></span></span>
                <?php endif; ?>
            </div>

            <?php if (empty($requests['rows'])): ?>
                <?= tEmpty('inbox', 'Non hai ancora inviato richieste',
                    'Quelle che invii compaiono qui, con il loro stato di avanzamento.') ?>
            <?php else: ?>
                <ul class="tp-reqlist">
                    <?php foreach ($requests['rows'] as $r): ?>
                        <?php
                        // Il titolo in archivio e' "[Richiesta tipo] Oggetto": all'inquilino
                        // interessa l'oggetto, il tipo lo diciamo con la sua etichetta.
                        $subject = preg_replace('/^\[Richiesta [a-z]+\]\s*/i', '', (string) $r['title']);
                        // La descrizione porta in coda la firma "— Inviato da: …",
                        // che chi legge e': toglierla e' meno rumore.
                        $body = preg_replace('/\R+—\s*Inviato da:.*$/su', '', (string) $r['description']);
                        ?>
                        <li class="tp-req">
                            <div class="tp-req__top">
                                <span class="tp-req__id">#<?= (int) $r['id'] ?></span>
                                <span class="tp-req__type"><?= tEsc(TENANT_REQUEST_LABELS[$r['request_type']] ?? $r['request_type']) ?></span>
                                <span class="tp-req__spacer"></span>
                                <?= tRequestBadge($r['maintenance_status'], $r['status']) ?>
                            </div>
                            <div class="tp-req__subject"><?= tEsc($subject) ?></div>
                            <?php if (trim((string) $body) !== ''): ?>
                                <p class="tp-req__body"><?= nl2br(tEsc(trim($body))) ?></p>
                            <?php endif; ?>
                            <div class="tp-req__meta">
                                Inviata il <?= tDate($r['created_at']) ?>
                                <?php if ($r['updated_at'] && substr((string) $r['updated_at'], 0, 10) !== substr((string) $r['created_at'], 0, 10)): ?>
                                    · aggiornata il <?= tDate($r['updated_at']) ?>
                                <?php endif; ?>
                            </div>
                        </li>
                    <?php endforeach; ?>
                </ul>
                <?= tPager($requests, 'req', 'assistenza') ?>
            <?php endif; ?>
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

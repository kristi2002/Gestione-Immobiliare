<?php
/**
 * Scheda "Il mio account".
 *
 * Attese: $tenant, $name.
 *
 * Non e' una scheda della barra in basso: ci si arriva dall'icona in alto (o
 * dal piede della barra laterale). Ci si entra di rado — non merita uno dei
 * cinque posti che il pollice raggiunge.
 */
?>
<div class="tp-section" id="tp-section-account" role="tabpanel" aria-labelledby="tp-tab-account">
    <div class="tp-stack">

        <div class="card">
            <div class="tp-card__head">
                <?= tIcon('user-round', 'tp-card__ico') ?>
                <h3 class="tp-card__title">I miei dati</h3>
            </div>

            <div class="tp-facts tp-facts--2">
                <div class="tp-fact">
                    <span class="tp-fact__k">Nominativo</span>
                    <span class="tp-fact__v"><?= tEsc($name) ?></span>
                </div>
                <div class="tp-fact">
                    <span class="tp-fact__k">Codice fiscale</span>
                    <span class="tp-fact__v"><?= $tenant['codice_fiscale'] ? tEsc($tenant['codice_fiscale']) : '—' ?></span>
                </div>
            </div>

            <p class="tp-note">
                <?= tIcon('info', 'tp-note__ico') ?>
                Nominativo, codice fiscale e indirizzo email sono gestiti dall'agenzia.
                Per correggerli scrivi dalla scheda Assistenza.
            </p>
        </div>

        <div class="card">
            <div class="tp-card__head">
                <?= tIcon('mail', 'tp-card__ico') ?>
                <h3 class="tp-card__title">Recapiti</h3>
            </div>

            <div id="tp-contact-alert" class="alert" hidden></div>

            <form id="tp-contact-form" novalidate>
                <div class="form-group">
                    <label for="tp-acc-email">Email di accesso</label>
                    <input type="email" id="tp-acc-email" class="form-input"
                           value="<?= tEsc($tenant['email'] ?? '') ?>" readonly disabled>
                    <small class="tp-field-hint">
                        E' l'indirizzo con cui entri nel portale: si cambia solo tramite l'agenzia.
                    </small>
                </div>
                <div class="form-group">
                    <label for="tp-acc-phone">Telefono</label>
                    <input type="tel" id="tp-acc-phone" class="form-input" maxlength="30"
                           autocomplete="tel" placeholder="Es. 3331234567"
                           value="<?= tEsc($tenant['phone'] ?? '') ?>">
                </div>
                <button type="submit" class="btn btn--primary" id="tp-contact-save">Salva recapito</button>
            </form>
        </div>

        <div class="card">
            <div class="tp-card__head">
                <?= tIcon('lock', 'tp-card__ico') ?>
                <h3 class="tp-card__title">Cambia password</h3>
            </div>

            <div id="tp-pwd-alert" class="alert" hidden></div>

            <form id="tp-pwd-form" novalidate>
                <div class="form-group">
                    <label for="tp-pwd-current">Password attuale *</label>
                    <input type="password" id="tp-pwd-current" class="form-input"
                           autocomplete="current-password" required>
                </div>
                <div class="form-group">
                    <label for="tp-pwd-next">Nuova password *</label>
                    <input type="password" id="tp-pwd-next" class="form-input"
                           autocomplete="new-password" minlength="<?= PASSWORD_MIN_LENGTH ?>" required>
                    <small class="tp-field-hint">Almeno <?= PASSWORD_MIN_LENGTH ?> caratteri.</small>
                </div>
                <div class="form-group">
                    <label for="tp-pwd-confirm">Ripeti la nuova password *</label>
                    <input type="password" id="tp-pwd-confirm" class="form-input"
                           autocomplete="new-password" minlength="<?= PASSWORD_MIN_LENGTH ?>" required>
                </div>
                <button type="submit" class="btn btn--primary" id="tp-pwd-save">Aggiorna password</button>
            </form>
        </div>

        <div class="card">
            <a href="logout.php" class="btn btn--outline tp-btn-block">
                <?= tIcon('log-out') ?> Esci dal portale
            </a>
        </div>

    </div>
</div>

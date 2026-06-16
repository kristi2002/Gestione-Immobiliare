/**
 * Global pretty confirmation dialog — replaces the native window.confirm().
 *
 * Usage:
 *   if (await confirmDialog('Eliminare questo file?')) { ... }
 *   await confirmDialog('Testo', { title: 'Conferma', confirmText: 'Elimina', danger: true });
 *
 * Returns a Promise<boolean>.
 */
(function () {
    'use strict';

    let activeResolve = null;
    let overlay = null;

    function build() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="confirm-dialog" role="dialog" aria-modal="true">
                <div class="confirm-dialog__icon" id="confirm-icon">🗑️</div>
                <h3 class="confirm-dialog__title" id="confirm-title">Conferma</h3>
                <p class="confirm-dialog__message" id="confirm-message"></p>
                <div class="confirm-dialog__actions">
                    <button type="button" class="btn btn--ghost" id="confirm-cancel">Annulla</button>
                    <button type="button" class="btn btn--danger" id="confirm-ok">Conferma</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('#confirm-cancel').addEventListener('click', () => close(false));
        overlay.querySelector('#confirm-ok').addEventListener('click', () => close(true));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        });
        document.addEventListener('keydown', (e) => {
            if (overlay.hidden) return;
            if (e.key === 'Escape') close(false);
            if (e.key === 'Enter') close(true);
        });
    }

    function close(result) {
        if (!overlay) return;
        overlay.hidden = true;
        document.body.classList.remove('confirm-open');
        const resolve = activeResolve;
        activeResolve = null;
        if (resolve) resolve(result);
    }

    window.confirmDialog = function (message, opts = {}) {
        build();

        // Resolve any previous pending dialog as cancelled.
        if (activeResolve) close(false);

        const danger = opts.danger !== false; // default to danger (most uses are deletions)
        overlay.querySelector('#confirm-icon').textContent   = opts.icon || (danger ? '🗑️' : '❓');
        overlay.querySelector('#confirm-title').textContent  = opts.title || 'Conferma';
        overlay.querySelector('#confirm-message').textContent = message || 'Sei sicuro?';

        const okBtn = overlay.querySelector('#confirm-ok');
        okBtn.textContent = opts.confirmText || (danger ? 'Elimina' : 'Conferma');
        okBtn.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');

        overlay.querySelector('#confirm-cancel').textContent = opts.cancelText || 'Annulla';

        overlay.hidden = false;
        document.body.classList.add('confirm-open');
        setTimeout(() => okBtn.focus(), 30);

        return new Promise((resolve) => { activeResolve = resolve; });
    };
})();

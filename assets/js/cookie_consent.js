/**
 * Minimal cookie/consent notice. The platform sets only strictly-necessary
 * functional cookies (session). This banner informs the user and records their
 * acknowledgement in localStorage; it links to the privacy notice (informativa).
 * Self-injecting — include with a single <script src> tag.
 */
(function () {
    'use strict';
    var KEY = 'gi_cookie_consent_v1';
    try {
        if (localStorage.getItem(KEY)) return;
    } catch (e) { /* localStorage unavailable — show anyway */ }

    function base() {
        // Resolve privacy.php relative to app root (works from /, /tenant/, /owner/).
        var p = window.location.pathname;
        if (p.indexOf('/tenant/') !== -1 || p.indexOf('/owner/') !== -1) return '../privacy.php';
        return 'privacy.php';
    }

    function build() {
        var bar = document.createElement('div');
        bar.setAttribute('role', 'dialog');
        bar.setAttribute('aria-label', 'Informativa cookie');
        bar.style.cssText = [
            'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:9999',
            'max-width:720px', 'margin:0 auto', 'padding:16px 18px',
            'background:#0d2140', 'color:#fff', 'border-radius:10px',
            'box-shadow:0 8px 30px rgba(0,0,0,.25)', 'font-size:14px', 'line-height:1.5',
            'display:flex', 'flex-wrap:wrap', 'gap:12px', 'align-items:center', 'justify-content:space-between'
        ].join(';');

        var txt = document.createElement('span');
        txt.style.flex = '1 1 320px';
        txt.innerHTML = 'Questo gestionale utilizza solo cookie tecnici necessari al funzionamento (sessione). ' +
            'Consulta l\'<a href="' + base() + '" style="color:#7db3ff;text-decoration:underline">informativa privacy</a>.';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Ho capito';
        btn.style.cssText = 'background:#206bac;color:#fff;border:0;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:14px;font-weight:600';
        btn.addEventListener('click', function () {
            try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
            bar.remove();
        });

        bar.appendChild(txt);
        bar.appendChild(btn);
        document.body.appendChild(bar);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();

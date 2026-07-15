// Settings page — pure helpers (input -> output). Stateless.

export function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

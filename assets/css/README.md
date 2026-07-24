# CSS system — how styling works here (read before editing CSS)

The cascade in this app is managed **by source order across layered files**, not by a
methodology like CSS-modules. That's powerful but collision-prone, so this file is the
contract: follow it and your styles won't fight the shell or another page.

---

## 1. How the CSS is built and loaded

Source lives in `assets/css/`. The global stylesheet is assembled from **nine numbered
layers** under `style/`, concatenated by `bundle.css` and minified by esbuild:

```
bundle.css  ──(@import ×9, in order)──▶  esbuild  ──▶  assets/dist/app.min.css
```

Build it with:

```bash
npm run build:assets
```

`index.php` loads stylesheets in this exact order — **the last one to set a property
wins**:

1. `assets/dist/app.min.css` (the built bundle; falls back to `assets/css/style.css`, the
   same 9 layers via `@import`, if the bundle isn't built)
2. `branding.css.php` — per-deployment brand variables (dynamic)
3. `assets/css/theme-orlandi.css` — **the theme; loads last on purpose and overrides the
   bundle.** Brand-level visual decisions live here.
4. `leaflet.css` (third-party, map only)

> **You must rebuild** (`npm run build:assets`) after editing any file under `style/`, or
> the app keeps serving the old `app.min.css`. `theme-orlandi.css` and `branding.css.php`
> are **not** bundled — they're loaded directly, so edits to them take effect without a build.

### The nine layers and what each owns

| Layer | Owns |
|-------|------|
| `01-base.css` | **Design tokens (`:root`)** + base shell (`.sidebar`, `.topbar`, `.content-section`), base `.card`, the `.btn` system. The foundation. |
| `02-properties-media.css` | Properties split-view + map, media gallery |
| `03-clients-cards.css` | Client profile / cards, sidebar backdrop |
| `04-phase11.css` | Leads / visite / mappa / fatture / valutazioni / 2FA / CSV badges |
| `05-ui-polish.css` | Cross-cutting polish (zebra lists, card/topbar refinements) |
| `06-buttons-responsive.css` | Button visual polish + responsive |
| `07-refresh-2026.css` | 2026 refresh (typography, depth, focus/hover, shell tweaks) |
| `08-shell-dashboard.css` | Shell + dashboard redesign (light sidebar, topbar over content) |
| `09-filter-toolbar.css` | Unified filter toolbar + card-header alignment |

`06`–`08` are "era layers" written to override earlier shell/button rules by loading
later. That's the source of the known collisions in §4 — treat them as legacy.

---

## 2. Design tokens — the single source of truth

All colors, spacing, radii, shadows, motion, and **z-index** are CSS custom properties
declared in `:root` in **`01-base.css`**. `theme-orlandi.css` overrides the brand-level
values (it's loaded last). **Never hardcode** a color, shadow, or z-index — reference the
token, so one change propagates and nothing drifts.

```css
/* good */   .thing { color: var(--color-primary); box-shadow: var(--shadow-md); z-index: var(--z-dropdown); }
/* bad  */   .thing { color: #206bac;             box-shadow: 0 6px 18px …;      z-index: 1200; }
```

Add a new token to `01-base.css :root` (and, if it's brand-specific, override it in
`theme-orlandi.css`). Don't invent per-page color/shadow values.

### z-index ladder (single source — reference these, never raw numbers)

Declared as `--z-*` tokens in `01-base.css :root`:

| Token | Value | Layer |
|-------|-------|-------|
| `--z-content` | 1 | in-content stacking (cards, map panes) |
| `--z-sticky` | 300 | sticky table headers, in-content overlays |
| `--z-map-overlay` | 500 | map legend/controls above the Leaflet canvas |
| `--z-topbar` | 1050 | fixed topbar (**the rule lives in `theme-orlandi.css` — single source**) |
| `--z-sidebar` | 1100 | sidebar (above the topbar on the mobile overlay) |
| `--z-dropdown` | 1200 | menus, autocomplete, popovers |
| `--z-filterbar` | 1300 | docked filter toolbar, floating QR |
| `--z-modal` | 1400 | modal overlays |
| `--z-modal-nested` | 1600 | a modal opened from a modal |
| `--z-toast` | 1700 | toasts / notifications (above modals) |

> Note: several inline comments in the older layers still say "topbar (1150)". That value
> is **stale** — the topbar is 1050 (`theme-orlandi.css`). Trust this table.

---

## 3. Anti-collision rules (the convention)

1. **One selector, one home layer.** A component's rules live in exactly one file. If you
   genuinely need to override for the brand, do it in `theme-orlandi.css` (the designated
   last-wins theme) with a `/* overrides <file>: why */` comment — not by re-declaring the
   selector in another numbered layer.
2. **Namespace page/component classes.** Prefix classes by their block so they can't leak:
   `pp-*` (property profile), `lead-*`, `map-*`, `entity-card__*` (BEM-ish for shared
   cards). Never style a bare generic name (`.title`, `.row`, `.actions`) globally — it
   *will* collide. Scope it (`.pp-title`) or nest it under a namespaced parent.
3. **Don't touch the shell from a page layer.** `.sidebar`, `.topbar`, `.card`, `.btn`
   belong to the shell layers (`01`, and the era layers `06`–`08`). A page stylesheet must
   not redefine them — extend with a modifier (`.card--compact`) or a namespaced wrapper.
4. **Tokens, not literals** (see §2).
5. **New page = new file.** Add `assets/css/style/NN-<page>.css`, `@import` it in
   `bundle.css` at the right position, and keep its selectors namespaced to that page.
   Rebuild.

---

## 4. Known debt — do not add to it

The era layers redefine the same shell/component selectors in multiple files, so their
final values depend entirely on `@import` order. These are **consolidation targets**, not
patterns to copy — don't add new redefinitions of them:

- **`.card`** — redefined in `01-base`, `05-ui-polish`, `07-refresh-2026` (×2), `09-filter-toolbar`.
- **`.btn` / `.btn--primary`** — redefined across `01-base`, `06-buttons-responsive`,
  `07-refresh-2026` (both files literally comment "loaded last so it wins").
- **`.sidebar`** — `01-base` (dark) vs `08-shell-dashboard` (light redesign).
- **`.topbar`** — `01-base`, `05-ui-polish`, `08-shell-dashboard`, plus `theme-orlandi`
  (which owns the z-index).

Migrating these to a single home per selector is a **separate, incremental, visually-verified
task** (see the tracked follow-up) — it must be done a few selectors at a time with a
before/after check in the browser, because the current look depends on the exact cascade.
This file is the guardrail so the debt stops growing in the meantime.

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
| `01-base.css` | **Design tokens (`:root`)** + base shell (`.sidebar`, `.content-section`), base `.card`, the `.btn` system, `.toolbar`/`.reports-toolbar` chrome. The foundation. |
| `02-properties-media.css` | Properties split-view + map, media gallery |
| `03-clients-cards.css` | Client profile / cards, sidebar backdrop |
| `04-phase11.css` | **Grab bag, not a component file** — entity cards + status badges (lead/contract/payment/expense/appointment/invoice), calendar, map, appraisal/portal-export modals, TOTP, CSV import, pagination/bulk selection. Named after the dev sprint that produced it, not its content; a real name would have to be "everything shipped in one phase," which isn't useful. Splitting it by component is future work — don't add to it, and don't copy its shape for new files (see §1 rule 5). |
| `05-ui-polish.css` | Cross-cutting polish (zebra lists, card refinements) |
| `06-buttons-responsive.css` | Button visual polish + responsive |
| `07-refresh-2026.css` | **Also a grab bag** — topbar logo/global search, custom datepicker, valuation quick-form, contract filter-pill dots, per-owner card accent colours. (The filter-bar-pins-into-topbar-on-scroll mechanics used to live here too; the bar now pins in place — see `09-filter-toolbar.css`.) Same caveat as `04-phase11.css`: the name marks *when*, not *what*. |
| `08-shell-dashboard.css` | Shell + dashboard redesign (light sidebar, dashboard stat/table components) |
| `09-filter-toolbar.css` | **Single home for `.view-header` and the reference filter-bar** (`.fb-*`, built by `filters.js`'s `buildRefBar`) + card-header alignment |

`06`–`08` are "era layers" written to override earlier shell/button rules by loading
later. That's the source of the known collisions in §4 — treat them as legacy.

`04-phase11.css` and `07-refresh-2026.css` keep their sprint/date names on purpose:
renaming them to something component-shaped would misrepresent what's actually in
them (see above). A number is honest about being a grab bag; a wrong descriptive
name isn't. If you're adding a new, single-purpose block of styles, it does **not**
belong in either — follow §1 rule 5 and give it its own `NN-<page>.css` instead of
growing these two further.

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

Migrating these to a single home per selector is a **separate, incremental, visually-verified
task** — do it a few selectors at a time with a before/after check in the browser, because
the current look depends on the exact cascade. This file is the guardrail so the debt stops
growing in the meantime.

### Resolved (2026-07-25)

These were consolidated to a single home, visually re-verified in the browser at each step —
the pattern to follow for the ones still open above:

- **`.topbar`** — was split across `01-base`, `05-ui-polish`, `08-shell-dashboard` and
  `theme-orlandi`. Now lives entirely in `theme-orlandi.css` (the documented last-wins theme
  layer); the others no longer mention it.
- **`.view-header` / `.view-header__text` / `.view-header__actions`** — box model and the
  `__actions` row were duplicated across `01-base` and `04-phase11` in addition to
  `09-filter-toolbar`. Consolidated into `09-filter-toolbar.css`. The page title and one-line
  description (`.view-header__text`) no longer render in the page body at all — `app.js` reads
  them out of the markup on every navigation and copies them into the real topbar
  (`#page-title` / `#topbar-sub`), so `.view-header` is now action-buttons-only and collapses
  entirely (`:has()`) on the many views that have no actions. Four views
  (`documents.html`, `appointments.html`, `expenses.html`, `invoices.html`) had their action
  button as a bare child of `.view-header` instead of inside `.view-header__actions` like every
  other view — fixed, since it also fed the box-collapse rule above.
- **`.reports-toolbar` chrome** (background/border/radius/shadow) — redefined in `01-base`,
  `04-phase11`, and again (box-shadow only) in `05-ui-polish`. Consolidated onto the same rule
  as `.toolbar` in `01-base.css`, with one explicit override for its distinct padding.
- **The old "merge" behavior** (`filters.js`'s `unifyPageBar`) — always-on, not scroll-triggered:
  it stuffed each view's header actions into the filter bar and hoisted the bar to the top of
  the page, unevenly (pages whose action button wasn't inside `.view-header__actions` never
  merged, pages with many actions wrapped to 2–3 ragged rows). Removed outright, along with the
  CSS it alone produced (`.view-header--merged`, `.fb-actions`, `.toolbar--pagebar`).
- **The scroll-triggered pin-into-topbar behavior** (`setupMergeToTopbar`, `.toolbar--merged`,
  `#topbar-filters`) — also removed. It portalled the toolbar into the topbar and restyled it
  into a compact row with the search + saved-searches hidden, so the filter section you
  scrolled away from was not the one that came back. Replaced by `.toolbar--sticky` in
  `style/09-filter-toolbar.css`: the bar pins in place, unchanged, on every page.

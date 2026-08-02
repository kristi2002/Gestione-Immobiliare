# CODEMAP — where everything lives

> Practical navigation map of the codebase: what each directory is for, where every
> API endpoint lives, and where to add new code. If you're looking for "the file that
> does X", start here. Kept factual and current — update it when you move responsibilities.
>
> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (how it fits together),
> [MODULES.md](MODULES.md) (feature modules), [../../assets/css/README.md](../../assets/css/README.md)
> (the CSS system & anti-collision rules), [../../CONTRIBUTING.md](../../CONTRIBUTING.md) (workflow + pinned-layout rules).

**Stack:** PHP 8.4 + MySQL 8 + Apache. Vanilla-JS SPA served by `index.php`. Three
session-isolated portals (admin at web root, `owner/`, `tenant/`) + a static public
marketing site (`web-orlandi/`).

---

## 1. Directory map (30-second orientation)

| Path | What's in it | Moveable? |
|------|--------------|-----------|
| `api/` | 81 HTTP endpoints, one file per resource. The SPA and portals call these. | **Pinned** — see §7 |
| `config/` | App wiring (bootstrap, auth, db, csrf, roles, rate-limit) + service facades (mail, whatsapp, meta, geocode, gdpr). | **Pinned** |
| `lib/` | Stateless domain libraries / document generators (PDF, FatturaPA, SEPA, ISTAT, AI). No session/DB at include time. | **Pinned** |
| `views/` | `*.html` SPA partials, loaded through `view.php` only (Apache blocks direct access). | **Pinned** |
| `assets/js/` | 80 SPA controllers — folder-based ES modules for heavy pages, flat files for the rest. | Frontend (Juliano) |
| `assets/css/` | Numbered layer system → esbuild bundle. See [assets/css/README.md](../../assets/css/README.md). | Frontend (Juliano) |
| `owner/`, `tenant/` | The two non-admin portals (own login, session cookie, dashboard). | **Pinned** |
| `web-orlandi/` | Static public marketing site (map + contact). Consumes only 2 public APIs. | Frontend |
| `cron/` | 6 CLI cron jobs (backup, reminders, expirations, social, retention). | **Pinned** |
| `database/` | `schema*.sql` baselines, `migrations/phaseNN_*.sql`, `migrate.php`, `seeds/`. | **Pinned** |
| `tests/` | PHPUnit (`tests/Unit/`). | — |
| `docs/` | This documentation tree. | Free |
| `vendor/`, `node_modules/` | Composer / npm deps. Never edited. | — |

Top-level PHP entry files (web root): `index.php` (admin SPA shell), `login.php`,
`login_2fa.php`, `logout.php`, `setup.php`, `health.php`, `apply.php` (public
application form), `sign.php` (public e-sign), `view.php` (gated partial loader),
`privacy.php`, `meta_oauth.php` / `meta_callback.php`.

**Session cookies (isolation boundary):** admin = `gestionale_session`
(`config/bootstrap.php`), tenant = `gestionale_tenant_session` (`config/auth.php`),
owner = `gestionale_owner_session` (`owner/auth.php`).

---

## 2. "Where do I add X?" navigator

| I want to… | Do this |
|------------|---------|
| Add a new admin data screen | new `views/<x>.html` + `assets/js/<x>.js` (or `assets/js/<x>/index.js` if heavy) + `api/<x>.php` (`require __DIR__.'/../config/api_bootstrap.php'` at top) + register the route/nav in `assets/js/app.js` and `view.php`'s whitelist. |
| Add a field to an entity | migration `database/migrations/phaseNN_<slug>.sql` (nullable!) → whitelist + INSERT/UPDATE/GET in the entity's `api/*.php` → collect/load in its JS controller → form field in its `views/*.html`. (See `properties.php` for the full pattern.) |
| Add a background job | `cron/<job>.php` (include `config/cron_bootstrap.php`, call `requireJobAuth()` + `cronHeartbeat()`); optionally an HTTP twin `api/process_<x>.php`. |
| Add a PDF/XML generator | `lib/` (stateless builder) + a thin `api/generate_*.php` that wires identity/branding from `config/`. |
| Add an external integration | service facade in `config/<service>.php` (reads settings/`.env`, does the HTTP); keep pure/parsing helpers in a `config/<service>/` subfolder if it grows. |
| Change styling | read [assets/css/README.md](../../assets/css/README.md) **first** — there's a load order + token + namespacing convention to avoid collisions. |
| Add a permission-gated action | gate the endpoint with `requireRole(...)` / `requireViewAccess(...)` from `config/roles.php`; never rely on hiding a button. |

---

## 3. API endpoints by domain (`api/*.php`)

Auth legend: **Bootstrap** = admin session + CSRF (`config/api_bootstrap.php`);
**+role** = additionally role-gated; **Public** = anonymous; **Webhook** = provider
HMAC-verified; **Cron** = `config/cron_bootstrap.php`; **Multi-portal** = branches on
admin/owner/tenant session.

**Core CRUD:** `clients` · `properties` · `contracts` (+role) · `tenants` (+role) ·
`leads` · `buildings` · `property_appraisals` · `property_keys` · `property_comparison` ·
`suppliers` · `insurance` · `inventory` · `meter_readings` · `valuation` — all Bootstrap.

**Appointments/Applications/Surveys:** `appointments` (Bootstrap) ·
`appointment_request` (**Public**, honeypot+rate-limit) · `property_applications`
(+role) · `surveys` (admin + public-token branches).

**Money:** `invoices` (+role) · `payments` · `expenses` · `commissions` (+role) ·
`scadenzario` (ranked deadline feed) · `payment_reminder_log` (+role) ·
`stripe_checkout` (+role, rate-limited) · `stripe_webhook` (**Webhook**).

**Fiscal (IT):** `generate_fattura_xml` (+role) · `fattura_sdi` (+role) · `generate_sdd`
(+role) · `aml` (antiriciclaggio) · `owner_fiscal_statement` · `gdpr`
(**super_admin** = DPO).

**Documents/Media/PDF:** `documents` · `get_attachable_documents` · `download_document`
(**Multi-portal**, caller-scoped) · `download_pdf` · `media` (**Multi-portal**;
public listing assets, scoped private) · `property_media` · `generate_pdf` ·
`generate_invoice_pdf` (+role) · `generate_owner_report` · `esign` (admin +
public-token) · `upload_logo` (+role).

**Communications:** `communications` · `email_templates` · `email_inbound`
(**Webhook**, Mailgun) · `whatsapp_send` (+role) · `whatsapp_inbox` ·
`whatsapp_templates` · `whatsapp_webhook` (**Webhook**, Meta Cloud API) · `notifications`.

**Social:** `social_posts` (+role) · `social_settings` (+role) ·
`publish_social_posts` (**Cron**).

**Integrations/Geo/AI:** `geocode` · `geocode_autocomplete` · `geocode_resolve` ·
`portal_sync` · `property_export` (Immobiliare.it JSON/XML/CSV feed, rate-limited) ·
`ai_describe`.

**Reminders/Automations:** `reminders` · `process_reminders` (**Cron**) ·
`process_contract_expirations` (**Cron**) · `automations` · `maintenance`.

**Dashboard/Search/Reporting:** `get_dashboard_stats` (APCu-cached) ·
`global_search` (rate-limited) · `reports` (+role) · `forecast`
(+role) · `agent_portfolio` (+role) · `readiness` (Bootstrap or `X-Cron-Secret`).

**Auth/Admin/Ops:** `login` (**Public**) · `login_2fa` (**Public**) · `admin_users`
(**super_admin only**) · `activity_log` (**super_admin only**) · `settings` ·
`backup_trigger` (**super_admin**, rate-limited) · `owner_portal` (admin manages owner
portal passwords).

**Public/anonymous:** `public_listings` (whitelisted non-personal fields for the
marketing site).

> ⚠️ Endpoints that **bypass** `api_bootstrap.php` (public/webhook/cron/mixed) are the
> security-sensitive set — audit them first: `appointment_request`, `public_listings`,
> `login`, `login_2fa`, `stripe_webhook`, `email_inbound`, `whatsapp_webhook`, `esign`
> (token), `surveys` (token), `download_document`, `download_pdf`, `media`, `readiness`,
> `process_reminders`, `process_contract_expirations`, `publish_social_posts`.

---

## 4. `config/` — wiring vs services

**Infrastructure / bootstrap:** `bootstrap.php` (env, session, HTTPS) ·
`api_bootstrap.php` (the API gate: session + CSRF) · `api_helpers.php` (JSON helpers) ·
`api_pagination.php` · `db.php` (PDO singleton) · `env.php` · `auth.php` (admin+tenant
sessions) · `csrf.php` · `roles.php` (RBAC map) · `rate_limit.php` · `cache.php` (APCu) ·
`upload_guard.php` (path-containment) · `cron_bootstrap.php` · `heartbeat.php` ·
`login_throttle.php`.

**Domain services / facades:** `settings.php` · `agency.php` (multi-tenant scaffold) ·
`gdpr.php` · `geocode.php` (+ `geocode/matching.php`, `geocode/providers.php`) ·
`meta.php` (+ `meta/publishers.php`, `meta/scheduler.php`) · `whatsapp.php` ·
`reminders.php` · `contract_expirations.php` · `activity_log.php` · `totp.php` ·
`backup_cloud.php` · `mail.php` · `mail_html.php` · `pdf.php` (wraps `lib/SimplePdf.php`).

## 5. `lib/` — stateless generators

`SimplePdf.php` (PDF, zero-dep) · `FatturaPA.php` (FatturaPA 1.2.2 XML) ·
`sdi_sender.php` (SdI transmission adapter) · `sepa_sdd.php` (SEPA pain.008) ·
`istat.php` (rent-index calculator) · `ai.php` (AI provider layer) ·
`portal_leads.php` (portal-email → lead parser).

**Boundary:** `lib/` = pure builders (array in → string/XML/PDF out, no app wiring).
`config/` = session/db/auth wiring + network-facing service facades that read settings.
`config/pdf.php` (wiring) consumes `lib/SimplePdf.php` (generator); `api/fattura_sdi.php`
composes `lib/FatturaPA.php` + `lib/sdi_sender.php` with `config/settings.php`.

---

## 6. Frontend (`assets/js`, 80 files)

**Folder-based ES-module controllers** (`<page>/index.js` + `constants.js`/`helpers.js`/
`templates.js`) for heavy pages: `clients/`, `client_profile/`, `leads/`, `properties/`,
`property_profile/`, `contracts/`, `settings/`, `social/`, `agent_profile/`.

**Flat single-file controllers** for the rest (~47): `appointments.js`, `aml.js`,
`buildings.js`, `calendar.js`, `commissions.js`, `documents.js`, `expenses.js`,
`invoices.js`, `keys.js`, `map.js`, `meters.js`, `payments.js`, `property_edit.js`
(the immobili scheda), `reminders.js`, `reports.js`, `scadenzario.js`, `suppliers.js`,
`surveys.js`, `tenants.js`, `valuation.js`, `whatsapp_inbox.js`, … (one per view).

**Shared helpers:** `app.js` (SPA core: routing, view loading, the central
`fetch(url,{…})` wrapper, global search) · `pagination.js` · `filters.js` (docks the
filter bar into the topbar on scroll) · `geocode.js` · `map.js` (Leaflet) ·
`datepicker.js` · `confirm.js` · `cookie_consent.js` · `notifications.js`.

For CSS see [assets/css/README.md](../../assets/css/README.md).

---

## 7. Why the backend layout is PINNED

The directory tree is load-bearing in three independent ways — **do not move
`api/`, `config/`, `lib/`, `views/`, `uploads/*`, or the portal dirs:**

1. **Hard-coded API URLs.** Every JS controller calls `fetch('api/<x>.php')` as a
   root-relative path — there is no `API_BASE` indirection. Moving `api/` (or serving
   the app from a sub-path) breaks every call. (`app.js`, `clients/index.js`,
   `property_edit.js`, and ~every controller.)
2. **`__DIR__`-relative includes.** Every endpoint reaches wiring via
   `require_once __DIR__ . '/../config/…'` (and `../lib/…`, `../vendor/…`). The
   `api/ ⇄ config/ ⇄ lib/` sibling relationship is hard-wired.
3. **Apache `.htaccess` path gating.** `./.htaccess` denies `config/`, `database/`,
   `cron/`, `.env`; `uploads/documents/.htaccess` is deny-all (personal/fiscal docs,
   reachable only via the auth-checked PHP streamers); `uploads/properties/.htaccess`
   serves images but denies doc types; `views/.htaccess` blocks direct `*.html` access.
   These rules name the exact tree — moving a directory silently opens a hole.

It's also a **live app** (Coolify auto-deploys every push to `main`) shared between two
developers under a "don't reorg the backend" agreement. Reorganize *within* a file, not
the tree. See [../../CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## 8. Data, cron, tests

**`cron/` (CLI jobs):** `backup_database.php` (daily 03:00) ·
`send_payment_reminders.php` (daily 08:00) · `process_reminders.php` (every 15 min) ·
`process_contract_expirations.php` (daily 07:00) · `publish_social_posts.php` (every
10 min) · `gdpr_retention.php`. Several have HTTP twins under `api/process_*`.

**`database/`:** `schema.sql` (dev baseline) · `schema_production.sql` (prod baseline
through phase28) · `migrations/phaseNN_<slug>.sql` (phase29+ applied on top, idempotent
via `000_helpers.sql` + `schema_migrations`) · `migrate.php` (runner, auto-run on deploy) ·
`seeds/`. Fresh install = load `schema_production.sql`, then `php database/migrate.php`.

**`tests/`:** PHPUnit (`phpunit.xml`), `tests/Unit/` covers the mail/meta/whatsapp
service modules. Backend endpoints are largely integration-verified against the local
Docker stack rather than unit-tested.

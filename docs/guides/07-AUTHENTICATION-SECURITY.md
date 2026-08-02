# 07 — Authentication, Authorization & Security

> Consolidated from ARCHITECTURE (auth), PRODUCTION_READINESS, GAPS, and CLAUDE.md.
> Isolation between the three login surfaces is the central security property. Every
> "✅ Fixed" claim below is a **claim** until reproduced (CLAUDE.md §1) — verify before trust.

---

## Three independent login surfaces

| Portal | Entry | Session cookie / namespace | Users |
|--------|-------|----------------------------|-------|
| **Admin** | `login.php` → `index.php` | admin cookie — **name unconfirmed** (see below) | `admin_users` |
| **Tenant** | `tenant/login.php` → `tenant/index.php` | `gestionale_tenant_session` | `tenant_users` + `tenants` |
| **Owner** | `owner/login.php` → `owner/index.php` | `$_SESSION['owner_*']` | `clients.portal_email` / `portal_password_hash` |

Each portal uses a distinct cookie/namespace so all three can coexist without collision.
Passwords are stored with `password_hash()` (bcrypt) and verified with `password_verify()`.

> ⚠️ **Cookie-name discrepancy (resolve from a live login):** `ARCHITECTURE.md` names the
> admin cookie `gestionale_session`; `DEPLOY.md` sets `SESSION_NAME=gi_session`. Determine the
> real value from a live login before scripting any auth test.

Tenant portal helpers: `initTenantSession()`, `requireTenantAuthWeb()`.
Owner portal helpers (`owner/auth.php`): `initOwnerSession()`, `requireOwnerAuth()`,
`attemptOwnerLogin()`.

---

## Admin roles (`config/roles.php`)

| Role | Access |
|------|--------|
| `super_admin` | Everything, including Settings and user management (`admin_users.php`) |
| `admin` | All modules except Settings |
| `agent` | Operational modules (no Social, no Settings) |
| `readonly` | View-only; GET APIs work, all writes must return **403** at the API level |

- Navigation + `view.php` use `canAccessView()`.
- APIs add `requireViewAccess()` / `requireRole()` for finer control (e.g. `admin_users.php` is super-admin only).
- Mutating HTTP methods run through `requireWriteAccess()` in `api_bootstrap.php`, which blocks `readonly`. **Do not trust hidden buttons** — the enforcement is at the API layer.

---

## First-time setup

1. Import `database/schema_production.sql` (or run migrations).
2. Set `SETUP_ENABLED=true` in `.env`.
3. Visit `setup.php` once to create the first `super_admin` (uses `ADMIN_USERNAME`/`ADMIN_PASSWORD`).
4. A `.setup_complete` lock file is written; set `SETUP_ENABLED=false` in production (then `setup.php` must return 403).

---

## Security model (mechanisms in place)

| Concern | Mechanism |
|---------|-----------|
| Direct file access | Root `.htaccess` blocks `config/`, `database/`, `cron/`, `backups/`; `views/.htaccess` deny |
| Upload execution | `uploads/.htaccess` blocks PHP execution (but files still publicly served — see liabilities) |
| API auth | Session required; 401 JSON or redirect to login (`requireAuthApi()`) |
| CSRF | `api_bootstrap.php` (lines 22–25) calls `validateCsrfToken()` on every POST/PUT/PATCH/DELETE; token from `config/csrf.php` / `initCsrfToken()`; frontend sends `X-CSRF-Token`. Webhooks + cron correctly exempt. |
| Write protection | `readonly` blocked on mutating methods via `requireWriteAccess()` |
| Passwords | bcrypt `password_hash` / `password_verify` |
| 2FA | Optional per-user TOTP (`config/totp.php`) — Google Authenticator / Authy |
| Login throttle | 5 attempts / 15 min per IP (`config/login_throttle.php`, `login_attempts` table) |
| API rate limiting | DB-backed sliding window (`config/rate_limit.php`, `api_rate_limits` table) on WhatsApp send, Stripe checkout, e-sign |
| Cron HTTP | Shared secret `CRON_SECRET` (header `X-Cron-Secret` or `?secret=`) |
| Sessions | `httponly`, `samesite=Lax`, `secure` when `FORCE_HTTPS` |
| SQL | PDO prepared statements, `ATTR_EMULATE_PREPARES => false` |
| CORS | Limited to `APP_URL` (`config/api_helpers.php`) |
| Meta OAuth | CSRF `state` parameter in `meta_oauth.php` / `meta_callback.php` |
| Webhook signatures | Meta `X-Hub-Signature-256` (HMAC-SHA256), Stripe `Stripe-Signature`, Mailgun HMAC-SHA256 — **fail closed in produzione**: senza segreto si risponde 503/rifiuto, non si accetta |

---

## The isolation test (CLAUDE.md §4.1 — highest priority)

For each portal, log in as account **A**, capture a real data request, then re-issue with an
ID belonging to account **B**. **PASS** = `401`/`403` or empty/owned-only. **FAIL** = you get B's data.

Run for:
- **Tenant portal:** tenant A must not read tenant B's lease, property, documents, or payments.
- **Owner portal:** owner A must not read owner B's properties, contracts, payments, documents, communications (`owner/index.php` + `api/owner_portal.php`).
- **Privilege crossing:** call an admin endpoint (e.g. `GET /api/clients.php`) with a **tenant** cookie, then an **owner** cookie — both must reject.

Any leak is a **stop-the-line** finding: report first, in plain language, with the exact
request and the data returned.

---

## Boundary smoke tests (expected results)

| Request | Expected |
|---|---|
| `GET /api/get_dashboard_stats.php` with no cookie | **401** |
| `GET /views/dashboard.html` directly | **403** |
| `GET /config/db.php` directly | **403** |
| `GET /setup.php` with `SETUP_ENABLED=false` | **403** |
| Wrong admin password | rejected, no session |
| `readonly` POST/PUT/DELETE to a mutating endpoint | **403** at API level |
| `agent` calling Social/Settings endpoints | rejected |
| plain `admin` calling `admin_users.php` | rejected (super-admin only) |
| Unsigned POST to `whatsapp_webhook.php` / `stripe_webhook.php` | rejected (if "Fixed" holds) |

---

## Security-gap register (status per GAPS.md — claims, verify)

| Gap | Severity | Claimed status |
|-----|----------|----------------|
| Webhook WhatsApp senza firma | 🔴 | ✅ Risolto — `whatsapp_webhook.php` verifica `X-Hub-Signature-256` sul corpo grezzo con `META_WA_APP_SECRET`; in produzione, se il segreto manca, risponde `503` invece di accettare |
| ADMIN_PASSWORD default "admin" | 🔴 | ✅ Fixed — changed in Coolify + Settings |
| CRON_SECRET placeholder | 🔴 | ✅ Fixed — 64-char random hex |
| CSRF on all endpoints | 🟠 | ✅ Already implemented — `api_bootstrap.php` validates all mutating methods; 47 API files use it; only webhooks/cron exempt |
| Rate limiting | 🟡 | ✅ Fixed — `config/rate_limit.php` on WhatsApp/Stripe/e-sign |
| Meta token expiry (no auto-refresh) | 🟡 | ✅ Fixed — detects error 190, emails admin (rate-limited 1/24h) |
| Stripe webhook validation | 🟡 | ✅ Fixed — `\Stripe\Webhook::constructEvent()` w/ manual HMAC-SHA256 fallback |
| Owner portal | 🟡 | ✅ Already implemented (`owner/`) |

> **CLAUDE.md §1 rule:** several of these sit on the highest-risk items (CSRF, rate limiting,
> webhook signatures, cross-account isolation). "✅ Fixed" means nothing until reproduced. If a
> test contradicts the doc, the test wins — flag the discrepancy.

---

## Sale/legal liabilities to surface every time (CLAUDE.md §9)

1. **GDPR layer.** ~~`uploads/` pubblico~~ **RISOLTO e verificato live** (2026-07-18/19): `uploads/documents/` risponde `403` a qualsiasi URL diretto, anche per file inesistenti; i documenti passano solo da `download_document.php`/`download_pdf.php`. Restano da chiudere: nessuna informativa privacy, nessuna base giuridica documentata, nessun DPA con Meta/provider email, nessuna procedura di retention/cancellazione — while handling owners' and tenants' personal data. **Close this before real documents go in front of a real client.** (Test: upload a doc as admin → open the file URL in a fresh incognito session with no cookies → it must be blocked/403.)
2. **`DB_USER=root` in production** (`DEPLOY.md`) — the readiness doc itself says not to do this.
3. **Payments scope undecided** — Stripe is "code ready, not configured." Decide in/out; if out, ensure no dead "Pay now" button shows in any portal.

---

## GDPR / legal checklist (Italy — not legal advice)

Before real client/tenant data:
- Privacy informativa (site + tenant portal)
- Legal basis for processing owner/tenant data
- Record of processing activities (registro trattamenti) if applicable
- DPAs with hosting, email provider, Meta (WhatsApp + social)
- Retention policy (communications, documents, backups)
- Data-subject rights procedure (access/erasure)
- Cookie banner if analytics/non-technical cookies added
- Marketing consent for promotional email/WhatsApp (distinct from service messages)

The app **includes no legal pages or consent management** — these must be added or linked
externally. See the WhatsApp Cloud consent tables in
[08-INTEGRATIONS.md](08-INTEGRATIONS.md) for the planned opt-in/opt-out audit trail.

---

## Still-missing security items (from PRODUCTION_READINESS P2)

- Password reset (admin + tenant self-service)
- Security headers (HSTS, `X-Frame-Options`, CSP)
- SVG logo sanitisation (XSS risk on malicious upload)
- Structured logging + alerting on cron/backup failure
- Health-check endpoint
- Automated tests beyond the unit stubs + CI pipeline

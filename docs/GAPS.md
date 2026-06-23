# Known Gaps & Issues — Gestione Immobiliare

This document catalogs known bugs, missing features, and security gaps.  
Each item includes severity, affected code, recommended fix, and implementation status.

> **Last updated:** June 2026

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔴 Critical | Security vulnerability or data loss risk |
| 🟠 High | Breaks important functionality |
| 🟡 Medium | Annoying but workaroundable |
| 🟢 Low | Nice-to-have improvement |
| ✅ Fixed | Implemented and deployed |

---

## Security gaps

> **Note:** Security gaps were intentionally left for a separate hardening pass. They do not affect the functional demo.

### 🔴 Twilio webhook not validated

**File:** `api/whatsapp_webhook.php`  
**Problem:** The webhook accepts any POST request without validating the `X-Twilio-Signature` header. Anyone who knows the URL can inject fake WhatsApp messages into the database.  
**Fix:** Validate the HMAC-SHA1 signature using Twilio Auth Token:

```php
// Add at top of whatsapp_webhook.php:
$authToken  = getSetting('twilio_auth_token') ?: $_ENV['TWILIO_AUTH_TOKEN'];
$signature  = $_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '';
$url        = (defined('APP_URL') ? APP_URL : '') . '/api/whatsapp_webhook.php';
$params     = $_POST;

$expectedSig = base64_encode(hash_hmac('sha1', $url . implode('', array_map(
    fn($k, $v) => $k . $v,
    array_keys($params),
    array_values($params)
)), $authToken, true));

if (!hash_equals($expectedSig, $signature)) {
    http_response_code(403);
    exit;
}
```

---

### 🔴 ADMIN_PASSWORD still "admin"

**File:** `.env` / Coolify env vars  
**Problem:** The default admin password has not been changed from the placeholder "admin".  
**Fix:** Log in as admin, go to Settings → Users, change the password immediately.

---

### 🔴 CRON_SECRET is a placeholder

**File:** Coolify env vars  
**Problem:** `CRON_SECRET=CHANGE_THIS_CRON_SECRET` means anyone can trigger cron jobs via HTTP.  
**Fix:** Set `CRON_SECRET` to a long random string (e.g. `openssl rand -hex 32`).

---

### ✅ No CSRF protection on most API endpoints

~~**Files:** All `api/*.php`~~  
~~**Problem:** `config/csrf.php` and `initCsrfToken()` exist and the frontend sends the token in requests, but many API endpoints do not call `requireCsrf()`.~~  
**Status: Already implemented.** `config/api_bootstrap.php` lines 22–25 call `validateCsrfToken()` for every POST/PUT/PATCH/DELETE request. All 47 admin API files use `api_bootstrap`. The only excluded files are external webhooks (Twilio, Stripe, email inbound) and cron scripts, which is correct.

---

### ✅ No rate limiting on API endpoints

~~**File:** All `api/*.php`~~  
~~**Problem:** Login throttling exists (`config/login_throttle.php`) but no rate limiting on other endpoints.~~  
**Status: Fixed (June 2026).** New `config/rate_limit.php` — a self-initialising DB-backed sliding-window rate limiter. Applied to:
- `api/whatsapp_send.php` — 20 messages per user per minute (Twilio cost protection)
- `api/stripe_checkout.php` — 5 sessions per user per minute (billing abuse prevention)
- `api/esign.php` public sign endpoint — 10 requests per IP per minute (token brute-force protection)

The `api_rate_limits` table is created automatically on first use (`CREATE TABLE IF NOT EXISTS`). Rate-limit errors return HTTP 429.

---

### ✅ Meta tokens expire without auto-refresh

~~**File:** `config/meta.php`, `social_settings` table~~  
~~**Problem:** Meta user access tokens expire after ~60 days. When they expire, social posting silently fails.~~  
**Status: Fixed (June 2026).** `publishAndUpdatePost()` now calls `isMetaTokenExpiredError()` to detect Meta error code 190 and related OAuth errors. When a token error is detected, `sendMetaTokenExpiryAlert()` emails the admin with reconnection instructions. Alert is rate-limited to once per 24 hours via the `meta_token_alert_last_sent` settings key to prevent inbox spam.

---

### ✅ Stripe webhook not validated

~~**File:** `api/stripe_webhook.php`~~  
~~**Problem:** The Stripe webhook handler may not validate the `Stripe-Signature` header.~~  
**Status: Fixed (June 2026).** `api/stripe_webhook.php` now uses `\Stripe\Webhook::constructEvent()` when the SDK is available (post-composer-install). Falls back to the equivalent manual HMAC-SHA256 validation if the SDK isn't loaded yet. Rejects events with missing or invalid signatures when `STRIPE_WEBHOOK_SECRET` is set. Logs a warning if no secret is configured.

---

## Functional gaps

### ✅ Lead → Tenant conversion has no UI
~~**Problem:** When a lead converts to a tenant, there is no button or workflow to automatically create the tenant record from the lead data.~~  
**Status: Already implemented.** The "Converti in Inquilino" modal exists in `views/leads.html` + `assets/js/leads.js`, backed by `api/leads.php?action=convert_tenant`. It pre-fills name, surname, email, phone from the lead and creates both the tenant and a contract record.

---

### ✅ Payment auto-generation not implemented
~~**Problem:** No payment records automatically generated for each month of a rental contract.~~  
**Status: Already implemented.** The "Genera scadenzario" button appears on the contract detail scheda (only for `locazione` contracts with tenant, rent, and dates set). It calls `api/contracts.php?action=generate_payments`.

---

### ✅ Maintenance requests mixed into reminders table
~~**Problem:** Maintenance requests were mixed into the `reminders` table with no dedicated UI.~~  
**Status: Already implemented.** A dedicated `views/maintenance_workflow.html` + `assets/js/maintenance_workflow.js` view exists and is accessible via the sidebar "Manutenzione" link.

---

### 🟠 Cron jobs not running on production

**Problem:** The cron scripts (`process_reminders.php`, `publish_social_posts.php`, `send_payment_reminders.php`, `backup_database.php`) have not been set up on the Hetzner VPS.  
**Impact:** Reminders are not sent, social posts are not published, backups are not made.  
**Fix:** See DEPLOY.md — add crontab entries on the VPS using `docker exec`.

---

### ✅ Instagram text-only posts not supported
~~**Problem:** Instagram requires an image to publish. The UI did not make this clear.~~  
**Status: Fixed (June 2026).** `assets/js/social.js` `handlePostSubmit()` now validates that an image is selected when platform is `instagram` or `both`. Shows `#post-instagram-warn` warning element in the modal. Also added `alert--warning` and `alert--info` CSS classes to `style.css`.

---

### ✅ Owner portal is partially built

~~**Problem:** The `clients` table has `portal_email` and `portal_password_hash` columns, suggesting an owner portal was planned. No owner portal UI exists.~~  
**Status: Already fully implemented.** The `owner/` portal is complete:
- `owner/auth.php` — session helpers (`initOwnerSession()`, `requireOwnerAuth()`, `attemptOwnerLogin()`)
- `owner/login.php` — branded login page
- `owner/index.php` — full dashboard with tabs: Immobili, Contratti, Pagamenti, Documenti, Comunicazioni
- `owner/report.php` — PDF rendiconto download
- `owner/logout.php` — session teardown
- `api/owner_portal.php` — admin endpoint to set portal credentials (`action=set_password`)

---

### 🟡 Social post image must be public HTTPS URL

**Problem:** Instagram requires a publicly accessible image URL. If `META_PUBLIC_BASE_URL` is not set or the image isn't publicly accessible, Instagram publishing fails silently.  
**Impact:** Instagram posts fail with a confusing error.  
**Fix:** Ensure `META_PUBLIC_BASE_URL` is set in Coolify env vars. Files under `uploads/` are served by Apache directly (no auth required), so the path is accessible as long as the env var is correct.

---

### ✅ No email/notification when contract expires
~~**Problem:** `config/contract_expirations.php` referenced non-existent `entity_type`/`entity_id` columns on the `reminders` table, causing the INSERT to fail silently.~~  
**Status: Fixed (June 2026).** Removed the invalid column references from `config/contract_expirations.php`. The dedup check now uses the reminder `title` + creation date. Email admin notification on expiry was already implemented via `sendHtmlEmail()`.

---

### ✅ `esign_requests` — no email sent to signer
~~**Problem:** When an e-sign request was created, the signer token was stored in the DB but no email was sent to the signer.~~  
**Status: Fixed (June 2026).** `api/esign.php` `createEsignRequest()` now calls `sendHtmlEmail()` with the signing link after creating the record. The response includes `email_sent: true/false`. The UI in `assets/js/contracts.js` shows a confirmation if the email was sent, or a warning to send manually if email is not configured.

---

### ✅ No pagination on WhatsApp inbox

~~**Problem:** `api/whatsapp_inbox.php` supports pagination parameters but the inbox UI loads all messages at once. For contacts with long message histories this could be slow.~~  
**Status: Fixed (June 2026).** `assets/js/whatsapp_inbox.js` now opens each thread with `?page=1&limit=50`. A "⬆ Carica messaggi precedenti" bar appears at the top of the chat when more pages exist. Clicking it fetches the next page, prepends the older bubbles, and preserves scroll position. The bar hides automatically when all pages are loaded. State variables `msgPage`, `msgTotalPages` and a dedicated `loadEarlierMessages()` function manage paging. The `#wa-load-earlier-bar` element was added to `views/whatsapp_inbox.html`.

---

### ✅ `property_media` sort_order not used in social post picker
~~**Problem:** Social post image picker might show photos in insertion order.~~  
**Status: Already correct.** `api/property_media.php` already uses `ORDER BY m.sort_order ASC, m.created_at ASC` in both list and picker queries.

---

## Technical debt

### `APP_DEBUG=true` in dev leaks PHP errors into HTML

`bootstrap.php` outputs PHP errors when `APP_DEBUG=true`. In production this was causing `Uncaught SyntaxError` in the JS console because PHP error output contaminated the HTML partial returned by `view.php`.  
**Status:** ✅ Fixed — `APP_DEBUG=false` in production Coolify env vars. Do not change.

### `DB_NAME=default` vs `gestione_immobiliare`

Coolify creates the MySQL container with DB named `default`. The app originally assumed `DB_NAME=gestione_immobiliare`. This mismatch caused initial connection failures.  
**Status:** ✅ Fixed — `DB_NAME=default` in Coolify env vars.  
**Note:** If migrating off Coolify, rename the DB or update env var.

### ✅ Dependency management

~~`composer.json` exists but the `vendor/` directory may not be committed or present. The only external PHP library used is `lib/SimplePdf.php` (vendored directly). Stripe SDK is not installed.~~  
**Status: Fixed (June 2026).** `composer.json` rewritten: removed PHPMailer (not used), added `stripe/stripe-php ^13.0` as a production dependency, `phpunit/phpunit ^11.0` as dev dependency, PSR-4 autoloading for `App\` (src/) and `Tests\` (tests/). `Dockerfile` updated with multi-stage `COPY --from=composer:2 /usr/bin/composer /usr/bin/composer` and `RUN composer install --no-dev --optimize-autoloader`. `vendor/` added to `.gitignore`. `composer.lock` will be generated on the first Coolify Docker build.

### ✅ No test suite

~~Zero automated tests. All testing is manual.~~  
**Status: Fixed (June 2026).** PHPUnit 11 test suite added:
- `phpunit.xml` — test runner config, bootstrap points to `tests/bootstrap.php`, coverage includes `config/`
- `tests/bootstrap.php` — stubs for `loadEnv()`, `getDB()` (SQLite in-memory), `getSetting()`, `getMailConfig()` (mail disabled), `logActivity()`; then requires config files under test
- `tests/Unit/MailTest.php` — 8 tests: `sendClientEmail()` disabled-mode, email validation, result shape; `sendViaSmtp()` graceful failure on invalid host
- `tests/Unit/WhatsAppTest.php` — 8 tests: `parseTwilioWebhook()` field extraction, missing fields, unicode; `normalizeWhatsAppNumber()` DataProvider for 6 number formats
- `tests/Unit/MetaTest.php` — 10 tests: `isMetaConfigured()` DataProvider, `maskToken()` masking/null/short, `publicSocialSettings()` tokens masked with `••••••••`, `meta_user_token` not exposed

---

## Summary

| Gap | Severity | Status |
|-----|----------|--------|
| Twilio webhook validation | 🔴 | Open — security hardening pass |
| Change ADMIN_PASSWORD | 🔴 | Open — manual action required |
| Change CRON_SECRET | 🔴 | Open — manual action required |
| CSRF on all endpoints | 🟠 | ✅ Already implemented (api_bootstrap.php) |
| Cron jobs on VPS | 🟠 | Open — see DEPLOY.md |
| Rate limiting | 🟡 | ✅ Fixed June 2026 |
| Meta token expiry alert | 🟡 | ✅ Fixed June 2026 |
| Stripe webhook validation | 🟡 | ✅ Fixed June 2026 |
| Owner portal | 🟡 | ✅ Already implemented (owner/) |
| Instagram image warning | 🟡 | ✅ Fixed June 2026 |
| Contract expiry bug (entity_type) | 🟢 | ✅ Fixed June 2026 |
| E-sign email to signer | 🟢 | ✅ Fixed June 2026 |
| Lead → Tenant conversion | 🟠 | ✅ Was already implemented |
| Payment auto-generation | 🟠 | ✅ Was already implemented |
| Maintenance UI | 🟠 | ✅ Was already implemented |
| sort_order in media picker | 🟢 | ✅ Was already correct |
| WhatsApp inbox pagination | 🟢 | ✅ Fixed June 2026 |
| Dependency management (Composer + Stripe SDK) | — | ✅ Fixed June 2026 |
| No test suite (PHPUnit) | — | ✅ Fixed June 2026 |
| APP_DEBUG production | — | ✅ Fixed |
| DB_NAME mismatch | — | ✅ Fixed |

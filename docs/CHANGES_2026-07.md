# Change Log — Deployment-Readiness Work (2026-07-10)

Complete record of every code/config/doc change made to take the app to
Hetzner-production readiness. Grouped by concern. See `docs/DEPLOYMENT_PLAN.md`
for the phase-by-phase progress log and `docs/VERIFICATION_REPORT.md` for the
evidence behind each fix.

Scope decisions (locked with the owner): single-agency now but **architected for
multi-agency later**; integrations **production-ready but OFF by default**;
**full GDPR** compliance pass.

---

## 1. Security (Phase 1)

**Modified**
- `api/property_media.php` — `attachment` media now stored in the protected
  `uploads/documents/property_attachments/` tree and served via `api/media.php`;
  presentation media (photo/video/floor_plan/house_map) stays public. `url` now
  routes attachments through the streamer.
- `api/stripe_webhook.php` — fail **closed** in production when no signing secret;
  fixed money bug (`payments.paid_at` → `paid_date`).
- `api/whatsapp_webhook.php`, `api/email_inbound.php` — fail closed in production
  when the signing token/key is unset (was silently accepting forged requests).
- `api/social_settings.php`, `api/social_posts.php` — added `requireRole('super_admin','admin')`
  (an `agent` could previously reach them).
- `api/settings.php` — settings management tightened to `super_admin` (2FA
  self-service and `?public` branding left open).
- `tenant/login.php`, `owner/login.php` — wired `login_throttle` (5/15min lockout).
- `config/auth.php`, `owner/auth.php` — **session-switch fix**: bind `session_id()`
  to the portal cookie before `session_start()` (portals could not load sessions).
- `api/download_document.php` — same session-switch fix in the manual tenant/owner
  branches; added GDPR data-access audit logging.
- `docker-compose.yml` — removed the hard-coded ngrok token (now `${NGROK_AUTHTOKEN}`);
  ngrok moved to a `dev` profile. **The old token must be rotated.**

**New**
- `api/media.php` — auth-scoped streamer for property media (public presentation
  assets; attachments restricted to admin / owning owner / current tenant).

---

## 2. Money & correctness (Phase 2)

**Modified**
- `api/contracts.php` — payment-schedule generation is now **month-safe** (anchors
  on the start day, clamps to each month's length; no `+1 month` overflow) and runs
  inside a locked transaction (duplicate-safe under concurrency).
- `api/invoices.php` — invoice numbering derives from `MAX(sequence)` (no reuse
  after a draft delete) + retry loop against the new unique index.
- `config/rate_limit.php` — fixed the undefined `getCurrentUser()` reference
  (now `getCurrentRole`/`getCurrentAdminId`); per-user buckets work; admin-bypass
  is opt-in (default off).

---

## 3. Database — migrations, multi-tenant scaffold, GDPR, indexes (Phase 3)

**New**
- `database/migrate.php` — baseline-aware idempotent migration runner with a
  `schema_migrations` table and a DELIMITER-aware SQL splitter.
- `database/migrations/phase29_invoice_number_unique.sql` — unique `invoice_number`.
- `database/migrations/phase30_property_insurance_fk.sql` — adds the missing
  `property_insurance.property_id` FK (+ orphan cleanup).
- `database/migrations/phase31_multi_tenant_scaffold.sql` — `agencies` table +
  nullable-safe `agency_id` on 9 aggregate roots + FKs (single agency seeded).
- `database/migrations/phase32_gdpr.sql` — `consent_records`, `data_processing_log`,
  `data_export_requests`, `erasure_requests`, consent columns on clients/tenants,
  retention config.
- `database/migrations/phase33_performance_indexes.sql` — composite indexes.
- `database/migrations/phase34_api_rate_limits.sql` — formalises the rate-limit table.
- `config/agency.php` — `currentAgencyId()` / `scopeToAgency()` helper (scaffold;
  not yet applied to WHERE clauses).
- `database/create_app_user.sql` — least-privilege application DB user.

**Modified**
- `database/migrations/README.md` — rewritten to document the runner flow (the old
  per-file list was broken — it skipped phase10).

---

## 4. GDPR compliance (Phase 4)

**New**
- `config/gdpr.php` — `logDataAccess` / `logDataAccessAdmin` (access audit),
  `gdprExportSubject`, `gdprAnonymizeSubject`.
- `api/gdpr.php` — super_admin API: export (Art. 15/20), consent ledger, access log,
  erasure request + confirmed anonymisation.
- `cron/gdpr_retention.php` — retention purge per `retention_*` settings.
- `privacy.php` — public privacy notice (Art. 13/14; agency identity from settings).
- `assets/js/cookie_consent.js` — self-injecting cookie/consent banner.
- `docs/GDPR.md` — records of processing, retention schedule, DPA/sub-processor
  checklist, breach + data-subject-request procedures.

**Modified**
- `index.php`, `tenant/index.php`, `owner/index.php` — include the cookie banner.

---

## 5. Integrations (Phase 5)

**Modified**
- `composer.json` — removed the redundant `files` autoload (it double-declared
  `loadEnv()` and broke `stripe_webhook.php` whenever `vendor/` existed).
- `composer.lock` — regenerated (stripe-php v13.18.0 + PHPUnit 11 now present).
- `api/stripe_checkout.php` — added the missing `config/settings.php` include
  (would fatally error at `getSetting`), fixed `tenants.first_name/last_name` →
  `name/surname`, config check moved before the DB query (clean 503 when off).
- `.env.example` — rewritten as the complete, documented env-var contract.

---

## 6. Deployment — Hetzner (Phase 6)

**Modified**
- `Dockerfile` — bakes `zz-production.ini` hardening; entrypoint now **runs
  `database/migrate.php` on start** (retry-until-ready) and **writes the uploads
  protection `.htaccess` files** into the volume on start (the volume otherwise
  shadows them → public docs + PHP execution).
- `.github/workflows/deploy.yml` — deploy webhook moved to a `COOLIFY_WEBHOOK_URL`
  secret (was a hard-coded HTTP IP + UUID); prefer HTTPS.
- `docs/DEPLOY.md` — `gi_session` → `gestionale_session`; `DB_USER=root` → `gestionale_app`.

**New**
- `.env.production.example` — canonical production template.

---

## 7. PDF robustness (found in Phase 7)

**Modified**
- `config/pdf.php` — contract PDF passes NULL (not `0`) for missing client/property/
  tenant ids, preventing a `pdf_documents` FK 500 on incomplete input.

---

## 8. Documentation (Phase 8)

**New**
- `docs/DEPLOYMENT_PLAN.md` — the master plan + full progress log.
- `docs/VERIFICATION_REPORT.md` — evidence-backed test results (CLAUDE.md §8).
- `docs/GDPR.md`, `docs/CHANGES_2026-07.md` (this file).

---

## Post-work checklist for the operator

1. **Rotate the ngrok token** (compromised — was committed).
2. Create the DB user: run `database/create_app_user.sql`, set `DB_USER=gestionale_app`.
3. Copy `.env.production.example` → deployment env; fill secrets; `SETUP_ENABLED=false` after first admin.
4. Deploy; the container runs migrations + writes uploads protection automatically.
5. Activate integrations only when you have the real keys (fill the documented env vars).
6. GDPR: sign sub-processor DPAs; publish `privacy.php` wording approved by counsel.
7. **Test artifacts to remove before committing:** `.env.userbackup`, `.env.docker.userbackup`,
   any `uploads/documents/test/*` and `uploads/properties/*` test files created during verification.

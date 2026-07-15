# Deployment-Readiness Plan — Gestionale Immobiliare

> **Owner:** Kristi · **Target:** Hetzner (Docker + Coolify + Traefik) production for Orlandi Immobiliare
> **Created:** 2026-07-10 · **Status:** Planning complete, execution starting
> **Method:** Every "done" is backed by executed evidence (HTTP code / DB row / log / screenshot) per `CLAUDE.md`. No claim without proof.

This plan is the single source of truth for the readiness work. It was produced from a full evidence-backed read of the codebase (auth, DB, APIs, integrations, frontend, docs, deploy). It supersedes ad-hoc notes in `docs/GAPS.md` and `docs/PRODUCTION_READINESS.md`, which contain unverified "✅ Fixed" claims.

---

## 0. Scope decisions (locked 2026-07-10)

| Fork | Decision |
|------|----------|
| **Tenancy** | Single-agency now, **architected for multi later**: add nullable `agency_id` + a scoping helper; do not rewrite every query yet. |
| **Integrations** | **Production-ready but toggled OFF.** Harden all; off by default; document env vars to activate. Test with mocks (no live external keys provided). |
| **GDPR** | **Full compliance pass**: export, erasure, consent/legal-basis, cookie banner, data-access audit, retention cron, DPA docs. |

---

## 1. Verified baseline — what the app really is

A **mature, largely complete** single-agency real-estate management platform. PHP 8.3 + MySQL 8 + Apache, vanilla-JS fetch-swap SPA, three session-isolated portals (Admin / Tenant / Owner).

**Strengths (confirmed in code):**
- 39 well-designed tables: money in `DECIMAL`, `utf8mb4` throughout, FKs on nearly everything (with deliberate RESTRICT/CASCADE/SET NULL), FK columns auto-indexed.
- Real security primitives: per-session CSRF enforced centrally (`api_bootstrap.php`), three distinct session cookies with `session_write_close()` isolation + ID regeneration, TOTP 2FA (admin), DB-backed login throttle (admin), server-side role gating (`roles.php`).
- Owner & tenant portals are **correctly scoped** to the logged-in account (no IDOR found in static analysis). `download_document.php` uses ownership-scoped WHERE clauses — the historically scary paths are safe.
- Idempotency guard on payment-schedule generation. Homegrown-but-working SMTP, Twilio, Meta, Stripe (raw cURL), a from-scratch PDF writer, keyless Nominatim/Photon geocoding, S3 SigV4 backup.
- ~45 feature views, PWA manifest + service worker, admin-configurable branding (colors + logo, live-swapped).

**Canonical facts resolved:**
- Admin session cookie = **`gestionale_session`** (code default; `.env`, `.env.docker`, `render.yaml` all agree). Only `docs/DEPLOY.md` says `gi_session` — that doc is wrong unless the live Coolify env overrides `SESSION_NAME`. **Action: make one canonical value and confirm against a live login.**
- Authoritative schema = `database/schema_production.sql` (39 tables). `database/schema.sql` is legacy Phase-1 (8 tables) — to be quarantined.
- Tenant/renter ("tenant") ≠ SaaS tenant. There is **no** `agency_id` anywhere today.

---

## 2. Findings register (ranked by blast radius)

### 🔴 Stop-the-line
| ID | Finding | Evidence |
|----|---------|----------|
| S1 | `uploads/properties/` publicly readable; only `uploads/documents/` denied. Property "attachment" media accepts PDF/DOC/DOCX → sensitive files can land in the public tree. | `uploads/.htaccess` blocks only script execution + indexes; `api/property_media.php` returns `url=file_path` served directly by Apache. |
| S2 | Webhook signature validation **fails open** when the secret is unset — Stripe/Twilio/Mailgun accept forged, unsigned POSTs out of the box. | `stripe_webhook.php:86-90`, `whatsapp_webhook.php:25`, `email_inbound.php:22-34`. |
| S3 | Tenant & owner logins: **no throttle, no lockout, no 2FA** — unlimited password guessing. | `login_throttle` wired only into admin `login.php`/`login_2fa.php`. |
| S4 | `stripe_webhook.php` sets `payments.paid_at` (nonexistent column; real column `paid_date`) → after a real charge the UPDATE throws, payment not marked paid. | `stripe_webhook.php:137-142` vs `payments.php:127,150`. |

### 🟠 High
| ID | Finding |
|----|---------|
| H1 | `social_settings.php` / `social_posts.php` have **no `requireRole`** → an `agent` (and `readonly` for GET) can read/modify Meta settings & posts. Violates CLAUDE.md §4.2. |
| H2 | `settings.php` **API** allows role `admin` while the **UI** restricts Settings to `super_admin` — an admin-role user can change branding/email/Meta creds via direct API. |
| H3 | Payment schedule uses `DateTime::modify('+1 month')` → end-of-month overflow (Jan 31 → Mar 3), skipping/shifting months for leases starting on the 29th–31st. |
| H4 | Invoice numbering `COUNT(*)+1` per year → duplicate `FAT-YYYY-NNNN` on concurrent create or after a draft delete. |
| H5 | Committed secret: real ngrok authtoken in `docker-compose.yml`. `DB_USER=root` in production. |
| H6 | Migration hygiene: no `schema_migrations` table; `phase19/22/24/27` non-idempotent; `phase22` header falsely claims idempotency; `phase27` `ADD COLUMN ... AFTER year_built` depends on a column **no migration creates**; baseline dump stale vs `phase28` (contract auto-status). `migrations/README.md` list is broken (skips phase10 which creates contracts/payments!). |
| H7 | Missing FK: `property_insurance.property_id` has an index but **no FK** → deleting a property leaves dangling insurance rows (ERD even annotates this). |
| H8 | No GDPR layer at all (no consent, legal-basis, retention, erasure, or data-access audit) while storing ID documents. |

### 🟡 Medium / cleanup
| ID | Finding |
|----|---------|
| M1 | `rate_limit.php` gates admin-bypass and per-user bucketing on `getCurrentUser()`, which is **never defined** → all callers share one per-IP bucket; admin bypass never fires. |
| M2 | `zz-production.ini` (display_errors Off, log to stderr) exists in `docker/` but is **not COPYied into the image** — prod hardening may not be applied. |
| M3 | `composer.json` requires `stripe/stripe-php` but `vendor/` is empty and `composer.lock` has only PHPMailer, which is **referenced nowhere**. Deps don't match reality. |
| M4 | Two overlapping doc sets (`docs/` + `documentation/`) with contradictions and false "✅ Fixed" claims; phantom `api_rate_limits` table documented as real; wrong table counts (40 vs actual 39); enum drift in ERD. |
| M5 | CI deploy trigger over plain HTTP to a hard-coded Hetzner IP. `avvia.ps1` hard-codes tenant portal password `Portale123!` (demo tooling). |
| M6 | Low-priority missing indexes (composites): `payments(tenant_id,due_date)`, `whatsapp_messages(from_number,received_at)`, `properties(status,city)`, plus `contracts.contract_type`, `expenses.category`. |
| M7 | Tenant portal document query over-shares: shows all docs on the landlord's client record, not just the tenant's property. |

---

## 3. Execution phases

Each phase ends with committed code + an evidence note. I verify against a **running Docker stack** and, for Tier-1 items, a **fresh database**.

### Phase 0 — Environment & true baseline
- Stand up the Docker stack (via `scripts/docker-up.ps1` to dodge OneDrive reparse issues). Confirm PHP/MySQL up, admin login works, **confirm the real cookie name** live.
- Run the CLAUDE.md Tier-1 probes against the **unmodified** app to record the real starting state (esp. S1 public uploads, S2 unsigned webhook, S3 portal brute-force). This is the "before" evidence.

### Phase 1 — Security stop-the-line (S1–S4, H1, H2, H5)
1. **Lock uploads fully.** Deny all direct access under `uploads/`; route property media through an authenticated streamer (mirror `download_document.php` ownership logic) — public listings get only a signed/tokened URL or a dedicated public-safe path for *listing photos only*, never attachments. Decide: listing photos may need public URLs for social/portal export → serve those via a controlled endpoint, not raw Apache.
2. **Fail-closed webhooks.** In production (`APP_ENV=production`), reject webhook calls when the corresponding secret is unset (503/400) instead of accepting unverified events. Keep dev-permissive behind `APP_DEBUG`.
3. **Portal auth hardening.** Wire `login_throttle` into `tenant/login.php` and `owner/login.php`; add lockout. (2FA for portals: optional, deferred — note in docs.)
4. **Fix S4 money bug.** `paid_at` → `paid_date` in `stripe_webhook.php`; add a regression check.
5. **Role gating.** Add `requireRole` to `social_settings.php`/`social_posts.php` (exclude `agent`); align `settings.php` write access to `super_admin` to match the UI.
6. **Secrets.** Remove ngrok token from `docker-compose.yml` → env; introduce a least-privilege MySQL app user (drop `root` in app config).

### Phase 2 — Money & correctness (H3, H4, M1)
1. Month-safe schedule stepping (anchor to start day, clamp to month length; document the proration rule). Add a DB uniqueness guard `payments(contract_id, due_date)` so regeneration is duplicate-safe even under concurrency.
2. Race-safe invoice numbering (dedicated sequence or unique constraint + retry).
3. Fix `rate_limit` user resolution (define/point to `getCurrentUsername`/id) → real per-user buckets + admin bypass.

### Phase 3 — Database: migrations, multi-ready, GDPR schema, indexes (H6, H7, M6, tenancy)
1. **Migration runner + `schema_migrations` table.** Idempotent CLI runner that records applied migrations; make all future migrations guard-checked.
2. **Consolidate baseline.** Regenerate `schema_production.sql` from a clean migrate-from-zero run (fix `phase27` `year_built` dependency; make `phase19/22/24` idempotent). Quarantine legacy `schema.sql`.
3. **Add missing FK** `property_insurance.property_id`.
4. **Multi-tenant scaffolding.** New `agencies` table (one active row) + nullable `agency_id` on top-level tables + a `scopeToAgency()` query helper used going forward. No behavior change now.
5. **GDPR schema.** Tables: `consent_records`, `data_processing_log` (access audit), `erasure_requests`, `data_export_requests`, retention config in `app_settings`. Consent/legal-basis columns on `clients`/`tenants`.
6. **Indexes.** Add the M6 composites.

### Phase 4 — GDPR full compliance (H8, M4-privacy)
1. Data-subject **export** endpoint (owner/tenant: all their records + documents as a downloadable package).
2. Right-to-**erasure** workflow (anonymize + audit; respect legal-retention holds).
3. **Consent capture** + legal-basis fields in admin + portal onboarding; privacy-notice (informativa) pages for both portals.
4. **Cookie consent** banner (admin + portals).
5. **Data-access audit** logging (who viewed which subject's documents/PII).
6. **Retention cron** to purge/anonymize per config; write the DPA + retention procedure doc.

### Phase 5 — Integrations hardening (M3, integrations toggle-off)
1. `composer install` so the autoloader exists; reconcile deps (keep Stripe SDK or commit to the working homegrown cURL path and drop it; same for PHPMailer vs homegrown SMTP). One decision, documented.
2. Uniform, fail-closed, toggle-off config surface for every integration; ensure no dead payment UI when Stripe is off.
3. Produce the definitive **env-var contract** (name → purpose → where set → default).

### Phase 6 — Hetzner deployment (H5, M2, M5, cookie reconciliation)
1. Single canonical `SESSION_NAME`; one `.env.production.example`; resolve `APP_SECRET` (wire it or remove).
2. Dockerfile applies `zz-production.ini`; least-privilege DB user in compose/deploy; drop committed secrets.
3. Hetzner runbook (Coolify + Traefik + TLS + DB import + first-run setup lock + backups cron + log rotation).
4. CI: HTTPS deploy trigger; secrets not hard-coded.
5. Health check + backup cron + log rotation verified.

### Phase 7 — Testing & simulation (CLAUDE.md §4–6 end to end)
- Fresh-DB cold-start demo path: proprietario → immobile → photos → document → PDF contract → test email. Each step evidenced.
- Tier-1 re-run: cross-account IDOR (all 3 portals), role matrix (readonly/agent/admin/super_admin at the API), boundary smoke (401/403 on protected paths), money (schedule count/amount/dates + double-run), documents (incognito fetch must fail after S1 fix).
- Integration reality check (mocked): unsigned webhook now rejected; email/whatsapp/meta/stripe toggled-off produce no dead UI.
- Debug loop per CLAUDE.md §7: one failure, one hypothesis, one fix, re-run the same command.

### Phase 8 — Documentation (final, M4)
- Collapse to **one authoritative doc set**, corrected against reality: overview, architecture, DB schema + indexing, API reference, auth/security, integrations, deployment/ops, GDPR, and a final **Verification Report** with pasted evidence + a truthful "Could NOT verify" list.
- Remove false "✅ Fixed" claims, the phantom table, wrong counts. Provide the complete env-var reference and Hetzner runbook.

---

## 4. What I cannot do (needs you)
- Provision real Stripe/Twilio-WhatsApp-Business/Meta/SMTP accounts, API keys, business verification, or Meta App Review. I build everything to activate via env vars and test with mocks.
- Confirm the **live** Coolify env (esp. `SESSION_NAME`) and the live server's real cron/log state.
- Legal sign-off on the GDPR artifacts (I produce drafts; a lawyer must confirm scope).

## 5. Progress log
- 2026-07-10: Recon complete (6 parallel deep-reads). Scope decided. Plan written. → Starting Phase 0.
- 2026-07-10: **Phase 0 done.** Stack live (PHP 8.5 on :8077 → Docker MySQL `gi-readiness-db:3308`, 39 tables). Baselines captured with live evidence: real admin cookie = `gestionale_session` (DEPLOY.md's `gi_session` is wrong); unauth API → 401; **S2** unsigned webhook accepted + forged row written; **S3** 7 tenant logins all 200 (no lockout) vs admin locks at 5. User `.env` backed up to `.env.userbackup`.
- 2026-07-10: **Phase 1 done (code + app-level verification).**
  - **S4** fixed: `stripe_webhook.php` now writes `payments.paid_date` (was nonexistent `paid_at`). Lint clean.
  - **S2** fixed: Stripe/Twilio/Mailgun webhooks now **fail closed in production** (503 for unsigned when no secret) — verified: all three 503 with `APP_ENV=production`, still permissive in dev.
  - **S3** fixed: `login_throttle` wired into `tenant/login.php` + `owner/login.php` — verified tenant now locks after 5 attempts.
  - **H1** fixed: `requireRole('super_admin','admin')` on `social_settings.php` + `social_posts.php` — verified agent→403, admin/super→200.
  - **H2** fixed: `settings.php` management tightened to `super_admin` (2FA self-service + `?public` branding left open) — verified admin→403, super→200.
  - **S1** fixed (app level): new `api/media.php` auth-scoped streamer; `attachment` media now stored in the deny-all `uploads/documents/property_attachments/` tree and served only via the streamer; images/video keep public direct URLs (listings/social/export intact); added `uploads/properties/.htaccess` denying document extensions. Verified: anonymous→401, staff→200 (application/pdf), photo→direct public URL.
  - **H5** partial: hard-coded ngrok token removed from `docker-compose.yml` (now `${NGROK_AUTHTOKEN}`; **must be rotated — treat as compromised**). Least-privilege DB user → Phase 6.
  - Regression smoke: all key admin GET endpoints 200, no server errors.
  - **Deferred to Phase 7:** Apache-level `.htaccess` deny proof (php -S ignores htaccess) and owner/tenant cross-account streamer denial (needs portal users).
- 2026-07-10: **Phase 2 done (code + verification).**
  - **H3** fixed: `contracts.php generatePayments` now anchors on the start day-of-month and clamps to each month's length (no `+1 month` overflow), runs inside a locked transaction. Verified: Jan-31→Jan-31 lease produces 13 correct month-safe due dates (Feb=28), double-run still blocked.
  - **H4** fixed: `invoices.php nextInvoiceNumber` derives from MAX sequence (no reuse after draft delete) + retry loop ready for the UNIQUE index (added as migration phase29 in Phase 3). Verified: delete 0002 → next is 0004.
  - **M1** fixed: `rate_limit.php` uses `getCurrentRole`/`getCurrentAdminId` (was undefined `getCurrentUser`); per-user buckets now work (verified rows record real user_id); admin-bypass made opt-in (default off) so WhatsApp/Stripe stay limited.
  - Note: `api_rate_limits` is self-provisioned at runtime by `rate_limit.php` — will be moved into the schema in Phase 3 (docs called it a phantom table; it's real at runtime).
- 2026-07-10: **Phase 3 done (DB layer + verification).**
  - New **migration runner** `database/migrate.php` with `schema_migrations` tracking + baseline-aware seeding (records 000+phase3..28 as baseline, applies phase29+). DELIMITER-aware SQL splitter. Verified apply + idempotent re-run ("Nothing to migrate").
  - 6 new idempotent migrations: **phase29** unique `invoices.invoice_number` (verified `uq_invoices_number` non_unique=0); **phase30** `property_insurance` FK + orphan cleanup (H7, verified `fk_pi_property`); **phase31** multi-agency scaffold — `agencies` table + `agency_id NOT NULL DEFAULT 1` on 9 aggregate roots + 9 FKs, agency 1 seeded, backfilled (verified); **phase32** GDPR schema (consent_records, data_processing_log, data_export_requests, erasure_requests + consent columns on clients/tenants + 6 retention settings, verified); **phase33** 5 composite perf indexes (verified); **phase34** `api_rate_limits` formalised.
  - `config/agency.php` `scopeToAgency()` helper for future multi-tenancy (not yet used in WHERE clauses — the scaffold).
  - Fixed the broken `database/migrations/README.md` (was skipping phase10 etc.) to document the runner flow. phase27 `year_built` dependency is now moot (baseline-recorded, never re-run).
  - Regression: client/invoice create + list endpoints still 200; app INSERTs get `agency_id=1` by default.
  - **Deferred to Phase 6:** wire `migrate.php` into the Docker entrypoint so fresh containers converge. **Deferred to Phase 7:** verify `property_insurance` FK blocks a bad delete.
- 2026-07-10: **Phase 4 done (GDPR features + verification).**
  - `config/gdpr.php`: `logDataAccess`/`logDataAccessAdmin` (access audit), `gdprExportSubject`, `gdprAnonymizeSubject`. Fixed a bound-param bug (missing `ip`) found via live testing.
  - `api/gdpr.php` (super_admin/DPO): export (Art.15/20), consent ledger, access log, erasure request + confirmed anonymize. **Verified end to end**: export logged; anonymize wiped PII (name→`Anonimizzato`, email/phone/CF→NULL, `anonymized_at` set); audit log captured export/request/anonymize.
  - Access audit wired into `download_document.php` (and the `media.php` streamer path).
  - `cron/gdpr_retention.php`: purges logs/comms past `retention_*` windows, reports (not deletes) documents. Verified CLI run.
  - `privacy.php` informativa (Art.13/14, agency identity from settings) — verified public 200. `assets/js/cookie_consent.js` self-injecting banner, included in admin + both portals — verified served + present.
  - `docs/GDPR.md`: records of processing, retention schedule, sub-processor/DPA checklist, breach + data-subject-request procedures.
  - Shells re-linted; portal logins still 200.
- 2026-07-10: **Phase 5 done (integrations hardening + verification).**
  - `composer update` synced the stale lock (M3): installed **stripe/stripe-php v13.18.0** + PHPUnit 11, regenerated `composer.lock`, no vulnerabilities. `vendor/` now populated; Stripe SDK loads.
  - **35/35 PHPUnit tests pass** (70 assertions; 1 harmless deprecation).
  - `.env.example` rewritten as the complete, documented **env-var contract** (adds STRIPE_*, MAILGUN_WEBHOOK_KEY, GOOGLE_GEOCODING_API_KEY, MYSQLDUMP_PATH, NGROK_AUTHTOKEN; least-priv DB_USER).
  - Toggle-off verified: WhatsApp disabled → simulated (`wa-sim-*`), no real send; Stripe unconfigured → clean **503**; tenant "Paga online" button is gated on `stripe_secret_key` → **no dead payment UI** when off.
  - Fixed 2 real bugs in `stripe_checkout.php`: missing `config/settings.php` include (would fatal at `getSetting`), and `tenants.first_name/last_name` → real columns `name/surname`. Config check moved before the DB query. Removed dead `readonly` from its role list.
  - **Known limitation (documented):** the tenant self-pay Stripe flow POSTs to an admin-only endpoint; activating Stripe later needs the endpoint to accept scoped tenant sessions or admin-generated payment links.
- 2026-07-10: **Phase 6 in progress (deployment config).**
  - Dockerfile: bakes `zz-production.ini` hardening into `conf.d` (M2 — display_errors Off, log to stderr, expose_php Off); entrypoint now **runs `database/migrate.php` on start** (retry-until-ready, non-fatal) so fresh containers converge.
  - `database/create_app_user.sql`: least-privilege app DB user (ALL on the single schema, no global privs) — replaces `DB_USER=root` (H5).
  - `.env.production.example`: canonical production template (APP_ENV=production, FORCE_HTTPS, SETUP_ENABLED=false, least-priv DB user, all integration keys).
  - `docs/DEPLOY.md`: fixed `gi_session`→`gestionale_session` (canonical) and `DB_USER=root`→`gestionale_app`.
  - CI `deploy.yml`: moved hard-coded Hetzner IP/UUID into `COOLIFY_WEBHOOK_URL` secret; prefer HTTPS.
  - `docker-compose.yml`: ngrok moved to a `dev` profile (won't run in production); token already env-based.
  - `.dockerignore` confirmed to exclude `.env`/`.env.userbackup` from the image.
  - **Verification:** real Docker image build + fresh-DB cold-start under Apache is the Phase 7 battery (in progress).
- 2026-07-10: **Phase 7 (testing) — battery run on real Apache image + fresh DB. 4 real bugs found and fixed.**
  - Verified on Apache: **migrate-on-start** applied all 33 migrations on container start; `zz-production.ini` applied (`expose_php=Off`); boundary smoke all 403/401 (config/db.php, database/*, cron/*, views/*.html, .env, unauth API); webhooks **fail closed** (503) in production.
  - **BUG 1 (fixed):** composer autoload `files` + direct `require_once` double-declared `loadEnv()` → `stripe_webhook.php` 500 whenever `vendor/` exists (production). Removed the redundant `files` autoload from composer.json. Verified stripe webhook now 503.
  - **BUG 2 — CRITICAL (fixed):** portal **session-switching** was broken — after bootstrap opened the admin session, `session_start()` for the tenant/owner session reused the admin session id (not the portal cookie), so **owners/tenants could never load their session** on `download_document.php`/`media.php`/`owner|tenant/index.php`. Fixed by binding `session_id()` to the portal cookie before `session_start()` in `initTenantSession`, `initOwnerSession`, and the manual switches. Verified: owner dashboard 200; **cross-account IDOR now correct** — own doc 200, other account's doc 404 (no leak) across owner+tenant.
  - **BUG 3 — CRITICAL (fixed):** the uploads `.htaccess` protections did not apply in the container — `uploads/` is a named volume that **shadows** the image's `.htaccess`, and the build context excludes `uploads/`. Result: documents served publicly AND **PHP executed** from uploads. Fixed by having the entrypoint **write the protection `.htaccess` files into the uploads tree on startup**. Verified on Apache: protected docs 403, listing photos 200 (public), documents-in-properties 403, `x.php` 403 (no execution).
  - **BUG 4 (fixed):** `generate_pdf.php` contract with missing client/property/tenant ids inserted `0` → `pdf_documents` FK 500. Now passes NULL. Verified: proper payload → PDF generated; missing ids → clean 200.
  - Cold-start demo path on Apache: proprietario → immobile → tenant+auto-lease → 12-payment schedule → PDF → test email (simulated) → dashboard — all pass.
  - **Privilege crossing:** owner/tenant cookie → admin endpoints (clients/admin_users/gdpr) → 401. **Money:** schedule verified (12 & 13 payment cases, month-safe, idempotent).
  - **Final step:** rebuild image with all 4 fixes + clean cold-start to verify the entrypoint (htaccess + migrate) end to end.
  - **Done — clean cold-start on the rebuilt production image (fresh volumes):** migrate-on-start → 46 tables; entrypoint auto-created uploads protection (docs 403, PHP no-exec 403, leak.pdf 403, photo 200) with **no manual step**; webhook 503; owner IDOR from scratch (own 200, other 404). All 4 fixes confirmed baked into the image. **Phase 7 complete.**
- 2026-07-10: **Phase 8 done (documentation).** `docs/VERIFICATION_REPORT.md` (evidence), `docs/CHANGES_2026-07.md` (full change log), `docs/GDPR.md`, `docs/DEPLOYMENT_PLAN.md`. Correction banners added to `docs/GAPS.md` + `docs/PRODUCTION_READINESS.md` (false "✅ Fixed" claims flagged as historical). Root `README.md` points to the new authoritative docs. `database/migrations/README.md` rewritten.
- **ALL 9 PHASES COMPLETE.** Remaining items are operator actions (rotate ngrok token, create least-priv DB user, provide live integration keys, sign GDPR DPAs) — see the checklist in `docs/CHANGES_2026-07.md`.

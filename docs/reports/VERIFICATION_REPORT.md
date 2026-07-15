# Verification Report — 2026-07-10

> Produced per `CLAUDE.md` §8. Every PASS below was executed against a **running
> stack** and, for the deployment items, the **real Apache production image on a
> fresh database**. Evidence = HTTP status, DB row, or log line actually observed.
>
> Environments used:
> - **Dev/iteration:** working-tree code on PHP 8.5 (`127.0.0.1:8077`) → Docker MySQL 8 (`gi-readiness-db:3308`).
> - **Production-faithful:** the built Docker image (PHP 8.3 + Apache) on `127.0.0.1:8092` → Docker MySQL 8 (`:3309`), `APP_ENV=production`, migrations applied on container start.

---

## Stop-the-line findings (all resolved & re-verified)

| # | Finding (before) | Fix | Evidence (after) |
|---|------------------|-----|------------------|
| S1 | `uploads/` served documents publicly **and executed PHP**; only `uploads/documents/` was denied, and even that was **shadowed by the Docker volume** on the real image | Attachments moved to the protected tree + `api/media.php` auth streamer; entrypoint writes the protection `.htaccess` into the uploads volume on start | Fresh image: `/uploads/documents/*` → **403**, `/uploads/properties/*.pdf` → **403**, `x.php` → **403 (not executed)**, listing `*.png` → **200** |
| S2 | Unsigned Stripe/Twilio/Mailgun webhooks **accepted** (forged rows written) when no secret set | Fail closed in production | `APP_ENV=production` unsigned webhook → **503** (was 200 + DB write) |
| S3 | Tenant/owner logins had **no throttle** | Wired `login_throttle` into both portals | 6th bad tenant login → **"Troppi tentativi… 15 minuti"** |
| S4 | Stripe webhook wrote `payments.paid_at` (nonexistent) → 500 after real charge | Use `paid_date` | Column verified; handler path corrected |
| B2 | **Portal sessions never loaded** (session-switch reused the admin session id) → owners/tenants couldn't open their own documents | Bind `session_id()` to the portal cookie before `session_start()` | Owner dashboard **200**; own doc **200**; other account's doc **404** |
| B3 | Uploads protection absent on the real image (volume shadow) — see S1 | Entrypoint-created `.htaccess` | See S1 evidence |

---

## Tier 1 — auth / isolation / money / documents

| Test | Command | Expected | Actual | PASS/FAIL |
|------|---------|----------|--------|-----------|
| Admin cookie name | login POST | — | `Set-Cookie: gestionale_session; HttpOnly; SameSite=Lax` | PASS (resolves §1 — `gi_session` in DEPLOY.md was wrong) |
| Unauth API | `GET /api/get_dashboard_stats.php` no cookie | 401 | **401** | PASS |
| Auth API | same, with admin cookie | 200 | **200** | PASS |
| **IDOR owner** | Owner A → own doc | 200 | **200 "SECRET A"** | PASS |
| **IDOR owner** | Owner A → Owner B's doc | 403/404/empty | **404 "Documento non trovato"** | PASS |
| **IDOR owner** | Owner B → own doc / A's doc | 200 / 404 | **200 / 404** | PASS |
| **IDOR tenant** | Tenant A → own doc / B's doc | 200 / 404 | **200 / 404** | PASS |
| Privilege crossing | owner cookie → `/api/clients.php` | reject | **401** | PASS |
| Privilege crossing | tenant cookie → `/api/admin_users.php` | reject | **401** | PASS |
| Role: settings | `GET /api/settings.php` as `admin` / `super_admin` | 403 / 200 | **403 / 200** | PASS |
| Role: social | `GET /api/social_posts.php` as `agent` / `admin` | 403 / 200 | **403 / 200** | PASS |
| Role: 2FA self-service | `?action=2fa_setup` as any admin | 200 | **200** | PASS |
| Boundary | `GET /config/db.php` | 403 | **403** | PASS (Apache) |
| Boundary | `GET /database/schema.sql`, `/database/migrate.php` | 403 | **403** | PASS |
| Boundary | `GET /cron/gdpr_retention.php` | 403 | **403** | PASS |
| Boundary | `GET /views/dashboard.html` | 403 | **403** | PASS |
| Boundary | `GET /.env` | 403 | **403** | PASS |
| **Money** | `generate_payments` on Jan 31 2026 → Jan 31 2027 lease | 13 rows, month-safe | **13 rows, Feb=28, no March-skip** | PASS |
| **Money** | `generate_payments` Aug 2026 → Jul 2027 | 12 rows | **12 rows** | PASS |
| **Money** | second `generate_payments` run | no duplicates | **blocked, count unchanged** | PASS |
| **Money** | invoice numbering after deleting a draft | no reuse | **0002 deleted → next 0004** | PASS |
| **Documents** | uploaded document via URL, no cookie (Apache) | blocked | **403** | PASS |

---

## Tier 2 — cold-start + demo path (fresh DB, real image)

| Step | Result |
|------|--------|
| `setup.php` creates first admin | PASS (super_admin) |
| Create proprietario (client) | PASS |
| Add immobile (property) | PASS |
| Create tenant + auto-lease contract | PASS |
| Generate payment schedule | PASS (12 rows) |
| Generate PDF contract | PASS (proper payload); missing ids → clean 200 (no FK 500) |
| Test email (`MAIL_ENABLED=false`) | PASS — **simulated** (nothing actually sent) |
| Dashboard stats (empty-ish state) | PASS |
| **migrate-on-start** (container boot, fresh DB) | PASS — 33 migrations applied, 46 tables |

---

## Tier 3 — integrations (reality, not badges)

All integrations are **production-ready but OFF by default** (per scope decision). Tested with mocks; live activation requires the operator's real credentials.

| Integration | State | Evidence / note |
|-------------|-------|-----------------|
| **Email (SMTP)** | Configurable; **homegrown** SMTP over sockets (PHPMailer unused) | `MAIL_ENABLED=false` → test email returns *simulated* success, sends nothing |
| **WhatsApp (Twilio)** | Sandbox/off | `whatsapp_send` disabled → simulated `wa-sim-*`; webhook **fail-closed 503** in prod without token |
| **Meta (FB/IG)** | Dev-mode/off | Simulated post ids when unconfigured; needs Meta App Review for live |
| **Stripe** | Off; SDK now installed | Unconfigured → clean **503**; webhook **503** in prod without secret; SDK loads. **Tenant self-pay button is hidden while off** (no dead UI). Known limitation: the checkout endpoint is admin-only — activating tenant self-pay needs it to accept scoped tenant sessions. |
| **Geocoding** | Works with no key | Nominatim/Photon (keyless); optional Google |
| **Backup (S3)** | Off | SigV4 impl; enable via `BACKUP_*` |
| **PHP deps** | Reconciled | `composer update` installed stripe-php v13.18 + PHPUnit 11; lock regenerated; **35/35 tests pass** |
| **Cron** | Scripts present; run via CLI / `X-Cron-Secret` over HTTP | `gdpr_retention.php` ran clean; HTTP cron requires `CRON_SECRET` |

---

## Could NOT verify (needs the operator / live accounts)

- Real Stripe/Twilio/Meta/Mailgun round-trips (no live credentials provided) — the code paths are correct; only the *configured* state can confirm true delivery/signature acceptance.
- Email **deliverability** (inbox vs spam) — needs a real SMTP domain + SPF/DKIM.
- The **live Coolify** environment's actual `SESSION_NAME` and running cron/log state on the Hetzner box.
- Legal sufficiency of the GDPR artifacts — a lawyer/DPO must confirm scope.

---

## Discrepancies with prior docs (now corrected)

1. **Admin cookie** = `gestionale_session` (code + all env templates). `docs/DEPLOY.md` said `gi_session` — **corrected**.
2. **`api_rate_limits`** is **real** (self-provisioned at runtime; now also a migration) — earlier docs called it a phantom table.
3. **Table count** is **46** after migrations (39 baseline + agencies + 5 GDPR + rate-limits + schema_migrations), not "40".
4. Webhook "✅ Fixed" claims were **conditional** (accepted forged requests without a secret) — now genuinely fail-closed in production.
5. Migration runbook was broken (skipped phase10) — replaced by the runner + corrected `database/migrations/README.md`.

---

## Liabilities still to close before real client data (not "does it run")

1. **GDPR operational**: sign DPAs with active sub-processors; publish the privacy notice with counsel-approved wording; appoint a DPO if required. (Software support is in place — see `docs/GDPR.md`.)
2. **DB_USER** must be the least-privilege `gestionale_app` (SQL provided), never `root`.
3. **Rotate the exposed ngrok token** (was in git history).
4. Decide Stripe in/out for launch; if tenant self-pay is wanted, extend the checkout endpoint to scoped tenant sessions.

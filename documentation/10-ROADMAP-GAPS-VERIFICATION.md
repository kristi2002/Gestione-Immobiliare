# 10 — Roadmap, Gap Register & Verification Protocol

> Consolidated from docs/GAPS.md, docs/ROADMAP_KILLER_FEATURES.md, and CLAUDE.md.
> Status source for gaps: static code inspection (June 2026), **not runtime-verified**.

---

## Part A — Gap register (GAPS.md)

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low · ✅ claimed Fixed/implemented.

### Security gaps (all claimed resolved — verify per CLAUDE.md §1)

| Gap | Sev | Claimed status & detail |
|-----|-----|-------------------------|
| Twilio webhook not validated | 🔴 | ✅ Fixed — `whatsapp_webhook.php` validates `X-Twilio-Signature` HMAC-SHA1 (sort POST params, concat `APP_URL + path + k + v…`, HMAC-SHA1 with auth token, base64 compare); skipped only when `TWILIO_AUTH_TOKEN` unset |
| ADMIN_PASSWORD "admin" | 🔴 | ✅ Fixed — changed in Coolify + Settings |
| CRON_SECRET placeholder | 🔴 | ✅ Fixed — 64-char random hex |
| No CSRF on most endpoints | 🟠 | ✅ Already implemented — `api_bootstrap.php` L22–25 `validateCsrfToken()` on all mutating methods; all 47 admin API files use it; webhooks/cron correctly excluded |
| No rate limiting | 🟡 | ✅ Fixed — `config/rate_limit.php` DB sliding window: WhatsApp 20/min, Stripe 5/min, e-sign 10/min; `api_rate_limits` auto-created; 429 on exceed |
| Meta tokens expire silently | 🟡 | ✅ Fixed — `publishAndUpdatePost()` detects error 190 via `isMetaTokenExpiredError()` → `sendMetaTokenExpiryAlert()` email, rate-limited 1/24h via `meta_token_alert_last_sent` |
| Stripe webhook not validated | 🟡 | ✅ Fixed — `\Stripe\Webhook::constructEvent()` with manual HMAC-SHA256 fallback; rejects missing/invalid sig when `STRIPE_WEBHOOK_SECRET` set |

### Functional gaps

| Gap | Sev | Claimed status |
|-----|-----|----------------|
| Lead → Tenant conversion UI | 🟠 | ✅ Already implemented — "Converti in Inquilino" modal → `leads.php?action=convert_tenant` creates tenant + contract |
| Payment auto-generation | 🟠 | ✅ Already implemented — "Genera scadenzario" on locazione contracts → `contracts.php?action=generate_payments` |
| Maintenance mixed into reminders | 🟠 | ✅ Already implemented — dedicated `views/maintenance_workflow.html` view over `type=maintenance` reminders |
| Cron not running on prod | 🟠 | ✅ Fixed — 4 jobs in root crontab, logging to `/var/log/gestione-cron.log` |
| Instagram text-only posts | 🟡 | ✅ Fixed — `social.js` requires an image when platform is instagram/both; `#post-instagram-warn` warning |
| Owner portal partially built | 🟡 | ✅ Already fully implemented — `owner/` (auth, login, index tabs, report, logout) + `api/owner_portal.php` |
| Social image must be public HTTPS | 🟡 | ✅ Fixed — `META_PUBLIC_BASE_URL=https://testdemo.it`; `uploads/` served without auth so IG can fetch |
| No email on contract expiry | 🟢 | ✅ Fixed — removed invalid `entity_type`/`entity_id` refs in `contract_expirations.php`; dedup by title + date |
| E-sign: no email to signer | 🟢 | ✅ Fixed — `createEsignRequest()` sends link via `sendHtmlEmail()`, returns `email_sent` |
| No WhatsApp inbox pagination | 🟢 | ✅ Fixed — thread opens `?page=1&limit=50`, "Carica messaggi precedenti" bar |
| `sort_order` in media picker | 🟢 | ✅ Already correct — `ORDER BY m.sort_order ASC, m.created_at ASC` |

### Technical debt

| Item | Status |
|------|--------|
| `APP_DEBUG=true` leaks PHP errors into HTML | ✅ Fixed — `APP_DEBUG=false` in prod (do not change) |
| `DB_NAME=default` vs `gestione_immobiliare` | ✅ Fixed — `DB_NAME=default`; rename if migrating off Coolify |
| Dependency management | ✅ Fixed — `composer.json`: removed PHPMailer, added `stripe/stripe-php ^13.0` + `phpunit/phpunit ^11.0`, PSR-4 `App\`/`Tests\`; Dockerfile multi-stage composer install; `vendor/` git-ignored |
| No test suite | ✅ Fixed — PHPUnit 11: `MailTest` (8), `WhatsAppTest` (8), `MetaTest` (10); SQLite in-memory stubs in `tests/bootstrap.php` |

> **The whole point of CLAUDE.md:** "✅ Fixed" is a claim, not proof. Reproduce the highest-risk
> items (CSRF, rate limiting, webhook signatures, cross-account isolation, public uploads)
> before reporting any of them as done. If a test contradicts the doc, the test wins.

---

## Part B — Roadmap: closing the "killer features" gap

Baseline: the 12 wishlist features are ~30% built. Sequenced by business value × feasibility,
respecting dependencies. Effort in rough dev-days. Three features share an **AI provider
layer**; three depend on **fixing public `uploads/`** or **promoting WhatsApp out of sandbox**
— those foundations come first.

### Phase 0 — Foundations (~8–13d)
| Item | What | Effort | Why first |
|---|---|---|---|
| 0.1 Lock down `uploads/` | Route every file through an auth-checked `download_document.php`; deny raw Apache access via `.htaccess` | 2–3d | Stop-the-line security/GDPR hole; prerequisite for the secure vault |
| 0.2 AI provider layer | Single `lib/ai.php` (chat + vision + transcription), key in `.env` | 3–5d | Shared dep for scoring, call summaries, photo descriptions |
| 0.3 WhatsApp out of sandbox | Provision a WhatsApp Business number; move off `join <word>` | 3–5d + vendor lead | Makes WhatsApp client-usable (see [08](08-INTEGRATIONS.md) migration plan) |

### Phase 1 — Lead→Viewing loop (~12–20d, highest ROI)
- **1.1 Magic Match reverse + one-click invite (M, 5–8d):** on new/updated listing, match against active buyer leads; "Matches" button on the property → top-5 leads → "Invita a visionare" pre-fills a WhatsApp/email template. Email path works today.
- **1.2 Pipeline health / stagnation warnings (S, 2–4d):** add `stage_changed_at`; daily cron flags leads stuck >7d; red cards in the funnel. Cheapest high-visibility win.
- **1.3 Missed-call text-back (M, 5–8d):** Twilio Voice webhook → auto-SMS/WhatsApp "I'll call back" + create lead/communication. Needs a Twilio Voice number.

### Phase 2 — Kill data-entry friction (~12–19d)
- **2.1 Import wizard upgrade (M, 4–6d):** visual field-mapping, `.xlsx` (SheetJS), extend to leads/tenants. Removes the #1 switching blocker (5,000-contact migration).
- **2.2 Photo-to-listing AI description (M–L, 6–10d):** on upload, vision model → draft Italian description + suggested type/rooms. Needs 0.2.
- **2.3 WhatsApp side-panel polish (S, 2–3d):** dedicated thread panel + quick-reply chips on the client record. Needs 0.3.

### Phase 3 — Intelligence layer (~20–30d)
- **3.1 Predictive lead scoring (L, 10–15d):** website tracking pixel (`api/track.php`) + rule-based scoring (repeat views, recency, budget fit → hot/warm/cold) + push notification; `score`/`temperature` columns + `lead_events` table. Hard part = instrumenting the external website.
- **3.2 AI call summarization (L, 10–15d):** Twilio Voice recording → transcription (Whisper-class via 0.2) → extract objections/move-in date/features → update client record. **Check GDPR consent for call recording in Italy.**

### Phase 4 — Distribution & management (~20–35d)
- **4.1 Agent leaderboard (M, 4–6d):** first-response timestamp → response-time metric + ranked gamified view.
- **4.2 Property Passport / encrypted vault (M, 5–8d):** encrypt-at-rest for sensitive docs + a client-facing passport link. Needs 0.1 first.
- **4.3 Multi-portal sync-state (L, 10–18d):** per-portal publish + status indicator (Immobiliare.it, Idealista, agency site) over the existing Immobiliare.it JSON export; `portal_sync` table.
- **4.4 Mobile hardening (M, ongoing):** first-class add-contact/add-property/photo-capture on the existing PWA.

### At a glance
| Phase | Theme | Effort |
|---|---|---|
| 0 | Foundations | ~8–13d |
| 1 | Lead→Viewing loop | ~12–20d |
| 2 | Anti-friction | ~12–19d |
| 3 | Intelligence | ~20–30d |
| 4 | Distribution/mgmt | ~20–35d |

**Total to close the gap: ~72–117 dev-days** (~3.5–6 months solo; less with two).

### Recommended first sprint (2 weeks)
1. **0.1 Lock down `uploads/`** — removes the live security/GDPR liability before any demo.
2. **1.2 Pipeline health warnings** — cheapest manager "wow," pure CRM, no vendors.
3. **1.1 Magic Match reverse + invite (email path)** — the core loop, no WhatsApp-prod wait.
Start 0.2 (AI) and 0.3 (WhatsApp prod) procurement in parallel (external lead times).

### Honesty notes for client conversations
- WhatsApp / social / Stripe remain **sandbox / dev / unconfigured** until Phase 0.3 + config — present as *"in attivazione."*
- The "secure vault" is **not** secure today; `uploads/` is publicly served — Phase 0.1 must land first.
- AI features (#2/#4/#5) are **greenfield** — no AI integration exists anywhere in the codebase yet.
- Estimates are planning-grade from code inspection, not runtime-verified.

---

## Part C — Verification protocol (CLAUDE.md)

### Prime directive
Nothing "works," is "fixed," or "looks correct" unless it was executed and the result can be
pasted (HTTP status, response body, DB row, log line, screenshot). No execution → no claim.
What can't be run goes under **"Could NOT verify"** with the reason.

### Test priority by blast radius
1. **Auth + cross-account data isolation** (sinks the deal + GDPR incident) — see [07](07-AUTHENTICATION-SECURITY.md)
2. **Money** (payment schedule generation; Stripe if in scope)
3. **Uploaded personal documents** (IDs, contracts — must not be public)
4. **Cold-start + demo path**
5. **Integrations that look working but aren't** (WhatsApp sandbox, Meta dev mode)

Cosmetic/rare-edge issues → "Known issues" list, don't fix now.

### Key Tier-1 tests
- **IDOR (§4.1):** substitute another account's record ID → must be 401/403/empty, per portal + privilege-crossing (tenant/owner cookie must never reach admin data).
- **Money (§4.4):** run "Genera scadenzario" on a locazione contract → correct row count/amounts/due dates; **run twice** → no duplicates (report count before/after).
- **Public documents (§4.5):** upload a doc as admin → open its URL in a fresh incognito no-cookie session → must be blocked. If it loads, every contract/ID in the system is public.
- **Boundary smoke (§4.3):** dashboard-stats no-cookie→401; `views/dashboard.html`→403; `config/db.php`→403; `setup.php` with `SETUP_ENABLED=false`→403.
- **Webhooks (§6):** unsigned POST to `whatsapp_webhook.php` and `stripe_webhook.php` → must reject; if accepted, the "✅ Fixed" is false.

### Cold-start + demo (Tier 2)
Stand up a **fresh DB, no seed** + a brand-new admin; walk `create proprietario → add immobile
→ upload photos → upload document → generate PDF contract → send test email`. Empty-state
rendering counts. Then run the exact demo sequence on the real domain/data.

### Integrations reality (Tier 3)
Email (must reach inbox not spam); WhatsApp (still Twilio sandbox — flag as needing a Business
number); Meta (Development mode — needs App Review for the agency's pages); Cron (check
`/var/log/gestione-cron.log` for recent entries); webhook signature validation (prove with an
unsigned POST).

### Debug loop (§7)
One failure at a time: reproduce with a single minimal command → read the log/response → state
**one** hypothesis → make **one** change → re-run the **same** command to confirm. No shotgun fixes.

### Report format (§8)
End every verification run with: Stop-the-line findings · Tier 1 table (Test | Command |
Expected | Actual | PASS/FAIL) · Tier 2 cold-start + demo · Tier 3 integrations · Could NOT
verify · Discrepancies with the docs.

---

## Part D — Documentation discrepancies to resolve

Carried forward from the source docs — resolve against a live instance, not by picking a doc:

1. **Admin session cookie name.** `ARCHITECTURE.md` → `gestionale_session`; `DEPLOY.md` →
   `SESSION_NAME=gi_session`. Confirm from a live login before scripting auth tests.
2. **Migration list is stale.** Docs list up to `phase15`; the folder actually contains through
   `phase28`. Use the on-disk list in [09](09-DEPLOYMENT-OPERATIONS.md).
3. **Maintenance `tenant_id` FK.** MODULES.md "Known Platform Gaps #4" says the submitting
   tenant is free-text only; DATABASE.md/INDEXING.md say a `tenant_id` FK was added in phase24.
   The schema (FK present) is authoritative; the MODULES gap note is stale.
4. **"✅ Fixed June 2026" everywhere.** GAPS.md marks the highest-risk items fixed. Per CLAUDE.md
   §1, none of these count until reproduced. Several were never runtime-verified.
5. **API-file count.** Docs reference "47 admin API files"; the repo currently has **59** files
   under `api/` (includes webhooks + cron triggers + newer endpoints). Use [06](06-API-REFERENCE.md).
6. **Undocumented `ecommerce/` directory** exists at the repo root and is not covered by any
   source doc — scope unknown; investigate before relying on it.

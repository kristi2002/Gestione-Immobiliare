# CLAUDE.md — Verification Protocol

> Project: **Gestionale Immobiliare** (Orlandi Immobiliare, Civitanova Marche)
> Stack: PHP 8.3 + MySQL 8 + Apache, vanilla-JS SPA, three login portals.
> Purpose of this file: tell the agent **how to verify the app actually works**, with evidence, before anything is reported as done or shown to the client.

---

## 0. Prime directive

**You do not get to say something "works," is "fixed," or "looks correct" unless you have executed it and can paste the result.** Result = HTTP status code, response body, DB row, log line, or screenshot. No execution, no claim.

If you cannot run a check (no credentials, no server access, missing tool), say so explicitly and list it under "Could NOT verify." Silence or assumption is the failure mode this whole file exists to prevent.

---

## 1. Do not trust the docs as evidence

`GAPS.md` contains many entries marked **"✅ Fixed June 2026"** and **"Already implemented."** These are claims, not proof. Several sit on the highest-risk items in the app (CSRF, rate limiting, webhook signature validation, cross-account isolation).

**Rule: a "✅ Fixed" in any doc means nothing until you reproduce it.** When a doc says X is fixed, your job is to try to break X and report what actually happened. If your test contradicts the doc, the test wins — flag the discrepancy.

A second discrepancy to resolve, not paper over: `ARCHITECTURE.md` calls the admin session cookie `gestionale_session`; `DEPLOY.md` sets `SESSION_NAME=gi_session`. Determine the real cookie name from a live login before scripting auth tests.

---

## 2. What "works" means here

"Works" = meets the stated acceptance criteria **including the unhappy path and the security boundary**, on a **fresh database**, on the **domain/data we will actually demo with**. A green happy-path click-through is not "works."

Test priority is by blast radius, not by coverage. In order:

1. **Auth + cross-account data isolation** (sinks the deal and creates a GDPR incident)
2. **Money** (payment schedule generation, Stripe if in scope)
3. **Uploaded personal documents** (IDs, contracts — must not be public)
4. **Cold-start + demo path**
5. **Integrations that look working but aren't** (WhatsApp sandbox, Meta dev mode)

Cosmetic and rare-edge issues: log to a "Known issues" list, do not fix now.

---

## 3. App map (the surfaces under test)

Three independent login surfaces — isolation between them is the central thing to prove:

| Portal | Entry | Session cookie | Users |
|--------|-------|----------------|-------|
| Admin | `login.php` → `index.php` | admin cookie (confirm name, see §1) | `admin_users` |
| Tenant | `tenant/login.php` → `tenant/index.php` | `gestionale_tenant_session` | `tenant_users` |
| Owner | `owner/login.php` → `owner/index.php` | owner cookie | `clients.portal_*` |

Admin roles: `super_admin` (everything), `admin` (no Settings), `agent` (no Social/Settings), `readonly` (GET only, writes must 403).

Key API endpoints: `clients.php`, `properties.php`, `property_media.php`, `documents.php`, `communications.php`, `reminders.php`, `tenants.php`, `contracts.php`, `leads.php`, `settings.php`, `admin_users.php` (super-admin only), `get_dashboard_stats.php`, `owner_portal.php`, `esign.php`, `stripe_checkout.php`, `stripe_webhook.php`, `whatsapp_webhook.php`, `whatsapp_inbox.php`. Downloads: `download_document.php`, `download_pdf.php`.

---

## 4. TIER 1 — auth, isolation, money, documents (test hard)

### 4.1 Cross-account data leakage (IDOR) — the most important test in this file

Procedure for each portal:
1. Log in as account **A**, capture a real data-fetching request (note the record ID in the URL or JSON body).
2. Re-issue the same request but substitute an ID belonging to account **B**.
3. **PASS** = `401`/`403` or empty/owned-only result. **FAIL** = you receive B's data.

Run it for:
- **Tenant portal:** tenant A must not read tenant B's lease, property, documents, or payments.
- **Owner portal:** owner A must not read owner B's properties, contracts, payments, documents, communications. (`owner/index.php` tabs + `api/owner_portal.php`.)
- **Privilege crossing:** call an admin endpoint (e.g. `GET /api/clients.php`) with a **tenant** cookie and again with an **owner** cookie. Both must reject. A tenant/owner session must never reach admin data.

Any leak here is a stop-the-line finding. Report it first, in plain language, with the exact request and the data that came back.

### 4.2 Admin auth + roles
- Wrong password → rejected, no session. **PASS/FAIL + body.**
- Correct password → dashboard. 
- `readonly` user → `POST`/`PUT`/`DELETE` to a mutating endpoint must return **403** at the **API level** (don't trust a hidden button — call the API directly with the readonly cookie).
- `agent` user → Social/Settings endpoints rejected.
- `admin_users.php` → reachable only by `super_admin`; test with a plain `admin` cookie, expect rejection.

### 4.3 Boundary smoke (from PRODUCTION_READINESS §5)
- `GET /api/get_dashboard_stats.php` with no cookie → **401**
- `GET /views/dashboard.html` directly → **403**
- `GET /config/db.php` directly → **403**
- `GET /setup.php` with `SETUP_ENABLED=false` → **403**

### 4.4 Money — payment schedule generation
- On a `locazione` contract with tenant + rent + start/end dates set, run "Genera scadenzario" (`api/contracts.php?action=generate_payments`).
- Verify: correct **number of monthly rows**, correct **amount** per row, correct **due dates**.
- **Run it twice.** Second run must NOT create duplicates. Report the row count before and after.
- If Stripe is in scope: confirm whether `STRIPE_*` env vars are actually set. If not configured, it is **not** working — say so, and confirm no dead "Pay now" button appears in any portal.

### 4.5 Uploaded documents must not be public — critical
`PRODUCTION_READINESS.md` itself states `uploads/` is served by Apache without auth.
1. As admin, upload a document (treat it as a tenant's ID card).
2. Copy the resulting file URL.
3. Open it in a **fresh incognito session with no cookies**.
4. **PASS** = blocked / redirected to login / 403. **FAIL** = the file loads.

If it loads, every contract and identity document in the system is readable by anyone with the link. For a real agency this is the single most serious hole — report it before any feature result.

---

## 5. TIER 2 — cold-start and the demo path

### 5.1 Cold-start (catches day-one bugs the live DB hides)
Stand up a **fresh database with no seed data** and a **brand-new agency admin account**. Walk the core flow end to end:
`create proprietario → add immobile → upload photos → upload a document → generate a PDF contract → send a test email`.
Report each step's result. Empty-state rendering counts — a blank list must render cleanly, not error.

### 5.2 Demo path
Run the exact sequence that will be shown to Orlandi, on the real domain and the real data you'll present with. It must be flawless. List every step and its result.

---

## 6. TIER 3 — integrations: report reality, not status badges

For each, state plainly whether it is **client-usable** or **demo-only**:
- **Email:** send a test from Settings → confirm it arrives in **inbox, not spam**. Paste the result.
- **WhatsApp (Twilio):** still **sandbox** — a real user must text `join <word>` to a US number first. This is **not** a working WhatsApp feature for the client; flag it as needing a WhatsApp Business number.
- **Meta/social:** **Development mode** — posts only to your own accounts. Posting to the agency's pages requires Meta App Review. Flag it.
- **Cron:** confirm jobs are **actually running** — check `/var/log/gestione-cron.log` for recent entries. Script existence ≠ scheduled execution.
- **Webhook signature validation** (marked fixed in GAPS): prove it. Send an **unsigned POST** to `api/whatsapp_webhook.php`; expect rejection. Do the same logic check for `api/stripe_webhook.php`. If an unsigned request is accepted, the "✅ Fixed" is false — report it.

---

## 7. Debug loop (when something fails)

One failure at a time:
1. **Reproduce** with a single minimal command.
2. Read the **log / error / response**.
3. State **one** hypothesis.
4. Make **one** change.
5. Re-run the **same** command to confirm.

Do not apply several speculative fixes at once. Do not move on until the same command that failed now passes, with the output pasted.

---

## 8. Report format (end every verification run with this)

```
## Verification report — <date>

### Stop-the-line findings
(IDOR leaks, public document exposure, money duplication — with exact request + result)

### Tier 1 — auth / isolation / money / documents
| Test | Command | Expected | Actual | PASS/FAIL |

### Tier 2 — cold-start + demo path
(step-by-step results)

### Tier 3 — integrations
(client-usable vs demo-only, with evidence)

### Could NOT verify
(what, and why — missing creds, no server access, etc.)

### Discrepancies with the docs
(where a "✅ Fixed" did not hold up)
```

---

## 9. Liabilities to surface every time (do not let these go silent)

These are not "does it run" issues; they are sale/legal risks. Name them in any readiness report:

1. **Public `uploads/` + no GDPR layer.** No privacy informativa, no legal basis, no DPA with Twilio/Meta/Mailgun, no retention/deletion procedure — while handling owners' and tenants' personal data including ID documents. In Italy this becomes the agency's problem and then ours. (Not legal advice — a lawyer should confirm scope.)
2. **`DB_USER=root` in production** (`DEPLOY.md`), which the readiness doc itself says not to do.
3. **Payments scope undecided** — Stripe is "code ready, not configured." Decide in or out; if out, ensure no dead payment UI shows in the demo.

**Honest selling posture:** the core CRUD + documents + reminders + PDF is genuinely the working product. WhatsApp / social / Stripe are sandbox / dev / unconfigured and should be presented as "in attivazione," not as working. Fix the `uploads/` exposure before putting real documents in front of a real client.

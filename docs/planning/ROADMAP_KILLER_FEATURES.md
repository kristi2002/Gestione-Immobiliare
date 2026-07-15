# Roadmap — Closing the "Killer Features" Gap

> Project: **Gestionale Immobiliare** (Orlandi Immobiliare)
> Baseline: the 12 wishlist features are ~30% built. This roadmap sequences the missing ~70%.
> Stack constraint: PHP 8.3 + MySQL 8 + vanilla-JS SPA. Effort is rough dev-days for a small team.
> Status source: static code inspection (June 2026). Not runtime-verified — see CLAUDE.md §0.

---

## ⏱ Update — July 2026 implementation pass

A first implementation pass shipped the **Italian fiscal/legal compliance layer** (the real
market differentiator) plus several intelligence features. See `docs/FEATURE_IMPLEMENTATION_PLAN.md`
for the full plan and status. Shipped in code (not yet runtime-verified per CLAUDE.md §0):

- **Magic Match reverse** (1.1) — `?action=matching_leads` + "Trova lead" with WA/email invites. ✅ code
- **AI provider layer** (0.2) — `lib/ai.php` + AI listing copywriter (`api/ai_describe.php`). ✅ code 🔑 key
- **FatturaPA XML**, **lease registration (RLI/cedolare/F24 tracking)**, **antiriciclaggio module**,
  **dati catastali + APE**, **scadenzario fiscale unico**, **ISTAT adjustment**, **portal sync status**,
  **SEPA/SDD mandates** — all new (were not in the original 12-feature wishlist but are the
  compliance moat competitors already have). ✅ code, 🔑 where a transmission channel/key is needed.

Uploads lockdown (0.1) — **hardened July 2026**: defense-in-depth added on top of the existing
documents deny-all (root belt-and-suspenders `.htaccess`, a `config/upload_guard.php` path-containment
guard wired into all three file streamers, `nosniff`). Path guard executed 7/7; live incognito HTTP
fetch still owed. See `docs/UPLOADS_SECURITY.md`.

Still open from this roadmap: WhatsApp production (0.3), pipeline health (1.2),
missed-call text-back (1.3), import wizard (2.1), photo→listing on upload hook (2.2 — copywriter exists,
auto-on-upload not wired), predictive scoring (3.1), call summaries (3.2), leaderboard (4.1),
encrypted vault (4.2), real portal push (4.3 — status tracking shipped, transport not).

---

## Sequencing principle

Order by **business value × feasibility**, and respect dependencies. Three features share an
**AI provider layer**, and three depend on **fixing the public `uploads/` hole** or on
**promoting WhatsApp out of sandbox**. Build those shared foundations first (Phase 0) so the
feature phases don't each re-solve them.

The phases below also follow your own strategic advice: **start with the Lead→Viewing loop**,
then kill **data-entry friction**, then layer in **intelligence**, then **distribution/management**.

---

## Phase 0 — Foundations (unblock everything else)

These are prerequisites, not features. Nothing client-facing ships well until they exist.

| Item | What to build | Touches | Effort | Why first |
|---|---|---|---|---|
| **0.1 Lock down `uploads/`** | Route every file through an auth-checked download script; deny direct Apache access via `.htaccess`. `download_document.php` already exists — extend it and block the raw folder. | `.htaccess`, `download_document.php`, `documents.php` | **2–3d** | Stop-the-line security hole (CLAUDE.md §4.5/§9). Also the prerequisite for the "secure vault" (#7). |
| **0.2 AI provider layer** | A single `lib/ai.php` wrapper (chat + vision + transcription) with the API key in `.env`. One integration point, reused by scoring, call summaries, and photo descriptions. | new `lib/ai.php`, `.env.example`, `config/` | **3–5d** | Shared dependency for features #2, #4, #5. Build once. |
| **0.3 WhatsApp out of sandbox** | Provision a WhatsApp Business number (Twilio production or Meta Cloud API); move template approval off the sandbox `join <word>` flow. | `whatsapp_*.php`, Settings → WhatsApp | **3–5d + vendor lead time** | Unblocks #1 as a *client-usable* feature instead of demo-only. |

**Phase 0 total: ~8–13 dev-days** (plus external WhatsApp approval lead time).

---

## Phase 1 — The Lead→Viewing loop (highest ROI)

Your single most valuable bet: turn inbound interest into booked viewings. These three compound.

### 1.1 Magic Match — reverse direction + one-click invite  ·  **M (5–8d)**
- **Have:** `matchProperties()` + `lead_property_matches` table + match modal (lead → properties).
- **Build:** the inverse — on new/updated listing, run the same criteria against **active buyer leads**;
  add a **"Matches"** button on the property record showing top-5 compatible leads, each with a
  **"Invita a visionare"** button that pre-fills a WhatsApp/email template (templates already exist).
- **Where:** `api/properties.php` (reuse match SQL), `assets/js/property_profile.js`, reuse `whatsapp_templates`.
- **Dependency:** WhatsApp template send works best post-0.3, but email path works today.

### 1.2 Pipeline health / stagnation warnings  ·  **S (2–4d)**
- **Build:** add `stage_changed_at` timestamp to leads; a daily cron flags leads stuck >7d with no
  follow-up; render the card **red** in the funnel and surface a manager view.
- **Where:** new migration (`phaseXX_lead_stage_aging.sql`), `cron/` job, `assets/js/leads.js`.
- **Cheapest high-visibility win on the list.**

### 1.3 Missed-call text-back  ·  **M (5–8d)**
- **Build:** Twilio Voice webhook on a missed/no-answer event → auto-SMS/WhatsApp the prospect a
  templated "I'll call you back" message and create a lead/communication row.
- **Where:** new `api/voice_webhook.php`, reuse `communications.php` + templates.
- **Dependency:** Twilio Voice number (overlaps with 0.3 vendor setup).

**Phase 1 total: ~12–20 dev-days.** Delivers the loop that converts calls → visits.

---

## Phase 2 — Kill data-entry friction (drives adoption)

Agents only keep using the tool if adding data is near-zero effort.

### 2.1 Import wizard upgrade  ·  **M (4–6d)**
- **Have:** working CSV import for clients + properties (header-name matching, preview modal).
- **Build:** a visual **field-mapping step** (drag source column → target field), **Excel (.xlsx)**
  support, and extend to leads/tenants. Auto-detect common header variants.
- **Where:** `assets/js/clients.js`/`properties.js` import modal, `api/*?action=import`. Use SheetJS for xlsx.
- **Value:** removes the #1 reason agencies refuse to switch (5,000-contact migration).

### 2.2 Photo-to-listing AI description  ·  **M–L (6–10d)**
- **Have:** photo gallery upload (`property_media.php`).
- **Build:** on upload, send images to a vision model (via 0.2 layer) → draft Italian listing
  description + suggested type/rooms; agent verifies price + sqm.
- **Where:** `api/property_media.php` post-upload hook, `assets/js/property_edit.js`.
- **Dependency:** Phase 0.2.

### 2.3 WhatsApp side-panel polish  ·  **S (2–3d)**
- **Have:** combined comms chat tab in client profile.
- **Build:** a dedicated WhatsApp thread panel with quick-reply chips inline on the client record.
- **Where:** `assets/js/client_profile.js`, `whatsapp_inbox.php`.
- **Dependency:** Phase 0.3 for it to be client-usable.

**Phase 2 total: ~12–19 dev-days.**

---

## Phase 3 — Intelligence layer (the differentiators)

Highest "superpower" perception, highest effort. Do after the loop + adoption basics are solid.

### 3.1 Predictive lead scoring  ·  **L (10–15d)**
- **Build:** (a) a tracking pixel/endpoint on the **agency website** logging which property pages a
  lead views; (b) a scoring engine (rule-based first: repeat views, recency, budget fit → hot/warm/cold);
  (c) push notification to the agent. Add `score`, `temperature` columns + a `lead_events` table.
- **Where:** new public `api/track.php`, migration, `cron/` recompute, web-push via existing `notifications.php`.
- **Note:** the hard part is instrumenting the external website, not the CRM.

### 3.2 AI call summarization  ·  **L (10–15d)**
- **Build:** call recording (Twilio Voice), transcription via the 0.2 layer (Whisper-class), then
  extraction of price objections / move-in date / mentioned features → auto-update the client record.
- **Where:** `api/voice_webhook.php` (from 1.3), `lib/ai.php`, `communications.php`.
- **Dependency:** Phase 0.2 + Twilio Voice. **Check GDPR consent for call recording in Italy.**

**Phase 3 total: ~20–30 dev-days.**

---

## Phase 4 — Distribution & management

Valuable but not blocking the core loop; some are heavy due to third-party APIs.

### 4.1 Agent leaderboard (response time + ranking)  ·  **M (4–6d)**
- **Have:** per-agent `conversion_rate` in `agent_portfolio.php`.
- **Build:** capture **first-response timestamp** on leads → response-time metric; add a ranked,
  gamified leaderboard view.
- **Where:** migration (lead `first_response_at`), `api/agent_portfolio.php`, `assets/js/agents.js`.

### 4.2 Property Passport (encrypted vault + client passport link)  ·  **M (5–8d)**
- **Have:** documents + owner portal + token e-sign. **Missing:** encryption + a client-facing passport.
- **Build:** encrypt-at-rest for sensitive docs; a per-property "passport" link for clients to view
  docs, offer status, and sign. Optionally swap custom e-sign for DocuSign/Adobe.
- **Dependency:** Phase 0.1 (must close the public-folder hole first).

### 4.3 Multi-portal sync-state  ·  **L (10–18d)**
- **Have:** Immobiliare.it-compatible JSON export (`property_export.php`).
- **Build:** per-portal publish + a **status indicator** (OK / syncing / failed) per listing per portal
  (Immobiliare.it, Idealista, agency site); alert on sync failure.
- **Where:** new `portal_sync` table, `api/`, `assets/js/property_profile.js`.
- **Note:** effort dominated by each portal's feed/API terms; phase per-portal.

### 4.4 Mobile hardening  ·  **M (ongoing)**
- **Have:** PWA (`manifest.json`, `sw.js`), responsive SPA.
- **Build:** ensure add-contact / add-property / photo-capture are first-class on mobile; close any
  desktop-only gaps. Native app only if PWA proves insufficient.

**Phase 4 total: ~20–35 dev-days.**

---

## At a glance

| Phase | Theme | Features | Effort |
|---|---|---|---|
| **0** | Foundations | uploads lockdown, AI layer, WhatsApp prod | ~8–13d |
| **1** | Lead→Viewing loop | Magic Match, pipeline health, missed-call text-back | ~12–20d |
| **2** | Anti-friction | import wizard, photo-to-listing AI, WA panel | ~12–19d |
| **3** | Intelligence | lead scoring, AI call summaries | ~20–30d |
| **4** | Distribution/mgmt | leaderboard, passport vault, portal sync, mobile | ~20–35d |

**Total to close the gap: ~72–117 dev-days** (~3.5–6 months for one developer; less with two).

---

## Recommended first sprint (2 weeks)

Maximum visible value, low dependency risk:

1. **0.1 Lock down `uploads/`** — removes the live security/GDPR liability before any demo.
2. **1.2 Pipeline health warnings** — cheapest "wow" for the manager; pure CRM, no vendors.
3. **1.1 Magic Match reverse + invite (email path)** — the core of the Lead→Viewing loop, works
   without waiting on WhatsApp production approval.

Start WhatsApp-production and AI-provider procurement (0.2, 0.3) in parallel since they have
external lead times.

---

## Honesty notes (carry into any client conversation)

- WhatsApp / social / Stripe remain **sandbox / dev / unconfigured** until Phase 0.3 and config — present as *"in attivazione."*
- The "secure vault" (#7) is **not** secure today; `uploads/` is publicly served. Phase 0.1 must land first.
- AI features (#2, #4, #5) are **greenfield** — there is currently no AI integration anywhere in the codebase.
- Estimates are planning-grade, from code inspection, not runtime-verified per CLAUDE.md §0.

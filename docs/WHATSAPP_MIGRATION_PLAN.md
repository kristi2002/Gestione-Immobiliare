# WhatsApp Migration Plan — Twilio → Meta Cloud API

> Project: **Gestionale Immobiliare** (Orlandi Immobiliare, Civitanova Marche)
> Goal: remove the Twilio sandbox dependency and build a **professional, client-usable** WhatsApp integration on **Meta's WhatsApp Cloud API**, with the compliance and reliability layer a real agency needs.
> Status of this doc: **plan only.** Nothing here is "done" until it is built and verified per `CLAUDE.md` (paste the actual output, test the unhappy path).

---

## 0. The decision, stated plainly

We are switching the transport from **Twilio WhatsApp** to **Meta WhatsApp Cloud API (direct)**.

Why:
- Twilio is a reseller layer that adds per-message markup forever and abstracts us away from Meta's real template/24-hour-window model.
- The architecture we want (`hub.challenge` verification, `X-Hub-Signature-256`, Meta-approved templates with `{{1}}` variables, the 24-hour session window) **is** the Cloud API. Building it "properly" on Twilio means fighting the abstraction.
- The sandbox requires every contact to text `join <word>` to a US number first. That is not a feature we can show a client.

Trade-off accepted: Meta Business verification is slower to set up and is the **client's** paperwork. That is the critical path — start it before writing code (see §2).

---

## 1. What we keep, what we delete

The good news: roughly the top third of the existing module survives the switch. The transport changes; the UI and storage shape mostly don't.

### Keep (reuse as-is or lightly adapt)
- `views/whatsapp_inbox.html` + `assets/js/whatsapp_inbox.js` — the inbox UI, threaded view, pagination.
- `api/whatsapp_inbox.php` — the read/store API for threads and messages (adapt column names, §4).
- `whatsapp_messages` table shape — extend it, don't replace it (§4).
- Rate limiting in `api/whatsapp_send.php` (`checkRateLimit`), notification-on-inbound flow, the `requireRole` guards.
- `whatsapp_templates` table + `api/whatsapp_templates.php` CRUD — repurposed to mirror Meta-approved templates (§5.3).

### Delete / replace (Twilio-specific)
| File / symbol | Action |
|---|---|
| `config/whatsapp.php` → `sendWhatsAppMessage()` (Twilio REST call) | **Replace** with Meta Cloud API client (§5.1). |
| `config/whatsapp.php` → `parseTwilioWebhook()` | **Replace** with `parseMetaWebhook()` (§5.2). |
| `api/whatsapp_webhook.php` → Twilio `X-Twilio-Signature` HMAC-SHA1 block | **Replace** with Meta `hub.challenge` GET handshake + `X-Hub-Signature-256` validation (§5.2). |
| `getWhatsAppConfig()` in `config/settings.php` (`twilio_account_sid`, `twilio_auth_token`, `twilio_whatsapp_from`) | **Replace** with Meta config keys (§5.4). |
| `.env` / `.env.example` `TWILIO_*` vars | **Remove**, add `WA_*` / `META_WABA_*` (§5.4). |
| `twilio_sid` column on `whatsapp_messages` | **Rename** to `wa_message_id` (Meta's `wamid.*`), keep for idempotency (§4). |
| `tests/Unit/WhatsAppTest.php` (`parseTwilioWebhook`, Twilio number tests) | **Rewrite** for `parseMetaWebhook` + number normalization (§7). |
| `docs/GAPS.md` "Twilio webhook validation ✅ Fixed" rows | **Update** to reflect Meta signature validation once built. |

Note: `config/meta.php` already exists for Facebook/Instagram **publishing** and has a reusable `metaApiRequest()` low-level curl helper and `META_API_VERSION`. We will **not** overload it — WhatsApp gets its own `config/whatsapp_cloud.php` to keep concerns separate, but we can copy the curl/error-parsing pattern.

---

## 2. Prerequisites — the critical path (client tasks, start NOW)

None of the build is demoable to a real user until this clears, and it is not under our control. Hand the client this checklist on day one:

1. **Meta Business Manager** account for the agency (business.facebook.com).
2. **Business verification** — Meta requires legal business documents (visura/partita IVA, address proof). This is the slow step: budget **days to weeks**.
3. A **dedicated phone number** that is **NOT currently registered on any WhatsApp / WhatsApp Business app**. It will receive an OTP during WABA setup. (A new SIM or a landline that can receive a voice-OTP works.)
4. **WhatsApp Business Account (WABA)** created inside Business Manager, with the number registered to it.
5. **Display name** for the number, submitted for Meta approval (must relate to the business; "Orlandi Immobiliare" is fine).
6. A **Meta App** (developer.facebook.com) with the *WhatsApp* product added → this yields the `Phone Number ID`, `WABA ID`, a temporary token, and lets us generate a **permanent System User token** (use a System User token, never the 24h temp token, in production).

Deliverables we need from the client/Meta console before §6 phase work goes live:
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID` (WABA ID)
- `WHATSAPP_ACCESS_TOKEN` (permanent System User token)
- `WHATSAPP_APP_SECRET` (for `X-Hub-Signature-256`)
- `WHATSAPP_VERIFY_TOKEN` (a random string we choose; used in the `hub.challenge` handshake)

---

## 3. Environments

Two environments, mirroring the `CLAUDE.md` cold-start discipline:

- **Dev / test** — Meta gives every app a **free test number** in the WhatsApp product dashboard. Instant, no verification needed. Use it for all development and for the unhappy-path tests. You can add up to 5 test recipient numbers.
- **Production** — the agency's verified WABA number. Used only for the demo and live use.

Config is environment-switched via the `WA_*` env vars (§5.4) so the same code runs against either number. **Never demo on the test number.**

---

## 4. Database changes

All migrations idempotent (`IF NOT EXISTS`, guarded `ALTER`), consistent with the existing `database/migrations/` convention. Create `database/migrations/phase23_whatsapp_cloud.sql`.

### 4.1 Extend `whatsapp_messages`
Rename the Twilio column, add idempotency + delivery-status + lead link + window tracking.

```sql
-- Idempotency key: Meta's wamid.* (was twilio_sid)
ALTER TABLE whatsapp_messages
  CHANGE COLUMN twilio_sid wa_message_id VARCHAR(128) DEFAULT NULL;

-- Enforce idempotency at the DB level — a redelivered webhook can't double-insert
ALTER TABLE whatsapp_messages
  ADD UNIQUE KEY uq_wm_wa_message_id (wa_message_id);

-- Delivery lifecycle (Meta status webhooks: sent → delivered → read / failed)
ALTER TABLE whatsapp_messages
  ADD COLUMN status ENUM('queued','sent','delivered','read','failed') NOT NULL DEFAULT 'queued' AFTER body,
  ADD COLUMN status_updated_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN error_detail VARCHAR(500) DEFAULT NULL;

-- Link to the CRM entity that matters for sales: leads (in addition to clients/tenants)
ALTER TABLE whatsapp_messages
  ADD COLUMN lead_id INT UNSIGNED DEFAULT NULL AFTER tenant_id,
  ADD KEY idx_wm_lead (lead_id),
  ADD CONSTRAINT fk_wm_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Message type so the UI can render templates / media / text distinctly
ALTER TABLE whatsapp_messages
  ADD COLUMN message_type ENUM('text','template','image','document','audio','video','location','interactive') NOT NULL DEFAULT 'text' AFTER direction;
```

### 4.2 New: `whatsapp_threads` (the 24-hour window lives here)
One row per contact phone number. This is the state machine: it records when the customer last messaged us, which is what opens/closes the free-form window.

```sql
CREATE TABLE IF NOT EXISTS whatsapp_threads (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone                 VARCHAR(30)  NOT NULL,
  lead_id               INT UNSIGNED DEFAULT NULL,
  client_id             INT UNSIGNED DEFAULT NULL,
  tenant_id             INT UNSIGNED DEFAULT NULL,
  contact_name          VARCHAR(200) DEFAULT NULL,
  last_inbound_at       TIMESTAMP    NULL DEFAULT NULL,  -- opens the 24h window
  last_outbound_at      TIMESTAMP    NULL DEFAULT NULL,
  last_message_preview  VARCHAR(255) DEFAULT NULL,
  unread_count          INT UNSIGNED NOT NULL DEFAULT 0,
  needs_attention       TINYINT(1)   NOT NULL DEFAULT 0,  -- handoff queue flag
  is_blocked            TINYINT(1)   NOT NULL DEFAULT 0,   -- set when contact sends STOP
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wt_phone (phone),
  KEY idx_wt_lead (lead_id),
  KEY idx_wt_attention (needs_attention),
  CONSTRAINT fk_wt_lead   FOREIGN KEY (lead_id)   REFERENCES leads(id)   ON DELETE SET NULL,
  CONSTRAINT fk_wt_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_wt_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Window rule (enforced in code, §6 Phase 5):** free-form (`text`) outbound is allowed only if `last_inbound_at` is within 24h. Otherwise the API must reject the free-form send and force a `template` message. This is what stops the agency's number from being flagged.

### 4.3 New: `whatsapp_consent` (the opt-in audit trail — GDPR)
Non-negotiable for a professional/EU deployment. Every opt-in is a permanent record.

```sql
CREATE TABLE IF NOT EXISTS whatsapp_consent (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone         VARCHAR(30)  NOT NULL,
  lead_id       INT UNSIGNED DEFAULT NULL,
  client_id     INT UNSIGNED DEFAULT NULL,
  tenant_id     INT UNSIGNED DEFAULT NULL,
  event         ENUM('opt_in','opt_out') NOT NULL,
  method        ENUM('web_form','whatsapp_button','manual','inbound_message','stop_keyword') NOT NULL,
  source_url    VARCHAR(500) DEFAULT NULL,
  consent_text  TEXT         DEFAULT NULL,  -- the exact wording the user agreed to
  ip_address    VARCHAR(45)  DEFAULT NULL,
  user_agent    VARCHAR(255) DEFAULT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_wc_phone (phone),
  KEY idx_wc_event (event)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.4 Repurpose `whatsapp_templates` for Meta-approved templates
Add the Meta-side identity so local templates map to approved ones.

```sql
ALTER TABLE whatsapp_templates
  ADD COLUMN meta_template_name VARCHAR(200) DEFAULT NULL,                 -- exact name registered with Meta
  ADD COLUMN language_code      VARCHAR(10)  NOT NULL DEFAULT 'it',
  ADD COLUMN meta_status        ENUM('local','pending','approved','rejected','paused') NOT NULL DEFAULT 'local',
  ADD COLUMN meta_category      ENUM('MARKETING','UTILITY','AUTHENTICATION') DEFAULT 'UTILITY',
  ADD COLUMN last_synced_at     TIMESTAMP NULL DEFAULT NULL;
```

---

## 5. The new transport layer

### 5.1 `config/whatsapp_cloud.php` — outbound client (replaces Twilio send)
Send via Graph API instead of `api.twilio.com`. Two send paths: **free-form text** (only inside the window) and **template** (always allowed).

Endpoint: `POST https://graph.facebook.com/v19.0/{PHONE_NUMBER_ID}/messages`
Auth: `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}` header (not basic auth like Twilio).

```php
// Free-form text (window must be open — caller checks first)
function sendWhatsAppText(string $toPhone, string $body): array;

// Template message (variables fill {{1}}, {{2}}… components)
function sendWhatsAppTemplate(string $toPhone, string $templateName,
                              string $lang, array $variables): array;

// Returns: ['success'=>bool, 'wa_message_id'=>?string, 'error'=>?string]
// Both build a JSON body and POST it; reuse the curl/error pattern from
// metaApiRequest() in config/meta.php (Bearer header instead of access_token param).
```

Text body shape:
```json
{ "messaging_product": "whatsapp", "to": "39333...", "type": "text",
  "text": { "body": "..." } }
```
Template body shape:
```json
{ "messaging_product": "whatsapp", "to": "39333...", "type": "template",
  "template": { "name": "scadenza_contratto", "language": { "code": "it" },
    "components": [ { "type": "body", "parameters": [
        { "type": "text", "text": "Via Roma 12" } ] } ] } }
```
Keep `normalizeWhatsAppNumber()` from the old `config/whatsapp.php` — Meta wants E.164 digits **without** the `+` and without the `whatsapp:` prefix, so trim accordingly.

### 5.2 `api/whatsapp_webhook.php` — rewrite for Meta
Two responsibilities Twilio didn't have:

**(a) Verification handshake (GET).** Meta calls the webhook once with a challenge when you register the URL.
```php
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $mode      = $_GET['hub_mode']         ?? '';
    $token     = $_GET['hub_verify_token'] ?? '';
    $challenge = $_GET['hub_challenge']    ?? '';
    if ($mode === 'subscribe' && hash_equals(getWaVerifyToken(), $token)) {
        http_response_code(200);
        echo $challenge;            // echo back verbatim — this is the handshake
    } else {
        http_response_code(403);
    }
    exit;
}
```

**(b) Signature validation (POST).** Meta signs the **raw body** with HMAC-SHA256 using the App Secret.
```php
$raw = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';     // "sha256=...."
$expected = 'sha256=' . hash_hmac('sha256', $raw, getWaAppSecret());
if (!hash_equals($expected, $sig)) { http_response_code(403); exit; }
$payload = json_decode($raw, true);
```
> Important: read `php://input` for the HMAC **before** anything consumes the body, and confirm `api_bootstrap` is NOT included here (webhooks are correctly exempt from CSRF/auth per `GAPS.md` line 52 — keep that exemption).

**(c) Payload parsing + idempotency.** Meta nests messages under `entry[].changes[].value.messages[]` and statuses under `value.statuses[]`.
```php
function parseMetaWebhook(array $payload): array; // → normalized [from,to,body,type,wa_message_id,media_id,...]

// Idempotency — THE fix for the current gap. Check before insert:
$exists = $db->prepare("SELECT 1 FROM whatsapp_messages WHERE wa_message_id = ?");
$exists->execute([$waMessageId]);
if ($exists->fetch()) { http_response_code(200); exit; }   // already processed, discard
```
On a valid inbound message: insert into `whatsapp_messages`, upsert `whatsapp_threads` (set `last_inbound_at = NOW()`, bump `unread_count`), resolve contact against `leads`/`clients`/`tenants` by phone, fire the existing notification, and run the STOP-keyword check (§5.5). On a `statuses[]` event: update `whatsapp_messages.status` by `wa_message_id`.

Always return **200** quickly so Meta doesn't retry-storm. If processing is heavy, insert a raw row and let cron process it (our lightweight stand-in for the "message queue" — we do **not** need Kafka for one agency).

### 5.3 Media handling (data minimization)
Inbound media arrives as a Meta `media_id`, not a URL. To store it: `GET /v19.0/{media_id}` → returns a short-lived URL → download with the Bearer token → push to object storage (the agency already has `getBackupCloudConfig()` S3 settings in `config/settings.php` — reuse that bucket) → save only the **object key/URL** in `whatsapp_messages.media_url`. Never store the binary in MySQL.

### 5.4 Config / env
Replace in `.env.example` (and remove `TWILIO_*`):
```
# WhatsApp Cloud API (Meta)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_API_VERSION=v19.0
```
Replace `getWhatsAppConfig()` in `config/settings.php` to read these (keep the "configurable in Impostazioni" pattern via `getSetting()` with env fallback, exactly as the Twilio version did). Add a Settings UI section so the agency can paste the token without redeploying.

### 5.5 Compliance handlers
- **STOP keyword** — on inbound, if `body` (trimmed, lowercased) ∈ {`stop`, `cancella`, `annulla`, `unsubscribe`}, set `whatsapp_threads.is_blocked = 1`, write a `whatsapp_consent` `opt_out` row (`method=stop_keyword`), and send one template confirming removal. All future sends to that phone are blocked at the send API.
- **Opt-in capture** — wherever a lead can opt in (web form, "WhatsApp Us" button on the public site / `apply.php`), write a `whatsapp_consent` `opt_in` row capturing `source_url`, `consent_text`, `ip_address`, `timestamp`.
- **Double opt-in (optional, recommended)** — first inbound from an unknown number triggers an auto-reply template acknowledging the opt-in and stating how to STOP.

---

## 6. Build sequence (each phase independently verifiable)

Per `CLAUDE.md §7`: one change at a time, re-run the same command to confirm, paste the output. Do **not** start a phase before its predecessor passes. Suggested phase = one PR.

| Phase | Deliverable | Acceptance criteria (must paste evidence) |
|---|---|---|
| **0. Onboarding** | Meta verification + test number live (§2, §3) | Test number sends a message to your phone from the Graph API Explorer. Paste the `wamid`. |
| **1. Verification handshake** | GET `hub.challenge` in webhook | Register webhook in Meta console → it goes green. `curl "…/whatsapp_webhook.php?hub_mode=subscribe&hub_verify_token=GOOD&hub_challenge=42"` returns `42`; wrong token returns `403`. Paste both. |
| **2. Signature validation** | `X-Hub-Signature-256` HMAC check | Send a correctly-signed POST → processed. Send an **unsigned** POST → `403`. (This is the `GAPS.md` "webhook validation" claim, now done for real.) Paste both responses. |
| **3. Inbound + idempotency** | Parse `messages[]`, store, upsert thread | Text the test number → row appears in `whatsapp_messages`, thread upserted, notification created. **Replay the same webhook payload twice** → still one row. Paste `SELECT COUNT(*)` before/after. |
| **4. Outbound** | `sendWhatsAppText` / `sendWhatsAppTemplate` | Send a text inside the window → arrives on your phone, `wa_message_id` stored, `status` updates to `delivered`/`read` via status webhook. Paste the delivered status row. |
| **5. 24-hour window guard** | Enforce window on free-form send | With `last_inbound_at` > 24h ago, call send-text API → **422 "finestra chiusa, usa un template"**. With a fresh inbound → text succeeds. Paste both. |
| **6. Templates** | Meta-approved template sync + send | Submit one `UTILITY` template (e.g. `scadenza_contratto`) in Meta console, sync it, send it with a `{{1}}` variable → arrives rendered. Paste the received message. |
| **7. Compliance** | Opt-in capture + STOP + audit | Opt in via form → `whatsapp_consent` row with `source_url`/`consent_text`. Text `STOP` → thread `is_blocked=1`, opt_out row written, further sends `403`. Paste the rows. |
| **8. Media + minimization** | Inbound media → S3, URL only | Send an image to the number → file lands in the bucket, `media_url` holds the key, no binary in MySQL. Paste the bucket listing + the DB cell. |
| **9. Cleanup** | Remove all Twilio code/env/tests; update `GAPS.md` | `grep -ri twilio .` returns nothing in `api/ config/ .env*`. Paste the empty grep. |

---

## 7. Testing

- **Unit** (`tests/Unit/WhatsAppCloudTest.php`, replacing `WhatsAppTest.php`): `parseMetaWebhook()` field extraction for text/media/status payloads and malformed input; `normalizeWhatsAppNumber()` for IT formats; signature validation pass/fail; window-guard logic (open vs expired).
- **Webhook simulation** (Postman/`curl`): keep real fixtures of Meta's JSON for inbound text, inbound image, and a `statuses` callback. Sign them with the test App Secret. Don't debug parsing on live traffic.
- **Idempotency**: the replay test in Phase 3 is the regression guard — keep it.
- **Unhappy paths** (per `CLAUDE.md §2`): unsigned webhook → 403; send outside window → 422; send to a blocked (STOP'd) number → 403; expired token → surfaced error, not a silent failure; oversized media → rejected cleanly.

---

## 8. How to manage this as the programmer (process, not code)

- **Unblock the slow dependency first.** Meta Business verification is the critical path and it's the client's paperwork. Send them the §2 checklist before you write a line. Track it weekly; everything else can proceed against the test number in parallel.
- **Two environments, never demo on the test number.** Mirror the cold-start discipline already in `CLAUDE.md §5`.
- **One phase = one PR = one piece of pasted evidence.** The phase table is your definition of done. Resist bundling phases; the whole point is that each boundary is provable.
- **Set client expectations in writing.** Until verification clears *and* opt-in/consent is built, WhatsApp is *"in attivazione,"* not "working" — consistent with the honest-posture note in `CLAUDE.md §9`. Put the GDPR items (consent text, privacy informativa, DPA with Meta) in scope explicitly; they protect both you and the agency.
- **Protect the number like production infra.** The window guard and STOP handling aren't features to add later — sending outside the window or ignoring opt-outs gets the agency's business number flagged or banned. Ship Phases 5 and 7 before go-live, not after.
- **Don't add a real message queue.** The roadmap you were handed mentions RabbitMQ/Kafka — that's enterprise-scale advice. For one agency, "return 200 fast + a cron worker for heavy bits" is the correct, maintainable equivalent. Keep the system small.

---

## 9. Open decisions to confirm with the client before Phase 1

1. **Phone number source** — new SIM vs existing landline (must be WhatsApp-free). This gates §2.
2. **Template set** — which message types they actually need (scadenza contratto, conferma visita, benvenuto lead, promemoria pagamento). Each needs Meta approval, which takes time.
3. **Double opt-in** — on or off. Recommended on for EU; slightly more friction.
4. **Media storage bucket** — reuse the existing backup S3 bucket or a separate one for WA media.

---

*This plan is static analysis + design, not a verified build. Every "✅" only counts once its phase evidence in §6 is pasted — that is the rule the rest of this repo runs on.*

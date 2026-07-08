# 06 — API Reference

> Consolidated from docs/API.md. 59 endpoint files under `/api/`.
> Every mutating request requires: a valid PHP session (admin login) **except** public/webhook
> endpoints; a CSRF token in `X-CSRF-Token` (enforced by `api_bootstrap.php` for all
> POST/PUT/PATCH/DELETE); correct `Content-Type` (`application/json` or `multipart/form-data`).
> Responses: `{ success: true, data: … }` or `{ success: false, error: "…" }`.

## Conventions

| Placeholder | Meaning |
|---|---|
| `{id}` | Integer row ID as `?id=N` |
| `?action=X` | Sub-action query param |
| 🔓 public | No auth required |
| 🔑 cron | Authenticated by `CRON_SECRET` (header `X-Cron-Secret` or `?secret=`) instead of session |

Auth is cookie-session based; there is no API token auth for admin endpoints. Tenant and
owner portals use separate session namespaces.

---

## People

### Clients (`clients.php`)
- `GET` — list (`search`, `status`, `page`, `limit`); `?id={id}` single
- `POST` — create; `?action=import` bulk CSV (multipart `file`)
- `PUT ?id={id}` — update; `DELETE ?id={id}` — soft-delete (`status=archived`)

### Leads (`leads.php`)
- `GET` — list (`search`, `status`, `interest_type`, `assigned_to`, `page`, `limit`)
- `GET ?action=match&lead_id={id}` — matching property IDs (budget/type/city)
- `GET ?action=agents` — agents (admin users with `agent` role)
- `POST` — create; `POST ?action=convert&id={id}` — convert to **Client**
- `POST ?action=convert_tenant&id={id}` — convert to **Tenant** (creates tenant + initial contract)
- `POST ?action=bulk` — bulk `archive`/`assign`
- `PUT ?id={id}` update; `DELETE ?id={id}` delete

### Tenants (`tenants.php`)
- `GET` list (`search`, `status`, `property_id`); `?id={id}` single
- `POST` create; `PUT ?id={id}` update; `DELETE ?id={id}` soft-delete

### Agent Portfolio (`agent_portfolio.php`)
- `GET` — all agents summary (leads_count, appointments_count, commissions_pending, …)
- `GET ?agent_id={id}` — single-agent stats

---

## Properties

### Properties (`properties.php`)
- `GET` list (`search`, `status`, `type`, `city`, `client_id`, `page`, `limit`); `?id={id}` single (with media + owner)
- `POST` create; `?action=import` bulk CSV; `?action=bulk` (`archive`/`assign`)
- `PUT ?id={id}` update (body `action`: `archive`/`assign`); `DELETE ?id={id}` delete

### Buildings (`buildings.php`)
- `GET` list (units + occupancy); `?id={id}` single + linked properties
- `POST` create; `POST ?id={id}&action=link_property` (body `property_id`)
- `PUT ?id={id}` update; `DELETE ?id={id}` delete (fails if linked)
- `DELETE ?id={id}&action=unlink_property&property_id={Y}`

### Property Media (`property_media.php`)
- `GET ?property_id={id}` list (`ORDER BY sort_order ASC`); `?picker=1` photos only
- `POST` upload (multipart: `property_id`, `media_type`, `file`)
- `PATCH ?action=set_cover` (body `property_id`, `media_id`); `DELETE ?id={id}` delete + file

### Property Keys (`property_keys.php`)
- `GET` list (`property_id`, `status`); `?id={id}` single
- `POST` create; `PUT ?id={id}` update; `DELETE ?id={id}` delete

### Property Appraisals (`property_appraisals.php`)
- `GET ?property_id={id}` list; `?id={id}` single; `POST`/`PUT ?id={id}`/`DELETE ?id={id}`

### Property Applications (`property_applications.php`)
- `GET` list (`property_id`, `status`); `?id={id}` single
- `PUT ?id={id}` update status; `POST ?action=convert_lead&id={id}` → creates a Lead; `DELETE ?id={id}`

### Inventory (`inventory.php`)
- `GET ?property_id={id}` paginated; `&checkin_report=1` all items for PDF; `?id={id}` single
- `POST`/`PUT ?id={id}`/`DELETE ?id={id}`

### Meter Readings (`meter_readings.php`)
- `GET ?property_id={id}` readings; `&summary=1` latest per type + estimated consumption
- `POST`/`PUT ?id={id}`/`DELETE ?id={id}`

### Insurance (`insurance.php`)
- `GET` list (`property_id`, `client_id`, `expiring_soon`=1 within 30 days); `?id={id}` single
- `POST`/`PUT ?id={id}`/`DELETE ?id={id}`

### Property Export (`property_export.php`)
- `GET ?id={id}&format=json` — Immobiliare.it-compatible JSON
- `GET ?format=xml` — all active properties as XML feed; `?format=csv` — CSV download

### Property Comparison (`property_comparison.php`)
- `GET ?ids=1,2,3` — side-by-side of up to 4 properties

### Geocoding (`geocode.php`, `geocode_resolve.php`)
- `GET /geocode.php` — Nominatim `/search` proxy (cached)
- `GET /geocode_resolve.php?address=&city=&cap=&province=&property_id=` — resolve + store lat/lng

---

## Documents & Signing

### Documents (`documents.php`)
- `GET` list (`search`, `doc_type`, `client_id`, `property_id`); `?id={id}` single
- `POST` upload (multipart: `doc_type`, `client_id?`, `property_id?`, `contract_id?`, `file`); `DELETE ?id={id}`

### Download (`download_document.php`, `download_pdf.php`)
- `GET /download_document.php?id={id}` — stream a document (auth required)
- `GET /download_pdf.php?id={id}` — stream a generated PDF (auth required)

### E-Signature (`esign.php`)
- `GET` — admin list (`status`, `contract_id`)
- `GET ?token={token}` 🔓 — signer fetches request details
- `POST` — admin create (`document_id`, `contract_id?`, `signer_name`, `signer_email`, `expires_in_days?`) — auto-emails signing link
- `POST ?token={token}&action=sign` 🔓 — signer submits signature (rate-limit 10/min per IP; records IP + timestamp)
- `DELETE ?id={id}` — cancel/delete

---

## Contracts & Finance

### Contracts (`contracts.php`)
- `GET` list (`search`, `status`, `property_id`, `tenant_id`, `client_id`); `?id={id}` single + payments
- `POST` create
- `POST ?action=generate_payments&id={id}` — generate monthly schedule (needs `tenant_id`, `monthly_rent`, `start_date`, `end_date`; skips months already having a payment for this contract)
- `PUT ?id={id}` update; `DELETE ?id={id}` delete

### Payments (`payments.php`)
- `GET` list (`tenant_id`, `property_id`, `contract_id`, `status`, `year`, `month`); `?id={id}` single
- `POST` create; `PUT ?id={id}` update (mark paid, set `paid_date`); `DELETE ?id={id}`

### Invoices (`invoices.php`)
- `GET` list (`status`, `client_id`, `year`); `?id={id}` single
- `POST` create (auto `invoice_number`); `PUT ?id={id}`; `DELETE ?id={id}` (drafts only)

### Expenses (`expenses.php`)
- `GET` list (`property_id`, `client_id`, `category`, `year`); `?id={id}` single
- `POST`/`PUT ?id={id}`/`DELETE ?id={id}`

### Commissions (`commissions.php`)
- `GET` list (`admin_user_id`, `status`); `?id={id}` single; `?summary=1` totals per agent
- `POST` create; `PUT ?id={id}` update; `PATCH ?id={id}` status toggle (pending→paid); `DELETE ?id={id}`

### Stripe Checkout (`stripe_checkout.php`)
- `POST` — create Checkout Session for a tenant payment (body `payment_id`; rate-limit 5/min/user); returns `{ session_url }`

### Stripe Webhook (`stripe_webhook.php`) 🔓
- `POST` — validates `Stripe-Signature` via `\Stripe\Webhook::constructEvent()`; on `checkout.session.completed` marks payment paid + creates `stripe_payments` row

### Reports & Forecast (`reports.php`, `forecast.php`)
- `GET /reports.php?type=properties|payments|expenses&year={YYYY}` (+`&format=csv`)
- `GET /forecast.php?months=6|12|24` → `{ expected_total, collected_total, by_month, occupancy_rate, insoluti }`

---

## PDF Generation
- `POST /generate_pdf.php` — generic PDF (`type`, `entity_id`, …)
- `POST /generate_owner_report.php` — monthly owner rendiconto (`client_id`, `month?`, `year`)
- `POST /generate_invoice_pdf.php` — invoice PDF (`invoice_id`)

---

## Communications

### Communications (`communications.php`)
- `GET ?summary=1` — client list with last-message preview + unread count
- `GET ?client_id={id}` — full thread (newest first); `?id={id}` single
- `POST` — send/log (`client_id`, `channel: email|whatsapp`, `subject?`, `body`, `direction: sent|received`)

### WhatsApp Inbox (`whatsapp_inbox.php`)
- `GET` — paginated inbox grouped by number (`direction`, `from_number`, `unread`, `page`, `limit`)
- `GET ?thread={+39...}` — full conversation (`page`, `limit` for older messages)
- `PUT ?id={id}` — mark read (body `is_read: true`); `POST` — internal outbound log (called by `whatsapp_send.php`)

### WhatsApp Send (`whatsapp_send.php`)
- `POST` — send via Twilio (`phone`, `message`, `tenant_id?`, `reminder_id?`); rate-limit 20/min/user

### WhatsApp Webhook (`whatsapp_webhook.php`) 🔓
- `POST` — Twilio inbound receiver; validates `X-Twilio-Signature` HMAC-SHA1; saves to `whatsapp_messages`, optionally logs to `communications`, creates a notification

### WhatsApp Templates (`whatsapp_templates.php`) / Email Templates (`email_templates.php`)
- `GET` list; `?id={id}` single; `POST` create; `PUT ?id={id}`; `DELETE ?id={id}` (email = soft-delete `is_active=0`, `?all=1` includes inactive)

### Inbound Email Webhook (`email_inbound.php`) 🔓
- `POST` — Mailgun inbound receiver; validates Mailgun HMAC-SHA256; matches sender to client by email; saves to `communications`

---

## Operations

### Reminders / Maintenance (`reminders.php`)
Same endpoint serves both (filtered by `type`).
- `GET` list (`search`, `status`, `frequency`, `due_soon`=1 within 7 days, `type`, `client_id`, `property_id`); `?id={id}` single
- `POST` create; `PUT ?id={id}` full update (`action=assign_supplier`, `action=maintenance_status`)
- `PATCH ?id={id}&action=complete` | `&action=cancel`; `DELETE ?id={id}`

### Appointments (`appointments.php`)
- `GET` list (`property_id`, `agent_id`, `status`, `from`, `to`); `?id={id}`; `POST`/`PUT ?id={id}`/`DELETE ?id={id}`

### Suppliers (`suppliers.php`)
- `GET` list (`category`, `search`); `?id={id}`; `POST`/`PUT ?id={id}`/`DELETE ?id={id}` (soft-delete `is_active=0`)

### Surveys (`surveys.php`)
- `GET` admin list (`property_id`); `GET ?token={token}` 🔓 form data
- `POST` create link (unique token, auto-send via WhatsApp/email); `POST ?submit=1` 🔓 submit response; `DELETE ?id={id}`

### Payment Reminder Log (`payment_reminder_log.php`)
- `GET` paginated log (`payment_id`, `tenant_id`, `channel`)
- `POST ?action=send_reminders` — manually trigger the reminder run (same as daily cron)

---

## Social Media

### Social Posts (`social_posts.php`)
- `GET` list (`status`, `platform`, `property_id`); `?id={id}` single
- `POST` create (multipart: `property_id?`, `platform`, `caption`, `scheduled_at?`, `status`, `image?`)
- `PUT ?id={id}` update; `PATCH ?id={id}&action=publish` — publish now via Graph API; `DELETE ?id={id}`

### Social Settings (`social_settings.php`)
- `GET` — settings (tokens masked ••••••••); `PUT` — update Meta credentials

---

## System

### Settings (`settings.php`)
- `GET` — all settings `{ key: value }`; `?action=2fa_setup` — TOTP QR + secret
- `POST` — bulk-save; `?test_email=1` — send test email; `?action=2fa_enable` (body `code`); `?action=2fa_disable` (body `code`)

### Admin Users (`admin_users.php`) — super_admin only
- `GET` list; `POST` create (`username`, `password`, `role`, `email`, `name`); `PUT ?id={id}`; `DELETE ?id={id}` (deactivate)

### Dashboard (`get_dashboard_stats.php`, `dashboard_prefs.php`)
- `GET /get_dashboard_stats.php` — KPI counts (properties_total/available/rented, payments_overdue, reminders_due, revenue_this_month, …)
- `GET/PUT /dashboard_prefs.php` — quick-access shortcut links

### Notifications (`notifications.php`)
- `GET` — `{ count, items[] }` overdue payments + upcoming reminders (top-bar bell)

### Activity Log (`activity_log.php`)
- `GET` — read-only audit log, 50/page (`user_id`, `action`, `entity_type`, `page`)

### Upload / Backup (`upload_logo.php`, `backup_trigger.php`)
- `POST /upload_logo.php` — agency logo (multipart `logo`) → `uploads/logo/`, updates `agency_logo`
- `POST /backup_trigger.php` — manual DB backup → timestamped dump in `backups/` (+ S3 if configured)

---

## Cron-triggered endpoints 🔑

Called by the VPS crontab via `docker exec`. Each needs `?secret=CRON_SECRET` or matching env.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `POST /process_reminders.php` | Hourly | Send due reminder notifications; check contract expiries |
| `POST /process_contract_expirations.php` | Hourly (from reminders) | Create expiry reminder rows for contracts ending within 30 days |
| `POST /send_payment_reminders.php` | Daily 8am | WhatsApp/email reminders for overdue payments |
| `POST /publish_social_posts.php` | Every 15 min | Publish scheduled social posts |
| `POST /backup_database.php` | Daily 2am | MySQL dump to `backups/` + optional S3 |

---

## Owner Portal (`/owner/` + `owner_portal.php`)

Property owners log in and view their own properties, contracts, payments, documents,
communications. Separate auth namespace (`$_SESSION['owner_*']`). Credentials on `clients`
(`portal_email`, `portal_password_hash`). **Not** the tenant portal.

| Path | Auth | Purpose |
|---|---|---|
| `GET/POST /owner/login.php` | 🔓 | Login page + submit |
| `GET /owner/index.php` | owner session | Dashboard: Immobili, Contratti, Pagamenti, Documenti, Comunicazioni tabs |
| `GET /owner/report.php?month=M&year=Y` | owner session | Monthly rendiconto PDF |
| `GET /owner/logout.php` | owner session | Clear session |
| `POST /api/owner_portal.php` | admin | Set portal credentials (`action=set_password`, `client_id`, `email`, `password`) |

---

## Rate limits

| Endpoint | Limit | Window | Notes |
|---|---|---|---|
| `POST /whatsapp_send.php` | 20 | 60s | Per user — Twilio cost protection |
| `POST /stripe_checkout.php` | 5 | 60s | Per user — billing abuse |
| `POST /esign.php?action=sign` | 10 | 60s | Per IP — token brute-force |
| `POST /login.php` | 5 | 15 min | Per IP — brute-force lockout (`config/login_throttle.php`) |

HTTP 429 on exceed. The `api_rate_limits` table is created automatically on first use
(`config/rate_limit.php`).

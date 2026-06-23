# API Reference — Gestione Immobiliare

All admin API files live under `/api/`. Every request that mutates data requires:
- A valid PHP session (admin login), **except** the public endpoints listed below
- A CSRF token in the `X-CSRF-Token` header (enforced by `config/api_bootstrap.php` for all POST/PUT/PATCH/DELETE)
- Correct `Content-Type`: `application/json` for JSON bodies, `multipart/form-data` for file uploads

Responses follow the shape `{ success: true, data: … }` on success and `{ success: false, error: "…" }` on failure.

---

## Auth & Session

Authentication is cookie-session based. There is no API token auth for admin endpoints.  
Tenant portal endpoints use a separate session namespace — see the Tenant Portal section.

---

## Conventions

| Placeholder | Meaning |
|---|---|
| `{id}` | Integer row ID, passed as `?id=N` query parameter |
| `?action=X` | Sub-action passed as query parameter |
| `🔓 public` | No auth required — accessible without a session |
| `🔑 cron` | Authenticated by `?secret=CRON_SECRET` header instead of session |

---

## People

### Clients (Proprietari)

**`GET /api/clients.php`** — paginated list  
Query params: `search`, `status` (active/archived), `page`, `limit`

**`GET /api/clients.php?id={id}`** — single client

**`POST /api/clients.php`** — create client  
Body: `{ name, surname, email, phone, codice_fiscale, ... }`

**`POST /api/clients.php?action=import`** — bulk import from CSV  
Body: multipart with `file` field

**`PUT /api/clients.php?id={id}`** — update client

**`DELETE /api/clients.php?id={id}`** — soft-delete (sets `status = archived`)

---

### Leads

**`GET /api/leads.php`** — paginated list  
Query params: `search`, `status`, `interest_type`, `assigned_to`, `page`, `limit`

**`GET /api/leads.php?action=match&lead_id={id}`** — returns matching property IDs based on lead budget/type/city

**`GET /api/leads.php?action=agents`** — returns list of agents (admin users with `agent` role)

**`POST /api/leads.php`** — create lead

**`POST /api/leads.php?action=convert&id={id}`** — convert lead to **Client (proprietario)**  
Body: `{ name, surname, email, ... }`

**`POST /api/leads.php?action=convert_tenant&id={id}`** — convert lead to **Tenant (inquilino)**  
Body: `{ name, surname, email, phone, property_id, monthly_rent, contract_start, contract_end }`  
Creates both a tenant record and an initial contract.

**`POST /api/leads.php?action=bulk`** — bulk status update  
Body: `{ action: 'archive'|'assign', ids: [...], assigned_to? }`

**`PUT /api/leads.php?id={id}`** — update lead

**`DELETE /api/leads.php?id={id}`** — delete lead

---

### Tenants (Inquilini)

**`GET /api/tenants.php`** — paginated list  
Query params: `search`, `status`, `property_id`

**`GET /api/tenants.php?id={id}`** — single tenant

**`POST /api/tenants.php`** — create tenant

**`PUT /api/tenants.php?id={id}`** — update tenant

**`DELETE /api/tenants.php?id={id}`** — soft-delete

---

### Agent Portfolio

**`GET /api/agent_portfolio.php`** — all agents summary  
Returns: `{ agents: [{ id, name, leads_count, appointments_count, commissions_pending, ... }] }`

**`GET /api/agent_portfolio.php?agent_id={id}`** — single agent stats

---

## Properties

### Properties (Immobili)

**`GET /api/properties.php`** — paginated list  
Query params: `search`, `status`, `type`, `city`, `client_id`, `page`, `limit`

**`GET /api/properties.php?id={id}`** — single property with media and owner

**`POST /api/properties.php`** — create property

**`POST /api/properties.php?action=import`** — bulk import from CSV

**`POST /api/properties.php?action=bulk`** — bulk operation  
Body: `{ action: 'archive'|'assign', ids: [...], client_id? }`

**`PUT /api/properties.php?id={id}`** — update property  
Sub-actions via body `action` field: `archive`, `assign`

**`DELETE /api/properties.php?id={id}`** — delete property

---

### Buildings (Edifici)

**`GET /api/buildings.php`** — list with unit count and occupancy

**`GET /api/buildings.php?id={id}`** — single building + linked properties

**`POST /api/buildings.php`** — create building

**`POST /api/buildings.php?id={id}&action=link_property`** — link a property to a building  
Body: `{ property_id }`

**`PUT /api/buildings.php?id={id}`** — update building

**`DELETE /api/buildings.php?id={id}`** — delete (fails if properties are linked)

**`DELETE /api/buildings.php?id={id}&action=unlink_property&property_id={Y}`** — unlink a property

---

### Property Media

**`GET /api/property_media.php?property_id={id}`** — list media sorted by `sort_order ASC`  
Optional: `?picker=1` returns only photos suitable for social post picker

**`POST /api/property_media.php`** — upload file (multipart)  
Fields: `property_id`, `media_type` (photo/video/floor_plan/house_map/attachment), `file`

**`PATCH /api/property_media.php?action=set_cover`** — set cover image  
Body: `{ property_id, media_id }`

**`DELETE /api/property_media.php?id={id}`** — delete media item + file

---

### Property Keys (Chiavi)

**`GET /api/property_keys.php`** — list  
Query params: `property_id`, `status` (out/in_office/lost)

**`GET /api/property_keys.php?id={id}`** — single key record

**`POST /api/property_keys.php`** — create key record  
Body: `{ property_id, holder_id?, holder_name?, handed_at, status }`

**`PUT /api/property_keys.php?id={id}`** — update (e.g. return key, mark lost)

**`DELETE /api/property_keys.php?id={id}`** — delete key record

---

### Property Appraisals

**`GET /api/property_appraisals.php?property_id={id}`** — list for a property

**`GET /api/property_appraisals.php?id={id}`** — single appraisal

**`POST /api/property_appraisals.php`** — create

**`PUT /api/property_appraisals.php?id={id}`** — update

**`DELETE /api/property_appraisals.php?id={id}`** — delete

---

### Property Applications (Richieste)

**`GET /api/property_applications.php`** — paginated list  
Query params: `property_id`, `status`

**`GET /api/property_applications.php?id={id}`** — single

**`PUT /api/property_applications.php?id={id}`** — update status

**`POST /api/property_applications.php?action=convert_lead&id={id}`** — convert to a Lead  
Creates a Lead row from the applicant's name/email/phone and links it to the property.

**`DELETE /api/property_applications.php?id={id}`** — delete

---

### Property Inventory

**`GET /api/inventory.php?property_id={id}`** — paginated item list

**`GET /api/inventory.php?property_id={id}&checkin_report=1`** — all items (no pagination) for PDF check-in report

**`GET /api/inventory.php?id={id}`** — single item

**`POST /api/inventory.php`** — create

**`PUT /api/inventory.php?id={id}`** — update

**`DELETE /api/inventory.php?id={id}`** — delete

---

### Meter Readings (Contatori)

**`GET /api/meter_readings.php?property_id={id}`** — paginated readings

**`GET /api/meter_readings.php?property_id={id}&summary=1`** — latest reading per type + estimated consumption

**`POST /api/meter_readings.php`** — create

**`PUT /api/meter_readings.php?id={id}`** — update

**`DELETE /api/meter_readings.php?id={id}`** — delete

---

### Property Insurance (Assicurazioni)

**`GET /api/insurance.php`** — list  
Query params: `property_id`, `client_id`, `expiring_soon` (1 = within 30 days)

**`GET /api/insurance.php?id={id}`** — single policy

**`POST /api/insurance.php`** — create

**`PUT /api/insurance.php?id={id}`** — update

**`DELETE /api/insurance.php?id={id}`** — delete

---

### Property Export

**`GET /api/property_export.php?id={id}&format=json`** — single property as Immobiliare.it-compatible JSON

**`GET /api/property_export.php?format=xml`** — all active properties as XML feed

**`GET /api/property_export.php?format=csv`** — all properties as CSV download

---

### Property Comparison

**`GET /api/property_comparison.php?ids=1,2,3`** — side-by-side comparison of up to 4 properties  
Returns: normalised field set with values per property for each field.

---

### Geocoding

**`GET /api/geocode.php`** — proxy to Nominatim `/search`  
Passes query params through; caches results locally.

**`GET /api/geocode_resolve.php?address=...&city=...&cap=...&province=MO`** — resolve a full Italian address to lat/lng and store on the property record  
Query params: `address`, `city`, `cap`, `province`, `property_id`

---

## Documents & Signing

### Documents

**`GET /api/documents.php`** — list  
Query params: `search`, `doc_type`, `client_id`, `property_id`

**`GET /api/documents.php?id={id}`** — single document metadata

**`POST /api/documents.php`** — upload document (multipart)  
Fields: `doc_type`, `client_id?`, `property_id?`, `contract_id?`, `file`

**`DELETE /api/documents.php?id={id}`** — delete metadata + file

---

### Download

**`GET /api/download_document.php?id={id}`** — stream a document file (auth required)

**`GET /api/download_pdf.php?id={id}`** — stream a generated PDF document (auth required)

---

### E-Signature

**`GET /api/esign.php`** — admin: paginated list of signing requests  
Query params: `status`, `contract_id`

**`GET /api/esign.php?token={token}`** 🔓 **public** — signer: fetch request details by token  
Returns: `{ signer_name, document_url, expires_at, status }`

**`POST /api/esign.php`** — admin: create signing request  
Body: `{ document_id, contract_id?, signer_name, signer_email, expires_in_days? }`  
Sends signing-link email to `signer_email` automatically.

**`POST /api/esign.php?token={token}&action=sign`** 🔓 **public** — signer: submit signature  
Rate-limited: 10 requests/minute per IP. Records IP and timestamp.

**`DELETE /api/esign.php?id={id}`** — admin: cancel/delete request

---

## Contracts & Finance

### Contracts

**`GET /api/contracts.php`** — paginated list  
Query params: `search`, `status`, `property_id`, `tenant_id`, `client_id`

**`GET /api/contracts.php?id={id}`** — single contract with related payments

**`POST /api/contracts.php`** — create

**`POST /api/contracts.php?action=generate_payments&id={id}`** — generate monthly payment schedule  
Requires: contract has `tenant_id`, `monthly_rent`, `start_date`, `end_date`.  
Inserts one `payments` row per month; skips months that already have a payment for this contract.

**`PUT /api/contracts.php?id={id}`** — update

**`DELETE /api/contracts.php?id={id}`** — delete

---

### Payments

**`GET /api/payments.php`** — list  
Query params: `tenant_id`, `property_id`, `contract_id`, `status`, `year`, `month`

**`GET /api/payments.php?id={id}`** — single payment

**`POST /api/payments.php`** — create

**`PUT /api/payments.php?id={id}`** — update (e.g. mark as paid, set `paid_date`)

**`DELETE /api/payments.php?id={id}`** — delete

---

### Invoices (Fatture)

**`GET /api/invoices.php`** — list  
Query params: `status`, `client_id`, `year`

**`GET /api/invoices.php?id={id}`** — single

**`POST /api/invoices.php`** — create; auto-generates `invoice_number`

**`PUT /api/invoices.php?id={id}`** — update

**`DELETE /api/invoices.php?id={id}`** — delete (drafts only)

---

### Expenses

**`GET /api/expenses.php`** — list  
Query params: `property_id`, `client_id`, `category`, `year`

**`GET /api/expenses.php?id={id}`** — single

**`POST /api/expenses.php`** — create

**`PUT /api/expenses.php?id={id}`** — update

**`DELETE /api/expenses.php?id={id}`** — delete

---

### Commissions (Provvigioni)

**`GET /api/commissions.php`** — paginated list  
Query params: `admin_user_id`, `status`

**`GET /api/commissions.php?id={id}`** — single

**`GET /api/commissions.php?summary=1`** — total pending + paid per agent

**`POST /api/commissions.php`** — create

**`PUT /api/commissions.php?id={id}`** — update

**`PATCH /api/commissions.php?id={id}`** — quick status toggle (pending → paid)

**`DELETE /api/commissions.php?id={id}`** — delete

---

### Stripe Checkout

**`POST /api/stripe_checkout.php`** — create a Stripe Checkout Session for a tenant payment  
Body: `{ payment_id }`  
Rate-limited: 5 requests/minute per user.  
Returns: `{ session_url }` — redirect the tenant to this URL.

---

### Stripe Webhook 🔓

**`POST /api/stripe_webhook.php`** — Stripe event receiver  
Validates `Stripe-Signature` header via `\Stripe\Webhook::constructEvent()`.  
Handles `checkout.session.completed` → marks the linked payment as paid, creates a `stripe_payments` record.

---

### Reports & Forecast

**`GET /api/reports.php?type=properties&year={YYYY}`** — property portfolio summary

**`GET /api/reports.php?type=payments&year={YYYY}`** — collected vs expected revenue by month

**`GET /api/reports.php?type=expenses&year={YYYY}`** — expenses by category

**`GET /api/reports.php?type=...&year={YYYY}&format=csv`** — CSV download of any of the above

**`GET /api/forecast.php?months=6`** — revenue forecast for the next N months (6, 12, or 24)  
Returns: `{ expected_total, collected_total, by_month: [...], occupancy_rate, insoluti: [...] }`

---

## PDF Generation

**`POST /api/generate_pdf.php`** — generate a generic PDF document  
Body: `{ type, entity_id, ... }`

**`POST /api/generate_owner_report.php`** — generate monthly owner rendiconto PDF  
Body: `{ client_id, month?, year }`  
Returns: path to generated PDF stored in `uploads/`.

**`POST /api/generate_invoice_pdf.php`** — generate invoice PDF  
Body: `{ invoice_id }`

---

## Communications

### Communications (Email + WhatsApp log)

**`GET /api/communications.php?summary=1`** — client list with last message preview and unread count

**`GET /api/communications.php?client_id={id}`** — full thread for a client, newest first

**`GET /api/communications.php?id={id}`** — single message

**`POST /api/communications.php`** — send or log a message  
Body: `{ client_id, channel: 'email'|'whatsapp', subject?, body, direction: 'sent'|'received' }`

---

### WhatsApp Inbox

**`GET /api/whatsapp_inbox.php`** — paginated inbox grouped by number  
Query params: `direction`, `from_number`, `unread` (1 = unread only), `page`, `limit`

**`GET /api/whatsapp_inbox.php?thread={+39XXXXXXXX}`** — full conversation thread with one number  
Query params: `page`, `limit` (for older-message pagination)

**`PUT /api/whatsapp_inbox.php?id={id}`** — mark message as read  
Body: `{ is_read: true }`

**`POST /api/whatsapp_inbox.php`** — internal: log an outbound message record (called by `whatsapp_send.php`, not used directly from the UI)

---

### WhatsApp Send

**`POST /api/whatsapp_send.php`** — send a WhatsApp message via Twilio  
Body: `{ phone, message, tenant_id?, reminder_id? }`  
Rate-limited: 20 messages/minute per user (Twilio cost protection).

---

### WhatsApp Webhook 🔓

**`POST /api/whatsapp_webhook.php`** — Twilio inbound message receiver  
Validates `X-Twilio-Signature` HMAC-SHA1 header. Saves to `whatsapp_messages`, optionally logs to `communications`, creates a notification.

---

### WhatsApp Templates

**`GET /api/whatsapp_templates.php`** — list

**`GET /api/whatsapp_templates.php?id={id}`** — single

**`POST /api/whatsapp_templates.php`** — create  
Body: `{ name, category, body, variables: [...] }`

**`PUT /api/whatsapp_templates.php?id={id}`** — update

**`DELETE /api/whatsapp_templates.php?id={id}`** — delete

---

### Email Templates

**`GET /api/email_templates.php`** — list (active only unless `?all=1`)

**`GET /api/email_templates.php?id={id}`** — single

**`POST /api/email_templates.php`** — create

**`PUT /api/email_templates.php?id={id}`** — update

**`DELETE /api/email_templates.php?id={id}`** — soft-delete (`is_active = 0`)

---

### Inbound Email Webhook 🔓

**`POST /api/email_inbound.php`** — Mailgun inbound email receiver  
Validates Mailgun HMAC-SHA256 signature. Matches sender to a client by email address, saves to `communications` table.

---

## Operations

### Reminders / Maintenance

The same endpoint serves both general reminders and maintenance tickets (filtered by `type`).

**`GET /api/reminders.php`** — list  
Query params: `search`, `status`, `frequency`, `due_soon` (1 = due within 7 days), `type` (maintenance / reminder), `client_id`, `property_id`

**`GET /api/reminders.php?id={id}`** — single

**`POST /api/reminders.php`** — create

**`PUT /api/reminders.php?id={id}`** — full update  
Sub-actions: `action=assign_supplier` (set `supplier_id`), `action=maintenance_status` (update kanban column)

**`PATCH /api/reminders.php?id={id}&action=complete`** — mark completed

**`PATCH /api/reminders.php?id={id}&action=cancel`** — cancel

**`DELETE /api/reminders.php?id={id}`** — cancel reminder

---

### Appointments (Visite)

**`GET /api/appointments.php`** — list  
Query params: `property_id`, `agent_id`, `status`, `from` (date), `to` (date)

**`GET /api/appointments.php?id={id}`** — single

**`POST /api/appointments.php`** — create

**`PUT /api/appointments.php?id={id}`** — update

**`DELETE /api/appointments.php?id={id}`** — delete

---

### Suppliers (Fornitori)

**`GET /api/suppliers.php`** — paginated list  
Query params: `category`, `search`

**`GET /api/suppliers.php?id={id}`** — single

**`POST /api/suppliers.php`** — create

**`PUT /api/suppliers.php?id={id}`** — update

**`DELETE /api/suppliers.php?id={id}`** — soft-delete (`is_active = 0`)

---

### Surveys (Sondaggi)

**`GET /api/surveys.php`** — admin: paginated list  
Query params: `property_id`

**`GET /api/surveys.php?token={token}`** 🔓 **public** — fetch survey form data (no auth)

**`POST /api/surveys.php`** — admin: create survey link; generates unique token; can auto-send link via WhatsApp/email

**`POST /api/surveys.php?submit=1`** 🔓 **public** — submit survey response by token  
Body: `{ token, overall_rating, maintenance_rating, communication_rating, comments? }`

**`DELETE /api/surveys.php?id={id}`** — admin: delete survey

---

### Payment Reminder Log

**`GET /api/payment_reminder_log.php`** — paginated log of sent reminders  
Query params: `payment_id`, `tenant_id`, `channel`

**`POST /api/payment_reminder_log.php?action=send_reminders`** — manually trigger the reminder run  
(Same logic as the daily cron — useful for testing.)

---

## Social Media

### Social Posts

**`GET /api/social_posts.php`** — list  
Query params: `status`, `platform`, `property_id`

**`GET /api/social_posts.php?id={id}`** — single post

**`POST /api/social_posts.php`** — create post (multipart)  
Fields: `property_id?`, `platform`, `caption`, `scheduled_at?`, `status` (draft/scheduled), `image?` (file upload)

**`PUT /api/social_posts.php?id={id}`** — update (JSON or multipart)

**`PATCH /api/social_posts.php?id={id}&action=publish`** — publish immediately via Meta Graph API  
Returns: `{ facebook_post_id?, instagram_media_id? }`

**`DELETE /api/social_posts.php?id={id}`** — delete draft or scheduled post

---

### Social Settings (Meta OAuth)

**`GET /api/social_settings.php`** — get settings; all tokens are masked (••••••••)

**`PUT /api/social_settings.php`** — update Meta credentials  
Body: `{ meta_app_id, meta_user_token, facebook_page_id, ... }`

---

## System

### Settings

**`GET /api/settings.php`** — all app settings as `{ key: value, ... }`

**`GET /api/settings.php?action=2fa_setup`** — get TOTP QR code + secret for the current user

**`POST /api/settings.php`** — bulk-save settings  
Body: `{ key: value, ... }`

**`POST /api/settings.php?test_email=1`** — send a test email with current SMTP settings

**`POST /api/settings.php?action=2fa_enable`** — enable 2FA (requires TOTP code to confirm)  
Body: `{ code }`

**`POST /api/settings.php?action=2fa_disable`** — disable 2FA  
Body: `{ code }`

---

### Admin Users

**`GET /api/admin_users.php`** — list admin users (super_admin only)

**`POST /api/admin_users.php`** — create admin user  
Body: `{ username, password, role, email, name }`

**`PUT /api/admin_users.php?id={id}`** — update (role, email, password)

**`DELETE /api/admin_users.php?id={id}`** — deactivate user

---

### Dashboard

**`GET /api/get_dashboard_stats.php`** — all KPI counts for the dashboard home screen  
Returns: `{ properties_total, properties_available, properties_rented, payments_overdue, reminders_due, revenue_this_month, ... }`

**`GET /api/dashboard_prefs.php`** — read saved quick-access shortcut links  
Returns: `{ quick_links: [{ label, href }] }`

**`PUT /api/dashboard_prefs.php`** — save quick-access shortcuts  
Body: `{ quick_links: [{ label, href }] }`

---

### Notifications

**`GET /api/notifications.php`** — returns `{ count, items[] }` of overdue payments + upcoming reminders  
Used by the top-bar notification bell.

---

### Activity Log

**`GET /api/activity_log.php`** — read-only audit log, 50/page  
Query params: `user_id`, `action`, `entity_type`, `page`

---

### Upload

**`POST /api/upload_logo.php`** — upload agency logo (multipart, field: `logo`)  
Saves to `uploads/logo/`, updates `agency_logo` setting.

---

### Backup

**`POST /api/backup_trigger.php`** — run a manual database backup  
Generates a timestamped SQL dump in `backups/`. Optionally uploads to S3 if configured.

---

## Cron-triggered Endpoints

These are called by the VPS crontab via `docker exec`. Each requires either a `?secret=CRON_SECRET` query parameter or the `CRON_SECRET` env var to match.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `POST /api/process_reminders.php` | Every hour | Send due reminder notifications; check contract expiries |
| `POST /api/process_contract_expirations.php` | Every hour (called from process_reminders) | Create expiry reminder rows for contracts ending within 30 days |
| `POST /api/send_payment_reminders.php` | Daily 8am | Send WhatsApp/email reminders for overdue payments |
| `POST /api/publish_social_posts.php` | Every 15 min | Publish any `status = scheduled` social posts whose `scheduled_at` has passed |
| `POST /api/backup_database.php` | Daily 2am | MySQL dump to `backups/`; optional S3 upload |

---

## Owner Portal (Portale Proprietari)

The owner portal lets property owners (clients / proprietari) log in and view their own properties, contracts, payments, and documents. It lives under `/owner/` and uses a separate auth namespace (`$_SESSION['owner_*']`). Credentials are stored on the `clients` table (`portal_email`, `portal_password_hash`).

> Not to be confused with the **Tenant Portal** — tenants authenticate via the `tenant_users` table and a separate session. The `/owner/` routes are exclusively for property owners.

| Path | Auth | Purpose |
|---|---|---|
| `GET /owner/login.php` | 🔓 | Login page |
| `POST /owner/login.php` | 🔓 | Submit credentials |
| `GET /owner/index.php` | tenant session | Dashboard: properties, contracts, payments, documents, communications tabs |
| `GET /owner/report.php?month=M&year=Y` | tenant session | Download monthly rendiconto PDF |
| `GET /owner/logout.php` | tenant session | Clear session |

**`POST /api/owner_portal.php`** — admin: set portal credentials for a client  
Body: `{ action: 'set_password', client_id, email, password }`  
This creates or updates `portal_email` / `portal_password_hash` on the `clients` row.

---

## Rate Limits

| Endpoint | Limit | Window | Notes |
|---|---|---|---|
| `POST /api/whatsapp_send.php` | 20 requests | 60 seconds | Per user — Twilio cost protection |
| `POST /api/stripe_checkout.php` | 5 requests | 60 seconds | Per user — billing abuse prevention |
| `POST /api/esign.php?token=X&action=sign` | 10 requests | 60 seconds | Per IP — token brute-force protection |
| `POST /login.php` | 5 attempts | 15 minutes | Per IP — brute-force lockout via `config/login_throttle.php` |

HTTP 429 is returned when a limit is exceeded. The rate-limit table (`api_rate_limits`) is created automatically on first use.

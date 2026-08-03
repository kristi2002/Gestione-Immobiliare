# 04 — Database Schema

> Consolidated from docs/DATABASE.md.
> **Engine:** MySQL 8.0 (InnoDB) · **Charset:** `utf8mb4_unicode_ci`
> **Production DB name:** `default` (Coolify convention) · **Schema file:** `database/schema_production.sql`
> All tables use `INT UNSIGNED AUTO_INCREMENT` surrogate PKs unless noted.

---

## Table count summary — 40 tables across 8 domains

| Domain | Tables |
|--------|--------|
| **Users & Auth** | `admin_users`, `tenant_users`, `login_attempts`, `activity_log` |
| **Core Real Estate** | `clients`, `properties`, `buildings`, `property_media`, `property_price_history` |
| **Contracts & Payments** | `contracts`, `payments`, `invoices`, `stripe_payments`, `agent_commissions` |
| **Tenants & Leases** | `tenants`, `tenant_users`, `tenant_surveys`, `property_applications` |
| **Communications** | `communications`, `whatsapp_messages`, `whatsapp_templates`, `email_templates` |
| **Operations** | `reminders`, `appointments`, `documents`, `pdf_documents`, `esign_requests` |
| **Property Management** | `expenses`, `suppliers`, `property_insurance`, `property_inventory`, `property_keys`, `meter_readings`, `property_appraisals` |
| **Social & Config** | `social_posts`, `social_settings`, `leads`, `lead_property_matches`, `app_settings`, `payment_reminder_log` |

Plus a self-initialising `api_rate_limits` table (created on first use) — see
[05-DATABASE-INDEXING.md](05-DATABASE-INDEXING.md) and [07-AUTHENTICATION-SECURITY.md](07-AUTHENTICATION-SECURITY.md).

---

## Full ERD

> Simplified — primary FK relationships. Optional nullable FKs shown as `o--`.

```mermaid
erDiagram
    admin_users {
        int id PK
        varchar username UK
        varchar password_hash
        enum role "super_admin|admin|agent|readonly"
        varchar email
        tinyint totp_enabled
        tinyint is_active
    }
    tenant_users { int id PK; int tenant_id FK; varchar password_hash }
    login_attempts { int id PK; varchar ip_address; tinyint success; timestamp attempted_at }
    activity_log {
        int id PK; int admin_user_id FK
        enum action "create|update|delete|login|logout"
        varchar entity_type; int entity_id; varchar ip_address
    }
    clients {
        int id PK; varchar name; varchar surname; varchar codice_fiscale
        varchar phone; varchar email; enum status "active|inactive|archived"
    }
    buildings { int id PK; varchar name; varchar address; varchar city; int total_units }
    properties {
        int id PK; int client_id FK; int building_id FK
        varchar address; varchar city
        enum type "appartamento|villa|ufficio|negozio|box|terreno|altro"
        enum status "disponibile|affittato|venduto|in_trattativa|non_disponibile"
        decimal price_rent; decimal price_sale; decimal sqm; int rooms
    }
    property_media {
        int id PK; int property_id FK
        enum media_type "photo|video|floor_plan|house_map|attachment"
        varchar file_path; smallint sort_order
    }
    property_price_history {
        int id PK; int property_id FK; decimal old_price; decimal new_price
        int changed_by FK; timestamp changed_at
    }
    contracts {
        int id PK; int property_id FK; int tenant_id FK; int client_id FK
        enum contract_type "locazione|compravendita|preliminare|mandato|altro"
        enum status "draft|sent|signed|expired|cancelled"
        date start_date; date end_date; decimal monthly_rent; decimal deposit
    }
    payments {
        int id PK; int contract_id FK; int tenant_id FK; decimal amount
        enum status "pending|paid|overdue|cancelled"
        date due_date; date paid_date
        enum payment_method "cash|bonifico|stripe|altro"
    }
    invoices {
        int id PK; varchar invoice_number UK; int client_id FK; int property_id FK
        decimal amount; decimal vat_rate; decimal vat_amount "GENERATED"
        decimal total "GENERATED"; enum status "draft|sent|paid|cancelled"
        date issue_date; date due_date
    }
    stripe_payments {
        int id PK; int payment_id FK; int tenant_id FK
        varchar stripe_session_id UK; varchar stripe_payment_intent
        decimal amount; enum status "pending|paid|failed|refunded"
    }
    agent_commissions {
        int id PK; int admin_user_id FK; int contract_id FK; int property_id FK
        int client_id FK; decimal amount; decimal percentage
        enum commission_type "vendita|locazione|affitto|gestione|altro"
        enum status "pending|paid"
    }
    tenants {
        int id PK; varchar name; varchar surname; varchar email; varchar phone
        enum status "active|inactive|archived"
    }
    tenant_surveys {
        int id PK; int tenant_id FK; int property_id FK
        tinyint overall_rating; tinyint maintenance_rating; tinyint communication_rating
        varchar token UK; timestamp submitted_at
    }
    property_applications {
        int id PK; int property_id FK; int lead_id FK
        enum status "pending|approved|rejected|withdrawn"; text notes
    }
    leads {
        int id PK; varchar name; varchar surname
        enum interest_type "affitto|acquisto|entrambi"
        decimal budget_min; decimal budget_max; varchar preferred_city
        enum status "new|contacted|interested|negotiating|converted|lost"
        enum source "telefono|email|web|passaparola|social|altro"; int assigned_to FK
    }
    lead_property_matches { int lead_id FK; int property_id FK }
    communications {
        int id PK; int client_id FK; enum direction "sent|received"
        enum channel "email|whatsapp"; varchar subject
        enum status "draft|sent|delivered|failed|received"
    }
    whatsapp_messages {
        int id PK; enum direction "inbound|outbound"; varchar from_number; varchar to_number
        text body; varchar twilio_sid; int client_id FK; int tenant_id FK; tinyint is_read
    }
    whatsapp_templates {
        int id PK; varchar name
        enum category "benvenuto|scadenza|pagamento|visita|generico"
        text body; text variables "JSON array"
    }
    email_templates {
        int id PK; varchar name
        enum category "benvenuto|scadenza_contratto|scadenza_affitto|promemoria|richiesta_documento|generico"
        varchar subject; text body; tinyint is_active
    }
    reminders {
        int id PK; varchar title; datetime reminder_date
        enum frequency "once|weekly|biweekly|monthly|quarterly|yearly"
        enum status "pending|completed|cancelled"
        int client_id FK; int tenant_id FK; int property_id FK; int supplier_id FK
        enum maintenance_status "aperta|in_lavorazione|completata|chiusa"
        tinyint notify_admin; tinyint notify_client; datetime last_notified_at
    }
    appointments {
        int id PK; int property_id FK; int lead_id FK; int client_id FK; int agent_id FK
        datetime appointment_date; enum status "scheduled|completed|cancelled|no_show"
    }
    documents {
        int id PK; enum doc_type "invoice|contract|id|id_front|id_back|other"
        int client_id FK; int property_id FK; int contract_id FK
        varchar file_path; varchar original_name; varchar mime_type
    }
    pdf_documents {
        int id PK; enum doc_type; int client_id FK; int property_id FK
        int tenant_id FK; int admin_user_id FK; varchar file_path; varchar title
    }
    esign_requests {
        int id PK; int document_id FK; int contract_id FK
        varchar signer_name; varchar signer_email; varchar token UK
        enum status "pending|signed|expired"; timestamp signed_at; timestamp expires_at
    }
    expenses {
        int id PK; int property_id FK; int client_id FK; int supplier_id FK
        enum category "manutenzione|utenze|tasse|assicurazione|agenzia|altro"
        decimal amount; date expense_date
    }
    suppliers {
        int id PK; varchar name
        enum category "idraulico|elettricista|muratore|falegname|imbianchino|giardiniere|pulizie|altro"
        varchar phone; varchar email; tinyint rating "1-5"; tinyint is_active
    }
    property_insurance {
        int id PK; int property_id FK; varchar policy_number; varchar insurer
        decimal premium; date start_date; date end_date; enum status
    }
    property_inventory {
        int id PK; int property_id FK; varchar item_name; varchar condition
        int quantity; text notes
    }
    property_keys {
        int id PK; int property_id FK; int holder_id FK "admin_users"
        varchar holder_name "external"; enum status "out|in_office|lost"
        date handed_at; date returned_at
    }
    meter_readings {
        int id PK; int property_id FK; int tenant_id FK; enum meter_type
        decimal reading; date reading_date
    }
    property_appraisals {
        int id PK; int property_id FK; decimal estimated_value
        varchar appraiser; date appraisal_date; text notes
    }
    social_posts {
        int id PK; int property_id FK; enum platform "facebook|instagram|both"
        text caption; varchar image_path; datetime scheduled_at; datetime published_at
        enum status "draft|scheduled|published|failed"
        varchar facebook_post_id; varchar instagram_media_id; text error_message
    }
    social_settings {
        tinyint id PK "always 1"; varchar meta_app_id; varchar meta_user_token
        varchar facebook_page_id; varchar facebook_page_token
        varchar instagram_account_id; datetime token_expires_at
    }
    app_settings { varchar setting_key PK; text setting_value }
    payment_reminder_log {
        int id PK; int payment_id FK; varchar channel "email|whatsapp"
        varchar status; timestamp sent_at
    }

    admin_users ||--o{ activity_log : logs
    admin_users ||--o{ agent_commissions : earns
    admin_users ||--o{ pdf_documents : creates
    admin_users ||--o{ property_price_history : changes
    clients ||--o{ properties : owns
    clients ||--o{ contracts : party_to
    clients ||--o{ communications : receives
    clients ||--o{ reminders : linked
    clients ||--o{ documents : has
    clients ||--o{ expenses : incurs
    clients ||--o{ invoices : billed
    clients ||--o{ agent_commissions : linked
    clients ||--o{ whatsapp_messages : linked
    buildings ||--o{ properties : contains
    properties ||--o{ property_media : has
    properties ||--o{ property_price_history : tracks
    properties ||--o{ contracts : subject_of
    properties ||--o{ documents : has
    properties ||--o{ reminders : linked
    properties ||--o{ social_posts : promoted_via
    properties ||--o{ expenses : incurs
    properties ||--o{ appointments : scheduled_at
    properties ||--o{ property_insurance : covered_by
    properties ||--o{ property_inventory : contains
    properties ||--o{ property_keys : has
    properties ||--o{ meter_readings : tracked_by
    properties ||--o{ property_appraisals : appraised
    properties ||--o{ lead_property_matches : matched_to
    properties ||--o{ property_applications : applied_for
    properties ||--o{ tenant_surveys : reviewed_in
    contracts ||--o{ payments : generates
    contracts ||--o{ documents : has
    contracts ||--o{ esign_requests : signed_via
    contracts ||--o{ agent_commissions : generates
    payments ||--o{ stripe_payments : paid_via
    payments ||--o{ payment_reminder_log : reminded_by
    tenants ||--|| tenant_users : portal_login
    tenants ||--o{ contracts : party_to
    tenants ||--o{ whatsapp_messages : linked
    tenants ||--o{ reminders : linked
    tenants ||--o{ tenant_surveys : completes
    tenants ||--o{ meter_readings : tracks
    tenants ||--o{ payments : owes
    tenants ||--o{ stripe_payments : pays
    leads ||--o{ lead_property_matches : matched
    leads ||--o{ appointments : books
    leads ||--o{ property_applications : submits
    suppliers ||--o{ expenses : supplies
    suppliers ||--o{ reminders : linked
    documents ||--o{ esign_requests : signed_via
```

---

## Table details

- **`admin_users`** — Staff accounts. Roles: `super_admin`, `admin`, `agent`, `readonly`. Optional per-user TOTP 2FA. Bcrypt via `password_hash()`.
- **`clients`** — Property owners (proprietari), the central entity. Soft-delete via `status=archived`. Optional `portal_email` / `portal_password_hash` power the **owner portal**.
- **`properties`** — Listings, linked to a client and optionally a building. Price changes recorded in `property_price_history`.
- **`contracts`** — Locazione / compravendita / preliminare / mandato. Signing flow draft → sent → signed; e-signature via `esign_requests`.
- **`payments`** — Rent/fee records, linked to a contract and optionally a tenant. Manual + Stripe tracking; `payment_reminder_log` records sent reminders.
- **`tenants` + `tenant_users`** — `tenants` holds personal data; `tenant_users` holds the portal password hash (one-to-one).
- **`leads`** — Prospect pipeline `new → converted / lost`. `lead_property_matches` is a many-to-many pivot to candidate properties.
- **`reminders`** — Dual-use: generic reminders **and** maintenance tickets (`type='maintenance'`). Maintenance columns: `maintenance_status`, `request_type`, `category`, `supplier_id`, `supplier_name`, `priority`, `tenant_name`, and `tenant_id` FK (added phase24, links a ticket to the submitting tenant).
- **`whatsapp_messages`** — Twilio inbound/outbound log; linked to `client_id` or `tenant_id` (both nullable).
- **`social_posts`** — Scheduled FB/IG posts. Image posts need `image_path` + `META_PUBLIC_BASE_URL`. Cron reads `status=scheduled`.
- **`social_settings`** — Single-row (`id=1`) Meta OAuth store: user token, page token, page ID, IG account ID. Tokens expire (~60 days) → manual reconnect.
- **`app_settings`** — Key-value runtime config editable in Settings UI (`smtp_host`, `agency_name`, `primary_color`, `whatsapp_enabled`, …).
- **`esign_requests`** — Token-based signing: signer link → view → sign → `status=signed`; tokens expire at `expires_at`.

---

## Key constraints

| Table | Unique constraint |
|-------|-------------------|
| `admin_users` | `username` |
| `invoices` | `invoice_number` |
| `esign_requests` | `token` |
| `tenant_surveys` | `token` |
| `tenants` | `email` (dedup on conversion, excludes archived) |
| `tenant_users` | `tenant_id` (one portal account per tenant) |
| `stripe_payments` | `stripe_session_id` |
| `lead_property_matches` | `(lead_id, property_id)` composite PK |
| `building_properties` | `(building_id, property_id)` composite PK |

---

## Data-integrity notes

- Most FKs use **`ON DELETE SET NULL`** (preserve history when a related record is deleted).
- `agent_commissions.admin_user_id` uses **`ON DELETE CASCADE`** (commission removed if agent deleted).
- `invoices.vat_amount` and `invoices.total` are MySQL **`GENERATED ALWAYS`** computed columns.
- `app_settings` has no foreign keys — pure key-value.
- `social_settings` enforces the single-row pattern via a `tinyint` PK fixed at `id=1`.
- FK-integrity and relationship-fix migrations landed in phase22, phase24, phase25, phase26.
